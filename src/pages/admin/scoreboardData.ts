// Zip 82 (🎾82.night admin): the scoreboards' data, worked out from the organizer's day views (no browser code here, so the unit tests load it):
// a Locked doubles game or an Americano game as a scoreboard card (src/pages/admin/Scoreboard.tsx), and the Standings sheet's first words.
import type { AdminDayGame, AdminDayView, AdminRoundGame } from '../../../shared/tournament';

export interface BoardSide {
  /** Locked doubles: the team's name; Americano: "Wren + Rowan". */
  name: string;
  /** Locked doubles: "Vic + Wren", small under the name. */
  players?: string;
}

export interface BoardGame {
  key: number;
  round: number;
  /** "Court 1", or a playoff's "Final · Court 1". */
  head: string;
  status: 'done' | 'playing' | 'next' | 'off';
  sides: [BoardSide, BoardSide];
  scores: [number | null, number | null];
  /** The side that won (0 or 1), null with no result. */
  winner: 0 | 1 | null;
  /** Playing or due without a result: counts in "Needs a score" and has Enter score. */
  needs: boolean;
  /** Has a result (or is off): Fix. */
  fixable: boolean;
  /** An off game's words ("Vic left"). */
  note?: string;
}

const sideName = (g: AdminDayGame, s: 'a' | 'b') => (s === 'a' ? (g.a?.name ?? g.waitA ?? 'Not decided') : (g.b?.name ?? g.waitB ?? 'Not decided'));
const sidePlayers = (g: AdminDayGame, s: 'a' | 'b') => (s === 'a' ? g.a?.players : g.b?.players)?.join(' + ') ?? '';
const where = (g: AdminDayGame) => (g.courtNumber ? `Court ${g.courtNumber}` : `Court ${g.court}`);
const stageName = (g: AdminDayGame) => (g.tieLabel ? g.tieLabel : g.stage === 'semi' ? 'Semifinal' : g.stage === 'final' ? (g.finalGame ? `Final · Game ${g.finalGame}` : 'Final') : g.stage === 'third' ? '3rd place' : `Game ${g.num}`);

/**
 * Zip 82: one Locked doubles game as a scoreboard card. Playing: both teams known, no result, its round has come (any earlier round still
 * without a result is due too); Up next: later rounds or a side still to be decided. A playoff names itself ("Final · Court 1").
 */
export function boardGame(g: AdminDayGame, d: Pick<AdminDayView, 'round' | 'started' | 'over'>, openRound: number | null = null): BoardGame {
  const stage = g.tieLabel || g.stage !== 'pool' ? `${stageName(g)} · ${where(g)}` : where(g);
  const sides: BoardGame['sides'] = [
    { name: sideName(g, 'a'), ...(sidePlayers(g, 'a') ? { players: sidePlayers(g, 'a') } : {}) },
    { name: sideName(g, 'b'), ...(sidePlayers(g, 'b') ? { players: sidePlayers(g, 'b') } : {}) },
  ];
  const base = { key: g.num, round: g.round, head: stage, sides };
  if (g.skipped) return { ...base, status: 'off', scores: [null, null], winner: null, needs: false, fixable: true, note: 'Skipped' };
  if (g.winner) {
    const scored = g.scoreA !== null && g.scoreB !== null;
    return { ...base, status: 'done', scores: scored ? [g.scoreA, g.scoreB] : [null, null], winner: g.winner === 'a' ? 0 : 1, needs: false, fixable: true };
  }
  // Review: during a pause (or once the night's time is up) the server sends no round: then the first round with a game still open counts.
  // Zip 88 (rolling courts): playing once it is on a court (the server says so); an older answer without it: by its round, as before.
  const due = !!g.a && !!g.b && d.started && (d.over || (g.started !== undefined ? g.started : g.round <= (d.round ?? openRound ?? 0)));
  return { ...base, status: due ? 'playing' : 'next', scores: [null, null], winner: null, needs: due, fixable: false };
}

/** One Americano game as a scoreboard card. */
export function roundGame(g: AdminRoundGame): BoardGame {
  const scored = g.scoreA !== null && g.scoreB !== null;
  return {
    key: g.num,
    round: g.round,
    head: `Court ${g.courtNumber ?? g.court}`,
    status: g.status === 'later' ? 'next' : g.status === 'skipped' ? 'off' : g.status,
    sides: [{ name: g.a.names.join(' + ') }, { name: g.b.names.join(' + ') }],
    scores: [g.status === 'skipped' ? null : g.scoreA, g.status === 'skipped' ? null : g.scoreB],
    winner: scored && g.status !== 'skipped' ? (g.scoreA! > g.scoreB! ? 0 : 1) : null,
    needs: g.status === 'playing',
    fixable: g.status === 'done',
    ...(g.status === 'skipped' ? { note: `${g.by ?? 'A player'} left` } : g.late ? { note: g.late } : {}),
  };
}

/**
 * Zip 82 (picture 2): "After Round 3. Only you see this until the reveal." Rounds count once every game in them is in; a round partly in says
 * how many of its games are.
 */
export function afterRoundWords(games: readonly AdminRoundGame[]): string {
  const isIn = (g: AdminRoundGame) => g.status === 'done' || g.status === 'skipped';
  const rounds = Math.max(0, ...games.map((g) => g.round));
  let full = 0;
  while (full < rounds && games.filter((g) => g.round === full + 1).every(isIn)) full++;
  const next = games.filter((g) => g.round === full + 1);
  const part = next.filter((g) => g.status === 'done').length;
  const games_ = (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`;
  if (full === 0) return part ? `Round 1: ${games_(part)} of ${next.length} in.` : 'No scores yet.';
  if (full === rounds) return `After Round ${full}, every game in.`;
  return part ? `After Round ${full}, plus ${games_(part)} of Round ${full + 1}.` : `After Round ${full}.`;
}


/** The first round with a game that still has no result (both teams known), or null. */
export function firstOpenRound(games: readonly AdminDayGame[]): number | null {
  const open = games.filter((g) => !g.winner && !g.skipped && g.a && g.b).map((g) => g.round);
  return open.length ? Math.min(...open) : null;
}
