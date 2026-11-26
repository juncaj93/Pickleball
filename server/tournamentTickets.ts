// Zip 56 "Tournaments", piece 2: the taps that sell and settle tickets. The rules are in shared/tournamentTickets.ts, the guarded money statements
// in server/tournamentMoney.ts, and the reads, the back out and the cancel in server/tournament.ts.
//
// Players (only on a tournament they may see, only while they are on its list, only while tickets are open and the night has not started):
//   POST /api/tournament/lock      { tournamentId, intent: 'lock' | 'hold', priceCents }  Lock my spot (or Hold my spot from the waitlist)
//   POST /api/tournament/paid      { tournamentId, cents }                               I paid (on the site's own Pay sheet)
//   POST /api/tournament/waitlist  { tournamentId }                                      Join waitlist
// The organizer:
//   (Tickets open when the organizer picks the date: server/tournament.ts setTournamentDate. Alex: no other trigger.)
//   PUT  /api/admin/tournament/:id/pay-by        { payBy }        Change Pay by while tickets are open
//   POST /api/admin/tournament/:id/ticket        { playerId, action: 'confirm' | 'reject' | 'mark_paid' | 'take_off', cents? }
//   POST /api/admin/tournament/:id/reschedule                    Reschedule: back to the date step; every ticket stays as it is
// Every money statement is guarded by the rows as they were read, so a double tap, a refresh, a second phone or a retry never charges or
// credits twice: the second one finds nothing to do and changes nothing (or is told to look again).
import type { Ctx } from './context';
import type { D1PreparedStatement } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit, type GroupRow, organizerIdOf } from './repo';
import { formatPrice } from '../shared/money';
import { dayLong, MAX_SPOTS } from '../shared/tournament';
import { fromOwedClaim, isOwedClaim, OWED_MARK, payByLabel, ticketOwed, ticketPaid, type TicketMoney } from '../shared/tournamentTickets';
import {
  changedOrLookAgain,
  logPlayer,
  movedBack,
  mySignup,
  nightOf,
  nightOver,
  openById,
  organizerOn,
  playerTarget,
  readPayByTime,
  salesClosed,
  heldSpotSincePayBy,
  lockedInCount,
  lockedInSql,
  ticketPhase,
  type TicketPhase,
  statusOf,
  tournamentsFlags,
  type TournamentActor,
  type TournamentRow,
  TOURNAMENT_COLS,
} from './tournament';
import { saveAmericanoCourts } from './americanoDay';
import { earlyAsReadSql, earlyBirdOn } from './earlyBird';
import { priceNow, ticketHasMoney, ticketPrice } from '../shared/earlyBird';
import {
  fillSpotsStatements,
  keptOff,
  offListBack,
  loadTickets,
  onList,
  organizerSeatStatement,
  payByMovedLaterSql,
  payWithCreditStatements,
  releaseKeptStatements,
  sqlText,
  ticketAsRead,
  ticketBackStatements,
  ticketOf,
  type TicketRow,
  tournamentCanceled,
} from './tournamentMoney';

const money = (k: TicketRow): TicketMoney => ({ priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents });

/** SQL: the tournament is still taking tickets exactly as read (the same date and price). */
const ticketsOpenSql = (t: TournamentRow) =>
  `EXISTS (SELECT 1 FROM tournaments WHERE id = ${sqlText(t.id)} AND status = 'tickets' AND final_date = ${sqlText(t.final_date ?? 'none')} AND ticket_cents = ${Number(t.ticket_cents) | 0}${earlyGuard(t)})`;

/** Zip 94: the early bird exactly as read (one set or changed after the read: "look again"), so a tap never misses an early price set in between. */
const earlyGuard = (t: TournamentRow) => ` AND ${earlyAsReadSql(t)}`;

/**
 * Zip 94: an empty ticket (nothing on it) moves to the price this tap uses (shared/earlyBird.ts ticketPrice), in the same batch, guarded on the
 * ticket as read. Null when its price already is that price (every tournament without an early bird: nothing new runs).
 */
function repriceStatement(ctx: Ctx, t: TournamentRow, k: TicketRow, price: number): D1PreparedStatement | null {
  if (k.price_cents === price || ticketHasMoney(k)) return null;
  return ctx.db.prepare(`UPDATE tournament_tickets SET price_cents = ?1, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)}`).bind(price, ctx.nowIso, k.id);
}

/** SQL: this player is on the list. */
const onListSql = (tournamentId: string, playerId: string) =>
  `EXISTS (SELECT 1 FROM tournament_signups WHERE tournament_id = ${sqlText(tournamentId)} AND player_id = ${sqlText(playerId)} AND status = 'in')`;

/** SQL: the spots taken right now. */
const spotsSql = (tournamentId: string) => `(SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = ${sqlText(tournamentId)} AND place = 'spot')`;

