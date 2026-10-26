import type { ActionLinkDraft, AdminDashboard, AuditEntry } from '../shared/api';
import { formatCents } from '../shared/money';
import { normalizeSettings } from '../shared/settings';
import { formatDateTime, formatShortDate, formatTimeRange } from '../shared/time';
import { adminLogin, adminLogout, requireAdmin, revokeAdminSessions, startAdminSession } from './auth';
import { ADMIN_COOKIE, clearCookie, type Ctx } from './context';
import { hashPin, newId, randomToken, verifyPin } from './crypto';
import { HttpError } from './http';
import {
  audit,
  confirmedOf,
  defaultDeadline,
  ensureSessions,
  getPlayers,
  getSession,
  type GroupRow,
  loadRoster,
  loadRosters,
  loadSessions,
  type SessionRow,
  settingsOf,
  sharesFor,
} from './repo';
import { confirmAttendance, joinSession, moveToWaitlist, withdraw } from './roster';
import { invalidateSessionTokens, issueToken } from './tokens';
import { adminPlayerView, adminSessionView, eligibleSubstitutes } from './views';
import * as v from './validate';

const HISTORY_MS = 90 * 86_400_000;

export async function login(ctx: Ctx, body: Record<string, unknown>) {
  if (typeof body.pin !== 'string' || body.pin.length > 20) throw new HttpError(401, 'wrong_pin', 'That PIN is not right.');
  await adminLogin(ctx, body.pin);
  return { ok: true };
}

export async function logout(ctx: Ctx) {
  await adminLogout(ctx);
  clearCookie(ctx, ADMIN_COOKIE);
  return { ok: true };
}

export async function dashboard(ctx: Ctx): Promise<AdminDashboard> {
  const group = await requireAdmin(ctx);
  await ensureSessions(ctx.db, group, ctx.nowMs);
  const settings = settingsOf(group);
  const since = new Date(ctx.nowMs - HISTORY_MS).toISOString();
  const players = await getPlayers(ctx.db, group.id);
  const sessions = await loadSessions(ctx.db, group.id, since);
  const rosters = await loadRosters(ctx.db, group.id, since);
  const { results: auditRows } = await ctx.db
    .prepare('SELECT * FROM admin_audit_log WHERE group_id = ? ORDER BY created_at DESC LIMIT 60')
    .bind(group.id)
    .all<{ id: string; session_id: string | null; actor_label: string; action: string; details_json: string; created_at: string }>();
  const auditEntries: AuditEntry[] = auditRows.map((a) => ({
    id: a.id,
    sessionId: a.session_id,
    actorLabel: a.actor_label,
    action: a.action,
    details: safeParse(a.details_json),
    createdAt: a.created_at,
  }));
  return {
    group: {
      name: group.name,
      timezone: group.timezone,
      venmoUrl: group.venmo_url,
      settings,
      playerLink: `${ctx.url.origin}/g/${group.group_key}`,
    },
    players: players.map(adminPlayerView),
    sessions: sessions.map((s) => adminSessionView(s, rosters.get(s.id) ?? [], players, ctx.nowMs, settings)),
    audit: auditEntries,
    now: ctx.nowIso,
  };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function adminSession(ctx: Ctx): Promise<{ group: GroupRow; session: SessionRow }> {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return { group, session };
}

export async function updateBooking(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const next = {
    booking_status: v.oneOf(body.bookingStatus, 'bookingStatus', ['needs_booking', 'booked', 'unavailable'] as const),
    venue_name: v.optionalText(body.venueName, 'venueName', 80),
    venue_booking_url: v.optionalUrl(body.venueBookingUrl, 'venueBookingUrl'),
    reservation_reference: v.optionalText(body.reservationReference, 'reservationReference', 80),
    court_cost_cents: v.cents(body.courtCostCents, 'courtCostCents'),
    cancellation_deadline_at: v.isoTime(body.cancellationDeadlineAt, 'cancellationDeadlineAt'),
  };
  if (next.cancellation_deadline_at && next.cancellation_deadline_at > session.starts_at) {
    throw new HttpError(400, 'invalid_cancellationDeadlineAt', 'The cancellation deadline must be before the session starts.');
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, val] of Object.entries(next)) {
    const before = session[k as keyof SessionRow];
    if (before !== val) changes[k] = { from: before, to: val };
  }
  if (Object.keys(changes).length === 0) return { ok: true, changed: false };
  const status = session.status === 'canceled' ? 'canceled' : next.booking_status === 'booked' ? 'booked' : 'planned';
  await ctx.db
    .prepare(
      `UPDATE sessions SET booking_status = ?, venue_name = ?, venue_booking_url = ?, reservation_reference = ?,
         court_cost_cents = ?, cancellation_deadline_at = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      next.booking_status,
      next.venue_name,
      next.venue_booking_url,
      next.reservation_reference,
      next.court_cost_cents,
      next.cancellation_deadline_at,
      status,
      ctx.nowIso,
      session.id,
    )
    .run();
  await audit(ctx.db, group.id, session.id, 'booking_updated', changes, ctx.nowIso);
  return { ok: true, changed: true };
}

export async function decide(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const decision = v.oneOf(body.decision, 'decision', ['try_fill', 'keep', 'cancel', 'reopen'] as const);
  if (decision === 'cancel') {
    if (body.confirm !== true) throw new HttpError(400, 'confirm_required', 'Confirm the cancellation first.');
    if (session.status === 'canceled') return { ok: true, changed: false };
    await ctx.db
      .prepare("UPDATE sessions SET status = 'canceled', canceled_at = ?, canceled_by = 'organizer', updated_at = ? WHERE id = ?")
      .bind(ctx.nowIso, ctx.nowIso, session.id)
      .run();
    await invalidateSessionTokens(ctx.db, session.id, ctx.nowIso);
    await audit(ctx.db, group.id, session.id, 'session_canceled', { startsAt: session.starts_at }, ctx.nowIso);
    return { ok: true, changed: true };
  }
  if (decision === 'reopen') {
    if (session.status !== 'canceled') return { ok: true, changed: false };
    if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
    await ctx.db
      .prepare(
        `UPDATE sessions SET status = CASE WHEN booking_status = 'booked' THEN 'booked' ELSE 'planned' END,
           canceled_at = NULL, canceled_by = NULL, admin_decision = NULL, decision_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(ctx.nowIso, session.id)
      .run();
    await audit(ctx.db, group.id, session.id, 'session_reopened', {}, ctx.nowIso);
    return { ok: true, changed: true };
  }
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  await ctx.db
    .prepare('UPDATE sessions SET admin_decision = ?, decision_at = ?, updated_at = ? WHERE id = ?')
    .bind(decision, ctx.nowIso, ctx.nowIso, session.id)
    .run();
  await audit(ctx.db, group.id, session.id, `decision_${decision}`, {}, ctx.nowIso);
  return { ok: true, changed: true };
}

