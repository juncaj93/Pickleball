// Zip 79 (🎾79.results skills), part 1: the results card (pictures results/1 to 4). After a tournament ends (Americano: once this phone's reveal
// is over; Locked doubles: after End tournament) the tournament card is ONE ROW: the name on the left (it wraps; never cut), a lime Standings
// button on the right (44 px; it never moves or shrinks). A tap opens the final board inside the card, in its final state with no animation
// (Zip 77's board look), and the X closes it. The server decides how long it shows (shared/results.ts) and what is on it (names, records,
// Americano points; never money or levels). Part of the tournament card's own download.
import { useEffect, useRef, useState } from 'react';
import type { PlayerTournamentView, ResultBoardRow } from '../../shared/tournament';
import { MedalIcon } from '../Medals';
import { openLayer } from '../backStack';
import './reveal.css';
import './results.css';

/** The final board's rows (picture 4): the place or the gold medal, the name (YOU), Locked doubles' players under it, the record, the points. */
function StaticRow({ r, p }: { r: ResultBoardRow; p: number }) {
  const tone = p === 1 ? ' tc-rv-gold' : p === 2 ? ' tc-rv-silver' : p === 3 ? ' tc-rv-third' : '';
  return (
    <li className={`tc-rv-row tc-res-row${tone}`} data-tc-result-row={r.name} data-p={p}>
      <span className="tc-rv-rk">
        {r.medal ? (
          <span className="tc-rv-md" aria-label="1st, gold medal" role="img">
            <MedalIcon className="tc-rv-medal" />
          </span>
        ) : (
          <span className="tc-rv-rkv">{r.out ? '–' : r.rank}</span>
        )}
      </span>
      <span className="tc-rv-in">
        <span className="tc-rv-name">
          {r.name}
          {r.me && <span className="tc-rv-you">YOU</span>}
          {r.players && r.players.length > 0 && <span className="tc-res-players">{r.players.join(' + ')}</span>}
        </span>
        <span className="tc-rv-rec">{r.record}</span>
        {r.points !== undefined && <span className="tc-rv-pts">{r.points} pts</span>}
      </span>
    </li>
  );
}

/** The one row, and the board it opens (open and closed in place, no animation). */
export function ResultsRow({ t }: { t: PlayerTournamentView }) {
  const [open, setOpen] = useState(false);
  const standingsRef = useRef<HTMLButtonElement>(null);
  const xRef = useRef<HTMLButtonElement>(null);
  // Zip 85 (🎾84 dry run): the open board is a layer like every sheet: Back (an iPhone edge swipe, Android's back) closes it, never the site.
  useEffect(() => (open ? openLayer(() => setOpen(false)) : undefined), [open]);
  const rows = t.results?.rows ?? [];
  if (!rows.length) return null;
  if (!open) {
    return (
      <section className="tc-gd-hero tc-res" aria-label={t.name} data-tc-results="row">
        <div className="tc-res-top">
          <h2 className="tc-gd-hero-name tc-res-name">{t.name}</h2>
          <button
            ref={standingsRef}
            type="button"
            className="tc-res-btn"
            aria-expanded="false"
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => xRef.current?.focus({ preventScroll: true }));
            }}
            data-tc-results-open
          >
            Standings
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="tc-gd-hero tc-rv-hero tc-res tc-res-open" aria-label={`${t.name}, final standings`} data-tc-results="board">
      <div className="tc-gd-hero-top tc-rv-top">
        <h2 className="tc-gd-hero-name">{t.name}</h2>
        <button
          ref={xRef}
          type="button"
          className="tc-rv-x"
          aria-label="Close the standings"
          aria-expanded="true"
          onClick={() => {
            setOpen(false);
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-tc-results-open]')?.focus({ preventScroll: true }));
          }}
          data-tc-results-x
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <span className="tc-gd-bar tc-rv-divider" aria-hidden="true" />
      <div className="tc-rv-board tc-res-board" data-tc-board>
        <h2 className="tc-rv-title">Final standings</h2>
        <ol className="tc-rv-list" aria-label="Final standings">
          {rows.map((r, i) => (
            <StaticRow key={`${r.rank}-${r.name}`} r={r} p={i + 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}
