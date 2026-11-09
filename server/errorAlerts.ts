// Zip 21: ERROR_ALERTS (shared/errorAlerts.ts), ships OFF. The site's side of the error alerts.
//
// On only when ALL of these hold:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy),
//  - the error box is bound (ERROR_BOX, worker/box.ts) and Telegram is connected (the same bot and chat as every alert),
//  - the organizer switched it on in Settings > Feature switches. That row is one task_log row (kind 'mark', no game), the same as
//    every other switch, and the box keeps a copy (told by the switch itself and again by every tick that runs while it is on), so
//    the alerts know the switch even while the database is down.
// There is no per-phone test link (an alert goes to Alex's Telegram, not to a phone screen): the Settings test button is the test.
//
// Never slower, never broken: every send and every box call runs after the answer (waitUntil), with a short timeout, and every
// failure is swallowed and logged once per Worker run. A failed send is never itself reported. Writes nothing to the database.

import { BURST, errorAlertsAllowed, errorClass, ERROR_ALERTS, errorText, type BoxOp, type BoxOut, type ErrorKind, type Extra, type TickJob } from '../shared/errorAlerts';
import { connected } from './alerts';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { newId } from './crypto';
import type { D1Database, Env } from './db';
import { HttpError } from './http';
import { isPretend } from './pretend';
import { linkText } from './telegram-links';
import * as v from './validate';

/** The error box binding: a Durable Object namespace (only what the site uses). */
export interface ErrorBoxNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";
const BOX_TIMEOUT_MS = 3000;
const SEND_TIMEOUT_MS = 5000;

/** The kill switch allows it, the box is bound, and Telegram is connected. Without all three nothing here ever runs. */
export function errorAlertsReady(env: Env): boolean {
  return errorAlertsAllowed(env.ERROR_ALERTS) && !!env.ERROR_BOX && connected(env) && !env.SANDBOX;
}

/** The Settings row (every phone). */
export async function errorAlertsForAll(db: D1Database, groupId: string): Promise<boolean> {
  return !!(await db.prepare(SWITCH_READ).bind(groupId, ERROR_ALERTS.task).first().catch(() => null));
}

/** The task_log question the tick adds to its one trip (only while ready), for the group the tick reads. */
export const tickSwitchSql = (theGroup: string) =>
  `SELECT 1 AS x FROM task_log WHERE group_id = ${theGroup} AND session_id IS NULL AND task = '${ERROR_ALERTS.task}' AND kind = 'mark' LIMIT 1`;

// ---------- logging once ----------

const logged = new Set<string>();
/** One log line per problem per Worker run (a broken Telegram or box can't flood the logs). */
function logOnce(key: string, line: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  console.log(line);
}

// ---------- the box ----------

/** One step of the box's record (shared/errorAlerts.ts boxStep). Null when the box can't be reached (logged once). */
export async function boxCall(env: Env, op: BoxOp, nowMs: number): Promise<BoxOut | null> {
  const ns = env.ERROR_BOX;
  if (!ns) return null;
  try {
    const stub = ns.get(ns.idFromName('errors'));
    const res = await stub.fetch(
      new Request('https://error-box/step', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...op, nowMs }), signal: AbortSignal.timeout(BOX_TIMEOUT_MS) }),
    );
    if (!res.ok) throw new Error(`box answered ${res.status}`);
    return (await res.json()) as BoxOut;
  } catch (err) {
    logOnce('box', `error alerts: the error box failed (${err instanceof Error ? err.message : 'unknown'})`);
    return null;
  }
}

// ---------- sending ----------

export function adminUrlOf(env: Env, url: URL): string {
  return `${(env.SITE_URL || url.origin).replace(/\/$/, '')}/admin`;
}

