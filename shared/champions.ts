// Zip 83 (🎾83.champions): the Champions wall (pictures 1 to 3). Pure, so the server, the sheet and the tests share one rule and one set of words.
//
// Which tournaments: every ended tournament with a gold medal that players see next to a name (server/tournamentEnd.ts shownMedal): Everyone
// tournaments only (Only me and test tournaments never), and an Americano night joins only once its reveal has finished on every phone
// (shared/reveal.ts revealHolding). So the wall always agrees with the medals and the wins sheet (Zip 82): each winner on it has a medal for it.
import { formatName, type TournamentFormat } from './tournament';
import { winDate } from './wins';

export interface ChampionsView {
  /** Newest first (by the tournament's date, then when it ended). The first is the reigning champs; the rest are past champions. */
  tournaments: {
    name: string;
    /** 'YYYY-MM-DD' (the night), or null. */
    date: string | null;
    format: TournamentFormat;
    /** The winners in the order End saved them (Locked doubles: the team's two players; Americano: the one winner). */
    winners: string[];
    /** Locked doubles only: the team's name. */
    team?: string;
  }[];
}

/** One medal row as read (tournament_results joined with tournaments and players), in the read's order. */
export interface ChampionRow {
  tournament_id: string;
  name: string;
  final_date: string | null;
  format: string;
  team_name: string | null;
  display_name: string;
}

/** The rows (already only medals players see), grouped by tournament in the read's order. */
export function championsFrom(rows: readonly ChampionRow[]): ChampionsView {
  const by = new Map<string, ChampionsView['tournaments'][number]>();
  for (const r of rows) {
    let t = by.get(r.tournament_id);
    if (!t) {
      const format: TournamentFormat = r.format === 'americano' ? 'americano' : 'doubles';
      t = { name: r.name, date: r.final_date, format, winners: [] };
      by.set(r.tournament_id, t);
    }
    if (!t.winners.includes(r.display_name)) t.winners.push(r.display_name);
    if (t.format === 'doubles' && !t.team && r.team_name) t.team = r.team_name;
  }
  return { tournaments: [...by.values()] };
}

/** The reigning card's gray line in its pieces (the sheet keeps each piece on one line): ["Tue Dec 1, 2026", "Locked doubles"]. */
export const reigningParts = (t: ChampionsView['tournaments'][number]): string[] => [winDate(t.date), formatName(t.format)].filter(Boolean);
/** "Tue Dec 1, 2026 · Locked doubles". */
export const reigningLine = (t: ChampionsView['tournaments'][number]): string => reigningParts(t).join(' · ');

/** A past row's bold line: "Vic" or "Vic + Wren". */
export const winnersLine = (t: ChampionsView['tournaments'][number]): string => t.winners.join(' + ');

/** A past row's gray line in its pieces: ["Summer Slam", "Sat Aug 15, 2026", "Americano"] (the name may wrap; the date and style stay whole). */
export const pastParts = (t: ChampionsView['tournaments'][number]): string[] => [t.name, winDate(t.date), formatName(t.format)].filter(Boolean);
/** "Summer Slam · Sat Aug 15, 2026 · Americano". */
export const pastLine = (t: ChampionsView['tournaments'][number]): string => pastParts(t).join(' · ');

/** The cup shows when anyone on screen has a medal: the medal counts the page already loads (no trip of its own). */
export const hasChampions = (medals: Readonly<Record<string, number>> | null | undefined): boolean => !!medals && Object.values(medals).some((n) => Number(n) > 0);
