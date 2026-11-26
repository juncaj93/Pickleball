// Zip 79 (🎾79.results skills), part 2: History > Skills (organizer only; pictures skills/04 and 05). Every player's FINALIZED level per ended
// tournament (tournament_results: the organizer's level when he changed it, else the player's own pick), and what the screens work out from it:
// Most improved (top 3, last 12 months, latest minus first, 2 or more tournaments, positive only), the Levels table (the last 3 tournament dates,
// each cell green when higher than that player's level before it, orange when lower, gray when the same; Current; Change over 12 months) and one
// player's trend (the sheet). Levels are hundredths as stored (275 = 2.7); every change is worked out on the numbers players see (3.4 - 2.7 =
// +0.7), so a 2.7 never makes a "+0.65". Pure functions, so the screen and the tests share them. Players never see any of it.
import { LEVELS, levelShort } from './tournament';

/** GET /api/admin/skills. */
export interface SkillsView {
  /** Today, Eastern, 'YYYY-MM-DD' (the 12 months count back from here). */
  today: string;
  /** Every ended tournament (not hidden), oldest first. */
  tournaments: { id: string; name: string; date: string }[];
  /** Every active player with at least one finalized level, each level oldest first. */
  players: { id: string; name: string; levels: { tournamentId: string; date: string; level: number }[] }[];
}

export type SkillsSort = 'level' | 'improved' | 'name';

/** 275 -> 2.7, 360 -> 3.6 (the number on the list; 3.6+ counts as 3.6). */
export const levelNum = (v: number): number => Number(levelShort(v));
/** A change in tenths, rounded (no 0.30000000000000004). */
const tenths = (x: number): number => Math.round(x * 10) / 10;
/** "+0.7", "−0.3", "same". */
export function changeText(d: number): string {
  if (d === 0) return 'same';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}
export type Tone = 'up' | 'down' | 'same';
export const toneOf = (d: number): Tone => (d > 0 ? 'up' : d < 0 ? 'down' : 'same');

