// Zip 48 (speed split): "this phone opens the organizer screens". Set when the organizer dashboard answers (src/pages/Admin.tsx), cleared
// on sign out or a "sign in again" answer (src/lastAdmin.ts). Only used to fetch the organizer file quietly ahead on that phone's player
// screens (src/adminChunk.ts). It holds no data, just "1".

/** This phone has opened the organizer screens with a PIN before (set by the organizer dashboard, cleared on sign out or "sign in again"). */
export const ORGANIZER_PHONE_KEY = 'pb_organizer_phone';

export function markOrganizerPhone(on: boolean): void {
  try {
    if (on) localStorage.setItem(ORGANIZER_PHONE_KEY, '1');
    else localStorage.removeItem(ORGANIZER_PHONE_KEY);
  } catch {
    /* storage off: no background fetch, /admin still works */
  }
}

export function isOrganizerPhone(): boolean {
  try {
    return localStorage.getItem(ORGANIZER_PHONE_KEY) === '1';
  } catch {
    return false;
  }
}

