// Zip 15: SECOND_CHANCE (shared/secondChance.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened /admin with ?secondchance=on
//    (it then sends X-Second-Chance: a private test switch for that phone only: the Home cards and the Request buttons).
// The two Telegrams follow the Settings row ONLY (never a phone's private link), so trying it on live with the link sends nothing.
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Card steps and sent Telegrams are task_log rows on the game (the table's unique index keeps each to one per game).
import type { AdminDashboard, AdminSessionView } from '../shared/api';
import { MIN_PLAYERS } from '../shared/spots';
import { COURTRESERVE_BOOKING_URL } from '../shared/settings';
import { siteAddress } from '../shared/messages';
import { localParts, zonedTimeToUtc } from '../shared/time';
import {
  counts,
  dayKey,
  duePing,
  isChance,
  noonOf,
  pickTimes,
  pingInMessage,
  pingPaidMessage,
  SC,
  SECOND_CHANCE,
  SECOND_CHANCE_TEST,
  secondChanceAllowed,
  secondChanceCards,
  type ScGame,
  type ScUnpaid,
} from '../shared/secondChance';
import { connected, deliver, PAUSED_PREFIX, prefsOf, TIMEOUT_ERROR, type AlertRow } from './alerts';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { newId } from './crypto';
import type { D1Database } from './db';
import { HttpError } from './http';
import { isPretend } from './pretend';
import { confirmedOf, getSession, type GroupRow, loadRoster, organizerIdOf, type RosterRow, type SessionRow } from './repo';
import { viewOnlyCookie } from './viewOnly';
import * as v from './validate';

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

export async function secondChanceForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, SECOND_CHANCE.task).first().catch(() => null);
  return !!row;
}

export async function setSecondChanceForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, SECOND_CHANCE.task).run();
  if (on) {
    await db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)")
      .bind(newId(), groupId, SECOND_CHANCE.task, nowIso)
      .run();
  }
}

/** The switch for this screen, and the Settings row: one read of the row for both. */
export async function secondChanceFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  if (!secondChanceAllowed(ctx.env.SECOND_CHANCE)) return { on: false, forAll: await secondChanceForAll(ctx.db, groupId) };
  const row = await secondChanceForAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(SECOND_CHANCE.header) ?? '').toLowerCase() === 'on';
  return { on: header || row, forAll: row };
}

export async function secondChanceFor(ctx: Ctx, groupId: string): Promise<boolean> {
  return (await secondChanceFlags(ctx, groupId)).on;
}

/** Preview only: SECOND_CHANCE_TEST is "on" (only [env.preview.vars] has it). Then the Telegrams are a visible fake, never sent. */
export function isPreviewTest(ctx: Ctx): boolean {
  return (ctx.env.SECOND_CHANCE_TEST ?? '').trim().toLowerCase() === 'on';
}

/** Preview only: this phone asked to pretend it's noon on game day (?noontest=on). Always false on live. */
function pretendNoon(ctx: Ctx): boolean {
  return isPreviewTest(ctx) && (ctx.req.headers.get(SECOND_CHANCE_TEST.header) ?? '').toLowerCase() === 'on';
}

/**
 * "Now" for these features. Live: the real clock. A preview phone with ?noontest=on: noon (Eastern) on the date of the next Second Chance
 * game (a game canceled with exactly 3 in that has not started), else the next Tuesday or Thursday. Nothing else reads it.
 */
