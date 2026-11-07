// Zip 11 (Nov 2026): one switch, ALERT_CARDS, shipping OFF.
//  - Every alert, notice, banner and popup on the player screen and the organizer Home gets ONE look ("style B"): a slim tinted card
//    with a thin matching border, no icon, a bold title, an optional gray sub line, and ONE button on the right. Two-choice cards put
//    both buttons under the text. Cards that are fine to ignore get a small X. Link-style extras (I paid, Use credit) sit under the title.
//  - Colors: green in / paid / join, amber owes, blue links, credit and booking, purple texting, gray neutral and canceled, red deadlines.
//  - LOOK ONLY. Every alert keeps its action, its timing and its order; nothing saved, charged or sent depends on the switch.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?alertcards=on. */
export const ALERT_CARDS_HEADER = 'X-Alert-Cards';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function zip11Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** "Tomorrow: only 3 in. Cancel court before 7:00 AM." as a title and the rest: an organizer card's own words, split at the first sentence. */
export function splitFirst(text: string): { title: string; rest: string } {
  const i = text.indexOf('. ');
  if (i < 0) return { title: text.replace(/\.$/, ''), rest: '' };
  return { title: text.slice(0, i), rest: text.slice(i + 2).replace(/\.$/, '') };
}
