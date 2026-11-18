import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { organizerSignedIn } from './zip13';
import { audit, type GroupRow, organizerIdOf } from './repo';
import { localParts } from '../shared/time';
import { formatPrice } from '../shared/money';
import {
  type AdminTicketView,
  type PlayerTicketsView,
  type TicketPlaceView,
  DEFAULT_FORMAT,
  FORMATS,
  formatLocked,
  type TournamentFormat,
  type AdminTournamentView,
  cleanDays,
  dayKey,
  dayLong,
  isLevel,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  MAX_SPOTS,
  NAME_MAX,
  NIGHT_END_MINUTES,
  NIGHT_START_MINUTES,
  organizerCost,
  prizeCentsOf,
  smartPlan,
  STORED_PLAN,
  type PlayerTournamentView,
  TOURNAMENTS,
  tournamentsAllowed,
  type TournamentStatus,
  type Visibility,
} from '../shared/tournament';
import { defaultPayBy, payByLabel, startMsOf, ticketOwed, ticketPaid } from '../shared/tournamentTickets';
import { fillSpotsStatement, loadTickets, offList, organizerSeatStatement, sqlText, ticketBackStatements, ticketOf, type TicketWithName, tournamentCanceled } from './tournamentMoney';

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
  /** Zip 56 (migration 0024): when ticket money is due; NULL until tickets first open. Missing on a database before 0024. */
  pay_by?: string | null;
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
  /** The level the player picked first for this tournament (the level history), or null for none: it stays theirs (Alex). */
  first_level: number | null;
}

/** SQL over a sign-up alias: the level this player picked first for this tournament (their own picks in the level history, oldest first). */
const FIRST_LEVEL_SQL = (s: string) =>
  `(SELECT h.level FROM tournament_level_history h WHERE h.tournament_id = ${s}.tournament_id AND h.player_id = ${s}.player_id AND h.set_by = 'player' ORDER BY h.created_at, h.rowid LIMIT 1)`;

/** The stages a tournament is open in: piece 1's two, then piece 2's (Zip 56) tickets and rescheduled. Later pieces add theirs here. */
const OPEN = "('signup', 'date_picked', 'tickets', 'rescheduled')";

/**
 * Zip 56: a canceled tournament keeps a plain Canceled card (organizer Home, and the players who were on the list) for this many days, never
 * past its picked date, and only when it got that far (a date picked or tickets open); piece 1's early cancel still just hides it.
 */
export const CANCELED_DAYS = 7;
const canceledFrom = (nowMs: number) => new Date(nowMs - CANCELED_DAYS * 86_400_000).toISOString();
/** SQL: a canceled tournament that still shows its Canceled card (?2: the cutoff). `t`: the table's alias, or '' for none. */
const shownCanceled = (t = '') => `(${t}status = 'canceled' AND ${t}canceled_at >= ?2 AND (${t}final_date IS NOT NULL OR ${t}pay_by IS NOT NULL))`;

