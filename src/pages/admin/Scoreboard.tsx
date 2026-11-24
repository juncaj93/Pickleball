// Zip 82 (🎾82.night admin), pictures 3 and 4: All games (Locked doubles) and All rounds (Americano) as scoreboards. One sheet for both styles:
//   a two-way switch "Needs a score · N" | "All" (it opens on Needs a score when N > 0), the games grouped by round under a small caps header,
//   and each game a small card: "Court 1" (a playoff: "Final · Court 1") with a status chip (Done gray, Playing green, Up next gray), on the
//   right "Enter score" (green) when it needs one, "Fix" (gray) when it has one, nothing for Up next; then the two sides, one per line, the score
//   big on the right (the winner's in the site green, the other gray; "–" with none). Americano: "Sitting: ..." under each round.
// Enter score and Fix open the existing score sheets (src/pages/admin/AmericanoDay.tsx and TournamentDay.tsx FixSheet). The sheet stays open and
// where it was underneath; a game scored while it is open stays on Needs a score (now with its score) until the sheet closes.
import { useState } from 'react';
import { Sheet } from '../../ui';
import type { BoardGame } from './scoreboardData';
import './scoreboard.css';

export type { BoardGame };

const CHIP: Record<BoardGame['status'], string> = { done: 'Done', playing: 'Playing', next: 'Up next', off: 'Off' };

export function ScoreboardSheet({
  title,
  open,
  onClose,
  games,
  sits,
  busy,
  onScore,
  data,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  games: BoardGame[];
  /** Americano: who sits each round. */
  sits?: { round: number; names: string[] }[];
  busy: boolean;
  /** Enter score or Fix: open the score sheet for this game. */
  onScore: (key: number) => void;
  data: string;
}) {
  return (
    <Sheet calmFocus open={open} title={title} onClose={onClose} className="tm-gd-sheet sb-sheet">
      {open && <Board games={games} sits={sits} busy={busy} onScore={onScore} data={data} />}
    </Sheet>
  );
}

function Board({ games, sits, busy, onScore, data }: { games: BoardGame[]; sits?: { round: number; names: string[] }[]; busy: boolean; onScore: (key: number) => void; data: string }) {
  const needs = games.filter((g) => g.needs).length;
  // Drawn fresh on each opening (the sheet mounts this only while open): Needs a score when there is one, else All.
  const [mode, setMode] = useState<'needs' | 'all'>(needs > 0 ? 'needs' : 'all');
  // Games scored from this opening stay on Needs a score (with their new score) so the list does not jump under the finger.
  const [kept, setKept] = useState<ReadonlySet<number>>(() => new Set());
  const shown = mode === 'all' ? games : games.filter((g) => g.needs || kept.has(g.key));
  const rounds = [...new Set(shown.map((g) => g.round))].sort((a, b) => a - b);
  const score = (key: number) => {
    setKept((k) => new Set([...k, key]));
    onScore(key);
  };
  return (
    <div className="sb" data-sb={data} data-sb-mode={mode}>
      <div className="segmented sb-switch" role="group" aria-label="Show">
        <button type="button" aria-pressed={mode === 'needs'} onClick={() => setMode('needs')} data-sb-needs={needs}>
          Needs a score · {needs}
        </button>
        <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')} data-sb-all>
          All
        </button>
      </div>
      {rounds.length === 0 && (
        <p className="sb-empty" data-sb-empty>
          Every game has a score.
        </p>
      )}
      {rounds.map((r) => {
        const sit = sits?.find((x) => x.round === r)?.names ?? [];
        return (
          <section key={r} className="sb-round" aria-label={`Round ${r}`} data-sb-round={r}>
            <h4 className="sb-round-label">Round {r}</h4>
            {shown
              .filter((g) => g.round === r)
              .map((g) => (
                <GameCard key={g.key} g={g} busy={busy} onScore={() => score(g.key)} />
              ))}
            {sit.length > 0 && (
              <p className="sb-sits" data-sb-sits={r}>
                Sitting: {sit.join(', ')}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GameCard({ g, busy, onScore }: { g: BoardGame; busy: boolean; onScore: () => void }) {
  const label = `${g.head}, ${CHIP[g.status]}: ${g.sides[0].name}${g.scores[0] !== null ? ` ${g.scores[0]}` : ''}, ${g.sides[1].name}${g.scores[1] !== null ? ` ${g.scores[1]}` : ''}`;
  return (
    <article className={`sb-game sb-${g.status}`} aria-label={label} data-sb-game={g.key} data-status={g.status}>
      <div className="sb-head">
        <span className="sb-where">
          <b>{g.head}</b>
          <span className={`sb-chip sb-chip-${g.status}`}>{CHIP[g.status]}</span>
        </span>
        {g.needs ? (
          <button type="button" className="sb-btn sb-enter" disabled={busy} onClick={onScore} data-sb-enter={g.key}>
            Enter score
          </button>
        ) : g.fixable ? (
          <button type="button" className="sb-btn sb-fix" disabled={busy} onClick={onScore} data-sb-fix={g.key}>
            Fix
          </button>
        ) : null}
      </div>
      {([0, 1] as const).map((i) => (
        <div key={i} className="sb-side" data-sb-side={i}>
          <span className="sb-names">
            <b>{g.sides[i].name}</b>
            {g.sides[i].players && <span>{g.sides[i].players}</span>}
          </span>
          <b className={g.winner === i ? 'sb-score sb-win' : 'sb-score'} data-sb-score={g.scores[i] ?? ''}>
            {g.scores[i] !== null ? g.scores[i] : g.winner === i ? 'Won' : '–'}
          </b>
        </div>
      ))}
      {g.note && <p className="sb-note">{g.note}</p>}
    </article>
  );
}
