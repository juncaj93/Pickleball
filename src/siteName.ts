// The site's name on screen: the group name saved in Settings, or "Pickleball" until a screen has it (Zip 29).
// The browser tab reads it (Shell.tsx TopBar). Screens that load the group call setSiteName with its name.
import { useSyncExternalStore } from 'react';
import { SITE_NAME, siteNameFor } from '../shared/settings';

let current = SITE_NAME;
const listeners = new Set<() => void>();

/** Blank or missing: the fallback "Pickleball". */
export function setSiteName(name: string | null | undefined): void {
  const next = siteNameFor(name);
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export function getSiteName(): string {
  return current;
}

export function useSiteName(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSiteName,
    () => SITE_NAME,
  );
}