/** Move a session to a new date or time. Its deadline resets to the default for the new time. */
export async function reschedule(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
  const startsAt = v.isoTime(body.startsAt, 'startsAt');
  const endsAt = v.isoTime(body.endsAt, 'endsAt');
  if (!startsAt || !endsAt) throw new HttpError(400, 'invalid_time', 'Pick a date, start time, and end time.');
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) throw new HttpError(400, 'invalid_time', 'The end time must be after the start time.');
  if (length > 6 * 3600_000) throw new HttpError(400, 'invalid_time', 'A session can be at most 6 hours long.');
  if (Date.parse(startsAt) <= ctx.nowMs) throw new HttpError(400, 'invalid_time', 'Pick a time in the future.');
  if (startsAt === session.starts_at && endsAt === session.ends_at) return { ok: true, changed: false };
  const deadline = defaultDeadline(startsAt, settingsOf(group));
  try {
    await ctx.db
      .prepare(
        `UPDATE sessions SET starts_at = ?, ends_at = ?, cancellation_deadline_at = ?, admin_decision = NULL, decision_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(startsAt, endsAt, deadline, ctx.nowIso, session.id)
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'time_taken', "There's already a session at that time.");
    throw err;
  }
  await audit(ctx.db, group.id, session.id, 'session_rescheduled', { from: session.starts_at, to: startsAt }, ctx.nowIso);
  return { ok: true, changed: true };
}

/** Organizer fixes to the roster. Still goes through the same four-spot rules. */
export async function editRoster(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const action = v.oneOf(body.action, 'action', ['confirm', 'waitlist', 'withdraw', 'confirm_attendance'] as const);
  const player = await ctx.db
    .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ?')
    .bind(playerId, group.id)
    .first<{ id: string; display_name: string }>();
  if (!player) throw new HttpError(404, 'player_not_found', 'Player not found.');
  let result: string;
  if (action === 'confirm') {
    const r = await joinSession(ctx.db, session, playerId, ctx.nowMs, 'claim_only');
    if (r.result === 'spot_taken') throw new HttpError(409, 'session_full', 'All four spots are taken.');
    result = r.result;
  } else if (action === 'waitlist') {
    await moveToWaitlist(ctx.db, session, playerId, ctx.nowMs);
    result = 'waitlisted';
  } else if (action === 'withdraw') {
    const r = await withdraw(ctx.db, session, playerId, ctx.nowMs);
    result = r.changed ? 'withdrawn' : 'not_in_session';
  } else {
    await confirmAttendance(ctx.db, session, playerId, ctx.nowMs);
    result = 'confirmed_attendance';
  }
  await audit(ctx.db, group.id, session.id, `roster_${action}`, { player: player.display_name, result }, ctx.nowIso);
  return { result };
}

export async function setPayment(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const paid = v.bool(body.paid, 'paid');
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  if (!row) throw new HttpError(404, 'not_in_session', 'That player is not in this session.');

  if (paid) {
    if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe a share.');
    const share = sharesFor(session, roster).get(playerId);
    if (share === undefined) throw new HttpError(409, 'no_cost', 'Enter the court cost first.');
    if (row.payment_status === 'paid') return { ok: true, changed: false };
    await ctx.db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?, payment_amount_cents = ?,
           payment_updated_at = ?, updated_at = ?
         WHERE session_id = ? AND player_id = ?`,
      )
      .bind(ctx.nowIso, share, ctx.nowIso, ctx.nowIso, session.id, playerId)
      .run();
    await audit(ctx.db, group.id, session.id, 'marked_paid', { player: row.display_name, amountCents: share }, ctx.nowIso);
  } else {
    if (row.payment_status !== 'paid') return { ok: true, changed: false };
    await ctx.db
      .prepare(
        `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
           paid_at = NULL, payment_amount_cents = NULL, payment_updated_at = ?, updated_at = ?
         WHERE session_id = ? AND player_id = ?`,
      )
      .bind(ctx.nowIso, ctx.nowIso, session.id, playerId)
      .run();
    await audit(
      ctx.db,
      group.id,
      session.id,
      'marked_unpaid',
      { player: row.display_name, previousAmountCents: row.payment_amount_cents, previousPaidAt: row.paid_at },
      ctx.nowIso,
    );
  }
  return { ok: true, changed: true };
}

