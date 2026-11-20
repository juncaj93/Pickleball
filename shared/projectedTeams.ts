// Zip 71 (🎾71.teams), part 2: "Projected teams" at the bottom of the organizer's Levels card (the tournament's Edit page). The likely teams if the
// night were Locked doubles with the players it would have now, worked out on the organizer's phone from what the page already holds (no server
// call, no database trip): the same pairing as Draft teams' first draw (shared/tournamentSchedule.ts draftTeams: strongest with weakest), sorted
// by team total, highest first. Organizer only: players never get a level or this list.
import type { AdminTournamentView } from './tournament';
import { ticketOwed } from './tournamentTickets';
import { type DraftPlayer, type Pair, pairTotal } from './tournamentSchedule';

export interface ProjectedTeam {
  /** Strongest first. */
  players: [DraftPlayer, DraftPlayer];
  /** Hundredths (6.25 = 625). */
  total: number;
}

type Source = Pick<AdminTournamentView, 'signups' | 'finalDate' | 'styleDecided' | 'tickets' | 'format' | 'status' | 'day'>;

/**
 * Who the projection uses: everyone on the list until a date is picked; then who can make the picked date until tickets close (Pay by); then who
 * is locked in (a spot, or a whole-ticket I paid waiting for the organizer: the trust rule the draft uses, server/tournamentDay.ts lockedInIds).
 */
export function projectedPlayers(t: Source): DraftPlayer[] {
  const listed = t.signups.map((s) => ({ id: s.playerId, name: s.name, level: s.level, dates: s.dates }));
  if (t.styleDecided) {
    const locked = new Set(
      (t.tickets ?? [])
        .filter((k) => !k.out && (k.place === 'spot' || (k.place !== 'line' && k.claimCents > 0 && ticketOwed(k) === 0)))
        .map((k) => k.playerId),
    );
    return listed.filter((p) => locked.has(p.id)).map(({ id, name, level }) => ({ id, name, level }));
  }
  const day = t.finalDate;
  return listed.filter((p) => !day || p.dates.includes(day)).map(({ id, name, level }) => ({ id, name, level }));
}

/**
 * The projected teams, or null when the row does not apply: the night would be Americano (Americano picked, or an odd count), fewer than 2
 * players, a canceled tournament, or real teams already drafted (the Teams card shows those). Ties in level go by name, so the list never jumps
 * around between refreshes; Draft teams breaks the same ties at random, so its first draw can differ only between players of equal level.
 */
export function projectedTeams(t: Source): ProjectedTeam[] | null {
  if (t.status === 'canceled' || t.format === 'americano' || (t.day && t.day.phase !== 'none')) return null;
  const players = projectedPlayers(t);
  if (players.length < 2 || players.length % 2 === 1) return null;
  const sorted = [...players].sort((x, y) => y.level - x.level || x.name.localeCompare(y.name));
  const pairs: Pair[] = [];
  for (let i = 0; i < sorted.length / 2; i++) pairs.push([sorted[i], sorted[sorted.length - 1 - i]]);
  return pairs
    .map((p) => ({ players: p, total: pairTotal(p) }))
    .sort((x, y) => y.total - x.total || y.players[0].level - x.players[0].level || x.players[0].name.localeCompare(y.players[0].name));
}
