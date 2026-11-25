// Zip 92 (Alex): THE FAIRNESS RULE (shared/tournamentFairness.ts) on the real schedules, and the style rule built from it.
import { describe, expect, it } from 'vitest';
import { fairnessOf } from '../shared/tournamentFairness';
import { playsAmericano } from '../shared/tournament';
import { americanoNight, endsFair, fairEnd, onCourtFor, seatRounds } from '../shared/americanoSchedule';
import { americanoPlan } from '../shared/tournamentPlan';
import { courtTimeLine } from '../shared/tournamentCard';

describe('the fairness rule', () => {
  it('2 courts, 2.5 and 3 hours, 8 to 16 players, either style asked for: the style the rule plays passes every part', () => {
    for (const minutes of [150, 180])
      for (let n = 8; n <= 16; n++)
        for (const asked of ['doubles', 'americano'] as const) {
          const style = asked === 'doubles' && !playsAmericano(n) ? 'doubles' : 'americano';
          const f = fairnessOf(n, 2, minutes, style);
          expect({ n, minutes, style, even: f.even, enough: f.enough, noEarlyEnd: f.noEarlyEnd, fits: f.fits }).toEqual({ n, minutes, style, even: true, enough: true, noEarlyEnd: true, fits: true });
        }
  });
  it('Locked doubles fails at 12 and 14 whatever the court time (groups of three: 2 regular games), so those counts play Americano', () => {
    for (const n of [12, 14])
      for (const courts of [1, 2])
        for (const minutes of [120, 150, 180]) {
          const f = fairnessOf(n, courts, minutes, 'doubles');
          expect(f.min).toBe(2);
          expect(f.enough).toBe(false);
          expect(playsAmericano(n)).toBe(true);
        }
    for (const n of [8, 10, 16]) expect(fairnessOf(n, 2, 150, 'doubles').pass).toBe(true);
  });
  it('2 hours on 2 courts is too tight for 13 to 16 (more court time fixes it: the card suggests it), never a style switch', () => {
    for (const n of [13, 14, 15, 16]) {
      expect(fairnessOf(n, 2, 120, 'americano').pass).toBe(false);
      expect(fairnessOf(n, 2, 150, 'americano').pass).toBe(true);
    }
    expect(fairnessOf(16, 2, 120, 'doubles').fits).toBe(false);
    expect(fairnessOf(16, 2, 150, 'doubles').pass).toBe(true);
  });
  it('playoff games never count as regular games (8 Locked doubles on 2.5 hours: 3 each, the semifinals and the Final are extra)', () => {
    const f = fairnessOf(8, 2, 150, 'doubles');
    expect([f.min, f.max, f.playoff]).toEqual([3, 3, 4]);
  });
  it('Americano: everyone plays in the last two rounds; the rounds keep every sit and partner rule (only their order, or a remade last round, changes)', () => {
    for (let n = 9; n <= 16; n++) {
      const onCourt = onCourtFor(n, 2);
      const rounds = americanoPlan(n, 2, 150).rounds;
      const raw = seatRounds(n, onCourt, rounds);
      const fair = fairEnd(n, onCourt, raw);
      expect(endsFair(n, onCourt, fair), `${n}`).toBe(true);
      // The same rounds in another order; only when no order works (15, 16) is the LAST round made again with the same rules.
      const rawSet = raw.map((r) => JSON.stringify(r));
      expect(fair.slice(0, -1).every((r) => rawSet.includes(JSON.stringify(r))), `${n}`).toBe(true);
      const night = americanoNight(Array.from({ length: n }, (_, i) => `p${i}`), 2, 150, 'x');
      const last = new Set(night.games.filter((g) => g.round >= night.rounds - 1).flatMap((g) => [...g.a, ...g.b]));
      expect(last.size, `${n} players: everyone in the last 2 rounds`).toBe(n);
    }
  });
});

describe('the court time line (Alex)', () => {
  const card = (n: number, o: { courts?: number; start?: number; minutes?: number; format?: 'doubles' | 'americano' } = {}) =>
    courtTimeLine({ finalDate: '2026-12-01', signups: [], tickets: [], lockedIn: n, courts: o.courts ?? 2, start: o.start ?? 19 * 60 + 30, minutes: o.minutes ?? 150, format: o.format ?? 'doubles' } as never);
  it("Alex's three examples on The Cold Open (7:30 to 10 PM, 2 courts)", () => {
    expect(card(10)).toBe('10 locked in: 2 courts, 7:30 to 10 fits.');
    expect(card(8)).toBe('8 locked in: 9:30 is enough, you could cancel 30 min.');
    expect(card(14)).toBe('14 locked in: add 30 min so everyone plays 4 to 11 (7 to 10).');
  });
  it('the end moves later while it stays by 10 PM; a short booking; nothing below 6; no style switch of its own', () => {
    expect(card(10, { minutes: 120 })).toBe('10 locked in: add 30 min so everyone plays 4 to 11 (7:30 to 10).');
    expect(card(9, { format: 'americano' })).toBe('9 locked in: 2 courts, 7:30 to 10 fits.');
    expect(card(5)).toBeNull();
  });
});
