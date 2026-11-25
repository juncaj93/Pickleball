import { describe, expect, it } from 'vitest';
import { doublesStructure, nightPlan } from '../shared/tournamentPlan';
import {
  backToBack,
  draftTeams,
  type GameResult,
  groupsOf,
  pairTotal,
  poolsOf,
  resolveGames,
  schedule,
  seededRandom,
  spreadOf,
  standings,
  timeCheck,
  timeCheckWords,
} from '../shared/tournamentSchedule';

// Zip 57: the schedule for every size 6 to 16 (3 to 8 teams), on 1 and 2 courts; the draft; standings (wins, head to head, Tied); who plays the
// playoffs; the Time check. All pure functions.

const seatsOf = (slot: string) => (slot.startsWith('T') ? Number(slot.slice(1)) : null);

describe('zip 57: the schedule, every size, both court counts', () => {
  for (let teams = 3; teams <= 8; teams++) {
    for (const courts of [1, 2]) {
      it(`${teams * 2} players (${teams} teams), ${courts} court${courts > 1 ? 's' : ''}`, () => {
        const games = schedule(teams, courts);
        const s = doublesStructure(teams, courts);
        const rounds = Math.max(...games.map((g) => g.round));
        // The same rounds as the game plan table.
        expect(rounds).toBe(s.poolRounds + s.playoffRounds);
        expect(rounds).toBe(nightPlan(teams * 2, courts, 180, 'doubles').rounds);
        // Game numbers in play order, courts within what is used.
        games.forEach((g, i) => expect(g.num).toBe(i + 1));
        for (let i = 1; i < games.length; i++) expect(games[i].round > games[i - 1].round || (games[i].round === games[i - 1].round && games[i].court > games[i - 1].court)).toBe(true);
        expect(games.every((g) => g.court >= 1 && g.court <= s.courtsUsed)).toBe(true);
        // No team twice in one round.
        for (let r = 1; r <= rounds; r++) {
          const seats = games.filter((g) => g.round === r).flatMap((g) => [seatsOf(g.a), seatsOf(g.b)]).filter((x) => x !== null);
          expect(new Set(seats).size).toBe(seats.length);
        }
        // Every pair in a group plays exactly once.
        for (const grp of groupsOf(teams)) {
          for (const x of grp.seats)
            for (const y of grp.seats)
              if (x < y) {
                const n = games.filter((g) => g.stage === 'pool' && [g.a, g.b].sort().join() === [`T${x}`, `T${y}`].sort().join()).length;
                expect(n, `T${x} v T${y}`).toBe(1);
              }
          expect(games.filter((g) => g.stage === 'pool' && grp.seats.includes(seatsOf(g.a)!)).every((g) => g.pool === grp.pool)).toBe(true);
        }
        // Playoffs: the 3rd place game only on 2 courts with 4 teams or more; semis only with pools.
        expect(games.some((g) => g.stage === 'third')).toBe(s.third);
        expect(games.some((g) => g.stage === 'semi')).toBe(s.semis);
        expect(games.filter((g) => g.stage === 'final')).toHaveLength(1);
        if (s.semis) {
          const semis = games.filter((g) => g.stage === 'semi');
          expect(semis.map((g) => [g.a, g.b])).toEqual([
            ['A1', 'B2'],
            ['B1', 'A2'],
          ]);
          const fin = games.find((g) => g.stage === 'final')!;
          expect([fin.a, fin.b]).toEqual([`W${semis[0].num}`, `W${semis[1].num}`]);
        }
      });
    }
  }

  it('back to back: only where it cannot be avoided (3 teams), never otherwise', () => {
    const b2b = (teams: number, courts: number) => Array.from({ length: teams }, (_, i) => backToBack(schedule(teams, courts), i + 1));
    // 6 players: 3 games one at a time: two teams play two in a row (any order of a triangle does).
    expect(b2b(3, 1).reduce((a, b) => a + b, 0)).toBe(2);
    expect(b2b(3, 2)).toEqual(b2b(3, 1));
    // 8 players on 1 court: of 6 games of 4 teams, each pair of games that share no team is only one of three, so 2 back to back is the least.
    expect(b2b(4, 1).reduce((a, b) => a + b, 0)).toBe(2);
    for (const [teams, courts] of [
      [5, 1],
      [6, 1],
      [7, 1],
      [8, 1],
    ])
      expect(b2b(teams, courts).every((n) => n === 0), `${teams} teams ${courts} court`).toBe(true);
  });

  it('5 teams on 2 courts: one team sits each round, each team sits exactly once (10 games)', () => {
    const games = schedule(5, 2).filter((g) => g.stage === 'pool');
    expect(games).toHaveLength(10);
    const sits: number[] = [];
    for (let r = 1; r <= 5; r++) {
      const play = games.filter((g) => g.round === r).flatMap((g) => [seatsOf(g.a)!, seatsOf(g.b)!]);
      expect(play).toHaveLength(4);
      sits.push([1, 2, 3, 4, 5].find((s) => !play.includes(s))!);
    }
    expect([...sits].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('the brief\'s counts: 6 = 3 games + Final; 8 = 3 rounds, 6 games; 10 = 5 rounds, 10 games; 12 = pools of 3, semis, Final and 3rd', () => {
    expect(schedule(3, 1).filter((g) => g.stage === 'pool')).toHaveLength(3);
    expect(schedule(4, 2).filter((g) => g.stage === 'pool')).toHaveLength(6);
    expect(Math.max(...schedule(4, 2).filter((g) => g.stage === 'pool').map((g) => g.round))).toBe(3);
    expect(schedule(5, 2).filter((g) => g.stage === 'pool')).toHaveLength(10);
    const twelve = schedule(6, 2);
    expect(twelve.filter((g) => g.stage === 'pool')).toHaveLength(6);
    expect(twelve.map((g) => g.stage).slice(-4)).toEqual(['semi', 'semi', 'final', 'third']);
    // 14: Pool A of 4 and Pool B of 3, 5 pool rounds. Zip 80: Pool A opens on both courts, each Pool B game is beside a Pool A game (Pool B
    // on Court 2), and the last pool round is one Pool A game, so no team plays 3 rounds in a row (tests/zip80-sits.test.ts).
    const fourteen = schedule(7, 2);
    expect([1, 2, 3, 4, 5].map((r) => fourteen.filter((g) => g.round === r).map((g) => `${g.pool}${g.court}`).join(' '))).toEqual(['A1 A2', 'A1 B2', 'A1 B2', 'A1 B2', 'A1']);
    expect(Math.max(...fourteen.filter((g) => g.stage === 'pool').map((g) => g.round))).toBe(5);
    // 16: two pools of 4, one game per pool per round, 6 rounds: 2 teams per pool sit each round.
    const sixteen = schedule(8, 2);
    for (let r = 1; r <= 6; r++) expect(sixteen.filter((g) => g.round === r).map((g) => g.pool)).toEqual(['A', 'B']);
  });
});

describe('zip 57: draft teams', () => {
  const eight = [
    { id: 'p', name: 'Parker', level: 360 },
    { id: 'r', name: 'Rowan', level: 350 },
    { id: 's', name: 'Sage', level: 340 },
    { id: 'v', name: 'Vic', level: 320 },
    { id: 'w', name: 'Wren', level: 320 },
    { id: 'c', name: 'Christopher', level: 300 },
    { id: 'z', name: 'Zoe', level: 275 },
    { id: 'q', name: 'Quinn', level: 250 },
  ];
  it('mock 15: strongest with weakest (6.1, 6.25, 6.4, 6.4)', () => {
    const pairs = draftTeams(eight, seededRandom(1));
    expect(pairs.map((p) => `${p[0].name}+${p[1].name}`)).toEqual(['Parker+Quinn', 'Rowan+Zoe', 'Sage+Christopher', expect.stringMatching(/^(Vic\+Wren|Wren\+Vic)$/)]);
    expect(pairs.map(pairTotal)).toEqual([610, 625, 640, 640]);
  });
  it('Redo the draw gives another close pairing (every player once), never wildly worse', () => {
    const first = draftTeams(eight, seededRandom(1));
    const best = spreadOf(first);
    for (let seed = 1; seed < 30; seed++) {
      const next = draftTeams(eight, seededRandom(seed), first);
      expect(next.flat().map((p) => p.id).sort()).toEqual(eight.map((p) => p.id).sort());
      expect(spreadOf(next)).toBeLessThanOrEqual(best + 20);
    }
    const keys = new Set(Array.from({ length: 30 }, (_, s) => JSON.stringify(draftTeams(eight, seededRandom(s + 100), first).map((p) => p.map((x) => x.id).sort()))));
    expect(keys.size).toBeGreaterThan(1);
  });
  it('pools are balanced by total: A, B, B, A ... and Pool A takes the 4th team of 7', () => {
    expect(poolsOf([700, 690, 680, 670, 660, 650])).toEqual(['A', 'B', 'B', 'A', 'A', 'B']);
    const seven = poolsOf([700, 690, 680, 670, 660, 650, 640]);
    expect(seven.filter((p) => p === 'A')).toHaveLength(4);
    expect(poolsOf([1, 2, 3, 4, 5, 6, 7, 8]).filter((p) => p === 'B')).toHaveLength(4);
  });
});

describe('zip 57: standings and the playoffs', () => {
  const res = (list: [number, 'a' | 'b' | null][]) => new Map<number, GameResult>(list.map(([num, winner]) => [num, { num, winner }]));
  it('wins first, then head to head; 0-0 keeps seat order; a 3-way circle stays Tied once the pool is done', () => {
    const games = schedule(3, 1); // 1v2, 1v3, 2v3, Final
    expect(standings(games, new Map(), [1, 2, 3]).map((r) => [r.seat, r.rank, r.tied])).toEqual([
      [1, 1, false],
      [2, 2, false],
      [3, 3, false],
    ]);
    // 2 beats 1, 1 beats 3, 3 beats 2: everyone 1-1, head to head 1 each: Tied.
    const circle = res([
      [1, 'b'],
      [2, 'a'],
      [3, 'b'],
    ]);
    expect(standings(games, circle, [1, 2, 3]).every((r) => r.tied && r.wins === 1)).toBe(true);
    const fin = resolveGames(3, games, circle).find((g) => g.num === 4)!;
    expect(fin).toMatchObject({ a: null, b: null, tied: true });
    // 1 beats 2 and 3: 1st; 2 beats 3: 2nd. The Final is 1 v 2.
    const clear = res([
      [1, 'a'],
      [2, 'a'],
      [3, 'a'],
    ]);
    expect(standings(games, clear, [1, 2, 3]).map((r) => r.seat)).toEqual([1, 2, 3]);
    expect(resolveGames(3, games, clear).find((g) => g.num === 4)).toMatchObject({ a: 1, b: 2, tied: false });
  });
  it('head to head breaks a 2-team tie on wins', () => {
    const games = schedule(4, 2); // R1 1v2 3v4, R2 2v4 1v3 (the courts swap), R3 1v4 2v3
    // 1 and 3 both finish 2-1, and 3 beat 1.
    const r = res([
      [1, 'a'], // 1 beats 2
      [2, 'b'], // 4 beats 3
      [3, 'a'], // 2 beats 4
      [4, 'b'], // 3 beats 1
      [5, 'a'], // 1 beats 4
      [6, 'b'], // 3 beats 2
    ]);
    const st = standings(games, r, [1, 2, 3, 4]);
    expect(st.slice(0, 2).map((x) => [x.seat, x.wins])).toEqual([
      [3, 2],
      [1, 2],
    ]);
    expect(resolveGames(4, games, r).filter((g) => g.num > 6)).toEqual([
      { num: 7, a: 3, b: 1, tied: false, never: false },
      { num: 8, a: 2, b: 4, tied: false, never: false },
    ]);
  });
  it('12 players: semis are pool winner vs the other pool runner-up; the Final follows the semis', () => {
    const games = schedule(6, 2); // pool A seats 1-3, pool B 4-6
    const all = new Map<number, GameResult>();
    // Seat 1 and seat 4 win everything; 2 beats 3, 5 beats 6.
    for (const g of games.filter((x) => x.stage === 'pool')) {
      const a = Number(g.a.slice(1));
      const b = Number(g.b.slice(1));
      all.set(g.num, { num: g.num, winner: a < b ? 'a' : 'b' });
    }
    const semis = resolveGames(6, games, all).filter((g) => games[g.num - 1].stage === 'semi');
    expect(semis.map((g) => [g.a, g.b])).toEqual([
      [1, 5],
      [4, 2],
    ]);
    all.set(semis[0].num, { num: semis[0].num, winner: 'b' });
    all.set(semis[1].num, { num: semis[1].num, winner: 'a' });
    const last = resolveGames(6, games, all).slice(-2);
    expect(last.map((g) => [g.a, g.b])).toEqual([
      [5, 4],
      [1, 2],
    ]);
  });
  it('a team that leaves: a playoff it can no longer play is a walkover; a played playoff keeps its teams (frozen)', () => {
    const games = schedule(6, 2); // pools A 1-3, B 4-6; semis 7 (A1 v B2), 8 (B1 v A2); final 9, 3rd 10
    const all = new Map<number, GameResult>();
    for (const g of games.filter((x) => x.stage === 'pool')) {
      const a = Number(g.a.slice(1));
      const b = Number(g.b.slice(1));
      all.set(g.num, { num: g.num, winner: a < b ? 'a' : 'b' });
    }
    // Seat 1 (A1) leaves after pool play: its semi is skipped, seat 5 (B2) goes on to the Final; nobody plays for 3rd from that semi.
    all.set(7, { num: 7, winner: null, skipped: true });
    const frozen = new Map([[7, { a: 1, b: 5 }]]);
    const r = resolveGames(6, games, all, new Set(), frozen, new Set([1]));
    expect(r[6]).toMatchObject({ a: 1, b: 5 });
    expect(r[8]).toMatchObject({ a: 5, b: null }); // the Final waits for semi 8
    expect(r[9]).toMatchObject({ never: true }); // 3rd place: one side never comes
    // A played semi keeps its teams even if a pool result is changed later.
    all.set(8, { num: 8, winner: 'a' });
    const frozen2 = new Map([...frozen, [8, { a: 4, b: 2 }]]);
    all.set(3, { num: 3, winner: 'b' });
    expect(resolveGames(6, games, all, new Set(), frozen2, new Set([1]))[8]).toMatchObject({ a: 5, b: 4 });
  });
  it('a team that leaves during pool play drops to the bottom and its place in a playoff never fills', () => {
    const games = schedule(4, 2);
    const all = new Map<number, GameResult>();
    for (const g of games.filter((x) => x.stage === 'pool')) {
      const a = Number(g.a.slice(1));
      const b = Number(g.b.slice(1));
      const skip = a === 3 || b === 3;
      all.set(g.num, skip ? { num: g.num, winner: null, skipped: true } : { num: g.num, winner: a < b ? 'a' : 'b' });
    }
    const r = resolveGames(4, games, all, new Set([3]));
    expect(r[6]).toMatchObject({ a: 1, b: 2, never: false }); // the Final
    expect(r[7]).toMatchObject({ never: true }); // 3rd place: 4th is the team that left
  });
  it('a skipped game counts for nobody and still lets the pool finish', () => {
    const games = schedule(3, 1);
    const r = new Map<number, GameResult>([
      [1, { num: 1, winner: 'a' }],
      [2, { num: 2, winner: null, skipped: true }],
      [3, { num: 3, winner: 'a' }],
    ]);
    const st = standings(games, r, [1, 2, 3]);
    expect(st.map((x) => [x.seat, x.wins, x.losses])).toEqual([
      [1, 1, 0],
      [2, 1, 1],
      [3, 0, 1],
    ]);
    expect(resolveGames(3, games, r)[3]).toMatchObject({ a: 1, b: 2 });
  });
});

describe('zip 57: the Time check', () => {
  // 12 players on 2 courts, 7:30 to 10:00 PM: 3 pool rounds to 11, the semis, then the Final and 3rd place. Zip 89: 20 minutes a round to 11, 16
  // to 9, 13 to 7, so 100 minutes (done 9:10 PM); the limit is 9:40 PM (20 minutes kept free before the courts close).
  const rounds = (done: number, doneAt: number[] = []) =>
    [1, 2, 3, 4, 5].map((r) => ({ round: r, pool: r <= 3, playTo: 11 as const, done: r <= done, doneAt: doneAt[r - 1] }));
  const S = 19 * 60 + 30;
  const E = 22 * 60;
  it('on time: nothing to say', () => {
    // Round 1 done right at its planned end (7:50 PM).
    expect(timeCheck(rounds(1, [S + 20]), S, E, S + 30)).toMatchObject({ current: 2, behind: 0, suggest: null });
  });
  it('a little behind but it still fits before the buffer: no banner', () => {
    // Round 1 done at 8:15 PM (25 minutes late): finish 9:35 PM, inside 9:40.
    expect(timeCheck(rounds(1, [20 * 60 + 15]), S, E, 20 * 60 + 16)).toMatchObject({ behind: 25, suggest: null });
  });
  it('behind: games to 9 from the latest round that is enough, else 7; and how far over when nothing is enough', () => {
    // Done at 8:25 PM (35 late): finish 9:45. To 9 from round 3 saves 4 (9:41, not enough); from round 2 saves 8: 9:37.
    const tc = timeCheck(rounds(1, [20 * 60 + 25]), S, E, 20 * 60 + 26);
    expect(tc.behind).toBe(35);
    expect(tc.suggest).toEqual({ fromRound: 2, to: 9, stillOver: 0 });
    expect(timeCheckWords(tc.behind, 2, 9, '10:00 PM')).toBe('Running about 35 minutes behind. From Round 2 on, play to 9 so we finish on time.');
    // Done at 8:30 PM (40 late): finish 9:50. To 9 from round 2: 9:42, no; to 7 from round 3 saves 7: 9:43, no; from round 2 saves 14: 9:36.
    expect(timeCheck(rounds(1, [20 * 60 + 30]), S, E, 20 * 60 + 31).suggest).toEqual({ fromRound: 2, to: 7, stillOver: 0 });
    // Done at 8:40 PM (50 late): finish 10:00; the most it can save is 14 minutes: 9:46, still 6 minutes over the 9:40 limit.
    expect(timeCheck(rounds(1, [20 * 60 + 40]), S, E, 20 * 60 + 41).suggest).toEqual({ fromRound: 2, to: 7, stillOver: 6 });
    expect(timeCheckWords(50, 2, 7, '10:00 PM', 6)).toBe('Running about 50 minutes behind. From Round 2 on, play to 7. That still runs about 6 minutes over.');
  });
  it('the current round counts as late while it runs past its planned end', () => {
    // Round 1 on time; round 2 planned to end 8:10 PM; still playing at 8:40 PM: it ends no earlier than now (3 rounds of 20 after it: 9:40).
    const tc = timeCheck(rounds(1, [S + 20]), S, E, 20 * 60 + 40);
    expect(tc.behind).toBe(30);
  });
  it('never touches the playoffs or a round being played', () => {
    const tc = timeCheck(rounds(3, [S + 40, S + 80, 21 * 60 + 20]), S, E, 21 * 60 + 21);
    expect(tc.current).toBe(4);
    expect(tc.suggest).toBeNull();
  });
});
