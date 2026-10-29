// Finalizing a game: the organizer says who played, the final price is
// 4 x price / N rounded down to whole dollars, and whatever anyone paid above
// it comes back as credit. Reopen reverses it while that credit is untouched.
//
// Every money move is a guarded ledger entry (credit.ts); this file decides
// what each seat gets.

import { creditBack as creditBackCents, finalPrice } from '../shared/pricing';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { creditBack, holdCashAgainstSeat, repriceCreditSeats, undoCreditBack } from './credit';
import { HttpError } from './http';
import { audit, confirmedOf, getSession, type GroupRow, loadRoster, organizerIdOf, type SessionRow, settingsOf } from './repo';
import * as v from './validate';

/** Over, not canceled, not finalized, and someone was in (or paid): the Finalize card shows. */
export function needsFinalize(session: SessionRow, roster: { status: string; payment_status: string }[], nowMs: number): boolean {
  if (session.status === 'canceled' || session.finalized_at || nowMs < Date.parse(session.ends_at)) return false;
  return roster.some((r) => r.status === 'confirmed' || r.payment_status === 'paid');
}

/**
 * POST /api/admin/sessions/:id/finalize { played: playerId[] } (or { everyone: true }).
 * N counts the organizer when they played. For each other player who played:
 * due = final price; paid more comes back as credit, paid less is still owed.
 * Anyone who paid and did not play gets it all back as credit.
 */
export async function finalizeSession(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled, so there is nothing to finalize.');
  if (session.finalized_at) throw new HttpError(409, 'already_finalized', 'This game is already finalized. Reopen it to change who played.');
  if (ctx.nowMs < Date.parse(session.ends_at)) throw new HttpError(409, 'not_over', 'Finalize after the game ends.');
  const roster = await loadRoster(ctx.db, session.id);
  const confirmed = confirmedOf(roster);
  let playedIds: Set<string>;
  if (body.everyone === true) playedIds = new Set(confirmed.map((r) => r.player_id));
  else {
    if (!Array.isArray(body.played)) throw new HttpError(400, 'invalid_played', 'Say who played.');
    playedIds = new Set(body.played.map((x) => v.id(x, 'played')));
    for (const id of playedIds) if (!confirmed.some((r) => r.player_id === id)) throw new HttpError(400, 'invalid_played', 'Only people who were in can be marked as played.');
  }
  return applyFinalize(ctx, group, session, playedIds);
}

export async function applyFinalize(ctx: Ctx, group: GroupRow, session: SessionRow, playedIds: Set<string>) {
  const settings = settingsOf(group);
  const roster = await loadRoster(ctx.db, session.id);
  const confirmed = confirmedOf(roster);
  const organizerId = await organizerIdOf(ctx.db, group);
  const n = playedIds.size;
  const price = finalPrice(settings.pricePerPlayerCents, n);
  const res = await ctx.db
    .prepare('UPDATE sessions SET finalized_at = ?1, final_price_cents = ?2, final_played_count = ?3, updated_at = ?1 WHERE id = ?4 AND finalized_at IS NULL')
    .bind(ctx.nowIso, price, n, session.id)
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, 'already_finalized', 'This game is already finalized.');
  await ctx.db.batch(
    confirmed.map((r) =>
      ctx.db.prepare('UPDATE session_players SET played = ?, updated_at = ? WHERE id = ?').bind(playedIds.has(r.player_id) ? 1 : 0, ctx.nowIso, r.id),
    ),
  );
  const backs: { player: string; playerId: string; cents: number; reason: 'finalized' | 'not_played' }[] = [];
  for (const r of roster) {
    if (r.player_id === organizerId) continue;
    const paid = r.payment_status === 'paid' && !r.refunded_at ? (r.payment_amount_cents ?? 0) : 0;
    const played = r.status === 'confirmed' && playedIds.has(r.player_id);
    if (played) {
      // Credit used on an unpaid seat above the final price comes back too; the rest is settled by repricing below.
      const used = paid > 0 ? 0 : await usedOn(ctx, session.id, r.player_id);
      const back = paid > 0 ? paid - price : used - price;
      if (paid > 0 && paid < price) {
        // Paid the earlier (lower) price, or the flat price went up: the cash stays against the seat, the rest is owed.
        await holdCashAgainstSeat(ctx.db, { groupId: group.id, sessionId: session.id, playerId: r.player_id, cents: paid, nowIso: ctx.nowIso });
      } else if (back > 0) {
        if (paid === 0) {
          // Mark it paid with the credit (what they put in), then the overflow comes back.
          await ctx.db
            .prepare(
              `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ?2, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
               WHERE id = ?3 AND payment_status = 'unpaid'`,
            )
            .bind(ctx.nowIso, used, r.id)
            .run();
        }
        const ok = await creditBack(ctx.db, { groupId: group.id, sessionId: session.id, playerId: r.player_id, cents: back, reason: 'finalized', playedCount: n, nowIso: ctx.nowIso, settle: false });
        if (ok) backs.push({ player: r.display_name, playerId: r.player_id, cents: back, reason: 'finalized' });
      }
    } else if (paid > 0) {
      const ok = await creditBack(ctx.db, { groupId: group.id, sessionId: session.id, playerId: r.player_id, cents: paid, reason: 'not_played', nowIso: ctx.nowIso, settle: true });
      if (ok) backs.push({ player: r.display_name, playerId: r.player_id, cents: paid, reason: 'not_played' });
    }
  }
  // Unpaid seats whose used credit now covers the final price are paid.
  await repriceCreditSeats(ctx.db, session.id, ctx.nowIso);
  await audit(ctx.db, group.id, session.id, 'session_finalized', { played: n, priceCents: price, creditBackCents: backs.reduce((s, b) => s + b.cents, 0) }, ctx.nowIso);
  for (const b of backs) await audit(ctx.db, group.id, session.id, 'credit_back', { player: b.player, playerId: b.playerId, amountCents: b.cents, reason: b.reason }, ctx.nowIso);
  return { ok: true, played: n, priceCents: price, creditBack: backs.map((b) => ({ playerId: b.playerId, cents: b.cents })) };
}

