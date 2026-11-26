import { describe, expect, it } from 'vitest';
import { projectedPlayers, projectedTeams } from '../shared/projectedTeams';
import { draftTeams, seededRandom, totalLabel } from '../shared/tournamentSchedule';
import type { AdminTournamentView } from '../shared/tournament';

// Zip 71 (🎾71.teams), part 2: Projected teams on the organizer's Levels card (shared/projectedTeams.ts, a pure function the page runs each time
// it draws). Pictures pair-01 and pair-02: Parker 3.6, Rowan 3.5, Sage 3.4, Vic 3.2, Wren 3.2, Christopher 3.0, Zoe 2.75, Quinn 2.5.

const PICTURE: [string, number][] = [
  ['Parker', 360],
  ['Rowan', 350],
  ['Sage', 340],
  ['Vic', 320],
  ['Wren', 320],
  ['Christopher', 300],
  ['Zoe', 275],
  ['Quinn', 250],
];
type T = Parameters<typeof projectedTeams>[0];
function tour(list: [string, number][] = PICTURE, more: Partial<T> = {}, dates: Record<string, string[]> = {}): T {
  return {
    signups: list.map(([name, level], i) => ({ playerId: `p${i}`, name, pickedLevel: level, level, reviewed: false, dates: dates[name] ?? ['2026-12-01', '2026-12-03'], at: '' })),
    finalDate: null,
    styleDecided: false,
    tickets: [],
    format: 'doubles',
    status: 'open' as AdminTournamentView['status'],
    day: undefined,
    ...more,
  };
}
const words = (t: T) => projectedTeams(t)?.map((x) => `${x.players[0].name} + ${x.players[1].name} = ${totalLabel(x.total)}`) ?? null;

describe('zip 71: Projected teams', () => {
  it('the pictures: strongest with weakest, sorted by team total, each total shown', () => {
    expect(words(tour())).toEqual(['Sage + Christopher = 6.4', 'Vic + Wren = 6.4', 'Rowan + Zoe = 6.25', 'Parker + Quinn = 6.1']);
  });

  it("is Draft teams' pairing (its first draw), whatever the order of the list", () => {
    const distinct: [string, number][] = [['A', 400], ['B', 375], ['C', 350], ['D', 325], ['E', 300], ['F', 275], ['G', 250], ['H', 225], ['I', 200], ['J', 175]];
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = seededRandom(seed);
      const shuffled = [...distinct].sort(() => rnd() - 0.5);
      const mine = projectedTeams(tour(shuffled))!.map((x) => [x.players[0].name, x.players[1].name].sort().join('+')).sort();
      const draft = draftTeams(shuffled.map(([name, level]) => ({ id: name, name, level })), seededRandom(seed)).map((p) => [p[0].name, p[1].name].sort().join('+')).sort();
      expect(mine).toEqual(draft);
    }
  });

  it('follows the current levels: a changed level gives new teams at once', () => {
    const changed = PICTURE.map(([n, l]): [string, number] => [n, n === 'Quinn' ? 375 : l]);
    // Quinn moves from 2.5 to 3.75: now the strongest, paired with the weakest left (Zoe 2.75).
    expect(words(tour(changed))).toEqual(['Rowan + Wren = 6.7', 'Parker + Christopher = 6.6', 'Sage + Vic = 6.6', 'Quinn + Zoe = 6.5']);
  });

  it('follows sign-ups and drops: an odd count hides it (the night would be Americano); one more makes it even again', () => {
    expect(projectedTeams(tour(PICTURE.slice(0, 7)))).toBeNull();
    // Zip 97: 6 plays Americano too (AMERICANO_EVEN), so no projected teams at 6; "one more makes it even again" is 7 to 8 now.
    expect(projectedTeams(tour(PICTURE.slice(0, 6)))).toBeNull();
    expect(projectedTeams(tour(PICTURE))).toHaveLength(4);
    expect(projectedTeams(tour([...PICTURE, ['Reese', 300], ['Avery', 280]]))).toHaveLength(5);
  });

  it('hidden when Americano is picked, when canceled, under 2 players, and once real teams are drafted', () => {
    expect(projectedTeams(tour(PICTURE, { format: 'americano' }))).toBeNull();
    expect(projectedTeams(tour(PICTURE, { status: 'canceled' as AdminTournamentView['status'] }))).toBeNull();
    expect(projectedTeams(tour([]))).toBeNull();
    expect(projectedTeams(tour(PICTURE, { day: { phase: 'draft' } as AdminTournamentView['day'] }))).toBeNull();
    expect(projectedTeams(tour(PICTURE, { day: { phase: 'published' } as AdminTournamentView['day'] }))).toBeNull();
    expect(projectedTeams(tour(PICTURE, { day: { phase: 'none' } as AdminTournamentView['day'] }))).toHaveLength(4);
  });

  it('who it uses: everyone before a date is picked; then who can make the picked date; after tickets close, who is locked in', () => {
    // Zip 97: 6 plays Americano (no projected teams), so two more players sign up here: 8 can make the picked date, 4 projected teams (was the
    // 6 of PICTURE, 3 teams).
    const dates = { Vic: ['2026-12-03'], Wren: ['2026-12-03'] };
    const ten: [string, number][] = [...PICTURE, ['Reese', 300], ['Avery', 280]];
    expect(projectedPlayers(tour(ten, {}, dates))).toHaveLength(10);
    const picked = tour(ten, { finalDate: '2026-12-01' }, dates);
    expect(projectedPlayers(picked).map((p) => p.name)).toEqual(['Parker', 'Rowan', 'Sage', 'Christopher', 'Zoe', 'Quinn', 'Reese', 'Avery']);
    expect(projectedTeams(picked)).toHaveLength(4);
    // After Pay by: a spot, or a whole-ticket I paid waiting for the organizer; not the line, not someone who still owes, not an old ticket.
    const k = (i: number, more: Record<string, unknown> = {}) => ({ playerId: `p${i}`, name: PICTURE[i][0], place: 'spot', placeAt: null, priceCents: 1800, creditCents: 0, paidCents: 1800, claimCents: 0, claimAt: null, out: false, organizer: false, ...more });
    const closed = tour(PICTURE, {
      finalDate: '2026-12-01',
      styleDecided: true,
      tickets: [
        k(0),
        k(1),
        k(2),
        k(3, { place: 'none', paidCents: 0, claimCents: 1800 }), // I paid the whole ticket, waiting: locked in
        k(4, { place: 'none', paidCents: 0, claimCents: 900 }), // half: not locked in
        k(5, { place: 'line' }), // standby
        k(6, { out: true }), // off the list
        k(7, { organizer: true, priceCents: 0, paidCents: 0 }), // the organizer's seat
      ] as AdminTournamentView['tickets'],
    });
    expect(projectedPlayers(closed).map((p) => p.name)).toEqual(['Parker', 'Rowan', 'Sage', 'Vic', 'Quinn']);
    expect(projectedTeams(closed)).toBeNull(); // 5: odd, Americano
  });

  it('ties in level go by name, so the list never moves between refreshes', () => {
    const a = words(tour());
    for (let i = 0; i < 5; i++) expect(words(tour([...PICTURE].reverse()))).toEqual(a);
  });
});
