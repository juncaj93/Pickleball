// Zip 55 "Tournaments": where the pinned ticket card goes on the player's Home. The card and its sheets are their own download
// (src/tournament/TournamentHome.tsx), fetched only when the server sends a tournament for this phone, so the player download stays the size
// it was (tests/zip48-split.test.ts budget) and a phone with the switch off never fetches it. While it arrives, a plain dark card of the
// same size holds the place (no jump). If it cannot be fetched (an old page after a deploy), nothing shows; the next reload brings it.
//
// Zip 62 (🎾62.speed): a phone whose last games answer had a card starts the card's file the moment the page opens (src/main.tsx; usually from
// the phone's cache), side by side with the games answer, and the organizer's phone does the same once the dashboard has a tournament (View as).
// A card whose file is already here is drawn directly, in the same frame as the rest of Home: no placeholder first (React holds a placeholder for
// at least 300 ms once it shows one, which was the pop-in even with the file in the cache). The file is still never part of the player download,
// and a phone that never had a card fetches nothing.
import { lazy, type ReactElement, Suspense, useRef } from 'react';
import type { GroupView } from '../shared/api';
import type { PlayerTournamentView } from '../shared/tournament';
import { storageGet, storageRemove, storageSet } from './lib';
import { refetchFailedStyles } from './adminRecover';
import './tournament-slot.css';

/** Zip 56: the three group facts the ticket's Pay sheet reads (the site's own sheet, src/PaySheet.tsx), and the player's name for the Venmo note. */
export type TournamentPayInfo = { group: Pick<GroupView['group'], 'organizerName' | 'venmoUrl' | 'zelleNumber'>; meName: string | null };

type HomeProps = { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo };
type HomeModule = { default: (p: HomeProps) => ReactElement | null };
const Nothing = (_: HomeProps) => null;

/** Zip 62: the card's file once it has arrived (null until then). */
let loaded: HomeModule | null = null;
/** Zip 62: the early fetch started by preloadTournamentHome, if any (null again if it failed: the card's own fetch then tries, as before). */
let early: Promise<HomeModule | null> | null = null;
/** Zip 62: an earlier try to fetch the card's file failed (its style file may then be one Vite will never fetch again). */
let triedAndFailed = false;
const fetchHome = (): Promise<HomeModule> =>
  import('./tournament/TournamentHome').then(
    async (m) => {
      // Vite's own loader never fetches a style file again once it failed (a weak signal when the page opened). So after a failed try, the
      // style files that failed are fetched again first, as the organizer file's loader does (src/adminChunk.ts): a card is never drawn without
      // its look; if that fails too, no card shows (as before) and the next reload brings it. A first try that succeeds waited for its own style
      // file already, so it waits for nothing else.
      if (triedAndFailed) await refetchFailedStyles();
      loaded = m;
      return m;
    },
    (err: unknown) => {
      triedAndFailed = true;
      throw err;
    },
  );

/** Zip 62: start fetching the card's file now, if it is not here or on its way. Never throws; a failure is forgotten. */
export function preloadTournamentHome(): void {
  if (loaded || early) return;
  early = fetchHome().catch(() => {
    early = null;
    return null;
  });
}

const SEEN_KEY = 'pb_tour_seen';
/** Zip 62: this phone's last games answer had a tournament card (true), or had none (false: forgotten). The phone's own page only. */
export function rememberTournament(seen: boolean): void {
  if (seen) storageSet(SEEN_KEY, '1');
  else storageRemove(SEEN_KEY);
}
/** Zip 62: the last games answer this phone got had a tournament card, so the next page open starts its file at once. */
export const tournamentSeen = (): boolean => storageGet(SEEN_KEY) === '1';

const TournamentHome = lazy(async (): Promise<HomeModule> => {
  try {
    return loaded ?? (await early) ?? (await fetchHome());
  } catch {
    return { default: Nothing };
  }
});

export function TournamentSlot({ t, onChanged, pay }: { t: PlayerTournamentView; onChanged: () => Promise<unknown>; pay: TournamentPayInfo }) {
  // Zip 62: decided once for this card, so it never switches between the two ways while it is on screen (that would start it over).
  const ready = useRef(loaded);
  if (ready.current) {
    const Home = ready.current.default;
    return <Home t={t} onChanged={onChanged} pay={pay} />;
  }
  return (
    <Suspense fallback={<div className={`tc-shell skel${t.onlyMe ? ' tc-shell-strip' : ''}`} aria-hidden="true" data-tc-shell />}>
      <TournamentHome t={t} onChanged={onChanged} pay={pay} />
    </Suspense>
  );
}