/** The group's open tournament, or null. Null too while the tables do not exist yet. (Create's "one at a time" and every organizer save.) */
export async function activeTournament(db: D1Database, groupId: string): Promise<TournamentRow | null> {
  return db
    .prepare(`SELECT * FROM tournaments WHERE group_id = ? AND status IN ${OPEN} ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<TournamentRow>()
    .catch(() => null);
}

/** Its picked date has passed (Eastern): a canceled one stops showing then. */
const datePassed = (t: TournamentRow, today: string) => !!t.final_date && t.final_date < today;

/**
 * What the organizer's screens show (Zip 56): the open tournament, else one canceled in the last CANCELED_DAYS days (its plain Canceled card),
 * in ONE read.
 */
export async function shownTournament(db: D1Database, group: GroupRow, nowMs: number): Promise<TournamentRow | null> {
  // A canceled one with an I paid still waiting stays until the organizer answers it (only confirmed money becomes credit), whatever its age.
  const waiting = "EXISTS (SELECT 1 FROM tournament_tickets k WHERE k.tournament_id = tournaments.id AND k.claim_cents > 0)";
  const row = await db
    .prepare(
      `SELECT *, (status = 'canceled' AND ${waiting}) AS claims_waiting FROM tournaments
       WHERE group_id = ?1 AND (status IN ${OPEN} OR ${shownCanceled()} OR (status = 'canceled' AND ${waiting}))
       ORDER BY CASE WHEN status = 'canceled' THEN 1 ELSE 0 END, created_at DESC LIMIT 1`,
    )
    .bind(group.id, canceledFrom(nowMs))
    .first<TournamentRow & { claims_waiting: number }>()
    .catch(() => null);
  if (!row) return null;
  const { claims_waiting: claims, ...t } = row;
  if (t.status === 'canceled' && !claims && datePassed(t, todayKey(nowMs, group.timezone))) return null;
  return t;
}

/** Zip 56: a canceled tournament still has an I paid waiting for the organizer's answer (Create waits for it: nowhere else would show it). */
async function canceledClaimWaiting(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id WHERE t.group_id = ? AND t.status = 'canceled' AND k.claim_cents > 0 LIMIT 1")
    .bind(groupId)
    .first()
    .catch(() => null);
  return !!row;
}

/**
 * The same read for a player's phone, in the SAME single trip: on an Only me tournament it also brings the two facts that decide whether this
 * player is the organizer's own (the organizer's saved player still exists; this player's name). So Only me costs any player exactly the trips
 * of "none open" (nothing to time), whether the organizer's player is saved by id or matched by name. Zip 56: a recently canceled one too
 * (open ones first), with whether this player was on its list (only they see the Canceled card), still in the same one trip.
 */
async function activeTournamentForPlayer(
  db: D1Database,
  group: GroupRow,
  playerId: string,
  nowMs: number,
): Promise<(TournamentRow & { org_saved: string | null; viewer_name: string | null; my_signup: string | null }) | null> {
  return db
    .prepare(
      `SELECT t.*,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT id FROM players WHERE id = ?3 AND group_id = t.group_id) END AS org_saved,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT display_name FROM players WHERE id = ?4 AND group_id = t.group_id) END AS viewer_name,
         CASE WHEN t.status = 'canceled' THEN (SELECT status FROM tournament_signups WHERE tournament_id = t.id AND player_id = ?4) ELSE NULL END AS my_signup
       FROM tournaments t WHERE t.group_id = ?1 AND (t.status IN ${OPEN} OR ${shownCanceled('t.')})
       ORDER BY CASE WHEN t.status = 'canceled' THEN 1 ELSE 0 END, t.created_at DESC LIMIT 1`,
    )
    .bind(group.id, canceledFrom(nowMs), group.organizer_player_id ?? '', playerId)
    .first<TournamentRow & { org_saved: string | null; viewer_name: string | null; my_signup: string | null }>()
    .catch(() => null);
}

async function signupRows(db: D1Database, tournamentId: string): Promise<SignupRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, p.display_name, p.is_active, ${FIRST_LEVEL_SQL('s')} AS first_level FROM tournament_signups s JOIN players p ON p.id = s.player_id
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

const STATUSES: readonly TournamentStatus[] = ['signup', 'date_picked', 'tickets', 'rescheduled', 'canceled'];
export const statusOf = (t: TournamentRow): TournamentStatus => (STATUSES.find((s) => s === t.status) ?? 'signup');

/** The date is set (picked, or tickets open on it): sign-up and Edit offer only that one date. */
const dateFixed = (t: TournamentRow) => (statusOf(t) === 'date_picked' || statusOf(t) === 'tickets') && !!t.final_date;

/** Zip 56: tickets have been open at some point (Pay by is set): the price, size, format and Who can see it stay as they are. */
export const ticketsEverOpened = (t: TournamentRow): boolean => !!t.pay_by;

/**
 * Zip 56 (review): players may hold tickets: tickets have been open while Everyone could see it. Then the price, the format and Everyone stay
 * (Everyone with tickets open never goes back to Only me, so "on Everyone now, and tickets have been open" says it). On Only me nobody but the
 * organizer can see it or take a ticket (their own seat is $0), so the organizer's private test keeps every setting free.
 */
export const playersHoldTickets = (t: TournamentRow): boolean => (formatLocked(t.status) || ticketsEverOpened(t)) && t.visibility === 'all';

/**
 * The dates a player can pick now: every offered date from today on while sign-up is open (also after a Reschedule); only the picked one once
 * it is picked (and while tickets are open on it). A day that has passed is never a choice (so the list can be empty: every offered date, or
 * the picked one, has passed). `today`: the Eastern calendar day ('YYYY-MM-DD'). A canceled tournament offers none.
 */
export function openDatesOf(t: TournamentRow, today: string): string[] {
  if (statusOf(t) === 'canceled') return [];
  const days = dateFixed(t) ? [t.final_date as string] : storedDays(t.offered_dates);
  return days.filter((d) => d >= today);
}

/**
 * Zip 56: the tournament night (ms), or null without a date: 7:00 PM (the earliest a plan starts) to 10:00 PM (the venue closes) on the picked
 * date, Eastern. The plan itself moves with the players (shared/tournament.ts smartPlan), so the site's rules use the whole window: ticket taps
 * stop at its start, and a hold that never got a spot comes back after its end.
 */
export function nightOf(t: TournamentRow, tz: string): { start: number; end: number } | null {
  if (!t.final_date) return null;
  return { start: startMsOf(t.final_date, NIGHT_START_MINUTES, tz), end: startMsOf(t.final_date, NIGHT_END_MINUTES, tz) };
}

/** The players locked in (a spot, still on the list): what the smart plan follows. */
export const lockedCount = (tickets: readonly { place: string; signup_status: string }[]): number =>
  tickets.filter((k) => k.place === 'spot' && k.signup_status === 'in').length;

/** Ticket sales are closed: the tournament night has started. */
export const salesClosed = (t: TournamentRow, tz: string, nowMs: number) => {
  const n = nightOf(t, tz);
  return !!n && nowMs >= n.start;
};

/** The tournament night is over (10:00 PM on the date): it has been played, so nothing gives its tickets back any more. */
export const nightOver = (t: TournamentRow, tz: string, nowMs: number) => {
  const n = nightOf(t, tz);
  return !!n && nowMs >= n.end;
};

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
  const row = await activeTournamentForPlayer(ctx.db, group, playerId, ctx.nowMs);
  if (!row) return null;
  const { org_saved: orgSaved, viewer_name: viewerName, my_signup: mySignupStatus, ...t } = row;
  // Zip 56: a canceled tournament's plain card is only for the players who were on its list, and only until its date has passed.
  if (statusOf(t) === 'canceled' && (mySignupStatus !== 'in' || datePassed(t, todayKey(ctx.nowMs, group.timezone)))) return null;
  // Zip 56 (review): a played night's "Tickets closed" card goes from the day after its date (game day, piece 3, will say how it went). The
  // organizer's Home still has it, and its first read after 10:00 PM gives any unused hold back.
  if (statusOf(t) === 'tickets' && datePassed(t, todayKey(ctx.nowMs, group.timezone))) return null;
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

/** The picked date as the screens show it: once picked, while tickets are open on it, and on a canceled tournament's card. */
const shownDate = (t: TournamentRow): string | null => (statusOf(t) === 'date_picked' || statusOf(t) === 'tickets' || statusOf(t) === 'canceled' ? t.final_date : null);

/**
 * Zip 56 (Alex, after testing piece 1): picking the date opens tickets. A tournament whose date was picked before that rule (piece 1, by the
 * organizer's own test on live) opens them the first time a screen reads it, exactly as a date pick does now: Pay by two days before at 7:00 PM,
 * the organizer's $0 seat. Only before its night starts. A read with the read-only PIN writes nothing, so it waits for the next real reader.
 */
async function upgradeDatePicked(ctx: Ctx, group: GroupRow, t: TournamentRow): Promise<TournamentRow> {
  if (t.status !== 'date_picked' || !t.final_date) return t;
  const night = nightOf(t, group.timezone);
  if (!night || ctx.nowMs >= night.start) return t;
  try {
    const org = await organizerIdOf(ctx.db, group);
    const payBy = defaultPayBy(t.final_date, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
    // Only while the tournament is exactly as this screen read it (the stage, the date, who can see it): the answer is then this row with tickets
    // open, so nobody is shown anything a change in between (Only me, Cancel) took away. Anything else: this screen shows what it read.
    const [res] = await ctx.db.batch([
      ctx.db
        .prepare("UPDATE tournaments SET status = 'tickets', pay_by = ?, updated_at = ? WHERE id = ? AND status = 'date_picked' AND final_date = ? AND visibility = ?")
        .bind(payBy, ctx.nowIso, t.id, t.final_date, t.visibility),
      ...(org ? [organizerSeatStatement(ctx.db, t.id, org, ctx.nowIso)] : []),
      fillSpotsStatement(ctx.db, t.id, ctx.nowIso),
    ]);
    if ((res.meta?.changes ?? 0) !== 1) return t;
    // The same History line a date pick writes now.
    await audit(ctx.db, group.id, null, 'tournament_tickets_opened', { tournament: t.name, date: dayLong(t.final_date), priceCents: t.ticket_cents, payBy: payByLabel(payBy, group.timezone, t.final_date) }, ctx.nowIso);
    return { ...t, status: 'tickets', pay_by: payBy, updated_at: ctx.nowIso };
  } catch {
    return t;
  }
}

/** GET /api/group `tournament`: this player's card, or null (then the answer has no `tournament` key at all). */
export async function playerTournamentFor(ctx: Ctx, group: GroupRow, playerId: string | null, viewAs: boolean): Promise<PlayerTournamentView | null> {
  if (!playerId) return null;
  const seen = await visibleTo(ctx, group, playerId, viewAs);
  if (!seen) return null;
  const { onlyMe } = seen;
  const t = await upgradeDatePicked(ctx, group, seen.t);
  const all = await signupRows(ctx.db, t.id);
  const rows = all.filter((r) => r.status === 'in' && r.is_active === 1);
  const mine = rows.find((r) => r.player_id === playerId) ?? null;
  // Off the list after signing up before: their first level stays theirs (Alex), so Sign up skips the level step.
  const before = mine ? null : (all.find((r) => r.player_id === playerId) ?? null);
  // Zip 56: the tickets (once they have opened), and the smart plan they decide: the start time and the hours players see.
  const tickets = ticketsEverOpened(t) && statusOf(t) !== 'canceled' ? await returnUnusedHolds(ctx, group, t, await loadTickets(ctx.db, t.id)) : [];
  const plan = smartPlan(lockedCount(tickets));
  const base: PlayerTournamentView = {
    id: t.id,
    name: t.name,
    format: formatOf(t),
    status: statusOf(t),
    start: plan.start,
    minutes: plan.minutes,
    openDates: openDatesOf(t, todayKey(ctx.nowMs, group.timezone)),
    finalDate: shownDate(t),
    names: rows.map((r) => r.display_name),
    // Their own pick only (never the organizer's level for them).
    me: mine ? { level: mine.picked_level, dates: storedDays(mine.dates) } : null,
    ...(before ? { lockedLevel: before.first_level ?? before.picked_level } : {}),
    ...(onlyMe ? { onlyMe: true as const } : {}),
  };
  // Zip 56: the plain Canceled card, with what came back to this player.
  if (statusOf(t) === 'canceled') return { ...base, canceled: await canceledMoneyOf(ctx.db, t.id, playerId) };
  // Piece 1's stage (tickets never opened) sends what it did.
  if (!ticketsEverOpened(t)) return base;
  return { ...base, tickets: await playerTicketsView(ctx, t, tickets, playerId, group) };
}

/** Zip 56: the ticket part of one player's card: names only for everyone else, their own money only. */
async function playerTicketsView(ctx: Ctx, t: TournamentRow, tickets: TicketWithName[], playerId: string, group: GroupRow): Promise<PlayerTicketsView> {
  const listed = tickets.filter((k) => k.signup_status === 'in');
  const me = (k: TicketWithName) => (k.player_id === playerId ? { me: true as const } : {});
  const money = (k: TicketWithName) => ({ priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents });
  const own = tickets.find((k) => k.player_id === playerId) ?? null;
  const locked = lockedCount(tickets);
  return {
    // The spots players see: the planned size (Alex's smart plan); every spot is taken only at 12.
    size: smartPlan(locked).size,
    full: locked >= MAX_SPOTS,
    // The organizer pays the venue, never the group: their own seat is $0 (the organizer found as the site always finds them, saved or by name).
    priceCents: own ? own.price_cents : playerId === (await organizerIdOf(ctx.db, group)) ? 0 : t.ticket_cents,
    payBy: statusOf(t) === 'tickets' ? (t.pay_by ?? null) : null,
    closed: statusOf(t) === 'tickets' && salesClosed(t, group.timezone, ctx.nowMs),
    locked: listed.filter((k) => k.place === 'spot').map((k) => ({ name: k.display_name, ...me(k) })),
    line: listed.filter((k) => k.place === 'line').map((k) => ({ name: k.display_name, paid: ticketPaid(money(k)), ...me(k) })),
    mine: own
      ? { place: placeOf(own), creditCents: own.credit_cents, paidCents: own.paid_cents, claimCents: own.claim_cents, owedCents: ticketOwed(money(own)) }
      : null,
  };
}

const placeOf = (k: { place: string }): TicketPlaceView => (k.place === 'spot' || k.place === 'line' ? k.place : 'none');

/**
 * Zip 56: what a cancel gave back to this player (the plain Canceled card): the cash that became credit and the credit that went back to the
 * pot, both written by the cancel, and an I paid still waiting for the organizer. One small read, only on a canceled tournament's card.
 */
async function canceledMoneyOf(db: D1Database, tournamentId: string, playerId: string): Promise<{ backCents: number; claimCents: number }> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'kept' AND reason = ?2) +
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'used' AND reason = ?3 AND ended_reason = 'canceled') AS back,
         (SELECT COALESCE(SUM(claim_cents), 0) FROM tournament_tickets WHERE tournament_id = ?4 AND player_id = ?1) AS claim`,
    )
    .bind(playerId, `tour:${tournamentId}:cancel`, `tour:${tournamentId}`, tournamentId)
    .first<{ back: number; claim: number }>()
    .catch(() => null);
  return { backCents: row?.back ?? 0, claimCents: row?.claim ?? 0 };
}

