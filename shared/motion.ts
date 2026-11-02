// The MOTION switch (animations on the player screens). Visual only: no money rule, text, API or database depends on it.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?motion=on. */
export const MOTION_HEADER = 'X-Motion';

/** The organizer screens' own private test switch (a phone that opened the site with ?motionadmin=on). */
export const MOTION_ADMIN_HEADER = 'X-Motion-Admin';

/** The MOTION var (wrangler.toml): "on" switches the motion on for everyone. Anything else (including missing) is dark. */
export function motionOnForAll(flag: string | undefined | null): boolean {
  return (flag ?? 'off').trim().toLowerCase() === 'on';
}

/** The MOTION_ADMIN var (wrangler.toml): "on" switches the organizer screens' motion on. Anything else (including missing) is dark. */
export const motionAdminOnForAll = motionOnForAll;
