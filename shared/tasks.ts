// "Do this now": the organizer's open tasks, most urgent first. One pure
// function feeds both the card at the top of Home and the Telegram alerts,
// so the two can never disagree. Times are worked out in the group's time
// zone by calendar day (never 24-hour math), so the November clock change
// is safe. No phone numbers, Venmo names or money ever go in here.
import { MIN_PLAYERS } from './spots';
import { formatTime, formatWeekday, localParts, zonedTimeToUtc } from './time';
import { textDay } from './messages';

/** What the task brain needs to know about one game. Nothing private. */
export interface TaskSession {
  id: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  canceledAt: string | null;
  confirmedCount: number;
  /** The court is booked on CourtReserve. */
  booked: boolean;
  /** Not booked yet, and not waiting on the venue's court waitlist. */
  needsBooking: boolean;
  /** The game's own cancellation deadline (null: the default hours before play). */
  cancellationDeadlineAt: string | null;
  finalized: boolean;
  holiday: string | null;
}

/** Taps the organizer made on the card, saved on the server. */
export type MarkName = 'night_text' | 'court_canceled' | 'canceled_text' | 'postgame_text';
export const MARK_NAMES: MarkName[] = ['night_text', 'court_canceled', 'canceled_text', 'postgame_text'];

/** Marks as "sessionId:mark". */
export type Marks = ReadonlySet<string>;
export const markKey = (sessionId: string, mark: MarkName) => `${sessionId}:${mark}`;

export type TaskAction =
  | { type: 'text'; text: 'need' | 'checkin' | 'canceled' | 'final'; mark: MarkName }
  | { type: 'link'; href: string }
  | { type: 'mark'; mark: MarkName }
  | { type: 'cancel' }
  | { type: 'booked' }
  | { type: 'finalize' };

export interface TaskButton {
  id: string;
  label: string;
  action: TaskAction;
}

/** One line of a checklist card. Not enabled: waits for the step before it. */
export interface TaskStep {
  id: string;
  label: string;
  done: boolean;
  enabled: boolean;
  buttons: TaskButton[];
}

export type AlertId = 'night' | 'cancel' | 'cancel_followup' | 'gameday' | 'book' | 'book_followup' | 'finalize';

export interface TaskAlert {
  /** "sessionId:alertId": sent at most once. */
  key: string;
  id: AlertId;
  dueMs: number;
  text: string;
}

export type TaskKind = 'cancel' | 'night' | 'book' | 'finalize';

export interface Task {
  /** "kind:sessionId" */
  id: string;
  kind: TaskKind;
  sessionId: string;
  startsAt: string;
  /** The words on the card, the same words the Telegram message starts with. */
  text: string;
  /** One-step tasks: the buttons. */
  buttons: TaskButton[];
  /** Checklist tasks: the steps, in order. */
  steps: TaskStep[];
  /** Telegram messages this task could send now, if their time has come. */
  alerts: TaskAlert[];
}

export interface TaskLinks {
  admin: string;
  book: string;
  cancel: string;
  /** The direct text link for the night-before text, when there is one. */
  go?: (sessionId: string) => string | null;
}

export interface TaskOptions {
  tz: string;
  bookingLeadDays: number;
  defaultDeadlineHours: number;
  links: TaskLinks;
}

/** A missed tick still sends an alert that came due within this long. */
export const CATCH_UP_MS = 60 * 60_000;

const MIN_MS = 60_000;

// ---------- When things happen ----------
// Every time comes from the game's own start, end and cancellation deadline
// (default 12 hours before play, editable per booking). Nothing assumes an
// 8:00 PM or 7:00 PM game. "Before" is counted on the wall clock in the
// group's time zone, so a game the day after a clock change still gets its
// last call at the same clock time (6:00 PM for a 7:00 PM game).

