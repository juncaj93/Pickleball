// Zip 94 (🎾94.early bird): the switch and the organizer's gear sheet rows. The rule itself is shared/earlyBird.ts; the taps that use it are in
// server/tournamentTickets.ts, the views in server/tournament.ts.
//
//   PUT /api/admin/early-bird-switch        { on }                         Settings > Feature switches > Early bird pricing (ships OFF)
//   PUT /api/admin/tournament/:id/early     { earlyCents, until }          the gear sheet's "Early price" and "Early price until" (null, null: none)
//
// The switch's Settings row decides every price, for everyone alike (money is never different from one phone to another). The private link
// (/admin?earlybird=on) only shows the gear sheet's two rows on that organizer phone, so Alex can set one up before switching it on.
import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit } from './repo';
import { requireAdmin } from './auth';
import { EARLY_BIRD, earlyBirdAllowed } from '../shared/earlyBird';
import { formatPrice } from '../shared/money';
import { defaultPayBy, payByLabel } from '../shared/tournamentTickets';
import { NIGHT_START_MINUTES } from '../shared/tournament';
import { changedOrLookAgain, openById, organizerOn, OPEN_GUARD, statusOf, storedDays, type TournamentRow } from './tournament';
import { sqlText } from './tournamentMoney';

/** The one switch question (server/speed.ts answers it from the one read of every switch row). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

/** The Settings row: on for everyone. */
export async function earlyBirdForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, EARLY_BIRD.task).first().catch(() => null);
  return !!row;
}

export async function setEarlyBirdForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, EARLY_BIRD.task),
    ...(on ? [db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, EARLY_BIRD.task, nowIso)] : []),
  ]);
}

/**
 * Prices: the kill switch allows it and the Settings row is on. The same answer for every phone. A tournament with no early price set (The Cold
 * Open) never asks: nothing to price differently, and no read.
 */
export async function earlyBirdOn(ctx: Ctx, groupId: string, t: { early_cents?: number | null; early_on?: number | null }): Promise<boolean> {
  if (t.early_cents === null || t.early_cents === undefined) return false;
  if (!earlyBirdAllowed(ctx.env.EARLY_BIRD)) return false;
  // The row's own read carried the switch (server/tournament.ts START_COL): no read of its own.
  return t.early_on !== undefined ? !!t.early_on : earlyBirdForAll(ctx.db, groupId);
}

/** The organizer's screens: prices on (`on`), the Settings row (`forAll`), and the gear sheet's rows shown (`rows`: on, or this phone's link). */
export async function earlyBirdFlags(ctx: Ctx, groupId: string, carried?: number | null): Promise<{ on: boolean; forAll: boolean; rows: boolean }> {
  const allowed = earlyBirdAllowed(ctx.env.EARLY_BIRD);
  // `carried`: the switch row as the tournament row's own read carried it (no read of its own).
  const forAll = carried !== undefined ? !!carried : await earlyBirdForAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(EARLY_BIRD.header) ?? '').trim().toLowerCase() === 'on';
  return { on: allowed && forAll, forAll, rows: allowed && (forAll || header) };
}

/** SQL (inside an UPDATE of tournaments): someone has locked in or put money on a ticket (the organizer's $0 seat does not count). */
export const earlyLockedSql = (x = 'tournaments.id') =>
  `EXISTS (SELECT 1 FROM tournament_tickets k WHERE k.tournament_id = ${x} AND k.price_cents > 0 AND (k.place = 'spot' OR k.credit_cents + k.paid_cents + k.claim_cents > 0))`;

/** The same rule over tickets already read. */
export const earlyLocked = (tickets: readonly { price_cents: number; place: string; credit_cents: number; paid_cents: number; claim_cents: number }[]): boolean =>
  tickets.some((k) => k.price_cents > 0 && (k.place === 'spot' || k.credit_cents + k.paid_cents + k.claim_cents > 0));

/**
 * The latest an early deadline may be: before Pay by. Before tickets open (no Pay by yet), before the Pay by that picking the date would set
 * (the night before at 7 PM) for the picked date, else for the EARLIEST date offered, so no date pick can ever put Pay by before it.
 */
