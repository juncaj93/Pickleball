import { sha256 } from './crypto';
import type { Ctx } from './context';
import type { GroupRow } from './repo';

/** A new fingerprint at least this often, so clock-driven changes (tonight, game day 8:00 AM, started) show up. */
const TIME_BUCKET_MS = 10 * 60_000;
/** Games that ended longer ago than this are not on the player screen, except seats this player still owes for. */
const PAST_MS = 90 * 86_400_000;

/**
 * The "did anything change?" fingerprint for one player's screen. A short
 * opaque code: it changes when anything that player can see changes, and
 * says nothing else (it is a hash, so it holds no names, money or numbers).
 *
 * Everyone's part: the games, who is in and in what order, the names list,
 * the group settings. Only the viewer's own part: their payment state, their
 * credit entries, their cash out requests, their own record. Other players'
 * payments, credit and phone numbers are never read here.
 *
 * Read-only (no sessions are created), a handful of small queries in one
 * round trip, so it is cheap to ask every few seconds.
 */
export async function changeStamp(ctx: Ctx, group: GroupRow, playerId: string | null): Promise<string> {
  const me = playerId ?? '';
  const upcomingFrom = new Date(ctx.nowMs - 36 * 3_600_000).toISOString();
  const pastFrom = new Date(ctx.nowMs - PAST_MS).toISOString();
  const [sessions, roster, mine, ledger, requests, players, self] = await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT id, status, starts_at, ends_at, court_state, booking_status, cancel_reason, finalized_at, final_price_cents, final_played_count, is_extra, note, holiday_hours_ok_at, updated_at
         FROM sessions WHERE group_id = ? AND ends_at > ? ORDER BY starts_at`,
      )
      .bind(group.id, pastFrom),
    ctx.db
      .prepare(
        `SELECT sp.session_id, sp.player_id, sp.status, sp.claim_seq, sp.confirm_seq, sp.attendance_confirmed_at, sp.promoted_at
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id, sp.player_id`,
      )
      .bind(group.id, upcomingFrom),
    ctx.db
      .prepare(
        `SELECT sp.session_id, sp.status, sp.payment_status, sp.paid_at, sp.self_paid_at, sp.payment_amount_cents, sp.refunded_at, sp.played, sp.late_drop_at
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE sp.player_id = ? AND s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id`,
      )
      .bind(me, group.id, pastFrom),
    ctx.db.prepare('SELECT id, kind, amount_cents, ended_at FROM credit_ledger WHERE group_id = ? AND player_id = ? ORDER BY created_at, id').bind(group.id, me),
    ctx.db.prepare('SELECT id, status, amount_cents, resolved_at FROM refund_requests WHERE group_id = ? AND player_id = ? ORDER BY created_at, id').bind(group.id, me),
    ctx.db.prepare('SELECT id, display_name, is_active FROM players WHERE group_id = ? ORDER BY id').bind(group.id),
    ctx.db.prepare('SELECT is_regular, usual_days, is_active FROM players WHERE id = ? AND group_id = ?').bind(me, group.id),
  ]);
  const part = (r: { results: unknown[] }) => JSON.stringify(r.results);
  const raw = [
    part(sessions),
    part(roster),
    part(mine),
    part(ledger),
    part(requests),
    part(players),
    part(self),
    // Group settings the screen shows (never the PIN hash or the link key).
    JSON.stringify([group.name, group.timezone, group.venmo_url, group.organizer_name, group.settings_json, group.first_session_date]),
    me,
    Math.floor(ctx.nowMs / TIME_BUCKET_MS),
  ].join('|');
  return (await sha256(raw)).slice(0, 16);
}

/**
 * The organizer's "did anything change?" fingerprint: the same idea as the
 * player one, but for everything the organizer screens show (every game, the
 * whole roster with payments, credit, cash out requests, the names list, the
 * "Do this now" taps and the group settings). A short opaque hash, read-only,
 * one round trip of small queries, so it is cheap to ask every few seconds.
 */
export async function adminChangeStamp(ctx: Ctx, group: GroupRow): Promise<string> {
  const pastFrom = new Date(ctx.nowMs - PAST_MS).toISOString();
  const queries = (withMarks: boolean) => [
    ctx.db
      .prepare(
        `SELECT id, status, starts_at, ends_at, court_state, booking_status, cancel_reason, cancellation_deadline_at, admin_decision, finalized_at, final_price_cents, final_played_count,
                is_extra, note, shown_early, holiday_hours_ok_at, day_before_done_at, last_call_done_at, court_cost_cents, updated_at
         FROM sessions WHERE group_id = ? AND ends_at > ? ORDER BY starts_at`,
      )
      .bind(group.id, pastFrom),
    ctx.db
      .prepare(
        `SELECT sp.session_id, sp.player_id, sp.status, sp.claim_seq, sp.confirm_seq, sp.attendance_confirmed_at, sp.promoted_at,
                sp.payment_status, sp.paid_at, sp.self_paid_at, sp.payment_amount_cents, sp.refunded_at, sp.played, sp.late_drop_at
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id, sp.player_id`,
      )
      .bind(group.id, pastFrom),
    ctx.db.prepare('SELECT id, player_id, kind, amount_cents, ended_at FROM credit_ledger WHERE group_id = ? ORDER BY created_at, id').bind(group.id),
    ctx.db.prepare('SELECT id, status, amount_cents, resolved_at FROM refund_requests WHERE group_id = ? ORDER BY created_at, id').bind(group.id),
    ctx.db.prepare('SELECT id, display_name, is_active, is_regular, usual_days FROM players WHERE group_id = ? ORDER BY id').bind(group.id),
    ctx.db.prepare('SELECT MAX(created_at) AS last FROM admin_audit_log WHERE group_id = ?').bind(group.id),
    // The "Do this now" taps. Everything else still works if that table is missing.
    ...(withMarks ? [ctx.db.prepare("SELECT session_id, task FROM task_log WHERE group_id = ? AND kind = 'mark' ORDER BY session_id, task").bind(group.id)] : []),
  ];
  const results = await ctx.db.batch(queries(true)).catch(() => ctx.db.batch(queries(false)));
  const [sessions, roster, ledger, requests, players, audit] = results;
  const marks = results[6] ?? { results: [] };
  const part = (r: { results: unknown[] }) => JSON.stringify(r.results);
  const raw = [
    part(sessions),
    part(roster),
    part(ledger),
    part(requests),
    part(players),
    part(marks),
    part(audit),
    JSON.stringify([group.name, group.timezone, group.venmo_url, group.organizer_name, group.settings_json, group.first_session_date, group.venue_name, group.venue_address]),
    Math.floor(ctx.nowMs / TIME_BUCKET_MS),
  ].join('|');
  return (await sha256(raw)).slice(0, 16);
}
