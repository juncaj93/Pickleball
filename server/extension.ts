// Zip 31, "Extended time" (EXTENDED_TIME, shared/extension.ts): the money moves for extra court time.
//
// The whole design in five lines:
//  1. A game's extension (+30 min / +1 hr) is set at Finalize, in the SAME all-or-nothing batch as the finalize itself.
//  2. Each player's share lives on their own seat of that game (session_players.ext_*), so it belongs to the person, not to a later
//     game: dropping out of the next game, never playing again or a reopen of the NEXT game never touches it.
//  3. Setting a share is "move to this number": credit (net) + cash already put toward it is compared with the new share. Too much
//     comes back as credit (a credit_ledger 'kept' row), too little is owed again, and usable credit is used at once for what is owed
//     (a 'used' row). Both rows carry reason 'ext:<game id>' and NO session_id, so no seat of any game ever counts them as its own.
//  4. Reopen moves every share of that game to $0 first (credit back for whatever was put toward it), so a redo starts clean and
//     nothing is charged twice; the redo then sets the new shares and uses that credit again.
//  5. Paying: "Pay now instead" (an I paid on the shares themselves), or together with the next game ("$17 due": the seat's I paid
//     also claims the shares, `ext_via` = that seat). The organizer's Mark paid confirms, Unmark undoes the latest payment.
// Every statement is guarded by the seat's own extension numbers as they were read, so a second device or a retry changes nothing.

import { guestIn } from '../shared/guestSpot';
import type { Ctx } from './context';
import type { D1Database, D1PreparedStatement } from './db';
import { newId } from './crypto';
import { HttpError } from './http';
import { USABLE } from './credit';
import { audit, type GroupRow, loadRoster, organizerIdOf, type RosterRow, type SessionRow } from './repo';
import * as v from './validate';
import {
  EXTENDED_TIME,
  type ExtShareView,
  extendedTimeAllowed,
  extOwed,
  extReasonColumn,
  isExtraMinutes,
  type ExtraMinutes,
  extensionSplitHeads,
} from '../shared/extension';
import { formatPrice } from '../shared/money';

// ---------- The switch ----------
// On for a request when its wrangler.toml var is not "off" (the kill switch) and the organizer switched it on in Settings > Feature
// switches (every phone), or this phone opened the site with ?extendedtime=on (it then sends X-Extended-Time: a private test switch).

const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  return !!(await db.prepare(SWITCH_READ).bind(groupId, EXTENDED_TIME.task).first().catch(() => null));
}

export const extendedTimeForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setExtendedTimeForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, EXTENDED_TIME.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, EXTENDED_TIME.task, nowIso).run();
  }
}

