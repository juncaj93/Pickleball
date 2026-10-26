export interface GroupSettings {
  horizonWeeks: number; // how far ahead sessions are generated
  bookingLeadDays: number; // booking checklist becomes actionable this many days ahead
  warningWindowHours: number; // flag underfilled sessions this long before the cancellation deadline
  confirmationLeadHours: number; // attendance confirmations are due this long before play
  defaultDeadlineHours: number; // suggested cancellation deadline (hours before start)
}

export const DEFAULT_SETTINGS: GroupSettings = {
  horizonWeeks: 6,
  bookingLeadDays: 14,
  warningWindowHours: 18,
  confirmationLeadHours: 24,
  defaultDeadlineHours: 12,
};

const LIMITS: Record<keyof GroupSettings, [number, number]> = {
  horizonWeeks: [1, 12],
  bookingLeadDays: [1, 30],
  warningWindowHours: [1, 168],
  confirmationLeadHours: [1, 72],
  defaultDeadlineHours: [0, 168],
};

export const SETTING_LIMITS = LIMITS;

/** Merge stored or submitted settings over defaults, clamping each value. */
export function normalizeSettings(input: unknown): GroupSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
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

export const SPOTS_PER_SESSION = 4;
export const SESSION_DAYS = [2, 4]; // Tuesday, Thursday
export const SESSION_START = { hour: 20, minute: 0 }; // 8:00 PM local
export const SESSION_END = { hour: 22, minute: 0 }; // 10:00 PM local