/**
 * Zip 56: a hold that never got a spot comes back as credit once the tournament night is over (10:00 PM on its date, nightOf):
 * every ticket in line or not placed, with credit or confirmed cash on it and no I paid waiting, by the site's own credit rules (credit used goes
 * back to the pot, cash becomes a credit entry). Done by the first screen that reads the tournament after that moment (a player's, the
 * organizer's, or a 5-second check), in one all-or-nothing batch that a second reader finds nothing left to do in. A read with the read-only
 * PIN writes nothing (server/viewOnly.ts), so it waits for the next real reader. Returns the tickets as they are now.
 */
async function returnUnusedHolds(ctx: Ctx, group: GroupRow, t: TournamentRow, tickets: TicketWithName[]): Promise<TicketWithName[]> {
  if (statusOf(t) !== 'tickets') return tickets;
  const night = nightOf(t, group.timezone);
  if (!night || ctx.nowMs < night.end) return tickets;
  const due = tickets.filter((k) => k.place !== 'spot' && k.claim_cents === 0 && (k.credit_cents > 0 || k.paid_cents > 0));
  if (due.length === 0) return tickets;
  const endIso = new Date(night.end).toISOString();
  const when = (x: string) =>
    `(${x}.place <> 'spot' AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${x}.tournament_id AND tt.status = 'tickets') AND ${sqlText(ctx.nowIso)} >= ${sqlText(endIso)})`;
  try {
    const res = await ctx.db.batch(ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId: null, why: 'unused', endedReason: 'canceled', nowIso: ctx.nowIso, when }));
    if ((res[2]?.meta?.changes ?? 0) > 0) {
      await audit(ctx.db, group.id, null, 'tournament_holds_returned', { tournament: t.name, count: due.length, amountCents: due.reduce((s, k) => s + k.credit_cents + k.paid_cents, 0) }, ctx.nowIso);
    }
  } catch {
    return tickets;
  }
  return loadTickets(ctx.db, t.id);
}

