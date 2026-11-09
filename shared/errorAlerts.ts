// Zip 21: ERROR_ALERTS, ships OFF. A short Telegram to Alex (his existing bot and chat) when something on the site goes wrong:
//  1. the 5-minute clock's tick fails (which job),
//  2. the weekly backup fails or ends INCOMPLETE,
//  3. the database fails (its free daily limit, or repeated database errors) or the site answers a burst of server errors,
//  4. the clock stopped: no tick reached the site for 20 minutes or more (said on the next tick that does run).
// Anti-spam: at most one message per kind an hour and 6 a day (Eastern days); anything held back is counted and said once, as
// "N more errors in the last hour", at the next allowed time. A failed send is never itself an error alert.
//
// Everything the alerts remember (last sent per kind, today's count, the held-back count, the clock's last tick) lives in one small
// record in the "error box" (worker/box.ts, a free Cloudflare Durable Object), never in the site's database: no database writes, and
// it still works when the database is over its daily limit. `boxStep` below is that record's whole rule book, so it is tested here.
//
// The words: short, plain, Eastern 12-hour time, no stack traces, no secrets, no names or phone numbers.

import { localParts } from './time';

export const ERROR_ALERTS = { task: 'error_alerts_on', env: 'ERROR_ALERTS', name: 'Error alerts' } as const;

/** The Eastern clock every message uses (the site's group time zone; fixed here so a message can go out with the database down). */
export const ALERT_TZ = 'America/Detroit';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const LIMITS = {
  /** One message of a kind per this long. */
  perKindMs: HOUR,
  /** And this many messages in all per Eastern day (the "N more" summary counts as one). */
  perDay: 6,
  /** No tick reached the site for this long: "the clock stopped". */
  gapMs: 20 * MIN,
  /**
   * A longer gap is not reported: it almost always means the alerts themselves were paused (the kill switch, a missing secret), not
   * the clock. The watch starts fresh instead.
   */
  maxGapMs: 12 * HOUR,
  /** The weekly backup is retried every hour on Sunday: one message about it a day is enough (it would use up the day's 6). */
  backupEveryMs: 24 * HOUR,
} as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function errorAlertsAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

export type ErrorKind = 'clock' | 'backup' | 'database' | 'server_errors' | 'clock_stopped';
export const ERROR_KINDS: readonly ErrorKind[] = ['clock', 'backup', 'database', 'server_errors', 'clock_stopped'];
type SlotKind = ErrorKind | 'summary';

// ---------- the error box's record and its rules ----------

export interface BoxState {
  /** The Settings switch as the box last heard it (from the switch itself, or the next tick). */
  on: boolean;
  /** When the clock's tick last reached the site (ms), while on. */
  hb: number | null;
  /** When each kind was last sent. */
  sent: Partial<Record<SlotKind, number>>;
  /** When any message was last sent. */
  lastAny: number | null;
  /** The Eastern day `count` is for (YYYY-MM-DD). */
  day: string;
  count: number;
  /** Errors held back since the last message, and when the first of them happened. */
  pending: number;
  pendingSince: number | null;
}

export function emptyBox(): BoxState {
  return { on: false, hb: null, sent: {}, lastAny: null, day: '', count: 0, pending: 0, pendingSince: null };
}

export type BoxOp =
  /** The Settings switch changed (or a tick saw it). Turning on starts the clock watch fresh, so it never reports a gap from before. */
  | { op: 'sync'; on: boolean }
  /**
   * A tick reached the site: note it, and say whether the clock had stopped and whether a summary is due. `seen`: the tick read the
   * switch as on (that also tells a box that missed the switch going on). Without it (the database is down) the box's own copy decides.
   */
  | { op: 'tick'; seen?: boolean }
  /** Something went wrong: may a message about it go out now? */
  | { op: 'ask'; kind: ErrorKind };

/** What one held-back count looks like when it rides along on a message (or goes on its own). */
export interface Extra {
  n: number;
  since: number;
}

export type BoxOut =
  | { op: 'sync'; on: boolean }
  | { op: 'tick'; gap: { from: number; to: number; extra: Extra | null } | null; summary: Extra | null }
  | { op: 'ask'; send: boolean; off?: true; extra: Extra | null };