export async function scNowMs(ctx: Ctx, group: GroupRow): Promise<number> {
  if (!pretendNoon(ctx)) return ctx.nowMs;
  const { results } = await ctx.db
    .prepare(
      `SELECT s.starts_at, s.canceled_at FROM sessions s WHERE s.group_id = ? AND s.status = 'canceled' AND s.starts_at > ? AND s.booking_status <> 'booked'
         AND (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = s.id AND sp.status = 'confirmed') = ?
       ORDER BY s.starts_at LIMIT 20`,
    )
    .bind(group.id, ctx.nowIso, MIN_PLAYERS - 1)
    .all<{ starts_at: string; canceled_at: string | null }>()
    .catch(() => ({ results: [] as { starts_at: string; canceled_at: string | null }[] }));
  // The first one canceled the night before its day (a real Second Chance game), else the first one at all.
  const tz = group.timezone;
  const nightBefore = (r: { starts_at: string; canceled_at: string | null }) =>
    !!r.canceled_at && dayKey(Date.parse(r.canceled_at) + 86_400_000, tz) === dayKey(Date.parse(r.starts_at), tz);
  const row = results.find(nightBefore) ?? results[0];
  if (row) return noonOf(dayKey(Date.parse(row.starts_at), tz), tz);
  for (let i = 0; i < 8; i++) {
    const ms = ctx.nowMs + i * 86_400_000;
    const wd = new Date(`${dayKey(ms, group.timezone)}T12:00:00Z`).getUTCDay();
    if (wd === 2 || wd === 4) return noonOf(dayKey(ms, group.timezone), group.timezone);
  }
  return ctx.nowMs;
}

interface MarkRow {
  session_id: string;
  task: string;
  kind: string;
  detail: string | null;
  at: string;
}

const SC_TASKS = Object.values(SC);

async function marksFor(db: D1Database, groupId: string, ids: string[]): Promise<MarkRow[]> {
  if (ids.length === 0) return [];
  const { results } = await db
    .prepare(`SELECT session_id, task, kind, detail, at FROM task_log WHERE group_id = ? AND task IN (${SC_TASKS.map(() => '?').join(',')}) AND session_id IN (${ids.map(() => '?').join(',')})`)
    .bind(groupId, ...SC_TASKS, ...ids)
    .all<MarkRow>();
  return results;
}

/** Who is in, who has paid (the organizer's own seat counts as covered), who still owes. */
export function factsOf(roster: readonly RosterRow[], organizerId: string | null, owes: ReadonlyMap<string, number> = new Map()) {
  const inRows = confirmedOf([...roster]);
  const others = inRows.filter((r) => r.player_id !== organizerId);
  const paid = others.filter((r) => r.payment_status === 'paid').length + (inRows.length > others.length ? 1 : 0);
  const unpaid: ScUnpaid[] = others
    .filter((r) => r.payment_status !== 'paid')
    .map((r) => ({ playerId: r.player_id, name: r.display_name, owesCents: owes.get(r.player_id) ?? 0, phone: r.phone_number }));
  return { inCount: inRows.length, paidCount: paid, unpaid };
}

function gameOf(s: SessionRow, facts: ReturnType<typeof factsOf>, marks: MarkRow[]): ScGame {
  const mine = marks.filter((m) => m.session_id === s.id);
  return {
    id: s.id,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    canceled: s.status === 'canceled',
    booked: s.booking_status === 'booked',
    canceledAt: s.canceled_at,
    canceledBy: s.canceled_by,
    createdAt: s.created_at ?? '1970-01-01T00:00:00.000Z',
    extra: !!s.is_extra,
    ...facts,
    marks: new Set(mine.filter((m) => m.kind === 'mark').map((m) => m.task)),
    reopenedFrom: mine.find((m) => m.kind === 'mark' && m.task === SC.reopened)?.detail ?? null,
  };
}

/** Games within a day either side of `nowMs` (the only ones these features can be about). */
const near = (s: { starts_at: string }, nowMs: number) => Math.abs(Date.parse(s.starts_at) - nowMs) < 36 * 3600_000;

/**
 * The dashboard's Second Chance part (only while on): the Home cards, "now" for these features, and on a preview the fake Telegrams.
 * `views`: the dashboard's own game views (their owed amounts), so a Request button asks for exactly what the Money screens say.
 */
