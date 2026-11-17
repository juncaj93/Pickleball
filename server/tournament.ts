import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { organizerSignedIn } from './zip13';
import { audit, type GroupRow, organizerIdOf } from './repo';
import { localParts } from '../shared/time';
import {
  DEFAULT_FORMAT,
  FORMATS,
  formatLocked,
  type TournamentFormat,
  type AdminTournamentView,
  cleanDays,
  dayKey,
  dayLong,
  findPlan,
  isLevel,
  isSize,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  NAME_MAX,
  planAllowed,
  type PlayerTournamentView,
  TOURNAMENTS,
  tournamentsAllowed,
  type TournamentStatus,
  type Visibility,
} from '../shared/tournament';

// Zip 55: TOURNAMENTS (shared/tournament.ts), piece 1. On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (one task_log row, kind 'mark', no game), or this phone opened the site with
//    ?tournaments=on (it then sends X-Tournaments: a private test switch for that phone only).
// No Cloudflare variable (Zip 45's rule): the preview turns the row on in its seed, and the preview-only Tournament test page turns it on too.
// Off: nothing here is read beyond that one switch question (answered by the shared switch read when "Fewer database trips" is on), and no
// answer carries anything new: every screen is exactly main's.
//
// Who sees a tournament (each tournament's own "Who can see it"):
//   Everyone   every player with a name picked;
//   Only me    ONLY the organizer's own player, on a phone signed in as the organizer (the real PIN), or the organizer's View as of their own
//              player. Anyone else (a player, a phone that merely picked the organizer's name, a read-only PIN helper on the player page) gets
//              nothing: the answer has no `tournament` key at all, and every player route answers "not open". (A read-only helper sees it where
//              they already see every organizer screen: the dashboard, and View as of the organizer's own player.)
// The organizer screens always see it while the switch is on.
//
// No money moves in piece 1: the ticket price and the champion credit are stored, nothing is charged, paid or credited.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export async function tournamentsForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, TOURNAMENTS.task).first().catch(() => null);
  return !!row;
}

export async function setTournamentsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  // One batch: the row is exactly on or off afterwards (two quick saves can never leave two rows).
  await db.batch([
    db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, TOURNAMENTS.task),
    ...(on ? [db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, TOURNAMENTS.task, nowIso)] : []),
  ]);
}

/** The switch for this request, and the Settings row: one read of the row for both. */
export async function tournamentsFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const forAll = await tournamentsForAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(TOURNAMENTS.header) ?? '').trim().toLowerCase() === 'on';
  return { on: tournamentsAllowed(ctx.env.TOURNAMENTS) && (forAll || header), forAll };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentRow {
  id: string;
  group_id: string;
  name: string;
  size: number;
  courts: number;
  minutes: number;
  start_minutes: number;
  ticket_cents: number;
  champion_credit_cents: number;
  offered_dates: string;
  final_date: string | null;
  status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  date_picked_at: string | null;
  shown_at: string | null;
  canceled_at: string | null;
  format: string;
  second_credit_cents: number;
}

interface SignupRow {
  id: string;
  tournament_id: string;
  player_id: string;
  status: string;
  picked_level: number;
  approved_level: number | null;
  dates: string;
  joined_at: string;
  created_at: string;
  updated_at: string;
  backed_out_at: string | null;
  display_name: string;
  is_active: number;
}

/** The stages piece 1 knows. Later pieces add theirs here. */
const OPEN = "('signup', 'date_picked')";

