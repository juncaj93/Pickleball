// What the credit pot does when someone taps: a player's "Use credit", and the
// organizer's "Keep as credit" and "Refund credit balance". The database work
// is in credit.ts; the rules (who may, how much) are here.

import { potBalance, seatKey } from '../shared/credit';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { keepAsCredit, moneyPicture, refundPot, returnSeatCredit, spendCredit, undoKeep, undoRefundPot } from './credit';
import { HttpError } from './http';
import { audit, getSession, type GroupRow, loadRoster, openCredits, organizerIdOf, pricesFor, type SessionRow, settingsOf } from './repo';
import * as v from './validate';

/**
 * A player taps "Use credit" on a game they owe for. It takes the smaller of
 * their credit and what they owe, never more. When that covers everything, the
 * game is paid ("Paid with credit"); otherwise they pay the rest as usual.
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
  const pic = await moneyPicture(ctx.db, group, ctx.nowMs);
  const key = seatKey(session.id, playerId);
  const five = pic.plan.get(key) ?? { cents: 0, ids: [] };
  const alreadyUsed = pic.spent.get(key) ?? 0;
  const owed = price.cents - alreadyUsed - five.cents;
  const balance = potBalance(pic.ledger, playerId);
  if (owed <= 0) throw new HttpError(409, 'nothing_owed', 'You do not owe anything for this game.');
  if (balance <= 0) throw new HttpError(409, 'no_credit', 'You have no credit to use.');
  const cents = Math.min(balance, owed);
  const full = cents === owed;
  const done = await spendCredit(ctx.db, {
    groupId: group.id,
    sessionId: session.id,
    playerId,
    cents,
    alreadyUsed,
    // The payment counts everything above the older $5 credit, so credit used for a game is collected in the month it is played.
    payInFull: full ? { paidCents: price.cents - five.cents, fiveCreditIds: five.ids } : null,
    nowIso: ctx.nowIso,
  });
  if (!done) throw new HttpError(409, 'credit_changed', 'Your credit changed. Look again and tap Use credit.');
  await audit(ctx.db, group.id, session.id, 'credit_used', { player: name, amountCents: cents, paidInFull: full }, ctx.nowIso, name);
  // What the player reads next: how much of their credit this took, what is left of it, what is left to pay.
  return { ok: true, usedCents: cents, paid: full, potBeforeCents: balance, owedBeforeCents: owed };
}

/** POST /api/admin/sessions/:id/credit { playerId, keep }: Keep as credit (true), or take it back (false). */
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

export async function keepCredit(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  const playerId = v.id(body.playerId, 'playerId');
  const keep = v.bool(body.keep, 'keep');
  const row = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
  if (!row || row.payment_status !== 'paid') throw new HttpError(409, 'not_paid', 'Only someone who paid can have credit kept.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'Your own court payment is not credit.');
  if (keep) {
    if (session.status !== 'canceled' && row.status !== 'withdrawn') {
      throw new HttpError(409, 'still_playing', 'That payment is for a game they are still in.');
    }
    const { cents } = await keepAsCredit(ctx.db, group.id, session.id, playerId, ctx.nowIso);
    await audit(ctx.db, group.id, session.id, 'credit_kept', { player: row.display_name, playerId, amountCents: cents }, ctx.nowIso);
    return { ok: true, changed: true };
  }
  const undone = await undoKeep(ctx.db, session.id, playerId, ctx.nowIso);
  if (undone) await audit(ctx.db, group.id, session.id, 'credit_kept_undone', { player: row.display_name, playerId }, ctx.nowIso);
  return { ok: true, changed: undone };
}

/** What "Refund credit balance" pays back for a player: the pot plus any older $5 credit not matched to a game they owe for. */
export async function refundable(ctx: Ctx, group: GroupRow, playerId: string) {
  const pic = await moneyPicture(ctx.db, group, ctx.nowMs);
  const planned = new Set([...pic.plan.values()].flatMap((p) => p.ids));
  const fives = openCredits(pic.credits).filter((c) => c.playerId === playerId && !planned.has(c.id));
  const potCents = potBalance(pic.ledger, playerId);
  const fiveCents = fives.reduce((sum, c) => sum + c.amountCents, 0);
  return { potCents, fiveCents, fiveCreditIds: fives.map((c) => c.id), totalCents: potCents + fiveCents };
}

/**
 * POST /api/admin/players/:id/credit-refund { refunded: true, cents } after
 * the organizer opened Venmo for `cents`: the balance drops to $0. Only if
 * `cents` is still their balance. { refunded: false } takes the last one back.
 * Opening Venmo never does this.
 */
export async function refundCreditBalance(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const playerId = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'You have no credit to pay back.');
  if (!v.bool(body.refunded, 'refunded')) {
    const undone = await undoRefundPot(ctx.db, playerId, ctx.nowIso);
    if (undone) await audit(ctx.db, group.id, null, 'credit_refund_undone', { player: p.display_name, playerId }, ctx.nowIso);
    return { ok: true, changed: undone };
  }
  const cents = v.cents(body.cents, 'cents');
  const now = await refundable(ctx, group, playerId);
  if (now.totalCents <= 0) throw new HttpError(409, 'no_credit', 'They have no credit to pay back.');
  if (cents !== now.totalCents) throw new HttpError(409, 'credit_changed', 'Their credit changed. Open Venmo again for the new amount.');
  const done = await refundPot(ctx.db, {
    groupId: group.id,
    playerId,
    potCents: now.potCents,
    fiveCents: now.fiveCents,
    fiveCreditIds: now.fiveCreditIds,
    nowIso: ctx.nowIso,
  });
  if (!done) throw new HttpError(409, 'credit_changed', 'Their credit changed. Open Venmo again for the new amount.');
  await audit(ctx.db, group.id, null, 'credit_refund_marked', { player: p.display_name, playerId, amountCents: now.totalCents }, ctx.nowIso);
  return { ok: true, changed: true };
}
