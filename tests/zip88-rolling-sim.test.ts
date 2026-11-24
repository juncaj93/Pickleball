import { describe, expect, it } from 'vitest';
import { americanoNight, sitLimit, onCourtFor } from '../shared/americanoSchedule';
import { rollCourts, startable, type RollGame } from '../shared/rollingCourts';
import { schedule } from '../shared/tournamentSchedule';

// Zip 88 (🎾88.rolling courts): full nights simulated on the pure rule with uneven game lengths (one court always faster). Every scheduled game
// is played exactly once, nobody is ever on two courts, the sits never change (the same games), no court waits while a game it may start exists,
// each player's games keep their own order, and nobody waits longer between two of their games than the schedule's sit limit allows.

const STAGE_RANK: Record<string, number> = { pool: 0, tie: 1, semi: 2, final: 3, third: 3 };

interface Sim {
  games: RollGame[];
  /** Final answer of the replay. */
  last: ReturnType<typeof rollCourts>;
  minutes: number;
  /** Times a court waited while a game with all four players free (ignoring each player's own order) existed. */
  orderHolds: number;
  /** Most games started on the other courts between two games of one player (in courts' rounds: ceil(games / courts)). */
  worstWait: number;
  starts: Map<number, number>;
}

/** Plays the night: each game takes `len(court)` minutes on the court it got. `playersAt` fills a playoff's teams once it may start. */
function simulate(base: RollGame[], courts: number, len: (court: number, num: number) => number, playersAt?: (g: RollGame, done: ReadonlySet<number>) => string[]): Sim {
  const games = base.map((g) => ({ ...g, doneAt: null as number | null }));
  const starts = new Map<number, number>();
  let orderHolds = 0;
  let guard = 0;
  for (;;) {
    if (++guard > 500) throw new Error('no end');
    if (playersAt) {
      const done = new Set(games.filter((g) => g.doneAt !== null).map((g) => g.num));
      for (const g of games) if (!g.players.length) g.players = playersAt(g, done);
    }
    const r = rollCourts(games, courts);
    // Nobody on two courts.
    const on = r.onCourt.filter((x): x is number => x !== null).flatMap((num) => games.find((g) => g.num === num)!.players);
    expect(new Set(on).size, 'double-booked').toBe(on.length);
    // No court waits when it may start a game.
    if (r.onCourt.some((x) => x === null)) {
      expect(startable(games, r), 'a court waited with a game it could start').toEqual([]);
      const busy = new Set(on);
      if (games.some((g) => g.doneAt === null && !r.court.has(g.num) && g.players.length && g.players.every((p) => !busy.has(p)))) orderHolds++;
    }
    for (const [num, at] of r.startAt) starts.set(num, Math.max(0, at));
    const playing = r.onCourt.filter((x): x is number => x !== null);
    if (!playing.length) break;
    const ends = playing.map((num) => ({ num, end: Math.max(0, r.startAt.get(num)!) + len(r.court.get(num)!, num) }));
    const next = Math.min(...ends.map((e) => e.end));
    for (const e of ends) if (e.end === next) games.find((g) => g.num === e.num)!.doneAt = next;
  }
  const last = rollCourts(games, courts);
  // Every game played exactly once, all on a court.
  for (const g of games) {
    expect(g.doneAt, `game ${g.num} played`).not.toBeNull();
    expect(last.court.has(g.num), `game ${g.num} had a court`).toBe(true);
  }
  // Each player's games keep their own order, and the longest wait between two of their games.
  const byPlayer = new Map<string, RollGame[]>();
  for (const g of games) for (const p of g.players) byPlayer.set(p, [...(byPlayer.get(p) ?? []), g]);
  let worstWait = 0;
  for (const list of byPlayer.values()) {
    const order = list.map((g) => g.num);
    const played = [...list].sort((a, b) => starts.get(a.num)! - starts.get(b.num)! || a.num - b.num).map((g) => g.num);
    expect(played, 'own order').toEqual(order);
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1].doneAt!;
      const to = starts.get(list[i].num)!;
      const between = games.filter((g) => starts.get(g.num)! >= from && starts.get(g.num)! < to && !g.players.some((p) => list[0].players.includes(p) && list.some((x) => x.num === g.num))).length;
      worstWait = Math.max(worstWait, Math.ceil(between / courts));
    }
  }
  return { games, last, minutes: Math.max(...games.map((g) => g.doneAt!)), orderHolds, worstWait, starts };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
