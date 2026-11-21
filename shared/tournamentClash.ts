// Zip 80 (🎾80.leftovers, Alex): a regular game scheduled on the same date as a finalized tournament. The organizer's Home shows one alert card,
// "Tue Dec 1 has a regular game and The Cold Open.", with Cancel game (the usual cancel flow) and the card's X. Nothing for players. Worked out
// on the organizer's phone from the dashboard it already has (the games and the tournament): no new database read, no new switch (it rides
// Tournaments, like every tournament zip since 57).
import { localParts } from './time';
import { dayLong } from './tournament';

/** The Eastern calendar day ("2026-12-01") a game starts on. */
export function gameDayKey(startsAt: string, tz: string): string {
  const p = localParts(Date.parse(startsAt), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The regular games that clash: not canceled, starting on the tournament's date, while the tournament's date is final (tickets open) and its
 * night has not been played yet (`todayKey` is the organizer's today, Eastern).
 */
export function clashingGames<G extends { id: string; startsAt: string; canceled: boolean }>(
  games: readonly G[],
  t: { status: string; finalDate: string | null } | null | undefined,
  tz: string,
  todayKey: string,
): G[] {
  if (!t || t.status !== 'tickets' || !t.finalDate || t.finalDate < todayKey) return [];
  return games.filter((g) => !g.canceled && gameDayKey(g.startsAt, tz) === t.finalDate);
}

/** "Tue Dec 1 has a regular game and The Cold Open." (two games that day: "has 2 regular games"). */
export function clashWords(dayKey: string, tournamentName: string, count = 1): string {
  return `${dayLong(dayKey).replace(',', '')} has ${count === 1 ? 'a regular game' : `${count} regular games`} and ${tournamentName}.`;
}
