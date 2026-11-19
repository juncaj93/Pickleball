import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  americanoNight,
  decodeRound,
  encodeRound,
  extendRounds,
  isAmericanoSlot,
  onCourtFor,
  pairSlot,
  PATTERN_ROUNDS,
  patternKey,
  pointsTable,
  seatOrder,
  seatRounds,
  slotPair,
  spreadOf,
  tallyOf,
  type SeatRound,
  winLoss,
} from '../shared/americanoSchedule';
import { AMERICANO_PATTERNS } from '../shared/americanoPatterns';
import { americanoPlan, doublesPlan } from '../shared/tournamentPlan';

// Zip 61: the Americano schedule (shared/americanoSchedule.ts) checked against the game plan table (reference/GAME_PLAN_TABLE.md, copied
// unchanged into tests/fixtures) and the brief's rules, for EVERY row of the table (both styles: the Locked doubles rows are the plan zip 57
// built; this zip checks them again from the same table so one test file covers the whole table), and every size 6 to 16.

const TABLE = readFileSync(join(process.cwd(), 'tests/fixtures/GAME_PLAN_TABLE.md'), 'utf8');
const HOURS: Record<string, number> = { '2h': 120, '2.5h': 150, '3h': 180 };
type Row = { style: 'doubles' | 'americano'; players: number; courts: number; minutes: number; expect: string };
function rows(): Row[] {
  const out: Row[] = [];
  let style: Row['style'] | null = null;
  for (const line of TABLE.split('\n')) {
    if (line.startsWith('## LOCKED DOUBLES')) style = 'doubles';
    else if (line.startsWith('## AMERICANO')) style = 'americano';
    else if (line.startsWith('## ')) style = null;
    const m = /^- (\d+) players, (\d) courts?: (.*)$/.exec(line);
    if (!m || !style) continue;
    for (const cell of m[3].split(' | ')) {
      const c = /^(2h|2\.5h|3h): (.*)$/.exec(cell.trim())!;
      out.push({ style, players: Number(m[1]), courts: Number(m[2]), minutes: HOURS[c[1]], expect: c[2].trim() });
    }
  }
  return out;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

/** Every rule of the brief, checked on a night: returns what the report needs. */
function checkNight(n: number, courts: number, minutes: number) {
  const players = ids(n);
  const night = americanoNight(players, courts, minutes, `t-${n}-${courts}-${minutes}`);
  const plan = night.plan;
  expect(night.rounds).toBe(plan.rounds);
  const onCourt = onCourtFor(n, courts);
  // Every round: everyone plays once or sits; the right number on court; the courts 1 (and 2) used once each.
  const sits = new Map(players.map((p) => [p, 0]));
  const games = new Map(players.map((p) => [p, 0]));
  const partners = new Map(players.map((p) => [p, new Map<string, number>()]));
  const opps = new Map<string, number>();
  for (let r = 1; r <= night.rounds; r++) {
    const list = night.games.filter((g) => g.round === r);
    const on = list.flatMap((g) => [...g.a, ...g.b]);
    const sit = night.sits.get(r) ?? [];
    expect(on).toHaveLength(onCourt);
    expect(new Set([...on, ...sit]).size).toBe(n);
    expect(on.length + sit.length).toBe(n);
    expect(list.map((g) => g.court).sort()).toEqual(onCourt === 8 ? [1, 2] : [1]);
    for (const s of sit) sits.set(s, sits.get(s)! + 1);
    // Nobody sits twice before everyone has sat once: after every round the sit-outs differ by at most 1.
    const sc = [...sits.values()];
    expect(Math.max(...sc) - Math.min(...sc)).toBeLessThanOrEqual(1);
    for (const g of list) {
      expect(g.playTo).toBe(plan.gameTo);
      for (const [x, y] of [g.a, g.b]) {
        // Partners do not repeat until every possible partner has been used (at the moment of the game).
        const px = partners.get(x)!;
        const py = partners.get(y)!;
        const minX = Math.min(...players.filter((o) => o !== x).map((o) => px.get(o) ?? 0));
        const minY = Math.min(...players.filter((o) => o !== y).map((o) => py.get(o) ?? 0));
        expect(px.get(y) ?? 0).toBeLessThanOrEqual(minX);
        expect(py.get(x) ?? 0).toBeLessThanOrEqual(minY);
      }
      for (const [x, y] of [g.a, g.b]) {
        partners.get(x)!.set(y, (partners.get(x)!.get(y) ?? 0) + 1);
        partners.get(y)!.set(x, (partners.get(y)!.get(x) ?? 0) + 1);
      }
      for (const x of g.a) for (const y of g.b) opps.set([x, y].sort().join(), (opps.get([x, y].sort().join()) ?? 0) + 1);
    }
    for (const x of on) games.set(x, games.get(x)! + 1);
  }
  // Opponents spread as evenly as the size allows: up to 3 hours (every row of the table), two players meet at most 2 more times than the two
  // who meet least; a longer night (4 hours, 10 rounds or more) at most 3.
  const pairs = players.flatMap((x, i) => players.slice(i + 1).map((y) => opps.get([x, y].sort().join()) ?? 0));
  expect(Math.max(...pairs) - Math.min(...pairs)).toBeLessThanOrEqual(minutes <= 180 ? 2 : 3);
  const gc = [...games.values()];
  expect(Math.max(...gc) - Math.min(...gc)).toBeLessThanOrEqual(1);
  return { plan, minGames: Math.min(...gc), maxGames: Math.max(...gc), sitMax: Math.max(...sits.values()) };
}

describe('zip 61: every row of the game plan table, both styles', () => {
  const all = rows();
  it('reads the whole table (Locked doubles 12 lines, Americano 20 lines, 3 court times each)', () => {
    expect(all.filter((r) => r.style === 'doubles')).toHaveLength(36);
    expect(all.filter((r) => r.style === 'americano')).toHaveLength(60);
  });
  for (const r of all) {
    it(`${r.style} ${r.players} players, ${r.courts} court${r.courts > 1 ? 's' : ''}, ${r.minutes / 60}h: ${r.expect}`, () => {
      if (r.style === 'doubles') {
        const p = doublesPlan(r.players, r.courts, r.minutes);
        if (r.expect === 'NO') return expect(p.fits).toBe(false);
        const m = /^to (\d+), (\d+) rounds, (\d+) min$/.exec(r.expect)!;
        expect([p.gameTo, p.rounds, p.minutesUsed]).toEqual([Number(m[1]), Number(m[2]), Number(m[3])]);
        return;
      }
      const p = americanoPlan(r.players, r.courts, r.minutes);
      if (r.expect === 'NO') {
        expect(p.fits).toBe(false);
        // A night Alex finalizes anyway still gets a full schedule (games to 7), every rule kept.
        checkNight(r.players, r.courts, r.minutes);
        return;
      }
      const m = /^to (\d+), (\d+) rounds, ([\d.]+) games each$/.exec(r.expect)!;
      expect([p.gameTo, p.rounds, p.gamesEach]).toEqual([Number(m[1]), Number(m[2]), Number(m[3])]);
      const c = checkNight(r.players, r.courts, r.minutes);
      // Every player gets at least 4 games (the table's rule), and the finish is inside the court time minus 10 minutes.
      expect(c.minGames).toBeGreaterThanOrEqual(4);
      expect(p.minutesUsed).toBeLessThanOrEqual(r.minutes - 10);
    });
  }
});

describe('zip 61: every size 6 to 16, every court count and court time', () => {
  for (let n = 6; n <= 16; n++)
    for (const courts of [1, 2])
      for (const minutes of [120, 150, 180, 210, 240])
        it(`${n} players, ${courts} court${courts > 1 ? 's' : ''}, ${minutes} minutes`, () => {
          checkNight(n, courts, minutes);
        });

  it('14 and 16 players on 2 courts: 8 play each round, the rest sit, and games each (the report)', () => {
    const report: string[] = [];
    for (const n of [14, 16])
      for (const minutes of [150, 180]) {
        const c = checkNight(n, 2, minutes);
        expect(c.plan.onCourt).toBe(8);
        report.push(`${n} players ${minutes / 60}h: ${c.plan.rounds} rounds to ${c.plan.gameTo}, ${c.minGames === c.maxGames ? c.minGames : `${c.minGames} to ${c.maxGames}`} games each`);
      }
    // 14: 7 rounds x 8 = 56 = 4 each. 16: 8 rounds x 8 = 64 = 4 each.
    expect(report).toEqual(['14 players 2.5h: 7 rounds to 9, 4 games each', '14 players 3h: 7 rounds to 11, 4 games each', '16 players 2.5h: 8 rounds to 7, 4 games each', '16 players 3h: 8 rounds to 9, 4 games each']);
  });

  it('the pictures: 10 players, 2 courts, 7:30 to 10 PM = 6 rounds to 11, 2 sit each round', () => {
    const night = americanoNight(ids(10), 2, 150, 'cold-open');
    expect([night.rounds, night.plan.gameTo]).toEqual([6, 11]);
    for (let r = 1; r <= 6; r++) expect(night.sits.get(r)).toHaveLength(2);
  });

  it('6 and 7 players use one court only (a second court is never used under 8)', () => {
    for (const n of [6, 7]) expect(americanoNight(ids(n), 2, 180, 'x').games.every((g) => g.court === 1)).toBe(true);
  });

  it('8 players on 2 courts, 3 hours: every partner exactly once and every opponent exactly twice (a whist night)', () => {
    const night = americanoNight(ids(8), 2, 180, 'w');
    const t = tallyOf(8, seatRounds(8, 8, 7));
    expect(night.rounds).toBe(7);
    expect(spreadOf(t)).toMatchObject({ oppMin: 2, oppMax: 2 });
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (x !== y) expect(t.partner[x][y]).toBe(1);
  });

  it('courts rotate: on 2 courts nobody with 3 or more games plays them all on one court', () => {
    for (let n = 8; n <= 16; n++)
      for (const minutes of [120, 150, 180]) {
        const night = americanoNight(ids(n), 2, minutes, 'c');
        for (const p of ids(n)) {
          const mine = night.games.filter((g) => [...g.a, ...g.b].includes(p));
          if (mine.length >= 3) expect(new Set(mine.map((g) => g.court)).size).toBe(2);
        }
      }
  });
});

describe('zip 61: the saved patterns', () => {
  it('one per size and players on court, 16 rounds each, every round a real split of the seats', () => {
    for (let n = 6; n <= 16; n++)
      for (const oc of n < 8 ? [4] : [4, 8]) {
        const saved = AMERICANO_PATTERNS[patternKey(n, oc)];
        expect(saved, `${n}:${oc}`).toHaveLength(PATTERN_ROUNDS);
        for (const s of saved) {
          const r = decodeRound(s);
          const seats = [...r.games.flatMap((g) => [...g.a, ...g.b]), ...r.sit];
          expect(new Set(seats).size).toBe(n);
          expect(seats.every((x) => x >= 0 && x < n)).toBe(true);
          expect(encodeRound(r)).toBe(s);
        }
      }
  });

  it('a night longer than the saved pattern carries on with the same rules (to 22 rounds)', () => {
    for (const [n, oc] of [
      [6, 4],
      [10, 8],
      [13, 4],
    ]) {
      const list = extendRounds(n, oc, (AMERICANO_PATTERNS[patternKey(n, oc)] ?? []).map(decodeRound), 22);
      expect(list).toHaveLength(22);
      expect(list.slice(0, 16).map(encodeRound)).toEqual(AMERICANO_PATTERNS[patternKey(n, oc)]);
      const sits = new Array(n).fill(0);
      for (const r of list as SeatRound[]) {
        for (const s of r.sit) sits[s]++;
        expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the same players always get the same seats (any order in), and another tournament other seats', () => {
    const a = seatOrder(['c', 'a', 'b', 'd', 'e', 'f'], 't1');
    expect(seatOrder(['f', 'e', 'd', 'c', 'b', 'a'], 't1')).toEqual(a);
    const others = ['t2', 't3', 't4', 't5'].map((k) => seatOrder(['a', 'b', 'c', 'd', 'e', 'f'], k).join());
    expect(others.some((o) => o !== a.join())).toBe(true);
  });

  it('the stored slots: "id1+id2", and a Locked doubles slot like "T3" is not one', () => {
    expect(pairSlot(['a1', 'b2'])).toBe('a1+b2');
    expect(slotPair('a1+b2')).toEqual(['a1', 'b2']);
    expect(isAmericanoSlot('T3')).toBe(false);
    expect(isAmericanoSlot('W12')).toBe(false);
    expect(isAmericanoSlot('a1+b2')).toBe(true);
  });
});

describe('zip 61: the points table', () => {
  // Picture 32 (Round 3 being played, rounds 1 and 2 in): Vic 2-0 22 pts, Christopher 1-1 20, Parker 1-1 20, Wren 1-1 19, Reese 1-1 17,
  // Rowan 1-0 11, Zoe 1-0 11, Sage 0-2 15, Alex 0-1 7, Quinn 0-1 6.
  const names = ['Alex', 'Christopher', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Sage', 'Vic', 'Wren', 'Zoe'];
  const g = (a: [string, string], b: [string, string], scoreA: number, scoreB: number) => ({ a, b, scoreA, scoreB });
  it('wins first, then total points (the picture order, with the live table numbers)', () => {
    const real = [g(['Vic', 'Christopher'], ['Wren', 'Sage'], 11, 9), g(['Parker', 'Reese'], ['Alex', 'Quinn'], 11, 7), g(['Vic', 'Wren'], ['Parker', 'Christopher'], 11, 9), g(['Rowan', 'Zoe'], ['Reese', 'Sage'], 11, 6)];
    const rows = pointsTable(names, real, { byPercent: false, final: false });
    const shown = rows.map((r) => `${r.id} ${winLoss(r)} ${r.points}`);
    expect(shown.slice(0, 3)).toEqual(['Vic 2-0 22', 'Christopher 1-1 20', 'Parker 1-1 20']);
    // 1-0 with 11 points is below every 1-1 with more points (wins first, then points; not win percentage while nobody has left).
    expect(rows.findIndex((r) => r.id === 'Rowan')).toBeGreaterThan(rows.findIndex((r) => r.id === 'Reese'));
    expect(rows.find((r) => r.id === 'Sage')!.rank).toBeGreaterThan(rows.find((r) => r.id === 'Zoe')!.rank);
    // Nobody is "Tied" while the night is on (Christopher and Parker are level), only once every game is in.
    expect(rows.some((r) => r.tied)).toBe(false);
    const done = pointsTable(names, real, { byPercent: false, final: true });
    expect(done.filter((r) => r.tied).map((r) => r.id)).toEqual(expect.arrayContaining(['Christopher', 'Parker']));
  });

  it('after someone leaves: win percentage, then average point difference per game', () => {
    const list = [
      g(['A', 'B'], ['C', 'D'], 11, 5),
      g(['A', 'C'], ['B', 'D'], 11, 9),
      g(['B', 'C'], ['A', 'D'], 11, 2),
      g(['B', 'D'], ['A', 'C'], 11, 10),
    ];
    // E played one game and won it 11 to 0 with A before leaving: 100% beats A's 3 of 5.
    list.push(g(['E', 'A'], ['C', 'D'], 11, 0));
    const wins = pointsTable(['A', 'B', 'C', 'D', 'E'], list, { byPercent: false, final: false });
    const pct = pointsTable(['A', 'B', 'C', 'D', 'E'], list, { byPercent: true, final: false });
    expect(wins[0].id).not.toBe('E');
    expect(pct[0].id).toBe('E');
    // Same percentage: the better average point difference first.
    const same = pointsTable(['X', 'Y', 'Z', 'W'], [g(['X', 'Z'], ['Y', 'W'], 11, 9), g(['Y', 'Z'], ['X', 'W'], 11, 1), g(['X', 'Y'], ['Z', 'W'], 11, 3)], { byPercent: true, final: false });
    // X, Y and Z all won 2 of 3; Y is +16 over 3 games, Z +4, X 0.
    expect(same.map((r) => r.id).slice(0, 3)).toEqual(['Y', 'Z', 'X']);
  });

  it('players with no games yet: 0-0, in the order they came (names), nobody tied', () => {
    const rows = pointsTable(['A', 'B', 'C'], [], { byPercent: false, final: true });
    expect(rows.map((r) => [r.id, winLoss(r), r.points, r.tied])).toEqual([
      ['A', '0-0', 0, false],
      ['B', '0-0', 0, false],
      ['C', '0-0', 0, false],
    ]);
  });
});
