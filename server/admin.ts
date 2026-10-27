import type { ActionLinkDraft, ActivityPage, AdminDashboard, AuditEntry } from '../shared/api';
import { formatCents } from '../shared/money';
import { DEFAULT_VENUE_NAME, normalizeSettings } from '../shared/settings';
import { openSpots } from '../shared/spots';
import { formatDateTime, formatShortDate, formatTimeRange } from '../shared/time';
import { adminLogin, adminLogout, hashGroupWord, requireAdmin, revokeAdminSessions, startAdminSession } from './auth';
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
  waitlistOf,
  creditPlan,
  issueCredits,
  loadCredits,
  loadHiddenSessions,
  openCredits,
  syncSix,
  visibleFrom,
} from './repo';
import { clearLateDrop, confirmAttendance, joinSession, moveToWaitlist, recordLateDrop, settle, withdraw } from './roster';
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
  await issueCredits(ctx.db, group, ctx.nowMs);
  const settings = settingsOf(group);
  const players = await getPlayers(ctx.db, group.id);
  const { sessions, rosters, credits, plan } = await moneyPicture(ctx, group);
  const usedOn = (sessionId: string, playerId: string) =>
    credits.filter((c) => c.used_session_id === sessionId && c.player_id === playerId).reduce((sum, c) => sum + c.amount_cents, 0);
  const creditFor = (s: { id: string }, roster: { player_id: string; payment_status: string }[]) => (playerId: string) => {
    const row = roster.find((r) => r.player_id === playerId);
    return row?.payment_status === 'paid' ? usedOn(s.id, playerId) : (plan.get(`${s.id}:${playerId}`)?.cents ?? 0);
  };
  const balances = new Map<string, number>();
  for (const c of openCredits(credits)) balances.set(c.playerId, (balances.get(c.playerId) ?? 0) + c.amountCents);
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
  // Late drops per person, ever. Organizer only.
  const lateRows = await ctx.db
    .prepare(
      `SELECT sp.player_id AS id, COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND sp.late_drop_at IS NOT NULL GROUP BY sp.player_id`,
    )
    .bind(group.id)
    .all<{ id: string; n: number }>();
  const lateDrops = new Map(lateRows.results.map((r) => [r.id, Number(r.n)]));
  // Sessions each person has played, ever: in, not canceled, and over.
  const playedRows = await ctx.db
    .prepare(
      `SELECT sp.player_id AS id, COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND sp.status = 'confirmed' AND s.status <> 'canceled' AND s.ends_at <= ? GROUP BY sp.player_id`,
    )
    .bind(group.id, ctx.nowIso)
    .all<{ id: string; n: number }>();
  const played = new Map(playedRows.results.map((r) => [r.id, Number(r.n)]));
  return {
    group: {
      name: group.name,
      timezone: group.timezone,
      venmoUrl: group.venmo_url,
      organizerName: group.organizer_name,
      venueName: group.venue_name,
      venueAddress: group.venue_address,
      firstSessionDate: group.first_session_date,
      settings,
      playerLink: playerLinkFor(ctx, group),
      privateLink: `${ctx.url.origin}/g/${group.group_key}`,
      openAccess: !!group.open_access,
      hasGroupWord: !!group.group_word_hash,
    },
    players: players.map((p) => ({ ...adminPlayerView(p), lateDrops: lateDrops.get(p.id) ?? 0, played: played.get(p.id) ?? 0 })),
    sessions: sessions.map((s) => {
      const roster = rosters.get(s.id) ?? [];
      return adminSessionView(s, roster, players, ctx.nowMs, settings, group.timezone, creditFor(s, roster));
    }),
    audit: auditEntries,
    hiddenSessions: (await loadHiddenSessions(ctx.db, group, ctx.nowMs)).map((h) => ({ id: h.id, startsAt: h.starts_at, endsAt: h.ends_at })),
    credits: [...balances]
      .map(([playerId, balanceCents]) => ({ playerId, name: players.find((p) => p.id === playerId)?.display_name ?? '?', balanceCents }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    me: await organizerPlayer(ctx, group, false),
    now: ctx.nowIso,
  };
}

/**
 * The link to send players: the plain site address when it's open to
 * anyone, otherwise the long private link.
 */
export function playerLinkFor(ctx: Ctx, group: GroupRow): string {
  if (!group.open_access) return `${ctx.url.origin}/g/${group.group_key}`;
  return (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');
}

/** Visible sessions from the last 90 days on, their rosters, all credits, and where open credits will land. */
async function moneyPicture(ctx: Ctx, group: GroupRow) {
  // Credits from sessions that just ended exist before anything is paid or cleared.
  await issueCredits(ctx.db, group, ctx.nowMs);
  const since = new Date(ctx.nowMs - HISTORY_MS).toISOString();
  const from = visibleFrom(group);
  const sessions = await loadSessions(ctx.db, group.id, since, from);
  const rosters = await loadRosters(ctx.db, group.id, since, from);
  const credits = await loadCredits(ctx.db, group.id);
  return { sessions, rosters, credits, plan: creditPlan(sessions, rosters, credits, settingsOf(group)) };
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

/**
 * "I booked it" (or "Court opened" when on the venue's waitlist): one tap
 * that marks the session booked. Venue defaults to the club, the deadline to
 * the default hours before play; reservation number and court cost are
 * optional and kept when left out. Standby players then move in by the
 * 4-or-6 rules. Court numbers are no longer used; any saved ones are left
 * alone in the database and never shown.
 */
export async function markBooked(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.ends_at)) throw new HttpError(409, 'session_over', 'This session is over.');
  const reference = body.reservationReference === undefined ? session.reservation_reference : v.optionalText(body.reservationReference, 'reservationReference', 80);
  const cost = body.courtCostCents === undefined ? session.court_cost_cents : v.cents(body.courtCostCents, 'courtCostCents');
  const wasWaiting = session.court_state === 'waitlist';
  await ctx.db
    .prepare(
      `UPDATE sessions SET booking_status = 'booked', status = 'booked',
         venue_name = COALESCE(venue_name, ?), reservation_reference = ?, court_cost_cents = ?,
         cancellation_deadline_at = COALESCE(cancellation_deadline_at, ?),
         court_state = CASE WHEN court_state = 'waitlist' THEN 'opened' ELSE court_state END,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(group.venue_name || DEFAULT_VENUE_NAME, reference, cost, defaultDeadline(session.starts_at, settingsOf(group)), ctx.nowIso, session.id)
    .run();
  let promoted: { playerId: string }[] = [];
  if (wasWaiting && ctx.nowMs < Date.parse(session.starts_at)) {
    promoted = await settle(ctx.db, { ...session, court_state: 'opened' }, ctx.nowIso);
    await syncSix(ctx.db, session.id, ctx.nowIso);
  }
  await audit(ctx.db, group.id, session.id, wasWaiting ? 'court_opened' : 'court_booked', { promoted: promoted.length }, ctx.nowIso);
  return { ok: true, promoted: promoted.length };
}

/** The venue's court waitlist: start waiting, give up ("Didn't open"), or go back to not booked. */
export async function courtWaitlist(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const action = v.oneOf(body.action, 'action', ['waitlist', 'not_opened', 'clear'] as const);
  if (action === 'waitlist') {
    if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    await ctx.db
      .prepare("UPDATE sessions SET court_state = 'waitlist', booking_status = 'needs_booking', status = 'planned', updated_at = ? WHERE id = ?")
      .bind(ctx.nowIso, session.id)
      .run();
  } else if (action === 'clear') {
    await ctx.db.prepare('UPDATE sessions SET court_state = NULL, updated_at = ? WHERE id = ? AND court_state = \'waitlist\'').bind(ctx.nowIso, session.id).run();
  } else {
    if (session.court_state !== 'waitlist') throw new HttpError(409, 'not_waiting', 'This session is not on the court waitlist.');
    await ctx.db
      .prepare(
        `UPDATE sessions SET court_state = 'not_opened', status = 'canceled', canceled_at = ?, canceled_by = 'court_not_opened', updated_at = ?
         WHERE id = ?`,
      )
      .bind(ctx.nowIso, ctx.nowIso, session.id)
      .run();
    await invalidateSessionTokens(ctx.db, session.id, ctx.nowIso);
  }
  await audit(ctx.db, group.id, session.id, `court_${action}`, {}, ctx.nowIso);
  return { ok: true };
}

/** "Show this session" for one that falls before the first session date (or hide it again). */
export async function showSession(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const shown = v.bool(body.shown, 'shown');
  await ctx.db.prepare('UPDATE sessions SET shown_early = ?, updated_at = ? WHERE id = ?').bind(shown ? 1 : 0, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, shown ? 'session_shown_early' : 'session_hidden_again', {}, ctx.nowIso);
  return { ok: true };
}

/** "Venue is open normal hours" on a holiday, or undo it. */
export async function holidayHours(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const ok = v.bool(body.ok, 'ok');
  await ctx.db.prepare('UPDATE sessions SET holiday_hours_ok_at = ?, updated_at = ? WHERE id = ?').bind(ok ? ctx.nowIso : null, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, ok ? 'holiday_hours_confirmed' : 'holiday_hours_unconfirmed', {}, ctx.nowIso);
  return { ok: true };
}

/** "Done" on the day-before or last-call card. */
export async function cardDone(ctx: Ctx, body: Record<string, unknown>) {
  const { session } = await adminSession(ctx);
  const card = v.oneOf(body.card, 'card', ['day_before', 'last_call'] as const);
  const column = card === 'day_before' ? 'day_before_done_at' : 'last_call_done_at';
  await ctx.db.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(ctx.nowIso, ctx.nowIso, session.id).run();
  return { ok: true };
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
    const r = await joinSession(ctx.db, session, playerId, ctx.nowMs, 'organizer');
    if (r.result === 'spot_taken') throw new HttpError(409, 'session_full', 'All six spots are taken.');
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

/** Done on a late-drop card: hides it. The late drop still counts on the Players screen. */
export async function lateDropDone(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  await ctx.db
    .prepare('UPDATE session_players SET late_drop_done_at = ? WHERE session_id = ? AND player_id = ? AND late_drop_at IS NOT NULL')
    .bind(ctx.nowIso, session.id, playerId)
    .run();
  await audit(ctx.db, group.id, session.id, 'late_drop_done', {}, ctx.nowIso);
  return { ok: true };
}

/** "Refunded" for someone who paid for a session that was then canceled. Only a record; no money moves. */
export async function setRefund(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const refunded = v.bool(body.refunded, 'refunded');
  const row = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
  if (!row || row.payment_status !== 'paid') throw new HttpError(409, 'not_paid', 'Only someone who paid can be refunded.');
  if (!!row.refunded_at === refunded) return { ok: true, changed: false };
  await ctx.db
    .prepare('UPDATE session_players SET refunded_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ?')
    .bind(refunded ? ctx.nowIso : null, ctx.nowIso, session.id, playerId)
    .run();
  await audit(ctx.db, group.id, session.id, refunded ? 'refund_marked' : 'refund_cleared', { player: row.display_name }, ctx.nowIso);
  return { ok: true, changed: true };
}

export async function setPayment(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const paid = v.bool(body.paid, 'paid');
  return applyPayment(ctx, group, session, playerId, paid, null);
}

/**
 * Mark one seat paid or unpaid. `self` is the player's name when they did it
 * themselves ("I paid" / "Didn't pay?"), or null for the organizer. A paid
 * seat uses up any credit planned for it; unmarking gives the credit back.
 * The organizer marking a self-marked seat paid confirms it (the tag goes).
 */
export async function applyPayment(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, paid: boolean, self: string | null, actor?: string) {
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  if (!row) throw new HttpError(404, 'not_in_session', 'That player is not in this session.');

  if (paid) {
    if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    if (row.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe a share.');
    const price = sharesFor(session, roster, settingsOf(group)).get(playerId);
    if (price === undefined) throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe money.');
    if (row.payment_status === 'paid') {
      if (self || !row.self_paid_at) return { ok: true, changed: false };
      await ctx.db
        .prepare('UPDATE session_players SET self_paid_at = NULL, payment_updated_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ?')
        .bind(ctx.nowIso, ctx.nowIso, session.id, playerId)
        .run();
      await audit(ctx.db, group.id, session.id, 'marked_paid', { player: row.display_name, confirmed: true }, ctx.nowIso);
      return { ok: true, changed: true };
    }
    // Any credit planned for this seat is used up now.
    const credit = (await moneyPicture(ctx, group)).plan.get(`${session.id}:${playerId}`) ?? { cents: 0, ids: [] };
    const share = price - credit.cents;
    await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_status = 'paid', paid_at = ?, payment_amount_cents = ?, self_paid_at = ?,
             payment_updated_at = ?, updated_at = ?
           WHERE session_id = ? AND player_id = ?`,
        )
        .bind(ctx.nowIso, share, self ? ctx.nowIso : null, ctx.nowIso, ctx.nowIso, session.id, playerId),
      ...credit.ids.map((id) =>
        ctx.db
          .prepare('UPDATE credits SET used_session_id = ?, used_at = ? WHERE id = ? AND used_session_id IS NULL AND cleared_at IS NULL')
          .bind(session.id, ctx.nowIso, id),
      ),
    ]);
    await audit(
      ctx.db,
      group.id,
      session.id,
      self ? 'player_self_paid' : 'marked_paid',
      { player: row.display_name, amountCents: share, creditCents: credit.cents },
      ctx.nowIso,
      actor ?? (self ? self : 'organizer'),
    );
  } else {
    if (row.payment_status !== 'paid') return { ok: true, changed: false };
    if (self && !row.self_paid_at) throw new HttpError(409, 'organizer_marked', 'The organizer marked this paid. Ask them to change it.');
    await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
             paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?, updated_at = ?
           WHERE session_id = ? AND player_id = ?`,
        )
        .bind(ctx.nowIso, ctx.nowIso, session.id, playerId),
      // Credits used on this payment go back to the player.
      ctx.db.prepare('UPDATE credits SET used_session_id = NULL, used_at = NULL WHERE used_session_id = ? AND player_id = ?').bind(session.id, playerId),
    ]);
    await audit(
      ctx.db,
      group.id,
      session.id,
      self ? 'player_self_unpaid' : 'marked_unpaid',
      { player: row.display_name, previousAmountCents: row.payment_amount_cents, previousPaidAt: row.paid_at },
      ctx.nowIso,
      actor ?? (self ? self : 'organizer'),
    );
  }
  return { ok: true, changed: true };
}

/** Dismiss the "had 6, now fewer" card once payments are sorted out by hand. */
export async function sixSorted(ctx: Ctx) {
  const { group, session } = await adminSession(ctx);
  await ctx.db.prepare('UPDATE sessions SET six_drop_resolved_at = ?, updated_at = ? WHERE id = ?').bind(ctx.nowIso, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, 'six_drop_sorted', {}, ctx.nowIso);
  return { ok: true };
}

/** "Clear credit": the organizer paid this player back by hand. Clears all of their open credit. */
export async function clearCredit(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const playerId = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  await issueCredits(ctx.db, group, ctx.nowMs);
  const res = await ctx.db
    .prepare('UPDATE credits SET cleared_at = ? WHERE player_id = ? AND group_id = ? AND used_session_id IS NULL AND cleared_at IS NULL')
    .bind(ctx.nowIso, playerId, group.id)
    .run();
  await audit(ctx.db, group.id, null, 'credit_cleared', { player: p.display_name, count: res.meta.changes }, ctx.nowIso);
  return { ok: true, cleared: res.meta.changes };
}

/**
 * Remove a name. Someone with no history (never signed up, never paid) is
 * deleted completely. Anyone with history is hidden instead, so old
 * sessions and payments stay intact.
 */
export async function removePlayer(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(id, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  const history = await ctx.db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM session_players WHERE player_id = ?1 AND (status <> 'declined' OR payment_status = 'paid')) +
         (SELECT COUNT(*) FROM credits WHERE player_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if ((history?.n ?? 0) > 0) {
    await ctx.db.prepare('UPDATE players SET is_active = 0, is_new = 0 WHERE id = ?').bind(id).run();
    await audit(ctx.db, group.id, null, 'player_hidden', { name: p.display_name }, ctx.nowIso);
    return { result: 'hidden' };
  }
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM player_devices WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM session_action_tokens WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM session_players WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM players WHERE id = ? AND group_id = ?').bind(id, group.id),
  ]);
  await audit(ctx.db, group.id, null, 'player_deleted', { name: p.display_name }, ctx.nowIso);
  return { result: 'deleted' };
}

/** The organizer sent the "Good news, you're in" text to someone moved off the waitlist. */
export async function markTold(ctx: Ctx, body: Record<string, unknown>) {
  const { session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  await ctx.db
    .prepare(
      `UPDATE session_players SET promotion_notified_at = ?, updated_at = ?
       WHERE session_id = ? AND player_id = ? AND promoted_at IS NOT NULL AND promotion_notified_at IS NULL`,
    )
    .bind(ctx.nowIso, ctx.nowIso, session.id, playerId)
    .run();
  return { ok: true };
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
    if (openSpots(confirmedOf(roster).length, waitlistOf(roster).length) === 0) {
      throw new HttpError(409, 'session_full', 'No spots are open right now.');
    }
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
    usualDays: v.usualDays(body.usualDays),
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
        `INSERT INTO players (id, group_id, display_name, phone_number, is_regular, is_active, can_receive_substitute_invites, sort_order, created_at, usual_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, group.id, f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, count?.n ?? 0, ctx.nowIso, f.usualDays ?? '')
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
        `UPDATE players SET display_name = ?, phone_number = ?, is_regular = ?, is_active = ?, can_receive_substitute_invites = ?,
           usual_days = COALESCE(?, usual_days), is_new = 0
         WHERE id = ? AND group_id = ?`,
      )
      .bind(f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, f.usualDays, id, group.id)
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
  // Fields left out of the request keep their saved values (Settings saves one row at a time).
  const name = body.name === undefined ? group.name : v.text(body.name, 'name', { max: 60 });
  const venmoUrl = body.venmoUrl === undefined ? group.venmo_url : v.optionalUrl(body.venmoUrl, 'venmoUrl');
  const organizerName = body.organizerName === undefined ? group.organizer_name : v.optionalText(body.organizerName, 'organizerName', 40);
  const venueName = body.venueName === undefined ? group.venue_name : v.optionalText(body.venueName, 'venueName', 80);
  const venueAddress = body.venueAddress === undefined ? group.venue_address : v.optionalText(body.venueAddress, 'venueAddress', 160);
  const firstSessionDate = body.firstSessionDate === undefined ? group.first_session_date : v.optionalDate(body.firstSessionDate, 'firstSessionDate');
  const openAccess = body.openAccess === undefined ? !!group.open_access : v.bool(body.openAccess, 'openAccess');
  // Group word: leave out to keep it, null or "" to remove it.
  let wordHash = group.group_word_hash;
  if (body.groupWord !== undefined) {
    const word = v.optionalText(body.groupWord, 'groupWord', 40);
    if (word !== null && word.length < 2) throw new HttpError(400, 'invalid_groupWord', 'The group word needs at least 2 letters.');
    wordHash = word === null ? null : await hashGroupWord(word);
  }
  const settings = normalizeSettings({ ...settingsOf(group), ...(body.settings as object) });
  await ctx.db
    .prepare(
      `UPDATE groups SET name = ?, venmo_url = ?, settings_json = ?, organizer_name = ?, venue_name = ?, venue_address = ?, first_session_date = ?,
         open_access = ?, group_word_hash = ?
       WHERE id = ?`,
    )
    .bind(name, venmoUrl, JSON.stringify(settings), organizerName, venueName, venueAddress, firstSessionDate, openAccess ? 1 : 0, wordHash, group.id)
    .run();
  await audit(
    ctx.db,
    group.id,
    null,
    'settings_updated',
    { name, venmoUrl, organizerName, venueName, venueAddress, firstSessionDate, openAccess, groupWordSet: !!wordHash, settings },
    ctx.nowIso,
  );
  await ensureSessions(ctx.db, { ...group, settings_json: JSON.stringify(settings), first_session_date: firstSessionDate }, ctx.nowMs);
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
  return { playerLink: playerLinkFor(ctx, { ...group, group_key: key }) };
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
    'Date', 'Time', 'Session status', 'Court booking', 'Venue', 'Reservation',
    'Cancellation deadline', 'Player', 'Player status', 'Price', 'Payment', 'Paid at', 'Amount paid', 'Refunded at',
  ];
  const settings = settingsOf(group);
  const lines = [header.map(csvCell).join(',')];
  for (const s of sessions) {
    const roster = rosters.get(s.id) ?? [];
    const shares = sharesFor(s, roster, settings);
    const base = [
      formatShortDate(s.starts_at, tz),
      formatTimeRange(s.starts_at, s.ends_at, tz),
      s.status,
      s.booking_status,
      s.venue_name,
      s.reservation_reference,
      s.cancellation_deadline_at ? formatDateTime(s.cancellation_deadline_at, tz) : '',
    ];
    if (roster.length === 0) lines.push([...base, '', '', '', '', '', '', ''].map(csvCell).join(','));
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
          r.refunded_at ? formatDateTime(r.refunded_at, tz) : '',
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

const ACTIVITY_PAGE = 80;

/** GET /api/admin/activity?before=<iso>: History > Activity, newest first. */
export async function activity(ctx: Ctx): Promise<ActivityPage> {
  const group = await requireAdmin(ctx);
  const before = ctx.url.searchParams.get('before');
  const until = before && !Number.isNaN(Date.parse(before)) ? before : '9999';
  const { results } = await ctx.db
    .prepare(
      `SELECT a.*, s.starts_at AS session_starts_at FROM admin_audit_log a LEFT JOIN sessions s ON s.id = a.session_id
       WHERE a.group_id = ? AND a.created_at < ? ORDER BY a.created_at DESC LIMIT ?`,
    )
    .bind(group.id, until, ACTIVITY_PAGE + 1)
    .all<{ id: string; actor_label: string; action: string; details_json: string; created_at: string; session_starts_at: string | null }>();
  return {
    entries: results.slice(0, ACTIVITY_PAGE).map((a) => ({
      id: a.id,
      actorLabel: a.actor_label,
      action: a.action,
      details: safeParse(a.details_json),
      createdAt: a.created_at,
      sessionStartsAt: a.session_starts_at,
    })),
    more: results.length > ACTIVITY_PAGE,
  };
}

/**
 * POST /api/admin/sessions { startsAt, endsAt, note? }: a one-off game.
 * It works like any other session from then on. The same date and time as
 * an existing game is refused, so a double tap can't make two.
 */
export async function addGame(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const startsAt = v.isoTime(body.startsAt, 'startsAt');
  const endsAt = v.isoTime(body.endsAt, 'endsAt');
  if (!startsAt || !endsAt) throw new HttpError(400, 'invalid_time', 'Pick a date, start time, and end time.');
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) throw new HttpError(400, 'invalid_time', 'The end time must be after the start time.');
  if (length > 6 * 3600_000) throw new HttpError(400, 'invalid_time', 'A game can be at most 6 hours long.');
  if (Date.parse(startsAt) <= ctx.nowMs) throw new HttpError(400, 'invalid_time', 'Pick a time in the future.');
  const note = v.optionalText(body.note, 'note', 80);
  const tz = group.timezone;
  const clash = await ctx.db
    .prepare('SELECT id, status FROM sessions WHERE group_id = ? AND starts_at = ?')
    .bind(group.id, startsAt)
    .first<{ id: string; status: string }>();
  if (clash) {
    const when = formatDateTime(startsAt, tz);
    throw new HttpError(
      409,
      'game_exists',
      clash.status === 'canceled' ? `There's already a canceled game at ${when}. Reopen it instead.` : `There's already a game at ${when}.`,
    );
  }
  const settings = settingsOf(group);
  const id = newId();
  // Before the first session date, a game still shows (like "Show this session").
  const early = startsAt < visibleFrom(group) ? 1 : 0;
  try {
    await ctx.db
      .prepare(
        `INSERT INTO sessions (id, group_id, starts_at, ends_at, cancellation_deadline_at, is_extra, note, shown_early, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(id, group.id, startsAt, endsAt, defaultDeadline(startsAt, settings), note, early, ctx.nowIso, ctx.nowIso)
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'game_exists', `There's already a game at ${formatDateTime(startsAt, tz)}.`);
    throw err;
  }
  await audit(ctx.db, group.id, id, 'session_added', { startsAt, note }, ctx.nowIso);
  return { id };
}

/** The organizer's own player record: the saved one, else a player with their name. */
export async function organizerPlayer(ctx: Ctx, group: GroupRow, create: boolean): Promise<{ id: string; name: string } | null> {
  if (group.organizer_player_id) {
    const p = await ctx.db
      .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ?')
      .bind(group.organizer_player_id, group.id)
      .first<{ id: string; display_name: string }>();
    if (p) return { id: p.id, name: p.display_name };
  }
  const name = (group.organizer_name ?? '').trim();
  if (!name) return null;
  const all = await getPlayers(ctx.db, group.id);
  let p = all.find((x) => x.display_name.trim().toLowerCase() === name.toLowerCase());
  if (!p && !create) return null;
  let id = p?.id;
  if (!id) {
    id = newId();
    await ctx.db
      .prepare(
        `INSERT INTO players (id, group_id, display_name, is_regular, is_active, can_receive_substitute_invites, sort_order, created_at)
         VALUES (?, ?, ?, 1, 1, 0, ?, ?)`,
      )
      .bind(id, group.id, name, all.length, ctx.nowIso)
      .run();
  } else if (!p!.is_active) {
    await ctx.db.prepare('UPDATE players SET is_active = 1 WHERE id = ?').bind(id).run();
  }
  if (create) await ctx.db.prepare('UPDATE groups SET organizer_player_id = ? WHERE id = ?').bind(id, group.id).run();
  return { id, name: p?.display_name ?? name };
}

/**
 * POST /api/admin/sessions/:id/me { in }: the organizer signs up (or drops
 * out) like any player, under their name from Settings. Real, and logged.
 */
export async function organizerInOut(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const goingIn = v.bool(body.in, 'in');
  const me = await organizerPlayer(ctx, group, true);
  if (!me) throw new HttpError(400, 'name_needed', 'Add your name in Settings first (Group > Your name).');
  if (goingIn) {
    const res = await joinSession(ctx.db, session, me.id, ctx.nowMs, 'auto');
    await clearLateDrop(ctx.db, session.id, me.id);
    if (res.result !== 'already_confirmed') await audit(ctx.db, group.id, session.id, 'player_join', { player: me.name, result: res.result, organizer: true }, ctx.nowIso, me.name);
    return res;
  }
  const res = await withdraw(ctx.db, session, me.id, ctx.nowMs);
  const late = res.freedSpot ? await recordLateDrop(ctx.db, session, me.id, ctx.nowMs, settingsOf(group).checkInHours) : false;
  if (res.changed) await audit(ctx.db, group.id, session.id, 'player_withdraw', { player: me.name, result: 'withdrawn', late, organizer: true }, ctx.nowIso, me.name);
  return { result: res.changed ? 'withdrawn' : 'not_in_session' };
}
