// Zip 58 (🎾58.tourney4): gold medals next to a tournament winner's name (pictures 26 and 28). Up to 3 medals stack (each one a little over the
// one before); from 4 on, one medal and a count ("×4"). Medals are permanent and count across tournaments. The counts come from the server
// (GET /api/group `tourAwards.medals`, only while the Tournaments switch is on); with none, nothing here draws and every screen is as before.
import { createContext, useContext } from 'react';
import './medals.css';

/** Medals by player name (the names the game cards show). Empty: no medals anywhere. */
export const MedalsContext = createContext<Readonly<Record<string, number>>>({});

/** One gold medal: a red and blue ribbon, a gold disc with a star. Zip 77: also 1st place's mark on the reveal board (`className`). Zip 78:
 *  its colors are the named art tokens. */
export const MedalIcon = ({ className = 'md-ico' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 26" aria-hidden="true">
    <path d="M5 1h4l2 8H7z" style={{ fill: 'var(--art-medal-ribbon-1)' }} />
    <path d="M11 1h4l-2 8H9z" style={{ fill: 'var(--art-medal-ribbon-2)' }} />
    <circle cx="10" cy="17" r="7.5" style={{ fill: 'var(--art-medal-gold)', stroke: 'var(--art-medal-edge)' }} strokeWidth="2" />
    <path d="M10 13l1 2.4 2.6.3-2 1.8.6 2.6-2.2-1.3-2.2 1.3.6-2.6-2-1.8 2.6-.3z" style={{ fill: 'var(--art-medal-star)' }} />
  </svg>
);

/**
 * Zip 82: inside a WinsProvider (src/WinsSheet.tsx) the medals next to a name are a button that opens that name's wins. Null (no provider:
 * the winners ticker, anywhere else): they stay a plain picture.
 */
export const WinsContext = createContext<{ open: (name: string) => void; me: string | null } | null>(null);

/** `n` medals: 1 to 3 stacked, 4 and more one medal and "×n". Nothing for 0. `size`: 'top' next to the name at the top, else the game cards.
 *  Zip 82: with `name` and a WinsProvider around them, a tap opens the name's wins ("Vic’s wins, 2 medals"). */
export function Medals({ n, size = 'card', name }: { n: number; size?: 'top' | 'card'; name?: string }) {
  const wins = useContext(WinsContext);
  if (!n || n < 1) return null;
  const pic = <MedalsPicture n={n} size={size} hidden={!!(wins && name)} />;
  if (!wins || !name) return pic;
  const whose = wins.me && wins.me === name ? 'Your wins' : `${name}’s wins`;
  return (
    <button
      type="button"
      className={`md-btn md-btn-${size}`}
      aria-label={`${whose}, ${n} medal${n > 1 ? 's' : ''}`}
      onClick={(e) => {
        // A medal on a tappable card or row opens the wins, not the card.
        e.stopPropagation();
        wins.open(name);
      }}
      data-medals-btn={name}
    >
      {pic}
    </button>
  );
}

function MedalsPicture({ n, size, hidden }: { n: number; size: 'top' | 'card'; hidden: boolean }) {
  return (
    <span className={`md md-${size}`} {...(hidden ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${n} medal${n > 1 ? 's' : ''}` })} data-medals={n}>
      {n <= 3 ? (
        Array.from({ length: n }, (_, i) => <MedalIcon key={i} />)
      ) : (
        <>
          <MedalIcon />
          <span className="md-count">×{n}</span>
        </>
      )}
    </span>
  );
}

/** The medals of a name, from the screen's counts (0 when none). */
export function useMedalsOf(name: string): number {
  return useContext(MedalsContext)[name] ?? 0;
}

/** A name on a game card with its medals after it (nothing extra when it has none). */
export function NameMedals({ name }: { name: string }) {
  const n = useMedalsOf(name);
  return n ? <Medals n={n} name={name} /> : null;
}
