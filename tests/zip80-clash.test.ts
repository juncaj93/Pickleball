import { describe, expect, it } from 'vitest';
import { clashingGames, clashWords, gameDayKey } from '../shared/tournamentClash';

// Zip 80 (🎾80.leftovers): a regular game on the same date as a finalized tournament: one card on the organizer's Home.

const TZ = 'America/Detroit';
const g = (id: string, startsAt: string, canceled = false) => ({ id, startsAt, canceled });
const tour = (status: string, finalDate: string | null) => ({ status, finalDate });

describe('zip 80: a regular game on a tournament night', () => {
  it('the words: "Tue Dec 1 has a regular game and The Cold Open."', () => {
    expect(clashWords('2026-12-01', 'The Cold Open')).toBe('Tue Dec 1 has a regular game and The Cold Open.');
    expect(clashWords('2026-12-17', 'Winter Classic', 2)).toBe('Thu Dec 17 has 2 regular games and Winter Classic.');
  });

  it('the Eastern day decides (an 8:00 PM game is still Tuesday though it is Wednesday in UTC)', () => {
    expect(gameDayKey('2026-12-02T01:00:00.000Z', TZ)).toBe('2026-12-01');
  });

  it('only a game that is on, on the date of a finalized tournament whose night is still ahead', () => {
    const games = [g('tue', '2026-12-02T00:00:00.000Z'), g('thu', '2026-12-04T00:00:00.000Z'), g('off', '2026-12-02T02:00:00.000Z', true)];
    expect(clashingGames(games, tour('tickets', '2026-12-01'), TZ, '2026-11-21').map((x) => x.id)).toEqual(['tue']);
    // The Dec 1 game already canceled (live today): nothing.
    expect(clashingGames([g('off', '2026-12-02T00:00:00.000Z', true)], tour('tickets', '2026-12-01'), TZ, '2026-11-21')).toEqual([]);
    // Not finalized, canceled, ended, no date, or the night already past: nothing.
    for (const t of [tour('signup', '2026-12-01'), tour('canceled', '2026-12-01'), tour('ended', '2026-12-01'), tour('tickets', null)])
      expect(clashingGames(games, t, TZ, '2026-11-21')).toEqual([]);
    expect(clashingGames(games, tour('tickets', '2026-12-01'), TZ, '2026-12-02')).toEqual([]);
    // On the day itself it still shows.
    expect(clashingGames(games, tour('tickets', '2026-12-01'), TZ, '2026-12-01').map((x) => x.id)).toEqual(['tue']);
    expect(clashingGames(games, null, TZ, '2026-11-21')).toEqual([]);
  });
});
