// Zip 88 (🎾88.rolling courts), pictures 1 to 3: the organizer's ONE night card, worked out from the day views the dashboard already sends (no
// browser code here, so the unit tests load it). Both styles give the same model: the round bars, one box per court, the "1 of 2 in" pill and
// who sits now.
//   Bars: done green; the lowest round still being played outlined green; a later round already started early purple (rolling courts).
//   Locked doubles: its pool rounds, then a wider FINAL bar (groups nights: SEMIS then FINAL).
//   Boxes: the game on each court now (Playing), or, while a court waits, the last game it finished (Done). The round pill (RD3 green, RD4
//   purple when it started early; Final / 3rd place / Semifinal / Game A in the green style) and the target (Play to 11 quiet, anything else
//   a yellow pill).
import type { AdminDayGame, AdminDayView, AdminRoundsView, CourtNow } from '../../../shared/tournament';
import { startMsOf } from '../../../shared/tournamentTickets';

export type BarState = 'done' | 'now' | 'early' | 'later';

export interface NightBar {
  key: string;
  /** "RD1", "SEMIS", "FINAL". */
  label: string;
  state: BarState;
  /** The schedule rounds it holds (a tap opens the first one in All rounds). */
  rounds: number[];
  /** The FINAL bar on a Locked doubles night without groups is wider. */
  wide?: true;
}

export interface NightBox {
  num: number;
  court: number;
  /** "Court 1", or the venue's "Court 9". */
  where: string;
  playTo: number;
  pill: { text: string; tone: 'green' | 'purple' };
  status: 'playing' | 'done';
  a: string;
  b: string;
  scoreA: number | null;
  scoreB: number | null;
  winner: 'a' | 'b' | null;
}

export interface NightModel {
  kind: 'americano' | 'doubles';
  /** "Americano · 10 players". */
  style: string;
  bars: NightBar[];
  boxes: NightBox[];
  /** Scores in among the games shown on the courts now ("1 of 2 in"). */
  inCount: number;
  sitting: string[];
  /** Every game of the night is in (the boxes give way to Reveal standings / End tournament). */
  allIn: boolean;
}

/** The night is on (or about to be): from 30 minutes before the real start (the organizer's night screens, the week row hides). */
export function nightOnAt(t: { finalDate: string | null; startSet?: boolean; start: number }, nowIso: string, tz: string): boolean {
  if (!t.finalDate || !t.startSet) return false;
  return Date.parse(nowIso) >= startMsOf(t.finalDate, t.start, tz) - 30 * 60_000;
}

/** The bars' states from each bar's games: [done, any started]. The first bar not done is "now"; a later one with a started game is "early". */
function barStates(groups: { done: boolean; started: boolean }[]): BarState[] {
  const now = groups.findIndex((g) => !g.done);
  return groups.map((g, i) => (g.done ? 'done' : i === now ? 'now' : g.started ? 'early' : 'later'));
}

/** Pictures 1 to 3: a two-word name as "Christopher V." on the card (first name and the last name's initial), so a box never breaks a word. */
export const cardName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name.trim() : `${parts[0]}\u00a0${parts[parts.length - 1][0]}.`;
};
const pairOf = (names: readonly string[]) => names.map(cardName).join(' + ');

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;
const whereOf = (court: number, numbers: number[] | null) => `Court ${numbers?.[court - 1] ?? court}`;
/** The box for each court: the game on it now, else the last game it finished. */
const shownOn = (courts: CourtNow[] | undefined) => (courts ?? []).map((c) => ({ court: c.court, num: c.num ?? c.last, playing: c.num !== null })).filter((c): c is { court: number; num: number; playing: boolean } => c.num !== null);