/** The group's open tournament (piece 1: signing up, or the date picked), or null. Null too while the tables do not exist yet. */
export async function activeTournament(db: D1Database, groupId: string): Promise<TournamentRow | null> {
  return db
    .prepare(`SELECT * FROM tournaments WHERE group_id = ? AND status IN ${OPEN} ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<TournamentRow>()
    .catch(() => null);
}

/**
 * The same read for a player's phone, in the SAME single trip: on an Only me tournament it also brings the two facts that decide whether this
 * player is the organizer's own (the organizer's saved player still exists; this player's name). So Only me costs any player exactly the trips
 * of "none open" (nothing to time), whether the organizer's player is saved by id or matched by name.
 */
async function activeTournamentForPlayer(db: D1Database, group: GroupRow, playerId: string): Promise<(TournamentRow & { org_saved: string | null; viewer_name: string | null }) | null> {
  return db
    .prepare(
      `SELECT t.*,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT id FROM players WHERE id = ? AND group_id = t.group_id) END AS org_saved,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT display_name FROM players WHERE id = ? AND group_id = t.group_id) END AS viewer_name
       FROM tournaments t WHERE t.group_id = ? AND t.status IN ${OPEN} ORDER BY t.created_at DESC LIMIT 1`,
    )
    .bind(group.organizer_player_id ?? '', playerId, group.id)
    .first<TournamentRow & { org_saved: string | null; viewer_name: string | null }>()
    .catch(() => null);
}

async function signupRows(db: D1Database, tournamentId: string): Promise<SignupRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, p.display_name, p.is_active FROM tournament_signups s JOIN players p ON p.id = s.player_id
       WHERE s.tournament_id = ? ORDER BY s.joined_at, s.rowid`,
    )
    .bind(tournamentId)
    .all<SignupRow>();
  return results;
}

/** A stored list of days, read safely (anything odd reads as no days). */
export function storedDays(json: string | null | undefined): string[] {
  try {
    return cleanDays(JSON.parse(json ?? '[]')) ?? [];
  } catch {
    return [];
  }
}

/** The stored format, read safely (anything odd reads as Doubles). */
const formatOf = (t: TournamentRow): TournamentFormat => (t.format === 'americano' ? 'americano' : 'doubles');

const statusOf = (t: TournamentRow): TournamentStatus => (t.status === 'date_picked' ? 'date_picked' : 'signup');

/**
 * The dates a player can pick now: every offered date from today on while sign-up is open; only the picked one once it is picked. A day that
 * has passed is never a choice (so the list can be empty: every offered date, or the picked one, has passed). `today`: the Eastern calendar
 * day ('YYYY-MM-DD').
 */
export function openDatesOf(t: TournamentRow, today: string): string[] {
  const days = statusOf(t) === 'date_picked' && t.final_date ? [t.final_date] : storedDays(t.offered_dates);
  return days.filter((d) => d >= today);
}

/** Eastern calendar day of a moment, 'YYYY-MM-DD'. */
export function todayKey(nowMs: number, tz = 'America/Detroit'): string {
  const p = localParts(nowMs, tz);
  return dayKey(p.year, p.month, p.day);
}

// ---------------------------------------------------------------------------------------------------------------------
// Who sees it
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The open tournament this player may see, or null (switch off, none open, or Only me and this is not the organizer's own signed-in phone).
 * `viewAs`: the organizer's View as (the request already passed the organizer's sign-in).
 */
async function visibleTo(ctx: Ctx, group: GroupRow, playerId: string, viewAs: boolean): Promise<{ t: TournamentRow; onlyMe: boolean } | null> {
  if (!(await tournamentsFlags(ctx, group.id)).on) return null;
  const row = await activeTournamentForPlayer(ctx.db, group, playerId);
  if (!row) return null;
  const { org_saved: orgSaved, viewer_name: viewerName, ...t } = row;
  // Every offered date has passed with none picked: hidden from every player (Alex, Zip 55 feedback), the same as none open. The organizer's
  // Home card says "Dates have passed. Add dates."; Edit settings with new dates shows it again.
  if (statusOf(t) === 'signup' && openDatesOf(t, todayKey(ctx.nowMs, group.timezone)).length === 0) return null;
  if (t.visibility === 'all') return { t, onlyMe: false };
  // Only me: the organizer's own player, on the organizer's own signed-in phone (or the organizer's View as of their own player). Any other
  // player is answered from the one read above (organizerIdOf's own rule: the saved player if it still exists, else the name in Settings), so
  // the Only me path costs exactly the trips of "no tournament open". Only a phone that passes this is checked further.
  const orgName = (group.organizer_name ?? '').trim().toLowerCase();
  const maybeOrganizer = orgSaved ? playerId === orgSaved : !!orgName && (viewerName ?? '').trim().toLowerCase() === orgName;
  if (!maybeOrganizer) return null;
  // The sign-in check next: a phone with no organizer cookie (every player, also one that picked the organizer's name) is refused with no trip.
  if (!viewAs && !(await organizerSignedIn(ctx, group.id))) return null;
  // Only the organizer's own signed-in phone (or View as) gets here: two players with the organizer's name, only the first is theirs.
  if (!orgSaved && playerId !== (await organizerIdOf(ctx.db, group))) return null;
  return { t, onlyMe: true };
}