/** The organizer's view of the open tournament (dashboard `tournament`), else of one canceled lately (its Canceled card), or null. */
export async function adminTournamentFor(ctx: Ctx, group: GroupRow): Promise<AdminTournamentView | null> {
  const shown = await shownTournament(ctx.db, group, ctx.nowMs);
  if (!shown) return null;
  const t = await upgradeDatePicked(ctx, group, shown);
  const rows = (await signupRows(ctx.db, t.id)).filter((r) => r.is_active === 1);
  const tickets = ticketsEverOpened(t) ? await returnUnusedHolds(ctx, group, t, await loadTickets(ctx.db, t.id)) : [];
  const tz = group.timezone;
  // The organizer, as the site always finds them (saved, or by the name in Settings): their seat is the $0 one.
  const orgId = tickets.length ? await organizerIdOf(ctx.db, group) : group.organizer_player_id;
  // Alex's smart plan: the players locked in decide the planned size, the courts and the hours; the organizer's cost follows.
  const locked = tickets.filter((k) => k.place === 'spot' && k.signup_status === 'in');
  const plan = smartPlan(locked.length);
  const paidNow = locked.filter((k) => k.player_id !== orgId && k.price_cents > 0).length;
  const prize = prizeCentsOf(formatOf(t), t.champion_credit_cents, t.second_credit_cents ?? 0);
  return {
    id: t.id,
    name: t.name,
    format: formatOf(t),
    // Zip 56: once players may hold tickets (tickets open on Everyone) the format, the price and Everyone stay (also after a Reschedule).
    formatLocked: playersHoldTickets(t),
    settingsLocked: playersHoldTickets(t),
    payBy:
      statusOf(t) === 'tickets' ? (t.pay_by ?? null) : statusOf(t) === 'date_picked' && t.final_date ? defaultPayBy(t.final_date, NIGHT_START_MINUTES, tz, ctx.nowMs) : null,
    closed: salesClosed(t, tz, ctx.nowMs),
    over: nightOver(t, tz, ctx.nowMs),
    tickets: tickets.map(
      (k): AdminTicketView => ({
        playerId: k.player_id,
        name: k.display_name,
        place: placeOf(k),
        placeAt: k.place_at,
        priceCents: k.price_cents,
        creditCents: k.credit_cents,
        paidCents: k.paid_cents,
        claimCents: k.claim_cents,
        claimAt: k.claim_at,
        out: k.signup_status !== 'in',
        organizer: !!orgId && k.player_id === orgId,
      }),
    ),
    canceledAt: t.canceled_at,
    status: statusOf(t),
    visibility: t.visibility === 'all' ? 'all' : 'me',
    size: plan.size,
    courts: plan.courts,
    minutes: plan.minutes,
    start: plan.start,
    cost: { ...organizerCost(plan, t.ticket_cents, prize, paidNow), paidNow },
    ticketCents: t.ticket_cents,
    championCreditCents: t.champion_credit_cents,
    secondCreditCents: t.second_credit_cents ?? 0,
    offeredDates: storedDays(t.offered_dates),
    finalDate: shownDate(t),
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
export async function organizerOn(ctx: Ctx): Promise<GroupRow> {
  const group = await requireAdmin(ctx);
  if (!(await tournamentsFlags(ctx, group.id)).on) throw new HttpError(403, 'tournaments_off', 'Tournaments are switched off.');
  return group;
}

export async function openById(ctx: Ctx, group: GroupRow): Promise<TournamentRow> {
  const id = v.id(ctx.params.id, 'tournament');
  const t = await activeTournament(ctx.db, group.id);
  if (!t || t.id !== id) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return t;
}

/** Only an open tournament is ever changed: a save racing a Cancel changes nothing and says "look again". */
export const OPEN_GUARD = `AND status IN ${OPEN}`;
/** Zip 56: the date step (pick a date, take it back) is open before tickets open, and again after a Reschedule. */
const DATE_GUARD = "AND status IN ('signup', 'date_picked', 'rescheduled')";
export const changedOrLookAgain = (res: { meta?: { changes?: number } }) => {
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
  ticketCents: number;
  creditCents: number;
  secondCreditCents: number;
  format: TournamentFormat;
  visibility: Visibility;
}

/**
 * The Create (and Edit) screen's fields, checked. `keep`: dates already offered, which may stay even once they are in the past. Alex (after
 * testing piece 1): no players expected and no court plan any more; the smart plan follows the players locked in (shared/tournament.ts), and a
 * size or plan sent by an older screen is ignored.
 */
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
  return {
    name,
    dates: dates!,
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
  if (await canceledClaimWaiting(ctx.db, group.id)) throw new HttpError(409, 'claim_waiting', 'Answer the I paid waiting on the canceled tournament first.');
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, shown_at, format, second_credit_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'signup', ?, ?, ?, ?, ?, ?)`,
      )
      // The size and plan columns are NOT NULL; no screen asks for them now: they hold harmless defaults (the 12-spot cap and the whole night).
      .bind(id, group.id, s.name, STORED_PLAN.size, STORED_PLAN.courts, STORED_PLAN.minutes, STORED_PLAN.start, s.ticketCents, s.creditCents, JSON.stringify(s.dates), s.visibility, ctx.nowIso, ctx.nowIso, s.visibility === 'all' ? ctx.nowIso : null, s.format, s.secondCreditCents)
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
  const s = readSettings(body, group, ctx.nowMs, offered);
  // A save that leaves the format or the 2nd place credit out keeps what the tournament has (only Create starts them at their defaults).
  if (body.format === undefined) s.format = formatOf(t);
  if (body.secondCreditCents === undefined) s.secondCreditCents = t.second_credit_cents ?? 0;
  // Once players may hold tickets (tickets open on Everyone, Zip 56), also after a Reschedule: the format, the price and Everyone stay (players
  // have paid that price, and a player who holds a ticket must always see it). On Only me nobody else can hold one: every setting stays free.
  const held = playersHoldTickets(t);
  if (s.format !== formatOf(t) && held) throw new HttpError(409, 'format_locked', 'Tickets are open. The format cannot change now.');
  if (held) {
    if (s.ticketCents !== t.ticket_cents) throw new HttpError(409, 'ticket_locked', `Tickets have been sold. The price stays ${formatPrice(t.ticket_cents)}.`);
    if (s.visibility !== 'all') throw new HttpError(409, 'visibility_locked', 'Players have tickets. It stays on Everyone.');
  }
  if (t.final_date && dateFixed(t) && !s.dates.includes(t.final_date)) {
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
        `UPDATE tournaments SET name = ?, ticket_cents = ?, champion_credit_cents = ?, offered_dates = ?,
           visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ?, format = ?, second_credit_cents = ?
         WHERE id = ? AND group_id = ? ${OPEN_GUARD} AND (final_date IS NULL OR final_date IN (SELECT value FROM json_each(?)))
           AND (pay_by IS NULL OR visibility = 'me' OR (ticket_cents = ? AND format = ? AND ? = 'all'))`,
      )
      .bind(s.name, s.ticketCents, s.creditCents, offer, s.visibility, s.visibility, ctx.nowIso, ctx.nowIso, s.format, s.secondCreditCents, t.id, group.id, offer, s.ticketCents, s.format, s.visibility),
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
  // Zip 56: once tickets have been open on Everyone, players may hold tickets: it stays on Everyone (a player must always see a ticket they hold).
  // Tickets open on Only me (the date picked on the organizer's private test): Everyone is one tap, and Only me stays free until then.
  if (visibility === 'me' && playersHoldTickets(t)) throw new HttpError(409, 'visibility_locked', 'Players have tickets. It stays on Everyone.');
  changedOrLookAgain(
    await ctx.db
      .prepare(`UPDATE tournaments SET visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ? WHERE id = ? ${OPEN_GUARD} AND (? = 'all' OR pay_by IS NULL OR visibility = 'me')`)
      .bind(visibility, visibility, ctx.nowIso, ctx.nowIso, t.id, visibility)
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
  // Zip 56: once tickets are open the date stays; Cancel or reschedule changes it (Reschedule goes back to this step).
  if (statusOf(t) === 'tickets') throw new HttpError(409, 'tickets_open', 'Tickets are open. Reschedule to change the date.');
  if (body.date === null) {
    // Back to picking. A tournament that has had tickets goes back to Rescheduled (players keep seeing "Pick your dates again").
    changedOrLookAgain(
      await ctx.db
        .prepare(`UPDATE tournaments SET status = CASE WHEN pay_by IS NOT NULL THEN 'rescheduled' ELSE 'signup' END, final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ? ${DATE_GUARD}`)
        .bind(ctx.nowIso, t.id)
        .run(),
    );
    if (t.final_date) await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: null }, ctx.nowIso);
    return { ok: true, date: null };
  }
  const date = body.date;
  if (typeof date !== 'string' || !storedDays(t.offered_dates).includes(date)) bad('invalid_date', 'Pick one of the dates you offered.');
  if ((date as string) < todayKey(ctx.nowMs, group.timezone)) bad('invalid_date', 'That date has passed. Pick another one.');
  if (ctx.nowMs >= startMsOf(date as string, NIGHT_START_MINUTES, group.timezone)) bad('invalid_date', 'That night has started. Pick another date.');
  // Zip 56 (Alex): picking the date opens tickets, for everyone on the list, in the same tap: Pay by starts at two days before at 7:00 PM (the
  // organizer can change it), the organizer's own $0 seat is taken when they are on the list. No other trigger.
  const payBy = defaultPayBy(date as string, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
  const org = await organizerIdOf(ctx.db, group);
  const res = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE tournaments SET status = 'tickets', final_date = ?, date_picked_at = ?, pay_by = ?, updated_at = ?
         WHERE id = ? ${DATE_GUARD} AND EXISTS (SELECT 1 FROM json_each(tournaments.offered_dates) WHERE value = ?)`,
      )
      .bind(date, ctx.nowIso, payBy, ctx.nowIso, t.id, date),
    ...(org ? [organizerSeatStatement(ctx.db, t.id, org, ctx.nowIso)] : []),
    fillSpotsStatement(ctx.db, t.id, ctx.nowIso),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: dayLong(date as string), day: date }, ctx.nowIso);
  await audit(ctx.db, group.id, null, 'tournament_tickets_opened', { tournament: t.name, date: dayLong(date as string), priceCents: t.ticket_cents, payBy: payByLabel(payBy, group.timezone, date as string) }, ctx.nowIso);
  return { ok: true, date, payBy };
}