export function earlyLatestMs(t: TournamentRow, tz: string, nowMs: number): number {
  if (t.pay_by) return Date.parse(t.pay_by);
  const days = t.final_date ? [t.final_date] : storedDays(t.offered_dates);
  return days.length ? Math.min(...days.map((d) => Date.parse(defaultPayBy(d, NIGHT_START_MINUTES, tz, nowMs)))) : Infinity;
}

/**
 * PUT /api/admin/tournament/:id/early { earlyCents, until }: the gear sheet's Early price and Early price until. Both empty (null): no early
 * bird. Rules (Alex): the early price is lower than the ticket price, the deadline is still to come and before Pay by, and neither can be added
 * or changed once anyone has locked in (checked again in the very statement that saves it).
 */
export async function setEarlyBird(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (statusOf(t) === 'canceled') throw new HttpError(409, 'tournament_changed', 'This tournament was canceled. Look again.');
  const cents = body.earlyCents === null || body.earlyCents === undefined ? null : v.cents(body.earlyCents, 'earlyCents');
  const until = body.until === null || body.until === undefined || body.until === '' ? null : v.isoTime(body.until, 'until');
  if ((cents === null) !== (until === null)) throw new HttpError(400, 'invalid_early', cents === null ? 'Type an early price, or clear the day.' : 'Pick the day the early price ends.');
  if (cents !== null && until !== null) {
    if (cents % 100 !== 0) throw new HttpError(400, 'invalid_early', 'Type the early price in whole dollars.');
    if (cents <= 0 || cents >= t.ticket_cents) throw new HttpError(400, 'invalid_early', `The early price must be lower than the ticket price (${formatPrice(t.ticket_cents)}).`);
    const ms = Date.parse(until);
    if (ms <= ctx.nowMs) throw new HttpError(400, 'invalid_early', 'Pick an early price end that has not passed.');
    if (ms >= earlyLatestMs(t, group.timezone, ctx.nowMs)) {
      throw new HttpError(400, 'invalid_early', t.pay_by ? `Pick an end before Pay by (${payByLabel(t.pay_by, group.timezone, t.final_date)}).` : 'Pick an end before Pay by (the night before the tournament, 7 PM).');
    }
  }
  const same = (t.early_cents ?? null) === cents && (t.early_until ?? null) === until;
  if (same) return { ok: true, changed: false };
  const res = await ctx.db
    .prepare(
      `UPDATE tournaments SET early_cents = ?1, early_until = ?2, updated_at = ?3
       WHERE id = ?4 AND group_id = ?5 ${OPEN_GUARD} AND ticket_cents = ?6 AND early_cents IS ?7 AND early_until IS ?8
         AND (pay_by IS NULL OR ?2 IS NULL OR ?2 < pay_by)
         AND NOT ${earlyLockedSql()}`,
    )
    .bind(cents, until, ctx.nowIso, t.id, group.id, t.ticket_cents, t.early_cents ?? null, t.early_until ?? null)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    const locked = await ctx.db.prepare(`SELECT 1 AS x FROM tournaments WHERE id = ? AND ${earlyLockedSql()}`).bind(t.id).first().catch(() => null);
    if (locked) throw new HttpError(409, 'early_locked', 'Players have locked in. The early price stays as it is.');
    changedOrLookAgain(res);
  }
  await audit(
    ctx.db,
    group.id,
    null,
    cents === null ? 'tournament_early_off' : 'tournament_early_set',
    { tournament: t.name, ...(cents !== null && until ? { earlyCents: cents, until: payByLabel(until, group.timezone, t.final_date), priceCents: t.ticket_cents } : {}) },
    ctx.nowIso,
  );
  return { ok: true, changed: true };
}

/** SQL guard for a ticket tap: the early bird exactly as read (a change in between: the tap says "look again"). */
export const earlyAsReadSql = (t: TournamentRow) => `early_cents IS ${t.early_cents === null || t.early_cents === undefined ? 'NULL' : Number(t.early_cents) | 0} AND early_until IS ${t.early_until ? sqlText(t.early_until) : 'NULL'}`;

/** PUT /api/admin/early-bird-switch { on }: the Settings row, for everyone. Off: every price is the ticket price, exactly as before. */
export async function setEarlyBirdSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setEarlyBirdForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'early_bird_on' : 'early_bird_off', {}, ctx.nowIso);
  return { ok: true, on };
}
