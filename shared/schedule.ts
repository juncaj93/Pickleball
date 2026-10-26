import { SESSION_DAYS, SESSION_END, SESSION_START } from './settings';
import { localParts, zonedTimeToUtc } from './time';

export interface PlannedSession {
  startsAt: string;
  endsAt: string;
}

/**
 * Every Tuesday and Thursday, 8–10 PM local time, from today through the
 * horizon. Sessions that already started are skipped. Pure and
 * deterministic: the database's unique (group_id, starts_at) key makes
 * repeated runs harmless.
 */
export function planSessions(nowMs: number, tz: string, horizonWeeks: number): PlannedSession[] {
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
    const start = zonedTimeToUtc(y, m, day, SESSION_START.hour, SESSION_START.minute, tz);
    const end = zonedTimeToUtc(y, m, day, SESSION_END.hour, SESSION_END.minute, tz);
    if (start <= nowMs) continue;
    out.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
  }
  return out;
}
