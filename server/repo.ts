import { type SeatPrice, seatPrices } from '../shared/pricing';
import { type GamePrice, gameMinutes, gamePrice, lengthRow } from '../shared/gameLength';
import { planSessions } from '../shared/schedule';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { type GroupSettings, normalizeSettings } from '../shared/settings';
import type { AdminDecision, BookingStatus, SessionRecordStatus, StatusInput } from '../shared/status';
import type { PaymentStatus, RosterStatus } from '../shared/api';
import { newId } from './crypto';
import { zip9Allowed } from '../shared/zip9';
import { bookingHoursAllowed } from '../shared/bookingHours';
import { lateFeeKind, lateFeePriceCents } from '../shared/lateFees';
import { OPEN_FEE } from './lateFees';
import type { D1Database, D1PreparedStatement } from './db';

export interface GroupRow {
  id: string;
  name: string;
  timezone: string;
  group_key: string;
  admin_pin_hash: string;
  venmo_url: string | null;
  settings_json: string;
  created_at: string;
  /** NOT a column: this request's "Short games" answer (server/zip9.ts withShortGames), carried to settingsOf(group).shortGames. */
  short_games?: boolean;
  /** NOT a column: this request's Booking hours row answer (server/bookingHours.ts longGamesOn, set by withShortGames), carried to settingsOf(group).longGames. */
  long_games?: boolean;
  /** NOT a column: this request's "Card cleanup" answer (server/zip10.ts withCardCleanup), carried to settingsOf(group).noCap. */
  card_cleanup?: boolean;
  organizer_name: string | null;
  venue_name: string | null;
  venue_address: string | null;
  first_session_date: string | null;
  open_access: number;
  group_word_hash: string | null;
  calendar_token: string | null;
  /** The organizer's own player record (made the first time they tap I'm in). */
  organizer_player_id: string | null;
}

export interface PlayerRow {
  id: string;
  group_id: string;
  display_name: string;
  phone_number: string | null;
  is_regular: number;
  is_active: number;
  can_receive_substitute_invites: number;
  sort_order: number;
  usual_days: string;
  self_added_at: string | null;
  is_new: number;
  calendar_token: string | null;
  calendar_off: number;
  /** Organizer only: Venmo username (or "id:123") for refunds. Never sent to players. */
  venmo_handle: string | null;
}

export interface SessionRow {
  id: string;
  group_id: string;
  starts_at: string;
  ends_at: string;
  status: SessionRecordStatus;
  venue_name: string | null;
  venue_booking_url: string | null;
  reservation_reference: string | null;
  booking_status: BookingStatus;
  court_cost_cents: number | null;
  cancellation_deadline_at: string | null;
  admin_decision: AdminDecision;
  decision_at: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  /** Why the organizer canceled, up to 40 characters. Null when none was given or the game is not canceled. */
  cancel_reason: string | null;
  planned_starts_at: string | null;
  six_reached_at: string | null;
  six_drop_resolved_at: string | null;
  credits_issued_at: string | null;
  court_number: string | null; // no longer shown or changed
  court_state: 'waitlist' | 'opened' | 'not_opened' | null;
  /** Zip 14 (migration 0017): which court, 1 to 16, or null (not set). Optional: a database before 0017 has no such column. */
  court?: number | null;
  shown_early: number;
  holiday_hours_ok_at: string | null;
  day_before_done_at: string | null;
  last_call_done_at: string | null;
  /** 1 for a one-off game the organizer added. */
  is_extra: number;
  note: string | null;
  /** The organizer finalized who played: when, the final price each, how many played. */
  finalized_at: string | null;
  final_price_cents: number | null;
  final_played_count: number | null;
  updated_at: string;
  /** When the game was made (Zip 15 reads it: a game added on its own day). Every SELECT * has it. */
  created_at?: string;
  /** Zip 27 (A-01): the price rules this game was finalized under, as written down in task_log (priceLockCol). Only loaders that ask for it have it. */
  price_lock?: string | null;
}