/** A batch a race made fail (a unique row, the spot cap, a check): nothing was saved, so the screen looks again. */
function lookAgainOn(err: unknown): never {
  if (/UNIQUE|tournament_full|CHECK constraint/i.test(String(err instanceof Error ? err.message : err))) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  throw err;
}

// ---------------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A player's ticket tap: the tournament they may see, taking tickets, and they are on its list.
 * Zip 59 (`kind`): before Pay by anyone on the list may lock, join the waitlist or tap I paid. After Pay by (the night before at 7:00 PM) none
 * of that, except finishing what was started (a player already in line holds their spot; an I paid after a Lock) and a spot freed by a back
 * out, which a new buyer can claim (the first PAID person in line gets it by itself, so only an unclaimed one reaches a new buyer). Three
 * hours before the start everything closes, a freed spot included.
 */
async function ticketsTarget(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>, kind: 'lock' | 'hold' | 'paid' | 'waitlist'): Promise<{ t: TournamentRow; playerId: string; phase: TicketPhase }> {
  const { t, playerId } = await playerTarget(ctx, who, body);
  if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open now. Look again.');
  if (salesClosed(t, who.group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed. The tournament has started.');
  const s = await mySignup(ctx.db, t.id, playerId);
  if (!s || s.status !== 'in') throw new HttpError(409, 'not_signed_up', 'You are not on the list. Sign up first.');
  // Zip 64: three hours before the REAL start (the Finalize screen's "Plays"), everything closes.
  const phase = ticketPhase(t, who.group.timezone, ctx.nowMs);
  if (phase === 'cut') throw new HttpError(409, 'tickets_closed', 'Tickets are closed.');
  if (phase === 'after') {
    // Zip 64 (late paying, late joining): after Pay by a player on the list can still pay while a spot is open (the cap of 16), until 3 hours
    // before the start; no fees. An I paid already waiting (and a spot holder's own I paid) always finishes. Standby does not open after Pay by.
    const own = await ticketOf(ctx.db, t.id, playerId);
    const keeps = kind === 'paid' && (own?.place === 'spot' || (own?.claim_cents ?? 0) > 0);
    // Spots taken plus every I paid for a whole ticket still waiting for the organizer (they show as locked in): no 17th promise (review).
    const open = lockedInCount(await loadTickets(ctx.db, t.id)) < MAX_SPOTS;
    if (!keeps && (kind === 'waitlist' || !open)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed.');
  }
  return { t, playerId, phase };
}

/** Where a ticket stands after a tap, for the player's screen and words. */
function answerOf(k: TicketRow | null) {
  if (!k) return { result: 'due' as const, dueCents: 0, place: 'none' as const };
  const result = k.place === 'spot' ? ('locked' as const) : ticketPaid(money(k)) ? ('held' as const) : k.claim_cents > 0 && ticketOwed(money(k)) === 0 ? ('waiting' as const) : ('due' as const);
  return { result, dueCents: ticketOwed(money(k)), place: k.place };
}

/**
 * POST /api/tournament/lock { tournamentId, intent, priceCents }: "Lock my spot" (a spot is open) or "Hold my spot" (from the waitlist). The
 * player's usable credit goes on the ticket at once, up to the price; a ticket paid in full takes the open spot (Lock) or holds its place in
 * line (Hold). What is left is paid on the Pay sheet (Venmo, then I paid). Lock refuses, and spends nothing, when every spot is taken.
 * `priceCents`: the price the screen showed (never pay a different amount than the one shown).
 */
export async function playerTicketLock(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const intent = body.intent === undefined ? 'lock' : v.oneOf(body.intent, 'intent', ['lock', 'hold'] as const);
  const { t, playerId, phase } = await ticketsTarget(ctx, who, body, intent);
  // Zip 64: after Pay by the claim itself checks that a spot is still open (under the cap of 16), in the very statements that take it.
  // Zip 74 (the 🎾73 audit): Lock in uses that full rule before Pay by too (spots taken AND every whole-ticket I paid still waiting), so the
  // players locked in never pass 16. A standby Hold before Pay by stays open when every spot is taken (that is what the line is for).
  const capOk = ` AND ${spotsSql(t.id)} < ${MAX_SPOTS} AND ${lockedInSql(sqlText(t.id))} < ${MAX_SPOTS}`;
  const claimOk = phase === 'after' || intent === 'lock' ? capOk : '';
  // The organizer pays the venue, never the group: their own seat is $0.
  const organizer = playerId === (await organizerIdOf(ctx.db, who.group));
  const k = await ticketOf(ctx.db, t.id, playerId);
  // Zip 94: the price this tap locks in (shared/earlyBird.ts): early before the deadline, the ticket price after, a ticket with money on it its
  // own. With no early bird set (or the switch off) it is the ticket price, exactly as before.
  const price = ticketPrice(t, k, organizer, await earlyBirdOn(ctx, who.group.id, t), ctx.nowMs);
  if (body.priceCents !== undefined && (v.cents(body.priceCents, 'priceCents') ?? -1) !== price) {
    throw new HttpError(409, 'amount_changed', `The ticket is ${formatPrice(price)}. Look again.`);
  }
  // Locked in already, or paid and holding a place (a second tap, another phone): nothing to do. Zip 74 (review): a whole-ticket I paid
  // waiting outside the line counts as locked in too, so a repeat tap never reads as "Every spot just filled".
  if (k && (k.place === 'spot' || ticketPaid(money(k)) || (k.place !== 'line' && k.claim_cents > 0 && ticketOwed(money(k)) === 0))) return { ok: true, creditUsedCents: 0, ...answerOf(k) };
  if (organizer) {
    // Their $0 seat: in line and paid, so the line gives them the open spot (or keeps them first in line).
    const res = await ctx.db.batch([organizerSeatStatement(ctx.db, t.id, playerId, ctx.nowIso), ...fillSpotsStatements(ctx.db, who.group.id, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) === 0) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
    const after = await ticketOf(ctx.db, t.id, playerId);
    await logPlayer(ctx, who.group, playerId, 'tournament_ticket', { tournament: t.name, creditUsedCents: 0, result: answerOf(after).result });
    return { ok: true, creditUsedCents: 0, ...answerOf(after) };
  }
  const tickets = await loadTickets(ctx.db, t.id);
  if (intent === 'lock' && (tickets.filter((x) => x.place === 'spot').length >= MAX_SPOTS || lockedInCount(tickets) >= MAX_SPOTS)) {
    if (phase === 'after') throw new HttpError(409, 'tickets_closed', 'Tickets are closed.');
    throw new HttpError(409, 'spots_full', 'Every spot just filled. Join standby.');
  }
  // The ticket as it will be after its first statement: a new one (Hold puts it in line), or the one read (Hold puts it in line if it was not).
  const ticketId = k?.id ?? newId();
  const statements = [];
  let read: TicketRow;
  // Zip 94: an empty ticket first moves to this tap's price (nothing else about it changes); the statements after it read it at that price.
  const reprice = k ? repriceStatement(ctx, t, k, price) : null;
  const base: TicketRow | null = k && reprice ? { ...k, price_cents: price } : k;
  if (reprice) statements.push(reprice);
  if (!k) {
    read = { id: ticketId, tournament_id: t.id, player_id: playerId, place: intent === 'hold' ? 'line' : 'none', place_at: intent === 'hold' ? ctx.nowIso : null, price_cents: price, credit_cents: 0, paid_cents: 0, claim_cents: 0, claim_at: null, paid_at: null, created_at: ctx.nowIso, updated_at: ctx.nowIso };
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE ${ticketsOpenSql(t)}${claimOk} AND ${onListSql(t.id, playerId)}`,
        )
        .bind(ticketId, t.id, playerId, read.place, read.place_at, price, ctx.nowIso),
    );
  } else if (intent === 'hold' && base!.place === 'none') {
    read = { ...base!, place: 'line', place_at: k.claim_at ?? ctx.nowIso };
    // Into the line only while tickets are open and they are on the list (a Cancel or their own Back out in between: nothing).
    statements.push(
      ctx.db
        .prepare(`UPDATE tournament_tickets SET place = 'line', place_at = ?1, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(base!)} AND ${ticketsOpenSql(t)}${claimOk} AND ${onListSql(t.id, playerId)}`)
        .bind(read.place_at, ctx.nowIso, k.id),
    );
  } else {
    read = base!;
  }
  // Lock: only while a spot is open at that very moment (a race for the last spot never spends credit on a spot that is gone).
  const guard = `${ticketAsRead(read)} AND ${ticketsOpenSql(t)}${claimOk} AND ${onListSql(t.id, playerId)}`;
  const usedId = newId();
  const pay = payWithCreditStatements(ctx.db, { groupId: who.group.id, tournamentId: t.id, playerId, ticketId, usedId, nowIso: ctx.nowIso, guard });
  const at = statements.length + pay.ticketStatement;
  statements.push(...pay.statements);
  const res = await ctx.db.batch(statements).catch(lookAgainOn);
  if (reprice && (res[0].meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  if ((res[at].meta?.changes ?? 0) !== 1) {
    if (phase === 'after') throw new HttpError(409, 'tickets_closed', 'Tickets are closed.');
    throw intent === 'lock' ? new HttpError(409, 'spots_full', 'Every spot just filled. Join standby.') : new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  }
  const used = (await ctx.db.prepare('SELECT amount_cents AS c FROM credit_ledger WHERE id = ?').bind(usedId).first<{ c: number }>())?.c ?? 0;
  const after = await ticketOf(ctx.db, t.id, playerId);
  const out = answerOf(after);
  await logPlayer(ctx, who.group, playerId, 'tournament_ticket', { tournament: t.name, intent, creditUsedCents: used, result: out.result });
  return { ok: true, creditUsedCents: used, ...out };
}

/**
 * Zip 85: POST /api/tournament/owed-paid { tournamentId, cents }: "I paid" on the You owe card of a ticket the organizer marked Didn't pay after
 * the night started (OWED_MARK), for exactly the amount the card showed. It waits for the organizer like every I paid (Paid or Didn't pay on the
 * tournament's Players list, or Mark paid on Money). Works after the night and after End (the ticket's only change then). A second tap changes
 * nothing.
 */
export async function playerOwedPaid(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const id = v.id(body.tournamentId, 'tournamentId');
  const cents = v.cents(body.cents, 'cents') ?? 0;
  const k = await ctx.db
    .prepare('SELECT k.*, t.name AS tournament_name FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id WHERE k.tournament_id = ? AND k.player_id = ? AND t.group_id = ?')
    .bind(id, who.playerId, who.group.id)
    .first<TicketRow & { tournament_name: string }>();
  if (!k || k.claim_cents === 0) throw new HttpError(409, 'nothing_owed', 'There is nothing to pay. Look again.');
  // Already sent (a second tap, another phone): nothing new.
  if (!isOwedClaim(k)) return { ok: true, result: 'waiting' as const, claimCents: k.claim_cents };
  if (cents !== k.claim_cents) throw new HttpError(409, 'amount_changed', `The amount changed to ${formatPrice(k.claim_cents)}. Look again.`);
  const res = await ctx.db
    .prepare(`UPDATE tournament_tickets SET claim_at = ?1, updated_at = ?4 WHERE id = ?2 AND claim_at = '${OWED_MARK}' AND claim_cents = ?3`)
    .bind(`${OWED_MARK}:${ctx.nowIso}`, k.id, cents, ctx.nowIso)
    .run();
  if ((res.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  await logPlayer(ctx, who.group, who.playerId, 'tournament_i_paid', { tournament: k.tournament_name, amountCents: cents });
  return { ok: true, result: 'waiting' as const, claimCents: cents };
}

/**
 * POST /api/tournament/paid { tournamentId, cents }: "I paid" on the Pay sheet, for exactly what the sheet showed. It waits for the organizer
 * (Paid or Didn't pay on their Home card) like every I paid on the site; it holds no spot until then. A second tap changes nothing.
 */
export async function playerTicketPaid(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId, phase } = await ticketsTarget(ctx, who, body, 'paid');
  const cents = v.cents(body.cents, 'cents') ?? 0;
  const k = await ticketOf(ctx.db, t.id, playerId);
  if (!k) throw new HttpError(409, 'nothing_owed', 'There is nothing to pay. Look again.');
  // Zip 94: the price this I paid locks in. A ticket with money on it keeps its own; an empty one takes the price that applies now (an early
  // ticket keeps the early price for the 30 minute grace after the deadline). Without an early bird: the ticket's own price, as before.
  // (The organizer's own ticket is $0: ticketPrice keeps it at $0, so no organizer read here.)
  const price = ticketPrice(t, k, false, await earlyBirdOn(ctx, who.group.id, t), ctx.nowMs, true);
  const owed = ticketOwed({ ...money(k), priceCents: price });
  // Already claimed or paid (a second tap, another phone): nothing new.
  if (owed === 0) return { ok: true, ...answerOf(k), claimCents: k.claim_cents };
  if (cents !== owed) throw new HttpError(409, 'amount_changed', `The amount changed to ${formatPrice(owed)}. Look again.`);
  // Zip 74 (the 🎾73 audit): this I paid pays the whole ticket, and a whole-ticket I paid outside the line counts as locked in at once (the trust
  // rule). So, before Pay by as after it, it needs a place under the cap: the same full rule Lock in uses (spots AND waiting I paids under 16),
  // checked in the very statement that saves it. A spot holder's own I paid and a standby hold's I paid never add one, so they always finish.
  const adds = k.place === 'none';
  const full = () => (phase === 'after' ? new HttpError(409, 'tickets_closed', 'Tickets are closed.') : new HttpError(409, 'spots_full', 'Every spot just filled. Join standby.'));
  if (adds && lockedInCount(await loadTickets(ctx.db, t.id)) >= MAX_SPOTS) throw full();
  const capOk = adds ? ` AND ${spotsSql(t.id)} < ${MAX_SPOTS} AND ${lockedInSql(sqlText(t.id))} < ${MAX_SPOTS}` : '';
  const res = await ctx.db
    .prepare(`UPDATE tournament_tickets SET price_cents = ?4, claim_cents = claim_cents + ?1, claim_at = ?2, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}${capOk}`)
    .bind(owed, ctx.nowIso, k.id, price)
    .run();
  if ((res.meta?.changes ?? 0) !== 1) {
    if (adds && lockedInCount(await loadTickets(ctx.db, t.id)) >= MAX_SPOTS) throw full();
    throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  }
  await logPlayer(ctx, who.group, playerId, 'tournament_i_paid', { tournament: t.name, amountCents: owed });
  return { ok: true, ...answerOf(await ticketOf(ctx.db, t.id, playerId)), claimCents: owed };
}

/**
 * POST /api/tournament/waitlist { tournamentId }: "Join waitlist" while every spot is taken. They go to the end of the line (an I paid that is
 * already waiting keeps the moment it was tapped). Paying to hold is the next tap (Hold my spot); unpaid they simply stay in line.
 */
export async function playerTicketWaitlist(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await ticketsTarget(ctx, who, body, 'waitlist');
  const k = await ticketOf(ctx.db, t.id, playerId);
  if (k && (k.place === 'line' || k.place === 'spot')) return { ok: true, result: k.place === 'spot' ? 'locked' : 'waitlist', position: await linePosition(ctx, t, playerId) };
  const tickets = await loadTickets(ctx.db, t.id);
  // Zip 74: full by the same count the player's card shows (every spot, and every whole-ticket I paid still waiting).
  if (tickets.filter((x) => x.place === 'spot').length < MAX_SPOTS && lockedInCount(tickets) < MAX_SPOTS) throw new HttpError(409, 'spots_open', 'A spot is open. Lock it now.');
  const organizer = playerId === (await organizerIdOf(ctx.db, who.group));
  const statements = organizer
    ? [organizerSeatStatement(ctx.db, t.id, playerId, ctx.nowIso)]
    : k
      ? [ctx.db.prepare(`UPDATE tournament_tickets SET place = 'line', place_at = ?1, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`).bind(k.claim_at ?? ctx.nowIso, ctx.nowIso, k.id)]
      : [
          ctx.db
            .prepare(
              `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at)
               SELECT ?1, ?2, ?3, 'line', ?4, ?5, ?4, ?4 WHERE ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
            )
            .bind(newId(), t.id, playerId, ctx.nowIso, priceNow(t, await earlyBirdOn(ctx, who.group.id, t), ctx.nowMs)),
        ];
  const res = await ctx.db.batch([...statements, ...fillSpotsStatements(ctx.db, who.group.id, t.id, ctx.nowIso)]).catch(lookAgainOn);
  if ((res[0].meta?.changes ?? 0) === 0) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  await logPlayer(ctx, who.group, playerId, 'tournament_waitlist', { tournament: t.name });
  return { ok: true, result: 'waitlist', position: await linePosition(ctx, t, playerId) };
}

