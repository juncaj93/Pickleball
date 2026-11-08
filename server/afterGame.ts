import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import type { CreditRow } from '../shared/credit';
import type { AfterGameCredit } from '../shared/api';
import { AFTER_GAME_CARD, afterGameAllowed, afterGameFresh } from '../shared/afterGame';
import type { SessionRow } from './repo';

// Zip 16: AFTER_GAME_CARD (shared/afterGame.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?aftergame=on
//    (it then sends X-After-Game-Card: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Display only: no price, seat, credit or text reads it, so the private link is safe on any phone. It only reads the player's own rows.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, AFTER_GAME_CARD.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const afterGameCardForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setAfterGameCardForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, AFTER_GAME_CARD.task).run();
  if (on) {
    await db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)")
      .bind(newId(), groupId, AFTER_GAME_CARD.task, nowIso)
      .run();
  }
}

/** "After-game cards" for this request: the kill switch allows it, and the Settings row is on or this phone has the private test link. */
export async function afterGameCardFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!afterGameAllowed(ctx.env.AFTER_GAME_CARD)) return false;
  if ((ctx.req.headers.get(AFTER_GAME_CARD.header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

/**
 * This player's own credit back from Finalize in the last 7 days: the live ledger rows (kind 'kept', reason 'finalized'), exactly as
 * written, with their game's date and stored final price. A row a Reopen or an Unmark ended is left out. Games the screen did not load
 * (more than 90 days back) are left out too: no card rather than a card without its game.
 */
export function afterGameCredits(ledger: CreditRow[], sessions: Pick<SessionRow, 'id' | 'starts_at' | 'final_price_cents'>[], playerId: string, nowMs: number): AfterGameCredit[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const out: AfterGameCredit[] = [];
  for (const r of ledger) {
    if (r.playerId !== playerId || r.kind !== 'kept' || r.reason !== 'finalized' || r.endedAt || !r.sessionId || r.cents <= 0) continue;
    if (!afterGameFresh(r.createdAt, nowMs)) continue;
    const s = byId.get(r.sessionId);
    if (!s) continue;
    out.push({
      id: r.id,
      sessionId: r.sessionId,
      startsAt: s.starts_at,
      cents: r.cents,
      finalPriceCents: s.final_price_cents ?? null,
      playedCount: r.playedCount ?? null,
      at: r.createdAt,
    });
  }
  return out;
}
