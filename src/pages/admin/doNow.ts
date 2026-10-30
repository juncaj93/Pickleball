// The "Do this now" card's data: the dashboard turned into the shared task
// brain's input, and the card's taps. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { nextTasks, type Task, type TaskAction, type TaskSession } from '../../../shared/tasks';
import { checkInOpensMs, type Suggestion } from './suggestions';
import { sessionTexts } from './textMenu';

export function taskSessionOfView(s: AdminSessionView, courtBookedAt: Record<string, string> = {}): TaskSession {
  return {
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    canceled: s.state.flags.canceled,
    canceledAt: s.canceledAt,
    confirmedCount: s.confirmedCount,
    booked: s.bookingStatus === 'booked',
    bookedAt: s.bookingStatus === 'booked' ? (courtBookedAt[s.id] ?? null) : null,
    cancellationDeadlineAt: s.cancellationDeadlineAt,
    finalized: !!s.finalized,
    holiday: s.holiday,
  };
}

/** The organizer's open tasks right now, most urgent first: the same list the Telegram alerts come from. */
export function dashboardTasks(d: AdminDashboard, nowMs: number, adminUrl: string): Task[] {
  return nextTasks(nowMs, d.sessions.map((s) => taskSessionOfView(s, d.courtBookedAt ?? {})), new Set(d.taskMarks ?? []), {
    tz: d.group.timezone,
    bookingLeadDays: d.group.settings.bookingLeadDays,
    defaultDeadlineHours: d.group.settings.defaultDeadlineHours,
    links: { admin: adminUrl, book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL },
  });
}

/**
 * The Messages link for a text button, or null when that text does not fit
 * the game right now. The night-before texts and the post-game note open
 * with no recipients (the organizer picks the group chat); the canceled
 * text goes to the numbers of everyone signed up.
 */
export function textHref(d: AdminDashboard, s: AdminSessionView, nowMs: number, action: Extract<TaskAction, { type: 'text' }>, ios: boolean): string | null {
  const item = sessionTexts(d, s, nowMs).find((i) => i.id === action.text);
  if (!item) return null;
  const toNumbers = action.text === 'canceled' && item.phones.length > 0;
  return smsHref(toNumbers ? item.phones : null, item.body, ios);
}


/**
 * Text suggestions the "Do this now" card already covers, so nothing shows
 * twice: Need players and Check-in from 6:00 PM the night before (the
 * night-before task). The post-game note stays on its own "Final price" card.
 */
export function coveredByDoNow(c: Suggestion, d: AdminDashboard, nowMs: number): boolean {
  const s = d.sessions.find((x) => x.id === c.sessionId);
  if (!s) return false;
  // Only booked games get the night-before card; others keep their suggestion card as before.
  if (c.kind === 'need' || c.kind === 'checkin') return s.bookingStatus === 'booked' && nowMs >= checkInOpensMs(s.startsAt, d.group.timezone);
  return false;
}