/** GET /api/group `tournament`: this player's card, or null (then the answer has no `tournament` key at all). */
export async function playerTournamentFor(ctx: Ctx, group: GroupRow, playerId: string | null, viewAs: boolean): Promise<PlayerTournamentView | null> {
  if (!playerId) return null;
  const seen = await visibleTo(ctx, group, playerId, viewAs);
  if (!seen) return null;
  const { t, onlyMe } = seen;
  const rows = (await signupRows(ctx.db, t.id)).filter((r) => r.status === 'in' && r.is_active === 1);
  const mine = rows.find((r) => r.player_id === playerId) ?? null;
  return {
    id: t.id,
    name: t.name,
    format: formatOf(t),
    status: statusOf(t),
    start: t.start_minutes,
    minutes: t.minutes,
    openDates: openDatesOf(t, todayKey(ctx.nowMs, group.timezone)),
    finalDate: statusOf(t) === 'date_picked' ? t.final_date : null,
    names: rows.map((r) => r.display_name),
    // Their own pick only (never the organizer's level for them).
    me: mine ? { level: mine.picked_level, dates: storedDays(mine.dates) } : null,
    ...(onlyMe ? { onlyMe: true as const } : {}),
  };
}

/** The organizer's view of the open tournament (dashboard `tournament`), or null. */
export async function adminTournamentFor(ctx: Ctx, group: GroupRow): Promise<AdminTournamentView | null> {
  const t = await activeTournament(ctx.db, group.id);
  if (!t) return null;
  const rows = (await signupRows(ctx.db, t.id)).filter((r) => r.is_active === 1);
  return {
    id: t.id,
    name: t.name,
    format: formatOf(t),
    formatLocked: formatLocked(t.status),
    status: statusOf(t),
    visibility: t.visibility === 'all' ? 'all' : 'me',
    size: t.size,
    courts: t.courts,
    minutes: t.minutes,
    start: t.start_minutes,
    ticketCents: t.ticket_cents,
    championCreditCents: t.champion_credit_cents,
    secondCreditCents: t.second_credit_cents ?? 0,
    offeredDates: storedDays(t.offered_dates),
    finalDate: statusOf(t) === 'date_picked' ? t.final_date : null,
    createdAt: t.created_at,
    signups: rows
      .filter((r) => r.status === 'in')
      .map((r) => ({
        playerId: r.player_id,
        name: r.display_name,
        pickedLevel: r.picked_level,
        level: r.approved_level ?? r.picked_level,
        reviewed: r.approved_level !== null,
        dates: storedDays(r.dates),
        at: r.joined_at,
      })),
    backedOut: rows
      .filter((r) => r.status !== 'in')
      .sort((a, b) => (b.backed_out_at ?? '').localeCompare(a.backed_out_at ?? ''))
      .map((r) => ({ playerId: r.player_id, name: r.display_name })),
  };
}

/**
 * The "did anything change?" part for a player's screen: only while the tournament is visible to them (so an Only me tournament changes
 * nothing a player's phone can see, not even its fingerprint). Null: nothing to add (the stamp is then exactly main's).
 */
export async function playerTournamentStamp(ctx: Ctx, group: GroupRow, playerId: string | null): Promise<string | null> {
  // Absent while there is nothing this player may see (switch off, none open, Only me for someone else): the stamp is then main's.
  const view = await playerTournamentFor(ctx, group, playerId, false).catch(() => null);
  return view ? `tour:${JSON.stringify(view)}` : null;
}

