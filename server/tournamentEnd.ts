// Zip 58 (🎾58.tourney4), "Tournaments" piece 4 of 4: End tournament (pictures 37 and 41 to 43), the awards (medals and credit), the winners
// banner (the slim ticker, pictures 38 to 40), the one-time congratulations card, medals next to names (26, 28), and each tournament's saved
// results (History > Tournaments, 46; the admin Players sheet's TOURNAMENTS card, 47).
//
// The money: Locked doubles gives each of the two winners the champion credit stored on the tournament ($14 to start; $0 skips it). Americano
// gives 1st place the champion credit and a medal, 2nd place the 2nd place credit (no medal). Each is ONE credit_ledger row, kind 'kept', reason
// 'tour:<tournament id>:champion' or ':second', no game: exactly how the site already keeps tournament credit (shared/credit.ts reads it, the
// credit history says "Tournament champion" or "Tournament 2nd place"). Granted once: the rows are written only by the one batch whose
// random end key landed on the tournament (a double tap or a retry finds the key taken and writes nothing), and migration 0029's unique index
// refuses a second award row for the same player and tournament whatever writes it. The organizer pays the venue and never holds credit (the
// site's rule): an organizer who wins gets the medal, not the credit.
//
// After End tournament the tournament's status is 'ended': it is no open tournament any more, so every tap on its games, teams, results and
// tickets finds nothing open and changes nothing (server/tournament.ts openById and playerTarget), and Home is back to normal.
//
// Who sees what: the ticker, the congratulations and medals reach a player only while the switch is on for them, and only from a tournament
// they could see (Everyone; Only me only on the organizer's own signed-in phone, and never as medals). Levels never reach a player.
import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit, type GroupRow, organizerIdOf, type ReadSpec } from './repo';
import { formatPrice } from '../shared/money';
import {
  type AdminEndView,
  type AwardPick,
  BANNER_WEEKS,
  bannerLabel,
  DEFAULT_BANNER_WEEKS,
  MAX_PRICE_CENTS,
  placeWord,
  type PlayerTournamentsView,
  type TickerView,
  type TourAwardsView,
  type TournamentFormat,
  type TournamentHistoryView,
} from '../shared/tournament';
import { americanoOutcome } from './americanoDay';
import { doublesOutcome, type DayRows, loadDay } from './tournamentDay';
import { keptOff, loadTickets, sqlText, ticketBackStatements, type TicketWithName } from './tournamentMoney';
import { logPlayer, organizerOn, openById, styleDecided, type SignupRow, type TournamentActor, type TournamentRow, tournamentsFlags } from './tournament';
import { organizerSignedIn } from './zip13';
import { ADMIN_COOKIE } from './context';
import { VIEW_ONLY_COOKIE_PREFIX } from './viewOnly';

/** The newest change to any game of the night (End is refused if a result changed after the card was read: review). */
const lastGameChange = (day: DayRows): string | null => day.games.reduce<string | null>((m, g) => (m === null || g.updated_at > m ? g.updated_at : m), null);

/** The ledger reason of an award. */
export const awardReason = (tournamentId: string, award: 'champion' | 'second'): string => `tour:${tournamentId}:${award}`;

export type EndRow = TournamentRow & { banner_weeks?: number | null; award_pick?: string | null; end_key?: string | null; ended_at?: string | null; banner_until?: string | null };

function pickOf(t: EndRow): { first?: string; second?: string } {
  try {
    const v = JSON.parse(t.award_pick ?? 'null');
    return v && typeof v === 'object' ? { ...(typeof v.first === 'string' ? { first: v.first } : {}), ...(typeof v.second === 'string' ? { second: v.second } : {}) } : {};
  } catch {
    return {};
  }
}

const weeksOf = (t: EndRow): number => (BANNER_WEEKS as readonly number[]).includes(t.banner_weeks ?? 0) ? t.banner_weeks! : DEFAULT_BANNER_WEEKS;
const plusList = (xs: string[]) => xs.join(' + ');

