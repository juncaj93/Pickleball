import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { setTournamentsForAll, todayKey } from './tournament';
import { previewSiteFor } from './secondChance';
import { organizerIdOf } from './repo';
import { dayKey, dayParts, FORMATS, monthsBetween, monthStartPlus } from '../shared/tournament';
import { defaultPayBy, tourReason } from '../shared/tournamentTickets';
import { ticketBackStatements, tournamentCanceled } from './tournamentMoney';

// Zip 55, PREVIEW ONLY: the "Tournament test" page's server half. POST /api/admin/tournament-test { stage } puts the fake tournament back to a
// stage, using only the preview's fixed fake names (docs/PREVIEW_FAKE_DB.md), and turns the Tournaments row on (a re-seed from another branch
// drops it). It answers Not found anywhere PREVIEW_CALM is not "on" (that var exists only in [env.preview.vars]; the live site has none, the
// same check the preview-only ?as=Name link uses), so on live this route does nothing at all. No new Cloudflare variable.
//   none         no tournament (to try Create from Settings > Schedule)
//   signup       "Winter Classic", Everyone, sign-up open, 6 on the list (Vic, Zoe, Reese and Alex are not)
//   date_picked  the same with 8 on the list, Sage's level set to 3.4, and the date most of them can make picked
// Zip 56 (piece 2), each from the date picked above, tickets open ($16, 8 spots, Pay by two days before at 7:00 PM):
//   tickets_open   6 of 8 locked in (Parker, Rowan, Sage, Christopher, Wren, Quinn: Venmo confirmed, Sage with credit); Vic, Zoe and Reese on
//                  the list with no ticket: Vic sees Lock my spot ($16), the pictures' 07 to 10
//   spots_full     8 of 8 locked in (Alex's own $0 seat, Parker, Rowan, Sage, Christopher, Wren, Quinn, Zoe); Reese paid and first in line;
//                  Vic on the list with no ticket: Vic sees "8 spots taken" and Join waitlist; Zoe backing out moves Reese in (11, 12)
//   all_locked     8 of 8 locked in, Vic among them (Vic sees You're in), nobody waiting (Zoe and Reese are not on the list)
//   odd            7 locked in and Pay by already passed: the organizer's card says "7 locked in. Need 1 more or 1 less."
//   canceled       spots_full, then Cancel tournament (the real statements): every paid ticket is credit now; players on the list see Canceled
//   rescheduled    tickets_open, then Reschedule (the real statements): back to the date step, tickets held, "Rescheduled. Pick your dates again"
// Every ticket's money is real on the fake database (a confirmed Venmo payment, or credit the stage first gives as a "Tournament test" credit
// adjustment), so the books read all zeros (scripts/integrity-checks-tournament.sql) at every stage. A new stage first takes out the last one's
// ticket credit rows and test credit (the fake database only).
// The page's own words and buttons live in src/pages/admin/TournamentTest.tsx, which only a preview build carries.

export const TEST_STAGES = ['none', 'signup', 'date_picked', 'tickets_open', 'spots_full', 'all_locked', 'odd', 'canceled', 'rescheduled'] as const;
type Stage = (typeof TEST_STAGES)[number];

/** The fixed names and their picks (Kai is not one of the preview's names, so he is not here). Levels in hundredths. */
const CAST: { name: string; level: number; stage: 'signup' | 'date_picked'; every: number; offset: number }[] = [
  { name: 'Parker', level: 360, stage: 'signup', every: 2, offset: 0 },
  { name: 'Rowan', level: 350, stage: 'signup', every: 1, offset: 0 },
  { name: 'Sage', level: 300, stage: 'signup', every: 3, offset: 1 },
  { name: 'Christopher Vanderberg', level: 300, stage: 'signup', every: 2, offset: 1 },
  { name: 'Wren', level: 320, stage: 'signup', every: 3, offset: 2 },
  { name: 'Quinn', level: 250, stage: 'signup', every: 2, offset: 0 },
  { name: 'Zoe', level: 275, stage: 'date_picked', every: 3, offset: 0 },
  { name: 'Reese', level: 340, stage: 'date_picked', every: 2, offset: 1 },
];
/** Zip 56: the two more names the ticket stages put on the list. */
const MORE_CAST: Record<string, number> = { Vic: 320, Alex: 340 };

/** Every Tuesday to Friday of next month and the first two weeks of the month after (no Christmas Eve, Christmas, New Year's Eve or Day). */
export function testDates(today: string): string[] {
  const from = monthStartPlus(today, 1);
  const to = monthStartPlus(today, 2);
  const skip = (d: string) => /-12-(24|25|31)$|-01-01$/.test(d);
  const out: string[] = [];
  for (const m of monthsBetween(from, to)) {
    for (const d of m.days) {
      const p = dayParts(d);
      if (p.weekday < 2 || p.weekday > 5 || skip(d)) continue;
      if (p.month === dayParts(to).month && p.day > 14) continue;
      out.push(d);
    }
  }
  return out;
}

/** Zip 56: who is on the list at each ticket stage, and their ticket: a spot, a place in line, or none; paid by Venmo, credit, $0 (Alex), or not. */
const TICKET_STAGES: Partial<Record<Stage, { name: string; place: 'spot' | 'line' | 'none'; pay: 'cash' | 'credit' | 'free' | 'none' }[]>> = {
  tickets_open: [
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
    { name: 'Zoe', place: 'none', pay: 'none' },
    { name: 'Reese', place: 'none', pay: 'none' },
  ],
  spots_full: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'line', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
  ],
  all_locked: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'spot', pay: 'cash' },
  ],
  odd: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
  ],
};

