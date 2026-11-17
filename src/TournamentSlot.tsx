// Zip 55 "Tournaments": where the pinned ticket card goes on the player's Home. The card and its sheets are their own download
// (src/tournament/TournamentHome.tsx), fetched only when the server sends a tournament for this phone, so the player download stays the size
// it was (tests/zip48-split.test.ts budget) and a phone with the switch off never fetches it. While it arrives, a plain dark card of the
// same size holds the place (no jump). If it cannot be fetched (an old page after a deploy), nothing shows; the next reload brings it.
import { lazy, type ReactElement, Suspense } from 'react';
import type { PlayerTournamentView } from '../shared/tournament';
import './tournament-slot.css';

type HomeProps = { t: PlayerTournamentView; onChanged: () => Promise<unknown> };
const Nothing = (_: HomeProps) => null;
const TournamentHome = lazy(async (): Promise<{ default: (p: HomeProps) => ReactElement | null }> => {
  try {
    return await import('./tournament/TournamentHome');
  } catch {
    return { default: Nothing };
  }
});

export function TournamentSlot({ t, onChanged }: { t: PlayerTournamentView; onChanged: () => Promise<unknown> }) {
  return (
    <Suspense fallback={<div className={`tc-shell${t.onlyMe ? ' tc-shell-strip' : ''}`} aria-hidden="true" />}>
      <TournamentHome t={t} onChanged={onChanged} />
    </Suspense>
  );
}