export interface RosterRow {
  id: string;
  session_id: string;
  player_id: string;
  status: RosterStatus;
  claimed_at: string;
  claim_seq: number;
  confirmed_at: string | null;
  confirm_seq: number | null;
  attendance_confirmed_at: string | null;
  payment_status: PaymentStatus;
  paid_at: string | null;
  /** The player marked it paid themselves ("I paid"). */
  self_paid_at: string | null;
  payment_amount_cents: number | null;
  promoted_at: string | null;
  promotion_reason: 'made_six' | 'spot_opened' | null;
  promotion_notified_at: string | null;
  refunded_at: string | null;
  late_drop_at: string | null;
  late_drop_done_at: string | null;
  /** Once finalized: 1 played, 0 did not. */
  played: number | null;
  /** "Time may shift": the start time they agreed to and when (shared/timeShift.ts). NULL: the current time. Missing before migration 0016. */
  time_confirmed?: string | null;
  display_name: string;
  phone_number: string | null;
}

export function settingsOf(group: GroupRow): GroupSettings {
  let out: GroupSettings;
  try {
    out = normalizeSettings(JSON.parse(group.settings_json));
  } catch {
    out = normalizeSettings({});
  }
  // "Short games" on for this request (server/zip9.ts): only then is the key there, so with it off the settings are exactly as before.
  if (group.short_games === true) out.shortGames = true;
  // "Booking hours" row on for everyone (Zip 24): the 2.5 and 3 hour length rows price those games. Only there while on, so off the settings are exactly as before.
  if (group.long_games === true) out.longGames = true;
  // "Card cleanup" on for this request (server/zip10.ts): no Max players cap and no waitlist (capOf, shared/settings.ts). Off: not there.
  if (group.card_cleanup === true) out.noCap = true;
  return out;
}

/**
 * One game's price (shared/gameLength.ts): Settings > Money for a normal game and for every game while "Short games" is off;
 * the game-length table row for a 1.5 hour game while it is on. Every server price path goes through this.
 */
export function priceOf(session: PricedGame, settings: GroupSettings): GamePrice {
  // Zip 27 (A-01): a game that was finalized keeps the price rules it was finalized under, whatever a switch or Settings > Money says later.
  return lockedPrice(session) ?? gamePrice({ startsAt: session.starts_at, endsAt: session.ends_at }, settings, settings.shortGames === true, settings.longGames === true);
}

/** What priceOf needs from a game: its times, and the lock when the loader read it. */
export type PricedGame = Pick<SessionRow, 'starts_at' | 'ends_at'> & { price_lock?: string | null };

// ---------- Zip 27 (A-01): a finalized game keeps its price rules ----------
// When the organizer finalizes a game, the price rules it was finalized under are written down: the up-front price, the court cost and which
// length row (1.5, 2.5 or 3 hours) priced it, or none (Settings > Money). They go in task_log (kind 'mark', task 'price_lock', the game's
// own row, the numbers in `detail`), so there is no schema change. Every price path reads a game through priceOf, which uses the lock first,
// so turning Short games or Booking hours off, or changing "Typical court cost" or "Price per player", never re-prices a finalized game:
// Money > Totals, a Reopen and redo, and a no-show debt keep the numbers the game had when it was finalized.
// Games finalized before Zip 27, and canceled games (their fee and their charged court), get their lock written right before any of those
// switches or settings change (lockFinalizedGames), from the rules they show at that moment, so nothing they show changes either.
// A lock only counts while the game is still the same length (a game cannot be moved once it started, so in practice it always is).
// Not in backup files (task_log is not, docs/RESTORE.md): after a restore from a file the games follow the switches again, as before Zip 27.

export const PRICE_LOCK_TASK = 'price_lock';

/** The lock as SQL, for a SELECT over `alias` (a sessions row): `SELECT *, ${priceLockCol('sessions')} FROM sessions ...`. */
export const priceLockCol = (alias: string) =>
  // "kind IN ('mark', 'sent')" repeats the partial index's own condition (task_log_once), so SQLite uses that index: one row read per game,
  // never a scan of the whole task_log.
  `(SELECT pl.detail FROM task_log pl WHERE pl.session_id = ${alias}.id AND pl.task = '${PRICE_LOCK_TASK}' AND pl.kind IN ('mark', 'sent') AND pl.kind = 'mark') AS price_lock`;