/** The organizer's "did anything change?" part, only while the switch is on (null: the stamp is exactly main's). */
export async function adminTournamentStamp(ctx: Ctx, group: GroupRow): Promise<string | null> {
  if (!(await tournamentsFlags(ctx, group.id)).on) return null;
  const view = await adminTournamentFor(ctx, group).catch(() => null);
  return `tour:${view ? JSON.stringify(view) : 'none'}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's taps
// ---------------------------------------------------------------------------------------------------------------------

/** Organizer routes: the organizer's sign-in, and the switch on for this phone (off: refused, nothing read or written). */
async function organizerOn(ctx: Ctx): Promise<GroupRow> {
  const group = await requireAdmin(ctx);
  if (!(await tournamentsFlags(ctx, group.id)).on) throw new HttpError(403, 'tournaments_off', 'Tournaments are switched off.');
  return group;
}

async function openById(ctx: Ctx, group: GroupRow): Promise<TournamentRow> {
  const id = v.id(ctx.params.id, 'tournament');
  const t = await activeTournament(ctx.db, group.id);
  if (!t || t.id !== id) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return t;
}

/** Only an open tournament (piece 1's two stages) is ever changed: a save racing a Cancel changes nothing and says "look again". */
const OPEN_GUARD = "AND status IN ('signup', 'date_picked')";
const changedOrLookAgain = (res: { meta?: { changes?: number } }) => {
  if ((res.meta?.changes ?? 0) === 0) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
};

const bad = (code: string, message: string): never => {
  throw new HttpError(400, code, message);
};

function wholeCents(v: unknown, field: string, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_PRICE_CENTS) bad(`invalid_${field}`, `${label} must be between $0 and $${MAX_PRICE_CENTS / 100}.`);
  return v as number;
}

interface Settings {
  name: string;
  dates: string[];
  size: number;
  courts: number;
  minutes: number;
  start: number;
  ticketCents: number;
  creditCents: number;
  secondCreditCents: number;
  format: TournamentFormat;
  visibility: Visibility;
}

/**
 * The Create (and Edit) screen's fields, checked. `keep`: dates already offered, which may stay even once they are in the past. `keepPlan`: the
 * plan the tournament already has, which may stay even if Booking hours was turned off since (only a NEW 2.5 or 3 hour plan needs it on).
 */
function readSettings(body: Record<string, unknown>, group: GroupRow, nowMs: number, keep: readonly string[] = [], keepPlan?: { courts: number; minutes: number; start: number }): Settings {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) bad('invalid_name', 'Type a name.');
  if (Array.from(name).length > NAME_MAX) bad('invalid_name', `Keep the name to ${NAME_MAX} letters.`);
  v.text(name, 'name', { max: NAME_MAX * 2 }); // control and hidden characters refused
  const dates = cleanDays(body.dates);
  if (!dates || dates.length === 0) bad('invalid_dates', 'Pick at least one date.');
  if (dates!.length > MAX_DATES) bad('invalid_dates', `Pick at most ${MAX_DATES} dates.`);
  const today = todayKey(nowMs, group.timezone);
  if (dates!.some((d) => d < today && !keep.includes(d))) bad('invalid_dates', 'Pick dates from today on.');
  const size = body.size;
  if (!isSize(size)) bad('invalid_size', 'Pick 6, 8, 10 or 12 players.');
  const plan = findPlan(size as 6, Number(body.courts), Number(body.minutes), Number(body.start));
  if (!plan) bad('invalid_plan', 'Pick a court plan.');
  // 2.5 and 3 hour plans only while Booking hours is on for everyone (the same gate as the 2.5 and 3 hour prices).
  const samePlan = !!keepPlan && keepPlan.courts === plan!.courts && keepPlan.minutes === plan!.minutes && keepPlan.start === plan!.start;
  if (!samePlan && !planAllowed(plan!, group.long_games === true)) bad('invalid_plan', '2.5 and 3 hour games need Booking hours turned on.');
  return {
    name,
    dates: dates!,
    size: size as number,
    courts: plan!.courts,
    minutes: plan!.minutes,
    start: plan!.start,
    ticketCents: wholeCents(body.ticketCents, 'ticket', 'The ticket price'),
    creditCents: wholeCents(body.creditCents, 'credit', 'The credit'),
    // Americano's 2nd place credit (left out, e.g. by Doubles: $0, nothing to pay).
    secondCreditCents: body.secondCreditCents === undefined ? 0 : wholeCents(body.secondCreditCents, 'second_credit', 'The 2nd place credit'),
    format: body.format === undefined ? DEFAULT_FORMAT : v.oneOf(body.format, 'format', FORMATS),
    visibility: v.oneOf(body.visibility, 'visibility', ['me', 'all'] as const),
  };
}

const tablesMissing = (err: unknown) => err instanceof Error && /no such table/i.test(err.message);
const notReady = () => new HttpError(409, 'tournaments_not_ready', 'Tournaments are not set up on this site yet.');

/** POST /api/admin/tournament: Create tournament ("Open sign-up"). One open tournament at a time. */
export async function createTournament(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const s = readSettings(body, group, ctx.nowMs);
  if (await activeTournament(ctx.db, group.id)) throw new HttpError(409, 'tournament_open', 'A tournament is already open.');
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, shown_at, format, second_credit_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'signup', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, group.id, s.name, s.size, s.courts, s.minutes, s.start, s.ticketCents, s.creditCents, JSON.stringify(s.dates), s.visibility, ctx.nowIso, ctx.nowIso, s.visibility === 'all' ? ctx.nowIso : null, s.format, s.secondCreditCents)
      .run();
  } catch (err) {
    if (tablesMissing(err)) throw notReady();
    // The one-open index: another Create landed first.
    if (err instanceof Error && /unique/i.test(err.message)) throw new HttpError(409, 'tournament_open', 'A tournament is already open.');
    throw err;
  }
  await audit(ctx.db, group.id, null, 'tournament_created', { tournament: s.name, visibility: s.visibility, format: s.format }, ctx.nowIso);
  return { ok: true, id };
}

/**
 * PUT /api/admin/tournament/:id: Edit the tournament's settings. A date taken off the offer comes off every player's picks too; the picked
 * date cannot be taken off (pick another one first).
 */
export async function updateTournament(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const offered = storedDays(t.offered_dates);
  const s = readSettings(body, group, ctx.nowMs, offered, { courts: t.courts, minutes: t.minutes, start: t.start_minutes });
  // A save that leaves the format or the 2nd place credit out keeps what the tournament has (only Create starts them at their defaults).
  if (body.format === undefined) s.format = formatOf(t);
  if (body.secondCreditCents === undefined) s.secondCreditCents = t.second_credit_cents ?? 0;
  // The format is locked once tickets open (piece 2): a save that tries to change it then is refused.
  if (s.format !== formatOf(t) && formatLocked(t.status)) throw new HttpError(409, 'format_locked', 'Tickets are open. The format cannot change now.');
  if (t.final_date && statusOf(t) === 'date_picked' && !s.dates.includes(t.final_date)) {
    throw new HttpError(409, 'final_date_kept', 'That date is the one you picked. Pick another date first.');
  }
  // For History only: how many players on the list (shown on the level list) lose a date they had picked. The trim itself runs on the rows as
  // they are when the save lands (below), so a player's own edit that lands in between is never overwritten.
  const offer = JSON.stringify(s.dates);
  const trimmed = (await signupRows(ctx.db, t.id)).filter((r) => r.status === 'in' && r.is_active === 1 && storedDays(r.dates).some((d) => !s.dates.includes(d))).length;
  const [res] = await ctx.db.batch([
    // Also guarded on the picked date still being in the new offer: a date pick that lands between the read above and this save is never left
    // outside the offered dates ("look again" instead).
    ctx.db
      .prepare(
        `UPDATE tournaments SET name = ?, size = ?, courts = ?, minutes = ?, start_minutes = ?, ticket_cents = ?, champion_credit_cents = ?, offered_dates = ?,
           visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ?, format = ?, second_credit_cents = ?
         WHERE id = ? AND group_id = ? ${OPEN_GUARD} AND (final_date IS NULL OR final_date IN (SELECT value FROM json_each(?)))`,
      )
      .bind(s.name, s.size, s.courts, s.minutes, s.start, s.ticketCents, s.creditCents, offer, s.visibility, s.visibility, ctx.nowIso, ctx.nowIso, s.format, s.secondCreditCents, t.id, group.id, offer),
    // Every player's dates lose only the days taken off the offer, read from the row as it is now, and only when the save above landed (the
    // tournament holds exactly the new offer and is still open).
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET
           dates = (SELECT json_group_array(value) FROM (SELECT j.value AS value FROM json_each(tournament_signups.dates) j WHERE j.value IN (SELECT value FROM json_each(?1)) ORDER BY j.value)),
           updated_at = ?2
         WHERE tournament_id = ?3
           AND EXISTS (SELECT 1 FROM json_each(tournament_signups.dates) j WHERE j.value NOT IN (SELECT value FROM json_each(?1)))
           AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?3 AND offered_dates = ?1 ${OPEN_GUARD})`,
      )
      .bind(offer, ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res);
  await audit(ctx.db, group.id, null, 'tournament_edited', { tournament: s.name, ...(trimmed ? { trimmed } : {}) }, ctx.nowIso);
  if (s.visibility !== (t.visibility === 'all' ? 'all' : 'me')) await audit(ctx.db, group.id, null, s.visibility === 'all' ? 'tournament_shown' : 'tournament_hidden', { tournament: s.name }, ctx.nowIso);
  return { ok: true };
}

