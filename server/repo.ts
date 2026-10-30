import { type SeatPrice, seatPrices } from '../shared/pricing';
import { planSessions } from '../shared/schedule';
import { zonedTimeToUtc } from '../shared/time';
import { type GroupSettings, normalizeSettings } from '../shared/settings';
import type { AdminDecision, BookingStatus, SessionRecordStatus, StatusInput } from '../shared/status';
import type { PaymentStatus, RosterStatus } from '../shared/api';
import { newId } from './crypto';
import type { D1Database } from './db';

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

/**
 * The organizer's own player record, without making one: the saved id if it
 * still points at a player, else the player whose name matches the organizer
 * name in Settings. Null when there is none. The organizer pays the venue
 * themselves, so this person is never counted as a player who owes.
 */
export async function organizerIdOf(db: D1Database, group: Pick<GroupRow, 'id' | 'organizer_player_id' | 'organizer_name'>): Promise<string | null> {
  if (group.organizer_player_id) {
    const p = await db
      .prepare('SELECT id FROM players WHERE id = ? AND group_id = ?')
      .bind(group.organizer_player_id, group.id)
      .first<{ id: string }>();
    if (p) return p.id;
  }
  const name = (group.organizer_name ?? '').trim().toLowerCase();
  if (!name) return null;
  const all = await getPlayers(db, group.id);
  return all.find((x) => x.display_name.trim().toLowerCase() === name)?.id ?? null;
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
 * price until the game is finalized, then the final price for those who
 * played (nothing for those who did not). Nobody owes for a canceled game.
 */
export function pricesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, SeatPrice> {
  return seatPrices(
    confirmedOf(roster).map((r) => ({ playerId: r.player_id, played: r.played })),
    settings.pricePerPlayerCents,
    session.status === 'canceled',
    session.finalized_at ? { priceCents: session.final_price_cents ?? settings.pricePerPlayerCents } : null,
  );
}

/** What the venue charges for a session: the cost on the booking, else the typical court cost. */
export function courtCostOf(session: Pick<SessionRow, 'court_cost_cents'>, settings: GroupSettings): number {
  return session.court_cost_cents ?? settings.typicalCourtCostCents;
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
 * Activity log entry made when the game was canceled; the latest entry wins,
 * so canceling again after a reopen replaces it. Only amounts above $0.
 */
export async function loadCancelCharges(db: D1Database, groupId: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare("SELECT session_id, details_json FROM admin_audit_log WHERE group_id = ? AND action = 'session_canceled' AND session_id IS NOT NULL ORDER BY created_at, rowid")
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