export async function secondChanceView(
  ctx: Ctx,
  group: GroupRow,
  sessions: readonly SessionRow[],
  rosters: ReadonlyMap<string, RosterRow[]>,
  organizerId: string | null,
  views: readonly AdminSessionView[],
  playerLink: string,
): Promise<NonNullable<AdminDashboard['secondChance']>> {
  const nowMs = await scNowMs(ctx, group);
  const tz = group.timezone;
  const today = sessions.filter((s) => near(s, nowMs));
  const marks = await marksFor(ctx.db, group.id, today.map((s) => s.id));
  const games = today.map((s) => {
    const view = views.find((x) => x.id === s.id);
    const owes = new Map((view?.roster ?? []).map((r) => [r.playerId, r.owesCents]));
    return gameOf(s, factsOf(rosters.get(s.id) ?? [], organizerId, owes), marks);
  });
  const alsoToday = pretendNoon(ctx) ? dayKey(ctx.nowMs, tz) : null;
  const cards = secondChanceCards(games, nowMs, tz, siteAddress(playerLink), alsoToday);
  const fake = isPreviewTest(ctx)
    ? marks
        .filter((m) => m.kind === 'sent' && (m.task === SC.pingIn || m.task === SC.pingPaid) && m.detail)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((m) => ({ at: m.at, sessionId: m.session_id, text: m.detail! }))
    : [];
  return {
    now: new Date(nowMs).toISOString(),
    cards,
    ...(isPreviewTest(ctx) ? { preview: true as const, fakeTelegrams: fake } : {}),
    ...(pretendNoon(ctx) ? { pretendNoon: true as const } : {}),
  };
}

// ---------- The card's taps ----------

/**
 * POST /api/admin/sessions/:id/second-chance { action, minutes? }
 *   booking  step 1's Book a court was tapped (the card moves to step 2)
 *   dismiss  the X (no Second Chance card for this game)
 *   reopen   step 2's Reopen game: the site's own Reopen of the canceled game, then (a new time) its own time change
 *   cancel   the cutoff card's Cancel game: the site's own cancel, no fee asked (the court was never booked)
 * `reopen` and `cancel` are passed in from server/admin.ts (the existing decide and reschedule), so every money rule is theirs.
 */
