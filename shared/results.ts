// Zip 79 (🎾79.results skills), part 1: the results card. After a tournament ends (Americano: once the reveal is over; Locked doubles: after End
// tournament) the tournament card becomes ONE ROW, the name and a lime Standings button, and a tap opens the final board in its final state.
// It shows on the night (where the card always is, with Your rounds / Your games under it) and the WHOLE next day (until midnight Eastern), to
// everyone who can see the tournament; then it is gone. The board's rows come from tournament_results (End's saved order). Pure functions here,
// so the server and the tests share them.
import type { ResultBoardRow, TournamentFormat } from './tournament';

/** The calendar date `n` days after `date` ('YYYY-MM-DD'). */
export function dayPlus(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/** The row still shows: today (Eastern, 'YYYY-MM-DD') is the tournament's date or the day after. From midnight of the second day: gone. */
export const resultsShowing = (finalDate: string | null, today: string): boolean => !!finalDate && today <= dayPlus(finalDate, 1);

/** One saved result (tournament_results with the player's name). */
export interface ResultSource {
  player_id: string;
  finish: number | null;
  wins: number;
  losses: number;
  points: number | null;
  display_name: string;
  team_name?: string | null;
  partner_id?: string | null;
}

const byFinish = <T extends { finish: number | null }>(a: T, b: T) => (a.finish ?? Infinity) - (b.finish ?? Infinity);

/**
 * The final board: Americano one row per player, Locked doubles one row per team (its two players under the name), in the order End saved
 * (1st first; anyone without a place after). The gold medal only on 1st (Americano's winner, the Final's winners). `me`: this player's row.
 */
export function boardRows(format: TournamentFormat, results: readonly ResultSource[], playerId: string | null): ResultBoardRow[] {
  if (format !== 'doubles') {
    return [...results].sort(byFinish).map((r, i) => ({
      rank: r.finish ?? i + 1,
      name: r.display_name,
      record: `${r.wins}-${r.losses}`,
      points: r.points ?? 0,
      ...(r.player_id === playerId ? { me: true as const } : {}),
      ...(r.finish === 1 ? { medal: true as const } : {}),
      ...(r.finish === null ? { out: true as const } : {}),
    }));
  }
  // Locked doubles: partners share a team (its name, or the pair when a name is missing); the team's place is its best saved place.
  const teams = new Map<string, ResultSource[]>();
  for (const r of results) {
    const key = r.team_name ? `n:${r.team_name}` : `p:${[r.player_id, r.partner_id ?? ''].sort().join('|')}`;
    const list = teams.get(key) ?? [];
    list.push(r);
    teams.set(key, list);
  }
  const rows = [...teams.values()].map((list) => {
    const placed = list.filter((r) => r.finish !== null);
    const finish = placed.length ? Math.min(...placed.map((r) => r.finish!)) : null;
    const first = list[0];
    return { finish, list, first };
  });
  rows.sort(byFinish);
  return rows.map(({ finish, list, first }, i) => ({
    rank: finish ?? i + 1,
    name: first.team_name || list.map((r) => r.display_name).join(' + '),
    players: list.map((r) => r.display_name),
    record: `${first.wins}-${first.losses}`,
    ...(list.some((r) => r.player_id === playerId) ? { me: true as const } : {}),
    ...(finish === 1 ? { medal: true as const } : {}),
    ...(finish === null ? { out: true as const } : {}),
  }));
}
