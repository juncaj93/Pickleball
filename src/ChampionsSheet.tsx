// Zip 83 (🎾83.champions), picture 2: the Champions wall. Its own small file, fetched on the cup's first tap (src/Champions.tsx).
//   REIGNING CHAMPS: the newest tournament with a winner, on the dark tournament card (the tournament tokens): the ball-yellow small caps kicker,
//     the name, gray "Tue Dec 1, 2026 · Locked doubles", each winner big with the gold medal (src/Medals.tsx), then the team name in gray
//     (Locked doubles only).
//   PAST CHAMPIONS (only with two or more tournaments): one row per older tournament, newest first: the gold medal, the winner bold ("Vic", or
//     "Vic + Wren"), gray "Summer Slam · Sat Aug 15, 2026 · Americano". Rows are not buttons.
// Names never cut (they wrap). No money anywhere.
import { type ChampionsView, pastParts, reigningParts, winnersLine } from '../shared/champions';
import { MedalIcon } from './Medals';
import { Sheet } from './ui';
import './champions-sheet.css';

export default function ChampionsSheet({ open, view, failed, onRetry, onClose }: { open: boolean; view: ChampionsView | null; failed: boolean; onRetry: () => void; onClose: () => void }) {
  return (
    <Sheet calmFocus open={open} title="Champions" onClose={onClose} className="cw-sheet">
      <Wall view={view} failed={failed} onRetry={onRetry} />
    </Sheet>
  );
}

function Wall({ view, failed, onRetry }: { view: ChampionsView | null; failed: boolean; onRetry: () => void }) {
  if (failed && !view)
    return (
      <div className="cw-empty">
        <p>Could not load the champions.</p>
        <button type="button" className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  if (!view) return <div className="cw-skel" aria-hidden="true" data-cw-loading />;
  const [top, ...past] = view.tournaments;
  if (!top) return <p className="cw-empty">No champions yet.</p>;
  return (
    <div className="cw" data-cw={view.tournaments.length}>
      <section className="cw-reign" aria-label="Reigning champs" data-cw-reign={top.name}>
        <p className="cw-kicker">Reigning champs</p>
        <h3 className="cw-name">{top.name}</h3>
        <p className="cw-line">
          <Pieces parts={reigningParts(top)} whole={2} />
        </p>
        <ul className="cw-winners">
          {top.winners.map((w) => (
            <li key={w} className="cw-winner" data-cw-winner={w}>
              <MedalIcon className="cw-medal" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
        {top.format === 'doubles' && top.team && (
          <p className="cw-team" data-cw-team>
            {top.team}
          </p>
        )}
      </section>
      {past.length > 0 && (
        <section className="cw-past" aria-labelledby="cw-past-h">
          <h3 id="cw-past-h" className="cw-past-h">
            Past champions
          </h3>
          <ul className="cw-list">
            {past.map((t, i) => (
              <li key={`${i}-${t.name}`} className="cw-row" data-cw-row={t.name}>
                <MedalIcon className="cw-row-medal" />
                <span className="cw-row-text">
                  <b>{winnersLine(t)}</b>
                  <span>
                    <Pieces parts={pastParts(t)} whole={2} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** "a · b · c": the last `whole` pieces (the date, the style) never break inside; a line breaks only at a dot. A name before them wraps freely. */
function Pieces({ parts, whole }: { parts: string[]; whole: number }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {i >= parts.length - whole ? <span className="cw-whole">{p}</span> : p}
        </span>
      ))}
    </>
  );
}
