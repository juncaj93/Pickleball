// Zip 55 "Tournaments": where the pinned ticket card goes on the player's Home. The card and its sheets are their own download
// (src/tournament/TournamentHome.tsx), fetched only when the server sends a tournament for this phone, so the player download stays the size
// it was (tests/zip48-split.test.ts budget) and a phone with the switch off never fetches it. While it arrives, a plain dark card of the
// same size holds the place (no jump). If it cannot be fetched (an old page after a deploy), nothing shows; the next reload brings it.
import { lazy, type ReactElement, Suspense } from 'react';
import type { GroupView } from '../shared/api';
import type { PlayerTournamentView } from '../shared/tournament';
import './tournament-slot.css';

/** Zip 56: the three group facts the ticket's Pay sheet reads (the site's own sheet, src/PaySheet.tsx), and the player's name for the Venmo note. */
export type TournamentPayInfo = { group: Pick<GroupView['group'], 'organizerName' | 'venmoUrl' | 'zelleNumber'>; meName: string | null };

type HomeProps = { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo };
const Nothing = (_: HomeProps) => null;
const TournamentHome = lazy(async (): Promise<{ default: (p: HomeProps) => ReactElement | null }> => {
  try {
    return await import('./tournament/TournamentHome');
  } catch {
    return { default: Nothing };
  }
});

export function TournamentSlot({ t, onChanged, pay }: { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo }) {
  return (
    <Suspense fallback={<div className={`tc-shell${t.onlyMe ? ' tc-shell-strip' : ''}`} aria-hidden="true" />}>
      <TournamentHome t={t} onChanged={onChanged} pay={pay} />
    </Suspense>
  );
}
