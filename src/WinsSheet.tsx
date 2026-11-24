// Zip 82 (🎾82.night admin), pictures 5 and 6: tap a medal. The gold medals next to a name (src/Medals.tsx) become a button inside a
// WinsProvider; a tap opens "Your wins" (your own) or "Vic’s wins": one row per win, newest first, the site's gold medal, the tournament name
// bold, then gray "Tue Dec 1, 2026 · Locked doubles with Wren" or "Sat Aug 15, 2026 · Americano". Names never cut, no money. The wins load only
// on the tap (one small GET; nothing is added to any page load). The server lists only medals the viewer can see, so the rows match the medals.
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import type { WinsView } from '../shared/tournament';
import { winLine, winsTitle } from '../shared/wins';
import { api } from './lib';
import { Sheet } from './ui';
import { MedalIcon, WinsContext } from './Medals';
import './wins-sheet.css';

/** Makes the medals inside it tappable. `path`: the player's or the organizer's GET. `me`: this phone's player (for "Your wins"). */
export function WinsProvider({ path, me, children }: { path: '/api/tournament/wins' | '/api/admin/tournament-wins'; me?: string | null; children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [view, setView] = useState<WinsView | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);
  const open = useCallback(
    (who: string) => {
      const n = ++asked.current;
      setName(who);
      setView(null);
      setFailed(false);
      api<WinsView>('GET', `${path}?name=${encodeURIComponent(who)}`)
        .then((v) => n === asked.current && setView(v))
        .catch(() => n === asked.current && setFailed(true));
    },
    [path],
  );
  const value = useMemo(() => ({ open, me: me ?? null }), [open, me]);
  return (
    <WinsContext.Provider value={value}>
      {children}
      <Sheet calmFocus open={name !== null} title={name ? winsTitle(name, me) : 'Wins'} onClose={() => setName(null)} className="ws-sheet">
        {name !== null && <WinsList view={view} failed={failed} />}
      </Sheet>
    </WinsContext.Provider>
  );
}

function WinsList({ view, failed }: { view: WinsView | null; failed: boolean }) {
  if (failed) return <p className="ws-empty">Could not load the wins. Try again.</p>;
  if (!view) return <div className="ws-skel" aria-hidden="true" data-ws-loading />;
  if (!view.wins.length) return <p className="ws-empty">No wins to show.</p>;
  return (
    <ul className="ws-list" data-ws-list={view.wins.length}>
      {view.wins.map((w, i) => (
        <li key={`${i}-${w.tournament}`} className="ws-row" data-ws-row={w.tournament}>
          <MedalIcon className="ws-medal" />
          <span className="ws-text">
            <b>{w.tournament}</b>
            <span>{winLine(w)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
