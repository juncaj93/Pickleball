// Telegram alerts to the organizer: which roster changes are worth a
// message, and the message itself. Names and the game time only: never a
// phone number, a Venmo name, or money (except the amount of a refund request).
import { MIN_PLAYERS } from './spots';
import { formatTime } from './time';

/** The organizer's switches. All on unless turned off in Settings > Alerts. */
export interface AlertPrefs {
  enabled: boolean;
  /** Anyone dropping out within 36 hours of the start. */
  drop36: boolean;
  /** A game falls below 4. */
  belowMin: boolean;
  /** A game reaches 4 (it's on). */
  reachedMin: boolean;
  /** A player asks for a refund of their credit. */
  refundRequests: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { enabled: true, drop36: true, belowMin: true, reachedMin: true, refundRequests: true };

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
  return `${alertDay(iso, tz)}, ${formatTime(iso, tz)}`;
}

/** "Thu Nov 5" */
export function alertDay(iso: string, tz: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).formatToParts(new Date(iso));
  const part = (t: string) => day.find((p) => p.type === t)?.value ?? '';
  return `${part('weekday')} ${part('month')} ${part('day')}`;
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
  const short = a.prefs.belowMin && b >= MIN_PLAYERS && n < MIN_PLAYERS;
  const on = a.prefs.reachedMin && b < MIN_PLAYERS && n >= MIN_PLAYERS;
  if (!dropSoon && !short && !on) return null;

  const when = alertWhen(a.startsAt, a.timezone);
  const newlyIn = a.after.filter((p) => !was.has(p.playerId));
  const lines: string[] = [];
  if (dropped) {
    const late = a.nowMs >= a.deadlineMs ? 'Late drop: ' : '';
    lines.push(`${late}${a.actor.name} dropped out of ${when} (${alertLead(left)} before).`);
    if (newlyIn.length) lines.push(`${names(newlyIn)} moved up from the waitlist.`);
    lines.push(n < MIN_PLAYERS ? `${n} in now, under ${MIN_PLAYERS}.` : `${n} in now.`);
  }
  if (on) lines.push(`${when} has ${n} now, it's on.`);
  return lines.length ? lines.join(' ') : null;
}

/** "Refund requested: Mitchel wants $14 back." (the only alert that names an amount) */
export function refundRequestMessage(name: string, cents: number): string {
  return `Refund requested: ${name} wants $${Math.floor(cents / 100)} back.`;
}

/**
 * A player put their pending cash out toward a game instead (the "Use it"
 * prompt at sign-up). First name, amounts and the day only:
 * "Mitchel withdrew the $10 cash out request (using it for Thu Nov 5)", or for
 * part of it "Mitchel withdrew $4 of the $10 cash out request (using it for Thu Nov 5)".
 */
export function cashOutUsedMessage(name: string, usedCents: number, requestCents: number, startsAt: string, tz: string): string {
  const first = name.trim().split(/\s+/)[0] || 'A player';
  const day = new Date(startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).replace(/,/g, '');
  const dollars = (c: number) => `$${Math.floor(c / 100)}`;
  const what = usedCents >= requestCents ? `the ${dollars(requestCents)}` : `${dollars(usedCents)} of the ${dollars(requestCents)}`;
  return `${first} withdrew ${what} cash out request (using it for ${day})`;
}
