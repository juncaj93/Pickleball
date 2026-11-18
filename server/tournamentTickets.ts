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
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit, type GroupRow, organizerIdOf } from './repo';
import { formatPrice } from '../shared/money';
import { dayLong, MAX_SPOTS } from '../shared/tournament';
import { payByLabel, ticketOwed, ticketPaid, type TicketMoney } from '../shared/tournamentTickets';
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
  salesClosed,
  statusOf,
  type TournamentActor,
  type TournamentRow,
} from './tournament';
import {
  fillSpotsStatement,
  loadTickets,
  offList,
  organizerSeatStatement,
  payWithCreditStatements,
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
  `EXISTS (SELECT 1 FROM tournaments WHERE id = ${sqlText(t.id)} AND status = 'tickets' AND final_date = ${sqlText(t.final_date ?? 'none')} AND ticket_cents = ${Number(t.ticket_cents) | 0})`;

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

/** A player's ticket tap: the tournament they may see, taking tickets, before the night starts, and they are on its list. */
async function ticketsTarget(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>): Promise<{ t: TournamentRow; playerId: string }> {
  const { t, playerId } = await playerTarget(ctx, who, body);
  if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open now. Look again.');
  if (salesClosed(t, who.group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed. The tournament has started.');
  const s = await mySignup(ctx.db, t.id, playerId);
  if (!s || s.status !== 'in') throw new HttpError(409, 'not_signed_up', 'You are not on the list. Sign up first.');
  return { t, playerId };
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
  const { t, playerId } = await ticketsTarget(ctx, who, body);
  const intent = body.intent === undefined ? 'lock' : v.oneOf(body.intent, 'intent', ['lock', 'hold'] as const);
  // The organizer pays the venue, never the group: their own seat is $0.
  const organizer = playerId === (await organizerIdOf(ctx.db, who.group));
  const price = organizer ? 0 : t.ticket_cents;
  if (body.priceCents !== undefined && (v.cents(body.priceCents, 'priceCents') ?? -1) !== price) {
    throw new HttpError(409, 'amount_changed', `The ticket is ${formatPrice(price)}. Look again.`);
  }
  const k = await ticketOf(ctx.db, t.id, playerId);
  // Locked in already, or paid and holding a place (a second tap, another phone): nothing to do.
  if (k && (k.place === 'spot' || ticketPaid(money(k)))) return { ok: true, creditUsedCents: 0, ...answerOf(k) };
  if (organizer) {
    // Their $0 seat: in line and paid, so the line gives them the open spot (or keeps them first in line).
    const res = await ctx.db.batch([organizerSeatStatement(ctx.db, t.id, playerId, ctx.nowIso), fillSpotsStatement(ctx.db, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) === 0) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
    const after = await ticketOf(ctx.db, t.id, playerId);
    await logPlayer(ctx, who.group, playerId, 'tournament_ticket', { tournament: t.name, creditUsedCents: 0, result: answerOf(after).result });
    return { ok: true, creditUsedCents: 0, ...answerOf(after) };
  }
  const tickets = await loadTickets(ctx.db, t.id);
  if (intent === 'lock' && tickets.filter((x) => x.place === 'spot').length >= MAX_SPOTS) {
    throw new HttpError(409, 'spots_full', `All ${MAX_SPOTS} spots just filled. Join the waitlist.`);
  }
  // The ticket as it will be after its first statement: a new one (Hold puts it in line), or the one read (Hold puts it in line if it was not).
  const ticketId = k?.id ?? newId();
  const statements = [];
  let read: TicketRow;
  if (!k) {
    read = { id: ticketId, tournament_id: t.id, player_id: playerId, place: intent === 'hold' ? 'line' : 'none', place_at: intent === 'hold' ? ctx.nowIso : null, price_cents: price, credit_cents: 0, paid_cents: 0, claim_cents: 0, claim_at: null, paid_at: null, created_at: ctx.nowIso, updated_at: ctx.nowIso };
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
        )
        .bind(ticketId, t.id, playerId, read.place, read.place_at, price, ctx.nowIso),
    );
  } else if (intent === 'hold' && k.place === 'none') {
    read = { ...k, place: 'line', place_at: k.claim_at ?? ctx.nowIso };
    // Into the line only while tickets are open and they are on the list (a Cancel or their own Back out in between: nothing).
    statements.push(
      ctx.db
        .prepare(`UPDATE tournament_tickets SET place = 'line', place_at = ?1, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`)
        .bind(read.place_at, ctx.nowIso, k.id),
    );
  } else {
    read = k;
  }
  // Lock: only while a spot is open at that very moment (a race for the last spot never spends credit on a spot that is gone).
  const guard = `${ticketAsRead(read)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}${intent === 'lock' ? ` AND ${spotsSql(t.id)} < ${MAX_SPOTS}` : ''}`;
  const usedId = newId();
  const pay = payWithCreditStatements(ctx.db, { groupId: who.group.id, tournamentId: t.id, playerId, ticketId, usedId, nowIso: ctx.nowIso, guard });
  const at = statements.length + pay.ticketStatement;
  statements.push(...pay.statements);
  const res = await ctx.db.batch(statements).catch(lookAgainOn);
  if ((res[at].meta?.changes ?? 0) !== 1) {
    throw intent === 'lock' ? new HttpError(409, 'spots_full', `All ${MAX_SPOTS} spots just filled. Join the waitlist.`) : new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  }
  const used = (await ctx.db.prepare('SELECT amount_cents AS c FROM credit_ledger WHERE id = ?').bind(usedId).first<{ c: number }>())?.c ?? 0;
  const after = await ticketOf(ctx.db, t.id, playerId);
  const out = answerOf(after);
  await logPlayer(ctx, who.group, playerId, 'tournament_ticket', { tournament: t.name, intent, creditUsedCents: used, result: out.result });
  return { ok: true, creditUsedCents: used, ...out };
}

/**
 * POST /api/tournament/paid { tournamentId, cents }: "I paid" on the Pay sheet, for exactly what the sheet showed. It waits for the organizer
 * (Paid or Didn't pay on their Home card) like every I paid on the site; it holds no spot until then. A second tap changes nothing.
 */
export async function playerTicketPaid(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await ticketsTarget(ctx, who, body);
  const cents = v.cents(body.cents, 'cents') ?? 0;
  const k = await ticketOf(ctx.db, t.id, playerId);
  if (!k) throw new HttpError(409, 'nothing_owed', 'There is nothing to pay. Look again.');
  const owed = ticketOwed(money(k));
  // Already claimed or paid (a second tap, another phone): nothing new.
  if (owed === 0) return { ok: true, ...answerOf(k), claimCents: k.claim_cents };
  if (cents !== owed) throw new HttpError(409, 'amount_changed', `The amount changed to ${formatPrice(owed)}. Look again.`);
  const res = await ctx.db
    .prepare(`UPDATE tournament_tickets SET claim_cents = claim_cents + ?1, claim_at = ?2, updated_at = ?2 WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`)
    .bind(owed, ctx.nowIso, k.id)
    .run();
  if ((res.meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  await logPlayer(ctx, who.group, playerId, 'tournament_i_paid', { tournament: t.name, amountCents: owed });
  return { ok: true, ...answerOf(await ticketOf(ctx.db, t.id, playerId)), claimCents: owed };
}

/**
 * POST /api/tournament/waitlist { tournamentId }: "Join waitlist" while every spot is taken. They go to the end of the line (an I paid that is
 * already waiting keeps the moment it was tapped). Paying to hold is the next tap (Hold my spot); unpaid they simply stay in line.
 */
export async function playerTicketWaitlist(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await ticketsTarget(ctx, who, body);
  const k = await ticketOf(ctx.db, t.id, playerId);
  if (k && (k.place === 'line' || k.place === 'spot')) return { ok: true, result: k.place === 'spot' ? 'locked' : 'waitlist', position: await linePosition(ctx, t, playerId) };
  const tickets = await loadTickets(ctx.db, t.id);
  if (tickets.filter((x) => x.place === 'spot').length < MAX_SPOTS) throw new HttpError(409, 'spots_open', 'A spot is open. Lock it now.');
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
            .bind(newId(), t.id, playerId, ctx.nowIso, t.ticket_cents),
        ];
  const res = await ctx.db.batch([...statements, fillSpotsStatement(ctx.db, t.id, ctx.nowIso)]).catch(lookAgainOn);
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

/** A Pay by time from the organizer: an exact moment from now on, no later than the start of the tournament night. */
function readPayBy(raw: unknown, nowMs: number, startMs: number): string {
  const iso = v.isoTime(raw, 'payBy');
  if (!iso) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time.');
  const ms = Date.parse(iso);
  if (ms <= nowMs) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time that has not passed.');
  if (ms > startMs) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time before the tournament starts.');
  return iso;
}

/** PUT /api/admin/tournament/:id/pay-by { payBy }: a new Pay by while tickets are open. */
export async function setPayBy(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open. Look again.');
  const payBy = readPayBy(body.payBy, ctx.nowMs, nightOf(t, group.timezone)!.start);
  changedOrLookAgain(await ctx.db.prepare("UPDATE tournaments SET pay_by = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'tickets'").bind(payBy, ctx.nowIso, t.id).run());
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
export async function adminTicket(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const id = v.id(ctx.params.id, 'tournament');
  const t = await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ? AND group_id = ?').bind(id, group.id).first<TournamentRow>();
  if (!t) throw new HttpError(404, 'not_found', 'That tournament is gone. Look again.');
  const playerId = v.id(body.playerId, 'playerId');
  const action = v.oneOf(body.action, 'action', ['confirm', 'reject', 'mark_paid', 'take_off'] as const);
  const shown = body.cents === undefined ? null : v.cents(body.cents, 'cents');
  const player = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!player) throw new HttpError(404, 'player_not_found', 'Player not found.');
  const name = player.display_name;
  const k = await ticketOf(ctx.db, t.id, playerId);
  const signup = await mySignup(ctx.db, t.id, playerId);
  const night = nightOf(t, group.timezone);
  const endIso = night ? new Date(night.end).toISOString() : null;
  // When the money on a ticket comes back as credit at once: its player is off the list, the tournament is canceled, or the night is over and
  // it never got a spot.
  const settle = (x: string) =>
    `(${offList(x)} OR ${tournamentCanceled(x)}${
      endIso ? ` OR (${x}.place <> 'spot' AND ${sqlText(ctx.nowIso)} >= ${sqlText(endIso)} AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${x}.tournament_id AND tt.status = 'tickets'))` : ''
    })`;
  // Why the money comes back is worked out when the answer lands (a Cancel or a Back out in between counts), not from the read above.
  const back = ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId, why: 'auto', endedReason: 'auto', nowIso: ctx.nowIso, when: settle });

  if (action === 'confirm' || action === 'reject') {
    if (!k || k.claim_cents === 0) throw new HttpError(409, 'nothing_waiting', `${name} has no I paid waiting. Look again.`);
    if (shown !== null && shown !== k.claim_cents) throw new HttpError(409, 'amount_changed', `${name}'s I paid changed. Look again.`);
    const answer =
      action === 'confirm'
        ? // SQLite reads every right-hand side from the row as it was: each CASE sees the old claim and the old place.
          ctx.db
            .prepare(
              `UPDATE tournament_tickets SET paid_cents = paid_cents + claim_cents, claim_cents = 0, claim_at = NULL,
                 paid_at = CASE WHEN credit_cents + paid_cents + claim_cents >= price_cents THEN ?1 ELSE paid_at END,
                 place = CASE WHEN place = 'none' AND credit_cents + paid_cents + claim_cents >= price_cents THEN 'line' ELSE place END,
                 place_at = CASE WHEN place = 'none' AND credit_cents + paid_cents + claim_cents >= price_cents THEN COALESCE(claim_at, ?1) ELSE place_at END,
                 updated_at = ?1
               WHERE id = ?2 AND ${ticketAsRead(k)}`,
            )
            .bind(ctx.nowIso, k.id)
        : ctx.db.prepare(`UPDATE tournament_tickets SET claim_cents = 0, claim_at = NULL, updated_at = ?1 WHERE id = ?2 AND ${ticketAsRead(k)}`).bind(ctx.nowIso, k.id);
    const res = await ctx.db.batch([answer, ...back, fillSpotsStatement(ctx.db, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', `${name}'s ticket just changed. Look again.`);
    const after = await ticketOf(ctx.db, t.id, playerId);
    // What came back as credit at once (the ticket was settled because they left, a cancel, or the night is over).
    const credited = after && after.credit_cents + after.paid_cents === 0 ? k.credit_cents + k.paid_cents + (action === 'confirm' ? k.claim_cents : 0) : 0;
    await audit(
      ctx.db,
      group.id,
      null,
      action === 'confirm' ? 'tournament_ticket_confirmed' : 'tournament_ticket_rejected',
      { tournament: t.name, player: name, playerId, amountCents: k.claim_cents, ...(credited ? { creditCents: credited } : {}) },
      ctx.nowIso,
    );
    return { ok: true, ...answerOf(after), creditCents: credited };
  }

  if (action === 'mark_paid') {
    if (statusOf(t) !== 'tickets') throw new HttpError(409, 'tickets_not_open', 'Tickets are not open. Look again.');
    if (salesClosed(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed. The tournament has started.');
    if (!signup || signup.status !== 'in') throw new HttpError(409, 'not_signed_up', `${name} is not on the list. Look again.`);
    if (k && k.claim_cents > 0) throw new HttpError(409, 'claim_waiting', `${name} tapped I paid. Answer that instead.`);
    const isOrganizer = playerId === (await organizerIdOf(ctx.db, group));
    // Review: on Only me nobody else can see it, so nobody else can hold a ticket on it (Everyone with tickets open never goes back to Only me).
    if (t.visibility !== 'all' && !isOrganizer) throw new HttpError(409, 'only_me', 'Only you can see it. Show it to everyone first.');
    const price = k ? k.price_cents : isOrganizer ? 0 : t.ticket_cents;
    const owed = k ? ticketOwed(money(k)) : price;
    if (owed === 0) return { ok: true, changed: false, ...answerOf(k) };
    if (shown !== null && shown !== owed) throw new HttpError(409, 'amount_changed', `${name} owes ${formatPrice(owed)} now. Look again.`);
    const write = k
      ? ctx.db
          .prepare(
            `UPDATE tournament_tickets SET paid_cents = paid_cents + ?1, paid_at = ?2,
               place = CASE WHEN place = 'none' THEN 'line' ELSE place END, place_at = CASE WHEN place = 'none' THEN ?2 ELSE place_at END, updated_at = ?2
             WHERE id = ?3 AND ${ticketAsRead(k)} AND ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
          )
          .bind(owed, ctx.nowIso, k.id)
      : ctx.db
          .prepare(
            `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, paid_cents, paid_at, created_at, updated_at)
             SELECT ?1, ?2, ?3, 'line', ?4, ?5, ?5, ?4, ?4, ?4 WHERE ${ticketsOpenSql(t)} AND ${onListSql(t.id, playerId)}`,
          )
          .bind(newId(), t.id, playerId, ctx.nowIso, price);
    const res = await ctx.db.batch([write, fillSpotsStatement(ctx.db, t.id, ctx.nowIso)]).catch(lookAgainOn);
    if ((res[0].meta?.changes ?? 0) !== 1) throw new HttpError(409, 'tournament_changed', `${name}'s ticket just changed. Look again.`);
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
      ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId, why: 'off', endedReason: 'dropped', nowIso: ctx.nowIso, when: offList }),
      fillSpotsStatement(ctx.db, t.id, ctx.nowIso),
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
    { tournament: t.name, player: name, playerId, ...(creditCents ? { amountCents: creditCents } : {}), ...(moved.waiting ? { waitingCents: moved.waiting } : {}) },
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
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET dates = '[]', updated_at = ?1
         WHERE tournament_id = ?2 AND dates <> '[]' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?2 AND status = 'rescheduled' AND updated_at = ?1)`,
      )
      .bind(ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_rescheduled', { tournament: t.name, ...(t.final_date ? { date: dayLong(t.final_date) } : {}), ...(held ? { held } : {}) }, ctx.nowIso);
  return { ok: true };
}