interface PriceLock {
  /** The game's length when it was locked. */
  m: number;
  /** The up-front price, in cents. */
  flat: number;
  /** The court cost when the booking has none typed in, in cents. */
  court: number;
  /** The length row that priced it (90, 150, 180), or null: Settings > Money (floor(4 x flat / N)). */
  row: number | null;
}

/** The lock's words in task_log.detail. */
export function priceLockDetail(p: GamePrice): string {
  const lock: PriceLock = { m: p.minutes, flat: p.flatCents, court: p.courtCents, row: p.special && p.row ? p.row.minutes : null };
  return JSON.stringify(lock);
}

/** The price a lock gives, or null: no lock, an unreadable one, or the game is no longer that length. */
export function lockedPrice(session: PricedGame): GamePrice | null {
  if (!session.price_lock) return null;
  let lock: PriceLock;
  try {
    lock = JSON.parse(session.price_lock) as PriceLock;
  } catch {
    return null;
  }
  const minutes = gameMinutes(session.starts_at, session.ends_at);
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (!lock || lock.m !== minutes || !whole(lock.flat) || !whole(lock.court)) return null;
  if (lock.row === null || lock.row === undefined) return { minutes, special: false, row: null, flatCents: lock.flat, courtCents: lock.court };
  const row = lengthRow(lock.row);
  if (!row || row.minutes !== minutes) return null;
  return { minutes, special: true, row, flatCents: lock.flat, courtCents: lock.court };
}

/**
 * The statements that write a game's lock (delete the old one, insert this one), for the caller's batch. `guard` (SQL) limits them to the
 * batch's own change (the finalize it made). The lock goes on the game's own task_log row, so it is removed with the game.
 */
