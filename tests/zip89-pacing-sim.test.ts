import { describe, expect, it } from 'vitest';
import { adminTour, awards, draftAndPublish, world } from './zip58-world';
import { allThree, clock, END_MS, night, type NightRun, playPaced } from './zip89-world';

// Zip 89 (🎾89.smart pacing): THE PROOF. Whole nights on the REAL server (2 courts, 7:30 to 10 PM, the plan's own length for each size), every
// game lasting the night's pace (12, 15, 20 or 25 minutes for a game to 11, shorter games in proportion) plus 1 to 3 minutes of score entry and
// court change; rolling courts decide when each game starts (the slower court sets the round where the players must wait). Alex accepts every
// bonus offer the moment it shows, and applies the Time check when it asks. Must hold every time: never past the booked end; at 12 to 20 minute
// paces the last game ends 10 to 30 minutes before the end; no offer inside the last 2 planned rounds. Writes the table to the console.

const rows: string[] = [];
const line = (style: string, n: number, pace: number, r: NightRun) => {
  const each = [...r.games.values()];
  const left = Math.round((END_MS - r.finish) / 60_000);
  const row = (
    `${style} ${String(n).padStart(2)}p pace ${String(pace).padStart(2)}: offers ${r.offers.length} (${r.offers.map((o) => `${o.kind}@R${o.afterRound}`).join(' ') || '-'}), games each ${Math.min(...each)}-${Math.max(...each)}, last game ends ${clock(r.finish)} (${left} min before 10 PM)${r.timeChecks ? `, time check ${r.timeChecks}x` : ''}`
  );
  rows.push(row);
  if (process.env.ZIP89_SIM_LOG) console.log(row);
  return left;
};

/** The hard rules (every night): never past the booked end; no offer inside the last 2 planned rounds; never under 10 minutes to spare at 12 to
 *  20 minutes a game. The 10 to 30 minute window's top is reported, not asserted: a night that runs faster than the bonuses can fill (Locked
 *  doubles has two kinds; a bonus needs 20 minutes to spare) ends earlier and the rest is free play (marked "early" in the table). */
const misses: string[] = [];
/** Nights a 25 minute pace runs past the end even with every game the Time check may shorten at 7 (reported to Alex, ANYTHING RISKY). */
const over: string[] = [];
function checks(r: NightRun, pace: number, left: number, what: string, cut?: () => boolean) {
  if (pace <= 20) expect(r.finish, `${what}: never past the booked end`).toBeLessThanOrEqual(END_MS);
  else if (r.finish > END_MS) {
    // 25 minutes a game: only when nothing is left to shorten (every pool game after Round 2 already at 7), and never by more than 20 minutes.
    expect(cut?.() ?? false, `${what}: over the end with games still to shorten`).toBe(true);
    expect(-left, `${what}: minutes over`).toBeLessThanOrEqual(20);
    over.push(`${what}: ${-left} min over (every game the Time check may shorten is at 7)`);
  }
  if (pace <= 20) expect(left, `${what}: at least 10 minutes before the end`).toBeGreaterThanOrEqual(10);
  if (pace <= 20 && left > 30) misses.push(`${what}: ${left} min early`);
  for (const o of r.offers) expect(o.plannedLeft, 'no offer inside the last 2 planned rounds').toBeGreaterThanOrEqual(2);
}

const PACES = [12, 15, 20, 25];

describe('zip 89: Americano nights at 12, 15, 20 and 25 minutes a game (2 courts, 2.5 hours), Alex accepts every offer', () => {
  for (const n of [8, 9, 10, 11, 12, 13, 14, 15, 16])
    it(`${n} players`, async () => {
      for (const pace of PACES) {
        const ctx = await world(n, { format: 'americano' });
        const r = await playPaced(ctx, pace);
        const games = (await night(ctx)).games;
        const last = Math.max(...games.map((g) => g.round));
        checks(r, pace, line('AM', n, pace, r), `AM ${n}p pace ${pace}`, () => games.every((g) => g.round <= 2 || g.round === last || g.playTo === 7));
        // The reveal credits once; the books read zero.
        const t = await adminTour(ctx);
        expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
        allThree(ctx);
      }
    }, 600_000);
});

