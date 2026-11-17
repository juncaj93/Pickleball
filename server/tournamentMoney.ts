// Zip 56 "Tournaments", piece 2: the database work for ticket money (the rules: shared/tournamentTickets.ts; the taps: server/tournamentTickets.ts
// and server/tournament.ts). Nothing here imports the tournament routes, so both route files can use it.
//
// Every statement works out its amounts INSIDE the database from the rows as they are at that moment and only does something while there is
// still something to do, the way server/credit.ts moves a seat's money. So each one can run in the same all-or-nothing batch as the change
// that causes it (a back out, a cancel, an answer to an I paid), and a second tap, a refresh or a retry finds nothing left and changes nothing.
// Credit is spent only through USABLE (the pot minus a pending cash out), so no pot can go below $0.
import type { D1Database, D1PreparedStatement } from './db';
import { USABLE } from './credit';
import { tourBackReason, tourReason, type TourBackWhy } from '../shared/tournamentTickets';

export interface TicketRow {
  id: string;
  tournament_id: string;
  player_id: string;
  place: string;
  place_at: string | null;
  price_cents: number;
  credit_cents: number;
  paid_cents: number;
  claim_cents: number;
  claim_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

/** An id or a time this server made, put straight into SQL text; refused if it could break out of the quotes. */
export function sqlText(value: string): string {
  if (!/^[0-9A-Za-z:.\-]+$/.test(value)) throw new Error('unsafe sql text');
  return `'${value}'`;
}

const int = (n: number | null | undefined): number => {
  const x = Number(n ?? 0);
  if (!Number.isInteger(x)) throw new Error('not a whole number');
  return x;
};

/** A new random id made by SQLite itself (the shape newId() makes), for rows inserted from a SELECT. */
const SQL_ID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

/** The stages a tournament takes tickets in or holds them through (a canceled one holds nothing). */
export const TICKET_STAGES = "('signup', 'date_picked', 'tickets', 'rescheduled')";

/** SQL: the ticket is exactly as it was read (its place and every amount), so a second device or a retry changes nothing. */
export function ticketAsRead(k: TicketRow): string {
  return `EXISTS (SELECT 1 FROM tournament_tickets WHERE id = ${sqlText(k.id)} AND place = ${sqlText(k.place)} AND price_cents = ${int(k.price_cents)}
    AND credit_cents = ${int(k.credit_cents)} AND paid_cents = ${int(k.paid_cents)} AND claim_cents = ${int(k.claim_cents)})`;
}

/** SQL over a ticket alias: its player is on the list (not backed out). */
export const onList = (x: string): string =>
  `EXISTS (SELECT 1 FROM tournament_signups s WHERE s.tournament_id = ${x}.tournament_id AND s.player_id = ${x}.player_id AND s.status = 'in')`;

/** SQL over a ticket alias: its player is off the list (backed out, or taken off by the organizer). */
export const offList = (x: string): string =>
  `EXISTS (SELECT 1 FROM tournament_signups s WHERE s.tournament_id = ${x}.tournament_id AND s.player_id = ${x}.player_id AND s.status <> 'in')`;

/** SQL over a ticket alias: its tournament is canceled. */
export const tournamentCanceled = (x: string): string => `EXISTS (SELECT 1 FROM tournaments t WHERE t.id = ${x}.tournament_id AND t.status = 'canceled')`;

/**
 * Every open spot goes to the first PAID people in line, in the order they joined it (only people still on the list). Never more spots
 * than the size (the LIMIT, and the database's own cap trigger behind it). Runs after every change that can open a spot or pay a ticket in line.
 */
export function fillSpotsStatement(db: D1Database, tournamentId: string, nowIso: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tournament_tickets SET place = 'spot', place_at = ?2, updated_at = ?2
       WHERE id IN (
         SELECT x.id FROM tournament_tickets x
         WHERE x.tournament_id = ?1 AND x.place = 'line' AND x.credit_cents + x.paid_cents >= x.price_cents AND ${onList('x')}
         ORDER BY x.place_at, x.rowid
         LIMIT MAX(0, (SELECT size FROM tournaments WHERE id = ?1) - (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = ?1 AND place = 'spot')))
       AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?1 AND status IN ${TICKET_STAGES})`,
    )
    .bind(tournamentId, nowIso);
}

/**
 * Money back from tickets as credit, by the site's rules: credit used on a ticket goes back to the pot (its live 'used' rows end with
 * `endedReason`), cash the organizer confirmed becomes ONE new credit entry per ticket (reason 'tour:<id>:<why>'), and the ticket is left with
 * nothing on it and no place. A ticket with an I paid still waiting keeps every cent it holds (only confirmed money becomes credit, so nothing
 * moves until the organizer answers) but loses its place. `when(alias)` is the SQL a ticket must meet, written over the alias given, true both
 * before and after this runs (the player is off the list, the tournament is canceled). `playerId` limits it to one player's ticket.
 */
export function ticketBackStatements(
  db: D1Database,
  args: { groupId: string; tournamentId: string; playerId: string | null; why: TourBackWhy; endedReason: 'dropped' | 'canceled'; nowIso: string; when: (x: string) => string },
): D1PreparedStatement[] {
  const { groupId, tournamentId, playerId, why, endedReason, nowIso, when } = args;
  const t = sqlText(tournamentId);
  const who = (x: string) => (playerId ? ` AND ${x}.player_id = ${sqlText(playerId)}` : '');
  return [
    // 1. Confirmed cash: one credit entry per ticket, for exactly what it holds now.
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason)
         SELECT ${SQL_ID}, ?1, x.player_id, 'kept', x.paid_cents, 0, NULL, ?2, ?3
         FROM tournament_tickets x WHERE x.tournament_id = ${t}${who('x')} AND x.paid_cents > 0 AND x.claim_cents = 0 AND ${when('x')}`,
      )
      .bind(groupId, nowIso, tourBackReason(tournamentId, why)),
    // 2. Credit used on it: back to the pot (the rows end; an ended row no longer counts).
    db
      .prepare(
        `UPDATE credit_ledger SET ended_at = ?1, ended_reason = ?2
         WHERE kind = 'used' AND ended_at IS NULL AND reason = ?3
           AND player_id IN (SELECT x.player_id FROM tournament_tickets x WHERE x.tournament_id = ${t}${who('x')} AND x.credit_cents > 0 AND x.claim_cents = 0 AND ${when('x')})`,
      )
      .bind(nowIso, endedReason, tourReason(tournamentId)),
    // 3. The ticket itself: nothing on it, no place (an I paid that waits keeps what it holds).
    db
      .prepare(
        `UPDATE tournament_tickets SET
           credit_cents = CASE WHEN claim_cents = 0 THEN 0 ELSE credit_cents END,
           paid_cents = CASE WHEN claim_cents = 0 THEN 0 ELSE paid_cents END,
           paid_at = CASE WHEN claim_cents = 0 THEN NULL ELSE paid_at END,
           place = 'none', place_at = NULL, updated_at = ?1
         WHERE tournament_id = ${t}${who('tournament_tickets')} AND ${when('tournament_tickets')}
           AND (place <> 'none' OR (claim_cents = 0 AND (credit_cents > 0 OR paid_cents > 0)))`,
      )
      .bind(nowIso),
  ];
}

