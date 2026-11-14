import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { courtCostOf, priceLockCol, settingsOf, audit, type GroupRow, type SessionRow } from './repo';
import { HttpError } from './http';
import {
  dueAlerts,
  earliestGameDate,
  localYmd,
  PAID_PREFIX,
  paidTask,
  startOfDayMs,
  addDays,
  VENUE_ALERT,
  venueAlertAllowed,
  venueDaysChangedAt,
  venueDaysOf,
  type ChargeKind,
  type VenueAlert,
  type VenueDays,
  type VenueGame,
} from '../shared/venueAlert';

// Zip 43: VENUE_ALERT (shared/venueAlert.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?venuealert=on
//    (it then sends X-Venue-Alert, plus X-Venue-Alert-Since: when that phone first opened the link; a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored. Its `at` is the moment
// the switch went on: charge days that began before it never make an alert (no backfill).
// Which months were marked paid are more task_log rows of the same kind (task `venue_paid:court:2026-11`), also with no game. The two charge days
// are kept in the group's settings_json (`venueDays`), next to the Zelle number. Display only; no price, seat, credit or text reads any of it.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, VENUE_ALERT.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const venueAlertForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

/**
 * Turns the Settings row on or off. Returns false when nothing changed. On while it is already on does NOTHING: the row's time is the no-backfill start,
 * so a second "on" (another phone, a retry) must never move it forward and hide a charge that is still unpaid.
 */
export async function setVenueAlertForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<boolean> {
  if (on && (await forAll(db, groupId))) return false;
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, VENUE_ALERT.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, VENUE_ALERT.task, nowIso).run();
  }
  return true;
}

/** The switch for this screen, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function venueAlertFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(VENUE_ALERT.header) ?? '').toLowerCase() === 'on';
  return { on: venueAlertAllowed(ctx.env.VENUE_ALERT) && (header || row), forAll: row };
}

/**
 * The moment this request's switch went on: the Settings row's own time (it is "on for everyone" from then), else the moment this phone first opened the
 * private link (sent by the phone), never later than now. A phone that sent nothing readable starts now: no old charge day can show.
 */
async function onSince(ctx: Ctx, groupId: string, rowOn: boolean): Promise<number> {
  if (rowOn) {
    const row = await ctx.db.prepare("SELECT at FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1").bind(groupId, VENUE_ALERT.task).first<{ at: string }>();
    const t = row ? Date.parse(row.at) : NaN;
    if (Number.isFinite(t)) return t;
  }
  const since = Number(ctx.req.headers.get(VENUE_ALERT.sinceHeader) ?? '');
  return Number.isFinite(since) && since > 0 && since <= ctx.nowMs ? since : ctx.nowMs;
}

/** Which "court:2026-11" style charges are already marked paid. */
async function paidRows(db: D1Database, groupId: string): Promise<{ keys: Set<string>; courtThrough: string | null }> {
  const { results } = await db
    .prepare("SELECT task, detail FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND task LIKE ?")
    .bind(groupId, `${PAID_PREFIX}%`)
    .all<{ task: string; detail: string | null }>();
  let courtThrough: string | null = null;
  for (const r of results) {
    if (!r.task.slice(PAID_PREFIX.length).startsWith('court:')) continue;
    try {
      const date = (JSON.parse(r.detail ?? '{}') as { date?: unknown }).date;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!courtThrough || date > courtThrough)) courtThrough = date;
    } catch {
      /* a row without a readable date: ignored */
    }
  }
  return { keys: new Set(results.map((r) => r.task.slice(PAID_PREFIX.length))), courtThrough };
}
async function paidKeys(db: D1Database, groupId: string): Promise<Set<string>> {
  return (await paidRows(db, groupId)).keys;
}