export async function secondChanceAction(
  ctx: Ctx,
  body: Record<string, unknown>,
  tools: { decide: (ctx: Ctx, body: Record<string, unknown>) => Promise<unknown>; reschedule: (ctx: Ctx, body: Record<string, unknown>) => Promise<unknown> },
) {
  const group = await requireAdmin(ctx);
  if (!(await secondChanceFor(ctx, group.id))) throw new HttpError(404, 'not_found', 'Not found.');
  const action = v.oneOf(body.action, 'action', ['booking', 'dismiss', 'reopen', 'cancel'] as const);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  const nowMs = await scNowMs(ctx, group);
  const tz = group.timezone;
  const organizerId = await organizerIdOf(ctx.db, group);
  const rows = await marksFor(ctx.db, group.id, [session.id]);
  const game = gameOf(session, factsOf(await loadRoster(ctx.db, session.id), organizerId), rows);
  const sentMarks = new Set(rows.filter((m) => m.kind === 'sent').map((m) => m.task));

  if (action === 'booking' || action === 'dismiss') {
    await mark(ctx.db, group.id, session.id, action === 'booking' ? SC.booking : SC.dismissed, null, ctx.nowIso);
    return { ok: true };
  }

  if (action === 'cancel') {
    if (session.status === 'canceled') return { ok: true, changed: false };
    // Only what the card offers right now: a reopened or same-day game still under 4 inside the last two hours (a 4th who joined since the
    // screen was drawn, a booked game, a regular game: refused, look again).
    const card = secondChanceCards([game], nowMs, tz, '', pretendNoon(ctx) ? dayKey(ctx.nowMs, tz) : null)[0];
    if (!card || card.kind !== 'open' || card.step !== 'cutoff') throw new HttpError(409, 'changed', 'This game just changed. Look again.');
    // Once 4 had paid (Telegram 2 went), the court may have been booked on CourtReserve: the usual cancel asks about the fee instead.
    if (sentMarks.has(SC.pingPaid)) throw new HttpError(409, 'maybe_booked', 'Four had paid, so the court may be booked. Use the gear menu > Cancel session to answer the fee question.');
    // Never booked, so no fee: the plain cancel (everyone's money back as credit), with the late-fee question answered for it.
    const out = await tools.decide(ctx, { decision: 'cancel', confirm: true, venueWaived: true, chargedCents: 0 });
    await mark(ctx.db, group.id, session.id, SC.cut, null, ctx.nowIso);
    return out;
  }

  // Reopen. Already reopened from the card (a retry after a time change that did not save): only the time change is left to do.
  const already = game.marks.has(SC.reopened) && session.status !== 'canceled';
  if (!already && !isChance(game, nowMs, tz)) throw new HttpError(409, 'not_second_chance', 'This game is not a Second Chance game any more. Look again.');
  const choices = pickTimes(session.starts_at, tz, nowMs);
  const minutes = body.minutes === undefined || body.minutes === null ? null : Number(body.minutes);
  if (minutes !== null && !choices.includes(minutes)) throw new HttpError(400, 'invalid_time', 'Pick one of the times shown.');
  const p = localParts(Date.parse(session.starts_at), tz);
  const newStart = minutes === null ? session.starts_at : new Date(zonedTimeToUtc(p.year, p.month, p.day, Math.floor(minutes / 60), minutes % 60, tz)).toISOString();
  const moved = newStart !== session.starts_at;
  const length = Date.parse(session.ends_at) - Date.parse(session.starts_at);
  const move = () => tools.reschedule(ctx, { startsAt: newStart, endsAt: new Date(Date.parse(newStart) + length).toISOString() });
  if (already) {
    if (moved) await move();
    return { ok: true, changed: moved };
  }
  if (moved) {
    const clash = await ctx.db.prepare('SELECT 1 AS x FROM sessions WHERE group_id = ? AND starts_at = ? AND id <> ?').bind(group.id, newStart, session.id).first();
    if (clash) throw new HttpError(409, 'time_taken', "There's already a game at that time. Pick another time.");
  }
  // The mark first (the original time goes with it, for TEXT 2's "(instead of 7:30)"), so a reopened game is never left without its card;
  // taken back if the reopen itself does not go through.
  await mark(ctx.db, group.id, session.id, SC.reopened, session.starts_at, ctx.nowIso);
  try {
    await tools.decide(ctx, { decision: 'reopen' });
  } catch (err) {
    if ((await getSession(ctx.db, group.id, session.id))?.status === 'canceled') {
      await ctx.db.prepare("DELETE FROM task_log WHERE session_id = ? AND task = ? AND kind = 'mark'").bind(session.id, SC.reopened).run();
    }
    throw err;
  }
  if (moved) await move();
  return { ok: true, changed: true };
}

async function mark(db: D1Database, groupId: string, sessionId: string, task: string, detail: string | null, nowIso: string) {
  await db
    .prepare("INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, ?, ?, 'mark', ?, ?)")
    .bind(newId(), groupId, sessionId, task, detail, nowIso)
    .run();
}

// ---------- The two Telegrams ----------

/** Does Telegram 1 or 2 stand in for the old "has 4 now, it's on" alert on this game (Second Chance on for everyone, today, not booked)? */
export async function secondChanceTakesReached(ctx: Ctx, group: GroupRow, s: SessionRow): Promise<boolean> {
  try {
    if (!secondChanceAllowed(ctx.env.SECOND_CHANCE) || !(await secondChanceForAll(ctx.db, group.id))) return false;
    return counts({ startsAt: s.starts_at, canceled: s.status === 'canceled', booked: s.booking_status === 'booked' }, await scNowMs(ctx, group), group.timezone);
  } catch {
    return false;
  }
}

