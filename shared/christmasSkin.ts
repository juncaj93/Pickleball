// Zip 38 (Nov 2026): CHRISTMAS_SKIN ("Christmas skin"), ships OFF. A look-only theme for the PLAYER screens, never the admin screens.
//
// Two layers, both decided here as plain functions so the screen and the tests ask the very same question:
//   1. The WINDOW: the Friday after US Thanksgiving through Dec 31, Eastern (2026: Fri Nov 27 to Thu Dec 31). Computed every year, no
//      yearly edit. Outside the window, or with the switch off, the site is exactly as it is today. Inside it (and with the switch on)
//      the Christmas logo replaces the normal logo and STAYS, whether the theme is on or off.
//   2. The THEME: starts OFF on every phone. Tapping the logo turns it ON and OFF; each phone remembers its own choice. ON = ornaments
//      for the seat balls, candy canes in the section lines, a snow cap on the top game card, red calendar tiles, a sage (light) or very
//      dark green (dark) page color. Nothing about words, layout, money or behavior changes.
//
// The server answers ONE flag ("christmasSkin": true) that already means "switch on for this phone AND inside the window". The phone only
// keeps the theme's own on/off memory (localStorage, every call wrapped: a phone that blocks storage never crashes).

export const CHRISTMAS_SKIN = { task: 'christmas_skin_on', header: 'X-Christmas-Skin', dateHeader: 'X-Christmas-Date', link: 'christmasskin', dateLink: 'xmasdate', env: 'CHRISTMAS_SKIN', name: 'Christmas skin' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who sees it is Settings' call. */
export function christmasSkinAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

const TZ = 'America/Detroit';
const partsFormat = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });

/** Eastern calendar date of a moment. */
export function easternDate(ms: number): { year: number; month: number; day: number } {
  const parts = partsFormat.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** US Thanksgiving: the fourth Thursday of November. Returns the day of the month (22 to 28). */
export function thanksgivingDay(year: number): number {
  const firstWeekday = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return firstThursday + 21;
}

/** The first day of the window: the Friday after Thanksgiving (Nov 23 to 29). */
export function windowStartDay(year: number): number {
  return thanksgivingDay(year) + 1;
}

/** Is this moment inside the window? Friday after Thanksgiving through Dec 31 (Eastern); Jan 1 is out. */
export function inChristmasWindow(ms: number): boolean {
  const { year, month, day } = easternDate(ms);
  if (month === 12) return true;
  return month === 11 && day >= windowStartDay(year);
}

/**
 * The preview-only "pretend today is this day" (?xmasdate=2026-12-05): a plain YYYY-MM-DD that is a real date. Returns noon Eastern
 * (17:00 UTC is noon or 1 PM Eastern, the same Eastern day either way), or null for anything else. The server only listens on previews.
 */
export function parsePretendDate(text: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((text ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return null;
  const ms = Date.UTC(y, mo - 1, d, 17, 0, 0);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

// ---------------------------------------------------------------------------------------------------------------------
// The phone's memory
// ---------------------------------------------------------------------------------------------------------------------

export const THEME_KEY = 'pb_xmas_theme'; // 'on' when this phone turned the theme on; anything else (or nothing) = off
export const HINT_KEY = 'pb_xmas_hint'; // '1' once the first-visit bubble has been shown on this phone

/** Reads and writes that never throw (a phone that blocks storage still works; it just forgets). */
export interface Memory {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

const safeGet = (m: Memory, key: string): string | null => {
  try {
    return m.get(key);
  } catch {
    return null;
  }
};
const safeSet = (m: Memory, key: string, value: string): void => {
  try {
    m.set(key, value);
  } catch {
    /* blocked storage: forget */
  }
};

/** The theme starts OFF; this phone's own last choice is remembered. */
export function readTheme(m: Memory): boolean {
  return safeGet(m, THEME_KEY) === 'on';
}
export function writeTheme(m: Memory, on: boolean): void {
  safeSet(m, THEME_KEY, on ? 'on' : 'off');
}

/**
 * The first-visit bubble ("Tap for Christmas theme"): true exactly once per phone, the first time it is asked. The answer is written
 * down at once, so a reload during the 2 seconds never shows it twice. Storage blocked: at most once per page load (the caller keeps
 * its own once-flag), never an error.
 */
export function takeFirstVisitHint(m: Memory): boolean {
  if (safeGet(m, HINT_KEY) === '1') return false;
  safeSet(m, HINT_KEY, '1');
  return true;
}

/** Which logo file the header shows. Inside the window it is the Christmas one whether the theme is on or off; outside, the normal one. */
export function logoFor(inWindow: boolean): string {
  return inWindow ? '/logo-xmas.png' : '/logo.png';
}

/** Words in the two speech bubbles (the only new words this zip adds). */
export const BUBBLE_FIRST = 'Tap for Christmas theme';
export const BUBBLE_BACK = 'Tap to switch back';
export const BUBBLE_MS = 2000;
