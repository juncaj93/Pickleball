// "New admin layout" (ADMIN_V2): the organizer's History, Money and Home screens, version 2 (Nov 2026).
// Display only: no money rule, price, credit, saved record or API answer depends on it. With it off, the organizer
// screens look exactly as they did before.

/** The phone-only test switch: the page sends this header when the phone opened /admin?adminv2=on. */
export const ADMIN_V2_HEADER = 'X-Admin-V2';

/** The ADMIN_V2 kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function adminV2Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
