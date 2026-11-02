// The MOTION switch (animations on the player screens). Visual only: no money rule, text, API or database depends on it.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?motion=on. */
export const MOTION_HEADER = 'X-Motion';

/** The MOTION var (wrangler.toml): "on" switches the motion on for everyone. Anything else (including missing) is dark. */
export function motionOnForAll(flag: string | undefined | null): boolean {
  return (flag ?? 'off').trim().toLowerCase() === 'on';
}