const americano = (n: number, courts = 2): RollGame[] =>
  americanoNight(ids(n), courts, 150, `night-${n}`).games.map((g) => ({ num: g.num, round: g.round, rank: 0, players: [...g.a, ...g.b], doneAt: null }));
/** Lockstep length of a night (each round waits for its slowest court). */
function lockstep(games: RollGame[], len: (court: number, num: number) => number, courtOf: (num: number) => number): number {
  const rounds = [...new Set(games.map((g) => g.round))];
  return rounds.reduce((t, r) => t + Math.max(...games.filter((g) => g.round === r).map((g) => len(courtOf(g.num), g.num))), 0);
}

// Court 1 is always faster: 11 to 13 minutes; Court 2 is 15 to 19 (a little different every game).
const LENGTHS: string[] = [];
const uneven = (court: number, num: number) => (court === 1 ? 11 + (num % 3) : 15 + ((num * 7) % 5));

describe('zip 88: rolling courts on Americano nights (pure rule, uneven courts)', () => {
  for (const n of [8, 9, 10, 11, 12]) {
    it(`${n} players, 2 courts: every game once, no double-booking, no idle court, own order, sits unchanged`, () => {
      const base = americano(n);
      const sim = simulate(base, 2, uneven);
      // Same games, so the same sits: each player plays the scheduled number of games.
      const count = (gs: RollGame[]) => new Map(ids(n).map((p) => [p, gs.filter((g) => g.players.includes(p)).length]));
      expect(count(sim.games)).toEqual(count(base));
      // Never waits longer than the schedule's sit limit (2 rounds in a row) plus the round being finished.
      expect(sim.worstWait, `${n}: worst wait in rounds`).toBeLessThanOrEqual(sitLimit(n, onCourtFor(n, 2)) + 1);
      // About as long as lockstep or shorter (the same games; a game moved to the slower court can cost a minute or two).
      const plannedCourt = new Map(americanoNight(ids(n), 2, 150, `night-${n}`).games.map((g) => [g.num, g.court as number]));
      const slow = lockstep(base, uneven, (num) => plannedCourt.get(num)!);
      expect(sim.minutes).toBeLessThanOrEqual(slow + 3);
      LENGTHS.push(`${n}: ${sim.minutes} vs lockstep ${slow}`);
    });
  }

  it('equal courts play exactly as lockstep (the same round on both courts)', () => {
    const sim = simulate(americano(10), 2, () => 14);
    for (const g of sim.games) expect(sim.starts.get(g.num)).toBe((g.round - 1) * 14);
  });

  it('picture 2 (12 players): court 1 finishes early and starts the next round while court 2 still plays', () => {
    const base = americano(12);
    const sim = simulate(base, 2, uneven);
    const early = sim.games.filter((g) => {
      const at = sim.starts.get(g.num)!;
      return sim.games.some((x) => x.round < g.round && sim.starts.get(x.num)! <= at && x.doneAt! > at);
    });
    expect(early.length).toBeGreaterThan(0);
  });

  it('9 and 10 players: the fair schedule never leaves a later game whose 4 players are all free, so courts wait as before', () => {
    for (const n of [9, 10]) {
      const sim = simulate(americano(n), 2, uneven);
      for (const g of sim.games) expect(sim.games.some((x) => x.round < g.round && x.doneAt! > sim.starts.get(g.num)!), `${n}: game ${g.num}`).toBe(false);
    }
  });

  it('night lengths (Court 1 faster)', () => {
    expect(LENGTHS.length).toBe(5);
    console.log(`zip 88 night lengths: ${LENGTHS.join('; ')}`);
  });

  it('one court: one game after another in schedule order', () => {
    const sim = simulate(americano(8, 1), 1, uneven);
    const order = [...sim.games].sort((a, b) => sim.starts.get(a.num)! - sim.starts.get(b.num)!).map((g) => g.num);
    expect(order).toEqual(sim.games.map((g) => g.num));
  });
});