async function usedOn(ctx: Ctx, sessionId: string, playerId: string): Promise<number> {
  const row = await ctx.db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
    .bind(sessionId, playerId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * Who stops a reopen: players whose credit from this game is no longer all
 * in their pot (some was used or refunded). Empty means Reopen is allowed.
 */
export async function reopenBlockers(ctx: Ctx, sessionId: string): Promise<string[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT p.display_name AS name, SUM(l.amount_cents) AS back,
         (SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0)
            FROM credit_ledger x WHERE x.player_id = l.player_id AND x.ended_at IS NULL) AS pot
       FROM credit_ledger l JOIN players p ON p.id = l.player_id
       WHERE l.kind = 'kept' AND l.session_id = ? AND l.ended_at IS NULL AND l.reason IN ('finalized', 'not_played')
       GROUP BY l.player_id ORDER BY p.display_name`,
    )
    .bind(sessionId)
    .all<{ name: string; back: number; pot: number }>();
  return results.filter((r) => r.pot < r.back).map((r) => r.name);
}

/**
 * POST /api/admin/sessions/:id/reopen: undo the finalize so it can be redone.
 * Only while none of the credit it issued was used or refunded.
 */
export async function reopenFinalize(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  if (!session.finalized_at) throw new HttpError(409, 'not_finalized', 'This game is not finalized.');
  const blockers = await reopenBlockers(ctx, session.id);
  if (blockers.length) {
    throw new HttpError(409, 'credit_spent', `Can't reopen: ${blockers.join(' and ')} already used or got back credit from this game.`);
  }
  const roster = await loadRoster(ctx.db, session.id);
  for (const r of roster) {
    const res = await undoCreditBack(ctx.db, session.id, r.player_id, ['finalized', 'not_played'], ctx.nowIso);
    if (res.blocked) throw new HttpError(409, 'credit_spent', `Can't reopen: ${r.display_name} already used or got back credit from this game.`);
  }
  await ctx.db.batch([
    ctx.db.prepare('UPDATE sessions SET finalized_at = NULL, final_price_cents = NULL, final_played_count = NULL, updated_at = ? WHERE id = ?').bind(ctx.nowIso, session.id),
    ctx.db.prepare('UPDATE session_players SET played = NULL, updated_at = ? WHERE session_id = ? AND played IS NOT NULL').bind(ctx.nowIso, session.id),
  ]);
  // Seats paid with credit at the final price are short of the flat price again.
  await repriceCreditSeats(ctx.db, session.id, ctx.nowIso);
  await audit(ctx.db, group.id, session.id, 'finalize_reopened', {}, ctx.nowIso);
  return { ok: true };
}

/** For the Finalize card preview: what each N means at the current price. */
export function previewFor(priceCents: number, n: number) {
  return { played: n, priceCents: finalPrice(priceCents, n), creditBackCents: creditBackCents(priceCents, n) };
}
