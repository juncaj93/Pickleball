// Zip 37 (Nov 2026): HOME_SCREEN_TIP ("Home Screen tip"), ships OFF. Players on an iPhone or iPad in Safari (not already a Home Screen app)
// get ONE card at the top of Home, above THIS WEEK, from their SECOND visit on:
//     Rather have this as an app?
//     Add it to your Home Screen          [ Show me how ]                 (X)
// "Show me how" opens a bottom sheet with the three pictured taps (Share, View More, Add to Home Screen) and a green "Got it".
// The X is the only dismiss, and means never again on that phone. "Got it" (or the sheet's X) counts as done: never again either.
// Everything about WHEN it shows lives in this file as plain functions, so the screen and the tests ask the very same question.
// Look only: no price, seat, credit, text or Telegram reads it. The phone keeps its own memory (localStorage, every call wrapped, so a
// phone that blocks storage never crashes and shows the card at most once per page load).

export const HOME_SCREEN_TIP = { task: 'home_screen_tip_on', header: 'X-Home-Screen-Tip', link: 'homescreentip', env: 'HOME_SCREEN_TIP', name: 'Home Screen tip' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who sees it is Settings' call. */
export function homeScreenTipAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The second visit: the next time the site is opened at least this long after the first open. A quick reload does not count. */
export const SECOND_VISIT_MS = 30 * 60_000;

/** The phone's memory. First open (ms since 1970) and "never again" (dismissed with the X, or finished the steps). */
export const TIP_FIRST_KEY = 'pb_hs_first';
export const TIP_DONE_KEY = 'pb_hs_done';

/**
 * iPhone or iPad running Safari itself. Not Chrome, Firefox, Edge or Opera on iOS (their own menus), not an app's built-in browser
 * (no "Safari/" or no "Version/" in the browser string). An iPad that says it is a Mac counts (it has a touch screen; a real Mac does not).
 */
export function isIosSafari(ua: string, platform = '', maxTouchPoints = 0): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Snapchat|Line\/|MicroMessenger/.test(ua)) return false;
  return /Version\/[\d.]+/.test(ua) && /Safari\//.test(ua);
}

export interface TipInput {
  /** The switch is on for this phone (Settings row, or the private link, or the preview's own switch). */
  switchOn: boolean;
  /** The player picked their name and is looking at Home (not "Who are you?", not /admin). */
  onHome: boolean;
  /** View as, the demo copy, or Pretend: never. */
  demo: boolean;
  iosSafari: boolean;
  /** Already opened from the Home Screen (navigator.standalone or display-mode: standalone). */
  standalone: boolean;
  /** The phone's memory said "never again". */
  done: boolean;
  /** When this phone first opened Home (ms), or null when it never did. */
  firstOpenMs: number | null;
  /** This phone already had a name picked when the page opened (a player from before this shipped): counts as past the first visit. */
  knewNameOnOpen: boolean;
  nowMs: number;
}

export type TipVerdict = { show: false; record: 'none' } | { show: false; record: 'first' } | { show: true; record: 'past' | 'none' };

/**
 * What the Home screen does about the card right now:
 *  - show: draw the card.
 *  - record: 'first' = write "first open = now" (a brand new person: a clean first screen), 'past' = write an old first open (a player
 *    from before this shipped: their next open is already the second visit), 'none' = nothing to write.
 */
export function tipVerdict(i: TipInput): TipVerdict {
  if (!i.switchOn || !i.onHome || i.demo || !i.iosSafari || i.standalone || i.done) return { show: false, record: 'none' };
  if (i.firstOpenMs === null || !Number.isFinite(i.firstOpenMs)) {
    // Never opened Home on this phone before.
    return i.knewNameOnOpen ? { show: true, record: 'past' } : { show: false, record: 'first' };
  }
  // A clock set back since the first open must not hide it forever: a first open in the future counts as not old enough yet.
  return i.nowMs - i.firstOpenMs >= SECOND_VISIT_MS ? { show: true, record: 'none' } : { show: false, record: 'none' };
}

/** The first open recorded for a player from before this shipped: long ago, so the very next open is a second visit. */
export const LONG_AGO_MS = 1;

/** The three taps, in order. Each ring is a fixed-pixel circle (never an oval) except the last, which outlines the whole row like the mock. */
export interface TipStep {
  n: number;
  title: string;
  /** The line under the title (step 3 only). */
  hint?: string;
  /** Where the ring sits, in percent of the picture (the center), and its size in pixels. */
  ring: { leftPct: number; topPct: number; px: number } | { rowOutline: true };
}

export const TIP_STEPS: readonly TipStep[] = [
  { n: 1, title: 'Tap the Share button', ring: { leftPct: 48.7, topPct: 47.5, px: 54 } },
  { n: 2, title: 'Tap View More', ring: { leftPct: 87.8, topPct: 33.2, px: 78 } },
  { n: 3, title: 'Tap Add to Home Screen', hint: "Scroll down if you don't see it", ring: { rowOutline: true } },
];
