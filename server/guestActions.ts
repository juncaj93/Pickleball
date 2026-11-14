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
import { audit, flatOf, getSession, type GroupRow, loadRoster, organizerIdOf, type SessionRow, settingsOf, sharesFor } from './repo';
import { applyPayment } from './admin';
import { moneyPicture } from './credit';
import { seatCredit } from '../shared/credit';
import { auditSubClears, settle, subClearStatements, subCleared } from './roster';
import { confirmedHeads, guestSpotFlags, hasGuestColumns, nextClaimSeq, setGuestSpotForAll, trimSeatStatements } from './guestSpot';
import { capOf } from '../shared/settings';
import { DB_LIMIT_MESSAGE } from '../shared/zip10';
import { cleanGuestName, GUEST_NAME_MAX, guestIn, guestWaiting, headCount, seatUnits, sharesPaid } from '../shared/guestSpot';
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
        `UPDATE session_players SET guest_name = ?2, guest_first = NULL, guest_played = NULL,
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
        `UPDATE session_players SET guest_name = NULL, guest_status = NULL, guest_seq = NULL, guest_first = NULL, guest_played = NULL, guest_at = ?2, updated_at = ?2
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

// ---------- Round 2: one person's $14 of a pair (Players sheet, each row its own Mark paid / Unmark) ----------
// The money stays ONE record on the host's seat. One share paid while the other still owes is the state the site already uses for "paid
// $14 of $28": the seat is unpaid with that $14 held against it as a 'cash' pair (the pot does not change), so it owes only the rest.
// `guest_first` says which person that held $14 belongs to (NULL or 0: the host). Paying the second share is the ordinary Mark paid (the
// seat paid in full); taking one share off a seat paid in full in cash leaves the other share held the same way.

