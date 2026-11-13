// Zip 38 (Nov 2026): CHRISTMAS_SKIN ("Christmas skin"). A look-only theme for the PLAYER screens, never the admin screens.
//
// Settings > Feature switches > "Christmas skin" is a 3-WAY switch: Off, Just me, Everyone. It ships OFF. (No schema change: it is stored the way
// every other switch is, as rows in task_log: no row = Off, one row = Just me, the old "on" row = Everyone.)
//   Off       nothing, exactly as the site is today.
//   Just me   everyone sees the normal site and the NORMAL logo (no Christmas logo, no bubble, nothing). Only the organizer's own player (the name
//             set in Settings, on any phone, a Home Screen app included) can tap the normal logo to switch the Christmas theme on and off, on any
//             date. That choice is kept on the server (an iPhone Home Screen app keeps its own storage, apart from Safari's). Nobody else knows.
//   Everyone  inside the WINDOW (the Friday after US Thanksgiving through Dec 31, Eastern; 2026: Fri Nov 27 to Thu Dec 31; computed every year)
//             the Christmas logo shows on every player screen, the first-visit bubble shows, and every player can tap the logo to switch the theme
//             on and off (each phone remembers its own choice, localStorage, every call wrapped: a phone that blocks storage never crashes).
// The THEME (when on): ornaments for the seat balls, candy canes in the section lines, a snow cap on the top game card, red calendar tiles, a
// sage (light) or very dark green (dark) page color. Nothing about words, layout, money or behavior changes. It starts OFF.
//
// The server answers "christmasSkin": true (Everyone, inside the window) or "christmasSkinMe": { on } (Just me, the organizer's own player only).
// Outside all that the answer carries nothing, so it is exactly today's.

export const CHRISTMAS_SKIN = { task: 'christmas_skin_on', meTask: 'christmas_skin_me', meOnTask: 'christmas_skin_me_on', modeHeader: 'X-Christmas-Mode', dateHeader: 'X-Christmas-Date', modeLink: 'xmasmode', dateLink: 'xmasdate', env: 'CHRISTMAS_SKIN', name: 'Christmas skin' } as const;

export type SkinMode = 'off' | 'me' | 'all';
/** "off", "me" or "all" (anything else is nothing). */
export function parseMode(text: string | null | undefined): SkinMode | null {
  const t = (text ?? '').trim().toLowerCase();
  return t === 'off' || t === 'me' || t === 'all' ? t : null;
}

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

/** Same Eastern calendar day? (A saved last screen only lends its Christmas flag to the same day, so the window closing never leaves a stale logo.) */
export function sameEasternDay(a: number, b: number): boolean {
  const x = easternDate(a);
  const y = easternDate(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
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
export const BACK_KEY = 'pb_xmas_back'; // '1' once the "Tap to switch back" bubble has been shown on this phone (the first ON only)

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

/** The "Tap to switch back" bubble: true exactly once per phone, the first time the theme is turned ON (the same rules as the first-visit bubble). */
export function takeFirstOnHint(m: Memory): boolean {
  if (safeGet(m, BACK_KEY) === '1') return false;
  safeSet(m, BACK_KEY, '1');
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
