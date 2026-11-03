// "Admin screens, round 3" (ADMIN_R3): the organizer's Edit game and Add game forms, the Settings clean-up, and the Players page
// layout (Nov 2026). Display only: no money rule, price, credit, seat, saved record, alert or API answer depends on it.
// With it off, these screens look exactly as they did before. It builds on round 2 (ADMIN_R2): it only shows where round 2 is on.

/** The phone-only test switch: the page sends this header when the phone opened /admin?adminr3=on. */
export const ADMIN_R3_HEADER = 'X-Admin-R3';

/** The ADMIN_R3 kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function adminR3Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