/** Night-before last call (card and alert): this long before the start. 7:00 PM game: 6:00 PM the day before. */
export const NIGHT_LAST_CALL_BEFORE_START_MIN = 25 * 60;
/** Cancel warning when under 4: this long before the cancellation deadline. 7:00 AM deadline: 9:00 PM the night before. */
export const CANCEL_WARNING_BEFORE_DEADLINE_MIN = 10 * 60;
/** The cancel follow-up ("court canceled? Now cancel the session"): this long after the cancel warning. */
export const CANCEL_FOLLOWUP_AFTER_WARNING_MIN = 30;
/** Game-day check: this long before the cancellation deadline. 7:00 AM deadline: 6:15 AM. */
export const GAMEDAY_CHECK_BEFORE_DEADLINE_MIN = 45;
/** Finalize alert: this long after the game ends. */
export const FINALIZE_AFTER_END_MIN = 5;
/** Booking-day alert: this clock time on the day the court opens (the only fixed time: courts open by date). */
export const BOOKING_ALERT_TIME = { hour: 8, minute: 30 };
/** Booking-day follow-up: this clock time, if still not booked. */
export const BOOKING_FOLLOWUP_TIME = { hour: 10, minute: 30 };

/** The same wall-clock time shifted by `minutes` (negative: earlier), in the group's time zone. */
export function wallShift(ms: number, tz: string, minutes: number): number {
  const p = localParts(ms, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) + minutes * MIN_MS);
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), tz);
}


/** When the night-before card opens and its alert is due. */
export function nightLastCallMs(startsAt: string, tz: string): number {
  return wallShift(Date.parse(startsAt), tz, -NIGHT_LAST_CALL_BEFORE_START_MIN);
}

/** The cancellation deadline: the game's own, or the default hours before play. */
export function deadlineMsOf(s: Pick<TaskSession, 'startsAt' | 'cancellationDeadlineAt'>, defaultDeadlineHours: number): number {
  return s.cancellationDeadlineAt ? Date.parse(s.cancellationDeadlineAt) : Date.parse(s.startsAt) - defaultDeadlineHours * 3600_000;
}

/** All of a game's task times, for the card, the alerts and the tests. */
export function taskTimes(s: Pick<TaskSession, 'startsAt' | 'endsAt' | 'cancellationDeadlineAt'>, o: Pick<TaskOptions, 'tz' | 'defaultDeadlineHours' | 'bookingLeadDays'>) {
  const deadline = deadlineMsOf(s, o.defaultDeadlineHours);
  const cancelWarning = wallShift(deadline, o.tz, -CANCEL_WARNING_BEFORE_DEADLINE_MIN);
  return {
    nightLastCall: nightLastCallMs(s.startsAt, o.tz),
    deadline,
    cancelWarning,
    cancelFollowup: cancelWarning + CANCEL_FOLLOWUP_AFTER_WARNING_MIN * MIN_MS,
    gamedayCheck: wallShift(deadline, o.tz, -GAMEDAY_CHECK_BEFORE_DEADLINE_MIN),
    finalize: Date.parse(s.endsAt) + FINALIZE_AFTER_END_MIN * MIN_MS,
    booking: dayAt(s.startsAt, o.tz, -o.bookingLeadDays, BOOKING_ALERT_TIME.hour, BOOKING_ALERT_TIME.minute),
    bookingFollowup: dayAt(s.startsAt, o.tz, -o.bookingLeadDays, BOOKING_FOLLOWUP_TIME.hour, BOOKING_FOLLOWUP_TIME.minute),
  };
}