export function americanoNightModel(r: AdminRoundsView): NightModel {
  const rounds = [...new Set(r.games.map((g) => g.round))].sort((a, b) => a - b);
  const isIn = (s: string) => s === 'done' || s === 'skipped';
  const states = barStates(rounds.map((n) => {
    const list = r.games.filter((g) => g.round === n);
    return { done: list.every((g) => isIn(g.status)), started: list.some((g) => g.status === 'playing' || g.status === 'done') };
  }));
  const bars: NightBar[] = rounds.map((n, i) => ({ key: `r${n}`, label: `RD${n}`, state: states[i], rounds: [n] }));
  const nowRound = rounds[states.indexOf('now')] ?? Infinity;
  const boxes: NightBox[] = shownOn(r.courtsNow).map(({ court, num }) => {
    const g = r.games.find((x) => x.num === num)!;
    const scored = g.scoreA !== null && g.scoreB !== null;
    return {
      num,
      court,
      where: whereOf(court, r.courtNumbers),
      playTo: g.playTo,
      pill: { text: `RD${g.round}`, tone: g.round > nowRound ? 'purple' : 'green' },
      // A score cleared on a waiting court's last game: it needs one (Score), it is not in.
      status: !isIn(g.status) ? 'playing' : 'done',
      a: pairOf(g.a.names),
      b: pairOf(g.b.names),
      scoreA: g.scoreA,
      scoreB: g.scoreB,
      winner: scored ? (g.scoreA! > g.scoreB! ? 'a' : 'b') : null,
    };
  });
  return {
    kind: 'americano',
    style: `Americano · ${players(r.players.filter((p) => !p.left).length)}`,
    bars,
    boxes,
    inCount: boxes.filter((b) => b.status === 'done').length,
    sitting: (r.sittingNow ?? []).map(cardName),
    allIn: r.games.length > 0 && r.games.every((g) => isIn(g.status)),
  };
}

const PLAYOFF_PILL: Record<string, string> = { semi: 'Semifinal', final: 'Final', third: '3rd place' };

export function doublesNightModel(d: AdminDayView): NightModel {
  const done = (g: AdminDayGame) => !!g.winner || g.skipped;
  const pool = d.games.filter((g) => g.stage === 'pool');
  const rounds = [...new Set(pool.map((g) => g.round))].sort((a, b) => a - b);
  const semis = d.games.filter((g) => g.stage === 'semi');
  const finals = d.games.filter((g) => g.stage === 'final' || g.stage === 'third');
  const ties = d.games.filter((g) => g.stage === 'tie');
  // A tie's Game A / B belongs to the first playoff bar (it decides who plays there).
  const groups: { key: string; label: string; games: AdminDayGame[]; wide?: true }[] = [
    ...rounds.map((n) => ({ key: `r${n}`, label: `RD${n}`, games: pool.filter((g) => g.round === n) })),
    ...(semis.length ? [{ key: 'semi', label: 'SEMIS', games: [...ties, ...semis] }] : []),
    ...(finals.length ? [{ key: 'final', label: 'FINAL', games: semis.length ? finals : [...ties, ...finals], ...(semis.length ? {} : { wide: true as const }) }] : []),
  ];
  const states = barStates(groups.map((x) => ({ done: x.games.every(done), started: x.games.some((g) => !!g.started || !!g.winner) })));
  const bars: NightBar[] = groups.map((x, i) => ({ key: x.key, label: x.label, state: states[i], rounds: [...new Set(x.games.map((g) => g.round))].sort((a, b) => a - b), ...(x.wide ? { wide: true as const } : {}) }));
  const nowIndex = states.indexOf('now');
  const boxes: NightBox[] = shownOn(d.courtsNow).map(({ court, num }) => {
    const g = d.games.find((x) => x.num === num)!;
    const barIndex = groups.findIndex((x) => x.games.includes(g));
    const text = g.tieLabel ?? (g.stage === 'pool' ? `RD${g.round}` : (PLAYOFF_PILL[g.stage] ?? 'Playoff'));
    return {
      num,
      court,
      where: whereOf(court, d.courtNumbers),
      playTo: g.playTo,
      pill: { text, tone: g.stage === 'pool' && nowIndex >= 0 && barIndex > nowIndex ? 'purple' : 'green' },
      status: !done(g) ? 'playing' : 'done',
      a: (g.a?.players.length ? pairOf(g.a.players) : g.a?.name) || g.waitA || 'Not decided',
      b: (g.b?.players.length ? pairOf(g.b.players) : g.b?.name) || g.waitB || 'Not decided',
      scoreA: g.skipped ? null : g.scoreA,
      scoreB: g.skipped ? null : g.scoreB,
      winner: g.skipped ? null : g.winner,
    };
  });
  const teams = d.teams.filter((x) => !x.out).length;
  return {
    kind: 'doubles',
    style: `Locked doubles · ${players(teams * 2)}`,
    bars,
    boxes,
    inCount: boxes.filter((b) => b.status === 'done').length,
    sitting: (d.sittingNow ?? []).map(cardName),
    allIn: d.games.length > 0 && d.games.every(done),
  };
}