/** The cards due right now (oldest charge day first) and the two days, from the site's own numbers. Read only. */
export async function venueAlertsNow(ctx: Ctx, group: GroupRow, rowOn: boolean): Promise<{ alerts: VenueAlert[]; days: VenueDays }> {
  const days = venueDaysOf(group.settings_json);
  const settings = settingsOf(group);
  const tz = group.timezone;
  // No backfill: the later of the switch going on and the charge days last being changed (a moved day never brings back a day that already passed).
  const onAtMs = Math.max(await onSince(ctx, group.id, rowOn), venueDaysChangedAt(group.settings_json));
  const first = earliestGameDate(days, onAtMs, ctx.nowMs, tz);
  if (!first) return { alerts: [], days };
  // Every game from the first period's first day through today (Eastern calendar days, so a 11:30 PM game on the 30th is November).
  const from = new Date(startOfDayMs(first, tz)).toISOString();
  const to = new Date(startOfDayMs(addDays(localYmd(ctx.nowMs, tz), 1), tz)).toISOString();
  const { results } = await ctx.db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`)
    .bind(group.id, from, to)
    .all<SessionRow>();
  // The same per-game cost Money > Totals uses (the game's own court cost, else the Typical court cost, priced by its length).
  const games: VenueGame[] = results.map((s) => ({ startsAt: s.starts_at, booked: s.booking_status === 'booked', canceled: s.status === 'canceled', costCents: courtCostOf(s, settings) }));
  const paid = await paidRows(ctx.db, group.id);
  const alerts = dueAlerts({ days, membershipCents: settings.monthlyMembershipCents, games, nowMs: ctx.nowMs, tz, onAtMs, paid: paid.keys, courtPaidThrough: paid.courtThrough });
  return { alerts, days };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const KEY_RE = /^(court|membership):\d{4}-\d{2}$/;

/**
 * POST /api/admin/venue-alert/paid { keys, cents }: "Mark paid" on one card. Writes the marked-paid rows and ONE History line ("Venue charge marked
 * paid: $192"), nothing else. Only a card that is due right now can be marked, with the amount the organizer saw (a game that changed since says look again).
 * A second tap on a card that was just marked (or two taps at once) writes nothing more: the rows are written once, and only the tap that wrote them logs.
 */
export async function markVenuePaid(ctx: Ctx, group: GroupRow, body: Record<string, unknown>) {
  const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)) : [];
  if (keys.length === 0 || keys.length > 2 || new Set(keys).size !== keys.length) throw new HttpError(400, 'invalid_keys', 'That card is not something to mark paid.');
  const flags = await venueAlertFlags(ctx, group.id);
  if (!flags.on) throw new HttpError(409, 'switch_off', 'The Venue charge alert is off.');
  const { alerts } = await venueAlertsNow(ctx, group, flags.forAll);
  const card = alerts.find((a) => sameSet(a.keys, keys));
  if (!card) {
    // Already marked (a second tap, or another phone got there first): fine, nothing more is written.
    const paid = await paidKeys(ctx.db, group.id);
    if (keys.every((k) => paid.has(k))) return { ok: true, already: true };
    throw new HttpError(409, 'changed', 'That charge just changed. Look again.');
  }
  if (typeof body.cents !== 'number' || body.cents !== card.cents) throw new HttpError(409, 'changed', 'That amount just changed. Look again.');
  const rows = card.keys.map((k) => {
    const [kind, month] = k.split(':') as [ChargeKind, string];
    return ctx.db
      .prepare(
        `INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at)
         SELECT ?1, ?2, NULL, ?3, 'mark', ?4, ?5
         WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE group_id = ?2 AND session_id IS NULL AND task = ?3 AND kind = 'mark')`,
      )
      .bind(newId(), group.id, paidTask(kind, month), JSON.stringify({ cents: card.cents, date: card.date }), ctx.nowIso);
  });
  const out = await ctx.db.batch(rows);
  // Only the tap that wrote the first row logs; a double tap or a second phone finds it already there and writes nothing.
  if (out[0].meta.changes === 1) {
    await audit(ctx.db, group.id, null, 'venue_charge_paid', { cents: card.cents, keys: card.keys, date: card.date, line: card.line }, ctx.nowIso);
    return { ok: true, already: false };
  }
  return { ok: true, already: true };
}
