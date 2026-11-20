import type { GroupSettings } from './settings';
import { CANCEL_BY_HOURS } from './time';

// When the day-before and last-call cards show on the organizer's Home.
// Worked out from stored times on every page load; nothing runs in the
// background.

export interface CardInput {
  startsAt: string;
  cancellationDeadlineAt: string | null;
  canceled: boolean;
  dayBeforeDone: boolean;
  lastCallDone: boolean;
}

/** The cancellation deadline, or the default hours before play if none is saved. */
export function deadlineMs(s: Pick<CardInput, 'startsAt' | 'cancellationDeadlineAt'>, settings: GroupSettings): number {
  return s.cancellationDeadlineAt
    ? Date.parse(s.cancellationDeadlineAt)
    : Date.parse(s.startsAt) - CANCEL_BY_HOURS * 3600_000; // Zip 76: one clock (start minus 12 hours), whatever the old setting says
  void settings;
}

/**
 * Day-before: from "Day-before check-in" hours before play (24) until the
 * cancellation deadline. Last call: from "Last call" hours before play (13)
 * until the deadline. Never for canceled sessions, never after Done.
 */
export function cardWindows(s: CardInput, nowMs: number, settings: GroupSettings): { dayBefore: boolean; lastCall: boolean } {
  const start = Date.parse(s.startsAt);
  const deadline = deadlineMs(s, settings);
  const open = !s.canceled && nowMs < deadline && nowMs < start;
  return {
    dayBefore: open && !s.dayBeforeDone && nowMs >= start - settings.checkInHours * 3600_000,
    lastCall: open && !s.lastCallDone && nowMs >= start - settings.lastCallHours * 3600_000,
  };
}
