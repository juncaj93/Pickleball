// What the credit pot does when someone taps: a player's "Use credit", "Undo",
// "Request refund" and "Cancel request"; the organizer's "Mark refunded",
// "Not now" and "Refund credit balance". The database work is in credit.ts;
// the rules (who may, how much) are here.

import { potBalance, seatKey, usableCredit } from '../shared/credit';
import { notifyRefundRequest } from './alerts';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { newId } from './crypto';
import { loadPendingRequests, moneyPicture, refundCredit, returnSeatCredit, spendCredit, undoRefund } from './credit';
import { HttpError } from './http';
import { audit, type GroupRow, loadRoster, organizerIdOf, pricesFor, type SessionRow, settingsOf } from './repo';
import * as v from './validate';

/** What a player can spend or ask back right now: the pot minus any pending request. */
export async function usableFor(ctx: Ctx, group: GroupRow, playerId: string) {
  const pic = await moneyPicture(ctx.db, group, ctx.nowMs);
  const potCents = potBalance(pic.ledger, playerId);
  const reservedCents = pic.reserved.get(playerId) ?? 0;
  return { potCents, reservedCents, usableCents: usableCredit(potCents, reservedCents), pic };
}

/**
 * A player taps "Use credit" on a game they owe for. It takes the smaller of
 * their usable credit and what they owe, never more. When that covers
 * everything, the game is paid ("Paid with credit"); otherwise they pay the rest as usual.
 */
export async function useCreditOn(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, name: string) {
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'There is nothing for you to pay here.');
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  const price = pricesFor(session, roster, settingsOf(group)).get(playerId);
  if (!row || row.status !== 'confirmed' || row.payment_status !== 'unpaid' || !price) {
    throw new HttpError(409, 'nothing_owed', 'You do not owe anything for this game.');
  }
  const { usableCents, pic } = await usableFor(ctx, group, playerId);
  const alreadyUsed = pic.spent.get(seatKey(session.id, playerId)) ?? 0;
  const owed = price.cents - alreadyUsed;
  if (owed <= 0) throw new HttpError(409, 'nothing_owed', 'You do not owe anything for this game.');
  if (usableCents <= 0) throw new HttpError(409, 'no_credit', 'You have no credit to use.');
  const cents = Math.min(usableCents, owed);
  const full = cents === owed;
  const done = await spendCredit(ctx.db, {
    groupId: group.id,
    sessionId: session.id,
    playerId,
    cents,
    alreadyUsed,
    // The payment is the whole price (cash plus credit), so credit used for a game is collected in the month it is played.
    payInFull: full ? { paidCents: price.cents } : null,
    nowIso: ctx.nowIso,
  });
  if (!done) throw new HttpError(409, 'credit_changed', 'Your credit changed. Look again and tap Use credit.');
  await audit(ctx.db, group.id, session.id, 'credit_used', { player: name, amountCents: cents, paidInFull: full }, ctx.nowIso, name);
  // What the player reads next: how much of their credit this took, what is left of it, what is left to pay.
  return { ok: true, usedCents: cents, paid: full, potBeforeCents: usableCents, owedBeforeCents: owed };
}

/**
 * "Undo" under "Paid with credit": the credit goes back to the player's balance and the
 * game is owed again. Only for a game paid entirely with credit; no cash moves.
 */
export async function undoCreditUse(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, name: string) {
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  if (!row || row.payment_status !== 'paid') throw new HttpError(409, 'nothing_to_undo', 'There is no credit payment to undo.');
  const used = await ctx.db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
    .bind(session.id, playerId)
    .first<{ c: number }>();
  const cents = used?.c ?? 0;
  if (cents <= 0 || cents < (row.payment_amount_cents ?? 0)) throw new HttpError(409, 'nothing_to_undo', 'There is no credit payment to undo.');
  const back = await returnSeatCredit(ctx.db, session.id, playerId, ctx.nowIso, 'undone');
  await audit(ctx.db, group.id, session.id, 'credit_undone', { player: name, amountCents: back }, ctx.nowIso, name);
  return { ok: true, returnedCents: back };
}

// ---------- Refund requests (the player asks for cash back) ----------

/**
 * POST /api/me/refund-request { cents }: ask for some or all of the credit
 * back. The amount is reserved until the organizer answers. One open request
 * at a time; cancel it to make a new one.
 */
export async function requestRefund(ctx: Ctx, group: GroupRow, playerId: string, name: string, body: Record<string, unknown>) {
  const cents = v.cents(body.cents, 'cents');
  if (cents === null || cents <= 0 || cents % 100 !== 0) throw new HttpError(400, 'invalid_cents', 'Enter a whole-dollar amount.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'You have no credit to refund.');
  const { usableCents, reservedCents } = await usableFor(ctx, group, playerId);
  if (reservedCents > 0) throw new HttpError(409, 'request_open', 'You already have a refund request waiting. Cancel it to make a new one.');
  if (cents > usableCents) throw new HttpError(409, 'not_enough_credit', `You have ${Math.floor(usableCents / 100)} dollars of credit.`);
  const id = newId();
  try {
    await ctx.db
      .prepare('INSERT INTO refund_requests (id, group_id, player_id, amount_cents, status, created_at) VALUES (?, ?, ?, ?, \'pending\', ?)')
      .bind(id, group.id, playerId, cents, ctx.nowIso)
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'request_open', 'You already have a refund request waiting. Cancel it to make a new one.');
    throw err;
  }
  await audit(ctx.db, group.id, null, 'refund_requested', { player: name, playerId, amountCents: cents }, ctx.nowIso, name);
  await notifyRefundRequest(ctx, group, name, cents);
  return { ok: true, request: { id, cents, at: ctx.nowIso } };
}

