// Zip 83 (🎾83.champions), pictures 1 and 3: the gold cup button, LEFT of the light/dark button, the exact same round button (size, ring, shadow,
// both themes). It shows only when someone has a gold medal players can see (the medal counts the page already loads; the organizer's Home
// sends `champions`): no champ yet, no button. A tap opens the Champions wall (src/ChampionsSheet.tsx, its own small file, fetched on the first
// tap together with the one small GET; nothing is added to any page load).
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import type { ChampionsView } from '../shared/champions';
import { api } from './lib';
import './champions.css';

const ChampionsSheet = lazy(() => import('./ChampionsSheet'));

/** The approved gold cup (cup.svg, exact shapes), in the site's medal colors. 26 px, centered in the round button by eye. */
export const CupIcon = () => (
  <svg className="cup-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path d="M6.8 6.2H4.9a2.6 2.6 0 0 0 2.6 3.7M17.2 6.2h1.9a2.6 2.6 0 0 1-2.6 3.7" fill="none" style={{ stroke: 'var(--art-medal-edge)' }} strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6.8 3.8h10.4v4.6a5.2 5.2 0 0 1-10.4 0z" style={{ fill: 'var(--art-medal-gold)', stroke: 'var(--art-medal-edge)' }} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 5.4l.8 1.7 1.8.2-1.4 1.2.4 1.8-1.6-.9-1.6.9.4-1.8-1.4-1.2 1.8-.2z" style={{ fill: 'var(--art-medal-star)' }} />
    <path d="M10.9 13.6h2.2v2.6h-2.2z" style={{ fill: 'var(--art-medal-edge)' }} />
    <path d="M9 16.2h6l.9 2.2H8.1z" style={{ fill: 'var(--art-medal-gold)', stroke: 'var(--art-medal-edge)' }} strokeWidth="1.5" strokeLinejoin="round" />
    <rect x="6.6" y="18.4" width="10.8" height="2.4" rx=".8" style={{ fill: 'var(--art-medal-gold)', stroke: 'var(--art-medal-edge)' }} strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export type ChampionsPath = '/api/tournament/champions' | '/api/admin/champions';

/** The cup and its sheet. `path`: the player's or the organizer's GET (the same rows). Render it only when there is a champion. */
export function CupButton({ path }: { path: ChampionsPath }) {
  const [open, setOpen] = useState(false);
  // Mounted once opened, so the sheet slides out on close (and in again on the next tap).
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<ChampionsView | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    setFailed(false);
    api<ChampionsView>('GET', path)
      .then((v) => n === asked.current && setView(v))
      .catch(() => n === asked.current && setFailed(true));
  }, [path]);
  return (
    <>
      <button
        type="button"
        className="mode-btn cup-btn"
        aria-label="Champions"
        data-cup
        onClick={() => {
          // Every tap reads again (a tournament may have ended since); the last answer stays on screen meanwhile.
          load();
          setMounted(true);
          setOpen(true);
        }}
      >
        <CupIcon />
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <ChampionsSheet open={open} view={view} failed={failed} onRetry={load} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