/** A wall-clock time on the calendar day `offset` days from the game's date. */
export function dayAt(startsAt: string, tz: string, offset: number, hour: number, minute = 0): number {
  const p = localParts(Date.parse(startsAt), tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
}

function sameDay(aMs: number, bMs: number, tz: string): boolean {
  const a = localParts(aMs, tz);
  const b = localParts(bMs, tz);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** "Tonight" on game day (from 5:00 PM games; "Today" for earlier ones), else "Tuesday". */
export function dayLabel(startsAt: string, nowMs: number, tz: string): string {
  const start = Date.parse(startsAt);
  if (sameDay(start, nowMs, tz)) return localParts(start, tz).hour >= 17 ? 'Tonight' : 'Today';
  return formatWeekday(startsAt, tz);
}

const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

/** "3 players in, need a 4th." / "5 players in." */
export function countLine(n: number): string {
  if (n >= MIN_PLAYERS) return `${players(n)} in.`;
  if (n === MIN_PLAYERS - 1) return `${players(n)} in, need a 4th.`;
  if (n === 0) return `No one in yet, need ${MIN_PLAYERS}.`;
  return `${players(n)} in, need ${MIN_PLAYERS - n} more.`;
}

/** "only 3 players in." / "no one in." */
function shortLine(n: number): string {
  return n === 0 ? 'no one in.' : `only ${players(n)} in.`;
}


function alertIf(list: TaskAlert[], s: TaskSession, id: AlertId, dueMs: number, text: string) {
  list.push({ key: `${s.id}:${id}`, id, dueMs, text });
}

/** The night-before text card and its Telegram alert: from the last call (25 hours before the start) until the game starts. */
function nightTask(s: TaskSession, nowMs: number, marks: Marks, o: TaskOptions): Task | null {
  const start = Date.parse(s.startsAt);
  const opens = nightLastCallMs(s.startsAt, o.tz);
  if (s.canceled || nowMs >= start || nowMs < opens) return null;
  if (marks.has(markKey(s.id, 'night_text'))) return null;
  const n = s.confirmedCount;
  const under = n < MIN_PLAYERS;
  const text = `${dayLabel(s.startsAt, nowMs, o.tz)}: ${countLine(n)}`;
  const label = under ? 'Text the group' : 'Text the group to confirm';
  const alerts: TaskAlert[] = [];
  const link = o.links.go?.(s.id) ?? o.links.admin;
  alertIf(alerts, s, 'night', opens, `${text} ${label}: ${link}`);
  return {
    id: `night:${s.id}`,
    kind: 'night',
    sessionId: s.id,
    startsAt: s.startsAt,
    text,
    buttons: [{ id: 'text', label, action: { type: 'text', text: under ? 'need' : 'checkin', mark: 'night_text' } }],
    steps: [],
    alerts,
  };
}

/**
 * Under 4 at the cancel warning (10 hours before the cancellation deadline): the three-step cancel checklist
 * (cancel the court, cancel the session, text everyone), until the game
 * starts or every step is done. A game canceled during this time keeps its
 * card until the canceled text is sent.
 */
function cancelTask(s: TaskSession, nowMs: number, marks: Marks, o: TaskOptions): Task | null {
  const start = Date.parse(s.startsAt);
  const times = taskTimes(s, o);
  const opens = times.cancelWarning;
  if (nowMs >= start || nowMs < opens) return null;
  const courtDone = marks.has(markKey(s.id, 'court_canceled'));
  const textDone = marks.has(markKey(s.id, 'canceled_text'));
  const n = s.confirmedCount;
  if (s.canceled) {
    const startedHere = courtDone || (s.canceledAt !== null && Date.parse(s.canceledAt) >= opens);
    if (!startedHere || textDone) return null;
  } else if (n >= MIN_PLAYERS) {
    return null;
  }
  const day = dayLabel(s.startsAt, nowMs, o.tz);
  const deadline = times.deadline;
  const gameDay = sameDay(start, nowMs, o.tz);
  const beforeDeadline = nowMs < deadline;
  const lead = `${day}: ${shortLine(n)}`;
  // On game day, before the deadline, the card names it: "Cancel court before 8:00 AM."
  const text = s.booked && gameDay && beforeDeadline && !courtDone ? `${lead} Cancel court before ${formatTime(new Date(deadline).toISOString(), o.tz)}.` : lead;
  const steps: TaskStep[] = [];
  if (s.booked || courtDone) {
    steps.push({
      id: 'court',
      label: 'Cancel the court',
      done: courtDone,
      enabled: true,
      buttons: [
        { id: 'court-link', label: 'Cancel the court', action: { type: 'link', href: o.links.cancel } },
        { id: 'court-done', label: 'Court canceled', action: { type: 'mark', mark: 'court_canceled' } },
      ],
    });
  }
  steps.push({ id: 'session', label: 'Cancel the session', done: s.canceled, enabled: true, buttons: [{ id: 'cancel', label: 'Cancel the session', action: { type: 'cancel' } }] });
  steps.push({
    id: 'text',
    label: "Text everyone it's canceled",
    done: textDone,
    enabled: s.canceled,
    buttons: [{ id: 'canceled-text', label: "Text everyone it's canceled", action: { type: 'text', text: 'canceled', mark: 'canceled_text' } }],
  });
  const alerts: TaskAlert[] = [];
  if (!s.canceled) {
    if (s.booked && !courtDone) alertIf(alerts, s, 'cancel', opens, `${lead} Cancel court: ${o.links.cancel}`);
    else if (!s.booked) alertIf(alerts, s, 'cancel', opens, `${lead} Cancel the session: ${o.links.admin}`);
    if (s.booked) alertIf(alerts, s, 'cancel_followup', times.cancelFollowup, `${day}: court canceled? Now cancel the session and text everyone: ${o.links.admin}`);
    if (s.booked && !courtDone && beforeDeadline) {
      alertIf(alerts, s, 'gameday', times.gamedayCheck, `${text.replace(/\.$/, '')}: ${o.links.cancel}`);
    }
  }
  return { id: `cancel:${s.id}`, kind: 'cancel', sessionId: s.id, startsAt: s.startsAt, text, buttons: [], steps, alerts };
}

/** Booking day: from the booking alert time (8:30 AM) on the day the court opens (14 days before) until it is marked booked. */
function bookTask(s: TaskSession, nowMs: number, o: TaskOptions): Task | null {
  if (s.canceled || !s.needsBooking || nowMs >= Date.parse(s.startsAt)) return null;
  const times = taskTimes(s, o);
  const opens = times.booking;
  if (nowMs < opens) return null;
  const text = `${textDay(s.startsAt, o.tz)} opened${s.holiday ? ` (${s.holiday})` : ''}.`;
  const alerts: TaskAlert[] = [];
  const msg = `${text} Book now: ${o.links.book}\nThen tap I booked it: ${o.links.admin}`;
  alertIf(alerts, s, 'book', opens, msg);
  alertIf(alerts, s, 'book_followup', times.bookingFollowup, `Reminder: ${msg}`);
  return {
    id: `book:${s.id}`,
    kind: 'book',
    sessionId: s.id,
    startsAt: s.startsAt,
    text,
    buttons: [
      { id: 'book-link', label: 'Book on CourtReserve', action: { type: 'link', href: o.links.book } },
      { id: 'booked', label: 'I booked it', action: { type: 'booked' } },
    ],
    steps: [],
    alerts,
  };
}

/**
 * After a game that was played (4 or more, not canceled): "Finalize who
 * played", from 5 minutes after it ends until it is finalized. The post-game
 * note then comes from the existing "Final price" text card on Home.
 */
function finalizeTask(s: TaskSession, nowMs: number, o: TaskOptions): Task | null {
  if (s.canceled || s.finalized || s.confirmedCount < MIN_PLAYERS) return null;
  const due = taskTimes(s, o).finalize;
  if (nowMs < due) return null;
  const text = `${formatWeekday(s.startsAt, o.tz)}: finalize who played.`;
  const alerts: TaskAlert[] = [];
  alertIf(alerts, s, 'finalize', due, `${text.replace(/\.$/, '')}: ${o.links.admin}`);
  return {
    id: `finalize:${s.id}`,
    kind: 'finalize',
    sessionId: s.id,
    startsAt: s.startsAt,
    text,
    buttons: [{ id: 'finalize', label: 'Finalize who played', action: { type: 'finalize' } }],
    steps: [],
    alerts,
  };
}

/** Rank: cancel, a court that opened today, night text, finalize, then courts that opened on an earlier day. */
function rank(t: Task, nowMs: number, o: TaskOptions): number {
  if (t.kind === 'book') return sameDay(dayAt(t.startsAt, o.tz, -o.bookingLeadDays, 12), nowMs, o.tz) ? 1 : 4;
  return { cancel: 0, night: 2, finalize: 3 }[t.kind];
}

/**
 * Every open task right now, most urgent first: cancel checklists, a court
 * that opened today, night-before texts, games to finalize, then courts that
 * opened earlier and are still not booked (soonest game first within each).
 * Refund requests are not here: they keep their own card and alert.
 */
export function nextTasks(nowMs: number, sessions: TaskSession[], marks: Marks, o: TaskOptions): Task[] {
  const out: Task[] = [];
  for (const s of sessions) {
    for (const t of [cancelTask(s, nowMs, marks, o), bookTask(s, nowMs, o), nightTask(s, nowMs, marks, o), finalizeTask(s, nowMs, o)]) {
      if (t) out.push(t);
    }
  }
  return out.sort((a, b) => rank(a, nowMs, o) - rank(b, nowMs, o) || Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The alerts to send on this tick: due within the catch-up window and not sent yet. */
export function dueAlerts(tasks: Task[], nowMs: number, sent: ReadonlySet<string>): TaskAlert[] {
  return tasks.flatMap((t) => t.alerts).filter((a) => a.dueMs <= nowMs && nowMs < a.dueMs + CATCH_UP_MS && !sent.has(a.key));
}
