// "Do this now": the card's taps (marks), the Smart alerts switch, and the
// 5-minute tick that sends smart Telegram alerts. The tick is called by a
// tiny separate Cloudflare Worker on a cron (worker/cron.ts) with a shared
// secret; it reuses the site's own Telegram secrets and the same task brain
// as the card (shared/tasks.ts), so the two always say the same thing.
// A failed tick or a failed send never touches any other data or any tap.
import { holidayFor } from '../shared/holidays';
import { textsR2Allowed } from '../shared/textsR2';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { dueAlerts, MARK_NAMES, markKey, mayAlertSoon, nextTasks, type TaskOptions, type TaskSession } from '../shared/tasks';
import { type AlertRow, connected, deliver, PAUSED_PREFIX, prefsOf, TIMEOUT_ERROR } from './alerts';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { newId } from './crypto';
import type { D1Database } from './db';
import { makeGoToken } from './go';
import { HttpError } from './http';
import { isPretend } from './pretend';
import { getSession, type GroupRow, loadCancelCharges, loadRoster, PRICE_LOCK_TASK, type SessionRow, settingsOf, visibleFrom } from './repo';
import { loadLedger } from './credit';
import { TEXTS_R2_TASK, textsR2ForAlerts } from './textsR2';
import { HIDDEN_GAME_TASK, MONEY_REWORK_TASK, sessionHasMoney } from './moneyRework';
import { moneyReworkAllowed } from '../shared/moneyRework';
import * as v from './validate';
import { tickPings } from './secondChance';
import { tickGameText } from './gameDayText';
import { afterTick, tickFailed, tickSwitchSql, tickWatch, type TickWatch } from './errorAlerts';

const DAY_MS = 86_400_000;
/** Sessions the tick looks at: ended up to this long ago (the post-game note), up to the booking window ahead. */
const LOOK_BACK_MS = 8 * DAY_MS;
/** A bug can't make one tick send more than this. */
const MAX_PER_TICK = 5;
/** A failed alert is retried at most this often, and given up after this many tries (so a Telegram outage can't use up the hour's alerts). */
const RETRY_AFTER_MS = 15 * 60_000;
const MAX_TRIES = 3;
/** A tick stops starting new sends after this long, well inside the clock Worker's 25-second wait. */
const TICK_BUDGET_MS = 12_000;
const FAILED_KEEP_MS = 30 * DAY_MS;