export function priceLockStatements(db: D1Database, groupId: string, sessionId: string, price: GamePrice, nowIso: string, guard = '1 = 1'): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM task_log WHERE session_id = ?1 AND task = '${PRICE_LOCK_TASK}' AND kind = 'mark' AND ${guard}`).bind(sessionId),
    db
      .prepare(`INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT ?1, ?2, ?3, '${PRICE_LOCK_TASK}', 'mark', ?4, ?5 WHERE ${guard}`)
      .bind(newId(), groupId, sessionId, priceLockDetail(price), nowIso),
  ];
}

/**
 * Writes the lock of every finalized or canceled game that has none yet (a canceled game can still hold a fee, and Totals counts its
 * court the venue charged; a Reopen of a canceled game takes its lock away again), from the price rules it shows right now (`settings`: the rules for EVERYONE,
 * never one phone's private test link). Called right before a switch or a Settings > Money value that changes prices is changed, so a game
 * finalized before Zip 27 keeps exactly what it showed. Returns how many it locked.
 */
export async function lockFinalizedGames(db: D1Database, groupId: string, settings: GroupSettings, nowIso: string): Promise<number> {
  const { results } = await db.prepare(UNLOCKED_GAMES_SQL).bind(groupId).all<SessionRow>();
  if (results.length === 0) return 0;
  // A few games per batch (a request has a limit on statements), and each lock only while its game is still finalized or canceled
  // (a Reopen of a canceled game landing in between keeps it unlocked).
  for (let i = 0; i < results.length; i += 20) {
    await db.batch(results.slice(i, i + 20).flatMap((s) => priceLockStatements(db, groupId, s.id, priceOf(s, settings), nowIso, stillSettled(s.id))));
  }
  return results.length;
}

/** The finalized or canceled games of a group (?1) that have no price lock yet. The deploy-time script (scripts/lock-finalized.ts) reads the same rows. */
export const UNLOCKED_GAMES_SQL = `SELECT * FROM sessions s WHERE s.group_id = ?1 AND (s.finalized_at IS NOT NULL OR s.status = 'canceled')
         AND NOT EXISTS (SELECT 1 FROM task_log t WHERE t.session_id = s.id AND t.task = '${PRICE_LOCK_TASK}' AND t.kind IN ('mark', 'sent') AND t.kind = 'mark')`;

/** SQL: the game is still finalized or canceled (a lock is written only then). */
export function stillSettled(sessionId: string): string {
  if (!/^[0-9A-Za-z-]+$/.test(sessionId)) throw new Error('unsafe sql text');
  return `EXISTS (SELECT 1 FROM sessions g WHERE g.id = '${sessionId}' AND (g.finalized_at IS NOT NULL OR g.status = 'canceled'))`;
}

/**
 * The price rules for EVERYONE (Zip 27): Settings > Money, plus the "Short games" and "Booking hours" rows when their Settings row is on
 * and their wrangler.toml kill switch allows it. Never a phone's private test link. One place, for the site (server/admin.ts, right
 * before a price switch or money setting changes) and for the deploy-time lock (scripts/lock-finalized.ts).
 */
export function everyoneSettingsOf(group: GroupRow, rows: { shortGames: boolean; bookingHours: boolean }, env: { SHORT_GAMES?: string; BOOKING_HOURS?: string }): GroupSettings {
  const base = settingsOf({ ...group, short_games: false, long_games: false });
  const short = zip9Allowed(env.SHORT_GAMES) && rows.shortGames;
  const long = bookingHoursAllowed(env.BOOKING_HOURS) && rows.bookingHours;
  return { ...base, ...(short ? { shortGames: true as const } : {}), ...(long ? { longGames: true as const } : {}) };
}

/** A 1.5 hour game's own flat price ("Short games" on), for the words that would otherwise say $14; null for a normal game (nothing changes). */
export function specialFlatOf(session: PricedGame, settings: GroupSettings): number | null {
  const p = priceOf(session, settings);
  return p.special ? p.flatCents : null;
}

/** The flat price everyone in this game pays up front ($14 for a normal game, $11 for a 1.5 hour game with "Short games" on). */
export function flatOf(session: PricedGame, settings: GroupSettings): number {
  return priceOf(session, settings).flatCents;
}

/** One group per deployment. */
export async function getGroup(db: D1Database): Promise<GroupRow | null> {
  return db.prepare('SELECT * FROM groups ORDER BY created_at LIMIT 1').first<GroupRow>();
}

/** A read, word for word, so SPEED_FEWER_QUERIES can send it early together with others (server/speed.ts prefetch). */
export interface ReadSpec {
  sql: string;
  values: unknown[];
}

/** Every game's id and start time (credit history lines name their game). */
export const sessionStartsRead = (groupId: string): ReadSpec => ({ sql: 'SELECT id, starts_at FROM sessions WHERE group_id = ?', values: [groupId] });

export const playersRead = (groupId: string): ReadSpec => ({ sql: 'SELECT * FROM players WHERE group_id = ? ORDER BY sort_order, display_name', values: [groupId] });

export async function getPlayers(db: D1Database, groupId: string): Promise<PlayerRow[]> {
  const r = playersRead(groupId);
  const { results } = await db
    .prepare(r.sql)
    .bind(...r.values)
    .all<PlayerRow>();
  return results;
}

/**
 * The organizer's own player record, without making one: the saved id if it
 * still points at a player, else the player whose name matches the organizer
 * name in Settings. Null when there is none. The organizer pays the venue
 * themselves, so this person is never counted as a player who owes.
 */
/** organizerIdOf's first read (only asked when the group has a saved organizer id). */
export const organizerIdRead = (group: Pick<GroupRow, 'id' | 'organizer_player_id'>): ReadSpec => ({ sql: 'SELECT id FROM players WHERE id = ? AND group_id = ?', values: [group.organizer_player_id, group.id] });

export async function organizerIdOf(db: D1Database, group: Pick<GroupRow, 'id' | 'organizer_player_id' | 'organizer_name'>): Promise<string | null> {
  if (group.organizer_player_id) {
    const r = organizerIdRead(group);
    const p = await db
      .prepare(r.sql)
      .bind(...r.values)
      .first<{ id: string }>();
    if (p) return p.id;
  }
  const name = (group.organizer_name ?? '').trim().toLowerCase();
  if (!name) return null;
  const all = await getPlayers(db, group.id);
  return all.find((x) => x.display_name.trim().toLowerCase() === name)?.id ?? null;
}

export async function getSession(db: D1Database, groupId: string, sessionId: string): Promise<SessionRow | null> {
  return db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE id = ? AND group_id = ?`)
    .bind(sessionId, groupId)
    .first<SessionRow>()
    .catch(() => db.prepare('SELECT * FROM sessions WHERE id = ? AND group_id = ?').bind(sessionId, groupId).first<SessionRow>());
}

