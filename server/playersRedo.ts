import type { Ctx } from './context';
import type { D1Database } from './db';
import { requireAdmin } from './auth';
import { HttpError } from './http';
import { spentByPlayer } from './adminR3';
import { monthMoneyOf } from './money';
import { type GroupRow, organizerIdOf } from './repo';
import * as v from './validate';
import { localParts, zonedTimeToUtc } from '../shared/time';
import type { PlayerSummary } from '../shared/api';

// Players redo (PLAYERS_REDO, Zip 13): the numbers on the new Players list and in a player's details sheet. Read only: nothing here
// writes, charges, credits or sends anything.
//
// Where each number comes from (no new money math):
//  - "played": the same rule the old list used for its all-time "N played" (in, game not canceled, game over, not marked "did not play"
//    at Finalize), counted for this month only on the list and the details sheet's month card, and ever on its All time card.
//  - a player's "Spent": the same rule the old round 3 list used for "$108 spent" (money paid for games played and finalized, minus what
//    came back as credit), this month and ever.
//  - the organizer's own "Spent": the Money tab's Totals "Your cost so far" for the month (membership + court costs - what players paid,
//    never below $0), and for All time the sum of that number over every month from the first game to now. One source for both screens.

/** The first and last moment (UTC, ISO) of a calendar month in the group's time zone. */
export function monthRange(year: number, month: number, tz: string): { from: string; to: string } {
  return {
    from: new Date(zonedTimeToUtc(year, month, 1, 0, 0, tz)).toISOString(),
    to: new Date(zonedTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, 0, 0, tz)).toISOString(),
  };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Games played, per player, with the old list's rule, optionally only for games that start inside `range`. */
export async function playedCounts(db: D1Database, groupId: string, nowIso: string, range?: { from: string; to: string }): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT sp.player_id AS id, COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND sp.status = 'confirmed' AND s.status <> 'canceled' AND s.ends_at <= ? AND (sp.played IS NULL OR sp.played = 1)
       AND s.starts_at >= ? AND s.starts_at < ? GROUP BY sp.player_id`,
    )
    .bind(groupId, nowIso, range?.from ?? '0000', range?.to ?? '9999')
    .all<{ id: string; n: number }>();
  return new Map(results.map((r) => [r.id, Number(r.n)]));
}

/** This month's games played per player, for the list rows. */
export async function monthPlayedCounts(ctx: Ctx, group: GroupRow): Promise<{ counts: Map<string, number>; label: string }> {
  const p = localParts(ctx.nowMs, group.timezone);
  return { counts: await playedCounts(ctx.db, group.id, ctx.nowIso, monthRange(p.year, p.month, group.timezone)), label: `${MONTHS[p.month - 1]} ${p.year}` };
}

/** The organizer's "Spent" = Money Totals "Your cost so far", month by month. */
async function organizerSpent(ctx: Ctx, group: GroupRow, year: number, month: number): Promise<number> {
  const m = await monthMoneyOf(ctx, group, year, month, true);
  return m.rework?.yourCostCents ?? 0;
}

/** The months from the first game (or the first session date, whichever is earlier) up to this one, oldest first. */
async function monthsSoFar(ctx: Ctx, group: GroupRow): Promise<{ year: number; month: number }[]> {
  const first = await ctx.db.prepare('SELECT MIN(starts_at) AS at FROM sessions WHERE group_id = ?').bind(group.id).first<{ at: string | null }>();
  const now = localParts(ctx.nowMs, group.timezone);
  if (!first?.at) return [{ year: now.year, month: now.month }];
  const f = localParts(Date.parse(first.at), group.timezone);
  const out: { year: number; month: number }[] = [];
  let y = f.year;
  let mo = f.month;
  // Never more than 10 years of months (a guard; the site started in 2026).
  while ((y < now.year || (y === now.year && mo <= now.month)) && out.length < 120) {
    out.push({ year: y, month: mo });
    mo++;
    if (mo === 13) {
      mo = 1;
      y++;
    }
  }
  return out;
}

/** GET /api/admin/players/:id/summary: the details sheet's month and All time cards. Read only. */
export async function playerSummary(ctx: Ctx): Promise<PlayerSummary> {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const exists = await ctx.db.prepare('SELECT id FROM players WHERE id = ? AND group_id = ?').bind(id, group.id).first();
  if (!exists) throw new HttpError(404, 'player_not_found', 'Player not found.');
  const tz = group.timezone;
  const now = localParts(ctx.nowMs, tz);
  const range = monthRange(now.year, now.month, tz);
  const organizerId = await organizerIdOf(ctx.db, group);
  const monthPlayed = (await playedCounts(ctx.db, group.id, ctx.nowIso, range)).get(id) ?? 0;
  const allPlayed = (await playedCounts(ctx.db, group.id, ctx.nowIso)).get(id) ?? 0;
  let monthSpent: number;
  let allSpent: number;
  if (id === organizerId) {
    monthSpent = await organizerSpent(ctx, group, now.year, now.month);
    allSpent = 0;
    for (const m of await monthsSoFar(ctx, group)) allSpent += m.year === now.year && m.month === now.month ? monthSpent : await organizerSpent(ctx, group, m.year, m.month);
  } else {
    monthSpent = (await spentByPlayer(ctx.db, group.id, organizerId, range)).get(id) ?? 0;
    allSpent = (await spentByPlayer(ctx.db, group.id, organizerId)).get(id) ?? 0;
  }
  return {
    month: { label: `${MONTHS[now.month - 1]} ${now.year}`, played: monthPlayed, spentCents: monthSpent },
    allTime: { played: allPlayed, spentCents: allSpent },
    organizer: id === organizerId,
  };
}
