// Zip 58 (🎾58.tourney4), picture 46: History > Tournaments (the third chip, only while the Tournaments switch is on): Tournament history (each
// finished tournament: name, date, format, players; 1st and 2nd, or the winning team and its players) and Wins by player. Hidden tournaments
// stay out. Read only.
import { useEffect, useState } from 'react';
import type { TournamentHistoryView } from '../../../shared/tournament';
import { formatName } from '../../../shared/tournament';
import { api } from '../../lib';
import { Medals } from '../../Medals';
import { WinsProvider } from '../../WinsSheet';
import type { AdminCtx } from '../Admin';
import './tournament-history.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Dec 8, 2026" from '2026-12-08'. */
const longDate = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : '');
/** "Dec 8" from '2026-12-08'. */
export const shortDate = (d: string | null) => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : '');

export function TournamentHistory({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<TournamentHistoryView | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    api<TournamentHistoryView>('GET', '/api/admin/tournament-history')
      .then((v) => live && setView(v))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [ctx.d.tournament?.id]);
  if (error) return <p className="muted">Could not load the tournaments. Pull down to try again.</p>;
  if (!view) return <div className="card skel th-skel" aria-hidden="true" />;
  return (
    <WinsProvider path="/api/admin/tournament-wins">
    <div className="stack th" data-th>
      <section className="tm-card th-card" aria-label="Tournament history" data-th-list>
        <div className="tm-card-head tm-head-line">
          <h3 className="tm-label">Tournament history</h3>
          <span className="tm-chip th-chip">{view.tournaments.length} played</span>
        </div>
        {view.tournaments.length === 0 ? (
          <p className="th-empty">No finished tournaments yet.</p>
        ) : (
          <ul className="th-rows">
            {view.tournaments.map((x) => (
              <li key={x.id} className="th-row" data-th-row={x.name}>
                <span className="th-main">
                  <b>{x.name}</b>
                  <span>
                    {[longDate(x.date), formatName(x.format), `${x.players} players`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="th-side">
                  {x.first && <b>1st {x.first.name}</b>}
                  {x.format === 'doubles' && x.first?.players ? <span>{x.first.players.join(' + ')}</span> : x.second ? <span>2nd {x.second.name}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {view.wins.length > 0 && (
        <section className="tm-card th-card" aria-label="Wins by player" data-th-wins>
          <div className="tm-card-head tm-head-line">
            <h3 className="tm-label">Wins by player</h3>
          </div>
          <ol className="th-rows">
            {view.wins.map((w, i) => (
              <li key={w.name} className="th-row th-win" data-th-win={w.name}>
                <span className="th-rank">{i + 1}</span>
                <span className="th-name">
                  {w.name}
                  {/* Zip 82: the medals players see next to the name (none for a win only in an Only me tournament); a tap opens the wins. */}
                  <Medals n={w.medals} name={w.name} />
                </span>
                <b className="th-wins">
                  {w.wins} {w.wins === 1 ? 'win' : 'wins'}
                </b>
                <span className="tm-chip th-chip">{w.played} played</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
    </WinsProvider>
  );
}
