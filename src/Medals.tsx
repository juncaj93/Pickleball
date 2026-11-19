// Zip 58 (🎾58.tourney4): gold medals next to a tournament winner's name (pictures 26 and 28). Up to 3 medals stack (each one a little over the
// one before); from 4 on, one medal and a count ("×4"). Medals are permanent and count across tournaments. The counts come from the server
// (GET /api/group `tourAwards.medals`, only while the Tournaments switch is on); with none, nothing here draws and every screen is as before.
import { createContext, useContext } from 'react';
import './medals.css';

/** Medals by player name (the names the game cards show). Empty: no medals anywhere. */
export const MedalsContext = createContext<Readonly<Record<string, number>>>({});

/** One gold medal: a red and blue ribbon, a gold disc with a star. */
const MedalIcon = () => (
  <svg className="md-ico" viewBox="0 0 20 26" aria-hidden="true">
    <path d="M5 1h4l2 8H7z" fill="#d6453d" />
    <path d="M11 1h4l-2 8H9z" fill="#2f5fb3" />
    <circle cx="10" cy="17" r="7.5" fill="#f2c54b" stroke="#a8740c" strokeWidth="2" />
    <path d="M10 13l1 2.4 2.6.3-2 1.8.6 2.6-2.2-1.3-2.2 1.3.6-2.6-2-1.8 2.6-.3z" fill="#7a5206" />
  </svg>
);

/** `n` medals: 1 to 3 stacked, 4 and more one medal and "×n". Nothing for 0. `size`: 'top' next to the name at the top, else the game cards. */
export function Medals({ n, size = 'card' }: { n: number; size?: 'top' | 'card' }) {
  if (!n || n < 1) return null;
  return (
    <span className={`md md-${size}`} role="img" aria-label={`${n} medal${n > 1 ? 's' : ''}`} data-medals={n}>
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
  return n ? <Medals n={n} /> : null;
}
