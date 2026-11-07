// Zip 7: the three look-and-feel switches reach the style sheets as <html> attributes (src/zip7.css only styles under them), the same way
// motion does. Off = no attribute = every rule in zip7.css is dormant and the site looks exactly as before.
import { useLayoutEffect } from 'react';
import { tileDay, type TileDay } from '../shared/zip7';

export interface Zip7Flags {
  tonightGlow?: boolean;
  colorCleanup?: boolean;
  playerCardsSimple?: boolean;
  /** Zip 10, CARD_CLEANUP (src/zip10.css): rides on the same hook. */
  cardCleanup?: boolean;
  /** Zip 11, ALERT_CARDS (src/alert-cards.css): rides on the same hook. */
  alertCards?: boolean;
}

const ATTRS: [keyof Zip7Flags, string][] = [
  ['tonightGlow', 'data-tonight-glow'],
  ['colorCleanup', 'data-color-cleanup'],
  ['playerCardsSimple', 'data-player-cards'],
  ['cardCleanup', 'data-card-cleanup'],
  ['alertCards', 'data-alert-cards'],
];

/** Sets the <html> attributes for the switches that are on for this screen; takes them off when the screen goes away. */
export function useZip7Root(flags: Zip7Flags | null | undefined, active = true) {
  const tg = !!flags?.tonightGlow && active;
  const cc = !!flags?.colorCleanup && active;
  const pc = !!flags?.playerCardsSimple && active;
  const cl = !!flags?.cardCleanup && active;
  const ac = !!flags?.alertCards && active;
  useLayoutEffect(() => {
    const on: Record<string, boolean> = { tonightGlow: tg, colorCleanup: cc, playerCardsSimple: pc, cardCleanup: cl, alertCards: ac };
    const root = document.documentElement;
    const set: string[] = [];
    for (const [key, attr] of ATTRS) {
      if (on[key]) {
        root.setAttribute(attr, 'on');
        set.push(attr);
      }
    }
    return () => set.forEach((a) => root.removeAttribute(a));
  }, [tg, cc, pc, cl, ac]);
}

/** TONIGHT_GLOW on: which tag a date tile on the organizer Home wears (undefined with the switch off, so the tile stays exactly as before). */
export function adminTileDay(d: { tonightGlow?: boolean; now: string; group: { timezone: string } }, s: { startsAt: string; state: { flags: { canceled: boolean; started: boolean } } }): TileDay | undefined {
  if (d.tonightGlow !== true) return undefined;
  return tileDay(s.startsAt, d.group.timezone, Date.parse(d.now), !s.state.flags.canceled && !s.state.flags.started);
}
