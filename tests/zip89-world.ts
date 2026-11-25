// Zip 89 (🎾89.smart pacing): helpers for whole nights on the real server at a set pace (tests/zip89-pacing-sim.test.ts, zip89-pacing.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, START_MS, type World } from './zip58-world';

export const sc = (o: { a: { names?: string[]; players?: string[] } | null; b: { names?: string[]; players?: string[] } | null }) => ({
  a: o.a?.names ?? o.a?.players ?? [],
  b: o.b?.names ?? o.b?.players ?? [],
});
export async function night(ctx: World) {
  const t = await adminTour(ctx);
  const v = t.format === 'americano' ? t.rounds : t.day;
  return { t, v, games: v.games as any[], courts: (v.courtsNow ?? []) as { court: number; num: number | null; last: number | null }[] };
}
export async function score(ctx: World, name: string, num: number, mine: number, theirs: number) {
  const phone = await playerPhone(ctx, name);
  const t = (await phone.call('GET', '/api/group')).data.tournament;
  const key = t?.day?.rounds?.find((r: any) => r.num === num)?.key;
  return phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action: 'score', mine, theirs, ...(key ? { key } : {}) });
}
export const call = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
export const END_MS = START_MS + 150 * 60_000;
export const clock = (ms: number) => {
  const d = new Date(ms - 5 * 3_600_000);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} PM`;
};

export interface NightRun {
  offers: { kind: string; afterRound: number; plannedLeft: number; at: number }[];
  finish: number;
  games: Map<string, number>;
  rounds: number;
  timeChecks: number;
  played: { num: number; label: string; a: string[]; b: string[]; start: number; end: number; score: string }[];
}

/** Plays a whole night at `pace` minutes a game to 11. `accept`: Alex taps Add a round on every offer. */
export async function playPaced(
  ctx: World,
  /** Minutes a game to 11 takes: one number, or by the game's round (a night that starts fast and slows down). */
  pace: number | ((round: number) => number),
  accept = true,
  stopWhen?: (s: { t: any; v: any; games: any[] }) => boolean,
  fresh = true,
): Promise<NightRun> {
  if (fresh) ctx.app.now = START_MS;
  const ends = new Map<number, number>();
  const starts = new Map<number, number>();
  const offers: NightRun['offers'] = [];
  const seenOffer = new Set<string>();
  let timeChecks = 0;
  let finish = START_MS;
  for (let step = 0; step < 400; step++) {
    const { t, v, games, courts } = await night(ctx);
    if (stopWhen?.({ t, v, games })) break;
    if (v.timeCheck) {
      timeChecks++;
      expect((await call(ctx, { action: 'apply', fromRound: v.timeCheck.fromRound, to: v.timeCheck.to })).status).toBe(200);
      continue;
    }
    if (v.bonus && !seenOffer.has(v.bonus.key)) {
      seenOffer.add(v.bonus.key);
      const isAm = t.format === 'americano';
      const plannedLeft = isAm
        ? [...new Set(games.filter((g) => g.round <= v.plannedRounds && g.status !== 'done' && g.status !== 'skipped').map((g) => g.round))].length
        : [...new Set(games.filter((g) => g.stage === 'pool' && !g.winner && !g.skipped).map((g) => g.round))].length;
      const doneRounds = isAm
        ? [...new Set(games.map((g) => g.round))].filter((r) => games.filter((g) => g.round === r).every((g) => g.status === 'done' || g.status === 'skipped')).length
        : [...new Set(games.filter((g) => g.stage === 'pool').map((g) => g.round))].filter((r) => games.filter((g) => g.round === r).every((g) => g.winner || g.skipped)).length;
      offers.push({ kind: v.bonus.kind, afterRound: doneRounds, plannedLeft, at: ctx.app.now });
      if (accept) {
        const r = await call(ctx, { action: 'bonus', key: v.bonus.key });
        expect(r.status, r.text).toBe(200);
        continue;
      }
    }
    if (t.end && courts.every((c) => c.num === null)) break;
    const tie = (v.ties ?? []).find((x: any) => (x.mode === 'wheel' && !x.bye) || (x.mode === 'pick' && x.needPicks > 0));
    if (tie) {
      const body = tie.mode === 'wheel' ? { action: 'spin', key: tie.key } : { action: 'pick', key: tie.key, seat: tie.teams.find((x: any) => !tie.picks.includes(x.seat)).seat, picks: tie.picks };
      expect((await call(ctx, body)).status).toBe(200);
      continue;
    }
    const live = courts.filter((c) => c.num !== null).map((c) => ({ court: c.court, g: games.find((x) => x.num === c.num) }));
    if (!live.length) {
      // Americano: every game in (the reveal is next).
      if (t.format === 'americano' && games.every((g) => g.status === 'done' || g.status === 'skipped')) break;
      throw new Error(`step ${step}: nothing on a court`);
    }
    for (const { court, g } of live) {
      if (ends.has(g.num)) continue;
      const to = g.playTo ?? 11;
      const entry = 1 + ((g.num * 7 + court) % 3);
      const p = typeof pace === 'number' ? pace : pace(g.round);
      ends.set(g.num, ctx.app.now + (Math.round((p * to) / 11) + entry) * 60_000);
      starts.set(g.num, ctx.app.now);
    }
    const next = Math.min(...live.map(({ g }) => ends.get(g.num)!));
    ctx.app.now = Math.max(ctx.app.now, next);
    for (const { g } of live) {
      if (ends.get(g.num)! > ctx.app.now) continue;
      const winA = g.num % 3 !== 0;
      const to = g.playTo ?? 11;
      const lose = Math.min(2 + ((g.num * 5) % 8), to - 2);
      const r = await score(ctx, sc(g).a[0], g.num, winA ? to : lose, winA ? lose : to);
      expect(r.status, r.text).toBe(200);
      finish = Math.max(finish, ctx.app.now);
    }
  }
  const { games } = await night(ctx);
  const count = new Map<string, number>();
  const played: NightRun['played'] = [];
  for (const g of games) {
    const done = g.status === 'done' || (!!g.winner && !g.skipped);
    if (!done) continue;
    for (const n of [...sc(g).a, ...sc(g).b]) count.set(n, (count.get(n) ?? 0) + 1);
    const label = g.stage ? (g.finalGame ? `Final G${g.finalGame}` : g.stage === 'pool' ? `RD${g.round}` : g.stage) : `RD${g.round}`;
    played.push({ num: g.num, label, a: sc(g).a, b: sc(g).b, start: starts.get(g.num) ?? 0, end: ends.get(g.num) ?? 0, score: `${g.scoreA}-${g.scoreB}` });
  }
  return { offers, finish, games: count, rounds: Math.max(...games.map((g) => g.round)), timeChecks, played };
}


/** Money to the cent: all three integrity files (the ones run before and after every deploy) read 0, every column but info_ ones. */
const THREE = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);
export function allThree(ctx: World) {
  for (const [file, sql] of THREE) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(v), `${file}: ${k} must be 0`).toBe(0);
  }
}
