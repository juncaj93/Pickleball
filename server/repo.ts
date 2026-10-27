import { planSessions } from '../shared/schedule';
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
  payment_amount_cents: number | null;
  promoted_at: string | null;
  promotion_reason: 'made_six' | 'spot_opened' | null;
  promotion_notified_at: string | null;
  refunded_at: string | null;
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
  const planned = planSessions(nowMs, group.timezone, settings.horizonWeeks);
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

export async function loadSessions(db: D1Database, groupId: string, endsAfterIso: string): Promise<SessionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND ends_at > ? ORDER BY starts_at')
    .bind(groupId, endsAfterIso)
    .all<SessionRow>();
  return results;
}

export async function loadRosters(db: D1Database, groupId: string, endsAfterIso: string): Promise<Map<string, RosterRow[]>> {
  const { results } = await db
    .prepare(
      `SELECT sp.*, p.display_name, p.phone_number
       FROM session_players sp
       JOIN sessions s ON s.id = sp.session_id
       JOIN players p ON p.id = sp.player_id
       WHERE s.group_id = ? AND s.ends_at > ?`,
    )
    .bind(groupId, endsAfterIso)
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
 * What each confirmed player owes: the same flat price whether 4 or 6 play.
 * Canceled sessions owe nothing.
 */
export function sharesFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): Map<string, number> {
  const shares = new Map<string, number>();
  if (session.status === 'canceled') return shares;
  for (const r of confirmedOf(roster)) shares.set(r.player_id, settings.pricePerPlayerCents);
  return shares;
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
