import { DEFAULT_SETTINGS, SESSION_DAYS } from './settings';
import { localParts, zonedTimeToUtc } from './time';

export interface PlannedSession {
  startsAt: string;
  endsAt: string;
}

/**
 * Every Tuesday and Thursday at the usual game time (Settings > Schedule,
 * minutes after midnight local time), from today through the horizon.
 * Sessions that already started are skipped. Pure and deterministic.
 */
export function planSessions(
  nowMs: number,
  tz: string,
  horizonWeeks: number,
  startMinutes = DEFAULT_SETTINGS.defaultStartMinutes,
  endMinutes = DEFAULT_SETTINGS.defaultEndMinutes,
): PlannedSession[] {
  const today = localParts(nowMs, tz);
  const out: PlannedSession[] = [];
  const days = horizonWeeks * 7;
  for (let i = 0; i <= days; i++) {
    // Calendar arithmetic on a plain date (no time zone involved).
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (!SESSION_DAYS.includes(d.getUTCDay())) continue;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const start = zonedTimeToUtc(y, m, day, Math.floor(startMinutes / 60), startMinutes % 60, tz);
    const end = zonedTimeToUtc(y, m, day, Math.floor(endMinutes / 60), endMinutes % 60, tz);
    if (start <= nowMs) continue;
    out.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
  }
  return out;
}