/**
 * Create any missing Tue/Thu sessions inside the rolling horizon. Safe to
 * call on every page load: it only inserts slots that don't exist yet, and
 * the unique (group_id, planned_starts_at) key blocks duplicates even if two
 * loads race. Slots are matched by the calendar day of planned_starts_at,
 * so a session the organizer moved to another time is never re-created in
 * its old slot, and a new usual time in Settings only shapes games that
 * don't exist yet.
 */
export async function ensureSessions(db: D1Database, group: GroupRow, nowMs: number): Promise<number> {
  const settings = settingsOf(group);
  const firstStart = visibleFrom(group);
  const planned = planSessions(nowMs, group.timezone, settings.horizonWeeks, settings.defaultStartMinutes, settings.defaultEndMinutes).filter(
    (p) => p.startsAt >= firstStart,
  );
  if (planned.length === 0) return 0;
  // A regular game already planned for that calendar day, at whatever time, counts: changing the usual
  // time in Settings must never add a second game next to an existing one.
  const dayOf = (iso: string) => {
    const p = localParts(Date.parse(iso), group.timezone);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const { results } = await db
    .prepare('SELECT planned_starts_at FROM sessions WHERE group_id = ? AND planned_starts_at >= ?')
    .bind(group.id, new Date(Date.parse(planned[0].startsAt) - 86_400_000).toISOString())
    .all<{ planned_starts_at: string }>();
  const existing = new Set(results.map((r) => dayOf(r.planned_starts_at)));
  const missing = planned.filter((p) => !existing.has(dayOf(p.startsAt)));
  if (missing.length === 0) return 0;
  const now = new Date(nowMs).toISOString();
  await db.batch(
    missing.map((p) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO sessions (id, group_id, starts_at, ends_at, planned_starts_at, cancellation_deadline_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), group.id, p.startsAt, p.endsAt, p.startsAt, defaultDeadline(p.startsAt, settings), now, now),
    ),
  );
  return missing.length;
}

/** The cancellation deadline a new or moved session starts with. */
export function defaultDeadline(startsAtIso: string, settings: GroupSettings): string {
  return new Date(Date.parse(startsAtIso) - settings.defaultDeadlineHours * 3600_000).toISOString();
}

/**
 * Midnight (group time zone) of the first session date, as UTC. Sessions
 * starting earlier are never generated or shown. '0000' when no date is set.
 */
export function visibleFrom(group: Pick<GroupRow, 'first_session_date' | 'timezone'>): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(group.first_session_date ?? '');
  if (!m) return '0000';
  return new Date(zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, group.timezone)).toISOString();
}

export const sessionsRead = (groupId: string, endsAfterIso: string, startsFromIso = '0000'): ReadSpec => ({
  sql: `SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND ends_at > ? AND (starts_at >= ? OR shown_early = 1) ORDER BY starts_at`,
  values: [groupId, endsAfterIso, startsFromIso],
});

export async function loadSessions(db: D1Database, groupId: string, endsAfterIso: string, startsFromIso = '0000'): Promise<SessionRow[]> {
  const r = sessionsRead(groupId, endsAfterIso, startsFromIso);
  const { results } = await db
    .prepare(r.sql)
    .bind(...r.values)
    .all<SessionRow>()
    // No task_log table (a database from before migration 0015): the games without their price locks, exactly as before Zip 27.
    .catch(() => db.prepare(r.sql.replace(`, ${priceLockCol('sessions')}`, '')).bind(...r.values).all<SessionRow>());
  return results;
}