/** PUT /api/admin/tournament/:id/visibility { visibility }: Only me or Everyone (also the player page's "Show to everyone"). */
export async function setTournamentVisibility(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const visibility = v.oneOf(body.visibility, 'visibility', ['me', 'all'] as const);
  changedOrLookAgain(
    await ctx.db
      .prepare(`UPDATE tournaments SET visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ? WHERE id = ? ${OPEN_GUARD}`)
      .bind(visibility, visibility, ctx.nowIso, ctx.nowIso, t.id)
      .run(),
  );
  if (visibility !== (t.visibility === 'all' ? 'all' : 'me')) await audit(ctx.db, group.id, null, visibility === 'all' ? 'tournament_shown' : 'tournament_hidden', { tournament: t.name }, ctx.nowIso);
  return { ok: true, visibility };
}

/** PUT /api/admin/tournament/:id/level { playerId, level }: the organizer's level for one player (kept in the level history too). */
export async function setTournamentLevel(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const playerId = v.id(body.playerId, 'playerId');
  if (!isLevel(body.level)) bad('invalid_level', 'Pick a level.');
  const level = body.level as number;
  const row = await ctx.db
    .prepare("SELECT s.id, p.display_name FROM tournament_signups s JOIN players p ON p.id = s.player_id WHERE s.tournament_id = ? AND s.player_id = ? AND s.status = 'in'")
    .bind(t.id, playerId)
    .first<{ id: string; display_name: string }>();
  if (!row) throw new HttpError(409, 'not_signed_up', 'They are not on the list any more.');
  const [res] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE tournaments SET updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, t.id),
    ctx.db
      .prepare(`UPDATE tournament_signups SET approved_level = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM tournaments WHERE id = ? ${OPEN_GUARD})`)
      .bind(level, ctx.nowIso, row.id, t.id),
    ctx.db
      .prepare(
        `INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at)
         SELECT ?, ?, ?, ?, 'organizer', ? WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ? ${OPEN_GUARD})`,
      )
      .bind(newId(), t.id, playerId, level, ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res);
  await audit(ctx.db, group.id, null, 'tournament_level', { tournament: t.name, player: row.display_name, playerId, level: levelShort(level) }, ctx.nowIso);
  return { ok: true, level };
}

