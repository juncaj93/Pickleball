// Zip 42 "Guest spot" (shared/guestSpot.ts): adding and removing a guest. Every money move for the pair is on the HOST's own seat.
//
// Add (organizer only, switch on): the guest takes a spot when there is room and the host is in, else waits in line behind the host
// (with "Card cleanup" on there is no waitlist: a full game refuses, the way a 13th I'm in does). A host who already paid for one is held
// at what they paid and owes the guest's $14 (the same move a price going up makes), so nothing is ever lost or counted twice.
// Remove (the host from their card while the switch is on, or the organizer any time): the guest comes off; a seat that holds more than
// one share now gives the rest back to the host as credit (a paid $28 gives $14 back); an unpaid seat simply owes $14 less. The spot
// that opened goes to the first person waiting.
// Refused while the host has an "I paid" the organizer has not confirmed: confirming it afterwards would record the wrong amount.

import type { Ctx } from './context';
import { requireAdmin } from './auth';
import { HttpError } from './http';
import * as v from './validate';
import { holdShortCashStatements } from './credit';
import { audit, flatOf, getSession, type GroupRow, loadRoster, organizerIdOf, type SessionRow, settingsOf } from './repo';
import { auditSubClears, settle, subClearStatements, subCleared } from './roster';
import { confirmedHeads, guestSpotFlags, hasGuestColumns, nextClaimSeq, setGuestSpotForAll, trimSeatStatements } from './guestSpot';
import { capOf } from '../shared/settings';
import { DB_LIMIT_MESSAGE } from '../shared/zip10';
import { cleanGuestName, GUEST_NAME_MAX, guestIn, guestWaiting, headCount } from '../shared/guestSpot';
import { connected, deliver, prefsOfGroup } from './alerts';
import { isPretend } from './pretend';
import { alertWhen } from '../shared/alerts';
import { confirmedOf } from './repo';

function sqlText(value: string): string {
  if (!/^[0-9A-Za-z:.\-]+$/.test(value)) throw new Error('unsafe sql text');
  return `'${value}'`;
}

async function needColumns(ctx: Ctx) {
  if (!(await hasGuestColumns(ctx.db))) throw new HttpError(409, 'needs_migration', 'Guest spot needs its database change first (migration 0021).');
}