export function siteUrlOf(ctx: Ctx): string {
  return (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');
}

export function taskOptions(ctx: Ctx, group: GroupRow): TaskOptions {
  const settings = settingsOf(group);
  return {
    tz: group.timezone,
    bookingLeadDays: settings.bookingLeadDays,
    defaultDeadlineHours: settings.defaultDeadlineHours,
    links: { admin: `${siteUrlOf(ctx)}/admin`, book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL },
  };
}

export function taskSessionOf(s: SessionRow, confirmedCount: number, tz: string, bookedAt: string | null = null): TaskSession {
  return {
    id: s.id,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    canceled: s.status === 'canceled',
    canceledAt: s.canceled_at,
    confirmedCount,
    booked: s.booking_status === 'booked',
    bookedAt: s.booking_status === 'booked' ? bookedAt : null,
    cancellationDeadlineAt: s.cancellation_deadline_at,
    finalized: !!s.finalized_at,
    holiday: holidayFor(s.starts_at, tz),
    // The same rule as the Waitlist court switch (shared/court.ts): on the venue's waitlist and not Booked.
    waitlisted: s.booking_status !== 'booked' && (s.booking_status === 'unavailable' || s.court_state === 'waitlist'),
  };
}

/** What the tick's quick check needs from a game row (no time zone work). */
function rowFacts(s: SessionRow) {
  return {
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    canceled: s.status === 'canceled',
    booked: s.booking_status === 'booked',
    finalized: !!s.finalized_at,
    cancellationDeadlineAt: s.cancellation_deadline_at,
  };
}

/** The task mark for "court booked": when the organizer marked it (not one the card can set). */
export const COURT_BOOKED_MARK = 'court_booked';

/**
 * Marks for games that ended in the last 30 days or are still ahead, as
 * "sessionId:mark", and when each court was marked booked. Display only:
 * never breaks Home.
 */
export async function loadMarks(db: D1Database, groupId: string, nowMs: number): Promise<{ marks: string[]; courtBookedAt: Record<string, string> }> {
  try {
    const { results } = await db
      .prepare(
        `SELECT t.session_id, t.task, t.at FROM task_log t JOIN sessions s ON s.id = t.session_id
         WHERE t.group_id = ? AND t.kind = 'mark' AND s.ends_at > ?`,
      )
      .bind(groupId, new Date(nowMs - FAILED_KEEP_MS).toISOString())
      .all<{ session_id: string; task: string; at: string }>();
    const courtBookedAt: Record<string, string> = {};
    for (const r of results) if (r.task === COURT_BOOKED_MARK) courtBookedAt[r.session_id] = r.at;
    // A game's price lock (Zip 27, server/repo.ts) is money bookkeeping, not a card tap: it never goes to the screen.
    return { marks: results.filter((r) => r.task !== COURT_BOOKED_MARK && r.task !== PRICE_LOCK_TASK).map((r) => `${r.session_id}:${r.task}`), courtBookedAt };
  } catch {
    return { marks: [], courtBookedAt: {} };
  }
}

/**
 * Remember when a court was marked booked (I booked it, Edit booking, or Yes
 * after a move), or forget it when it goes back to not booked. Alerts whose
 * time passed before the booking are then never sent. Never fails the tap.
 */
export async function recordCourtBooked(db: D1Database, groupId: string, sessionId: string, booked: boolean, nowIso: string): Promise<void> {
  try {
    await db.prepare("DELETE FROM task_log WHERE session_id = ? AND task = ? AND kind = 'mark'").bind(sessionId, COURT_BOOKED_MARK).run();
    if (booked) await writeMark(db, groupId, sessionId, COURT_BOOKED_MARK, nowIso);
  } catch {
    // Only fine-tunes alerts; never worth failing the tap over.
  }
}

/**
 * A game moved to another day is in effect a new game: its alerts can go
 * again and the card taps start over. A change of time on the same day
 * keeps them, so nothing already sent is sent twice. Whether the court is
 * booked is kept (the organizer answers that right after the move).
 */
export async function resetTasksForNewDay(db: D1Database, sessionId: string): Promise<void> {
  try {
    // The court-booked mark stays, and so does "hidden from the lists" (Money page rework): moving a game does not un-hide it.
    await db.prepare(`DELETE FROM task_log WHERE session_id = ? AND (kind IN ('sent', 'failed') OR (kind = 'mark' AND task <> ? AND task <> ?))`).bind(sessionId, COURT_BOOKED_MARK, HIDDEN_GAME_TASK).run();
  } catch {
    // Never worth failing the move over.
  }
}

/** Settings > Alerts > Smart alerts. On unless switched off. */
export async function smartAlertsOn(db: D1Database, groupId: string): Promise<boolean> {
  const off = await db.prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND kind = 'off' LIMIT 1").bind(groupId).first();
  return !off;
}

export async function setSmartAlerts(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND kind = 'off'").bind(groupId).run();
  if (!on) {
    await db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, 'smart_alerts', 'off', ?)")
      .bind(newId(), groupId, nowIso)
      .run();
  }
}

/** POST /api/admin/sessions/:id/task-mark { mark }: the organizer tapped a card button. Saved once. */
export async function taskMark(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const mark = v.oneOf(body.mark, 'mark', MARK_NAMES);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  await writeMark(ctx.db, group.id, session.id, mark, ctx.nowIso);
  return { ok: true, mark: markKey(session.id, mark) };
}

export async function writeMark(db: D1Database, groupId: string, sessionId: string, mark: string, nowIso: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, ?, ?, 'mark', ?)")
    .bind(newId(), groupId, sessionId, mark, nowIso)
    .run();
}

/** POST /api/admin/alerts/smart-test: one clearly labeled TEST message, so the organizer knows smart alerts reach Telegram. */
export async function smartTestAlert(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  if (ctx.env.SANDBOX || isPretend(ctx.db)) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!connected(ctx.env)) throw new HttpError(409, 'not_connected', 'Not connected: the bot token or chat ID is missing on Cloudflare.');
  // One line, like the real ones. With the direct text link on, "Text the group" opens a TEST link for the next game
  // (to try on a phone; it never marks anything done). Otherwise it is plain words and the Open site button is the way in.
  let link = `${siteUrlOf(ctx)}/admin`;
  if (ctx.env.CRON_SECRET && ctx.env.GO_LINKS === 'on') {
    const next = await ctx.db
      .prepare("SELECT id, starts_at FROM sessions WHERE group_id = ? AND status <> 'canceled' AND starts_at > ? ORDER BY starts_at LIMIT 1")
      .bind(group.id, ctx.nowIso)
      .first<{ id: string; starts_at: string }>();
    if (next) link = `${siteUrlOf(ctx)}/go/${await makeGoToken(ctx.env.CRON_SECRET, next.id, next.starts_at, ctx.nowMs, true)}`;
  }
  // With TEXTS_R2 on for everyone the real alerts read "Tomorrow: ..." (the test follows the same switch, so it shows what the real ones say).
  const sample = (await textsR2ForAlerts(ctx, group.id)) ? 'Tomorrow' : 'Tuesday';
  const text = `TEST smart alert from Pickleball. Nothing to do. Real ones look like: "${sample}: 3 players in, need a 4th. Text the group: ${link}"`;
  const sent = await deliver(ctx, group.id, text);
  if (!sent.ok) throw new HttpError(502, 'telegram_failed', sent.error);
  return { ok: true };
}

