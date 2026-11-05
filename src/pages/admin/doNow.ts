// The "Do this now" card's data: the dashboard turned into the shared task
// brain's input, and the card's taps. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { smsHref } from '../../../shared/messages';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { markKey, nextTasks, type Task, type TaskAction, type TaskSession } from '../../../shared/tasks';
import { checkInOpensMs, daysSince, type Suggestion } from './suggestions';
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
    // Only TEXTS_R2 reads this (same rule as the Waitlist court switch).
    waitlisted: s.bookingStatus !== 'booked' && (s.bookingStatus === 'unavailable' || s.courtState === 'waitlist'),
  };
}

/** The organizer's open tasks right now, most urgent first: the same list the Telegram alerts come from. */
export function dashboardTasks(d: AdminDashboard, nowMs: number, adminUrl: string): Task[] {
  return nextTasks(nowMs, d.sessions.filter((s) => s.hiddenFromList !== true).map((s) => taskSessionOfView(s, d.courtBookedAt ?? {})), new Set(d.taskMarks ?? []), {
    tz: d.group.timezone,
    bookingLeadDays: d.group.settings.bookingLeadDays,
    defaultDeadlineHours: d.group.settings.defaultDeadlineHours,
    links: { admin: adminUrl, book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL },
    ...(d.textsR2 === true ? { textsR2: true } : {}),
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

/** The "no court yet" family of task cards. On Home they become the one court card below (Telegram is not affected). */
const NO_COURT_KINDS: ReadonlySet<Task['kind']> = new Set(['book', 'nocourt', 'nocourt_later']);

/**
 * What the "Do this now" card shows from the task list: everything except the "no court yet"
 * family, which `courtCards` draws as one plain card per game. The Telegram alerts come from the
 * full list and are not affected.
 */
export function visibleTasks(d: AdminDashboard, nowMs: number, adminUrl: string): Task[] {
  const tasks = dashboardTasks(d, nowMs, adminUrl);
  // A game asked "Did you guys play?" gets that one card; its "finalize who played" task waits for the answer.
  const asking = new Set(courtCardsFrom(d, nowMs, tasks).filter((c) => c.kind === 'played').map((c) => c.session.id));
  return tasks.filter((t) => !NO_COURT_KINDS.has(t.kind) && !(t.kind === 'finalize' && asking.has(t.sessionId)));
}

/**
 * The court card for a game that is not canceled and was never marked Booked (Waitlist or Not booked):
 * - 'book': "Court still needs to be booked" with the CourtReserve link, when the task list asks about the
 *   court (booking day, the morning of, or the next 2 games open to book), for Waitlist and Not booked
 *   alike (Alex, Nov 1: the next 2 only, not every Waitlist game however far ahead).
 * - 'played': once the game's date has passed (Eastern calendar day), with someone in and not finalized,
 *   "Did you guys play?" (Yes, we played / Cancel game), until answered.
 * One card per game at most. A canceled, Booked or finalized game gets none.
 */
export type CourtCard = { kind: 'book' | 'played'; session: AdminSessionView };

/** "Did you guys play?" is asked for games whose date passed at most this many days ago (the server keeps card taps for 30). */
export const PLAYED_ASK_DAYS = 28;

export function courtCards(d: AdminDashboard, nowMs: number, adminUrl: string): CourtCard[] {
  return courtCardsFrom(d, nowMs, dashboardTasks(d, nowMs, adminUrl));
}

function courtCardsFrom(d: AdminDashboard, nowMs: number, tasks: Task[]): CourtCard[] {
  const tz = d.group.timezone;
  const marks = new Set(d.taskMarks ?? []);
  const asked = new Set(tasks.filter((t) => NO_COURT_KINDS.has(t.kind)).map((t) => t.sessionId));
  const book: CourtCard[] = [];
  const played: CourtCard[] = [];
  for (const s of d.sessions) {
    if (s.hiddenFromList === true) continue; // hidden from the list (Money page rework): no court card
    if (s.state.flags.canceled || s.bookingStatus === 'booked' || s.finalized) continue;
    if (nowMs < Date.parse(s.endsAt)) {
      // Waitlist and Not booked follow one rule: the card shows when the task list asks about the court.
      if (asked.has(s.id)) book.push({ kind: 'book', session: s });
    } else if (daysSince(s.startsAt, nowMs, tz) >= 1 && daysSince(s.startsAt, nowMs, tz) <= PLAYED_ASK_DAYS && s.confirmedCount > 0 && !marks.has(markKey(s.id, 'played'))) {
      played.push({ kind: 'played', session: s });
    }
  }
  const byStart = (a: CourtCard, b: CourtCard) => Date.parse(a.session.startsAt) - Date.parse(b.session.startsAt);
  return [...played.sort(byStart), ...book.sort(byStart)];
}