function assertChangeable(session: SessionRow, nowMs: number) {
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled.');
  if (session.finalized_at) throw new HttpError(409, 'finalized', 'This game is finalized. Reopen it to change who played.');
  if (nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This game already started.');
}

/** PUT /api/admin/guest-spot-switch { on }: the Settings > Feature switches row. */
export async function setGuestSpotSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  // Turning it on before the database change would only show buttons that answer "needs its database change": say so instead.
  if (on) await needColumns(ctx);
  await setGuestSpotForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'guest_spot_on' : 'guest_spot_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** POST /api/admin/sessions/:id/guest { playerId, name }: "Add a guest" on the Players sheet. */
export async function addGuest(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (!(await guestSpotFlags(ctx, group.id)).on) throw new HttpError(403, 'guest_spot_off', 'Guest spot is off.');
  await needColumns(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  assertChangeable(session, ctx.nowMs);
  const playerId = v.id(body.playerId, 'playerId');
  const name = cleanGuestName(body.name);
  if (!name) throw new HttpError(400, 'invalid_guest_name', `Type the guest's first name (letters only, up to ${GUEST_NAME_MAX}).`);
  const roster = await loadRoster(ctx.db, session.id);
  const host = roster.find((r) => r.player_id === playerId);
  if (!host || (host.status !== 'confirmed' && host.status !== 'waitlisted')) throw new HttpError(409, 'not_in_session', 'Only someone who is in this game can bring a guest.');
  if (guestIn(host) || guestWaiting(host)) throw new HttpError(409, 'has_guest', `${host.display_name} already has a guest for this game.`);
  if (host.payment_status === 'paid' && !host.refunded_at && host.self_paid_at)
    throw new HttpError(409, 'unconfirmed_paid', `${host.display_name} tapped I paid, not confirmed yet. Confirm it (Mark paid) or clear it first.`);
  const settings = settingsOf(group);
  const max = capOf(settings);
  const noWaitlist = settings.noCap === true;
  if (noWaitlist && headCount(confirmedOf(roster)) >= max) throw new HttpError(409, 'game_limit', DB_LIMIT_MESSAGE);
  const flat = flatOf(session, settings);
  const organizerId = await organizerIdOf(ctx.db, group);
  const now = ctx.nowIso;
  const out = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE session_players SET guest_name = ?2,
           guest_status = CASE WHEN status = 'confirmed' AND ${confirmedHeads(true)} < ?4 THEN 'confirmed' ELSE 'waitlisted' END,
           guest_seq = ${nextClaimSeq(true)}, guest_at = ?3, updated_at = ?3
         WHERE id = ?5 AND session_id = ?1 AND status IN ('confirmed', 'waitlisted') AND (guest_status IS NULL OR guest_status = 'late')
           AND NOT (payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NOT NULL)
           ${noWaitlist ? `AND status = 'confirmed' AND ${confirmedHeads(true)} < ?4` : ''}
           AND (SELECT status FROM sessions WHERE id = ?1) <> 'canceled' AND (SELECT finalized_at FROM sessions WHERE id = ?1) IS NULL`,
      )
      .bind(session.id, name, now, max, host.id),
    // The seat now costs two shares. Paid for one already: held at what it paid, owes the rest (never the organizer's court payment).
    ...holdShortCashStatements(ctx.db, {
      sessionId: session.id,
      feeCents: flat * 2,
      nowIso: now,
      playerId,
      organizerId,
      seatWhere: (sp) => `${sp}.guest_at = ?1 AND ${sp}.guest_status = 'confirmed' AND ${sp}.status = 'confirmed'`,
    }),
    // A guest taking a spot is a sub (shared/lateFees.ts rule 3): it clears the oldest open late-drop debt of the game, like any player would.
    ...subClearStatements(ctx.db, { groupId: group.id, organizerId, priceCents: flat }, session.id, playerId, now, true, true),
  ]);
  if (out[0].meta.changes !== 1) {
    const fresh = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
    if (fresh && (guestIn(fresh) || guestWaiting(fresh))) throw new HttpError(409, 'has_guest', `${host.display_name} already has a guest for this game.`);
    if (noWaitlist) throw new HttpError(409, 'game_limit', DB_LIMIT_MESSAGE);
    throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  }
  if (subCleared(out, out.length - 6, true)) await auditSubClears(ctx.db, group.id, session.id, playerId, now, flat);
  const after = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
  const status = after?.guest_status === 'confirmed' ? 'confirmed' : 'waitlisted';
  await audit(ctx.db, group.id, session.id, 'guest_added', { player: host.display_name, playerId, guest: name, ...(status === 'waitlisted' ? { waitlisted: true } : {}) }, now);
  return { ok: true, guest: { name, status } };
}

/**
 * Take a host's guest off (the host or the organizer). Returns what came back as credit. `by` 'host' sends the organizer one Telegram line.
 */
export async function removeGuestCore(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, by: 'host' | 'organizer') {
  await needColumns(ctx);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled.');
  if (session.finalized_at) throw new HttpError(409, 'finalized', 'This game is finalized. Reopen it to change who played.');
  if (by === 'host' && ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This game already started. Ask Alex.');
  const roster = await loadRoster(ctx.db, session.id);
  const host = roster.find((r) => r.player_id === playerId);
  if (!host || !(guestIn(host) || guestWaiting(host))) throw new HttpError(409, 'no_guest', 'There is no guest to remove.');
  if (host.payment_status === 'paid' && !host.refunded_at && host.self_paid_at)
    throw new HttpError(
      409,
      'unconfirmed_paid',
      by === 'host' ? 'Your I paid is still waiting for the organizer. Ask the organizer to remove your guest.' : `${host.display_name} tapped I paid, not confirmed yet. Confirm it (Mark paid) or clear it first.`,
    );
  const guest = host.guest_name ?? 'Guest';
  const wasIn = guestIn(host);
  const now = ctx.nowIso;
  const settings = settingsOf(group);
  const organizerId = await organizerIdOf(ctx.db, group);
  // The seat goes back to one share: what it holds above that comes back as credit (the organizer's seat never holds group money).
  const trim =
    wasIn && playerId !== organizerId
      ? await trimSeatStatements(ctx.db, {
          groupId: group.id,
          sessionId: session.id,
          playerId,
          priceCents: flatOf(session, settings),
          nowIso: now,
          guard: `EXISTS (SELECT 1 FROM session_players g WHERE g.id = ${sqlText(host.id)} AND g.guest_status IS NULL AND g.guest_at = ${sqlText(now)} AND g.status = 'confirmed')`,
          seatStatus: 'confirmed',
          reason: 'dropped',
        })
      : { statements: [], backCents: 0 };
  const out = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE session_players SET guest_name = NULL, guest_status = NULL, guest_seq = NULL, guest_at = ?2, updated_at = ?2
         WHERE id = ?1 AND guest_status = ?3 AND guest_name = ?4 AND NOT (payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NOT NULL)`,
      )
      .bind(host.id, now, host.guest_status, guest),
    ...trim.statements,
  ]);
  if (out[0].meta.changes !== 1) throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  // A credit entry only goes in when this batch's own change held (its guard): read back what really came back.
  const back = trim.backCents > 0 ? await creditBackAt(ctx, session.id, playerId, now) : 0;
  await audit(ctx.db, group.id, session.id, 'guest_removed', { player: host.display_name, playerId, guest, by, ...(back > 0 ? { creditBackCents: back } : {}) }, now, by === 'host' ? host.display_name : 'organizer');
  if (back > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: host.display_name, playerId, amountCents: back, reason: 'dropped' }, now);
  if (wasIn) await settle(ctx.db, session, now, settings);
  if (by === 'host') await notifyGuestRemoved(ctx, group, session, host.display_name, guest);
  return { ok: true, guest, creditBackCents: back };
}