/** Equal-time compare, so the secret can't be guessed a letter at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface TickResult {
  ok: true;
  sent: number;
  failed: number;
  skipped?: string;
}

/**
 * POST /api/cron/tick, from the cron Worker every 5 minutes. Works out the
 * open tasks for right now and sends each alert that came due within the
 * last hour and was not sent yet. Each alert is claimed in the log before it
 * is sent, so two ticks at once can't both send it; a failed send gives the
 * claim back (the next tick retries) and is written down.
 */
export async function cronTick(ctx: Ctx): Promise<TickResult> {
  const secret = ctx.env.CRON_SECRET ?? '';
  if (!secret || !sameSecret(ctx.req.headers.get('X-Cron-Secret') ?? '', secret)) throw new HttpError(404, 'not_found', 'Not found.');
  if (ctx.env.SANDBOX || isPretend(ctx.db)) return { ok: true, sent: 0, failed: 0, skipped: 'demo' };
  // Zip 21 "Error alerts" (server/errorAlerts.ts): off or not set up, the watch does nothing and the tick is exactly as before
  // (the error goes on to the clock Worker as a 500, as always). On: a failed tick is reported, and every tick is noted (after the answer).
  const watch = tickWatch(ctx.env);
  try {
    const result = await tickJobs(ctx, watch);
    afterTick(ctx, watch);
    return result;
  } catch (err) {
    tickFailed(ctx, watch, err);
    throw err;
  }
}

/** Is the cron Worker's secret on this request? (The clock Worker's own reports use the same secret.) */
export function cronSecretOk(ctx: Ctx): boolean {
  const secret = ctx.env.CRON_SECRET ?? '';
  return !!secret && sameSecret(ctx.req.headers.get('X-Cron-Secret') ?? '', secret);
}