/**
 * POST /api/admin/tournament/:id/cancel: the tournament is over before it started. The list is kept. Zip 56: every paid ticket comes back as
 * credit in the SAME all-or-nothing batch (credit used goes back to the pot, confirmed cash becomes a credit entry), once and only once: a second
 * tap finds it canceled and changes nothing. An I paid still waiting stays as it is until the organizer answers it (then it becomes credit).
 */
export async function cancelTournament(ctx: Ctx) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  // Once the night is over it has been played: Cancel would give every ticket back (review, Zip 56). Piece 3's End tournament closes it.
  if (nightOver(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tournament_played', 'The tournament night is over. It cannot be canceled now.');
  const before = ticketsEverOpened(t) ? await loadTickets(ctx.db, t.id) : [];
  const [res] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, ctx.nowIso, t.id),
    ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId: null, why: 'cancel', endedReason: 'canceled', nowIso: ctx.nowIso, when: tournamentCanceled }),
  ]);
  changedOrLookAgain(res);
  const back = before.filter((k) => k.claim_cents === 0 && k.credit_cents + k.paid_cents > 0);
  const returnedCents = back.reduce((s, k) => s + k.credit_cents + k.paid_cents, 0);
  const waiting = before.filter((k) => k.claim_cents > 0).length;
  await audit(
    ctx.db,
    group.id,
    null,
    'tournament_canceled',
    { tournament: t.name, ...(back.length ? { returned: back.length, amountCents: returnedCents } : {}), ...(waiting ? { waiting } : {}) },
    ctx.nowIso,
  );
  return { ok: true, returned: back.length, returnedCents, waiting };
}