/**
 * Lock my spot / Hold my spot: the player's usable credit goes on the ticket at once (the site's rule at I'm in), up to what it still owes,
 * as one 'used' row (reason 'tour:<id>', no game). Then a ticket paid in full joins the line (or keeps its place in it) and the line fills
 * every open spot. `guard`: SQL every statement must also meet (the ticket as read, tickets open, a spot open for "Lock my spot").
 * Returns the statements and the index of the ticket update (its `changes` must be 1).
 */
export function payWithCreditStatements(
  db: D1Database,
  args: { groupId: string; tournamentId: string; playerId: string; ticketId: string; usedId: string; nowIso: string; guard: string },
): { statements: D1PreparedStatement[]; ticketStatement: number } {
  const { groupId, tournamentId, playerId, ticketId, usedId, nowIso, guard } = args;
  const k = sqlText(ticketId);
  const owed = `(SELECT price_cents - credit_cents - paid_cents - claim_cents FROM tournament_tickets WHERE id = ${k})`;
  const used = `COALESCE((SELECT amount_cents FROM credit_ledger WHERE id = ${sqlText(usedId)}), 0)`;
  return {
    statements: [
      db
        .prepare(
          `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason)
           SELECT ?1, ?2, ?3, 'used', MIN(${owed}, ${USABLE('?3')}), 0, NULL, ?4, ?5
           WHERE ${USABLE('?3')} > 0 AND ${owed} > 0 AND ${guard}`,
        )
        .bind(usedId, groupId, playerId, nowIso, tourReason(tournamentId)),
      // SQLite reads every right-hand side from the row as it was, so each CASE sees the old place and the old credit.
      db
        .prepare(
          `UPDATE tournament_tickets SET
             credit_cents = credit_cents + ${used},
             paid_at = CASE WHEN credit_cents + ${used} + paid_cents >= price_cents AND paid_at IS NULL THEN ?1 ELSE paid_at END,
             place = CASE WHEN place = 'none' AND credit_cents + ${used} + paid_cents >= price_cents THEN 'line' ELSE place END,
             place_at = CASE WHEN place = 'none' AND credit_cents + ${used} + paid_cents >= price_cents THEN ?1 ELSE place_at END,
             updated_at = ?1
           WHERE id = ${k} AND ${guard}`,
        )
        .bind(nowIso),
      fillSpotsStatement(db, tournamentId, nowIso),
    ],
    ticketStatement: 1,
  };
}

