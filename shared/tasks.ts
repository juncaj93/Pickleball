// "Do this now": the organizer's open tasks, most urgent first. One pure
// function feeds both the card at the top of Home and the Telegram alerts,
// so the two can never disagree. Times are worked out in the group's time
// zone on the wall clock (never plain 24-hour math), so the November clock
// change is safe. No phone numbers, Venmo names or money ever go in here.
//
// Courts: CourtReserve opens each date 14 days ahead at 7:00 AM, and courts
// also open up later when people cancel. A game counts as having a court
// only once it is marked "court booked" (I booked it). Until then it gets no
// last call and no cancel warnings: only booking reminders.
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
  /** The court is marked booked ("I booked it"). */
  booked: boolean;
  /** When it was marked booked, if the site saw the tap (null: booked before this was tracked, or not booked). */
  bookedAt: string | null;
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

export type AlertId = 'night' | 'cancel' | 'cancel_followup' | 'gameday' | 'book' | 'book_followup' | 'nocourt' | 'finalize';

export interface TaskAlert {
  /** "sessionId:alertId": sent at most once. */
  key: string;
  id: AlertId;
  dueMs: number;
  text: string;
}

export type TaskKind = 'cancel' | 'book' | 'nocourt' | 'night' | 'finalize' | 'nocourt_later';

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
const HOUR_MS = 60 * MIN_MS;

// ---------- When things happen ----------
// Every game time comes from the game's own start, end and cancellation
// deadline (default 12 hours before play, editable per booking). Nothing
// assumes an 8:00 PM or 7:00 PM game. "Before" is counted on the wall clock
// in the group's time zone, so a game the day after a clock change still
// gets its last call at the same clock time (6:00 PM for a 7:00 PM game).

/** Night-before last call (card and alert): this long before the start. 7:00 PM game: 6:00 PM the day before. Booked games only. */
export const NIGHT_LAST_CALL_BEFORE_START_MIN = 25 * 60;
/** Cancel warning when under 4: this long before the cancellation deadline. 7:00 AM deadline: 9:00 PM the night before. Booked games only. */
export const CANCEL_WARNING_BEFORE_DEADLINE_MIN = 10 * 60;
/** The cancel follow-up ("court canceled? Now cancel the session"): this long after the cancel warning. */
export const CANCEL_FOLLOWUP_AFTER_WARNING_MIN = 30;
/** Game-day check: this long before the cancellation deadline. 7:00 AM deadline: 6:15 AM. Booked games only. */
export const GAMEDAY_CHECK_BEFORE_DEADLINE_MIN = 45;
/** Finalize alert: this long after the game ends. */
export const FINALIZE_AFTER_END_MIN = 5;
/** CourtReserve opens each date at this clock time, `bookingLeadDays` (14) days ahead. */
export const COURT_OPENS_TIME = { hour: 7, minute: 0 };
/** The booking heads-up: this long before the court opens (6:45 AM). Only for the game exactly 14 days out. */
export const BOOKING_HEADS_UP_BEFORE_OPEN_MIN = 15;
/** The one booking follow-up: this long after the court opens (7:30 AM), if still not booked. */
export const BOOKING_FOLLOWUP_AFTER_OPEN_MIN = 30;
/** Morning-of check for a game with 4 or more in and no court: this long after the cancellation deadline (7:15 AM for a 7:00 PM game). */
export const NO_COURT_CHECK_AFTER_DEADLINE_MIN = 15;
/** "Has no court yet" items for games without a court: at most this many, soonest first. */
export const NO_COURT_SHOWN = 2;

/** The same wall-clock time shifted by `minutes` (negative: earlier), in the group's time zone. */
export function wallShift(ms: number, tz: string, minutes: number): number {
  const p = localParts(ms, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) + minutes * MIN_MS);
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), tz);
}

