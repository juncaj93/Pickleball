import type { Ctx } from './context';
import type { D1Database, D1PreparedStatement } from './db';
import { splitSeatStatements, type SplitSeat } from './credit';
import { type GroupRow, organizerIdOf } from './repo';
import { newId } from './crypto';
import { GUEST_SPOT, guestSpotAllowed } from '../shared/guestSpot';

// Zip 42: GUEST_SPOT (shared/guestSpot.ts), "Guest spot". On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches, or this phone opened the site with ?guestspot=on (it then sends
//    X-Guest-Spot: a private test switch for that phone only).
// The switch decides who can ADD a guest and who sees the guest buttons. Seats and money always count a guest that exists (a guest
// is a real person holding a real spot), so turning the switch off can never strand a guest's $14 or overfill a game.
// "On for everyone" is one row in task_log (kind 'mark', no game), the same way the other switches are stored.

const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, GUEST_SPOT.task).first().catch(() => null);
  return !!row;
}

export async function setGuestSpotForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, GUEST_SPOT.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, GUEST_SPOT.task, nowIso).run();
  }
}

/** The switch for this request, and the Settings row: one read of the row for both. */
export async function guestSpotFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(GUEST_SPOT.header) ?? '').toLowerCase() === 'on';
  // A preview (GUEST_SPOT_PREVIEW, never in production) shows it whatever the shared fake database's row says.
  const preview = (ctx.env.GUEST_SPOT_PREVIEW ?? '').trim().toLowerCase() === 'on';
  return { on: guestSpotAllowed(ctx.env.GUEST_SPOT) && (header || row || preview), forAll: row };
}

// ---------- Do the guest columns exist? ----------
// Write paths (sign-up, drop, move-in) count guests inside their SQL guards. Those words name the new columns, which only exist once
// migration 0021 ran, so they are only added when it has: before it, every statement is main's, word for word. The answer is asked
// once per database binding (a yes is kept; a no is asked again after a minute, so applying the migration takes effect by itself).

const known = new WeakMap<object, { yes: boolean; at: number }>();

export async function hasGuestColumns(db: D1Database): Promise<boolean> {
  const k = db as unknown as object;
  const seen = known.get(k);
  const now = Date.now();
  if (seen && (seen.yes || now - seen.at < 60_000)) return seen.yes;
  const yes = await db
    // Both Guest spot migrations (0021 and 0022): with only the first, the feature stays off (nothing names a missing column).
    .prepare('SELECT guest_status, guest_played, guest_first FROM session_players LIMIT 0')
    .all()
    .then(() => true)
    .catch(() => false);
  known.set(k, { yes, at: now });
  return yes;
}

// ---------- SQL ----------
// `x` is a session_players alias. A guest counts when its host is in ('confirmed' row) and the guest is too.

/** 1 for a seat, 2 for a seat with its guest in. */
export const SEAT_HEADS = (x: string) => `(1 + CASE WHEN ${x}.guest_status = 'confirmed' AND ${x}.guest_name IS NOT NULL THEN 1 ELSE 0 END)`;

/** Everyone in a game (?1 is the session id): seats in plus their guests in. With `guests` false: main's count, word for word. */
export const confirmedHeads = (guests: boolean) =>
  guests
    ? `(SELECT COALESCE(SUM(${SEAT_HEADS('x')}), 0) FROM session_players x WHERE x.session_id = ?1 AND x.status = 'confirmed')`
    : "(SELECT COUNT(*) FROM session_players x WHERE x.session_id = ?1 AND x.status = 'confirmed')";

/** The next place in the join order (?1 is the session id): waiting guests hold a place in the same order. */
export const nextClaimSeq = (guests: boolean) =>
  guests
    ? '(SELECT COALESCE(MAX(MAX(x.claim_seq, COALESCE(x.guest_seq, 0))), 0) + 1 FROM session_players x WHERE x.session_id = ?1)'
    : '(SELECT COALESCE(MAX(x.claim_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';

// ---------- Trim a seat's money down to a lower price ----------

/**
 * A seat now costs LESS than it holds (its guest came off, or a sub took the guest's spot of a late-drop debt): the seat keeps exactly
 * `priceCents` and the rest comes back to the host as credit, the same moves the late-cancel split uses (server/credit.ts
 * splitSeatStatements: the cash part first as one 'kept' entry, then credit used on it). An unconfirmed I paid is never touched (it
 * waits for the organizer like any claim). Nothing when the seat holds `priceCents` or less. Statements for the caller's batch, only
 * while `guard` (SQL) holds and the seat's payment is still exactly as read here.
 */
export async function trimSeatStatements(
  db: D1Database,
  args: { groupId: string; sessionId: string; playerId: string; priceCents: number; nowIso: string; guard: string; seatStatus: 'confirmed' | 'withdrawn'; reason: 'dropped' | 'canceled' },
): Promise<{ statements: D1PreparedStatement[]; backCents: number }> {
  const row = await db
    .prepare('SELECT payment_status, payment_amount_cents, refunded_at, self_paid_at FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(args.sessionId, args.playerId)
    .first<{ payment_status: string; payment_amount_cents: number | null; refunded_at: string | null; self_paid_at: string | null }>();
  if (!row) return { statements: [], backCents: 0 };
  // The organizer's seat holds the court payment, never group money: it is never trimmed (fresh review, Zip 42).
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(args.groupId).first<GroupRow>();
  if (group && args.playerId === (await organizerIdOf(db, group))) return { statements: [], backCents: 0 };
  const paid = row.payment_status === 'paid' && !row.refunded_at;
  if (paid && row.self_paid_at) return { statements: [], backCents: 0 };
  if (!paid && row.payment_status !== 'unpaid') return { statements: [], backCents: 0 };
  const { results: used } = await db
    .prepare("SELECT id, amount_cents FROM credit_ledger WHERE kind = 'used' AND COALESCE(reason, '') <> 'cash' AND session_id = ? AND player_id = ? AND ended_at IS NULL ORDER BY created_at, rowid")
    .bind(args.sessionId, args.playerId)
    .all<{ id: string; amount_cents: number }>();
  const held =
    (
      await db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND reason = 'cash' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
        .bind(args.sessionId, args.playerId)
        .first<{ c: number }>()
    )?.c ?? 0;
  const seat: SplitSeat = {
    playerId: args.playerId,
    paid,
    paymentCents: paid ? (row.payment_amount_cents ?? 0) : 0,
    used: used.map((u) => ({ id: u.id, cents: u.amount_cents })),
    heldCashCents: held,
  };
  const holds = paid ? seat.paymentCents : seat.used.reduce((s, u) => s + u.cents, 0) + held;
  if (holds <= args.priceCents) {
    // Holds the new price exactly on an unpaid seat (credit and held cash): it is paid now (splitSeatStatements does that too).
    if (!paid && holds > 0 && holds === args.priceCents) {
      const r = splitSeatStatements(db, { groupId: args.groupId, sessionId: args.sessionId, seat, priceCents: args.priceCents, nowIso: args.nowIso, guard: args.guard, seatStatus: args.seatStatus, reason: args.reason });
      return { statements: r.statements, backCents: 0 };
    }
    return { statements: [], backCents: 0 };
  }
  const r = splitSeatStatements(db, { groupId: args.groupId, sessionId: args.sessionId, seat, priceCents: args.priceCents, nowIso: args.nowIso, guard: args.guard, seatStatus: args.seatStatus, reason: args.reason });
  return { statements: r.statements, backCents: r.cashBackCents + r.creditBackCents };
}