export async function extendedTimeFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!extendedTimeAllowed(ctx.env.EXTENDED_TIME)) return false;
  // Preview only (EXTENDED_TIME_PREVIEW exists only in [env.preview.vars], never [vars]; a test checks): this zip's preview shows it
  // whatever the shared fake database's Settings row says (another channel's re-seed can drop the row). The demo copy gets it too.
  if ((ctx.env.EXTENDED_TIME_PREVIEW ?? '').trim().toLowerCase() === 'on') return true;
  if ((ctx.req.headers.get(EXTENDED_TIME.header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

// ---------- Setting a game's shares ----------

/** A value put straight into SQL text (an id or a time this server made), refused if it could break out of quotes. */
function sqlText(value: string): string {
  if (!/^[0-9A-Za-z:.\-]+$/.test(value)) throw new Error('unsafe sql text');
  return `'${value}'`;
}
const int = (n: number | null | undefined) => {
  const x = Number(n ?? 0);
  if (!Number.isInteger(x)) throw new Error('not a whole number');
  return x;
};

/** The seat's extension numbers are still exactly what was read (SQL). */
export function seatAsRead(r: RosterRow): string {
  const share = r.ext_cents === null || r.ext_cents === undefined ? 'ext_cents IS NULL' : `ext_cents = ${int(r.ext_cents)}`;
  return `EXISTS (SELECT 1 FROM session_players WHERE id = ${sqlText(r.id)} AND ${share} AND ext_credit_cents = ${int(r.ext_credit_cents)}
    AND ext_paid_cents = ${int(r.ext_paid_cents)} AND ext_claim_cents = ${int(r.ext_claim_cents)})`;
}

export interface ShareChange {
  playerId: string;
  name: string;
  seatId: string;
  fromCents: number;
  toCents: number;
  /** Put toward the share above the new share: comes back as credit. */
  backCents: number;
  /** Still owed after the change, before credit is used (the credit used is worked out in the database, up to this). */
  owedBeforeCreditCents: number;
  /** The 'used' row this change may write (its amount is read back after the batch). */
  usedId: string | null;
}

export interface ExtensionPlan {
  minutes: ExtraMinutes;
  costCents: number;
  shareCents: number;
  payers: number;
  organizerCents: number;
  changes: ShareChange[];
  statements: D1PreparedStatement[];
  /** Index in `statements` of each change's seat update (its `changes` must be 1). */
  seatStatement: number[];
}

/**
 * The statements that move every share of `session` to what `minutes` and `playedIds` say (the organizer never pays a share).
 * `guard` is SQL every statement must also meet (Finalize: "this finalize went in"). Refuses (409) where an I paid the organizer has
 * not confirmed would have to come back as credit (only confirmed money becomes credit, the site's rule).
 */
export function extensionPlan(
  db: D1Database,
  args: { groupId: string; session: SessionRow; roster: RosterRow[]; organizerId: string | null; playedIds: Set<string>; minutes: ExtraMinutes; nowIso: string; guard: string; guestsOut?: Set<string> },
): ExtensionPlan {
  const { groupId, session, roster, organizerId, playedIds, minutes, nowIso, guard } = args;
  const confirmedPlayed = roster.filter((r) => r.status === 'confirmed' && playedIds.has(r.player_id));
  const organizerPlayed = !!organizerId && confirmedPlayed.some((r) => r.player_id === organizerId);
  // Zip 42 round 2 (Alex): a guest who played takes a seat, so the host pays a second share. `guestsOut` (Finalize) says whose guest did
  // not play; without it the seat's own guest_played says (a Reopen putting shares back). No guest: exactly as before.
  const guestPlayed = (r: RosterRow) => guestIn(r) && playedIds.has(r.player_id) && (args.guestsOut ? !args.guestsOut.has(r.player_id) : r.guest_played !== 0);
  const heads = confirmedPlayed.length + confirmedPlayed.filter(guestPlayed).length;
  const orgRow = organizerPlayed ? confirmedPlayed.find((r) => r.player_id === organizerId) : undefined;
  const split = extensionSplitHeads(minutes, heads, organizerPlayed ? 1 + (orgRow && guestPlayed(orgRow) ? 1 : 0) : 0);
  const statements: D1PreparedStatement[] = [];
  const seatStatement: number[] = [];
  const changes: ShareChange[] = [];
  // The game itself: written at Finalize with what the venue charged, so a later rate change never rewrites it.
  // (Nothing to write when there is no extension now and there was none: a plain finalize writes exactly what it always wrote.)
  if (minutes > 0 || (session.extra_minutes ?? 0) > 0 || session.extra_cost_cents) {
    statements.push(
      db
        .prepare(`UPDATE sessions SET extra_minutes = ?1, extra_cost_cents = ?2 WHERE id = ?3 AND ${guard}`)
        .bind(minutes > 0 ? minutes : null, minutes > 0 ? split.costCents : null, session.id),
    );
  }
  for (const r of roster) {
    if (r.player_id === organizerId) continue;
    const played = r.status === 'confirmed' && playedIds.has(r.player_id);
    const from = r.ext_cents ?? null;
    const to = played ? split.shareCents * (guestPlayed(r) ? 2 : 1) : 0;
    if (from === null && to === 0) continue;
    if (from === to) continue;
    const credit = int(r.ext_credit_cents);
    const cash = int(r.ext_paid_cents);
    const claim = int(r.ext_claim_cents);
    if (claim > 0 && to < credit + cash + claim) {
      throw new HttpError(
        409,
        'unconfirmed_ext',
        `${r.display_name} tapped I paid for the extra time, not confirmed yet. Confirm it (Mark paid) or clear it first.`,
      );
    }
    const back = Math.max(0, credit + cash - to);
    const creditBase = credit - back;
    const owedBefore = Math.max(0, to - creditBase - cash - claim);
    const same = seatAsRead(r);
    const g = `${guard} AND ${same}`;
    if (back > 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
             SELECT ?1, ?2, ?3, 'kept', ?4, NULL, ?5, ?6 WHERE ${g}`,
          )
          .bind(newId(), groupId, r.player_id, back, nowIso, extReasonColumn(session.id)),
      );
    }
    const usedId = owedBefore > 0 ? newId() : null;
    if (usedId) {
      statements.push(
        db
          .prepare(
            `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
             SELECT ?1, ?2, ?3, 'used', MIN(?4, ${USABLE('?3')}), NULL, ?5, ?6 WHERE ${USABLE('?3')} > 0 AND ${g}`,
          )
          .bind(usedId, groupId, r.player_id, owedBefore, nowIso, extReasonColumn(session.id)),
      );
    }
    seatStatement.push(statements.length);
    statements.push(
      db
        .prepare(
          `UPDATE session_players SET ext_cents = ?1,
             ext_credit_cents = ?2 + COALESCE((SELECT amount_cents FROM credit_ledger WHERE id = ?3), 0),
             ext_at = ?4, ext_seen_at = NULL, updated_at = ?4
           WHERE id = ?5 AND ${g}`,
        )
        .bind(to, creditBase, usedId ?? '', nowIso, r.id),
    );
    changes.push({ playerId: r.player_id, name: r.display_name, seatId: r.id, fromCents: from ?? 0, toCents: to, backCents: back, owedBeforeCreditCents: owedBefore, usedId });
  }
  return { minutes, costCents: split.costCents, shareCents: split.shareCents, payers: split.payers, organizerCents: split.organizerCents, changes, statements, seatStatement };
}

/** After the batch ran: what credit each change used (read back from the rows it wrote), for the history lines. */
export async function creditUsedBy(db: D1Database, plan: ExtensionPlan): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const c of plan.changes) {
    if (!c.usedId) continue;
    const row = await db.prepare('SELECT amount_cents AS c FROM credit_ledger WHERE id = ?').bind(c.usedId).first<{ c: number }>();
    if (row?.c) out.set(c.playerId, row.c);
  }
  return out;
}

/** One plain history line per share that moved (History > Activity), and one for the game. */
export async function auditPlan(db: D1Database, groupId: string, sessionId: string, plan: ExtensionPlan, nowIso: string, why: 'finalize' | 'reopen'): Promise<void> {
  if (plan.changes.length === 0 && plan.minutes === 0 && why === 'reopen') return;
  const used = await creditUsedBy(db, plan);
  if (why === 'finalize') {
    await audit(db, groupId, sessionId, 'extension_set', { minutes: plan.minutes, costCents: plan.costCents, shareCents: plan.shareCents, payers: plan.payers, organizerCents: plan.organizerCents }, nowIso);
  }
  for (const c of plan.changes) {
    await audit(
      db,
      groupId,
      sessionId,
      'extension_share',
      { player: c.name, playerId: c.playerId, fromCents: c.fromCents, toCents: c.toCents, backCents: c.backCents, creditUsedCents: used.get(c.playerId) ?? 0, why },
      nowIso,
    );
  }
}

/** Does this game hold any extension money or record (so a reopen must move it back to $0 first)? */
export function hasExtension(session: SessionRow, roster: RosterRow[]): boolean {
  return (session.extra_minutes ?? 0) > 0 || roster.some((r) => r.ext_cents !== null && r.ext_cents !== undefined);
}

/**
 * Reopen, step one: every share of the game goes to $0 (what was put toward it comes back as credit, an unconfirmed I paid stops it)
 * and the game's extension is cleared. Only while the game is still the finalize that was read. Returns the plan so a Reopen that
 * then fails can put the shares back (`restoreAfterFailedReopen`).
 */
export async function unwindForReopen(ctx: Ctx, group: GroupRow, session: SessionRow): Promise<{ roster: RosterRow[]; played: Set<string>; minutes: ExtraMinutes } | null> {
  const roster = await loadRoster(ctx.db, session.id);
  if (!hasExtension(session, roster)) return null;
  const organizerId = await organizerIdOf(ctx.db, group);
  const minutes = (isExtraMinutes(session.extra_minutes ?? 0) ? (session.extra_minutes ?? 0) : 0) as ExtraMinutes;
  const played = new Set(roster.filter((r) => r.status === 'confirmed' && r.played === 1).map((r) => r.player_id));
  const guard = `(SELECT COALESCE(finalized_at, '') FROM sessions WHERE id = ${sqlText(session.id)}) = ${sqlText(session.finalized_at ?? 'x')}`;
  const plan = extensionPlan(ctx.db, { groupId: group.id, session, roster, organizerId, playedIds: new Set(), minutes: 0, nowIso: ctx.nowIso, guard });
  const results = plan.statements.length ? await ctx.db.batch(plan.statements) : [];
  if (plan.seatStatement.some((i) => results[i].meta.changes !== 1)) {
    throw new HttpError(409, 'changed', 'A payment for the extra time just changed. Look again.');
  }
  await auditPlan(ctx.db, group.id, session.id, plan, ctx.nowIso, 'reopen');
  return { roster, played, minutes };
}

/** A Reopen that stopped after its shares went to $0: they are set again exactly as the finalize had them (credit used again). */
export async function restoreAfterFailedReopen(ctx: Ctx, group: GroupRow, session: SessionRow, was: { played: Set<string>; minutes: ExtraMinutes }): Promise<void> {
  const roster = await loadRoster(ctx.db, session.id);
  const organizerId = await organizerIdOf(ctx.db, group);
  const guard = `(SELECT COALESCE(finalized_at, '') FROM sessions WHERE id = ${sqlText(session.id)}) = ${sqlText(session.finalized_at ?? 'x')}`;
  const plan = extensionPlan(ctx.db, { groupId: group.id, session, roster, organizerId, playedIds: was.played, minutes: was.minutes, nowIso: ctx.nowIso, guard });
  if (plan.statements.length) await ctx.db.batch(plan.statements);
  await auditPlan(ctx.db, group.id, session.id, plan, ctx.nowIso, 'finalize');
}

// ---------- What the screens read (no extra read: the rows come with the money picture every screen already loads) ----------

export interface ExtRow {
  sessionId: string;
  startsAt: string;
  minutes: number;
  seatId: string;
  playerId: string;
  name: string;
  shareCents: number;
  creditCents: number;
  paidCents: number;
  claimCents: number;
  lastCents: number;
  owedCents: number;
  via: string | null;
  seen: boolean;
}

/** Every share in the loaded games (the organizer's own seat never has one). */
export function extRowsOf(sessions: SessionRow[], rosters: Map<string, RosterRow[]>): ExtRow[] {
  const out: ExtRow[] = [];
  for (const s of sessions) {
    for (const r of rosters.get(s.id) ?? []) {
      if (r.ext_cents === null || r.ext_cents === undefined) continue;
      out.push({
        sessionId: s.id,
        startsAt: s.starts_at,
        minutes: s.extra_minutes ?? 0,
        seatId: r.id,
        playerId: r.player_id,
        name: r.display_name,
        shareCents: r.ext_cents,
        creditCents: r.ext_credit_cents ?? 0,
        paidCents: r.ext_paid_cents ?? 0,
        claimCents: r.ext_claim_cents ?? 0,
        lastCents: r.ext_last_cents ?? 0,
        owedCents: extOwed(r),
        via: r.ext_via ?? null,
        seen: !!r.ext_seen_at,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The player's own shares for their alerts: anything still owed, and credit used that they have not closed yet. */
export function myExtShares(rows: ExtRow[], playerId: string): ExtShareView[] {
  return rows
    .filter((r) => r.playerId === playerId && r.shareCents > 0 && (r.owedCents > 0 || (r.creditCents > 0 && !r.seen)))
    .map((r) => ({
      sessionId: r.sessionId,
      startsAt: r.startsAt,
      minutes: r.minutes,
      shareCents: r.shareCents,
      creditCents: Math.max(0, Math.min(r.creditCents, r.shareCents)),
      owedCents: r.owedCents,
      seen: r.seen,
    }));
}

// ---------- Paying ----------

interface OpenSeat {
  id: string;
  session_id: string;
  ext_cents: number | null;
  ext_credit_cents: number;
  ext_paid_cents: number;
  ext_claim_cents: number;
  display_name: string;
}

/** The player's shares that still owe something (any game, however old). */
async function openSharesOf(db: D1Database, playerId: string): Promise<OpenSeat[]> {
  const { results } = await db
    .prepare(
      `SELECT sp.id, sp.session_id, sp.ext_cents, sp.ext_credit_cents, sp.ext_paid_cents, sp.ext_claim_cents, p.display_name
       FROM session_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.player_id = ? AND sp.ext_cents > sp.ext_credit_cents + sp.ext_paid_cents + sp.ext_claim_cents`,
    )
    .bind(playerId)
    .all<OpenSeat>();
  return results;
}

const asRoster = (s: OpenSeat) => s as unknown as RosterRow;

/**
 * The player's I paid on every share still owed (`cents` must be the total the screen showed). `via`: the next game's seat when it
 * was paid together with that game. Returns the seats it claimed (so a failed seat payment can put them back).
 */
export async function claimShares(ctx: Ctx, playerId: string, cents: number, via: string | null): Promise<string[]> {
  const open = await openSharesOf(ctx.db, playerId);
  const total = open.reduce((sum, s) => sum + extOwed(asRoster(s)), 0);
  if (total !== cents) throw new HttpError(409, 'amount_changed', total > 0 ? `The amount for the extra time changed to ${formatPrice(total)}. Look again.` : 'Nothing is owed for extra time now. Look again.');
  if (open.length === 0) return [];
  const results = await ctx.db.batch(
    open.map((s) =>
      ctx.db
        .prepare(`UPDATE session_players SET ext_claim_cents = ext_claim_cents + ?1, ext_claim_at = ?2, ext_via = ?3, updated_at = ?2 WHERE id = ?4 AND ${seatAsRead(asRoster(s))}`)
        .bind(extOwed(asRoster(s)), ctx.nowIso, via, s.id),
    ),
  );
  if (results.some((r) => r.meta.changes !== 1)) {
    // Put back the ones that went in: the amounts moved under the tap.
    await unclaimAt(ctx.db, playerId, ctx.nowIso);
    throw new HttpError(409, 'changed', 'Your extra time payment just changed. Look again.');
  }
  return open.map((s) => s.id);
}

/** Takes back the I paid made at `atIso` (a seat payment it went with failed). */
async function unclaimAt(db: D1Database, playerId: string, atIso: string): Promise<void> {
  await db
    .prepare("UPDATE session_players SET ext_claim_cents = 0, ext_claim_at = NULL, ext_via = NULL, updated_at = ?2 WHERE player_id = ?1 AND ext_claim_at = ?2")
    .bind(playerId, atIso)
    .run();
}
export const undoClaimAt = unclaimAt;

/** POST /api/me/extension-paid { cents }: "Pay now instead", then I paid (on the Pay sheet). Waits for the organizer like every I paid. */
export async function playerExtensionPaid(ctx: Ctx, group: GroupRow, playerId: string, name: string, body: Record<string, unknown>) {
  if (!(await extendedTimeFor(ctx, group.id))) throw new HttpError(404, 'not_found', 'Not found.');
  const cents = v.cents(body.cents, 'cents') ?? 0;
  if (cents <= 0) throw new HttpError(400, 'invalid_cents', 'Say how much you paid.');
  const seats = await claimShares(ctx, playerId, cents, null);
  await audit(ctx.db, group.id, null, 'extension_i_paid', { player: name, playerId, amountCents: cents, games: seats.length }, ctx.nowIso, name);
  return { ok: true };
}

/** POST /api/me/extension-seen { sessionIds }: the X on an extension alert. Changes no money; a new or changed share shows again. */
export async function playerExtensionSeen(ctx: Ctx, group: GroupRow, playerId: string, body: Record<string, unknown>) {
  if (!(await extendedTimeFor(ctx, group.id))) throw new HttpError(404, 'not_found', 'Not found.');
  if (!Array.isArray(body.sessionIds) || body.sessionIds.length === 0 || body.sessionIds.length > 50) throw new HttpError(400, 'invalid_sessions', 'Say which alert.');
  const ids = body.sessionIds.map((x) => v.id(x, 'sessionIds'));
  await ctx.db.batch(
    ids.map((id) =>
      ctx.db
        .prepare('UPDATE session_players SET ext_seen_at = ?1 WHERE session_id = ?2 AND player_id = ?3 AND ext_cents IS NOT NULL AND ext_seen_at IS NULL')
        .bind(ctx.nowIso, id, playerId),
    ),
  );
  return { ok: true };
}

/**
 * POST /api/admin/sessions/:id/extension-payment { playerId, paid, cents? }: the organizer's row for one share.
 *  - paid, with an I paid waiting: confirms it. paid, nothing claimed: records cash for what is owed (`cents` must be that amount).
 *  - not paid: clears a waiting I paid, else takes off the latest confirmed payment (Undo).
 */
export async function adminExtensionPayment(ctx: Ctx, group: GroupRow, session: SessionRow, body: Record<string, unknown>) {
  const playerId = v.id(body.playerId, 'playerId');
  const paid = v.bool(body.paid, 'paid');
  const shown = body.cents === undefined ? null : v.cents(body.cents, 'cents');
  const r = (await loadRoster(ctx.db, session.id)).find((x) => x.player_id === playerId);
  if (!r || r.ext_cents === null || r.ext_cents === undefined) throw new HttpError(404, 'no_share', 'That player has no extra time on this game.');
  const claim = r.ext_claim_cents ?? 0;
  const owed = extOwed(r);
  const last = r.ext_last_cents ?? 0;
  let sql: string;
  let binds: unknown[];
  let what: string;
  let cents: number;
  if (paid) {
    if (claim > 0) {
      cents = claim;
      what = 'extension_confirmed';
      // Confirmed here, on the extension row: it no longer follows the next game's seat (a later Unmark there never takes it off).
      sql = 'ext_paid_cents = ext_paid_cents + ext_claim_cents, ext_last_cents = ext_claim_cents, ext_claim_cents = 0, ext_claim_at = NULL, ext_paid_at = ?1, ext_via = NULL';
      binds = [ctx.nowIso];
    } else {
      if (owed <= 0) return { ok: true, changed: false };
      if (shown !== null && shown !== owed) throw new HttpError(409, 'amount_changed', `The amount changed to ${formatPrice(owed)}. Look again.`);
      cents = owed;
      what = 'extension_marked_paid';
      sql = 'ext_paid_cents = ext_paid_cents + ?2, ext_last_cents = ?2, ext_paid_at = ?1, ext_via = NULL';
      binds = [ctx.nowIso, owed];
    }
  } else if (claim > 0) {
    cents = claim;
    what = 'extension_claim_cleared';
    sql = 'ext_claim_cents = 0, ext_claim_at = NULL, ext_via = NULL';
    binds = [ctx.nowIso];
  } else if (last > 0) {
    cents = last;
    what = 'extension_unmarked';
    // Never below what the share has had handed back already (a recompute since then sets ext_last_cents to 0, so this is a guard).
    if ((r.ext_credit_cents ?? 0) + (r.ext_paid_cents ?? 0) - last < 0) return { ok: true, changed: false };
    sql = 'ext_paid_cents = ext_paid_cents - ext_last_cents, ext_last_cents = 0, ext_paid_at = NULL, ext_via = NULL';
    binds = [ctx.nowIso];
  } else return { ok: true, changed: false };
  const res = await ctx.db
    .prepare(`UPDATE session_players SET ${sql}, updated_at = ?1 WHERE id = ${sqlText(r.id)} AND ext_last_cents = ${int(last)} AND ${seatAsRead(r)}`)
    .bind(...binds)
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, 'changed', `${r.display_name}'s extra time payment just changed. Look again.`);
  await audit(ctx.db, group.id, session.id, what, { player: r.display_name, playerId, amountCents: cents }, ctx.nowIso);
  return { ok: true, changed: true };
}

/**
 * A next game's seat was paid or unpaid (Mark paid / Unmark on the seat, the Home claim card's answer, the player's own "Didn't pay?").
 * Shares paid together with that seat ("$17 due", `ext_via`) follow it: a confirm confirms their I paid too; an unpaid seat clears their
 * I paid and (organizer only, `claimsOnly` false) takes the latest payment made with it off again, never below what the share has had
 * handed back already. ONE write, no read first (the seat is found inside it), and it runs whether the switch is on or off, so a payment
 * made while it was on can always be settled after it is turned off. Nothing to do: the write changes no row.
 */
export async function followSeat(ctx: Ctx, groupId: string, sessionId: string, playerId: string, paid: boolean, claimsOnly = false, answered = false): Promise<void> {
  const seat = '(SELECT s.id FROM session_players s WHERE s.session_id = ?2 AND s.player_id = ?3)';
  const res = paid
    ? await ctx.db
        .prepare(
          `UPDATE session_players SET ext_paid_cents = ext_paid_cents + ext_claim_cents, ext_last_cents = ext_claim_cents, ext_claim_cents = 0,
             ext_claim_at = NULL, ext_paid_at = ?1, updated_at = ?1
           WHERE ext_via = ${seat} AND ext_claim_cents > 0
             AND (?4 = 1 OR EXISTS (SELECT 1 FROM session_players s WHERE s.session_id = ?2 AND s.player_id = ?3 AND s.payment_status = 'paid' AND s.self_paid_at IS NULL))`,
        )
        .bind(ctx.nowIso, sessionId, playerId, answered ? 1 : 0)
        .run()
        .catch(oldDatabase)
    : await unpaidFollow(ctx, sessionId, playerId, claimsOnly);
  if (res && res.meta.changes > 0) await audit(ctx.db, groupId, null, paid ? 'extension_confirmed_with_seat' : 'extension_unmarked_with_seat', { seats: res.meta.changes }, ctx.nowIso);
}

/** The seat id of a player's seat in a game (for "paid together with this game"). */
export async function seatIdOf(db: D1Database, sessionId: string, playerId: string): Promise<string | null> {
  return (await db.prepare('SELECT id FROM session_players WHERE session_id = ? AND player_id = ?').bind(sessionId, playerId).first<{ id: string }>())?.id ?? null;
}

/** A database from before migration 0019 has no extension columns: nothing to follow. Any other error is real and fails the request. */
function oldDatabase(err: unknown): null {
  if (/no such column|has no column/i.test(String(err instanceof Error ? err.message : err))) return null;
  throw err;
}

/** Shares paid together with the seat of (sessionId, playerId), SQL (`x` is the share's row). ?2 session, ?3 player. */
const VIA = (x = 'x') => `${x}.ext_via = (SELECT s.id FROM session_players s WHERE s.session_id = ?2 AND s.player_id = ?3)`;
/** The seat is unpaid now (or its payment became credit). */
const SEAT_UNPAID = `EXISTS (SELECT 1 FROM session_players s WHERE s.session_id = ?2 AND s.player_id = ?3 AND (s.payment_status <> 'paid' OR s.refunded_at IS NOT NULL))`;
/** The share's latest payment came with the seat and has since been handed back as credit (a change took the share below it). */
const HANDED_BACK = (x: string) => `(${x}.ext_claim_cents = 0 AND ${x}.ext_last_cents > 0 AND ${x}.ext_credit_cents + ${x}.ext_paid_cents - ${x}.ext_last_cents < 0)`;

/**
 * The seat went unpaid: its shares' waiting I paid is cleared, and (organizer only) the payment that came with the seat is taken off.
 * Where that payment was already handed back as credit after a change, the credit is taken back first (as main does for a seat's own
 * credit back), so the player never keeps credit for money that never came. All in one batch.
 */
async function unpaidFollow(ctx: Ctx, sessionId: string, playerId: string, claimsOnly: boolean) {
  const bind = (sql: string) => ctx.db.prepare(sql).bind(ctx.nowIso, sessionId, playerId, claimsOnly ? 1 : 0);
  const results = await ctx.db
    .batch([
      // 1. Credit handed back from such a payment comes back off the pot (only while the player still has it; else the Unmark was refused first).
      bind(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
        SELECT lower(hex(randomblob(16))), s.group_id, x.player_id, 'used', MIN(x.ext_last_cents, -(x.ext_credit_cents + x.ext_paid_cents - x.ext_last_cents)), NULL, ?1, 'ext:' || x.session_id
        FROM session_players x JOIN sessions s ON s.id = x.session_id
        WHERE ?4 = 0 AND ${VIA()} AND ${HANDED_BACK('x')} AND ${SEAT_UNPAID} AND ${USABLE('x.player_id')} >= -(x.ext_credit_cents + x.ext_paid_cents - x.ext_last_cents)`),
      bind(`UPDATE session_players SET ext_credit_cents = ext_credit_cents + (SELECT l.amount_cents FROM credit_ledger l WHERE l.player_id = session_players.player_id AND l.created_at = ?1 AND l.reason = 'ext:' || session_players.session_id AND l.kind = 'used' ORDER BY l.rowid DESC LIMIT 1)
        WHERE ?4 = 0 AND ${VIA('session_players')} AND ${HANDED_BACK('session_players')} AND ${SEAT_UNPAID}
          AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.player_id = session_players.player_id AND l.created_at = ?1 AND l.reason = 'ext:' || session_players.session_id AND l.kind = 'used')`),
      // 2. The waiting I paid goes; the latest payment made with the seat comes off (never below what the share has had handed back).
      bind(`UPDATE session_players SET
             ext_paid_cents = CASE WHEN ext_claim_cents > 0 THEN ext_paid_cents ELSE ext_paid_cents - ext_last_cents END,
             ext_last_cents = CASE WHEN ext_claim_cents > 0 THEN ext_last_cents ELSE 0 END,
             ext_paid_at = CASE WHEN ext_claim_cents > 0 THEN ext_paid_at ELSE NULL END,
             ext_claim_cents = 0, ext_claim_at = NULL, ext_via = NULL, updated_at = ?1
           WHERE ${VIA('session_players')} AND ${SEAT_UNPAID}
             AND (ext_claim_cents > 0 OR (?4 = 0 AND ext_last_cents > 0 AND ext_credit_cents + ext_paid_cents - ext_last_cents >= 0))`),
    ])
    .catch(oldDatabase);
  return results ? results[2] : null;
}

/**
 * Before the organizer Unmarks a seat: extra time paid with it that was handed back as credit and the player has since used or cashed out
 * can't be taken back, so the Unmark is refused with what happened (as main refuses a Reopen when credit back was used). Else null.
 */
export async function unmarkBlockedBy(db: D1Database, sessionId: string, playerId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT p.display_name AS name, -(x.ext_credit_cents + x.ext_paid_cents - x.ext_last_cents) AS cents FROM session_players x JOIN players p ON p.id = x.player_id
       WHERE ${VIA().replace('?2', '?1').replace('?3', '?2')} AND ${HANDED_BACK('x')} AND ${USABLE('x.player_id')} < -(x.ext_credit_cents + x.ext_paid_cents - x.ext_last_cents) LIMIT 1`,
    )
    .bind(sessionId, playerId)
    .first<{ name: string; cents: number }>()
    .catch(oldDatabase);
  if (!row) return null;
  return `Can't unmark: ${row.name}'s ${formatPrice(row.cents)} for extra time, paid with this game, came back as credit after a change and was already used or cashed out.`;
}

/**
 * Does any share follow the seat of (sessionId, playerId) ("$17 due" paid with it)? One small read on the `ext_via` index, made BEFORE the
 * seat's own payment, so a seat with no extra time does nothing more after its payment than main does. A database before 0019: no.
 */
export async function hasViaShares(db: D1Database, sessionId: string, playerId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM session_players WHERE ext_via = (SELECT s.id FROM session_players s WHERE s.session_id = ? AND s.player_id = ?) LIMIT 1')
    .bind(sessionId, playerId)
    .first()
    .catch(oldDatabase);
  return !!row;
}

/**
 * The organizer's Mark paid on a row that showed "$17 (incl. $3 extension)": every share still owed (no I paid waiting) is recorded as cash
 * paid with that seat (`ext_via`), so the seat's Unmark later takes it off again. `cents` must be what the row showed.
 */
export async function markSharesWithSeat(ctx: Ctx, sessionId: string, playerId: string, cents: number): Promise<void> {
  const open = (await openSharesOf(ctx.db, playerId)).filter((s) => (s.ext_claim_cents ?? 0) === 0);
  const total = open.reduce((sum, s) => sum + extOwed(asRoster(s)), 0);
  if (total !== cents) throw new HttpError(409, 'amount_changed', total > 0 ? `The extra time changed to ${formatPrice(total)}. Look again.` : 'Nothing is owed for extra time now. Look again.');
  const seat = '(SELECT s.id FROM session_players s WHERE s.session_id = ?3 AND s.player_id = ?4)';
  const results = await ctx.db.batch(
    open.map((s) =>
      ctx.db
        .prepare(`UPDATE session_players SET ext_paid_cents = ext_paid_cents + ?1, ext_last_cents = ?1, ext_paid_at = ?2, ext_via = ${seat}, updated_at = ?2 WHERE id = ?5 AND ${seatAsRead(asRoster(s))}`)
        .bind(extOwed(asRoster(s)), ctx.nowIso, sessionId, playerId, s.id),
    ),
  );
  if (results.some((r) => r.meta.changes !== 1)) {
    await undoSharesWithSeat(ctx, sessionId, playerId);
    throw new HttpError(409, 'changed', 'The extra time just changed. Look again.');
  }
}

/** Takes back what markSharesWithSeat just recorded (its seat payment was refused). */
export async function undoSharesWithSeat(ctx: Ctx, sessionId: string, playerId: string): Promise<void> {
  await ctx.db
    .prepare(
      `UPDATE session_players SET ext_paid_cents = ext_paid_cents - ext_last_cents, ext_last_cents = 0, ext_paid_at = NULL, ext_via = NULL, updated_at = ?1
       WHERE ext_paid_at = ?1 AND ext_via = (SELECT s.id FROM session_players s WHERE s.session_id = ?2 AND s.player_id = ?3)`,
    )
    .bind(ctx.nowIso, sessionId, playerId)
    .run();
}