async function tickJobs(ctx: Ctx, watch: TickWatch): Promise<TickResult> {
  // One trip to the database for the group, both switches and the games: each separate call costs CPU on Cloudflare.
  // Each query finds the group the way getGroup does; the checks run in the same order as before.
  const theGroup = '(SELECT id FROM groups ORDER BY created_at LIMIT 1)';
  const [groupRows, alertRows, offRows, sessionRows, textsR2Rows, reworkRows, errorAlertRows] = await ctx.db.batch([
    ctx.db.prepare('SELECT * FROM groups ORDER BY created_at LIMIT 1'),
    ctx.db.prepare(`SELECT * FROM organizer_alerts WHERE group_id = ${theGroup}`),
    ctx.db.prepare(`SELECT 1 AS x FROM task_log WHERE group_id = ${theGroup} AND kind = 'off' LIMIT 1`),
    // Every game ending after the look-back; the first-date rule is applied below, only to games that pass the quick check.
    ctx.db.prepare(`SELECT * FROM sessions WHERE group_id = ${theGroup} AND ends_at > ? ORDER BY starts_at`).bind(new Date(ctx.nowMs - LOOK_BACK_MS).toISOString()),
    // TEXTS_R2 "on for everyone": read in the same trip (the clock follows the switch for everyone, never a phone's private link).
    ctx.db.prepare(`SELECT 1 AS x FROM task_log WHERE group_id = ${theGroup} AND session_id IS NULL AND task = '${TEXTS_R2_TASK}' AND kind = 'mark' LIMIT 1`),
    // MONEY_REWORK "on for everyone", same trip: a game hidden from the lists sends no alerts (the clock follows the switch for everyone).
    ctx.db.prepare(`SELECT 1 AS x FROM task_log WHERE group_id = ${theGroup} AND session_id IS NULL AND task = '${MONEY_REWORK_TASK}' AND kind = 'mark' LIMIT 1`),
    // Zip 21 "Error alerts", same trip, only while set up (not set up: the trip is exactly as before).
    ...(watch.ready ? [ctx.db.prepare(tickSwitchSql(theGroup))] : []),
  ]);
  if (watch.ready) watch.on = (errorAlertRows?.results.length ?? 0) > 0;
  watch.job = 'smart alerts';
  const group = (groupRows.results[0] as unknown as GroupRow | undefined) ?? null;
  if (!group) return { ok: true, sent: 0, failed: 0, skipped: 'no_group' };
  if (!connected(ctx.env)) return { ok: true, sent: 0, failed: 0, skipped: 'not_connected' };
  if (!prefsOf((alertRows.results[0] as unknown as AlertRow | undefined) ?? null).enabled) return { ok: true, sent: 0, failed: 0, skipped: 'alerts_off' };
  // Zip 15 (server/secondChance.ts): today's not-booked games, Telegram 1 (4 in) and 2 (4 paid), each once. Off: one switch read.
  await tickPings(ctx, group);
  if (offRows.results.length > 0) return { ok: true, sent: 0, failed: 0, skipped: 'smart_off' };
  // Zip 37 (server/gameDayText.ts): the hour-before "Text the players" Telegram. It looks only at the games this tick already read, and asks for
  // its switch row only while a booked game is 15 to 60 minutes from its start, so every other tick asks the database exactly what it did before.
  await tickGameText(ctx, group, sessionRows.results as unknown as SessionRow[]);

  const settings = settingsOf(group);
  const textsR2 = textsR2Allowed(ctx.env.TEXTS_R2) && textsR2Rows.results.length > 0;
  const o = { tz: group.timezone, bookingLeadDays: settings.bookingLeadDays, defaultDeadlineHours: settings.defaultDeadlineHours, ...(textsR2 ? { textsR2: true } : {}) };
  // Quick check first (plain arithmetic, see mayAlertSoon): only games that could have an alert due now go on.
  const rows = (sessionRows.results as unknown as SessionRow[]).filter(
    (s) => Date.parse(s.starts_at) <= ctx.nowMs + (settings.bookingLeadDays + 1) * DAY_MS && mayAlertSoon(rowFacts(s), null, ctx.nowMs, o),
  );
  if (rows.length === 0) return { ok: true, sent: 0, failed: 0 };
  const rowIds = rows.map((s) => s.id);
  const counts = await ctx.db
    .prepare(`SELECT session_id, COUNT(*) AS n FROM session_players WHERE status = 'confirmed' AND session_id IN (${rowIds.map(() => '?').join(',')}) GROUP BY session_id`)
    .bind(...rowIds)
    .all<{ session_id: string; n: number }>();
  const countOf = new Map(counts.results.map((r) => [r.session_id, Number(r.n)]));
  const shownFrom = visibleFrom(group);
  const shown = rows.filter((s) => (s.starts_at >= shownFrom || Number(s.shown_early) === 1) && mayAlertSoon(rowFacts(s), countOf.get(s.id) ?? 0, ctx.nowMs, o));
  if (shown.length === 0) return { ok: true, sent: 0, failed: 0 };
  const ids = shown.map((s) => s.id);
  const marks = ids.map(() => '?').join(',');
  const logs = await ctx.db
    .prepare(`SELECT session_id, task, kind, at FROM task_log WHERE session_id IN (${marks})`)
    .bind(...ids)
    .all<{ session_id: string; task: string; kind: string; at: string }>();
  const markSet = new Set(logs.results.filter((r) => r.kind === 'mark').map((r) => `${r.session_id}:${r.task}`));
  // A game the organizer hid from the lists (Money page rework) sends no booking, reminder or other clock alerts, but only while it has no
  // money in it: a player joining, a court booked or a payment makes it a normal game again at once. Un-hiding does the same.
  const hiddenQuiet =
    reworkRows.results.length > 0 && moneyReworkAllowed(ctx.env.MONEY_REWORK)
      ? await quietHiddenGames(ctx.db, group.id, shown.filter((s) => markSet.has(`${s.id}:${HIDDEN_GAME_TASK}`)))
      : new Set<string>();
  const sessions = shown.filter((s) => !hiddenQuiet.has(s.id));
  if (sessions.length === 0) return { ok: true, sent: 0, failed: 0 };
  const bookedAt = new Map(logs.results.filter((r) => r.kind === 'mark' && r.task === COURT_BOOKED_MARK).map((r) => [r.session_id, r.at]));
  const sentSet = new Set(logs.results.filter((r) => r.kind === 'sent').map((r) => `${r.session_id}:${r.task}`));
  // Failed tries per alert: give up after MAX_TRIES, and wait RETRY_AFTER_MS between them.
  const tries = new Map<string, { n: number; last: number }>();
  for (const r of logs.results.filter((x) => x.kind === 'failed')) {
    const k = `${r.session_id}:${r.task}`;
    const t = tries.get(k) ?? { n: 0, last: 0 };
    tries.set(k, { n: t.n + 1, last: Math.max(t.last, Date.parse(r.at)) });
  }
  const waiting = (key: string) => {
    const t = tries.get(key);
    return !!t && (t.n >= MAX_TRIES || ctx.nowMs - t.last < RETRY_AFTER_MS);
  };

  const tasks = nextTasks(
    ctx.nowMs,
    sessions.map((s) => taskSessionOf(s, countOf.get(s.id) ?? 0, group.timezone, bookedAt.get(s.id) ?? null)),
    markSet,
    { ...(await goLinks(ctx, taskOptions(ctx, group), sessions)), ...(textsR2 ? { textsR2: true } : {}) },
  );
  let sent = 0;
  let failed = 0;
  const began = Date.now();
  for (const alert of dueAlerts(tasks, ctx.nowMs, sentSet).filter((a) => !waiting(a.key)).slice(0, MAX_PER_TICK)) {
    if (Date.now() - began > TICK_BUDGET_MS) break;
    const [sessionId, task] = alert.key.split(':');
    const claimId = newId();
    const claim = await ctx.db
      // Only while the game is still on: a cancel or finalize saved since this tick read the games (it can take
      // a few seconds when Telegram is slow) stops its alerts here.
      .prepare(
        `INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, at)
         SELECT ?1, ?2, ?3, ?4, 'sent', ?5 WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?3 AND status <> 'canceled' AND finalized_at IS NULL)`,
      )
      .bind(claimId, group.id, sessionId, task, ctx.nowIso)
      .run();
    if (!claim.meta.changes) continue;
    const result = await deliver(ctx, group.id, alert.text);
    if (result.ok) {
      sent++;
      continue;
    }
    if (result.error.startsWith(PAUSED_PREFIX)) {
      // The hour's alert limit: nothing went to Telegram and it isn't Telegram's fault, so it is not a try. Wait for the next tick.
      await ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId).run();
      break;
    }
    failed++;
    const logFailure = ctx.db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, ?, ?, 'failed', ?, ?)")
      .bind(newId(), group.id, sessionId, task, result.error.slice(0, 200), ctx.nowIso);
    // Telegram too slow to answer: it may have arrived, so keep the claim (a missed alert beats a double one).
    if (result.error === TIMEOUT_ERROR) await logFailure.run();
    else await ctx.db.batch([ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId), logFailure]);
    // One failure is enough for this tick; the rest wait for the next one.
    break;
  }
  if (failed === 0 && sent > 0) {
    await ctx.db
      .prepare("DELETE FROM task_log WHERE group_id = ? AND kind = 'failed' AND at < ?")
      .bind(group.id, new Date(ctx.nowMs - FAILED_KEEP_MS).toISOString())
      .run();
  }
  return { ok: true, sent, failed };
}