/**
 * Create personal links for text messages. The server picks who is
 * eligible; the browser only gets to narrow that list down.
 */
export async function prepareLinks(ctx: Ctx, body: Record<string, unknown>): Promise<{ drafts: ActionLinkDraft[] }> {
  const { group, session } = await adminSession(ctx);
  const kind = v.oneOf(body.kind, 'kind', ['attendance', 'claim'] as const);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
  const wanted = Array.isArray(body.playerIds) ? new Set(body.playerIds.map((x) => v.id(x, 'playerIds'))) : null;
  const roster = await loadRoster(ctx.db, session.id);

  let recipients: { playerId: string; name: string; phone: string | null }[];
  if (kind === 'attendance') {
    recipients = confirmedOf(roster)
      .filter((r) => !r.attendance_confirmed_at)
      .map((r) => ({ playerId: r.player_id, name: r.display_name, phone: r.phone_number }));
  } else {
    if (confirmedOf(roster).length >= 4) throw new HttpError(409, 'session_full', 'This session is already full.');
    recipients = eligibleSubstitutes(roster, await getPlayers(ctx.db, group.id));
  }
  if (wanted) recipients = recipients.filter((r) => wanted.has(r.playerId));

  const drafts: ActionLinkDraft[] = [];
  for (const r of recipients) {
    const token = await issueToken(ctx.db, session, r.playerId, kind, ctx.nowIso);
    drafts.push({ ...r, url: `${ctx.url.origin}/t/${token}` });
  }
  return { drafts };
}

export async function generateSessions(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const created = await ensureSessions(ctx.db, group, ctx.nowMs);
  return { created };
}

function playerFields(body: Record<string, unknown>) {
  return {
    name: v.playerName(body.name),
    phone: v.optionalPhone(body.phone),
    isRegular: v.optionalBool(body.isRegular, 'isRegular', true),
    isActive: v.optionalBool(body.isActive, 'isActive', true),
    canReceiveSubstituteInvites: v.optionalBool(body.canReceiveSubstituteInvites, 'canReceiveSubstituteInvites', true),
  };
}

function uniqueNameError(err: unknown): never {
  if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'duplicate_name', 'Another player already has that name.');
  throw err;
}

