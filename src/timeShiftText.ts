// "Time may shift": the words and looks, with no browser parts (so tests can read them too).
import { formatMonthDay, formatTime, localParts } from '../shared/time';

/** How the court reads on a tile and its time: booked (solid bright), wait (venue waitlist: dashed, "~7 PM"), none (not booked: dim). */
export type TsKind = 'booked' | 'wait' | 'none';

/** From the court status kind. Canceled, played or started games keep their usual look (null). */
export function tsKind(courtKind: string, venueWaitlist: boolean): TsKind | null {
  if (courtKind === 'booked') return 'booked';
  if (courtKind === 'waitlist' || ((courtKind === 'needs' || courtKind === 'later') && venueWaitlist)) return 'wait';
  if (courtKind === 'needs' || courtKind === 'later') return 'none';
  return null;
}

/** The time under the tile: "~7 PM" for a court on the venue's waitlist (the tilde is not read out). */
export function tsTime(text: string, kind: TsKind | null): string {
  return kind === 'wait' ? `~${text}` : text;
}

const plain = (s: string) => s.replace(/[  ]/g, ' ');
const TILE_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu Nov 5" */
export function tsDay(iso: string, tz: string): string {
  return `${TILE_DAY[localParts(Date.parse(iso), tz).weekday]} ${formatMonthDay(iso, tz)}`;
}

/** Line 1 and the small "Was" line: "Thu Nov 5 moved to 7:30 PM", "Was 7:00 PM" (the old day too when it changed). */
export function tsLines(s: { startsAt: string; wasStartsAt: string }, tz: string): { title: string; was: string } {
  const sameDay = new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: tz }) === new Date(s.wasStartsAt).toLocaleDateString('en-CA', { timeZone: tz });
  // The time keeps together on one line ("8:30 PM" never splits before PM).
  const at = (iso: string) => plain(formatTime(iso, tz)).replace(' ', '\u00a0');
  return {
    title: `${tsDay(s.startsAt, tz)} moved to ${at(s.startsAt)}`,
    was: sameDay ? `Was ${at(s.wasStartsAt)}` : `Was ${tsDay(s.wasStartsAt, tz)}, ${at(s.wasStartsAt)}`,
  };
}

/** The organizer's prefilled text to one player: "Thu Nov 5 is now 7:30 PM. Still in? Open the site and tap Still in." */
export function stillInText(startsAt: string, tz: string, link: string): string {
  return `${tsDay(startsAt, tz)} is now ${plain(formatTime(startsAt, tz))}. Still in? Open the site and tap Still in. ${link}`.trim();
}

