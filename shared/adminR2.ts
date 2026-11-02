// "Admin screens, round 2" (ADMIN_R2): the organizer's Home cards, Money, Players, History and header, round 2 (Nov 2026).
// Display only: no money rule, price, credit, seat, saved record or API answer depends on it. With it off, the organizer
// screens look exactly as they did before. The one thing it can change is a soft "Hide player" mark, which only
// removes a name from the organizer's own Players list and pickers (nothing about that player is touched).

/** The phone-only test switch: the page sends this header when the phone opened /admin?adminr2=on. */
export const ADMIN_R2_HEADER = 'X-Admin-R2';

/** The ADMIN_R2 kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function adminR2Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