/** Their place in line (1 = first), or 0. */
async function linePosition(ctx: Ctx, t: TournamentRow, playerId: string): Promise<number> {
  const line = (await loadTickets(ctx.db, t.id)).filter((x) => x.place === 'line' && x.signup_status === 'in');
  return line.findIndex((x) => x.player_id === playerId) + 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer
// ---------------------------------------------------------------------------------------------------------------------

/** PUT /api/admin/tournament/:id/pay-by { payBy }: a new Pay by while tickets are open. */
export async function setPayBy(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open. Look again.');
  const payBy = readPayByTime(body.payBy, ctx.nowMs, nightOf(t, group.timezone)!.start);
  // Zip 94: the early price ends before Pay by (the gear sheet's rule), so Pay by never moves to or before it.
  if (t.early_until && t.early_cents !== null && t.early_cents !== undefined && Date.parse(payBy) <= Date.parse(t.early_until)) {
    throw new HttpError(409, 'early_after_pay_by', `Pick a Pay by after the early price ends (${payByLabel(t.early_until, group.timezone, t.final_date)}).`);
  }
  // Zip 76 (the 🎾75 audit): moved past now, every drop kept under the old Pay by comes back as credit in the same batch (the new Pay by would
  // not have kept it), the same back-out statements and History line as a refill. Moved earlier, or still past: nothing kept moves.
  const res = await ctx.db.batch([
    ctx.db.prepare("UPDATE tournaments SET pay_by = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'tickets' AND (early_until IS NULL OR early_cents IS NULL OR early_until < ?1)").bind(payBy, ctx.nowIso, t.id),
    ...releaseKeptStatements(ctx.db, group.id, t.id, ctx.nowIso, payByMovedLaterSql(t.id, ctx.nowIso)),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_pay_by', { tournament: t.name, payBy: payByLabel(payBy, group.timezone, t.final_date) }, ctx.nowIso);
  return { ok: true, payBy };
}

/**
 * POST /api/admin/tournament/:id/ticket { playerId, action, cents? }: the organizer's answers on one player's ticket.
 *   confirm    an I paid is real: the cash is paid (a ticket paid in full then takes an open spot, or holds a place in line). If the player has
 *              left the list, or the tournament was canceled, or the night is over without a spot, all of it comes back as credit at once.
 *   reject     "Didn't pay": the I paid goes; whatever else the ticket holds stays (or comes back as credit in those same cases).
 *   mark_paid  cash in hand for what is still owed (`cents` must be what the screen showed), while tickets are open.
 *   take_off   off the list for them: everything on the ticket comes back as credit, the spot opens, the first PAID person in line takes it.
 * Works on a canceled tournament too (an I paid there still needs its answer). Every statement is guarded by the ticket as it was read.
 */
export async function adminTicket(ctx: Ctx, body: Record<string, unknown>, markedPaid = false) {
  const group = await organizerOn(ctx);
  const id = v.id(ctx.params.id, 'tournament');
  const t = await ctx.db.prepare(`SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE id = ? AND group_id = ?`).bind(id, group.id).first<TournamentRow>();
  if (!t) throw new HttpError(404, 'not_found', 'That tournament is gone. Look again.');
  const playerId = v.id(body.playerId, 'playerId');
  const action = v.oneOf(body.action, 'action', ['confirm', 'reject', 'mark_paid', 'take_off'] as const);
  const shown = body.cents === undefined ? null : v.cents(body.cents, 'cents');
  const player = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!player) throw new HttpError(404, 'player_not_found', 'Player not found.');
  const name = player.display_name;
  const k = await ticketOf(ctx.db, t.id, playerId);
  const signup = await mySignup(ctx.db, t.id, playerId);
  // Zip 88: taking a player off an Americano night that has its games: the courts as they are, saved first (a started game never moves).
  if (action === 'take_off' && t.format === 'americano' && t.status === 'tickets') await saveAmericanoCourts(ctx, t, group.timezone);
  const night = nightOf(t, group.timezone);
  const endIso = night ? new Date(night.end).toISOString() : null;
  // When the money on a ticket comes back as credit at once: its player is off the list, the tournament is canceled, or the night is over and
  // it never got a spot.
  const settle = (x: string) =>
    // Zip 70: a kept late drop's money comes back only when the spot is taken again (or on a Cancel), never with an answer to an I paid.
    `(${offListBack(x)} OR ${tournamentCanceled(x)}${
      endIso
        ? ` OR (${x}.place <> 'spot' AND NOT ${keptOff(x)} AND ${sqlText(ctx.nowIso)} >= ${sqlText(endIso)} AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${x}.tournament_id AND tt.status = 'tickets'))`
        : ''
    })`;
  // Why the money comes back is worked out when the answer lands (a Cancel or a Back out in between counts), not from the read above.
  const back = ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId, why: 'auto', endedReason: 'auto', nowIso: ctx.nowIso, when: settle });

  // Zip 85: a debt from "Didn't pay" after the night started (shared/tournamentTickets.ts OWED_MARK). Mark paid on it is Paid.
  const owedBefore = !!k && isOwedClaim(k);
  // An owed ticket, or an I paid sent on one since: Paid gives it the spot it played in.
  const fromOwed = !!k && k.claim_cents > 0 && fromOwedClaim(k.claim_at);
  if (action === 'mark_paid' && fromOwed) return adminTicket(ctx, { ...body, action: 'confirm' }, true);
  if (action === 'confirm' || action === 'reject') {
    if (!k || k.claim_cents === 0) throw new HttpError(409, 'nothing_waiting', `${name} has no I paid waiting. Look again.`);
    if (shown !== null && shown !== k.claim_cents) throw new HttpError(409, 'amount_changed', `${name}’s I paid changed. Look again.`);
    if (owedBefore && action === 'reject') throw new HttpError(409, 'nothing_waiting', `${name} already owes ${formatPrice(k.claim_cents)}. Look again.`);
    // Zip 85 (🎾84 dry run, Alex approved): from the start of the night, a ticket that counts as locked in by this I paid (outside the line,
    // the I paid paying the rest, on the list) has played (or plays): Didn't pay keeps them in the night and leaves the amount owed, like any
    // unpaid game (OWED_MARK), instead of dropping them out of the night with nothing owed.
    const started = statusOf(t) !== 'canceled' && salesClosed(t, group.timezone, ctx.nowMs);
    const owes =
      action === 'reject' && started && k.place !== 'line' && k.credit_cents + k.paid_cents + k.claim_cents >= k.price_cents && signup?.status === 'in';
    // An owed ticket paid in full (they played) takes its spot at once, never a place in line that the night's end would hand back as credit.
    // Every other I paid is as before (a hold that never got a spot still comes back as credit once the night is over).
    const lineOrSpot = fromOwed ? "'spot'" : "'line'";
    // Lands only on the ticket exactly as read, its I paid time (or mark) included.
    const claimAtAsRead = k.claim_at === null ? 'claim_at IS NULL' : `claim_at = ${sqlText(k.claim_at)}`;
    const answer = owes
      ? ctx.db
          .prepare(`UPDATE tournament_tickets SET claim_at = '${OWED_MARK}', updated_at = ?1 WHERE id = ?2 AND ${ticketAsRead(k)} AND claim_at IS NOT '${OWED_MARK}'`)
          .bind(ctx.nowIso, k.id)
      : action === 'confirm'
        ? // SQLite reads every right-hand side from the row as it was: each CASE sees the old claim and the old place.
          ctx.db
            .prepare(
              `UPDATE tournament_tickets SET paid_cents = paid_cents + claim_cents, claim_cents = 0, claim_at = NULL,
                 paid_at = CASE WHEN credit_cents + paid_cents + claim_cents >= price_cents THEN ?1 ELSE paid_at END,
                 place = CASE WHEN place = 'none' AND credit_cents + paid_cents + claim_cents >= price_cents AND ${onList('tournament_tickets')} THEN ${lineOrSpot} ELSE place END,
                 place_at = CASE WHEN place = 'none' AND credit_cents + paid_cents + claim_cents >= price_cents AND ${onList('tournament_tickets')} THEN (CASE WHEN claim_at IS NULL OR claim_at LIKE '${OWED_MARK}%' THEN ?1 ELSE claim_at END) ELSE place_at END,
                 updated_at = ?1
               WHERE id = ?2 AND ${ticketAsRead(k)} AND ${claimAtAsRead}`,
            )
            .bind(ctx.nowIso, k.id)
        : ctx.db.prepare(`UPDATE tournament_tickets SET claim_cents = 0, claim_at = NULL, updated_at = ?1 WHERE id = ?2 AND ${ticketAsRead(k)}`).bind(ctx.nowIso, k.id);
    // Zip 85: an owed ticket keeps nothing to give back (its debt is the claim), so no money-back statement runs with that answer.
    const res = await ctx.db.batch([answer, ...(owes ? [] : back), ...fillSpotsStatements(ctx.db, group.id, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', `${name}’s ticket just changed. Look again.`);
    const after = await ticketOf(ctx.db, t.id, playerId);
    // What came back as credit at once (the ticket was settled because they left, a cancel, or the night is over).
    const credited = after && after.credit_cents + after.paid_cents === 0 ? k.credit_cents + k.paid_cents + (action === 'confirm' ? k.claim_cents : 0) : 0;
    await audit(
      ctx.db,
      group.id,
      null,
      action === 'confirm' ? 'tournament_ticket_confirmed' : owes ? 'tournament_ticket_owed' : 'tournament_ticket_rejected',
      { tournament: t.name, player: name, playerId, amountCents: k.claim_cents, ...(credited ? { creditCents: credited } : {}), ...(markedPaid ? { marked: true } : {}) },
      ctx.nowIso,
    );
    return { ok: true, ...answerOf(after), creditCents: credited, ...(owes ? { owedCents: k.claim_cents } : {}) };
  }

  if (action === 'mark_paid') {
    if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open. Look again.');
    if (salesClosed(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed. The tournament has started.');
    if (!signup || signup.status !== 'in') throw new HttpError(409, 'not_signed_up', `${name} is not on the list. Look again.`);
    if (k && k.claim_cents > 0) throw new HttpError(409, 'claim_waiting', `${name} tapped I paid. Answer that instead.`);
    const isOrganizer = playerId === (await organizerIdOf(ctx.db, group));
    // Reviews: nobody gets a ticket on a tournament they cannot see: not on Only me, and not while Tournaments is off for players (the organizer
    // can still work through the private link then). Everyone with tickets open never goes back to Only me.
    if (!isOrganizer && t.visibility !== 'all') throw new HttpError(409, 'only_me', 'Only you can see it. Show it to everyone first.');
    if (!isOrganizer && !(await tournamentsFlags(ctx, group.id)).forAll) throw new HttpError(409, 'switch_off', 'Tournaments are off for players. Turn the switch on first.');
    // Zip 94: the price that applies now (Alex's own Mark paid never earns the early price after the deadline); a ticket with money on it
    // keeps its own. Without an early bird: as before.
    const price = ticketPrice(t, k, isOrganizer, await earlyBirdOn(ctx, group.id, t), ctx.nowMs);
    const owed = k ? ticketOwed({ ...money(k), priceCents: price }) : price;
    if (owed === 0) return { ok: true, changed: false, ...answerOf(k) };
    if (shown !== null && shown !== owed) throw new HttpError(409, 'amount_changed', `${name} owes ${formatPrice(owed)} now. Look again.`);
    const write = k
      ? ctx.db
          .prepare(
            `UPDATE tournament_tickets SET price_cents = ?4, paid_cents = paid_cents + ?1, paid_at = ?2,
               place = CASE WHEN place = 'none' THEN 'line' ELSE place END, place_at = CASE WHEN place = 'none' THEN ?2 ELSE place_at END, updated_at = ?2
             WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
          )
          .bind(owed, ctx.nowIso, k.id, price)
      : ctx.db
          .prepare(
            `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, paid_cents, paid_at, created_at, updated_at)
             SELECT ?1, ?2, ?3, 'line', ?4, ?5, ?5, ?4, ?4, ?4 WHERE ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
          )
          .bind(newId(), t.id, playerId, ctx.nowIso, price);
    const res = await ctx.db.batch([write, ...fillSpotsStatements(ctx.db, group.id, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', `${name}’s ticket just changed. Look again.`);
    await audit(ctx.db, group.id, null, 'tournament_ticket_marked_paid', { tournament: t.name, player: name, playerId, amountCents: owed }, ctx.nowIso);
    return { ok: true, changed: true, ...answerOf(await ticketOf(ctx.db, t.id, playerId)) };
  }

  // take_off
  if (statusOf(t) === 'canceled') throw new HttpError(409, 'tournament_changed', 'This tournament was canceled. Look again.');
  // From the start of the night a ticket has been used: taking someone off then would give it back (review, Zip 56).
  if (salesClosed(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tournament_started', 'The tournament has started. Nobody can be taken off now.');
  if (!signup || signup.status !== 'in') return { ok: true, changed: false };
  // The money-back statements always run (they do nothing without a ticket): a Lock landing between the read and this batch still comes back.
  const res = await ctx.db
    .batch([
      ctx.db
        .prepare(`UPDATE tournament_signups SET status = 'off', backed_out_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'in' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?3 AND status <> 'canceled')`)
        .bind(ctx.nowIso, signup.id, t.id),
      ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId, why: 'off', endedReason: 'dropped', nowIso: ctx.nowIso, when: offListBack }),
      ...fillSpotsStatements(ctx.db, group.id, t.id, ctx.nowIso),
    ])
    .catch(lookAgainOn);
  if ((res[0].meta?.changes ?? 0) === 0) return { ok: true, changed: false };
  const moved = await movedBack(ctx.db, t.id, playerId, 'off', 'dropped', ctx.nowIso);
  const creditCents = moved.cash + moved.credit;
  await audit(
    ctx.db,
    group.id,
    null,
    'tournament_taken_off',
    { tournament: t.name, tournamentId: t.id, ...(heldSpotSincePayBy(t, k) ? { freedSpot: true } : {}), player: name, playerId, ...(creditCents ? { amountCents: creditCents } : {}), ...(moved.waiting ? { waitingCents: moved.waiting } : {}) },
    ctx.nowIso,
  );
  return { ok: true, changed: true, creditCents };
}

/**
 * POST /api/admin/tournament/:id/reschedule: back to the date step (piece 1's screens). The list stays; every player picks their dates again
 * (their old picks are cleared: "Rescheduled. Pick your dates again"); every ticket keeps its money and its place (paid tickets stay held), and
 * anyone can back out for credit. Picking a new date opens tickets again.
 */
export async function rescheduleTournament(ctx: Ctx) {
  const group: GroupRow = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (statusOf(t) !== 'date_picked' && statusOf(t) !== 'tickets') throw new HttpError(409, 'no_date', 'There is no date to move. Look again.');
  if (nightOver(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tournament_played', 'The tournament night is over. It cannot be moved now.');
  const held = (await loadTickets(ctx.db, t.id)).filter((k) => k.signup_status === 'in' && (k.place === 'spot' || k.credit_cents + k.paid_cents + k.claim_cents > 0)).length;
  const res = await ctx.db.batch([
    ctx.db
      .prepare("UPDATE tournaments SET status = 'rescheduled', final_date = NULL, date_picked_at = NULL, updated_at = ?1 WHERE id = ?2 AND status IN ('date_picked', 'tickets')")
      .bind(ctx.nowIso, t.id),
    // Zip 85 (review): a ticket owed after a Didn't pay on the night is no debt for a night that moved: it goes.
    ctx.db
      .prepare(`UPDATE tournament_tickets SET claim_cents = 0, claim_at = NULL, updated_at = ?1 WHERE tournament_id = ?2 AND claim_at = 'owed' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?2 AND status = 'rescheduled')`)
      .bind(ctx.nowIso, t.id),
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET dates = '[]', updated_at = ?1
         WHERE tournament_id = ?2 AND dates <> '[]' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?2 AND status = 'rescheduled' AND updated_at = ?1)`,
      )
      .bind(ctx.nowIso, t.id),
    // Zip 70 (review): a kept late drop paid for the night that was planned; a new date is not that night: their money comes back now.
    ...ticketBackStatements(ctx.db, {
      groupId: group.id,
      tournamentId: t.id,
      playerId: null,
      why: 'back',
      endedReason: 'dropped',
      nowIso: ctx.nowIso,
      when: (x) => `(${keptOff(x)} AND EXISTS (SELECT 1 FROM tournaments tr WHERE tr.id = ${x}.tournament_id AND tr.status = 'rescheduled'))`,
    }),
    ctx.db
      .prepare(`UPDATE tournament_signups SET status = 'out', updated_at = ?1 WHERE tournament_id = ?2 AND status = 'kept' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?2 AND status = 'rescheduled')`)
      .bind(ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_rescheduled', { tournament: t.name, ...(t.final_date ? { date: dayLong(t.final_date) } : {}), ...(held ? { held } : {}) }, ctx.nowIso);
  return { ok: true };
}
