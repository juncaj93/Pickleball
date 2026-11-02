// "No Venmo? Pay Alex directly": a phone without the Venmo app that taps Pay gets an "invalid address" message from
// the browser and nothing else. The Pay button and its link stay exactly as they are. This only watches what happens
// after the tap: if the page was not hidden or left within about two seconds, the Venmo app did not take over, so a
// small note appears. If the app did open, nothing ever shows (not even when the player comes back).

/** How long to wait for the Venmo app to take over the screen. */
export const NO_VENMO_WAIT_MS = 2000;
/** How long the note stays (the usual banner also closes when it is tapped). */
export const NO_VENMO_STAY_MS = 6000;

/** "No Venmo? Pay Alex directly", with the organizer's first name from the site data. */
export function noVenmoMessage(organizerName: string | null | undefined): string {
  const first = (organizerName ?? '').trim().split(/\s+/)[0];
  return `No Venmo? Pay ${first || 'the organizer'} directly`;
}

/** The little bit of the page this needs (so tests can pass a stand-in). */
export interface VisibilityDoc {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}
export interface PageHideWin {
  addEventListener(type: 'pagehide', fn: () => void): void;
  removeEventListener(type: 'pagehide', fn: () => void): void;
}

/**
 * Start watching right after Pay is tapped. `onNoApp` runs once, only if the page stayed in view the whole wait.
 * Returns a function that stops the watching (called by itself when it is over).
 */
let active: (() => void) | null = null;

export function watchVenmoLaunch(
  onNoApp: () => void,
  waitMs: number = NO_VENMO_WAIT_MS,
  doc: VisibilityDoc = document,
  win: PageHideWin = window,
): () => void {
  // Only one watch at a time (two Pay buttons tapped within 2 seconds still give one note).
  active?.();
  let over = false;
  const stop = () => {
    if (active === stop) active = null;
    over = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', stop);
  };
  // The app opened on top of the page: nothing to say, now or later.
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') stop();
  };
  const timer = setTimeout(() => {
    if (over) return;
    const hidden = doc.visibilityState === 'hidden';
    stop();
    if (!hidden) onNoApp();
  }, waitMs);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', stop);
  active = stop;
  return stop;
}
