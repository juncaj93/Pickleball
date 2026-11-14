// Telegram alerts to the organizer (Settings > Alerts). Only player taps
// cause them: never the organizer's own taps, the demo, or Pretend it's....
// The message goes out after the tap has its answer, with a short timeout,
// so a slow or broken Telegram can't slow down or break anyone's tap. The
// bot token and chat ID are Cloudflare secrets: they never reach a browser
// and the bot only ever messages that one chat.
import { type AlertPerson, type AlertPrefs, alertMessage, cashOutUsedMessage, DEFAULT_ALERT_PREFS, refundRequestMessage } from '../shared/alerts';
import { alertName, guestIn } from '../shared/guestSpot';
import type { AdminDashboard } from '../shared/api';
import { deadlineMs } from '../shared/cards';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { newId } from './crypto';
import type { D1Database, Env } from './db';
import { HttpError } from './http';
import { isPretend } from './pretend';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { confirmedOf, type GroupRow, loadRoster, type SessionRow, settingsOf, visibleFrom } from './repo';
import * as v from './validate';
import { setSmartAlerts, smartAlertsOn } from './tasks';
import { isAdminPage, linkText, ourAddress, type TextLink } from './telegram-links';
import { textsR2ForAlerts } from './textsR2';
import { secondChanceTakesReached } from './secondChance';
import { MIN_PLAYERS } from '../shared/spots';

/** A bug can't send more than this many alerts in an hour (test alerts count too). */
export const MAX_ALERTS_PER_HOUR = 20;
/** Alerts caused by player taps (drops, it's on, cash outs) stop at this many an hour, so the clock's alerts always keep a few of the 20. */
export const MAX_PLAYER_ALERTS_PER_HOUR = 15;
const SEND_TIMEOUT_MS = 5000;
/** What deliver() says when Telegram took too long: the message may still have arrived. */
export const TIMEOUT_ERROR = "Telegram didn't answer in time.";
/** How deliver() starts its message when the hour's alert limit is used up (nothing went to Telegram). */
export const PAUSED_PREFIX = 'Paused:';
const HOUR_MS = 3600_000;

export interface AlertRow {
  enabled: number;
  drop_36h: number;
  below_min: number;
  reached_min: number;
  refund_requests: number;
  last_at: string | null;
  last_ok: number | null;
  last_error: string | null;
}

async function alertRow(db: D1Database, groupId: string): Promise<AlertRow | null> {
  return db.prepare('SELECT * FROM organizer_alerts WHERE group_id = ?').bind(groupId).first<AlertRow>();
}

/** The organizer's switches, read fresh. */
export async function prefsOfGroup(db: D1Database, groupId: string): Promise<AlertPrefs> {
  return prefsOf(await alertRow(db, groupId));
}

export function prefsOf(row: AlertRow | null): AlertPrefs {
  if (!row) return { ...DEFAULT_ALERT_PREFS };
  return {
    enabled: !!row.enabled,
    drop36: !!row.drop_36h,
    belowMin: !!row.below_min,
    reachedMin: !!row.reached_min,
    refundRequests: !!row.refund_requests,
  };
}

export function connected(env: Env): boolean {
  return !!env.TELEGRAM_BOT_TOKEN && /^-?\d{1,20}$/.test(env.TELEGRAM_CHAT_ID ?? '');
}

/** What Settings shows: the switches and a status. Never the token or chat ID. */
export async function alertsView(ctx: Ctx, groupId: string): Promise<AdminDashboard['alerts']> {
  const row = await alertRow(ctx.db, groupId);
  return {
    ...prefsOf(row),
    // Display only: if the new table is ever missing, Settings still loads.
    smartAlerts: await smartAlertsOn(ctx.db, groupId).catch(() => true),
    connected: connected(ctx.env),
    lastAt: row?.last_at ?? null,
    lastOk: row?.last_ok === null || row?.last_ok === undefined ? null : !!row.last_ok,
    lastError: row?.last_ok === 0 ? row.last_error : null,
  };
}