// ---------------------------------------------------------------------------------------------------------------------
// The player's taps (sign up, edit, back out). Only on a tournament this player may see; never in View as on the live site (the demo copy only).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentActor {
  group: GroupRow;
  playerId: string | null;
  viewAsName: string | null;
}

export async function playerTarget(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>): Promise<{ t: TournamentRow; playerId: string }> {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const seen = await visibleTo(ctx, who.group, who.playerId, !!who.viewAsName);
  // The same answer for "none", "switched off", "Only me" and (Zip 56) a canceled one: nothing leaks through an error either.
  if (!seen || statusOf(seen.t) === 'canceled') throw new HttpError(404, 'tournament_not_open', 'This tournament is not open.');
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
export async function logPlayer(ctx: Ctx, group: GroupRow, playerId: string, action: string, details: Record<string, unknown>) {
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  await audit(ctx.db, group.id, null, action, { player: name, playerId, ...details }, ctx.nowIso, name);
}

export async function mySignup(db: D1Database, tournamentId: string, playerId: string) {
  return db
    .prepare('SELECT id, status, picked_level, dates FROM tournament_signups WHERE tournament_id = ? AND player_id = ?')
    .bind(tournamentId, playerId)
    .first<{ id: string; status: string; picked_level: number; dates: string }>();
}

/**
 * POST /api/tournament/signup { tournamentId, level, dates }: on the list (again, after a back out: at the end of it). Alex (after testing
 * piece 1): a player picks their level ONCE. Someone who signs up again (after Drop out or Back out) keeps the level they picked first (the
 * level history), whatever this tap sends, and the organizer's level for them stays; only the organizer changes a level (the pencil).
 */
export async function playerTournamentSignup(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const first = await ctx.db
    .prepare("SELECT level FROM tournament_level_history WHERE tournament_id = ? AND player_id = ? AND set_by = 'player' ORDER BY created_at, rowid LIMIT 1")
    .bind(t.id, playerId)
    .first<{ level: number }>();
  if (!first && !isLevel(body.level)) bad('invalid_level', 'Pick your level.');
  const level = first ? first.level : (body.level as number);
  const dates = readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  const before = await mySignup(ctx.db, t.id, playerId);
  // A second tap of Sign up (or another phone) with exactly the same answers: nothing to save, nothing to write in History.
  if (before && before.status === 'in' && JSON.stringify(storedDays(before.dates)) === JSON.stringify(dates)) return { ok: true, result: 'signed_up' };
  const [, listRow] = await ctx.db.batch([
    // The level history gets the pick only the first time (first in the batch, so the list row below reads it).
    ctx.db
      .prepare(
        `INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) SELECT ?, ?, ?, ?, 'player', ? WHERE ${UNCHANGED}
           AND NOT EXISTS (SELECT 1 FROM tournament_level_history WHERE tournament_id = ? AND player_id = ? AND set_by = 'player')`,
      )
      .bind(newId(), t.id, playerId, level, ctx.nowIso, ...unchangedValues(t), t.id, playerId),
    // The list row's level is the FIRST one in the level history, read when the batch lands: two first sign-ups from two phones at once both end
    // on the one that landed first. The organizer's level for them stays as it is.
    ctx.db
      .prepare(
        `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, backed_out_at)
         SELECT ?1, ?2, ?3, 'in',
           COALESCE((SELECT level FROM tournament_level_history WHERE tournament_id = ?2 AND player_id = ?3 AND set_by = 'player' ORDER BY created_at, rowid LIMIT 1), ?4),
           NULL, ?5, ?6, ?6, ?6, NULL WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ?7 AND status = ?8 AND offered_dates = ?9 AND final_date IS ?10)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           joined_at = CASE WHEN tournament_signups.status = 'in' THEN tournament_signups.joined_at ELSE excluded.joined_at END,
           status = 'in', picked_level = excluded.picked_level, dates = excluded.dates, updated_at = excluded.updated_at, backed_out_at = NULL`,
      )
      .bind(newId(), t.id, playerId, level, JSON.stringify(dates), ctx.nowIso, ...unchangedValues(t)),
    // Zip 56: the organizer signing up while tickets are open takes their own $0 seat at once (a spot if one is open, else first paid in line).
    ...(statusOf(t) === 'tickets' && playerId === (await organizerIdOf(ctx.db, who.group))
      ? [organizerSeatStatement(ctx.db, t.id, playerId, ctx.nowIso), fillSpotsStatement(ctx.db, t.id, ctx.nowIso)]
      : []),
  ]);
  changedOrLookAgain(listRow);
  if (!before || before.status !== 'in') {
    // The level as it landed (a first pick from another phone that landed just before this one wins).
    const stored = first ? null : await mySignup(ctx.db, t.id, playerId);
    await logPlayer(ctx, who.group, playerId, 'tournament_signup', { tournament: t.name, level: levelShort(stored?.picked_level ?? level) });
  } else await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'signed_up' };
}