/** POST /api/admin/sessions/:id/guest/share { playerId (the host), who: 'host' | 'guest', paid }. */
export async function setGuestShare(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  await needColumns(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  const playerId = v.id(body.playerId, 'playerId');
  const who = v.oneOf(body.who, 'who', ['host', 'guest'] as const);
  const paid = v.bool(body.paid, 'paid');
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'You pay the venue: there is no share to mark.');
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  if (!row || !guestIn(row) || seatUnits(row) !== 2) {
    // No pair any more (the guest came off, or did not play): the seat is one person, the ordinary Mark paid.
    if (who === 'guest') throw new HttpError(409, 'no_guest', 'There is no guest share to mark.');
    return applyPayment(ctx, group, session, playerId, paid, null);
  }
  const price = sharesFor(session, roster, settingsOf(group)).get(playerId);
  if (price === undefined) throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe money.');
  const half = Math.floor(price / 2);
  const ledger = (await moneyPicture(ctx.db, group, ctx.nowMs)).ledger;
  const seat = seatCredit(ledger, session.id, playerId, { paymentStatus: row.payment_status, paidAt: row.paid_at, refundedAt: row.refunded_at });
  const isPaid = row.payment_status === 'paid' && !row.refunded_at;
  const covered = isPaid ? (row.payment_amount_cents ?? 0) : seat.usedCents + seat.cashCents;
  const now = ctx.nowIso;
  const guestName = row.guest_name ?? 'Guest';
  const label = who === 'guest' ? `${guestName} (${row.display_name}'s guest)` : row.display_name;
  const state = isPaid ? { host: true, guest: true } : sharesPaid(covered, price, row.guest_first === 1);
  const mine = who === 'guest' ? state.guest : state.host;
  const other = who === 'guest' ? state.host : state.guest;
  const organizerId = await organizerIdOf(ctx.db, group);
  if (paid) {
    if (mine) return { ok: true, changed: false };
    // The other share is paid already: this one makes the seat paid in full (exactly what it still owes), the ordinary Mark paid.
    if (other) return applyPayment(ctx, group, session, playerId, true, null);
    // Neither is paid yet (the seat may hold a little credit): this person's share becomes the first one, covered up to one share.
    if (half >= price) return applyPayment(ctx, group, session, playerId, true, null);
    const asRead = `${session.finalized_at ?? ''}:${session.final_price_cents ?? -1}`;
    const out = await ctx.db.batch([
      // Paid with exactly this person's share on top of what the seat holds, and whose share it is ...
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ?2, self_paid_at = NULL, guest_first = ?7,
             payment_updated_at = ?1, updated_at = ?1
           WHERE session_id = ?3 AND player_id = ?4 AND status = 'confirmed' AND payment_status = 'unpaid' AND guest_status = 'confirmed'
             AND (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?3 AND player_id = ?4 AND ended_at IS NULL) = ?5
             AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ?3) = ?6
             AND (SELECT status FROM sessions WHERE id = ?3) <> 'canceled'`,
        )
        .bind(now, Math.max(covered, half), session.id, playerId, seat.usedCents + seat.cashCents, asRead, who === 'guest' ? 1 : 0),
      // ... then held against the seat, which owes only the other share (the same move as a price going up after a payment).
      ...holdShortCashStatements(ctx.db, { sessionId: session.id, feeCents: price, nowIso: now, playerId, organizerId, seatWhere: (sp) => `${sp}.payment_updated_at = ?1` }),
    ]);
    if (out[0].meta.changes !== 1) throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
    await audit(ctx.db, group.id, session.id, 'marked_paid', { player: label, playerId, ...(who === 'guest' ? { guest: guestName } : {}), amountCents: half, share: true }, now);
    return { ok: true, changed: true };
  }
  // Unmark one person's share.
  if (!mine) return { ok: true, changed: false };
  if (isPaid && row.self_paid_at) throw new HttpError(409, 'unconfirmed_paid', `${row.display_name} tapped I paid for both. Use Unmark on ${row.display_name}'s row.`);
  if (isPaid) {
    // Paid in full: only the latest cash can come off this way (credit on the seat stays as it is; Unmark on the host's row takes all of it).
    const latestCash = (row.payment_amount_cents ?? 0) - seat.usedCents - seat.cashCents;
    if (session.finalized_at || latestCash < half)
      throw new HttpError(409, 'use_host_unmark', `Part of this was paid with credit${session.finalized_at ? ', or the game is finalized' : ''}. Use Unmark on ${row.display_name}'s row.`);
    const out = await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_amount_cents = ?2, guest_first = ?6, payment_updated_at = ?1, updated_at = ?1
           WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NULL AND payment_amount_cents = ?5
             AND (SELECT finalized_at FROM sessions WHERE id = ?3) IS NULL`,
        )
        // The other person's share stays paid and becomes the first one.
        .bind(now, half, session.id, playerId, row.payment_amount_cents ?? 0, who === 'host' ? 1 : 0),
      ...holdShortCashStatements(ctx.db, { sessionId: session.id, feeCents: price, nowIso: now, playerId, organizerId, seatWhere: (sp) => `${sp}.payment_updated_at = ?1` }),
    ]);
    if (out[0].meta.changes !== 1) throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
  } else if (seat.cashCents > 0 && seat.usedCents === 0) {
    // One share held as cash: it goes (the payment never happened). The pot does not change (the pair nets to nothing).
    const out = await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'unmarked'
           WHERE session_id = ?2 AND player_id = ?3 AND ended_at IS NULL AND reason = 'cash'
             AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?2 AND player_id = ?3 AND payment_status = 'unpaid')`,
        )
        .bind(now, session.id, playerId),
      ctx.db.prepare('UPDATE session_players SET guest_first = NULL, updated_at = ?1 WHERE session_id = ?2 AND player_id = ?3').bind(now, session.id, playerId),
    ]);
    if (out[0].meta.changes === 0) throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
  } else {
    // Credit on the seat (used at sign-up, or with Use credit): the ordinary Unmark on the host's row puts it back in the pot.
    throw new HttpError(409, 'use_host_unmark', `That share was paid with credit. Use Unmark on ${row.display_name}'s row.`);
  }
  await audit(ctx.db, group.id, session.id, 'marked_unpaid', { player: label, playerId, ...(who === 'guest' ? { guest: guestName } : {}), amountCents: half, share: true }, now);
  return { ok: true, changed: true };
}
