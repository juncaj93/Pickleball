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
  gamesDiffer,
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
import { americanoPlan, doublesPlan, END_BUFFER } from '../shared/tournamentPlan';

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
  // Opponents spread as evenly as the size allows: a night of up to 8 rounds, two players meet at most 2 more times than the two who meet
  // least; a longer night (9 rounds or more) at most 3. Zip 89: counted by the night's rounds, not its court time: with the warm-up and the
  // breaks the court time no longer says how many rounds a night has (8 players on 1 court now get 9 rounds in 2.5 hours).
  const pairs = players.flatMap((x, i) => players.slice(i + 1).map((y) => opps.get([x, y].sort().join()) ?? 0));
  expect(Math.max(...pairs) - Math.min(...pairs)).toBeLessThanOrEqual(night.rounds <= 8 ? 2 : 3);
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
      // Every player gets at least 4 games (the table's rule), and the finish (warm-up, rounds and breaks) is inside the court time minus the end
      // buffer (Zip 89: 20 minutes).
      expect(c.minGames).toBeGreaterThanOrEqual(4);
      expect(p.minutesUsed).toBeLessThanOrEqual(r.minutes - END_BUFFER);
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
    // Zip 97 (120 or 150 minutes to plan in: the court time less the 10 minute warm-up and the 20 minute buffer; 17 a round to 11, 14 to 9, 11
    // to 7, were 20 / 16 / 13; somebody always sits, so no breaks). 14: 2.5h fits 7 rounds to 11 (119 minutes; 7 x 8 = 56 = 4 each), 3h 8 rounds
    // to 11 (136; 64 seats, 4 to 5 each). 16: 2.5h fits 8 rounds to 9 (112; 8 to 11 would be 136), 3h 8 rounds to 11 (136); 8 x 8 = 64 = 4 each.
    expect(report).toEqual(['14 players 2.5h: 7 rounds to 11, 4 games each', '14 players 3h: 8 rounds to 11, 4 to 5 games each', '16 players 2.5h: 8 rounds to 9, 4 games each', '16 players 3h: 8 rounds to 11, 4 games each']);
  });

  it('the pictures: 10 players, 2 courts, 7:30 to 10 PM = 7 rounds to 11 (Zip 97, was 6), 2 sit each round', () => {
    // Zip 97: 10 + 7 x 17 = 129 minutes (was 6 rounds of 20).
    const night = americanoNight(ids(10), 2, 150, 'cold-open');
    expect([night.rounds, night.plan.gameTo]).toEqual([7, 11]);
    for (let r = 1; r <= 7; r++) expect(night.sits.get(r)).toHaveLength(2);
  });

  it('6 and 7 players use one court only (a second court is never used under 8)', () => {
    for (const n of [6, 7]) expect(americanoNight(ids(n), 2, 180, 'x').games.every((g) => g.court === 1)).toBe(true);
  });

  it('8 players on 2 courts: the pattern is a whist (7 rounds: every partner exactly once, every opponent exactly twice); a 2.5 hour night (Zip 97, was 3 hours) plays its first 6 rounds, no partner twice', () => {
    // The pattern 8 players on 2 courts use: its first 7 rounds are the whole whist.
    const whist = tallyOf(8, seatRounds(8, 8, 7));
    expect(spreadOf(whist)).toMatchObject({ oppMin: 2, oppMax: 2 });
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (x !== y) expect(whist.partner[x][y]).toBe(1);
    // Zip 97: at 17 a round, 3 hours now plays the whole whist (7 rounds and 3 breaks, 10 + 119 + 15 = 144), so this test's night (one cut short
    // of the whist) is 2.5 hours: 120 minutes to plan in (10 warm-up, 20 kept free); nobody sits, so a 5 minute break after every 2nd round: 6
    // rounds to 11 and 2 breaks (102 + 10 = 112 minutes; 7 rounds and 3 breaks would be 134). 6 rounds cannot be a whole whist (each player has
    // 7 possible partners), so what the night proves is: its 6 rounds are the whist's first 6, everyone plays all 6, nobody partners anyone
    // twice and nobody faces anyone more than twice.
    const night = americanoNight(ids(8), 2, 150, 'w');
    expect([night.rounds, night.plan.gameTo, night.plan.breaks]).toEqual([6, 11, 2]);
    const played = seatRounds(8, 8, night.rounds);
    expect(played.map(encodeRound)).toEqual(seatRounds(8, 8, 7).slice(0, 6).map(encodeRound));
    const t = tallyOf(8, played);
    expect(spreadOf(t).oppMax).toBe(2);
    for (let x = 0; x < 8; x++) {
      const partners = [0, 1, 2, 3, 4, 5, 6, 7].filter((y) => y !== x).map((y) => t.partner[x][y]);
      expect(Math.max(...partners)).toBe(1);
      expect(partners.reduce((a, b) => a + b, 0)).toBe(6);
    }
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
  // Alex, Nov 19: win percentage whenever players have played different numbers of games, then total points; equal games: wins, then points.
  const names = ['Alex', 'Christopher', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Sage', 'Vic', 'Wren', 'Zoe'];
  const g = (a: [string, string], b: [string, string], scoreA: number, scoreB: number) => ({ a, b, scoreA, scoreB });
  it('equal games: wins first, then total points; "Tied" only once every game is in', () => {
    const four = ['A', 'B', 'C', 'D'];
    const list = [g(['A', 'B'], ['C', 'D'], 11, 9), g(['A', 'C'], ['B', 'D'], 11, 5), g(['A', 'D'], ['B', 'C'], 7, 11)];
    // Everyone played 3: C 2-1 31 pts, A 2-1 29, B 2-1 27, D 0-3 21.
    const rows = pointsTable(four, list, { final: false });
    expect(rows.map((r) => `${r.id} ${winLoss(r)} ${r.points}`)).toEqual(['C 2-1 31', 'A 2-1 29', 'B 2-1 27', 'D 0-3 21']);
    expect(gamesDiffer(rows)).toBe(false);
    expect(rows.some((r) => r.tied)).toBe(false);
    const level = pointsTable(['X', 'Y', 'Z', 'W'], [g(['X', 'Y'], ['Z', 'W'], 11, 5), g(['X', 'Z'], ['Y', 'W'], 5, 11)], { final: true });
    // X 1-1 16 pts, Y 2-0 22, Z 0-2 10, W 1-1 16: X and W are level on every rule, so Tied once every game is in.
    expect(level.filter((r) => r.tied).map((r) => r.id).sort()).toEqual(['W', 'X']);
    expect(pointsTable(['X', 'Y', 'Z', 'W'], [g(['X', 'Y'], ['Z', 'W'], 11, 5), g(['X', 'Z'], ['Y', 'W'], 5, 11)], { final: false }).some((r) => r.tied)).toBe(false);
  });

  it('different numbers of games (picture 32: two players sat Round 1): win percentage first, then total points', () => {
    const real = [g(['Vic', 'Christopher'], ['Wren', 'Sage'], 11, 9), g(['Parker', 'Reese'], ['Alex', 'Quinn'], 11, 7), g(['Vic', 'Wren'], ['Parker', 'Christopher'], 11, 9), g(['Rowan', 'Zoe'], ['Reese', 'Sage'], 11, 6)];
    const rows = pointsTable(names, real, { final: false });
    expect(gamesDiffer(rows)).toBe(true);
    // 100%: Vic 2-0 (22), then Rowan and Zoe 1-0 (11 each, name order); 50%: Christopher 20, Parker 20, Wren 20, Reese 17; 0%: Sage 15, Alex 7, Quinn 7.
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual(['Vic', 'Rowan', 'Zoe']);
    expect(rows.findIndex((r) => r.id === 'Rowan')).toBeLessThan(rows.findIndex((r) => r.id === 'Christopher'));
    const half = rows.filter((r) => r.wins === 1 && r.losses === 1).map((r) => r.points);
    expect(half).toEqual([...half].sort((x, y) => y - x));
    expect(rows.slice(-3).map((r) => r.wins)).toEqual([0, 0, 0]);
    // Same percentage over different counts (2 of 4 and 1 of 2): total points decides. Y 2-2 with 30 points is above X 1-1 with 20.
    const same = pointsTable(
      ['X', 'Y', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
      [
        g(['Y', 'F1'], ['F2', 'F3'], 11, 0),
        g(['Y', 'F1'], ['F2', 'F3'], 0, 11),
        g(['Y', 'F2'], ['F1', 'F3'], 11, 1),
        g(['Y', 'F2'], ['F1', 'F3'], 8, 11),
        g(['X', 'F4'], ['F5', 'F6'], 11, 0),
        g(['X', 'F4'], ['F5', 'F6'], 9, 11),
      ],
      { final: false },
    );
    const at = (id: string) => same.findIndex((r) => r.id === id);
    expect([winLoss(same[at('Y')]), same[at('Y')].points, winLoss(same[at('X')]), same[at('X')].points]).toEqual(['2-2', 30, '1-1', 20]);
    expect(at('Y')).toBeLessThan(at('X'));
  });

  it('players with no games yet: 0-0, in the order they came (names), nobody tied', () => {
    const rows = pointsTable(['A', 'B', 'C'], [], { final: true });
    expect(rows.map((r) => [r.id, winLoss(r), r.points, r.tied])).toEqual([
      ['A', '0-0', 0, false],
      ['B', '0-0', 0, false],
      ['C', '0-0', 0, false],
    ]);
  });
});