/** A failed Telegram is tried again on later taps or ticks, at most this many times in all. */
const MAX_TRIES = 3;
/** No Telegram before this hour (Eastern). */
export const QUIET_UNTIL_HOUR = 7;

/** The routes after which a game's Telegrams are checked (joins, pays, the organizer's roster and payment taps). */
const TAP = /^\/api\/(?:admin\/)?sessions\/([^/]+)\/(?:join|withdraw|paid|use-credit|undo-credit|use-cash-out|confirm|still-in|decline|payment|roster|me|claim|second-chance|booking|court-status|court|time|decision)$/;

/**
 * Before a tap runs (server/app.ts): is it a tap on a game whose Telegrams must be checked afterwards? The game's id, or null. The one
 * switch read happens here, BEFORE the tap, so with the switch off nothing at all happens after the tap's own work (the same order of
 * database work as main). Never for the demo, Pretend, the read-only PIN, or a GET.
 */
export async function tapWatch(ctx: Ctx, method: string, path: string): Promise<string | null> {
  if (method === 'GET' || method === 'HEAD') return null;
  const m = TAP.exec(path);
  if (!m) return null;
  if (ctx.env.SANDBOX || isPretend(ctx.db) || viewOnlyCookie(ctx) || !secondChanceAllowed(ctx.env.SECOND_CHANCE)) return null;
  try {
    // One read, no group needed (the site has one group): the Settings row.
    const on = await ctx.db.prepare("SELECT 1 AS x FROM task_log WHERE session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1").bind(SECOND_CHANCE.task).first();
    return on ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * After a successful tap that tapWatch picked, inside the request: check that game's Telegrams. A due Telegram is claimed here, in order
 * with the tap; only the send itself goes on in the background. Never worth failing a tap over.
 */
export async function afterTap(ctx: Ctx, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  try {
    await checkPings(ctx, sessionId, null, true);
  } catch {
    // An alert is never worth failing a tap over.
  }
}

/** The 5-minute clock: today's games (Telegrams for taps that came in another way, like a link from a text). */
export async function tickPings(ctx: Ctx, group: GroupRow): Promise<void> {
  try {
    if (!secondChanceAllowed(ctx.env.SECOND_CHANCE)) return;
    await checkPings(ctx, null, group);
  } catch {
    // Never breaks the tick.
  }
}

/** Check one game (a tap) or every game today (the clock), and send what is due. Returns how many went out (or were faked). */
export async function checkPings(ctx: Ctx, sessionId: string | null, group: GroupRow | null = null, background = false): Promise<number> {
  if (ctx.env.SANDBOX || isPretend(ctx.db)) return 0;
  const g = group ?? (await ctx.db.prepare('SELECT * FROM groups ORDER BY created_at LIMIT 1').first<GroupRow>());
  if (!g || !(await secondChanceForAll(ctx.db, g.id))) return 0;
  const fake = isPreviewTest(ctx);
  if (!fake) {
    if (!connected(ctx.env)) return 0;
    const prefs = prefsOf(await ctx.db.prepare('SELECT * FROM organizer_alerts WHERE group_id = ?').bind(g.id).first<AlertRow>());
    if (!prefs.enabled) return 0;
  }
  const nowMs = await scNowMs(ctx, g);
  const tz = g.timezone;
  // Never in the night: nothing before 7:00 AM (the 7:00 AM tick sends what came due overnight).
  if (localParts(nowMs, tz).hour < QUIET_UNTIL_HOUR) return 0;
  const rows = sessionId
    ? [await getSession(ctx.db, g.id, sessionId)].filter((s): s is SessionRow => !!s)
    : (
        await ctx.db
          .prepare("SELECT * FROM sessions WHERE group_id = ? AND status <> 'canceled' AND booking_status <> 'booked' AND starts_at > ? AND starts_at < ? ORDER BY starts_at")
          .bind(g.id, new Date(nowMs).toISOString(), new Date(nowMs + 86_400_000).toISOString())
          .all<SessionRow>()
      ).results;
  const live = rows.filter((s) => counts({ startsAt: s.starts_at, canceled: s.status === 'canceled', booked: s.booking_status === 'booked' }, nowMs, tz));
  if (live.length === 0) return 0;
  const organizerId = await organizerIdOf(ctx.db, g);
  const site = (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');
  let sent = 0;
  for (const s of live) {
    const roster = await loadRoster(ctx.db, s.id);
    const facts = factsOf(roster, organizerId);
    const { results: logRows } = await ctx.db
      .prepare(`SELECT task, kind FROM task_log WHERE session_id = ? AND task IN (?, ?) AND kind IN ('sent', 'failed')`)
      .bind(s.id, SC.pingIn, SC.pingPaid)
      .all<{ task: string; kind: string }>();
    const has = (task: string, kind: string) => logRows.filter((r) => r.task === task && r.kind === kind).length;
    const due = duePing({ startsAt: s.starts_at, canceled: false, booked: false, inCount: facts.inCount, paidCount: facts.paidCount }, { in: has(SC.pingIn, 'sent') > 0, paid: has(SC.pingPaid, 'sent') > 0 }, nowMs, tz);
    if (!due) continue;
    const task = due === 'in' ? SC.pingIn : SC.pingPaid;
    if (has(task, 'failed') >= MAX_TRIES) continue;
    const text =
      due === 'in'
        ? pingInMessage(s.starts_at, facts.inCount, facts.paidCount, facts.unpaid, tz, nowMs, facts.unpaid.some((u) => !!u.phone) ? `${site}/admin?unpaid=${s.id}` : null)
        : pingPaidMessage(s.starts_at, facts.inCount, facts.paidCount, tz, nowMs, COURTRESERVE_BOOKING_URL);
    // Claimed before sending (the table's unique index): two taps at once can never both send it. Only while the game is still on and
    // not booked: a cancel or booking saved since this check read the game stops it here.
    const claimId = newId();
    const claim = await ctx.db
      .prepare(
        `INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, detail, at)
         SELECT ?1, ?2, ?3, ?4, 'sent', ?5, ?6 WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?3 AND status <> 'canceled' AND booking_status <> 'booked')`,
      )
      .bind(claimId, g.id, s.id, task, text, ctx.nowIso)
      .run();
    if (claim.meta.changes !== 1) continue;
    if (fake) {
      sent++;
      continue;
    }
    // The same rules as the clock's own alerts (server/tasks.ts): the hour's limit is not a try (the claim goes back, a later tap or tick
    // sends it); Telegram too slow to answer may still have delivered it, so the claim stays (a missed alert beats a double one); any other
    // failure gives the claim back and counts as a try.
    const send = async () => {
      const out = await deliver(ctx, g.id, text);
      if (out.ok) return true;
      if (out.error.startsWith(PAUSED_PREFIX)) {
        await ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId).run();
        return false;
      }
      const logFailure = ctx.db
        .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, ?, ?, 'failed', ?, ?)")
        .bind(newId(), g.id, s.id, task, out.error.slice(0, 200), ctx.nowIso);
      if (out.error === TIMEOUT_ERROR) await logFailure.run();
      else await ctx.db.batch([ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId), logFailure]);
      return false;
    };
    // After a tap the answer does not wait for Telegram (the same as every other alert); the clock waits for it.
    if (background) {
      ctx.waitUntil(send().catch(() => false));
      sent++;
    } else if (await send()) sent++;
  }
  return sent;
}

/** The phone numbers and words Telegram 1's link opens (only the unpaid players), for the signed-in organizer's own Home. */
export type { ScUnpaid };