/** A wall-clock time on the calendar day `offset` days from the game's date. */
export function dayAt(startsAt: string, tz: string, offset: number, hour: number, minute = 0): number {
  const p = localParts(Date.parse(startsAt), tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
}

/** When the night-before card opens and its alert is due. */
export function nightLastCallMs(startsAt: string, tz: string): number {
  return wallShift(Date.parse(startsAt), tz, -NIGHT_LAST_CALL_BEFORE_START_MIN);
}

/** The cancellation deadline: the game's own, or the default hours before play. */
export function deadlineMsOf(s: Pick<TaskSession, 'startsAt' | 'cancellationDeadlineAt'>, defaultDeadlineHours: number): number {
  return s.cancellationDeadlineAt ? Date.parse(s.cancellationDeadlineAt) : Date.parse(s.startsAt) - defaultDeadlineHours * HOUR_MS;
}

/** All of a game's task times, for the card, the alerts and the tests. */
export function taskTimes(s: Pick<TaskSession, 'startsAt' | 'endsAt' | 'cancellationDeadlineAt'>, o: Pick<TaskOptions, 'tz' | 'defaultDeadlineHours' | 'bookingLeadDays'>) {
  const deadline = deadlineMsOf(s, o.defaultDeadlineHours);
  const cancelWarning = wallShift(deadline, o.tz, -CANCEL_WARNING_BEFORE_DEADLINE_MIN);
  const courtOpens = dayAt(s.startsAt, o.tz, -o.bookingLeadDays, COURT_OPENS_TIME.hour, COURT_OPENS_TIME.minute);
  return {
    nightLastCall: nightLastCallMs(s.startsAt, o.tz),
    deadline,
    cancelWarning,
    cancelFollowup: cancelWarning + CANCEL_FOLLOWUP_AFTER_WARNING_MIN * MIN_MS,
    gamedayCheck: wallShift(deadline, o.tz, -GAMEDAY_CHECK_BEFORE_DEADLINE_MIN),
    noCourtCheck: deadline + NO_COURT_CHECK_AFTER_DEADLINE_MIN * MIN_MS,
    finalize: Date.parse(s.endsAt) + FINALIZE_AFTER_END_MIN * MIN_MS,
    courtOpens,
    bookingHeadsUp: courtOpens - BOOKING_HEADS_UP_BEFORE_OPEN_MIN * MIN_MS,
    bookingFollowup: courtOpens + BOOKING_FOLLOWUP_AFTER_OPEN_MIN * MIN_MS,
    /** The end of the day the court opens: the booking-day card shows until then. */
    bookingDayEnds: dayAt(s.startsAt, o.tz, -o.bookingLeadDays + 1, 0, 0),
  };
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

const timeOf = (ms: number, tz: string) => formatTime(new Date(ms).toISOString(), tz);

/**
 * An alert for a booked game is only due after the court was marked booked:
 * tapping I booked it late never sends alerts whose time already passed.
 */
function alertIf(list: TaskAlert[], s: TaskSession, id: AlertId, dueMs: number, text: string, afterBooking = false) {
  if (afterBooking && s.bookedAt && dueMs < Date.parse(s.bookedAt)) return;
  list.push({ key: `${s.id}:${id}`, id, dueMs, text });
}

interface Built extends Task {
  rank: number;
}

const bookedButton: TaskButton = { id: 'booked', label: 'I booked it', action: { type: 'booked' } };
const bookLink = (o: TaskOptions): TaskButton => ({ id: 'book-link', label: 'Book on CourtReserve', action: { type: 'link', href: o.links.book } });

/** "tonight", "today", "tomorrow" or "Thursday". */
function whenWord(startsAt: string, nowMs: number, tz: string): string {
  const start = Date.parse(startsAt);
  if (sameDay(start, nowMs, tz)) return localParts(start, tz).hour >= 17 ? 'tonight' : 'today';
  if (sameDay(start, wallShift(nowMs, tz, 24 * 60), tz)) return 'tomorrow';
  return formatWeekday(startsAt, tz);
}

/**
 * The night-before text card and its alert, booked games only: from the last
 * call (25 hours before the start) until the game starts. When the court was
 * booked after the last call already passed, a one-time "Court booked for
 * tonight" card instead (no Telegram).
 */
function nightTask(s: TaskSession, nowMs: number, marks: Marks, o: TaskOptions): Built | null {
  const start = Date.parse(s.startsAt);
  const opens = nightLastCallMs(s.startsAt, o.tz);
  if (!s.booked || s.canceled || nowMs >= start || nowMs < opens) return null;
  if (marks.has(markKey(s.id, 'night_text'))) return null;
  const base = { id: `night:${s.id}`, kind: 'night' as const, sessionId: s.id, startsAt: s.startsAt, steps: [], rank: 3 };
  if (s.bookedAt && Date.parse(s.bookedAt) >= opens) {
    return {
      ...base,
      text: `Court booked for ${whenWord(s.startsAt, nowMs, o.tz)}. Text the group the game is on.`,
      buttons: [{ id: 'text', label: 'Text the group', action: { type: 'text', text: 'checkin', mark: 'night_text' } }],
      alerts: [],
    };
  }
  const n = s.confirmedCount;
  const under = n < MIN_PLAYERS;
  const text = `${dayLabel(s.startsAt, nowMs, o.tz)}: ${countLine(n)}`;
  const label = under ? 'Text the group' : 'Text the group to confirm';
  const alerts: TaskAlert[] = [];
  const link = o.links.go?.(s.id) ?? o.links.admin;
  alertIf(alerts, s, 'night', opens, `${text} ${label}: ${link}`, true);
  return { ...base, text, buttons: [{ id: 'text', label, action: { type: 'text', text: under ? 'need' : 'checkin', mark: 'night_text' } }], alerts };
}

/**
 * Booked games under 4, from the cancel warning (10 hours before the
 * deadline): the three-step cancel checklist (cancel the court, cancel the
 * session, text everyone), until the game starts or every step is done. A
 * game canceled during this time keeps its card until the canceled text is sent.
 */
function cancelTask(s: TaskSession, nowMs: number, marks: Marks, o: TaskOptions): Built | null {
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
  } else if (!s.booked || n >= MIN_PLAYERS) {
    return null;
  }
  const day = dayLabel(s.startsAt, nowMs, o.tz);
  const deadline = times.deadline;
  const gameDay = sameDay(start, nowMs, o.tz);
  const beforeDeadline = nowMs < deadline;
  const lead = `${day}: ${shortLine(n)}`;
  // On game day, before the deadline, the card names it: "Cancel court before 7:00 AM."
  const text = !s.canceled && gameDay && beforeDeadline && !courtDone ? `${lead} Cancel court before ${timeOf(deadline, o.tz)}.` : lead;
  const steps: TaskStep[] = [
    {
      id: 'court',
      label: 'Cancel the court',
      done: courtDone,
      enabled: true,
      buttons: [
        { id: 'court-link', label: 'Cancel the court', action: { type: 'link', href: o.links.cancel } },
        { id: 'court-done', label: 'Court canceled', action: { type: 'mark', mark: 'court_canceled' } },
      ],
    },
    { id: 'session', label: 'Cancel the session', done: s.canceled, enabled: true, buttons: [{ id: 'cancel', label: 'Cancel the session', action: { type: 'cancel' } }] },
    {
      id: 'text',
      label: "Text everyone it's canceled",
      done: textDone,
      enabled: s.canceled,
      buttons: [{ id: 'canceled-text', label: "Text everyone it's canceled", action: { type: 'text', text: 'canceled', mark: 'canceled_text' } }],
    },
  ];
  const alerts: TaskAlert[] = [];
  if (!s.canceled) {
    if (!courtDone) alertIf(alerts, s, 'cancel', opens, `${lead} Cancel court: ${o.links.cancel}`, true);
    alertIf(alerts, s, 'cancel_followup', times.cancelFollowup, `${day}: court canceled? Now cancel the session and text everyone: ${o.links.admin}`, true);
    if (!courtDone && beforeDeadline) alertIf(alerts, s, 'gameday', times.gamedayCheck, `${text.replace(/\.$/, '')}: ${o.links.cancel}`, true);
  }
  return { id: `cancel:${s.id}`, kind: 'cancel', sessionId: s.id, startsAt: s.startsAt, text, buttons: [], steps, alerts, rank: 0 };
}

/**
 * Booking day: the game exactly 14 days out, from the heads-up (6:45 AM)
 * to the end of that day, while not booked. "Thu Nov 26 opens at 7:00 AM
 * (Thanksgiving)." Telegram at 6:45 AM, and once more at 7:30 AM.
 */
function bookTask(s: TaskSession, nowMs: number, o: TaskOptions): Built | null {
  if (s.canceled || s.booked || nowMs >= Date.parse(s.startsAt)) return null;
  const t = taskTimes(s, o);
  if (nowMs < t.bookingHeadsUp || nowMs >= t.bookingDayEnds) return null;
  const date = textDay(s.startsAt, o.tz);
  const holiday = s.holiday ? ` (${s.holiday})` : '';
  const opensAt = timeOf(t.courtOpens, o.tz);
  const text = `${date} ${nowMs < t.courtOpens ? 'opens' : 'opened'} at ${opensAt}${holiday}.`;
  const tail = `Book: ${o.links.book}\nThen tap I booked it: ${o.links.admin}`;
  const alerts: TaskAlert[] = [];
  alertIf(alerts, s, 'book', t.bookingHeadsUp, `${date} opens at ${opensAt}${holiday}. ${tail}`);
  alertIf(alerts, s, 'book_followup', t.bookingFollowup, `Reminder: ${date} opened at ${opensAt}${holiday}. ${tail}`);
  return { id: `book:${s.id}`, kind: 'book', sessionId: s.id, startsAt: s.startsAt, text, buttons: [bookLink(o), bookedButton], steps: [], alerts, rank: 1 };
}

/**
 * Morning of: a game with 4 or more in and no court, starting within 24
 * hours, from 15 minutes after its cancellation deadline (when courts others
 * gave up show up) until it starts. "Tonight: 5 in, no court yet."
 */
function noCourtTask(s: TaskSession, nowMs: number, o: TaskOptions): Built | null {
  const start = Date.parse(s.startsAt);
  if (s.canceled || s.booked || s.confirmedCount < MIN_PLAYERS || nowMs >= start) return null;
  const due = taskTimes(s, o).noCourtCheck;
  if (nowMs < due || start - nowMs > 24 * HOUR_MS) return null;
  const text = `${dayLabel(s.startsAt, nowMs, o.tz)}: ${s.confirmedCount} in, no court yet. Check CourtReserve for an opening.`;
  const alerts: TaskAlert[] = [];
  if (start - due <= 24 * HOUR_MS) alertIf(alerts, s, 'nocourt', due, `${text.replace(/\.$/, '')}: ${o.links.book}`);
  return { id: `nocourt:${s.id}`, kind: 'nocourt', sessionId: s.id, startsAt: s.startsAt, text, buttons: [bookLink(o), bookedButton], steps: [], alerts, rank: 2 };
}

/** After a game that was played (4 or more, not canceled): "Finalize who played", from 5 minutes after it ends until it is finalized. */
function finalizeTask(s: TaskSession, nowMs: number, o: TaskOptions): Built | null {
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
    rank: 4,
  };
}

