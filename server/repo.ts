import { allocateCredits, type Due, type OpenCredit, type SeatPrice, seatPrices } from '../shared/pricing';
import { planSessions } from '../shared/schedule';
import { zonedTimeToUtc } from '../shared/time';
import { type GroupSettings, normalizeSettings } from '../shared/settings';
import type { AdminDecision, BookingStatus, SessionRecordStatus, StatusInput } from '../shared/status';
import type { PaymentStatus, RosterStatus } from '../shared/api';
import { newId } from './crypto';
import type { D1Database } from './db';
import { isPretend } from './pretend';

export interface GroupRow {
  id: string;
  name: string;
  timezone: string;
  group_key: string;
  admin_pin_hash: string;
  venmo_url: string | null;
  settings_json: string;
  created_at: string;
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
  planned_starts_at: string | null;
  six_reached_at: string | null;
  six_drop_resolved_at: string | null;
  credits_issued_at: string | null;
  court_number: string | null; // no longer shown or changed
  court_state: 'waitlist' | 'opened' | 'not_opened' | null;
  shown_early: number;
  holiday_hours_ok_at: string | null;
  day_before_done_at: string | null;
  last_call_done_at: string | null;
  /** 1 for a one-off game the organizer added. */
  is_extra: number;
  note: string | null;
  updated_at: string;
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
  display_name: string;
  phone_number: string | null;
}

export function settingsOf(group: GroupRow): GroupSettings {
  try {
    return normalizeSettings(JSON.parse(group.settings_json));
  } catch {
    return normalizeSettings({});
  }
}

/** One group per deployment. */
export async function getGroup(db: D1Database): Promise<GroupRow | null> {
  return db.prepare('SELECT * FROM groups ORDER BY created_at LIMIT 1').first<GroupRow>();
}

export async function getPlayers(db: D1Database, groupId: string): Promise<PlayerRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM players WHERE group_id = ? ORDER BY sort_order, display_name')
    .bind(groupId)
    .all<PlayerRow>();
  return results;
}

export async function getSession(db: D1Database, groupId: string, sessionId: string): Promise<SessionRow | null> {
  return db.prepare('SELECT * FROM sessions WHERE id = ? AND group_id = ?').bind(sessionId, groupId).first<SessionRow>();
}

/**
 * Create any missing Tue/Thu sessions inside the rolling horizon. Safe to
 * call on every page load: it only inserts slots that don't exist yet, and
 * the unique (group_id, planned_starts_at) key blocks duplicates even if two
 * loads race. Slots are matched on planned_starts_at, so a session the
 * organizer moved to another time is never re-created in its old slot.
 */
export async function ensureSessions(db: D1Database, group: GroupRow, nowMs: number): Promise<number> {
  const settings = settingsOf(group);
  const firstStart = visibleFrom(group);
  const planned = planSessions(nowMs, group.timezone, settings.horizonWeeks).filter((p) => p.startsAt >= firstStart);
  if (planned.length === 0) return 0;
  const { results } = await db
    .prepare('SELECT planned_starts_at FROM sessions WHERE group_id = ? AND planned_starts_at >= ?')
    .bind(group.id, planned[0].startsAt)
    .all<{ planned_starts_at: string }>();
  const existing = new Set(results.map((r) => r.planned_starts_at));
  const missing = planned.filter((p) => !existing.has(p.startsAt));
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

export async function loadSessions(db: D1Database, groupId: string, endsAfterIso: string, startsFromIso = '0000'): Promise<SessionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND ends_at > ? AND (starts_at >= ? OR shown_early = 1) ORDER BY starts_at')
    .bind(groupId, endsAfterIso, startsFromIso)
    .all<SessionRow>();
  return results;
}

export async function loadRosters(
  db: D1Database,
  groupId: string,
  endsAfterIso: string,
  startsFromIso = '0000',
): Promise<Map<string, RosterRow[]>> {
  const { results } = await db
    .prepare(
      `SELECT sp.*, p.display_name, p.phone_number
       FROM session_players sp
       JOIN sessions s ON s.id = sp.session_id
       JOIN players p ON p.id = sp.player_id
       WHERE s.group_id = ? AND s.ends_at > ? AND (s.starts_at >= ? OR s.shown_early = 1)`,
    )
    .bind(groupId, endsAfterIso, startsFromIso)
    .all<RosterRow>();
  const map = new Map<string, RosterRow[]>();
  for (const r of results) {
    const list = map.get(r.session_id) ?? [];
    list.push(r);
    map.set(r.session_id, list);
  }
  return map;
}

