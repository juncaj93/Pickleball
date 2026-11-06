// "Last call texts" (LAST_CALL_TEXTS, Zip 8): the night-before last call text says what Alex's rules ask for.
//  - 4 or more in: a text for the WHOLE group chat (no recipients) asking if everyone is still in and if anyone else is in.
//  - 3 or fewer in: a group chat text "we need X more or tomorrow's game is canceled to avoid fees".
// It replaces only the words of the Check-in and Need players texts (the same texts the night-before Telegram alert's direct
// link opens), and only on top of "Texts and alerts, round 2" (TEXTS_R2), which already opens both with no recipients.
// Off: the round 2 words exactly as before. Nothing is sent by the site; it only opens Messages with the words ready.
import { dayGap, dayWordR2, whenR2 } from './textsR2';

/** The phone-only test switch: the organizer screen sends this header when the phone opened /admin?lastcall=on. */
export const LAST_CALL_HEADER = 'X-Last-Call';

/** The LAST_CALL_TEXTS kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function lastCallAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

interface SessionLike {
  startsAt: string;
  endsAt?: string;
}

const lines = (body: string[], link: string) => `${body.join('\n')}\n\n${link}`;
/** "tonight" for a game tomorrow or today, "early" further out (the same rule as the round 2 texts). */
const byWhen = (iso: string, tz: string, nowMs: number) => (dayGap(iso, tz, nowMs) <= 1 ? 'tonight' : 'early');

/** "tomorrow's game", "tonight's game", "today's game", or "the Tue Nov 17 game". */
export function whichGame(iso: string, tz: string, nowMs: number): string {
  const w = dayWordR2(iso, tz, nowMs);
  return w === 'tomorrow' || w === 'tonight' || w === 'today' ? `${w}'s game` : `the ${w} game`;
}

/** 4 or more in: is everyone still in, is anyone else in. Opens with no recipients (the group chat). */
export function checkInTextLastCall(s: SessionLike, tz: string, nowMs: number, signedUp: number, link: string): string {
  return lines(
    [`Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`, `${signedUp} in so far. Is everyone still in? Anyone else in?`, `Need to back out? Do it ${byWhen(s.startsAt, tz, nowMs)} to avoid cancel fees.`],
    link,
  );
}

/** 3 or fewer in: we need X more or the game is canceled to avoid fees. Opens with no recipients (the group chat). */
export function needPlayersTextLastCall(s: SessionLike, tz: string, nowMs: number, signedUp: number, need: number, link: string): string {
  return lines(
    [`Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`, `${signedUp} in. We need ${need} more or ${whichGame(s.startsAt, tz, nowMs)} is canceled to avoid fees.`, `Want in? Join ${byWhen(s.startsAt, tz, nowMs)}.`],
    link,
  );
}
