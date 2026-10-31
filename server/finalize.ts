// Finalizing a game: the organizer says who played, the final price is
// 4 x price / N rounded down to whole dollars, and whatever anyone paid above
// it comes back as credit. Reopen reverses it while that credit is untouched.
//
// Every money move is a guarded ledger entry (credit.ts); this file decides
// what each seat gets.

import { reopenRequestedReason } from '../shared/credit';
import { creditBack as creditBackCents, finalPrice } from '../shared/pricing';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { creditBackStatements, holdCashStatements, repriceStatements, USABLE } from './credit';
import { HttpError } from './http';
import { audit, confirmedOf, getSession, type GroupRow, loadRoster, organizerIdOf, type RosterRow, type SessionRow, settingsOf } from './repo';
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

/** A value put straight into SQL text (an id or a time this server made), refused if it could break out of quotes. */
export function sqlText(value: string): string {
  if (!/^[0-9A-Za-z:.\-]+$/.test(value)) throw new Error('unsafe sql text');
  return `'${value}'`;
}

/** The seats and the credit on them, as one string: finalize and reopen only go ahead if nothing changed since they looked. */
const MONEY_STATE = (sessionId: string) =>
  `(SELECT COALESCE(group_concat(x, '|'), '') FROM (SELECT id || ':' || status || ':' || payment_status || ':' || COALESCE(payment_amount_cents, '') || ':' || COALESCE(refunded_at, '') AS x
      FROM session_players WHERE session_id = ${sqlText(sessionId)} ORDER BY id))
   || '#' || (SELECT COUNT(*) || ':' || COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ${sqlText(sessionId)} AND ended_at IS NULL)`;

async function moneyState(ctx: Ctx, sessionId: string): Promise<string> {
  return (await ctx.db.prepare(`SELECT ${MONEY_STATE(sessionId)} AS s`).first<{ s: string }>())?.s ?? '';
}

/**
 * Everything finalizing does happens in ONE batch: the game is marked
 * finalized only if no seat or credit changed since it was read, and every
 * other statement only runs if that mark went in. So a double tap, a player
 * paying at the same moment, or a request cut off halfway can never leave a
 * game half-finalized.
 */