/**
 * The organizer's own seat ($0: the organizer pays the venue, never the group): while tickets are open and the organizer is on the list, their
 * ticket is paid and in line, and the line then fills a spot like any other. Never touches a ticket that holds money or an I paid.
 */
export function organizerSeatStatement(db: D1Database, tournamentId: string, organizerId: string, nowIso: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at)
       SELECT ${SQL_ID}, ?1, ?2, 'line', ?3, 0, ?3, ?3
       WHERE EXISTS (SELECT 1 FROM tournament_signups WHERE tournament_id = ?1 AND player_id = ?2 AND status = 'in')
         AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?1 AND status = 'tickets')
       ON CONFLICT (tournament_id, player_id) DO UPDATE SET place = 'line', place_at = excluded.place_at, price_cents = 0, updated_at = excluded.updated_at
         WHERE tournament_tickets.place = 'none' AND tournament_tickets.credit_cents = 0 AND tournament_tickets.paid_cents = 0 AND tournament_tickets.claim_cents = 0`,
    )
    .bind(tournamentId, organizerId, nowIso);
}

/** Every ticket of a tournament with the player's name and list status, Who's in first (in spot order), then the line, then the rest. */
export const ticketsSql = `SELECT k.*, p.display_name, COALESCE(s.status, 'out') AS signup_status FROM tournament_tickets k
  JOIN players p ON p.id = k.player_id
  LEFT JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id
  WHERE k.tournament_id = ? ORDER BY CASE k.place WHEN 'spot' THEN 0 WHEN 'line' THEN 1 ELSE 2 END, k.place_at, k.rowid`;

export type TicketWithName = TicketRow & { display_name: string; signup_status: string };

/** The tickets of a tournament (none on a database before migration 0024: then there are no tickets). */
export async function loadTickets(db: D1Database, tournamentId: string): Promise<TicketWithName[]> {
  try {
    const { results } = await db.prepare(ticketsSql).bind(tournamentId).all<TicketWithName>();
    return results;
  } catch (err) {
    if (/no such table/i.test(String(err instanceof Error ? err.message : err))) return [];
    throw err;
  }
}

/** One player's ticket for a tournament, or null. */
export async function ticketOf(db: D1Database, tournamentId: string, playerId: string): Promise<TicketRow | null> {
  return db.prepare('SELECT * FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').bind(tournamentId, playerId).first<TicketRow>();
}
