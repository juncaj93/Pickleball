// "Home collapse" (HOME_COLLAPSE, Nov 2026): the player Home shows only THIS WEEK and NEXT WEEK games. Every game after next week sits
// behind ONE button, "More sessions" (no number), collapsed each time the page loads; it opens the later games in the usual LATER row
// style and turns into "Show fewer". No later games: no button. Display only: nothing saved, charged or sent depends on it.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?homecollapse=on. */
export const HOME_COLLAPSE_HEADER = 'X-Home-Collapse';

/** The HOME_COLLAPSE kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function homeCollapseAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
