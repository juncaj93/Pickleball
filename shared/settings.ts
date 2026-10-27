export interface GroupSettings {
  horizonWeeks: number; // how far ahead sessions are generated
  bookingLeadDays: number; // booking checklist becomes actionable this many days ahead
  checkInHours: number; // day-before check-in: texts and "short on players" start this long before play
  defaultDeadlineHours: number; // each session's cancellation deadline starts this many hours before play
  pricePerPlayerCents: number; // flat price each confirmed player pays, whether 4 or 6 play
  creditCentsWhenSix: number; // credit each of the first four earns when 6 play; the last two pay price minus this
  lastCallHours: number; // the last-call card starts this many hours before play
}

export const DEFAULT_SETTINGS: GroupSettings = {
  horizonWeeks: 6,
  bookingLeadDays: 14,
  checkInHours: 24,
  defaultDeadlineHours: 12,
  pricePerPlayerCents: 1400,
  creditCentsWhenSix: 500,
  lastCallHours: 13,
};

const LIMITS: Record<keyof GroupSettings, [number, number]> = {
  horizonWeeks: [1, 12],
  bookingLeadDays: [1, 30],
  checkInHours: [1, 72],
  defaultDeadlineHours: [0, 72],
  pricePerPlayerCents: [0, 100_00],
  creditCentsWhenSix: [0, 100_00],
  lastCallHours: [1, 48],
};

export const SETTING_LIMITS = LIMITS;

/** Merge stored or submitted settings over defaults, clamping each value. */
export function normalizeSettings(input: unknown): GroupSettings {
  const src = { ...((input && typeof input === 'object' ? input : {}) as Record<string, unknown>) };
  // Older saves called the check-in window "confirmationLeadHours".
  if (src.checkInHours === undefined && typeof src.confirmationLeadHours === 'number') src.checkInHours = src.confirmationLeadHours;
  // Part 2 called the credit a refund.
  if (src.creditCentsWhenSix === undefined && typeof src.refundCentsWhenSix === 'number') src.creditCentsWhenSix = src.refundCentsWhenSix;
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(LIMITS) as (keyof GroupSettings)[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [min, max] = LIMITS[key];
      out[key] = Math.min(max, Math.max(min, Math.round(v)));
    }
  }
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
export const SESSION_START = { hour: 20, minute: 0 }; // 8:00 PM local
export const SESSION_END = { hour: 22, minute: 0 }; // 10:00 PM local
