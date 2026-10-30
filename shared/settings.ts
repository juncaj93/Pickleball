import { DEFAULT_MAX_PLAYERS, MAX_PLAYERS_LIMIT, MIN_PLAYERS } from './spots';

export interface GroupSettings {
  horizonWeeks: number; // how far ahead sessions are generated
  bookingLeadDays: number; // booking checklist becomes actionable this many days ahead
  checkInHours: number; // day-before check-in: texts and "short on players" start this long before play
  defaultDeadlineHours: number; // each session's cancellation deadline starts this many hours before play
  pricePerPlayerCents: number; // the flat price everyone pays up front ("$14 each"); the final price after the game comes from it
  maxPlayers: number; // the most who can be in one game (4 to 12); beyond that people wait
  lastCallHours: number; // the last-call card starts this many hours before play
  typicalCourtCostCents: number; // organizer only: court cost used when a session has none entered
  monthlyMembershipCents: number; // organizer only: the club membership the surplus goes toward
  defaultStartMinutes: number; // the usual start for NEW regular games, in minutes after midnight (1200 = 8:00 PM); existing games keep their times
  defaultEndMinutes: number; // the usual end for new regular games (1320 = 10:00 PM)
}

export const DEFAULT_SETTINGS: GroupSettings = {
  horizonWeeks: 6,
  bookingLeadDays: 14,
  checkInHours: 24,
  defaultDeadlineHours: 12,
  pricePerPlayerCents: 1400,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  lastCallHours: 13,
  typicalCourtCostCents: 4800,
  monthlyMembershipCents: 3000,
  defaultStartMinutes: 20 * 60,
  defaultEndMinutes: 22 * 60,
};

const LIMITS: Record<keyof GroupSettings, [number, number]> = {
  horizonWeeks: [1, 12],
  bookingLeadDays: [1, 30],
  checkInHours: [1, 72],
  defaultDeadlineHours: [0, 72],
  pricePerPlayerCents: [0, 100_00],
  maxPlayers: [MIN_PLAYERS, MAX_PLAYERS_LIMIT],
  lastCallHours: [1, 48],
  typicalCourtCostCents: [0, 500_00],
  monthlyMembershipCents: [0, 1000_00],
  defaultStartMinutes: [0, 22 * 60 + 59],
  defaultEndMinutes: [1, 23 * 60 + 59],
};

export const SETTING_LIMITS = LIMITS;

/** Merge stored or submitted settings over defaults, clamping each value. Keys from older models (like the $5 credit) are ignored. */
export function normalizeSettings(input: unknown): GroupSettings {
  const src = { ...((input && typeof input === 'object' ? input : {}) as Record<string, unknown>) };
  // Older saves called the check-in window "confirmationLeadHours".
  if (src.checkInHours === undefined && typeof src.confirmationLeadHours === 'number') src.checkInHours = src.confirmationLeadHours;
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(LIMITS) as (keyof GroupSettings)[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = LIMITS[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
  // A game ends after it starts, on the same day; a bad pair falls back to two hours long.
  if (out.defaultEndMinutes <= out.defaultStartMinutes) out.defaultEndMinutes = Math.min(out.defaultStartMinutes + 120, 23 * 60 + 59);
  // Players pay whole dollars (credit and the final price follow from it).
  out.pricePerPlayerCents = Math.round(out.pricePerPlayerCents / 100) * 100;
  return out;
}

export const DEFAULT_VENUE_NAME = 'Northville Pickleball Club';
/** The site's name: header fallback, browser tab, Home Screen icon. The group's own name lives in Settings. */
export const SITE_NAME = 'Pickleball Bros';
/** Where the organizer books the court on CourtReserve. */
export const COURTRESERVE_BOOKING_URL = 'https://mobileapp.courtreserve.com/Online/Reservations/Bookings/13765?sId=19442';
/** Where the organizer changes or cancels an existing CourtReserve booking. */
export const COURTRESERVE_CANCEL_URL = 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1';
export const SESSION_DAYS = [2, 4]; // Tuesday, Thursday
// The usual game time is a setting now (defaultStartMinutes / defaultEndMinutes, Settings > Schedule).

/** "19:00" for a minutes-after-midnight value: what <input type="time"> uses. */
export function minutesToHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Minutes after midnight for "19:30", or null. */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "7:00 PM" for a minutes-after-midnight value. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