/** One player's place in the saved results (what End tournament writes). */
interface ResultRow {
  playerId: string;
  finish: number | null;
  wins: number;
  losses: number;
  points: number | null;
  teamName: string | null;
  partnerId: string | null;
  medal: boolean;
  award: 'champion' | 'second' | null;
  creditCents: number;
}

/** What End tournament will do, worked out from the night as it stands: the card, and the rows Confirm writes. */
export interface EndPlan {
  view: AdminEndView;
  results: ResultRow[];
}

/**
 * The End card (null until the Final, or every round, is in). `format`: the style the night is played in. `orgId`: the organizer's own player
 * (a medal, never credit).
 */
export function endPlan(t: EndRow, format: TournamentFormat, signups: readonly SignupRow[], tickets: readonly TicketWithName[], day: DayRows, tz: string, nowMs: number, orgId: string | null): EndPlan | null {
  if (t.status !== 'tickets' || !t.final_date || !styleDecided(t, nowMs)) return null;
  // Admin speed rule: nothing more is worked out until the rows say the night could be over (the Final has a result, or, Americano, every
  // stored game has one). The full check follows.
  const hasResult = (g: { winner: string | null; claim: string | null; skipped: number }) => !!g.winner || !!g.claim || !!g.skipped;
  if (format === 'doubles' ? !day.games.some((g) => g.stage === 'final' && hasResult(g)) : !day.games.length || !day.games.every(hasResult)) return null;
  const names = new Map<string, string>();
  for (const s of signups) names.set(s.player_id, s.display_name);
  for (const k of tickets) names.set(k.player_id, k.display_name);
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? 'A player') : 'A player');
  const pick = pickOf(t);
  const weeks = weeksOf(t);
  const championCents = t.champion_credit_cents;
  const secondCents = t.second_credit_cents ?? 0;
  // An I paid still waiting: the organizer answers it first (only confirmed money is real; after the end nothing on the ticket can change).
  const waiting = tickets.filter((k) => k.claim_cents > 0).map((k) => k.display_name);
  const blocked = waiting.length ? `${waiting.join(', ')} tapped I paid. Confirm or undo it first.` : undefined;
  const credit = (id: string, cents: number) => (id === orgId ? 0 : cents);

  if (format === 'doubles') {
    if (!t.teams_at) return null;
    const o = doublesOutcome(t, day, tz, nowMs);
    if (!o.ready || o.champion === null) return null;
    const team = (seat: number) => o.teams.find((x) => x.seat === seat);
    const playersOf = (seat: number) => {
      const x = team(seat);
      return x ? [x.player_a, x.player_b].filter((id): id is string => !!id).map(nameOf) : [];
    };
    const asPick = (seat: number): AwardPick => ({ key: String(seat), name: team(seat)?.name ?? `Team ${seat}`, players: playersOf(seat) });
    const firstSeat = pick.first && team(Number(pick.first)) && !o.out.has(Number(pick.first)) ? Number(pick.first) : o.champion;
    const champ = asPick(o.champion);
    const done = {
      kicker: 'Final is done',
      title: `${champ.name} won`,
      sub: o.runnerUp !== null ? `${plusList(champ.players!)} beat ${asPick(o.runnerUp).name} (${plusList(playersOf(o.runnerUp))}).` : `${plusList(champ.players!)} won the Final.`,
    };
    const winners = [team(firstSeat)?.player_a, team(firstSeat)?.player_b].filter((id): id is string => !!id);
    const order = [firstSeat, ...o.order.filter((s) => s !== firstSeat)];
    const results: ResultRow[] = [];
    for (const x of o.teams) {
      const finish = o.out.has(x.seat) ? null : order.indexOf(x.seat) + 1 || null;
      const rec = o.record.get(x.seat) ?? { wins: 0, losses: 0 };
      for (const [id, partner] of [
        [x.player_a, x.player_b],
        [x.player_b, x.player_a],
      ] as [string | null, string | null][]) {
        if (!id) continue;
        const won = x.seat === firstSeat;
        results.push({ playerId: id, finish, wins: rec.wins, losses: rec.losses, points: null, teamName: x.name, partnerId: partner, medal: won, award: won ? 'champion' : null, creditCents: won ? credit(id, championCents) : 0 });
      }
    }
    const org = winners.find((id) => id === orgId);
    return {
      view: {
        format,
        hero: 'Final',
        done,
        first: asPick(firstSeat),
        second: null,
        third: o.third !== null && o.third !== firstSeat ? asPick(o.third) : null,
        championCents,
        secondCents,
        weeks,
        choices: o.teams.filter((x) => !o.out.has(x.seat)).map((x) => asPick(x.seat)),
        ...(org && championCents > 0 ? { noCredit: nameOf(org) } : {}),
        ...(blocked ? { blocked } : {}),
        seen: JSON.stringify([String(firstSeat), null, championCents, secondCents, weeks]),
      },
      results,
    };
  }

  // Americano: the points table.
  const o = americanoOutcome(t, signups, tickets, day.games, tz, nowMs);
  if (!o.ready || o.table.length < 2) return null;
  const ids = o.table.map((r) => r.id);
  const firstId = pick.first && ids.includes(pick.first) ? pick.first : ids[0];
  const secondId = pick.second && ids.includes(pick.second) && pick.second !== firstId ? pick.second : ids.find((x) => x !== firstId)!;
  const order = [firstId, secondId, ...ids.filter((x) => x !== firstId && x !== secondId)];
  const asPick = (id: string): AwardPick => ({ key: id, name: nameOf(id) });
  const results: ResultRow[] = o.table.map((r) => ({
    playerId: r.id,
    finish: o.gone.has(r.id) && r.id !== firstId && r.id !== secondId ? null : order.indexOf(r.id) + 1,
    wins: r.wins,
    losses: r.losses,
    points: r.points,
    teamName: null,
    partnerId: null,
    medal: r.id === firstId,
    award: r.id === firstId ? 'champion' : r.id === secondId ? 'second' : null,
    creditCents: r.id === firstId ? credit(r.id, championCents) : r.id === secondId ? credit(r.id, secondCents) : 0,
  }));
  const org = [firstId, secondId].find((id) => id === orgId && (id === firstId ? championCents : secondCents) > 0);
  return {
    view: {
      format,
      hero: `Round ${o.rounds} of ${o.rounds}`,
      done: { kicker: `Round ${o.rounds} is done`, title: `${nameOf(ids[0])} finished first`, sub: `${nameOf(ids[1])} was second.` },
      first: asPick(firstId),
      second: asPick(secondId),
      third: null,
      championCents,
      secondCents,
      weeks,
      choices: ids.map(asPick),
      ...(org ? { noCredit: nameOf(org) } : {}),
      ...(blocked ? { blocked } : {}),
      seen: JSON.stringify([firstId, secondId, championCents, secondCents, weeks]),
    },
    results,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's taps: Edit awards (Save), Confirm winners and end
// ---------------------------------------------------------------------------------------------------------------------

const bad = (code: string, message: string): never => {
  throw new HttpError(409, code, message);
};

function cents(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_PRICE_CENTS || n % 100 !== 0) throw new HttpError(400, 'invalid_cents', `${label}: whole dollars from $0 to ${formatPrice(MAX_PRICE_CENTS)}.`);
  return n;
}