/** Of these games (all marked hidden from the lists), the ones with no money in them: they stay quiet. Reads only when one is hidden. */
async function quietHiddenGames(db: D1Database, groupId: string, hidden: SessionRow[]): Promise<Set<string>> {
  const quiet = new Set<string>();
  if (hidden.length === 0) return quiet;
  const credit = new Set((await loadLedger(db, groupId)).map((e) => e.sessionId).filter((x): x is string => !!x));
  const charges = await loadCancelCharges(db, groupId);
  for (const s of hidden) if (!sessionHasMoney(s, await loadRoster(db, s.id), credit, charges)) quiet.add(s.id);
  return quiet;
}

/**
 * The direct text link for night-before alerts (/go/<token>): a signed link
 * per game starting within the next day and a half. Without it the alert
 * uses the admin link.
 */
async function goLinks(ctx: Ctx, o: TaskOptions, sessions: SessionRow[]): Promise<TaskOptions> {
  const secret = ctx.env.CRON_SECRET;
  if (!secret || ctx.env.GO_LINKS !== 'on') return o;
  const urls = new Map<string, string>();
  for (const s of sessions) {
    const start = Date.parse(s.starts_at);
    if (s.status === 'canceled' || start <= ctx.nowMs || start > ctx.nowMs + 36 * 3600_000) continue;
    urls.set(s.id, `${siteUrlOf(ctx)}/go/${await makeGoToken(secret, s.id, s.starts_at, ctx.nowMs)}`);
  }
  return { ...o, links: { ...o.links, go: (id) => urls.get(id) ?? null } };
}
