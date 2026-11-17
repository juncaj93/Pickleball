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
  prizeLine,
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
//              player. Anyone else (a player, a phone that merely picked the organizer's name, a read-only PIN helper) gets nothing: the answer
//              has no `tournament` key at all, and every player route answers "not open".
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

const statusOf = (t: TournamentRow): TournamentStatus => (t.status === 'date_picked' ? 'date_picked' : 'signup');

/** The dates a player can pick now: every offered date while sign-up is open; only the picked one once it is picked. */
export function openDatesOf(t: TournamentRow): string[] {
  return statusOf(t) === 'date_picked' && t.final_date ? [t.final_date] : storedDays(t.offered_dates);
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
  const t = await activeTournament(ctx.db, group.id);
  if (!t) return null;
  if (t.visibility === 'all') return { t, onlyMe: false };
  // Only me: the organizer's own player, on the organizer's own signed-in phone (or the organizer's View as of their own player).
  if (playerId !== (await organizerIdOf(ctx.db, group))) return null;
  if (!viewAs && !(await organizerSignedIn(ctx, group.id))) return null;
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
    status: statusOf(t),
    start: t.start_minutes,
    minutes: t.minutes,
    openDates: openDatesOf(t),
    finalDate: statusOf(t) === 'date_picked' ? t.final_date : null,
    names: rows.map((r) => r.display_name),
    prize: prizeLine(t.champion_credit_cents),
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
    status: statusOf(t),
    visibility: t.visibility === 'all' ? 'all' : 'me',
    size: t.size,
    courts: t.courts,
    minutes: t.minutes,
    start: t.start_minutes,
    ticketCents: t.ticket_cents,
    championCreditCents: t.champion_credit_cents,
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
  visibility: Visibility;
}

/** The Create (and Edit) screen's fields, checked. `keep`: dates already offered, which may stay even once they are in the past. */
function readSettings(body: Record<string, unknown>, group: GroupRow, nowMs: number, keep: readonly string[] = []): Settings {
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
  if (!planAllowed(plan!, group.long_games === true)) bad('invalid_plan', '2.5 and 3 hour games need Booking hours turned on.');
  return {
    name,
    dates: dates!,
    size: size as number,
    courts: plan!.courts,
    minutes: plan!.minutes,
    start: plan!.start,
    ticketCents: wholeCents(body.ticketCents, 'ticket', 'The ticket price'),
    creditCents: wholeCents(body.creditCents, 'credit', 'The credit'),
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
           status, visibility, created_at, updated_at, shown_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'signup', ?, ?, ?, ?)`,
      )
      .bind(id, group.id, s.name, s.size, s.courts, s.minutes, s.start, s.ticketCents, s.creditCents, JSON.stringify(s.dates), s.visibility, ctx.nowIso, ctx.nowIso, s.visibility === 'all' ? ctx.nowIso : null)
      .run();
  } catch (err) {
    if (tablesMissing(err)) throw notReady();
    // The one-open index: another Create landed first.
    if (err instanceof Error && /unique/i.test(err.message)) throw new HttpError(409, 'tournament_open', 'A tournament is already open.');
    throw err;
  }
  await audit(ctx.db, group.id, null, 'tournament_created', { tournament: s.name, visibility: s.visibility }, ctx.nowIso);
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
  const s = readSettings(body, group, ctx.nowMs, offered);
  if (t.final_date && statusOf(t) === 'date_picked' && !s.dates.includes(t.final_date)) {
    throw new HttpError(409, 'final_date_kept', 'That date is the one you picked. Pick another date first.');
  }
  const rows = await signupRows(ctx.db, t.id);
  const trims = rows
    .map((r) => ({ r, kept: storedDays(r.dates).filter((d) => s.dates.includes(d)) }))
    .filter((x) => x.kept.length !== storedDays(x.r.dates).length);
  await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE tournaments SET name = ?, size = ?, courts = ?, minutes = ?, start_minutes = ?, ticket_cents = ?, champion_credit_cents = ?, offered_dates = ?,
           visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ?
         WHERE id = ? AND group_id = ?`,
      )
      .bind(s.name, s.size, s.courts, s.minutes, s.start, s.ticketCents, s.creditCents, JSON.stringify(s.dates), s.visibility, s.visibility, ctx.nowIso, ctx.nowIso, t.id, group.id),
    ...trims.map((x) => ctx.db.prepare('UPDATE tournament_signups SET dates = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(x.kept), ctx.nowIso, x.r.id)),
  ]);
  await audit(ctx.db, group.id, null, 'tournament_edited', { tournament: s.name }, ctx.nowIso);
  if (s.visibility !== (t.visibility === 'all' ? 'all' : 'me')) await audit(ctx.db, group.id, null, s.visibility === 'all' ? 'tournament_shown' : 'tournament_hidden', { tournament: s.name }, ctx.nowIso);
  return { ok: true };
}