export async function createPlayer(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const f = playerFields(body);
  const count = await ctx.db.prepare('SELECT COUNT(*) AS n FROM players WHERE group_id = ?').bind(group.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) throw new HttpError(409, 'too_many_players', 'That is enough players for one group.');
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO players (id, group_id, display_name, phone_number, is_regular, is_active, can_receive_substitute_invites, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, group.id, f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, count?.n ?? 0, ctx.nowIso)
      .run();
  } catch (err) {
    uniqueNameError(err);
  }
  await audit(ctx.db, group.id, null, 'player_added', { name: f.name }, ctx.nowIso);
  return { id };
}

export async function updatePlayer(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const f = playerFields(body);
  let res;
  try {
    res = await ctx.db
      .prepare(
        `UPDATE players SET display_name = ?, phone_number = ?, is_regular = ?, is_active = ?, can_receive_substitute_invites = ?
         WHERE id = ? AND group_id = ?`,
      )
      .bind(f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, id, group.id)
      .run();
  } catch (err) {
    uniqueNameError(err);
  }
  if (res.meta.changes !== 1) throw new HttpError(404, 'player_not_found', 'Player not found.');
  await audit(ctx.db, group.id, null, 'player_updated', { name: f.name, active: f.isActive }, ctx.nowIso);
  return { ok: true };
}

export async function updateGroup(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const name = v.text(body.name, 'name', { max: 60 });
  const venmoUrl = v.optionalUrl(body.venmoUrl, 'venmoUrl');
  const settings = normalizeSettings({ ...settingsOf(group), ...(body.settings as object) });
  await ctx.db
    .prepare('UPDATE groups SET name = ?, venmo_url = ?, settings_json = ? WHERE id = ?')
    .bind(name, venmoUrl, JSON.stringify(settings), group.id)
    .run();
  await audit(ctx.db, group.id, null, 'settings_updated', { name, venmoUrl, settings }, ctx.nowIso);
  await ensureSessions(ctx.db, { ...group, settings_json: JSON.stringify(settings) }, ctx.nowMs);
  return { ok: true };
}

export async function changePin(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (typeof body.currentPin !== 'string' || !(await verifyPin(body.currentPin, group.admin_pin_hash))) {
    throw new HttpError(401, 'wrong_pin', 'Current PIN is not right.');
  }
  const next = v.pin(body.newPin, 'newPin');
  await ctx.db.prepare('UPDATE groups SET admin_pin_hash = ? WHERE id = ?').bind(await hashPin(next), group.id).run();
  await revokeAdminSessions(ctx, group.id);
  await startAdminSession(ctx, group.id);
  await audit(ctx.db, group.id, null, 'pin_changed', {}, ctx.nowIso);
  return { ok: true };
}

export async function rotateLink(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const key = randomToken(18);
  await ctx.db.prepare('UPDATE groups SET group_key = ? WHERE id = ?').bind(key, group.id).run();
  await audit(ctx.db, group.id, null, 'player_link_rotated', {}, ctx.nowIso);
  return { playerLink: `${ctx.url.origin}/g/${key}` };
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Stop spreadsheet apps from treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportData(ctx: Ctx): Promise<Response> {
  const group = await requireAdmin(ctx);
  const tz = group.timezone;
  const sessions = await loadSessions(ctx.db, group.id, '0000');
  const rosters = await loadRosters(ctx.db, group.id, '0000');
  const header = [
    'Date', 'Time', 'Session status', 'Court booking', 'Venue', 'Reservation', 'Court cost',
    'Cancellation deadline', 'Player', 'Player status', 'Share', 'Payment', 'Paid at', 'Amount paid',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const s of sessions) {
    const roster = rosters.get(s.id) ?? [];
    const shares = sharesFor(s, roster);
    const base = [
      formatShortDate(s.starts_at, tz),
      formatTimeRange(s.starts_at, s.ends_at, tz),
      s.status,
      s.booking_status,
      s.venue_name,
      s.reservation_reference,
      s.court_cost_cents === null ? '' : formatCents(s.court_cost_cents),
      s.cancellation_deadline_at ? formatDateTime(s.cancellation_deadline_at, tz) : '',
    ];
    if (roster.length === 0) lines.push([...base, '', '', '', '', '', ''].map(csvCell).join(','));
    for (const r of roster) {
      const share = shares.get(r.player_id);
      lines.push(
        [
          ...base,
          r.display_name,
          r.status,
          share === undefined ? '' : formatCents(share),
          r.payment_status,
          r.paid_at ? formatDateTime(r.paid_at, tz) : '',
          r.payment_amount_cents === null ? '' : formatCents(r.payment_amount_cents),
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pickleball-export.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