const TEST_CREDIT = 'adjusted:Tournament test';

export async function tournamentTestStage(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (!previewSiteFor(ctx)) throw new HttpError(404, 'not_found', 'Not found.');
  const stage = v.oneOf(body.stage, 'stage', TEST_STAGES);
  // Either format at each stage (left out: Doubles). Americano has its own name and the 2nd place credit.
  const format = body.format === undefined ? 'doubles' : v.oneOf(body.format, 'format', FORMATS);
  await setTournamentsForAll(ctx.db, group.id, true, ctx.nowIso);
  // The fake database only: the last stage's ticket credit rows and test credit go, then every tournament of the (fake) group; its sign-ups,
  // level history and tickets go with it (ON DELETE CASCADE).
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM credit_ledger WHERE group_id = ? AND (reason LIKE 'tour:%' OR reason = ?)").bind(group.id, TEST_CREDIT),
    ctx.db.prepare('DELETE FROM tournaments WHERE group_id = ?').bind(group.id),
  ]);
  if (stage === 'none') return { ok: true, stage };

  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  // The date everyone on the list can make: the third Thursday of next month (or the middle offered date).
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  const best = thursdays[2] ?? dates[Math.floor(dates.length / 2)];
  const tickets = TICKET_STAGES[stage === 'canceled' ? 'spots_full' : stage === 'rescheduled' ? 'tickets_open' : stage] ?? null;
  const picked = stage !== 'signup';
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const payBy = stage === 'odd' ? new Date(ctx.nowMs - 3_600_000).toISOString() : defaultPayBy(best, 1170, group.timezone, ctx.nowMs);
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by)
         VALUES (?, ?, ?, 8, 2, 120, 1170, 1600, 1400, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        format === 'americano' ? 'Winter Americano' : 'Winter Classic',
        JSON.stringify(dates),
        picked ? best : null,
        tickets ? 'tickets' : stage,
        at(0),
        ctx.nowIso,
        picked ? ctx.nowIso : null,
        at(1),
        format,
        format === 'americano' ? 700 : 0,
        tickets ? payBy : null,
      ),
  ];
  // Who is on the list: piece 1's stages as before; a ticket stage exactly its own names.
  const listed = tickets
    ? tickets.map((s) => ({ name: s.name, level: CAST.find((c) => c.name === s.name)?.level ?? MORE_CAST[s.name] ?? 320, every: CAST.find((c) => c.name === s.name)?.every ?? 2, offset: CAST.find((c) => c.name === s.name)?.offset ?? 0 }))
    : CAST.filter((c) => c.stage === 'signup' || stage !== 'signup');
  let n = 0;
  for (const c of listed) {
    const pid = idOf.get(c.name);
    if (!pid) continue;
    n++;
    const picks = [...new Set([...dates.filter((_, i) => (i + c.offset) % c.every === 0), best])].sort();
    const approved = picked && c.name === 'Sage' ? 340 : null;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, c.level, approved, JSON.stringify(picks), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
    if (approved !== null) {
      statements.push(ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'organizer', ?)").bind(newId(), id, pid, approved, ctx.nowIso));
    }
  }
  // Zip 56: the tickets, with real money on the fake database: a confirmed Venmo payment, or credit (given first as a test adjustment, then used).
  const organizerId = await organizerIdOf(ctx.db, group);
  let k = 0;
  for (const s of tickets ?? []) {
    const pid = idOf.get(s.name);
    if (!pid || s.pay === 'none') continue;
    k++;
    const free = s.pay === 'free' || pid === organizerId;
    const price = free ? 0 : 1600;
    const paidAt = at(200 + k * 11);
    if (s.pay === 'credit' && !free) {
      statements.push(
        ctx.db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'kept', 1600, 0, NULL, ?, ?)").bind(newId(), group.id, pid, at(150), TEST_CREDIT),
        ctx.db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'used', 1600, 0, NULL, ?, ?)").bind(newId(), group.id, pid, paidAt, tourReason(id)),
      );
    }
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, s.place, paidAt, price, s.pay === 'credit' && !free ? 1600 : 0, s.pay === 'cash' && !free ? 1600 : 0, paidAt, paidAt, paidAt),
    );
  }
  await ctx.db.batch(statements);
  // Canceled and Rescheduled are made by the very statements the organizer's taps run (server/tournament.ts, server/tournamentTickets.ts).
  if (stage === 'canceled') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?").bind(ctx.nowIso, ctx.nowIso, id),
      ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: id, playerId: null, why: 'cancel', endedReason: 'canceled', nowIso: ctx.nowIso, when: tournamentCanceled }),
    ]);
  }
  if (stage === 'rescheduled') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'rescheduled', final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ?").bind(ctx.nowIso, id),
      ctx.db.prepare("UPDATE tournament_signups SET dates = '[]', updated_at = ? WHERE tournament_id = ?").bind(ctx.nowIso, id),
    ]);
  }
  return { ok: true, stage, format, id, signedUp: n, tickets: k, date: picked && stage !== 'rescheduled' ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}