/** What came back to the host as credit at `now` from this game (cash that became credit, plus credit that went back to the pot). */
async function creditBackAt(ctx: Ctx, sessionId: string, playerId: string, now: string): Promise<number> {
  const row = await ctx.db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'kept' AND reason = 'dropped' AND created_at = ?3) +
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'used' AND COALESCE(reason, '') <> 'cash' AND ended_at = ?3 AND ended_reason = 'dropped') -
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'used' AND COALESCE(reason, '') <> 'cash' AND created_at = ?3 AND ended_at IS NULL) AS c`,
    )
    .bind(sessionId, playerId, now)
    .first<{ c: number }>();
  return Math.max(0, row?.c ?? 0);
}

/** DELETE-like POST /api/admin/sessions/:id/guest/remove { playerId }: the organizer takes a guest off (switch on or off: a guest can always be cleaned up). */
export async function adminRemoveGuest(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return removeGuestCore(ctx, group, session, v.id(body.playerId, 'playerId'), 'organizer');
}

/** "Rowan removed guest Sam from Thu Nov 12, 9:30 PM. 4 in now." One line to the organizer; never from the demo or Pretend. */
export function guestRemovedMessage(host: string, guest: string, when: string, n: number): string {
  return `${host} removed guest ${guest} from ${when}. ${n < 4 ? `${n} in now, under 4.` : `${n} in now.`}`;
}

async function notifyGuestRemoved(ctx: Ctx, group: GroupRow, session: SessionRow, host: string, guest: string) {
  try {
    if (ctx.env.SANDBOX || isPretend(ctx.db) || !connected(ctx.env)) return;
    const prefs = await prefsOfGroup(ctx.db, group.id);
    if (!prefs.enabled) return;
    const n = headCount(confirmedOf(await loadRoster(ctx.db, session.id)));
    ctx.waitUntil(deliver(ctx, group.id, guestRemovedMessage(host, guest, alertWhen(session.starts_at, group.timezone), n), true));
  } catch {
    // An alert is never worth failing a tap over.
  }
}