/**
 * Every open task right now, most urgent first: cancel checklists, the court
 * that opens today, a game soon with players and no court, night-before
 * texts, games to finalize, then "has no court yet" for the next 2 games
 * without a court (soonest game first within each). Refund requests are not
 * here: they keep their own card and alert.
 */
export function nextTasks(nowMs: number, sessions: TaskSession[], marks: Marks, o: TaskOptions): Task[] {
  const out: Built[] = [];
  for (const s of sessions) {
    for (const t of [cancelTask(s, nowMs, marks, o), bookTask(s, nowMs, o), noCourtTask(s, nowMs, o), nightTask(s, nowMs, marks, o), finalizeTask(s, nowMs, o)]) {
      if (t) out.push(t);
    }
  }
  // The next games without a court whose date already opened to book: at most NO_COURT_SHOWN,
  // counting one that already has its booking-day or morning-of card.
  const noCourt = sessions
    .filter((s) => !s.canceled && !s.booked && Date.parse(s.startsAt) > nowMs && nowMs >= taskTimes(s, o).courtOpens)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, NO_COURT_SHOWN);
  for (const s of noCourt) {
    if (out.some((t) => t.sessionId === s.id && (t.kind === 'book' || t.kind === 'nocourt'))) continue;
    out.push({
      id: `nocourt_later:${s.id}`,
      kind: 'nocourt_later',
      sessionId: s.id,
      startsAt: s.startsAt,
      text: `${textDay(s.startsAt, o.tz)} has no court yet.`,
      buttons: [bookedButton],
      steps: [],
      alerts: [],
      rank: 5,
    });
  }
  return out.sort((a, b) => a.rank - b.rank || Date.parse(a.startsAt) - Date.parse(b.startsAt)).map(({ rank: _rank, ...t }) => t);
}

/** The alerts to send on this tick: due within the catch-up window and not sent yet. */
export function dueAlerts(tasks: Task[], nowMs: number, sent: ReadonlySet<string>): TaskAlert[] {
  return tasks.flatMap((t) => t.alerts).filter((a) => a.dueMs <= nowMs && nowMs < a.dueMs + CATCH_UP_MS && !sent.has(a.key));
}