/** One message to Alex's chat. "Tap to open Admin" is the tappable link to /admin. Never throws; a failure is logged once, never alerted. */
export async function sendErrorTelegram(env: Env, adminUrl: string, text: string): Promise<boolean> {
  try {
    const linked = linkText(text, () => false, (u) => u === adminUrl);
    const doFetch = env.TELEGRAM_FETCH ?? fetch;
    const res = await doFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: linked.text, ...(linked.entities.length ? { entities: linked.entities } : {}), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Telegram answered ${res.status}`);
    return true;
  } catch (err) {
    logOnce('send', `error alerts: a Telegram send failed (${err instanceof Error && err.name !== 'Error' ? err.name : err instanceof Error ? err.message : 'unknown'})`);
    return false;
  }
}

/** What to say for one kind, given its facts. */
export type ErrorFacts =
  | { kind: 'clock'; job: TickJob | 'site check'; database?: boolean }
  | { kind: 'backup'; incomplete: boolean }
  | { kind: 'database'; limit: boolean }
  | { kind: 'server_errors'; n: number };

function textFor(f: ErrorFacts, nowMs: number, extra: Extra | null, adminUrl: string): string {
  if (f.kind === 'clock') return errorText.clock(f.job, nowMs, extra, adminUrl, f.database === true);
  if (f.kind === 'backup') return errorText.backup(f.incomplete, nowMs, extra, adminUrl);
  if (f.kind === 'database') return errorText.database(f.limit, nowMs, extra, adminUrl);
  return errorText.serverErrors(f.n, nowMs, extra, adminUrl);
}

/** Ask the box, and send if it says yes. Never throws. Returns what was sent (tests), or null. */
export async function reportError(env: Env, url: URL, nowMs: number, facts: ErrorFacts): Promise<string | null> {
  try {
    if (!errorAlertsReady(env)) return null;
    const out = await boxCall(env, { op: 'ask', kind: facts.kind as ErrorKind }, nowMs);
    if (!out || out.op !== 'ask') return null;
    if (out.off) offUntil = nowMs + OFF_MEMORY_MS;
    if (!out.send) return null;
    const text = textFor(facts, nowMs, out.extra, adminUrlOf(env, url));
    await sendErrorTelegram(env, adminUrlOf(env, url), text);
    return text;
  } catch {
    return null;
  }
}

// ---------- the clock's tick (server/tasks.ts) ----------

/** What the tick tells this file as it goes: whether the switch is on (null until read) and which job is running. */
export interface TickWatch {
  ready: boolean;
  on: boolean | null;
  job: TickJob;
}

export function tickWatch(env: Env): TickWatch {
  return { ready: errorAlertsReady(env), on: null, job: 'game check' };
}

/** When this Worker run last told the box "off" (a tick that read the switch as off). */
let offToldAt = 0;
const OFF_TELL_EVERY_MS = 60 * 60_000;

/**
 * A tick reached the site. On: note it with the box, then say "the clock stopped" or the held-back count if due. Off: about once an
 * hour per Worker run, tell the box "off" too (after the answer), so a box left on (a backup restore empties the switch row) can never
 * send while Settings shows off.
 */
export function afterTick(ctx: Ctx, watch: TickWatch): void {
  if (!watch.ready || watch.on === null) return;
  if (watch.on) {
    ctx.waitUntil(tickWork(ctx.env, ctx.url, ctx.nowMs).catch(() => null));
    return;
  }
  if (offToldAt && ctx.nowMs - offToldAt < OFF_TELL_EVERY_MS && ctx.nowMs >= offToldAt) return;
  offToldAt = ctx.nowMs;
  ctx.waitUntil(boxCall(ctx.env, { op: 'sync', on: false }, ctx.nowMs).catch(() => null));
}

export async function tickWork(env: Env, url: URL, nowMs: number, seen = true): Promise<string[]> {
  const sent: string[] = [];
  const adminUrl = adminUrlOf(env, url);
  const out = await boxCall(env, seen ? { op: 'tick', seen: true } : { op: 'tick' }, nowMs);
  if (!out || out.op !== 'tick') return sent;
  if (out.gap) {
    const text = errorText.clockStopped(out.gap.from, out.gap.to, out.gap.extra, adminUrl);
    if (await sendErrorTelegram(env, adminUrl, text)) sent.push(text);
  }
  if (out.summary) {
    const text = errorText.summary(out.summary, nowMs, adminUrl);
    if (await sendErrorTelegram(env, adminUrl, text)) sent.push(text);
  }
  return sent;
}

/** The tick threw. Off (the switch was read and is off): nothing. Switch not read yet (the database is down): the box decides. */
export function tickFailed(ctx: Ctx, watch: TickWatch, err: unknown): void {
  if (!watch.ready || watch.on === false) return;
  const cls = errorClass(err);
  const facts: ErrorFacts = cls === 'db_limit' ? { kind: 'database', limit: true } : { kind: 'clock', job: watch.job, database: cls === 'db' };
  const env = ctx.env;
  const work = (async () => {
    await reportError(env, ctx.url, ctx.nowMs, facts);
    // The clock did reach the site, so it is not "stopped": note the tick too (switch unknown: only if the box has it on).
    await tickWork(env, ctx.url, ctx.nowMs, watch.on === true);
  })();
  ctx.waitUntil(work.catch(() => null));
}

// ---------- the clock Worker's own reports (POST /api/cron/report) ----------

/** POST /api/cron/report { what }: the clock Worker saw a failure the site could not (the backup, or no answer at all). Secret only. */
export async function cronReport(ctx: Ctx, body: Record<string, unknown>, secretOk: boolean) {
  if (!secretOk) throw new HttpError(404, 'not_found', 'Not found.');
  if (!errorAlertsReady(ctx.env) || isPretend(ctx.db)) return { ok: true, skipped: 'off' };
  const what = v.oneOf(body.what, 'what', ['backup_failed', 'backup_incomplete', 'tick_no_answer'] as const);
  const facts: ErrorFacts = what === 'tick_no_answer' ? { kind: 'clock', job: 'site check' } : { kind: 'backup', incomplete: what === 'backup_incomplete' };
  ctx.waitUntil(reportError(ctx.env, ctx.url, ctx.nowMs, facts).catch(() => null));
  return { ok: true };
}

// ---------- server errors on the live site (server/app.ts) ----------

const OFF_MEMORY_MS = 10 * 60_000;
/** Until when this Worker run already knows the switch is off (the box said so): no more box calls for a while. */
let offUntil = 0;
const recent = { all: [] as number[], db: [] as number[] };
/** Per kind: no second report from this Worker run within the burst window. */
const reportedAt = new Map<string, number>();

/** Test only: forget what this Worker run remembers. */
export function resetErrorMemory(): void {
  offUntil = 0;
  offToldAt = 0;
  recent.all = [];
  recent.db = [];
  reportedAt.clear();
  logged.clear();
}

/**
 * An unhandled error answered 500 (server/app.ts). Counted in this Worker run's memory only (no database, no box call): the free
 * daily limit is reported at once, other database errors at 3 in 10 minutes, any server error at 5 in 10 minutes. A single error is
 * never a message. The clock's own routes are left out (the tick reports its own errors).
 */
export function noteServerError(ctx: Ctx, err: unknown): void {
  try {
    // "Pretend it's..." runs on a made-up time: never counted (a far-off time would fill the box's slots).
    if (!errorAlertsReady(ctx.env) || ctx.url.pathname.startsWith('/api/cron/') || isPretend(ctx.db)) return;
    const now = ctx.nowMs;
    if (now < offUntil) return;
    const keep = (list: number[]) => list.filter((t) => now - t < BURST.windowMs).slice(-50);
    const cls = errorClass(err);
    recent.all = keep([...recent.all, now]);
    if (cls !== 'other') recent.db = keep([...recent.db, now]);
    let facts: ErrorFacts | null = null;
    if (cls === 'db_limit') facts = { kind: 'database', limit: true };
    else if (cls === 'db' && recent.db.length >= BURST.dbErrors) facts = { kind: 'database', limit: false };
    else if (recent.all.length >= BURST.errors) facts = { kind: 'server_errors', n: recent.all.length };
    if (!facts) return;
    const last = reportedAt.get(facts.kind);
    if (last !== undefined && now - last < BURST.windowMs) return;
    reportedAt.set(facts.kind, now);
    ctx.waitUntil(reportError(ctx.env, ctx.url, now, facts).catch(() => null));
  } catch {
    // Never.
  }
}

// ---------- the Settings row and the test button ----------

export async function setErrorAlertsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ERROR_ALERTS.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ERROR_ALERTS.task, nowIso).run();
  }
}

/**
 * The switch, both places: the row (the truth, what Settings shows), then the box's copy. If the box misses it, the clock's ticks
 * tell it (on: every tick; off: about once an hour), so the row always wins. Without the box (not set up) only the row is saved.
 */
export async function switchErrorAlerts(ctx: Ctx, groupId: string, on: boolean): Promise<void> {
  await setErrorAlertsForAll(ctx.db, groupId, on, ctx.nowIso);
  offUntil = 0;
  offToldAt = 0;
  if (ctx.env.ERROR_BOX) await boxCall(ctx.env, { op: 'sync', on }, ctx.nowMs);
}

let lastTestAt = 0;

/** POST /api/admin/error-alerts/test: one message marked TEST, through the same sender as the real ones. Works with the switch off. */
export async function errorAlertTest(ctx: Ctx) {
  await requireAdmin(ctx);
  if (ctx.env.SANDBOX || isPretend(ctx.db)) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!connected(ctx.env)) throw new HttpError(409, 'not_connected', 'Not connected: the bot token or chat ID is missing on Cloudflare.');
  if (!errorAlertsAllowed(ctx.env.ERROR_ALERTS)) throw new HttpError(409, 'error_alerts_off', 'Error alerts are switched off on Cloudflare.');
  if (Date.now() - lastTestAt < 10_000) throw new HttpError(429, 'too_fast', 'Sent a moment ago. Check Telegram.');
  lastTestAt = Date.now();
  const adminUrl = adminUrlOf(ctx.env, ctx.url);
  if (!(await sendErrorTelegram(ctx.env, adminUrl, errorText.test(adminUrl)))) throw new HttpError(502, 'telegram_failed', "Telegram didn't take it. Try again in a minute.");
  return { ok: true };
}

/** Test only. */
export function resetTestTimer(): void {
  lastTestAt = 0;
}