export const rostersRead = (groupId: string, endsAfterIso: string, startsFromIso = '0000'): ReadSpec => ({
  sql: `SELECT sp.*, p.display_name, p.phone_number
       FROM session_players sp
       JOIN sessions s ON s.id = sp.session_id
       JOIN players p ON p.id = sp.player_id
       WHERE s.group_id = ? AND s.ends_at > ? AND (s.starts_at >= ? OR s.shown_early = 1)`,
  values: [groupId, endsAfterIso, startsFromIso],
});

export async function loadRosters(
  db: D1Database,
  groupId: string,
  endsAfterIso: string,
  startsFromIso = '0000',
): Promise<Map<string, RosterRow[]>> {
  const r = rostersRead(groupId, endsAfterIso, startsFromIso);
  const { results } = await db
    .prepare(r.sql)
    .bind(...r.values)
    .all<RosterRow>();
  const map = new Map<string, RosterRow[]>();
  for (const r of results) {
    const list = map.get(r.session_id) ?? [];
    list.push(r);
    map.set(r.session_id, list);
  }
  return map;
}

export const rosterRead = (sessionId: string): ReadSpec => ({
  sql: `SELECT sp.*, p.display_name, p.phone_number
       FROM session_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ?`,
  values: [sessionId],
});

export async function loadRoster(db: D1Database, sessionId: string): Promise<RosterRow[]> {
  const r = rosterRead(sessionId);
  const { results } = await db
    .prepare(r.sql)
    .bind(...r.values)
    .all<RosterRow>();
  return results;
}

const byConfirmed = (a: RosterRow, b: RosterRow) => (a.confirm_seq ?? 0) - (b.confirm_seq ?? 0) || a.id.localeCompare(b.id);
const byClaimed = (a: RosterRow, b: RosterRow) => a.claim_seq - b.claim_seq || a.id.localeCompare(b.id);

/** Confirmed players in the order they got their spot. */
export function confirmedOf(roster: RosterRow[]): RosterRow[] {
  return roster.filter((r) => r.status === 'confirmed').sort(byConfirmed);
}

/** Waitlisted players, first come first served. */
export function waitlistOf(roster: RosterRow[]): RosterRow[] {
  return roster.filter((r) => r.status === 'waitlisted').sort(byClaimed);
}

/**
 * Each confirmed player's price for a session, before any credit: the flat
 * price until the game is finalized, then the final price for those who
 * played (nothing for those who did not). Nobody owes for a canceled game.
 */
export function pricesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, SeatPrice> {
  const flat = flatOf(session, settings);
  const out = seatPrices(
    confirmedOf(roster).map((r) => ({ playerId: r.player_id, played: r.played })),
    flat,
    session.status === 'canceled',
    session.finalized_at ? { priceCents: session.final_price_cents ?? flat } : null,
  );
  // An open late fee (shared/lateFees.ts) owes the flat price: a late drop that left the game short, a no-show with
  // fewer than 4 played, or a seat in a game canceled late that the venue charged. None exist unless LATE_FEES made
  // them. (Like every seat here, the organizer's is left for the caller to skip.)
  // A seat in a game canceled late with the fee split (LATE_FEE_SPLIT) owes the split price stored on the game instead.
  for (const r of roster) {
    const kind = lateFeeKind(r, session);
    if (kind) out.set(r.player_id, { cents: lateFeePriceCents(kind, session, flat) });
  }
  return out;
}

/** What the venue charges for a session: the cost on the booking, else the typical court cost (a 1.5 hour game's row with "Short games" on). */
export function courtCostOf(session: PricedGame & Pick<SessionRow, 'court_cost_cents'>, settings: GroupSettings): number {
  return session.court_cost_cents ?? priceOf(session, settings).courtCents;
}

export function sharesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, number> {
  return new Map([...pricesFor(session, roster, settings)].map(([id, p]) => [id, p.cents]));
}

/** Weekday numbers stored as '2,4'. */
export function usualDaysOf(p: Pick<PlayerRow, 'usual_days'>): number[] {
  return (p.usual_days ?? '')
    .split(',')
    .map(Number)
    .filter((d) => d === 2 || d === 4);
}