/**
 * PUT /api/tournament/signup { tournamentId, dates }: Edit sign-up. Alex (after testing piece 1): DATES only. The level was picked once at
 * sign-up; only the organizer changes it (a `level` sent by an older screen is ignored).
 */
export async function playerTournamentEdit(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') throw new HttpError(409, 'not_signed_up', 'You are not on the list. Sign up first.');
  const dates = body.dates === undefined ? storedDays(before.dates) : readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  if (JSON.stringify(dates) === JSON.stringify(storedDays(before.dates))) return { ok: true, result: 'saved' };
  const res = await ctx.db
    .prepare(`UPDATE tournament_signups SET dates = ?, updated_at = ? WHERE id = ? AND status = 'in' AND ${UNCHANGED}`)
    .bind(JSON.stringify(dates), ctx.nowIso, before.id, ...unchangedValues(t))
    .run();
  changedOrLookAgain(res);
  await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'saved' };
}

/**
 * POST /api/tournament/back-out { tournamentId, backCents? }: off the list (the row stays, so their level stays with this tournament).
 * Zip 56: their ticket comes back as credit in the SAME all-or-nothing batch (credit used goes back to the pot, confirmed cash becomes a credit
 * entry), the spot opens, and the first PAID person in line takes it. An I paid still waiting stays until the organizer answers it (then it
 * becomes credit). `backCents`: what the Back out? sheet said comes back; if the ticket changed since, nothing moves ("look again"). A second
 * tap finds them off the list and moves nothing. From the start of the tournament night a ticket that holds a spot or money stays (ask Alex).
 */