/** PUT /api/admin/alerts { enabled?, drop36?, belowMin?, reachedMin?, refundRequests?, smartAlerts? }: one switch at a time is fine. */
export async function updateAlerts(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (body.smartAlerts !== undefined) await setSmartAlerts(ctx.db, group.id, v.bool(body.smartAlerts, 'smartAlerts'), ctx.nowIso);
  const cur = prefsOf(await alertRow(ctx.db, group.id));
  const pick = (key: keyof AlertPrefs) => (body[key] === undefined ? cur[key] : v.bool(body[key], key));
  const next: AlertPrefs = {
    enabled: pick('enabled'),
    drop36: pick('drop36'),
    belowMin: pick('belowMin'),
    reachedMin: pick('reachedMin'),
    refundRequests: pick('refundRequests'),
  };
  const bit = (b: boolean) => (b ? 1 : 0);
  await ctx.db
    .prepare(
      `INSERT INTO organizer_alerts (group_id, enabled, drop_36h, below_min, reached_min, refund_requests) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (group_id) DO UPDATE SET enabled = ?2, drop_36h = ?3, below_min = ?4, reached_min = ?5, refund_requests = ?6`,
    )
    .bind(group.id, bit(next.enabled), bit(next.drop36), bit(next.belowMin), bit(next.reachedMin), bit(next.refundRequests))
    .run();
  return { ok: true, alerts: await alertsView(ctx, group.id) };
}

async function recordResult(ctx: Ctx, groupId: string, ok: boolean, error: string | null) {
  await ctx.db
    .prepare(
      `INSERT INTO organizer_alerts (group_id, last_at, last_ok, last_error) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (group_id) DO UPDATE SET last_at = ?2, last_ok = ?3, last_error = ?4`,
    )
    .bind(groupId, new Date(ctx.nowMs).toISOString(), ok ? 1 : 0, error)
    .run();
}

/**
 * One of the hour's alert slots, or false when they're used up. Written first, so a burst can't slip past.
 * A player alert first holds a 'telegram_pending' slot and counts every slot, its own included; only once
 * it fits does the slot become a plain 'telegram' one. The clock's alerts count only plain slots, so a
 * flood of player alerts being turned away can never push the clock's alerts over the limit.
 */