/** PUT /api/admin/tournament/:id/date { date }: pick the date (an offered one), or null to go back to picking. */
export async function setTournamentDate(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (body.date === null) {
    changedOrLookAgain(
      await ctx.db.prepare(`UPDATE tournaments SET status = 'signup', final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, t.id).run(),
    );
    if (t.final_date) await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: null }, ctx.nowIso);
    return { ok: true, date: null };
  }
  const date = body.date;
  if (typeof date !== 'string' || !storedDays(t.offered_dates).includes(date)) bad('invalid_date', 'Pick one of the dates you offered.');
  if ((date as string) < todayKey(ctx.nowMs, group.timezone)) bad('invalid_date', 'That date has passed. Pick another one.');
  changedOrLookAgain(
    await ctx.db
      .prepare(
        `UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ?, updated_at = ?
         WHERE id = ? ${OPEN_GUARD} AND EXISTS (SELECT 1 FROM json_each(tournaments.offered_dates) WHERE value = ?)`,
      )
      .bind(date, ctx.nowIso, ctx.nowIso, t.id, date)
      .run(),
  );
  await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: dayLong(date as string), day: date }, ctx.nowIso);
  return { ok: true, date };
}

/** POST /api/admin/tournament/:id/cancel: the tournament is over before it started (piece 1: nothing was paid). The list is kept. */
export async function cancelTournament(ctx: Ctx) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  changedOrLookAgain(await ctx.db.prepare(`UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, ctx.nowIso, t.id).run());
  await audit(ctx.db, group.id, null, 'tournament_canceled', { tournament: t.name }, ctx.nowIso);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The player's taps (sign up, edit, back out). Only on a tournament this player may see; never in View as on the live site (the demo copy only).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentActor {
  group: GroupRow;
  playerId: string | null;
  viewAsName: string | null;
}

async function playerTarget(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>): Promise<{ t: TournamentRow; playerId: string }> {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const seen = await visibleTo(ctx, who.group, who.playerId, !!who.viewAsName);
  // The same answer for "none", "switched off" and "Only me": nothing about a hidden tournament leaks through an error either.
  if (!seen) throw new HttpError(404, 'tournament_not_open', 'This tournament is not open.');
  if (typeof body.tournamentId === 'string' && body.tournamentId !== seen.t.id) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return { t: seen.t, playerId: who.playerId };
}

/**
 * A player's save lands only while the tournament is still as this request read it (the same stage, offered dates and picked date), so a
 * sign-up racing the organizer's date pick, Edit settings or Cancel never keeps a date that is gone ("look again" instead). Five values.
 */
const UNCHANGED = 'EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = ? AND offered_dates = ? AND final_date IS ?)';
const unchangedValues = (t: TournamentRow) => [t.id, t.status, t.offered_dates, t.final_date ?? null];

function readDates(body: Record<string, unknown>, open: readonly string[]): string[] {
  const dates = cleanDays(body.dates);
  if (!dates || dates.length === 0) bad('invalid_dates', 'Pick at least one date.');
  if (dates!.some((d) => !open.includes(d))) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return dates!;
}

/**
 * A player's own tap in History, under their own name. No phone code (Zip 30 "Acting for others" keeps to the game taps it was built for;
 * a tournament sign-up never shows on its Home card).
 */
async function logPlayer(ctx: Ctx, group: GroupRow, playerId: string, action: string, details: Record<string, unknown>) {
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  await audit(ctx.db, group.id, null, action, { player: name, playerId, ...details }, ctx.nowIso, name);
}

async function mySignup(db: D1Database, tournamentId: string, playerId: string) {
  return db
    .prepare('SELECT id, status, picked_level, dates FROM tournament_signups WHERE tournament_id = ? AND player_id = ?')
    .bind(tournamentId, playerId)
    .first<{ id: string; status: string; picked_level: number; dates: string }>();
}

/** POST /api/tournament/signup { tournamentId, level, dates }: on the list (again, after a back out: at the end of it). */
export async function playerTournamentSignup(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  if (!isLevel(body.level)) bad('invalid_level', 'Pick your level.');
  const level = body.level as number;
  const dates = readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  const before = await mySignup(ctx.db, t.id, playerId);
  // A second tap of Sign up (or another phone) with exactly the same answers: nothing to save, nothing to write in History.
  if (before && before.status === 'in' && before.picked_level === level && JSON.stringify(storedDays(before.dates)) === JSON.stringify(dates)) return { ok: true, result: 'signed_up' };
  const levelChanged = !before || before.picked_level !== level || before.status !== 'in';
  const [res] = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, backed_out_at)
         SELECT ?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?, NULL WHERE ${UNCHANGED}
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           joined_at = CASE WHEN tournament_signups.status = 'in' THEN tournament_signups.joined_at ELSE excluded.joined_at END,
           -- The organizer's level stands only while the player's own pick is the one it was set for: a new pick goes back to be reviewed.
           approved_level = CASE WHEN tournament_signups.picked_level = excluded.picked_level THEN tournament_signups.approved_level ELSE NULL END,
           status = 'in', picked_level = excluded.picked_level, dates = excluded.dates, updated_at = excluded.updated_at, backed_out_at = NULL`,
      )
      .bind(newId(), t.id, playerId, level, JSON.stringify(dates), ctx.nowIso, ctx.nowIso, ctx.nowIso, ...unchangedValues(t)),
    ...(levelChanged
      ? [
          ctx.db
            .prepare(`INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) SELECT ?, ?, ?, ?, 'player', ? WHERE ${UNCHANGED}`)
            .bind(newId(), t.id, playerId, level, ctx.nowIso, ...unchangedValues(t)),
        ]
      : []),
  ]);
  changedOrLookAgain(res);
  if (!before || before.status !== 'in') await logPlayer(ctx, who.group, playerId, 'tournament_signup', { tournament: t.name, level: levelShort(level) });
  else await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'signed_up' };
}

/** PUT /api/tournament/signup { tournamentId, level?, dates? }: Edit sign-up (their level, their dates). */
export async function playerTournamentEdit(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') throw new HttpError(409, 'not_signed_up', 'You are not on the list. Sign up first.');
  if (body.level !== undefined && !isLevel(body.level)) bad('invalid_level', 'Pick your level.');
  const level = body.level === undefined ? before.picked_level : (body.level as number);
  const dates = body.dates === undefined ? storedDays(before.dates) : readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  if (level === before.picked_level && JSON.stringify(dates) === JSON.stringify(storedDays(before.dates))) return { ok: true, result: 'saved' };
  const [res] = await ctx.db.batch([
    // A new pick of their own level goes back to be reviewed (the organizer's earlier level stays in the level history).
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET picked_level = ?, approved_level = CASE WHEN picked_level = ? THEN approved_level ELSE NULL END, dates = ?, updated_at = ?
         WHERE id = ? AND status = 'in' AND ${UNCHANGED}`,
      )
      .bind(level, level, JSON.stringify(dates), ctx.nowIso, before.id, ...unchangedValues(t)),
    ...(level !== before.picked_level
      ? [
          ctx.db
            .prepare(
              `INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at)
               SELECT ?, ?, ?, ?, 'player', ? WHERE ${UNCHANGED} AND EXISTS (SELECT 1 FROM tournament_signups WHERE id = ? AND status = 'in')`,
            )
            .bind(newId(), t.id, playerId, level, ctx.nowIso, ...unchangedValues(t), before.id),
        ]
      : []),
  ]);
  changedOrLookAgain(res);
  await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'saved' };
}