export function statusInput(session: SessionRow, roster: RosterRow[]): StatusInput {
  const confirmed = confirmedOf(roster);
  return {
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    status: session.status,
    bookingStatus: session.booking_status,
    courtState: session.court_state,
    cancellationDeadlineAt: session.cancellation_deadline_at,
    adminDecision: session.admin_decision,
    confirmedCount: confirmed.length,
    waitlistCount: waitlistOf(roster).length,
    unconfirmedAttendanceCount: confirmed.filter((r) => !r.attendance_confirmed_at).length,
  };
}

export async function audit(
  db: D1Database,
  groupId: string,
  sessionId: string | null,
  action: string,
  details: Record<string, unknown>,
  nowIso: string,
  actor = 'organizer',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), groupId, sessionId, actor, action, JSON.stringify(details), nowIso)
    .run();
}

/**
 * What the venue still charged for a game the organizer canceled close to
 * play ("Were you charged?" answered Yes), by session id. It is kept in the
 * Activity log entry made when the game was canceled, or by a later "Edit charge"
 * (action 'charge_edited', Money page rework); the latest entry wins, so canceling
 * again after a reopen, or editing the charge, replaces it. Only amounts above $0.
 */
export async function loadCancelCharges(db: D1Database, groupId: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT session_id, details_json FROM admin_audit_log WHERE group_id = ? AND action IN ('session_canceled', 'charge_edited') AND session_id IS NOT NULL ORDER BY created_at, rowid")
    .bind(groupId)
    .all<{ session_id: string; details_json: string }>();
  const out = new Map<string, number>();
  for (const r of results) {
    let cents = 0;
    try {
      const v = (JSON.parse(r.details_json) as { chargedCents?: unknown }).chargedCents;
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) cents = v;
    } catch {
      /* an unreadable entry charges nothing */
    }
    if (cents > 0) out.set(r.session_id, cents);
    else out.delete(r.session_id);
  }
  return out;
}

/** Sessions before the first session date that the organizer could still show. */
export async function loadHiddenSessions(db: D1Database, group: GroupRow, nowMs: number): Promise<SessionRow[]> {
  const from = visibleFrom(group);
  const { results } = await db
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND starts_at < ? AND starts_at > ? AND shown_early = 0 ORDER BY starts_at')
    .bind(group.id, from, new Date(nowMs).toISOString())
    .all<SessionRow>();
  return results;
}

/**
 * How far back to load sessions: `defaultMs` ago, or further back if
 * someone still owes for an older game or an "I paid" claim is unanswered,
 * so neither ever drops off.
 */
export const lookbackRead = (groupId: string, nowMs: number, defaultMs: number): ReadSpec => ({
  sql: `SELECT MIN(s.ends_at) AS oldest FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND s.ends_at <= ?
         AND ((s.status <> 'canceled' AND sp.status = 'confirmed' AND sp.payment_status = 'unpaid')
           -- an unanswered "I paid" claim (seat that left, or a canceled game) stays on the organizer's Home
           OR (sp.payment_status = 'paid' AND sp.refunded_at IS NULL AND sp.self_paid_at IS NOT NULL AND (sp.status <> 'confirmed' OR s.status = 'canceled'))
           -- an open late fee still owed (shared/lateFees.ts) stays on the player's Pay card and the organizer's Money tab
           OR (sp.payment_status = 'unpaid' AND ${OPEN_FEE('sp')}))`,
  values: [groupId, new Date(nowMs - defaultMs).toISOString()],
});

export async function lookbackIso(db: D1Database, groupId: string, nowMs: number, defaultMs: number): Promise<string> {
  const usual = new Date(nowMs - defaultMs).toISOString();
  const r = lookbackRead(groupId, nowMs, defaultMs);
  const row = await db
    .prepare(r.sql)
    .bind(...r.values)
    .first<{ oldest: string | null }>();
  // Sessions are loaded with ends_at > since, so step just before the oldest.
  return row?.oldest ? new Date(Date.parse(row.oldest) - 1).toISOString() : usual;
}