/** PUT /api/admin/tournament/:id/visibility { visibility }: Only me or Everyone (also the player page's "Show to everyone"). */
export async function setTournamentVisibility(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const visibility = v.oneOf(body.visibility, 'visibility', ['me', 'all'] as const);
  await ctx.db
    .prepare("UPDATE tournaments SET visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ? WHERE id = ?")
    .bind(visibility, visibility, ctx.nowIso, ctx.nowIso, t.id)
    .run();
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
  await ctx.db.batch([
    ctx.db.prepare('UPDATE tournament_signups SET approved_level = ?, updated_at = ? WHERE id = ?').bind(level, ctx.nowIso, row.id),
    ctx.db
      .prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'organizer', ?)")
      .bind(newId(), t.id, playerId, level, ctx.nowIso),
    ctx.db.prepare('UPDATE tournaments SET updated_at = ? WHERE id = ?').bind(ctx.nowIso, t.id),
  ]);
  await audit(ctx.db, group.id, null, 'tournament_level', { tournament: t.name, player: row.display_name, playerId, level: levelShort(level) }, ctx.nowIso);
  return { ok: true, level };
}

/** PUT /api/admin/tournament/:id/date { date }: pick the date (an offered one), or null to go back to picking. */
export async function setTournamentDate(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (body.date === null) {
    await ctx.db.prepare("UPDATE tournaments SET status = 'signup', final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ?").bind(ctx.nowIso, t.id).run();
    if (t.final_date) await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: null }, ctx.nowIso);
    return { ok: true, date: null };
  }
  const date = body.date;
  if (typeof date !== 'string' || !storedDays(t.offered_dates).includes(date)) bad('invalid_date', 'Pick one of the dates you offered.');
  await ctx.db
    .prepare("UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ?, updated_at = ? WHERE id = ?")
    .bind(date, ctx.nowIso, ctx.nowIso, t.id)
    .run();
  await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: dayLong(date as string), day: date }, ctx.nowIso);
  return { ok: true, date };
}

/** POST /api/admin/tournament/:id/cancel: the tournament is over before it started (piece 1: nothing was paid). The list is kept. */
export async function cancelTournament(ctx: Ctx) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  await ctx.db.prepare("UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?").bind(ctx.nowIso, ctx.nowIso, t.id).run();
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
  const dates = readDates(body, openDatesOf(t));
  const before = await mySignup(ctx.db, t.id, playerId);
  const levelChanged = !before || before.picked_level !== level || before.status !== 'in';
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, backed_out_at)
         VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?, NULL)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           joined_at = CASE WHEN tournament_signups.status = 'in' THEN tournament_signups.joined_at ELSE excluded.joined_at END,
           status = 'in', picked_level = excluded.picked_level, dates = excluded.dates, updated_at = excluded.updated_at, backed_out_at = NULL`,
      )
      .bind(newId(), t.id, playerId, level, JSON.stringify(dates), ctx.nowIso, ctx.nowIso, ctx.nowIso),
    ...(levelChanged
      ? [
          ctx.db
            .prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)")
            .bind(newId(), t.id, playerId, level, ctx.nowIso),
        ]
      : []),
  ]);
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
  const dates = body.dates === undefined ? storedDays(before.dates) : readDates(body, openDatesOf(t));
  await ctx.db.batch([
    ctx.db.prepare('UPDATE tournament_signups SET picked_level = ?, dates = ?, updated_at = ? WHERE id = ?').bind(level, JSON.stringify(dates), ctx.nowIso, before.id),
    ...(level !== before.picked_level
      ? [
          ctx.db
            .prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)")
            .bind(newId(), t.id, playerId, level, ctx.nowIso),
        ]
      : []),
  ]);
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
