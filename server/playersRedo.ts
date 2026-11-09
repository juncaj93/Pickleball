import type { Ctx } from './context';
import type { D1Database } from './db';
import { requireAdmin } from './auth';
import { HttpError } from './http';
import { spentByPlayer } from './adminR3';
import { spentTotalsFlags } from './spentTotals';
import { MEMBERSHIP_FROM } from '../shared/moneyRework';
import { zip13For } from './zip13';
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
async function organizerSpent(ctx: Ctx, group: GroupRow, year: number, month: number, matchTotals = false): Promise<number> {
  const m = await monthMoneyOf(ctx, group, year, month, true);
  // "Spent matches Totals" (Zip 27, A-05): the "So far" total itself, owed to the venue minus what the players paid. Below $0 is a credit
  // month (the players paid more than the venue was owed), the way Totals shows it; before, it stopped at $0.
  if (matchTotals) return m.rework ? m.rework.owedToVenueCents - m.rework.collectedCents : 0;
  return m.rework?.yourCostCents ?? 0;
}

/**
 * The months before this one that can have a "Your cost so far" above $0: a month with a finalized or canceled game, and (Zip 13) every month
 * from October 2026, which pays the membership anyway. A month before October with neither is $0 and is not read at all.
 */
async function pastMonthsWithGames(ctx: Ctx, group: GroupRow): Promise<{ year: number; month: number }[]> {
  const { results } = await ctx.db
    .prepare("SELECT starts_at FROM sessions WHERE group_id = ? AND starts_at < ? AND (finalized_at IS NOT NULL OR status = 'canceled')")
    .bind(group.id, monthRange(localParts(ctx.nowMs, group.timezone).year, localParts(ctx.nowMs, group.timezone).month, group.timezone).from)
    .all<{ starts_at: string }>();
  const seen = new Map<string, { year: number; month: number }>();
  for (const r of results) {
    const p = localParts(Date.parse(r.starts_at), group.timezone);
    seen.set(`${p.year}-${p.month}`, { year: p.year, month: p.month });
  }
  // From October 2026 every month pays the membership, games or not (Money Totals counts it), so each of those months is read too.
  const now = localParts(ctx.nowMs, group.timezone);
  for (let y = MEMBERSHIP_FROM.year, m = MEMBERSHIP_FROM.month; y < now.year || (y === now.year && m < now.month); m === 12 ? ((m = 1), y++) : m++) {
    seen.set(`${y}-${m}`, { year: y, month: m });
  }
  return [...seen.values()];
}

/** GET /api/admin/players/:id/summary: the details sheet's month and All time cards. Read only. */
export async function playerSummary(ctx: Ctx): Promise<PlayerSummary> {
  const group = await requireAdmin(ctx);
  // Only while the Players redo is on for this phone: with it off the address does not exist, as on main.
  if (!(await zip13For(ctx, group.id, 'playersRedo'))) throw new HttpError(404, 'not_found', 'Not found.');
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
  const matchTotals = (await spentTotalsFlags(ctx, group.id)).on;
  if (id === organizerId) {
    monthSpent = await organizerSpent(ctx, group, now.year, now.month, matchTotals);
    allSpent = monthSpent;
    for (const m of await pastMonthsWithGames(ctx, group)) allSpent += await organizerSpent(ctx, group, m.year, m.month, matchTotals);
  } else {
    monthSpent = (await spentByPlayer(ctx.db, group.id, organizerId, range, matchTotals)).get(id) ?? 0;
    allSpent = (await spentByPlayer(ctx.db, group.id, organizerId, undefined, matchTotals)).get(id) ?? 0;
  }
  return {
    month: { label: `${MONTHS[now.month - 1]} ${now.year}`, played: monthPlayed, spentCents: monthSpent },
    allTime: { played: allPlayed, spentCents: allSpent },
    organizer: id === organizerId,
  };
}