/** Everything End tournament needs, read fresh for a write. */
export async function readNight(ctx: Ctx, t: TournamentRow) {
  const db = ctx.db;
  const [s] = await db.batch([
    db.prepare(`SELECT s.*, p.display_name, p.is_active, NULL AS first_level FROM tournament_signups s JOIN players p ON p.id = s.player_id WHERE s.tournament_id = ? ORDER BY s.joined_at, s.rowid`).bind(t.id),
  ]);
  const tickets = await loadTickets(db, t.id);
  const day = await loadDay(db, t.id);
  return { signups: s.results as unknown as SignupRow[], tickets, day };
}

/** The style the night is played in (the stored one: the night has started, so it no longer switches). */
const formatOf = (t: TournamentRow): TournamentFormat => (t.format === 'americano' ? 'americano' : 'doubles');

/**
 * POST /api/admin/tournament/:id/awards { action, ... }: the organizer's End tournament card.
 *   save { first, second?, championCents, secondCents?, weeks }   Edit awards: the winners (Change), the credit amounts, the banner (1 to 4 weeks)
 *   end { seen }                                                    Confirm winners and end: medals, credit, the banner, results saved, all locked
 */
export async function awardsAction(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = (await openById(ctx, group)) as EndRow;
  const action = v.oneOf(body.action, 'action', ['save', 'end'] as const);
  const night = await readNight(ctx, t);
  const orgId = await organizerIdOf(ctx.db, group);
  const plan = endPlan(t, formatOf(t), night.signups, night.tickets, night.day, group.timezone, ctx.nowMs, orgId);
  if (!plan) bad('not_ready', formatOf(t) === 'americano' ? 'The last round is not in yet.' : 'The Final is not in yet.');
  const view = plan!.view;
  const nowIso = ctx.nowIso;

  if (action === 'save') {
    const keys = view.choices.map((c) => c.key);
    const first = typeof body.first === 'string' && keys.includes(body.first) ? body.first : bad('invalid_pick', 'Pick the winners again.');
    const second = view.format === 'americano' ? (typeof body.second === 'string' && keys.includes(body.second) && body.second !== first ? body.second : bad('invalid_pick', 'Pick 2nd place again.')) : null;
    const champion = cents(body.championCents, view.format === 'americano' ? '1st place credit' : 'Credit for each winner');
    const secondCents = view.format === 'americano' ? cents(body.secondCents, '2nd place credit') : (t.second_credit_cents ?? 0);
    const weeks = Number(body.weeks);
    if (!(BANNER_WEEKS as readonly number[]).includes(weeks)) throw new HttpError(400, 'invalid_weeks', 'Pick 1 to 4 weeks.');
    const pickJson = JSON.stringify({ first, ...(second ? { second } : {}) });
    const res = await ctx.db
      .prepare(
        "UPDATE tournaments SET champion_credit_cents = ?, second_credit_cents = ?, banner_weeks = ?, award_pick = ?, updated_at = ? WHERE id = ? AND status = 'tickets' AND end_key IS NULL",
      )
      .bind(champion, secondCents, weeks, pickJson, nowIso, t.id)
      .run();
    if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    const nameOf = (k: string | null) => view.choices.find((c) => c.key === k)?.name ?? '';
    const words = [
      view.format === 'americano' ? `1st ${nameOf(first)}, 2nd ${nameOf(second)}` : `winners ${nameOf(first)}`,
      `${formatPrice(champion)}${view.format === 'americano' ? ` and ${formatPrice(secondCents)}` : ' each'}`,
      `banner ${bannerLabel(weeks)}`,
    ].join(', ');
    await audit(ctx.db, group.id, null, 'tournament_awards', { tournament: t.name, words }, nowIso);
    return { ok: true };
  }

  // end: exactly what the card showed, nothing waiting.
  if (view.blocked) bad('claim_waiting', view.blocked);
  if (body.seen !== view.seen) bad('tournament_changed', 'This just changed. Look again.');
  return writeEnd(ctx, group, t, night, plan!);
}

