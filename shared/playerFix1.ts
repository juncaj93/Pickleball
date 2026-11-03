// "Player screen small fixes, round 1" (PLAYER_FIX1). Two layout-only changes on the PLAYER screen:
//   1. On game day (after the 8:00 AM cutoff) tonight's game card gets the same Pay and "I paid" buttons as the later
//      cards. The "Tonight: you owe $14" card at the top stays exactly as it is.
//   2. The small blue "TONIGHT" tag (and the other tags that share its style) gets room to breathe.
// Display only: the Pay button, its link, the amount, "I paid" and every money rule are untouched. Off: every screen
// looks exactly as it did before.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?playerfix1=on. */
export const PLAYER_FIX1_HEADER = 'X-Player-Fix1';

/** The PLAYER_FIX1 kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function playerFix1Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