async function takeSlot(ctx: Ctx, max: number, fromPlayer: boolean): Promise<boolean> {
  const id = newId();
  const nowIso = new Date(ctx.nowMs).toISOString();
  const kind = fromPlayer ? 'telegram_pending' : 'telegram';
  await ctx.db.prepare("INSERT INTO rate_events (id, kind, client_key, created_at) VALUES (?, ?, 'server', ?)").bind(id, kind, nowIso).run();
  const row = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM rate_events WHERE kind IN (${fromPlayer ? "'telegram', 'telegram_pending'" : "'telegram'"}) AND created_at > ?`)
    .bind(new Date(ctx.nowMs - HOUR_MS).toISOString())
    .first<{ n: number }>();
  if ((row?.n ?? 0) > max) {
    await ctx.db.prepare('DELETE FROM rate_events WHERE id = ?').bind(id).run();
    return false;
  }
  if (fromPlayer) await ctx.db.prepare("UPDATE rate_events SET kind = 'telegram' WHERE id = ?").bind(id).run();
  await ctx.db
    .prepare("DELETE FROM rate_events WHERE kind IN ('telegram', 'telegram_pending') AND created_at < ?")
    .bind(new Date(ctx.nowMs - 86_400_000).toISOString())
    .run();
  return true;
}

/** Plain words for what went wrong. Never includes the token. */
function telegramProblem(status: number, description: string): string {
  if (status === 401 || status === 404) return 'Telegram refused the bot token. Check TELEGRAM_BOT_TOKEN on Cloudflare.';
  if (status === 403) return "The bot can't message you yet. Open the bot in Telegram and tap Start.";
  if (status === 400 && /chat not found/i.test(description)) return 'Telegram could not find your chat. Check TELEGRAM_CHAT_ID on Cloudflare.';
  if (status === 429) return 'Telegram asked us to slow down. Try again in a minute.';
  return `Telegram said no (error ${status}).`;
}

/** Send one message to the organizer's chat, with an "Open site" button. */
/** The message with each "words: address" shown as tappable words, and the /admin page (the Open site button) as plain words (see telegram-links.ts). */
function telegramText(text: string, siteUrl: string): { text: string; entities?: TextLink[] } {
  const linked = linkText(text, isAdminPage, ourAddress(siteUrl, [COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL]));
  return linked.entities.length ? linked : { text: linked.text };
}

async function sendTelegram(env: Env, siteUrl: string, text: string, links: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const doFetch = env.TELEGRAM_FETCH ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        ...(links ? telegramText(text, siteUrl) : { text }),
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: 'Open site', url: `${siteUrl}/admin` }]] },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, error: timedOut ? TIMEOUT_ERROR : "Couldn't reach Telegram." };
  }
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { description?: unknown };
  return { ok: false, error: telegramProblem(res.status, typeof data.description === 'string' ? data.description : '') };
}

function siteUrl(ctx: Ctx): string {
  return (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');
}

/** Rate limit, send, write down how it went. Never throws. */
/**
 * `fromPlayer`: a message a player's tap caused (drops, it's on, cash outs). It carries names, so it is
 * sent with no links at all (nothing in a name can turn into one), and it stops at
 * MAX_PLAYER_ALERTS_PER_HOUR so one player can't use up the hour and silence the clock's alerts.
 */
export async function deliver(ctx: Ctx, groupId: string, text: string, fromPlayer = false): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const max = fromPlayer ? MAX_PLAYER_ALERTS_PER_HOUR : MAX_ALERTS_PER_HOUR;
    if (!(await takeSlot(ctx, max, fromPlayer))) {
      const error = `${PAUSED_PREFIX} more than ${max} alerts in an hour.`;
      await recordResult(ctx, groupId, false, error);
      return { ok: false, error };
    }
    const sent = await sendTelegram(ctx.env, siteUrl(ctx), text, !fromPlayer);
    // Once Telegram took it, it counts as sent even if writing down the result fails (so it is never sent twice).
    await recordResult(ctx, groupId, sent.ok, sent.ok ? null : sent.error).catch(() => {});
    return sent;
  } catch {
    return { ok: false, error: 'Something went wrong sending the alert.' };
  }
}

/** POST /api/admin/alerts/test: a real message right now, so the organizer knows it works. */
export async function testAlert(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  if (ctx.env.SANDBOX || isPretend(ctx.db)) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!connected(ctx.env)) throw new HttpError(409, 'not_connected', 'Not connected: the bot token or chat ID is missing on Cloudflare.');
  const sent = await deliver(ctx, group.id, 'Test alert from Pickleball. Alerts are working.');
  if (!sent.ok) throw new HttpError(502, 'telegram_failed', sent.error);
  return { ok: true, alerts: await alertsView(ctx, group.id) };
}

/** What a tap needs to remember from just before it, to compare after. */
export interface AlertWatch {
  group: GroupRow;
  session: SessionRow;
  actor: AlertPerson;
  prefs: AlertPrefs;
  before: AlertPerson[];
}

// Zip 42 "Guest spot": a guest in is a person too (so "4 in now" counts them, and a guest moving up is named "Sam (guest)").
const people = (roster: Awaited<ReturnType<typeof loadRoster>>): AlertPerson[] =>
  confirmedOf(roster).flatMap((r) => [
    { playerId: r.player_id, name: r.display_name },
    ...(guestIn(r) ? [{ playerId: `guest:${r.player_id}`, name: `${r.guest_name} (guest)` }] : []),
  ]);

/**
 * Call just before a player's tap changes a roster. Returns null (and costs
 * almost nothing) whenever no alert could follow.
 */
export async function watchTap(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string): Promise<AlertWatch | null> {
  try {
    return await watchInner(ctx, group, session, playerId);
  } catch {
    return null;
  }
}

async function watchInner(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string): Promise<AlertWatch | null> {
  if (ctx.env.SANDBOX || isPretend(ctx.db) || !connected(ctx.env)) return null;
  if (playerId === group.organizer_player_id) return null; // the organizer's own taps
  if (session.status === 'canceled' || ctx.nowMs >= Date.parse(session.starts_at)) return null;
  if (session.starts_at < visibleFrom(group) && !session.shown_early) return null; // hidden before the first session date
  const prefs = prefsOf(await alertRow(ctx.db, group.id));
  if (!prefs.enabled || !(prefs.drop36 || prefs.belowMin || prefs.reachedMin)) return null;
  const roster = await loadRoster(ctx.db, session.id);
  const me = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  // Zip 42: one alert for a pair, "Rowan (and guest Sam) dropped out ...". No guest: the name alone, as before.
  const mine = roster.find((r) => r.player_id === playerId);
  const name = alertName(me?.display_name ?? 'Someone', mine && guestIn(mine) ? mine.guest_name : null);
  return { group, session, prefs, actor: { playerId, name }, before: people(roster) };
}

/**
 * A player asked for a refund of their credit: one message with the name and
 * the amount (never their Venmo or phone). Sent in the background, never
 * from the demo or Pretend, and never worth failing the request over. At
 * most one per player an hour, so asking, canceling and asking again can't
 * use up the hour's alerts (the Home card still shows the latest request).
 */
export async function notifyRefundRequest(ctx: Ctx, group: GroupRow, playerId: string, name: string, cents: number): Promise<void> {
  try {
    if (ctx.env.SANDBOX || isPretend(ctx.db) || !connected(ctx.env)) return;
    const prefs = prefsOf(await alertRow(ctx.db, group.id));
    if (!prefs.enabled || !prefs.refundRequests) return;
    const recent = await ctx.db
      .prepare("SELECT 1 FROM rate_events WHERE kind = 'refund_alert' AND client_key = ? AND created_at > ? LIMIT 1")
      .bind(playerId, new Date(ctx.nowMs - HOUR_MS).toISOString())
      .first();
    if (recent) return;
    await ctx.db
      .prepare("INSERT INTO rate_events (id, kind, client_key, created_at) VALUES (?, 'refund_alert', ?, ?)")
      .bind(newId(), playerId, new Date(ctx.nowMs).toISOString())
      .run();
    ctx.waitUntil(deliver(ctx, group.id, refundRequestMessage(name, cents), true));
  } catch {
    // Never worth failing the request over.
  }
}

/**
 * One short line when a player puts their pending cash out toward a game
 * ("Use it" at sign-up), under the same "Refund requests" switch. Never from
 * the demo or Pretend, and never worth failing the request over.
 */
export async function notifyCashOutUsed(ctx: Ctx, group: GroupRow, name: string, usedCents: number, requestCents: number, startsAt: string): Promise<void> {
  try {
    if (ctx.env.SANDBOX || isPretend(ctx.db) || !connected(ctx.env)) return;
    const prefs = prefsOf(await alertRow(ctx.db, group.id));
    if (!prefs.enabled || !prefs.refundRequests) return;
    ctx.waitUntil(deliver(ctx, group.id, cashOutUsedMessage(name, usedCents, requestCents, startsAt, group.timezone), true));
  } catch {
    // Never worth failing the request over.
  }
}

/**
 * Call right after the tap. Sends at most one message, in the background.
 * `dropperOwesCents`: the person who dropped now owes this (late fees on and the drop created the debt). Only the TEXTS_R2
 * wording says so; with that switch off the message is exactly what it always was.
 */
export async function afterTap(ctx: Ctx, watch: AlertWatch | null, dropperOwesCents: number | null = null): Promise<void> {
  if (!watch) return;
  try {
    const after = people(await loadRoster(ctx.db, watch.session.id));
    // Zip 15 (server/secondChance.ts): with Second Chance on for everyone, a game today that is not booked gets Telegram 1 or 2 at 4 in
    // instead of "has 4 now, it's on" (it is not on until the court is booked). Only costs a read when this tap reached 4.
    const reached = watch.before.length < MIN_PLAYERS && after.length >= MIN_PLAYERS;
    const prefs = reached && (await secondChanceTakesReached(ctx, watch.group, watch.session)) ? { ...watch.prefs, reachedMin: false } : watch.prefs;
    const input = {
      actor: watch.actor,
      before: watch.before,
      after,
      startsAt: watch.session.starts_at,
      deadlineMs: deadlineMs({ startsAt: watch.session.starts_at, cancellationDeadlineAt: watch.session.cancellation_deadline_at }, settingsOf(watch.group)),
      nowMs: ctx.nowMs,
      timezone: watch.group.timezone,
      prefs,
      // Zip 10, "Card cleanup" on for this tap (it rides on the group row): no waitlist words.
      ...(watch.group.card_cleanup === true ? { noWaitlist: true } : {}),
    };
    let text = alertMessage(input);
    // The new wording is the same message with the game named by its day. It only costs a read when there is something to send.
    if (text && (await textsR2ForAlerts(ctx, watch.group.id))) text = alertMessage({ ...input, textsR2: true, dropperOwesCents }) ?? text;
    if (text) ctx.waitUntil(deliver(ctx, watch.group.id, text, true));
  } catch {
    // An alert is never worth failing a tap over.
  }
}