/**
 * Confirm winners and end: ONE all-or-nothing batch. The tournament takes a fresh random end key and becomes 'ended'; every other row (the
 * saved results, the award credit, unused standby holds back as credit) is written only by the batch whose key landed, so a double tap or a
 * retry writes nothing more. Also used by the preview's Tournament test page ("Tournament ended"), so it runs exactly this code.
 */
export async function writeEnd(ctx: Ctx, group: GroupRow, t: EndRow, night: Awaited<ReturnType<typeof readNight>>, plan: EndPlan) {
  const view = plan.view;
  const nowIso = ctx.nowIso;
  const key = newId();
  const weeks = view.weeks;
  const until = new Date(ctx.nowMs + weeks * 7 * 86_400_000).toISOString();
  const mine = `(SELECT end_key FROM tournaments WHERE id = ${sqlText(t.id)}) = ${sqlText(key)}`;
  const levels = new Map(night.signups.map((s) => [s.player_id, s]));
  // Unused holds (standby that never got a spot) come back as credit now, as they would at the end of the night: the tournament is over. A
  // standby player who took over on a team played for their hold (Zip 57), so theirs never comes back.
  const played = t.teams_at
    ? (x: string) => ` AND NOT EXISTS (SELECT 1 FROM tournament_teams tm WHERE tm.tournament_id = ${x}.tournament_id AND (tm.player_a = ${x}.player_id OR tm.player_b = ${x}.player_id))`
    : () => '';
  // Zip 70: a kept late drop's money stays with the night (never an unused hold).
  const when = (x: string) => `(${x}.place <> 'spot' AND NOT ${keptOff(x)} AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${x}.tournament_id AND tt.end_key = ${sqlText(key)})${played(x)})`;
  const awards = plan.results.filter((r) => r.award && r.creditCents > 0);
  const statements = [
    ctx.db
      .prepare(
        `UPDATE tournaments SET status = 'ended', ended_at = ?, end_key = ?, banner_until = ?, updated_at = ?
         WHERE id = ? AND status = 'tickets' AND end_key IS NULL AND champion_credit_cents = ? AND second_credit_cents = ? AND COALESCE(banner_weeks, ?) = ?
           AND award_pick IS ?
           AND (SELECT MAX(updated_at) FROM tournament_games WHERE tournament_id = tournaments.id) IS ?`,
      )
      .bind(nowIso, key, until, nowIso, t.id, view.championCents, view.secondCents, DEFAULT_BANNER_WEEKS, weeks, t.award_pick ?? null, lastGameChange(night.day)),
    ...plan.results.map((r) =>
      ctx.db
        .prepare(
          `INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, team_name, partner_id, picked_level, approved_level, medal, award, credit_cents, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${mine}`,
        )
        .bind(
          newId(),
          t.id,
          r.playerId,
          r.finish,
          r.wins,
          r.losses,
          r.points,
          r.teamName,
          r.partnerId,
          levels.get(r.playerId)?.picked_level ?? null,
          levels.get(r.playerId)?.approved_level ?? null,
          r.medal ? 1 : 0,
          r.award,
          r.creditCents,
          nowIso,
        ),
    ),
    // The award credit: one 'kept' row each (no game), the site's own pot. The unique index refuses a second one for this tournament.
    ...awards.map((r) =>
      ctx.db
        .prepare(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) SELECT ?, ?, ?, 'kept', ?, 0, NULL, ?, ? WHERE ${mine}`)
        .bind(newId(), group.id, r.playerId, r.creditCents, nowIso, awardReason(t.id, r.award!)),
    ),
    ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId: null, why: 'unused', endedReason: 'canceled', nowIso, when }),
  ];
  const res = await ctx.db.batch(statements);
  if ((res[0].meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
  const nameOf = (id: string) => night.signups.find((s) => s.player_id === id)?.display_name ?? night.tickets.find((k) => k.player_id === id)?.display_name ?? 'A player';
  const words =
    view.format === 'americano'
      ? `1st ${view.first.name} (medal${awards.find((r) => r.award === 'champion') ? `, ${formatPrice(view.championCents)}` : ''}), 2nd ${view.second?.name ?? ''}${awards.find((r) => r.award === 'second') ? ` (${formatPrice(view.secondCents)})` : ''}`
      : `${view.first.name} (${(view.first.players ?? []).join(' + ')}), a medal each${awards.length ? `, ${awards.map((r) => `${nameOf(r.playerId)} ${formatPrice(r.creditCents)}`).join(', ')}` : ''}`;
  await audit(ctx.db, group.id, null, 'tournament_ended', { tournament: t.name, words: `${words}, banner ${bannerLabel(weeks)}`, creditCents: awards.reduce((s, r) => s + r.creditCents, 0) }, nowIso);
  return { ok: true, granted: awards.map((r) => ({ playerId: r.playerId, cents: r.creditCents })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// A player's Home after the end: the ticker, the congratulations card, medals
// ---------------------------------------------------------------------------------------------------------------------

/** The three small reads (in the screen's own batch while the switch is on): the banners up now, their winners, and every medal. */
export function awardsReads(groupId: string, nowMs: number): ReadSpec[] {
  const now = new Date(nowMs).toISOString();
  return [
    {
      sql: "SELECT id, name, format, visibility, ended_at FROM tournaments WHERE group_id = ? AND status = 'ended' AND banner_until > ? ORDER BY ended_at DESC, id LIMIT 3",
      values: [groupId, now],
    },
    {
      sql: `SELECT r.tournament_id, r.player_id, r.award, r.medal, r.team_name, r.credit_cents, r.seen_at, p.display_name FROM tournament_results r JOIN players p ON p.id = r.player_id
            WHERE r.award IS NOT NULL AND r.tournament_id IN (SELECT id FROM tournaments WHERE group_id = ? AND status = 'ended' AND banner_until > ?) ORDER BY r.rowid`,
      values: [groupId, now],
    },
    {
      // Medals are permanent and count across tournaments; only from tournaments everyone could see.
      sql: `SELECT p.display_name AS name, COUNT(*) AS n FROM tournament_results r JOIN tournaments t ON t.id = r.tournament_id JOIN players p ON p.id = r.player_id
            WHERE t.group_id = ? AND t.status = 'ended' AND t.visibility = 'all' AND r.medal = 1 GROUP BY r.player_id ORDER BY p.display_name`,
      values: [groupId],
    },
  ];
}

export interface AwardsPre {
  banners: { id: string; name: string; format: string; visibility: string; ended_at: string }[];
  winners: { tournament_id: string; player_id: string; award: string; medal: number; team_name: string | null; credit_cents: number; seen_at: string | null; display_name: string }[];
  medals: { name: string; n: number }[];
}

export const awardsFrom = (res: { results?: unknown[] }[]): AwardsPre => ({
  banners: (res[0]?.results ?? []) as AwardsPre['banners'],
  winners: (res[1]?.results ?? []) as AwardsPre['winners'],
  medals: (res[2]?.results ?? []) as AwardsPre['medals'],
});

async function readAwards(db: D1Database, groupId: string, nowMs: number): Promise<AwardsPre> {
  try {
    const reads = awardsReads(groupId, nowMs);
    return awardsFrom(await db.batch(reads.map((r) => db.prepare(r.sql).bind(...r.values))));
  } catch {
    return { banners: [], winners: [], medals: [] };
  }
}

/** Only me: the organizer's own player on the organizer's own signed-in phone (or the organizer's View as of their own player). */
async function onlyMeOk(ctx: Ctx, group: GroupRow, playerId: string, viewAs: boolean): Promise<boolean> {
  if (playerId !== (await organizerIdOf(ctx.db, group))) return false;
  if (viewAs) return true;
  const token = ctx.cookies[ADMIN_COOKIE];
  if (!token || token.startsWith(VIEW_ONLY_COOKIE_PREFIX)) return false;
  return organizerSignedIn(ctx, group.id);
}

/**
 * GET /api/group `tourAwards`: the ticker (the newest tournament whose banner is still up), this player's congratulations card (until Nice), and
 * medals by name. Null when there is nothing (the answer then has no key at all) or the switch is off for this phone.
 */
export async function playerAwardsFor(ctx: Ctx, group: GroupRow, playerId: string | null, viewAs: boolean, pre?: AwardsPre): Promise<TourAwardsView | null> {
  if (!playerId) return null;
  if (!pre && !(await tournamentsFlags(ctx, group.id)).on) return null;
  const a = pre ?? (await readAwards(ctx.db, group.id, ctx.nowMs));
  if (!a.banners.length && !a.medals.length) return null;
  const meOk = a.banners.some((b) => b.visibility !== 'all') ? await onlyMeOk(ctx, group, playerId, viewAs) : false;
  const banners = a.banners.filter((b) => b.visibility === 'all' || meOk);
  const medals: Record<string, number> = {};
  for (const m of a.medals) medals[m.name] = Number(m.n);
  const medalsOf = (name: string) => Math.max(1, medals[name] ?? 0);
  const out: TourAwardsView = {};
  const b = banners[0];
  if (b) {
    const ws = a.winners.filter((w) => w.tournament_id === b.id);
    const champs = ws.filter((w) => w.award === 'champion');
    const second = ws.find((w) => w.award === 'second');
    const ticker: TickerView =
      b.format === 'americano'
        ? {
            key: `ticker:${b.id}`,
            name: b.name,
            format: 'americano',
            ...(champs[0] ? { winner: { name: champs[0].display_name, medals: medalsOf(champs[0].display_name) } } : {}),
            ...(second ? { runnerUp: { name: second.display_name, medals: medals[second.display_name] ?? 0 } } : {}),
          }
        : {
            key: `ticker:${b.id}`,
            name: b.name,
            format: 'doubles',
            champions: { team: champs[0]?.team_name ?? '', players: champs.map((w) => ({ name: w.display_name, medals: medalsOf(w.display_name) })) },
          };
    out.ticker = ticker;
  }
  // The congratulations card: this player's own award, from any tournament whose banner is still up, until they tap Nice.
  const mine = a.winners.find((w) => w.player_id === playerId && !w.seen_at && banners.some((x) => x.id === w.tournament_id));
  if (mine) {
    const t = banners.find((x) => x.id === mine.tournament_id)!;
    const money = mine.credit_cents > 0 ? `${formatPrice(mine.credit_cents)} credit toward your next game` : '';
    out.congrats =
      mine.award === 'champion'
        ? { key: `won:${t.id}`, tournamentId: t.id, title: `You won ${t.name}`, sub: money ? `${money}, plus a medal next to your name.` : 'A medal next to your name.' }
        : { key: `second:${t.id}`, tournamentId: t.id, title: `Second place, ${t.name}`, sub: money ? `${money}.` : 'Great playing.' };
  }
  if (Object.keys(medals).length) out.medals = medals;
  return Object.keys(out).length ? out : null;
}

/** POST /api/tournament/award-seen { tournamentId }: Nice on the congratulations card (once; the card does not come back). */
export async function awardSeen(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const view = await playerAwardsFor(ctx, who.group, who.playerId, !!who.viewAsName);
  const id = v.id(body.tournamentId, 'tournamentId');
  if (!view?.congrats || view.congrats.tournamentId !== id) return { ok: true, changed: false };
  const res = await ctx.db.prepare('UPDATE tournament_results SET seen_at = ? WHERE tournament_id = ? AND player_id = ? AND seen_at IS NULL').bind(ctx.nowIso, id, who.playerId).run();
  if ((res.meta?.changes ?? 0) > 0) {
    const t = await ctx.db.prepare('SELECT name FROM tournaments WHERE id = ?').bind(id).first<{ name: string }>();
    await logPlayer(ctx, who.group, who.playerId, 'tournament_award_seen', { tournament: t?.name ?? 'tournament' });
  }
  return { ok: true, changed: (res.meta?.changes ?? 0) > 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's records: History > Tournaments, and the Players sheet's TOURNAMENTS card
// ---------------------------------------------------------------------------------------------------------------------

/** Hidden tournaments (Zip 59) stay out of the records too. */
const NOT_HIDDEN = `NOT EXISTS (SELECT 1 FROM task_log h WHERE h.session_id IS NULL AND h.task = 'tournament_hidden:' || t.id AND h.kind IN ('mark', 'sent') AND h.kind = 'mark')`;

/** GET /api/admin/tournament-history: finished tournaments (newest first) and wins by player. */
export async function tournamentHistory(ctx: Ctx): Promise<TournamentHistoryView> {
  const group = await organizerOn(ctx);
  const [ts, rs] = await ctx.db.batch([
    ctx.db.prepare(`SELECT t.id, t.name, t.final_date, t.format, t.ended_at FROM tournaments t WHERE t.group_id = ? AND t.status = 'ended' AND ${NOT_HIDDEN} ORDER BY t.final_date DESC, t.ended_at DESC`).bind(group.id),
    ctx.db
      .prepare(
        `SELECT r.tournament_id, r.player_id, r.finish, r.medal, r.award, r.team_name, p.display_name FROM tournament_results r JOIN tournaments t ON t.id = r.tournament_id JOIN players p ON p.id = r.player_id
         WHERE t.group_id = ? AND t.status = 'ended' AND ${NOT_HIDDEN} ORDER BY r.rowid`,
      )
      .bind(group.id),
  ]);
  const tours = ts.results as { id: string; name: string; final_date: string | null; format: string; ended_at: string }[];
  const rows = rs.results as { tournament_id: string; player_id: string; finish: number | null; medal: number; award: string | null; team_name: string | null; display_name: string }[];
  const tournaments = tours.map((t) => {
    const mine = rows.filter((r) => r.tournament_id === t.id);
    const champs = mine.filter((r) => r.award === 'champion');
    const second = mine.find((r) => r.award === 'second');
    const format: TournamentFormat = t.format === 'americano' ? 'americano' : 'doubles';
    return {
      id: t.id,
      name: t.name,
      date: t.final_date,
      format,
      players: mine.length,
      first: champs.length ? (format === 'doubles' ? { name: champs[0].team_name ?? champs.map((c) => c.display_name).join(' + '), players: champs.map((c) => c.display_name) } : { name: champs[0].display_name }) : null,
      second: second ? { name: second.display_name } : null,
    };
  });
  const by = new Map<string, { name: string; wins: number; played: number; medals: number }>();
  for (const r of rows) {
    const x = by.get(r.player_id) ?? { name: r.display_name, wins: 0, played: 0, medals: 0 };
    x.played++;
    if (r.finish === 1) x.wins++;
    if (r.medal) x.medals++;
    by.set(r.player_id, x);
  }
  const wins = [...by.values()].filter((x) => x.wins > 0).sort((a, b) => b.wins - a.wins || b.played - a.played || a.name.localeCompare(b.name));
  return { tournaments, wins };
}

/** The admin Players sheet's TOURNAMENTS card for one player (null when they have played none, or the switch is off). */
export async function playerTournamentsFor(ctx: Ctx, groupId: string, playerId: string): Promise<PlayerTournamentsView | null> {
  if (!(await tournamentsFlags(ctx, groupId)).on) return null;
  const rows = await ctx.db
    .prepare(
      `SELECT t.name, t.final_date, t.format, r.finish, p2.display_name AS partner FROM tournament_results r JOIN tournaments t ON t.id = r.tournament_id
       LEFT JOIN players p2 ON p2.id = r.partner_id
       WHERE r.player_id = ? AND t.group_id = ? AND t.status = 'ended' AND ${NOT_HIDDEN} ORDER BY t.final_date DESC, t.ended_at DESC`,
    )
    .bind(playerId, groupId)
    .all<{ name: string; final_date: string | null; format: string; finish: number | null; partner: string | null }>()
    .then((r) => r.results)
    .catch(() => []);
  if (!rows.length) return null;
  return {
    played: rows.length,
    won: rows.filter((r) => r.finish === 1).length,
    runnerUp: rows.filter((r) => r.finish === 2).length,
    rows: rows.map((r) => ({
      name: r.name,
      date: r.final_date,
      finish: r.finish ? `${placeWord(r.finish)}${r.format === 'doubles' && r.partner ? ` with ${r.partner}` : ''}` : 'Played',
    })),
  };
}

/** The organizer's End card for the dashboard view (null until the Final or the last round is in). */
export function adminEndView(t: TournamentRow, format: TournamentFormat, signups: readonly SignupRow[], tickets: readonly TicketWithName[], day: DayRows, tz: string, nowMs: number, orgId: string | null): AdminEndView | null {
  return endPlan(t as EndRow, format, signups, tickets, day, tz, nowMs, orgId)?.view ?? null;
}