/** POST /api/tournament/back-out { tournamentId }: off the list (the row stays, so their level stays with this tournament). */
export async function playerTournamentBackOut(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') return { ok: true, result: 'not_signed_up' };
  const res = await ctx.db.prepare("UPDATE tournament_signups SET status = 'out', backed_out_at = ?, updated_at = ? WHERE id = ? AND status = 'in'").bind(ctx.nowIso, ctx.nowIso, before.id).run();
  if ((res.meta?.changes ?? 0) > 0) await logPlayer(ctx, who.group, playerId, 'tournament_back_out', { tournament: t.name });
  return { ok: true, result: 'backed_out' };
}

// ---------------------------------------------------------------------------------------------------------------------
// View as (server/zip18.ts): the organizer's in-browser copy gets the tournament rows too, only while the switch is on (off: nothing new).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentTables {
  tournaments: Record<string, unknown>[];
  tournament_signups: Record<string, unknown>[];
  tournament_level_history: Record<string, unknown>[];
}

export async function tournamentTablesFor(db: D1Database, groupId: string): Promise<TournamentTables | null> {
  try {
    const [a, b, c] = await db.batch([
      db.prepare('SELECT * FROM tournaments WHERE group_id = ? ORDER BY created_at, id').bind(groupId),
      db.prepare('SELECT s.* FROM tournament_signups s JOIN tournaments t ON t.id = s.tournament_id WHERE t.group_id = ? ORDER BY s.created_at, s.id').bind(groupId),
      db.prepare('SELECT h.* FROM tournament_level_history h JOIN tournaments t ON t.id = h.tournament_id WHERE t.group_id = ? ORDER BY h.created_at, h.id').bind(groupId),
    ]);
    return {
      tournaments: a.results as Record<string, unknown>[],
      tournament_signups: b.results as Record<string, unknown>[],
      tournament_level_history: c.results as Record<string, unknown>[],
    };
  } catch {
    return null;
  }
}