/** Locked doubles: the schedule's games, teams as players; a playoff's teams come once the stage before is done. */
function doubles(teams: number): { base: RollGame[]; playersAt: (g: RollGame, done: ReadonlySet<number>) => string[] } {
  const sched = schedule(teams, 2);
  const base = sched.map((g) => ({ num: g.num, round: g.round, rank: STAGE_RANK[g.stage], players: g.stage === 'pool' ? [g.a, g.b] : ([] as string[]), doneAt: null }));
  const playersAt = (g: RollGame, done: ReadonlySet<number>) => {
    const before = base.filter((x) => x.rank < g.rank);
    if (!before.every((x) => done.has(x.num))) return [];
    // Any two teams that are still in (the simulation only needs who is busy: distinct teams per stage).
    const s = sched.find((x) => x.num === g.num)!;
    const same = sched.filter((x) => x.stage === s.stage || (STAGE_RANK[x.stage] === STAGE_RANK[s.stage]));
    const i = same.findIndex((x) => x.num === g.num);
    return [`T${i * 2 + 1}`, `T${i * 2 + 2}`];
  };
  return { base, playersAt };
}

describe('zip 88: rolling courts on Locked doubles nights (pools, groups, playoffs)', () => {
  for (const players of [8, 10, 12]) {
    it(`${players} players: every game once, no double-booking, no idle court, playoffs only when ready`, () => {
      const { base, playersAt } = doubles(players / 2);
      const sim = simulate(base, 2, uneven, playersAt);
      // Playoffs start only after every game of the stage before is in.
      for (const g of sim.games.filter((x) => x.rank > 0)) {
        const before = sim.games.filter((x) => x.rank < g.rank);
        for (const b of before) expect(b.doneAt!, `game ${g.num} after ${b.num}`).toBeLessThanOrEqual(sim.starts.get(g.num)!);
      }
      // The Final and 3rd place start side by side (the same moment).
      const fin = base.find((g) => g.rank === 3 && sim.last.court.get(g.num) === 1);
      const finals = base.filter((g) => g.rank === 3);
      if (finals.length === 2) {
        expect(sim.starts.get(finals[0].num)).toBe(sim.starts.get(finals[1].num));
        expect(fin?.num).toBe(finals[0].num);
      }
    });
  }

  it('a tie game made by the wheel waits for its moment, then takes the first free court', () => {
    const { base } = doubles(4);
    const pools = base.filter((g) => g.rank === 0).map((g, i) => ({ ...g, doneAt: 10 + i }));
    const tie: RollGame = { num: 99, round: 4, rank: 1, players: ['T1', 'T2'], doneAt: null, from: 50 };
    // While tied, the playoff's teams are not known (no players): it cannot start, and the tie game does not exist before the wheel.
    const rest = base.filter((g) => g.rank > 0).map((g) => ({ ...g, players: [] as string[] }));
    const before = rollCourts([...pools, ...rest.slice(0, 1)], 2);
    expect(before.onCourt).toEqual([null, null]);
    const r = rollCourts([...pools, { ...tie, from: 20 }, ...rest.slice(0, 1)], 2);
    expect(r.onCourt[0]).toBe(99);
    expect(r.startAt.get(99)).toBe(20);
  });
});

describe('zip 88: finishes replayed', () => {
  it('called off while waiting: leaves the list without a court; called off on court: frees it at once', () => {
    const base = americano(10);
    const r1 = base.filter((g) => g.round === 1);
    const later = base.find((g) => g.round === 4)!;
    const games = base.map((g) => (g.num === r1[0].num ? { ...g, doneAt: 5 } : g.num === later.num ? { ...g, doneAt: 5 } : g));
    const r = rollCourts(games, 2);
    expect(r.court.has(later.num)).toBe(false);
    const c = r1[0].num === r.lastOn[0] ? 0 : 1;
    expect(r.lastOn[c]).toBe(r1[0].num);
    expect(r.freeSince[c]).toBe(5);
    if (r.onCourt[c] !== null) expect(r.startAt.get(r.onCourt[c]!)).toBe(5);
  });

  it('two finishes at the same moment fill both courts in schedule order (court 1 takes the earlier game)', () => {
    const base = americano(10);
    const games = base.map((g) => (g.round === 1 ? { ...g, doneAt: 14 } : g));
    const r = rollCourts(games, 2);
    const r2 = base.filter((g) => g.round === 2).map((g) => g.num);
    expect(r.onCourt).toEqual(r2);
  });
});