/** POST /api/me/refund-request/cancel: the player takes their request back; the amount is usable again. */
export async function cancelRefundRequest(ctx: Ctx, group: GroupRow, playerId: string, name: string) {
  const res = await ctx.db
    .prepare("UPDATE refund_requests SET status = 'canceled', resolved_at = ? WHERE player_id = ? AND group_id = ? AND status = 'pending'")
    .bind(ctx.nowIso, playerId, group.id)
    .run();
  if (res.meta.changes > 0) await audit(ctx.db, group.id, null, 'refund_request_canceled', { player: name, playerId }, ctx.nowIso, name);
  return { ok: true, changed: res.meta.changes > 0 };
}

/**
 * POST /api/admin/refund-requests/:id { action }: "refunded" after the
 * organizer opened Venmo (the amount comes off their credit, the request
 * closes), "not_now" (the amount is usable again, the card goes), or "undo"
 * (takes the last Mark refunded back). Opening Venmo never does any of this.
 */
export async function resolveRefundRequest(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'request');
  const action = v.oneOf(body.action, 'action', ['refunded', 'not_now', 'undo'] as const);
  const req = await ctx.db
    .prepare('SELECT r.*, p.display_name FROM refund_requests r JOIN players p ON p.id = r.player_id WHERE r.id = ? AND r.group_id = ?')
    .bind(id, group.id)
    .first<{ id: string; player_id: string; amount_cents: number; status: string; display_name: string }>();
  if (!req) throw new HttpError(404, 'request_not_found', 'That request is gone.');
  if (action === 'undo') {
    const undone = await undoRefund(ctx.db, req.player_id, ctx.nowIso);
    if (undone) await audit(ctx.db, group.id, null, 'credit_refund_undone', { player: req.display_name, playerId: req.player_id }, ctx.nowIso);
    return { ok: true, changed: undone };
  }
  if (req.status !== 'pending') throw new HttpError(409, 'request_closed', 'That request was already answered.');
  if (action === 'not_now') {
    await ctx.db.prepare("UPDATE refund_requests SET status = 'declined', resolved_at = ? WHERE id = ? AND status = 'pending'").bind(ctx.nowIso, id).run();
    await audit(ctx.db, group.id, null, 'refund_request_declined', { player: req.display_name, playerId: req.player_id }, ctx.nowIso);
    return { ok: true, changed: true };
  }
  const done = await refundCredit(ctx.db, { groupId: group.id, playerId: req.player_id, cents: req.amount_cents, requestId: id, nowIso: ctx.nowIso });
  if (!done) throw new HttpError(409, 'credit_changed', 'Their credit changed. Look again.');
  await audit(ctx.db, group.id, null, 'credit_refund_marked', { player: req.display_name, playerId: req.player_id, amountCents: req.amount_cents }, ctx.nowIso);
  return { ok: true, changed: true };
}

/**
 * POST /api/admin/players/:id/credit-refund { refunded: true, cents } after
 * the organizer opened Venmo for `cents` from the Players tab: the usable
 * balance (pot minus any pending request) drops to $0. Only if `cents` is
 * still that balance. { refunded: false } takes the last refund back.
 */
export async function refundCreditBalance(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const playerId = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'You have no credit to pay back.');
  if (!v.bool(body.refunded, 'refunded')) {
    const undone = await undoRefund(ctx.db, playerId, ctx.nowIso);
    if (undone) await audit(ctx.db, group.id, null, 'credit_refund_undone', { player: p.display_name, playerId }, ctx.nowIso);
    return { ok: true, changed: undone };
  }
  const cents = v.cents(body.cents, 'cents');
  const { usableCents } = await usableFor(ctx, group, playerId);
  if (usableCents <= 0) throw new HttpError(409, 'no_credit', 'They have no credit to pay back.');
  if (cents !== usableCents) throw new HttpError(409, 'credit_changed', 'Their credit changed. Open Venmo again for the new amount.');
  const done = await refundCredit(ctx.db, { groupId: group.id, playerId, cents: usableCents, requestId: null, nowIso: ctx.nowIso });
  if (!done) throw new HttpError(409, 'credit_changed', 'Their credit changed. Open Venmo again for the new amount.');
  await audit(ctx.db, group.id, null, 'credit_refund_marked', { player: p.display_name, playerId, amountCents: usableCents }, ctx.nowIso);
  return { ok: true, changed: true };
}

/** The organizer's Home cards: every pending request with the player's saved Venmo. */
export async function pendingRequestViews(ctx: Ctx, group: GroupRow) {
  const reqs = await loadPendingRequests(ctx.db, group.id);
  if (reqs.length === 0) return [];
  const { results } = await ctx.db.prepare('SELECT id, display_name, venmo_handle FROM players WHERE group_id = ?').bind(group.id).all<{ id: string; display_name: string; venmo_handle: string | null }>();
  const byId = new Map(results.map((p) => [p.id, p]));
  return reqs.map((r) => ({ id: r.id, playerId: r.player_id, name: byId.get(r.player_id)?.display_name ?? '?', cents: r.amount_cents, createdAt: r.created_at, venmo: byId.get(r.player_id)?.venmo_handle ?? null }));
}
