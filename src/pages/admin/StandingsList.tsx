// Zip 82 (🎾82.night admin), pictures 1 and 2: the organizer's compact standings. One list for the End card ("Only you see this until the
// reveal.") and the Standings sheet during an Americano night. The rows come from the server's shared functions (the reveal board's rows for
// Americano, End's saved order for Locked doubles), so the order and ties are the board's; this only draws them: the place (the site's gold
// medal on 1st only), the name (wraps, never cut; a team's two players small under it), W-L, and a small gray "55 pts" chip.
import type { EndStanding } from '../../../shared/tournament';
import { MedalIcon } from '../../Medals';
import './standings-list.css';

export function StandingsList({ rows, note, data }: { rows: EndStanding[]; note: string; data: string }) {
  if (!rows.length) return null;
  return (
    <div className="sl" data-sl={data}>
      <p className="sl-note" data-sl-note>
        {note}
      </p>
      <ol className="sl-list" aria-label="Standings">
        {rows.map((r, i) => (
          <li key={`${i}-${r.name}`} className="sl-row" data-sl-row={r.name} data-sl-place={i + 1}>
            <span className="sl-rank">
              {r.medal ? (
                <span className="sl-medal" role="img" aria-label="1st, gold medal">
                  <MedalIcon className="sl-medal-ico" />
                </span>
              ) : (
                <span aria-label={r.out ? 'Left the night' : `${i + 1}${placeSuffix(i + 1)}`}>{r.out ? '–' : i + 1}</span>
              )}
            </span>
            <span className="sl-name">
              <b>{r.name}</b>
              {r.players && r.players.length > 0 && <span className="sl-players">{r.players.join(' + ')}</span>}
            </span>
            <b className="sl-rec" aria-label={`${r.record.split('-')[0]} wins, ${r.record.split('-')[1]} losses`}>
              {r.record}
            </b>
            <span className="sl-chip">{r.chip}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const placeSuffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th');