export function easternDay(ms: number): string {
  const p = localParts(ms, ALERT_TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function rollDay(s: BoxState, nowMs: number): void {
  const day = easternDay(nowMs);
  if (s.day !== day) {
    s.day = day;
    s.count = 0;
  }
}

function canSend(s: BoxState, kind: SlotKind, nowMs: number): boolean {
  rollDay(s, nowMs);
  if (s.count >= LIMITS.perDay) return false;
  const last = s.sent[kind];
  return last === undefined || nowMs - last >= (kind === 'backup' ? LIMITS.backupEveryMs : LIMITS.perKindMs);
}

/** Take a slot and hand over whatever was held back (it rides along on this message). */
function take(s: BoxState, kind: SlotKind, nowMs: number): Extra | null {
  s.count++;
  s.sent[kind] = nowMs;
  s.lastAny = nowMs;
  const extra = s.pending > 0 ? { n: s.pending, since: s.pendingSince ?? nowMs } : null;
  s.pending = 0;
  s.pendingSince = null;
  return extra;
}

function holdBack(s: BoxState, nowMs: number): void {
  s.pending++;
  if (s.pendingSince === null) s.pendingSince = nowMs;
}

/** The error box's whole rule book: one step on a copy of the record. Pure, so it is tested without Cloudflare. */
export function boxStep(state: BoxState, op: BoxOp, nowMs: number): { state: BoxState; out: BoxOut } {
  const s: BoxState = { ...emptyBox(), ...state, sent: { ...(state.sent ?? {}) } };
  if (op.op === 'sync') {
    if (op.on) {
      // A fresh start every time the switch is set on: nothing from before is reported (no old gap, no old held-back count).
      s.hb = nowMs;
      s.pending = 0;
      s.pendingSince = null;
    }
    s.on = op.on;
    return { state: s, out: { op: 'sync', on: s.on } };
  }
  if (op.op === 'tick') {
    if (!s.on) {
      if (!op.seen) return { state: s, out: { op: 'tick', gap: null, summary: null } };
      // The tick read the switch as on and the box missed it: a fresh start, as at the switch.
      s.on = true;
      s.hb = nowMs;
      s.pending = 0;
      s.pendingSince = null;
      return { state: s, out: { op: 'tick', gap: null, summary: null } };
    }
    const prev = s.hb;
    s.hb = nowMs;
    let gap: { from: number; to: number; extra: Extra | null } | null = null;
    if (prev !== null && nowMs - prev >= LIMITS.gapMs && nowMs - prev <= LIMITS.maxGapMs) {
      if (canSend(s, 'clock_stopped', nowMs)) gap = { from: prev, to: nowMs, extra: take(s, 'clock_stopped', nowMs) };
      else holdBack(s, nowMs);
    }
    let summary: Extra | null = null;
    // Held-back errors are said at the next allowed time: an hour after the last message (and inside the day's 6).
    if (!gap && s.pending > 0 && (s.lastAny === null || nowMs - s.lastAny >= LIMITS.perKindMs) && canSend(s, 'summary', nowMs)) {
      summary = take(s, 'summary', nowMs);
    }
    return { state: s, out: { op: 'tick', gap, summary } };
  }
  if (!s.on) return { state: s, out: { op: 'ask', send: false, off: true, extra: null } };
  if (canSend(s, op.kind, nowMs)) return { state: s, out: { op: 'ask', send: true, extra: take(s, op.kind, nowMs) } };
  holdBack(s, nowMs);
  return { state: s, out: { op: 'ask', send: false, extra: null } };
}

// ---------- what went wrong ----------

/** Is this a database error, and is it the free daily limit? Only the error's own words are read; they never go into a message. */
export function errorClass(err: unknown): 'db_limit' | 'db' | 'other' {
  const text = err instanceof Error ? `${err.name} ${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err ?? '');
  const db = /\bD1\b|D1_|SQLITE|database/i.test(text);
  if (/limit/i.test(text) && /exceed|daily|reached|quota|over/i.test(text) && (db || /rows (read|written)/i.test(text))) return 'db_limit';
  return db ? 'db' : 'other';
}

/** Which job of the site's tick was running when it failed (said in the message). */
export type TickJob = 'game check' | 'smart alerts';

/** Server errors in one place before it is a "burst" (a single slow or failed request is never one). */
export const BURST = { errors: 5, dbErrors: 3, windowMs: 10 * MIN } as const;

// ---------- the words ----------

/** "3:05 AM", Eastern, with plain spaces (Telegram shows the narrow ones oddly on some phones). */
export function alertTime(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ALERT_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(/[  ]/g, ' ');
}

/** "Sun 3:05 PM" for a time on another Eastern day than `nowMs`, else "3:05 PM". */
function alertWhen(ms: number, nowMs: number): string {
  if (easternDay(ms) === easternDay(nowMs)) return alertTime(ms);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: ALERT_TZ, weekday: 'short' }).format(new Date(ms));
  return `${day} ${alertTime(ms)}`;
}

/** When the database's free daily limit resets: 00:00 UTC, said in Eastern time (7:00 PM in winter, 8:00 PM in summer). */
export function limitResetMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function extraLine(extra: Extra | null, nowMs: number): string {
  if (!extra || extra.n <= 0) return '';
  const what = extra.n === 1 ? '1 more error' : `${extra.n} more errors`;
  return nowMs - extra.since <= HOUR ? `${what} in the last hour.` : `${what} since ${alertWhen(extra.since, nowMs)}.`;
}

/** Every message ends the same way: the held-back count (if any), then the tappable way in. */
function finish(main: string, extra: Extra | null, nowMs: number, adminUrl: string): string {
  const more = extraLine(extra, nowMs);
  return `${main}${more ? ` ${more}` : ''} Tap to open Admin: ${adminUrl}`;
}

export const errorText = {
  /** Trigger 1. */
  clock: (job: TickJob | 'site check', atMs: number, extra: Extra | null, adminUrl: string, database = false) =>
    finish(
      job === 'site check'
        ? `Site error: the clock could not reach the site at ${alertTime(atMs)}.`
        : `Site error: the clock's ${job} job failed${database ? ' (a database error)' : ''} at ${alertTime(atMs)}.`,
      extra,
      atMs,
      adminUrl,
    ),
  /** Trigger 2. */
  backup: (incomplete: boolean, atMs: number, extra: Extra | null, adminUrl: string) =>
    finish(`Site error: the weekly backup ${incomplete ? 'ended INCOMPLETE' : 'failed'} at ${alertTime(atMs)}. It tries again in an hour.`, extra, atMs, adminUrl),
  /** Trigger 3: the database. */
  database: (limit: boolean, atMs: number, extra: Extra | null, adminUrl: string) =>
    finish(
      limit
        ? `Site error: the database hit its free daily limit at ${alertTime(atMs)}. The site is down until about ${alertTime(limitResetMs(atMs))}.`
        : `Site error: database errors on the site at ${alertTime(atMs)}.`,
      extra,
      atMs,
      adminUrl,
    ),
  /** Trigger 3: a burst of server errors. */
  serverErrors: (n: number, atMs: number, extra: Extra | null, adminUrl: string) =>
    finish(`Site error: ${n} server errors in ${BURST.windowMs / MIN} minutes at ${alertTime(atMs)}.`, extra, atMs, adminUrl),
  /** Trigger 4. */
  clockStopped: (fromMs: number, toMs: number, extra: Extra | null, adminUrl: string) => {
    const mins = Math.round((toMs - fromMs) / MIN);
    const h = Math.floor(mins / 60);
    const long = mins < 120 ? `${mins} minutes` : mins % 60 === 0 ? `${h} hours` : `${h} hours ${mins % 60} minutes`;
    return finish(`Site error: the clock stopped for ${long} (${alertWhen(fromMs, toMs)} to ${alertTime(toMs)}). It is running again.`, extra, toMs, adminUrl);
  },
  /** The held-back count on its own. */
  summary: (extra: Extra, nowMs: number, adminUrl: string) => `${extraLine(extra, nowMs)} Tap to open Admin: ${adminUrl}`,
  /** The Settings test button: clearly marked TEST. */
  test: (adminUrl: string) =>
    `TEST error alert from Pickleball Bros. Nothing is wrong. Real ones look like: "Site error: the weekly backup failed at 3:00 AM." Tap to open Admin: ${adminUrl}`,
};