export async function playerTournamentBackOut(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') return { ok: true, result: 'not_signed_up' };
  const k = ticketsEverOpened(t) ? await ticketOf(ctx.db, t.id, playerId) : null;
  const holds = !!k && (k.place === 'spot' || k.credit_cents + k.paid_cents + k.claim_cents > 0);
  if (holds && salesClosed(t, who.group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', `The tournament has started. Ask ${firstName(who.group)}.`);
  if (body.backCents !== undefined) {
    const shown = v.cents(body.backCents, 'backCents') ?? 0;
    if (shown !== (k ? k.credit_cents + k.paid_cents + k.claim_cents : 0)) throw new HttpError(409, 'amount_changed', 'Your ticket just changed. Look again.');
  }
  // The money-back statements always run (they do nothing without a ticket): a Lock that lands between the read above and this batch still has
  // its money come back (review, Zip 56). Never after a Cancel: that already gave every ticket back.
  const res = await ctx.db.batch([
    ctx.db
      .prepare(
        "UPDATE tournament_signups SET status = 'out', backed_out_at = ?, updated_at = ? WHERE id = ? AND status = 'in' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status <> 'canceled')",
      )
      .bind(ctx.nowIso, ctx.nowIso, before.id, t.id),
    ...(ticketsEverOpened(t)
      ? [
          ...ticketBackStatements(ctx.db, { groupId: who.group.id, tournamentId: t.id, playerId, why: 'back', endedReason: 'dropped', nowIso: ctx.nowIso, when: offList }),
          fillSpotsStatement(ctx.db, t.id, ctx.nowIso),
        ]
      : []),
  ]);
  if ((res[0].meta?.changes ?? 0) === 0) return { ok: true, result: 'not_signed_up' };
  // What this very batch moved (the ledger rows it wrote at this moment), and what waits for the organizer's answer to an I paid.
  const moved = ticketsEverOpened(t) ? await movedBack(ctx.db, t.id, playerId, 'back', 'dropped', ctx.nowIso) : { cash: 0, credit: 0, waiting: 0 };
  const { waiting, cash, credit } = moved;
  await logPlayer(ctx, who.group, playerId, 'tournament_back_out', {
    tournament: t.name,
    ...(cash + credit > 0 ? { amountCents: cash + credit } : {}),
    ...(waiting ? { waitingCents: waiting } : {}),
  });
  // creditBackCents: cash that became credit; creditReturnedCents: credit that went back; waitingCents: held until the organizer answers an I paid.
  return { ok: true, result: 'backed_out', creditBackCents: cash, creditReturnedCents: credit, waitingCents: waiting };
}

/**
 * Zip 56: what a money-back batch moved for one player, read from the rows it wrote at that moment (`nowIso`): cash that became a credit entry,
 * credit that went back to the pot, and the money still on a ticket whose I paid waits for the organizer.
 */
export async function movedBack(db: D1Database, tournamentId: string, playerId: string, why: 'back' | 'off', endedReason: 'dropped', nowIso: string) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'kept' AND reason = ?2 AND created_at = ?4) AS cash,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'used' AND reason = ?3 AND ended_at = ?4 AND ended_reason = ?5) AS credit,
         (SELECT COALESCE(SUM(credit_cents + paid_cents + claim_cents), 0) FROM tournament_tickets WHERE tournament_id = ?6 AND player_id = ?1 AND claim_cents > 0) AS waiting`,
    )
    .bind(playerId, `tour:${tournamentId}:${why}`, `tour:${tournamentId}`, nowIso, endedReason, tournamentId)
    .first<{ cash: number; credit: number; waiting: number }>();
  return { cash: Number(row?.cash ?? 0), credit: Number(row?.credit ?? 0), waiting: Number(row?.waiting ?? 0) };
}

/** The organizer's first name for the players' words ("Ask Alex"), or "the organizer". */
export function firstName(group: GroupRow): string {
  return (group.organizer_name ?? '').trim().split(/\s+/)[0] || 'the organizer';
}

// ---------------------------------------------------------------------------------------------------------------------
// View as (server/zip18.ts): the organizer's in-browser copy gets the tournament rows too, only while the switch is on (off: nothing new).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentTables {
  tournaments: Record<string, unknown>[];
  tournament_signups: Record<string, unknown>[];
  tournament_level_history: Record<string, unknown>[];
  /** Zip 56: the tickets (missing from an older server's answer). */
  tournament_tickets?: Record<string, unknown>[];
}

export async function tournamentTablesFor(db: D1Database, groupId: string): Promise<TournamentTables | null> {
  // Zip 56: the tickets too (a database before 0024 has none: the three tables alone, as before).
  const tickets = await db
    .prepare('SELECT k.* FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id WHERE t.group_id = ? ORDER BY k.created_at, k.id')
    .bind(groupId)
    .all<Record<string, unknown>>()
    .then((r) => r.results)
    .catch(() => null);
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
      ...(tickets ? { tournament_tickets: tickets } : {}),
    };
  } catch {
    return null;
  }
}
