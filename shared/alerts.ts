// Telegram alerts to the organizer: which roster changes are worth a
// message, and the message itself. Names and the game time only: never a
// phone number or money.
import { MAX_PLAYERS, MIN_PLAYERS } from './spots';
import { formatTime } from './time';

/** The organizer's switches. All on unless turned off in Settings > Alerts. */
export interface AlertPrefs {
  enabled: boolean;
  /** Anyone dropping out within 36 hours of the start. */
  drop36: boolean;
  /** Falling below 4 (4 to 3), or 6 down to 5. */
  belowMin: boolean;
  /** Reaching 6, so the organizer can text the two who moved in. */
  reachedSix: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { enabled: true, drop36: true, belowMin: true, reachedSix: true };

export const DROP_WINDOW_MS = 36 * 3600_000;

export interface AlertPerson {
  playerId: string;
  name: string;
}

export interface AlertInput {
  /** The player whose tap this was. */
  actor: AlertPerson;
  /** Confirmed players, in order, just before and just after the tap. */
  before: AlertPerson[];
  after: AlertPerson[];
  startsAt: string;
  /** The game's cancellation deadline (its own, or 12 hours before). */
  deadlineMs: number;
  nowMs: number;
  timezone: string;
  prefs: AlertPrefs;
}

/** "Thu Nov 5, 8:00 PM" */
export function alertWhen(iso: string, tz: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(iso));
  const part = (t: string) => day.find((p) => p.type === t)?.value ?? '';
  return `${part('weekday')} ${part('month')} ${part('day')}, ${formatTime(iso, tz)}`;
}

/** "45 min", "1 hr", "9 hrs", "3 days" */
export function alertLead(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 48) return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
  return `${Math.floor(hrs / 24)} days`;
}

function names(list: AlertPerson[]): string {
  const n = list.map((p) => p.name);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * The one message for this tap, or null when nothing is worth a ping.
 * Several reasons at once (a late drop that also leaves 3) make one message.
 */
export function alertMessage(a: AlertInput): string | null {
  if (!a.prefs.enabled) return null;
  const start = Date.parse(a.startsAt);
  const left = start - a.nowMs;
  if (left <= 0) return null;
  const was = new Set(a.before.map((p) => p.playerId));
  const now = new Set(a.after.map((p) => p.playerId));
  const dropped = was.has(a.actor.playerId) && !now.has(a.actor.playerId);
  const b = a.before.length;
  const n = a.after.length;

  const dropSoon = a.prefs.drop36 && dropped && left <= DROP_WINDOW_MS;
  const short = a.prefs.belowMin && ((b >= MIN_PLAYERS && n < MIN_PLAYERS) || (b === MAX_PLAYERS && n === MAX_PLAYERS - 1));
  const six = a.prefs.reachedSix && b < MAX_PLAYERS && n === MAX_PLAYERS;
  if (!dropSoon && !short && !six) return null;

  const when = alertWhen(a.startsAt, a.timezone);
  const newlyIn = a.after.filter((p) => !was.has(p.playerId));
  const lines: string[] = [];
  if (dropped) {
    const late = a.nowMs >= a.deadlineMs ? 'Late drop: ' : '';
    lines.push(`${late}${a.actor.name} dropped out of ${when} (${alertLead(left)} before).`);
    if (newlyIn.length) lines.push(`${names(newlyIn)} moved up from the waitlist.`);
    lines.push(n === MIN_PLAYERS || n === MAX_PLAYERS ? `${n} in now.` : `${n} in now, need 4 or 6.`);
  }
  if (six) lines.push(`${when} has 6 now. Text ${names(newlyIn)}, they're in.`);
  return lines.length ? lines.join(' ') : null;
}