export async function applyFinalize(ctx: Ctx, group: GroupRow, session: SessionRow, playedIds: Set<string>) {
  const settings = settingsOf(group);
  const state = await moneyState(ctx, session.id);
  const roster = await loadRoster(ctx.db, session.id);
  const confirmed = confirmedOf(roster);
  const organizerId = await organizerIdOf(ctx.db, group);
  const n = playedIds.size;
  const price = finalPrice(settings.pricePerPlayerCents, n);
  const now = ctx.nowIso;
  const claimed = `EXISTS (SELECT 1 FROM sessions WHERE id = ${sqlText(session.id)} AND finalized_at = ${sqlText(now)})`;
  const statements = [
    ctx.db
      .prepare(
        `UPDATE sessions SET finalized_at = ?1, final_price_cents = ?2, final_played_count = ?3, updated_at = ?1
         WHERE id = ?4 AND finalized_at IS NULL AND status <> 'canceled' AND ${MONEY_STATE(session.id)} = ?5`,
      )
      .bind(now, price, n, session.id, state),
    ...confirmed.map((r) =>
      ctx.db.prepare(`UPDATE session_players SET played = ?, updated_at = ? WHERE id = ? AND ${claimed}`).bind(playedIds.has(r.player_id) ? 1 : 0, now, r.id),
    ),
  ];
  const backs: { player: string; playerId: string; cents: number; reason: 'finalized' | 'not_played' }[] = [];
  const base = { groupId: group.id, sessionId: session.id, nowIso: now, guard: claimed };
  /** Mark an unpaid seat paid with the credit on it (what they put in), so money above the price can come back. */
  const payWithCredit = (r: RosterRow, used: number) =>
    ctx.db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ?2, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
         WHERE id = ?3 AND payment_status = 'unpaid' AND ${claimed}`,
      )
      .bind(now, used, r.id);
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
        statements.push(...holdCashStatements(ctx.db, { ...base, playerId: r.player_id, cents: paid }));
      } else if (back > 0) {
        if (paid === 0) statements.push(payWithCredit(r, used));
        statements.push(...creditBackStatements(ctx.db, { ...base, playerId: r.player_id, cents: back, reason: 'finalized', playedCount: n, settle: false }));
        backs.push({ player: r.display_name, playerId: r.player_id, cents: back, reason: 'finalized' });
      }
    } else if (paid > 0) {
      statements.push(...creditBackStatements(ctx.db, { ...base, playerId: r.player_id, cents: paid, reason: 'not_played', settle: true }));
      backs.push({ player: r.display_name, playerId: r.player_id, cents: paid, reason: 'not_played' });
    } else if (r.status === 'confirmed' && r.payment_status === 'unpaid') {
      // Did not play with credit on a seat that still owed the rest (credit used at sign-up): that credit comes back.
      // The seat is marked paid with it first, the same way a played seat is, so Reopen can take it back the same way.
      const used = await usedOn(ctx, session.id, r.player_id);
      if (used > 0) {
        statements.push(payWithCredit(r, used));
        statements.push(...creditBackStatements(ctx.db, { ...base, playerId: r.player_id, cents: used, reason: 'not_played', settle: true }));
        backs.push({ player: r.display_name, playerId: r.player_id, cents: used, reason: 'not_played' });
      }
    }
  }
  // Unpaid seats whose used credit now covers the final price are paid.
  statements.push(...repriceStatements(ctx.db, session.id, settings.pricePerPlayerCents, now));
  const [claim] = await ctx.db.batch(statements);
  if (claim.meta.changes !== 1) {
    const fresh = await getSession(ctx.db, group.id, session.id);
    if (fresh?.finalized_at) throw new HttpError(409, 'already_finalized', 'This game is already finalized.');
    if (fresh?.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled, so there is nothing to finalize.');
    throw new HttpError(409, 'changed', 'Someone just changed this game. Look again and finalize.');
  }
  await audit(ctx.db, group.id, session.id, 'session_finalized', { played: n, priceCents: price, creditBackCents: backs.reduce((s, b) => s + b.cents, 0) }, now);
  for (const b of backs) await audit(ctx.db, group.id, session.id, 'credit_back', { player: b.player, playerId: b.playerId, amountCents: b.cents, reason: b.reason }, now);
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
 * Who stops a reopen. `spent`: players whose credit from this game is no
 * longer all in their pot (some was used or refunded). `requested`: players
 * who still have it, but a pending refund request is holding part of it.
 * Both empty means Reopen is allowed.
 */
export async function reopenBlockers(ctx: Ctx, sessionId: string): Promise<{ spent: string[]; requested: string[] }> {
  const { results } = await ctx.db
    .prepare(
      `SELECT p.display_name AS name, SUM(l.amount_cents) AS back,
         (SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0)
            FROM credit_ledger x WHERE x.player_id = l.player_id AND x.ended_at IS NULL) AS pot,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM refund_requests r WHERE r.player_id = l.player_id AND r.status = 'pending') AS reserved
       FROM credit_ledger l JOIN players p ON p.id = l.player_id
       WHERE l.kind = 'kept' AND l.session_id = ? AND l.ended_at IS NULL AND l.reason IN ('finalized', 'not_played')
       GROUP BY l.player_id ORDER BY p.display_name`,
    )
    .bind(sessionId)
    .all<{ name: string; back: number; pot: number; reserved: number }>();
  return {
    spent: results.filter((r) => r.pot < r.back).map((r) => r.name),
    requested: results.filter((r) => r.pot >= r.back && r.pot - r.reserved < r.back).map((r) => r.name),
  };
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
  if (blockers.spent.length) {
    throw new HttpError(409, 'credit_spent', `Can't reopen: ${blockers.spent.join(' and ')} already used or got back credit from this game.`);
  }
  if (blockers.requested.length) throw new HttpError(409, 'refund_requested', reopenRequestedReason(blockers.requested));
  // One batch, all or nothing. The credit this game gave back is taken back only while every player still has
  // all of theirs (beyond a pending cash out); the game is unfinalized only once none of it is left; seats paid
  // with credit at the final price are short of the flat price again.
  const now = ctx.nowIso;
  const backRows = `credit_ledger.kind = 'kept' AND credit_ledger.session_id = ?2 AND credit_ledger.ended_at IS NULL AND credit_ledger.reason IN ('finalized', 'not_played')`;
  const allThere = `NOT EXISTS (SELECT 1 FROM (SELECT player_id, SUM(amount_cents) AS back FROM credit_ledger
      WHERE kind = 'kept' AND session_id = ?2 AND ended_at IS NULL AND reason IN ('finalized', 'not_played') GROUP BY player_id) b
    WHERE ${USABLE('b.player_id')} < b.back)`;
  const [taken, , unfinalized] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'undone' WHERE ${backRows} AND ${allThere}`).bind(now, session.id),
    ctx.db
      .prepare(
        `UPDATE session_players SET refunded_at = NULL, updated_at = ?1 WHERE session_id = ?2 AND refunded_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'kept' AND l.session_id = ?2 AND l.player_id = session_players.player_id
                         AND l.reason = 'not_played' AND l.ended_at = ?1 AND l.ended_reason = 'undone')`,
      )
      .bind(now, session.id),
    ctx.db
      .prepare(
        `UPDATE sessions SET finalized_at = NULL, final_price_cents = NULL, final_played_count = NULL, updated_at = ?1
         WHERE id = ?2 AND finalized_at = ?3 AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE ${backRows})`,
      )
      .bind(now, session.id, session.finalized_at),
    ctx.db.prepare('UPDATE session_players SET played = NULL, updated_at = ?1 WHERE session_id = ?2 AND played IS NOT NULL AND (SELECT finalized_at FROM sessions WHERE id = ?2) IS NULL').bind(now, session.id),
    ...repriceStatements(ctx.db, session.id, settingsOf(group).pricePerPlayerCents, now),
  ]);
  if (unfinalized.meta.changes !== 1) {
    if (taken.meta.changes === 0) {
      const late = await reopenBlockers(ctx, session.id);
      if (late.requested.length) throw new HttpError(409, 'refund_requested', reopenRequestedReason(late.requested));
      if (late.spent.length) throw new HttpError(409, 'credit_spent', `Can't reopen: ${late.spent.join(' and ')} already used or got back credit from this game.`);
    }
    throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  }
  await audit(ctx.db, group.id, session.id, 'finalize_reopened', {}, ctx.nowIso);
  return { ok: true };
}

/** For the Finalize card preview: what each N means at the current price. */
export function previewFor(priceCents: number, n: number) {
  return { played: n, priceCents: finalPrice(priceCents, n), creditBackCents: creditBackCents(priceCents, n) };
}