/** The day a year before `today` ('YYYY-MM-DD'). */
export function yearBefore(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const x = new Date(Date.UTC(y - 1, m - 1, d));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
/** "12/03/26" and "12/03". */
export const dateLong = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(2, 4)}`;
export const dateShort = (d: string): string => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** "AUG" for '2026-08-03'. */
export const monthCaps = (d: string): string => MONTHS[Number(d.slice(5, 7)) - 1] ?? d;
/**
 * Zip 93 (Alex): the Skills dates show the month only, in caps ("AUG"). When two of `dates` (one player's entries, or the table's columns)
 * share a month, those show the day too ("AUG 3", "AUG 24"); the others stay "AUG". Returns the label for one of those dates.
 */
export function skillsDates(dates: readonly string[]): (d: string) => string {
  // The same month of the same year (Aug 2025 and Aug 2026 are two months, each "AUG" alone).
  const count = new Map<string, number>();
  for (const d of new Set(dates)) count.set(d.slice(0, 7), (count.get(d.slice(0, 7)) ?? 0) + 1);
  return (d: string) => ((count.get(d.slice(0, 7)) ?? 0) > 1 ? `${monthCaps(d)} ${Number(d.slice(8, 10))}` : monthCaps(d));
}

type Player = SkillsView['players'][number];
const recent = (p: Player, today: string) => p.levels.filter((l) => l.date >= yearBefore(today) && l.date <= today);

/** Latest minus first over the last 12 months (0 with fewer than 2 there). */
export function change12(p: Player, today: string): number {
  const r = recent(p, today);
  if (r.length < 2) return 0;
  return tenths(levelNum(r[r.length - 1].level) - levelNum(r[0].level));
}

export interface ImprovedRow {
  id: string;
  name: string;
  from: number;
  to: number;
  change: number;
}

/** Most improved: top 3 over the last 12 months, 2 or more tournaments there, positive only (empty: the card hides). */
export function mostImproved(v: SkillsView): ImprovedRow[] {
  return v.players
    .map((p) => {
      const r = recent(p, v.today);
      if (r.length < 2) return null;
      const change = change12(p, v.today);
      return change > 0 ? { id: p.id, name: p.name, from: r[0].level, to: r[r.length - 1].level, change } : null;
    })
    .filter((x): x is ImprovedRow => x !== null)
    .sort((a, b) => b.change - a.change || levelNum(b.to) - levelNum(a.to) || a.name.localeCompare(b.name))
    .slice(0, 3);
}

export interface LevelCell {
  /** Null: did not play that one (a dash). */
  level: number | null;
  tone: Tone;
}
export interface LevelRow {
  id: string;
  name: string;
  cells: LevelCell[];
  current: number;
  change: number;
}

/** The Levels table: the last 3 tournaments (oldest first) and one row per player who played in the last 12 months, sorted. */
export function levelsTable(v: SkillsView, sort: SkillsSort): { columns: { id: string; date: string }[]; rows: LevelRow[] } {
  const columns = v.tournaments.slice(-3).map((t) => ({ id: t.id, date: t.date }));
  const rows = v.players
    .filter((p) => recent(p, v.today).length > 0)
    .map((p): LevelRow => {
      const cells = columns.map((c): LevelCell => {
        const i = p.levels.findIndex((l) => l.tournamentId === c.id);
        if (i < 0) return { level: null, tone: 'same' };
        const level = p.levels[i].level;
        const before = i > 0 ? p.levels[i - 1].level : null;
        return { level, tone: before === null ? 'same' : toneOf(tenths(levelNum(level) - levelNum(before))) };
      });
      return { id: p.id, name: p.name, cells, current: p.levels[p.levels.length - 1].level, change: change12(p, v.today) };
    });
  const byName = (a: LevelRow, b: LevelRow) => a.name.localeCompare(b.name);
  rows.sort(
    sort === 'name'
      ? byName
      : sort === 'improved'
        ? (a, b) => b.change - a.change || levelNum(b.current) - levelNum(a.current) || byName(a, b)
        : (a, b) => levelNum(b.current) - levelNum(a.current) || b.change - a.change || byName(a, b),
  );
  return { columns, rows };
}

/** Whole months between two dates ('YYYY-MM-DD'), at least 1. */
export function monthsBetween(from: string, to: string): number {
  const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  return Math.max(1, Math.round(days / 30.44));
}

export interface Trend {
  current: number;
  /** "+0.7 past 3mo" (null: one tournament in the last 12 months, nothing to compare). */
  pill: { text: string; tone: Tone } | null;
  /** The chart: the last 12 months' points, oldest first. */
  points: { date: string; level: number }[];
  /** Every tournament, newest first, with the change from the one before (none on the first). */
  list: { date: string; level: number; change: number | null }[];
}

/** One player's sheet (picture 05). */
export function trendOf(p: Player, today: string): Trend {
  const r = recent(p, today);
  const points = (r.length ? r : p.levels.slice(-1)).map((l) => ({ date: l.date, level: l.level }));
  const d = change12(p, today);
  const pill = r.length >= 2 ? { text: `${changeText(d)} past ${monthsBetween(r[0].date, r[r.length - 1].date)}mo`, tone: toneOf(d) } : null;
  const list = p.levels
    .map((l, i) => ({ date: l.date, level: l.level, change: i === 0 ? null : tenths(levelNum(l.level) - levelNum(p.levels[i - 1].level)) }))
    .reverse();
  return { current: p.levels[p.levels.length - 1].level, pill, points, list };
}

/** The chart's y axis, bottom to top: the seven levels, evenly spaced ("3.6+" on top). */
export const CHART_LEVELS = LEVELS.map((l) => ({ value: l.value, label: l.label }));
/** A level's step on the y axis (0 = 2.5); a value between steps sits between them. */
export function levelStep(v: number): number {
  const i = LEVELS.findIndex((l) => l.value === v);
  if (i >= 0) return i;
  const n = levelNum(v);
  for (let k = 0; k < LEVELS.length - 1; k++) {
    const a = levelNum(LEVELS[k].value);
    const b = levelNum(LEVELS[k + 1].value);
    if (n >= a && n <= b) return k + (n - a) / (b - a);
  }
  return n < levelNum(LEVELS[0].value) ? 0 : LEVELS.length - 1;
}