export async function loadRoster(db: D1Database, sessionId: string): Promise<RosterRow[]> {
  const { results } = await db
    .prepare(
      `SELECT sp.*, p.display_name, p.phone_number
       FROM session_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ?`,
    )
    .bind(sessionId)
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
 * price, or price minus credit for the last two when exactly 6 are in.
 */
export function pricesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, SeatPrice> {
  return seatPrices(
    confirmedOf(roster).map((r) => ({ playerId: r.player_id, seq: r.confirm_seq ?? 0 })),
    settings,
    session.status === 'canceled',
  );
}

export function sharesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, number> {
  return new Map([...pricesFor(session, roster, settings)].map(([id, p]) => [id, p.cents]));
}

// ---------- Credits ----------

export interface CreditRow {
  id: string;
  player_id: string;
  earned_session_id: string;
  amount_cents: number;
  created_at: string;
  used_session_id: string | null;
  cleared_at: string | null;
  earned_ends_at: string;
}

export async function loadCredits(db: D1Database, groupId: string): Promise<CreditRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, s.ends_at AS earned_ends_at FROM credits c JOIN sessions s ON s.id = c.earned_session_id
       WHERE c.group_id = ? ORDER BY c.created_at`,
    )
    .bind(groupId)
    .all<CreditRow>();
  // Pretending it's later: credits that would have been issued by then, in memory only.
  if (isPretend(db)) return [...results, ...([...db.virtualCredits.values()] as unknown as CreditRow[])];
  return results;
}

/** Credits not yet used on a session and not cleared by the organizer. */
export function openCredits(credits: CreditRow[]): OpenCredit[] {
  return credits
    .filter((c) => !c.used_session_id && !c.cleared_at)
    .map((c) => ({ id: c.id, playerId: c.player_id, amountCents: c.amount_cents, earnedAfter: c.earned_ends_at }));
}

/**
 * After a session ends with exactly 6 playing, each of the first four earns
 * the credit. Runs on page loads like ensureSessions; each session is only
 * looked at once, and the unique (session, player) key blocks doubles.
 */
export async function issueCredits(db: D1Database, group: GroupRow, nowMs: number): Promise<number> {
  const settings = settingsOf(group);
  const nowIso = new Date(nowMs).toISOString();
  const { results } = await db
    .prepare(
      `SELECT * FROM sessions WHERE group_id = ? AND credits_issued_at IS NULL AND ends_at <= ? AND (starts_at >= ? OR shown_early = 1)`,
    )
    .bind(group.id, nowIso, visibleFrom(group))
    .all<SessionRow>();
  let issued = 0;
  for (const s of results) {
    const stmts = [];
    if (s.status !== 'canceled' && settings.creditCentsWhenSix > 0) {
      for (const [playerId, price] of pricesFor(s, await loadRoster(db, s.id), settings)) {
        if (!price.creditComing) continue;
        if (isPretend(db)) {
          const id = `pretend-${s.id}-${playerId}`;
          db.virtualCredits.set(id, {
            id,
            group_id: group.id,
            player_id: playerId,
            earned_session_id: s.id,
            amount_cents: settings.creditCentsWhenSix,
            created_at: nowIso,
            used_session_id: null,
            used_at: null,
            cleared_at: null,
            earned_ends_at: s.ends_at,
          });
          issued++;
          continue;
        }
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO credits (id, group_id, player_id, earned_session_id, amount_cents, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(newId(), group.id, playerId, s.id, settings.creditCentsWhenSix, nowIso),
        );
        issued++;
      }
    }
    stmts.push(db.prepare('UPDATE sessions SET credits_issued_at = ? WHERE id = ? AND credits_issued_at IS NULL').bind(nowIso, s.id));
    await db.batch(stmts);
  }
  return issued;
}

/**
 * Remember when a session reaches 6 (the discount was shown), so a later
 * drop below 6 can show the organizer a "sort it out" card.
 */
export async function syncSix(db: D1Database, sessionId: string, nowIso: string): Promise<void> {
  const six = `(SELECT COUNT(*) FROM session_players WHERE session_id = ?2 AND status = 'confirmed') = 6`;
  await db
    .prepare(
      `UPDATE sessions SET
         six_reached_at = CASE WHEN ${six} THEN COALESCE(six_reached_at, ?1) ELSE six_reached_at END,
         six_drop_resolved_at = CASE WHEN ${six} THEN NULL ELSE six_drop_resolved_at END
       WHERE id = ?2`,
    )
    .bind(nowIso, sessionId)
    .run();
}

/**
 * Which credits come off which unpaid seats, keyed `${sessionId}:${playerId}`.
 * Paid seats keep whatever was used when they were marked paid.
 */
export function creditPlan(
  sessions: SessionRow[],
  rosters: Map<string, RosterRow[]>,
  credits: CreditRow[],
  settings: GroupSettings,
): Map<string, { cents: number; ids: string[] }> {
  const dues: Due[] = [];
  for (const s of sessions) {
    const roster = rosters.get(s.id) ?? [];
    const prices = pricesFor(s, roster, settings);
    for (const r of roster) {
      const price = prices.get(r.player_id);
      if (price && r.status === 'confirmed' && r.payment_status === 'unpaid') {
        dues.push({ sessionId: s.id, playerId: r.player_id, startsAt: s.starts_at, cents: price.cents });
      }
    }
  }
  return allocateCredits(openCredits(credits), dues);
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
 * someone still owes for an older game, so unpaid amounts never drop off.
 */
export async function lookbackIso(db: D1Database, groupId: string, nowMs: number, defaultMs: number): Promise<string> {
  const usual = new Date(nowMs - defaultMs).toISOString();
  const row = await db
    .prepare(
      `SELECT MIN(s.ends_at) AS oldest FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND s.status <> 'canceled' AND sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.ends_at <= ?`,
    )
    .bind(groupId, usual)
    .first<{ oldest: string | null }>();
  // Sessions are loaded with ends_at > since, so step just before the oldest.
  return row?.oldest ? new Date(Date.parse(row.oldest) - 1).toISOString() : usual;
}
