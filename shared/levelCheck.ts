// Zip 95 (🎾95.level check): after a tournament ends, the organizer's Home suggests who played above their level (pictures 1 and 2), and the
// level he saves shows at that player's next sign-up as "RECOMMENDED" (pictures 3 and 4). The rules live here, one place for the server and
// the screens:
//   - Who qualifies: won 80% or more of their REGULAR games (Locked doubles: the round robin / pool games, an extra round too; Americano: every
//     round), with at least 3 such games, OR the champion (the gold medal). Semifinals, the Final, 3rd place and tie games (Game A, Game B)
//     never count. Never someone already at the top level (3.6+), and never the organizer's own player.
//   - The level is the one the organizer approved for that tournament (approved_level), else the player's pick (picked_level), as End saved it.
//   - The card shows for 3 days after the tournament ends (ended_at), or until every row is answered.
// Stored with no migration: one task_log row per answer (kind 'mark', no game), task 'level_check:<tournament>:<player>', detail the level in
// hundredths ('320') or 'no'. The same way a hidden tournament or the Plan's saved number is kept (server/tournament.ts).
import { LEVELS, levelLabel } from './tournament';

/** task_log's task for one answer: 'level_check:<tournament id>:<player id>'. */
export const LEVEL_CHECK_TASK = 'level_check:';
export const levelCheckTask = (tournamentId: string, playerId: string): string => `${LEVEL_CHECK_TASK}${tournamentId}:${playerId}`;
/** The answer "No" (the player never sees it). */
export const LEVEL_CHECK_NO = 'no';
/** How long the card stays after the tournament ends. */
export const LEVEL_CHECK_DAYS = 3;
/** The top level: nobody there is ever suggested higher. */
export const TOP_LEVEL = LEVELS[LEVELS.length - 1].value;
/** The fewest regular games a win rate counts from (a 1-0 night of someone who left early is not a pattern). */
export const MIN_GAMES = 3;

export interface LevelCheckFacts {
  /** Regular games with a result (the round robin / pools, an extra round, Americano rounds). */
  played: number;
  won: number;
  /** The gold medal of this tournament. */
  champion: boolean;
  /** approved_level, else picked_level (hundredths). */
  level: number | null;
}

/** 80% or more of at least MIN_GAMES regular games, or the champion; below the top level only. */
export function qualifies(f: LevelCheckFacts): boolean {
  if (f.level === null || !Number.isFinite(f.level) || f.level >= TOP_LEVEL) return false;
  if (levelsAbove(f.level).length === 0) return false;
  if (f.champion) return true;
  return f.played >= MIN_GAMES && f.won * 5 >= f.played * 4;
}

/** The gray line under the name: "3.0 · won all 5 games", "3.2 · won 4 of 5, champion", "3.2 · champion" (no regular game with a result). */
export function levelCheckLine(f: LevelCheckFacts): string {
  const games = f.played === 0 ? '' : f.won === f.played ? `won all ${f.played} games` : `won ${f.won} of ${f.played}`;
  const what = [games, f.champion ? 'champion' : ''].filter(Boolean).join(', ');
  return [f.level === null ? '' : levelLabel(f.level), what].filter(Boolean).join(' · ');
}

/** Every level above this one, lowest first (Yes: the level buttons; the first one starts picked). */
export const levelsAbove = (level: number): number[] => LEVELS.map((l) => l.value).filter((v) => v > level);

/** A saved answer's level, or null ('no', or anything that is not a level). */
export function savedLevel(detail: string | null | undefined): number | null {
  if (!detail || detail === LEVEL_CHECK_NO) return null;
  const n = Number(detail);
  return LEVELS.some((l) => l.value === n) ? n : null;
}

/** One row of the organizer's card. */
export interface LevelCheckRow {
  playerId: string;
  name: string;
  level: number;
  line: string;
}

/** The organizer's Level check card (admin dashboard `levelCheck`): only rows still to answer; missing when there is none. */
export interface AdminLevelCheck {
  tournamentId: string;
  name: string;
  /** The card is gone after this moment (ended_at plus LEVEL_CHECK_DAYS), also on a page left open. */
  until: string;
  rows: LevelCheckRow[];
}