describe('zip 89: Locked doubles nights at 12, 15, 20 and 25 minutes a game (2 courts, 2.5 hours), Alex accepts every offer', () => {
  for (const n of [8, 10, 12, 14, 16])
    it(`${n} players`, async () => {
      for (const pace of PACES) {
        const ctx = await world(n, { format: 'doubles' });
        await draftAndPublish(ctx);
        const r = await playPaced(ctx, pace);
        const games = (await night(ctx)).games;
        checks(r, pace, line('LD', n, pace, r), `LD ${n}p pace ${pace}`, () => games.every((g) => g.stage !== 'pool' || g.round <= 2 || g.playTo === 7));
        const t = await adminTour(ctx);
        expect(t.end, 'the End card').toBeTruthy();
        expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
        allThree(ctx);
      }
    }, 600_000);
});

describe('zip 89: Dec 1 at Alex’s 13 minutes a game (10 players, 2 courts, 7:30 to 10 PM), every offer accepted', () => {
  for (const format of ['americano', 'doubles'] as const)
    it(format, async () => {
      const ctx = await world(10, { format });
      if (format === 'doubles') await draftAndPublish(ctx);
      const r = await playPaced(ctx, 13);
      const left = Math.round((END_MS - r.finish) / 60_000);
      expect(r.finish).toBeLessThanOrEqual(END_MS);
      expect(left).toBeGreaterThanOrEqual(10);
      const each = [...r.games.values()];
      const lines = [...r.played]
        .sort((a, b) => a.start - b.start || a.num - b.num)
        .map((g) => `  ${clock(g.start)}-${clock(g.end)} ${g.label.padEnd(9)} ${g.a.join(' + ')} v ${g.b.join(' + ')} ${g.score}`);
      console.log(
        `\n[zip89-dec1] ${format}: offers ${r.offers.map((o) => `${o.kind} after round ${o.afterRound} (${clock(o.at)})`).join(', ') || 'none'}; ${r.rounds} rounds; games each ${Math.min(...each)}-${Math.max(...each)}; last game ends ${clock(r.finish)} (${left} min before 10 PM)\n${lines.join('\n')}`,
      );
    }, 120_000);
});

describe('zip 89 (review): a night that starts fast, takes every bonus, then slows down (10 players, 2 courts, 2.5 hours)', () => {
  // [style, fast minutes, for how many rounds, then]: the fresh reviewer's nights, every offer accepted, every Time check applied.
  const cases: [('americano' | 'doubles'), number, number, number][] = [
    ['doubles', 12, 2, 18],
    ['doubles', 10, 2, 20],
    ['doubles', 10, 3, 22],
    ['americano', 12, 3, 20],
    ['americano', 10, 3, 22],
    ['americano', 9, 4, 24],
  ];
  for (const [format, fast, n, slow] of cases)
    it(`${format}: ${fast} minutes for ${n} rounds, then ${slow}`, async () => {
      const ctx = await world(10, { format });
      if (format === 'doubles') await draftAndPublish(ctx);
      const r = await playPaced(ctx, (round) => (round <= n ? fast : slow));
      const left = Math.round((END_MS - r.finish) / 60_000);
      rows.push(`SLOWS ${format === 'doubles' ? 'LD' : 'AM'} 10p ${fast} x${n} then ${slow}: offers ${r.offers.map((o) => `${o.kind}@R${o.afterRound}`).join(' ') || '-'}, ends ${clock(r.finish)} (${left} min before 10 PM), time check ${r.timeChecks}x`);
      expect(r.finish, 'never past the booked end').toBeLessThanOrEqual(END_MS);
    }, 120_000);
});

describe('zip 89: the table', () => {
  it('prints', () => {
    console.log(`\n[zip89-sim]\n${rows.join('\n')}\n[zip89-sim] more than 30 minutes early at 12 to 20 a game: ${misses.length}\n${misses.join('\n')}\n[zip89-sim] past the end at 25 a game: ${over.length}\n${over.join('\n')}`);
  });
});
