import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { hiddenTask, lockDate, setTournamentsForAll, todayKey, type TournamentRow } from './tournament';
import { previewSiteFor } from './secondChance';
import { organizerIdOf } from './repo';
import { dayKey, dayParts, FORMATS, monthsBetween, monthStartPlus, NIGHT_START_MINUTES, STORED_PLAN } from '../shared/tournament';
import { defaultPayBy, tourReason } from '../shared/tournamentTickets';
import { ticketBackStatements, tournamentCanceled } from './tournamentMoney';

// Zip 55, PREVIEW ONLY: the "Tournament test" page's server half. POST /api/admin/tournament-test { stage } puts the fake tournament back to a
// stage, using only the preview's fixed fake names (docs/PREVIEW_FAKE_DB.md), and turns the Tournaments row on (a re-seed from another branch
// drops it). It answers Not found anywhere PREVIEW_CALM is not "on" (that var exists only in [env.preview.vars]; the live site has none, the
// same check the preview-only ?as=Name link uses), so on live this route does nothing at all. No new Cloudflare variable.
//   none         no tournament (to try Create from Settings > Schedule)
//   signup       "Winter Classic", Everyone, sign-up open, 6 on the list (Vic, Zoe, Reese and Alex are not)
//   date_picked  the same with 8 on the list, Sage's level set to 3.4, and the date most of them can make picked. Since Alex's changes, picking
//                the date opens tickets ($16, Pay by the night before at 7:00 PM): nobody has paid yet (Alex is not on the list, so no $0 seat)
// Zip 56 (piece 2), each from the date picked above, tickets open. The spots follow the players locked in (the smart plan: 6 to 12), so with
// the preview's 10 names the 12 spots never fill: no stage can show the waitlist (it starts after 12; no new names are allowed).
//   tickets_open   6 locked in (Parker, Rowan, Sage, Christopher, Wren, Quinn: Venmo confirmed, Sage with credit), "6 of 8"; Vic, Zoe and
//                  Reese on the list with no ticket: Vic sees Lock my spot ($16), the pictures' 07 to 10
//   all_locked     all 10 names locked in (Alex's own $0 seat and 9 paid), "10 of 12"; Vic sees You're in
//   odd            7 locked in and Pay by already passed: the organizer's card says "7 locked in. Need 1 more or 1 less."
//   canceled       tickets_open, then Cancel tournament (the real statements): every paid ticket is credit now; players on the list see Canceled
//   rescheduled    tickets_open, then Reschedule (the real statements): back to the date step, tickets held, "Rescheduled. Pick your dates again"
// Every ticket's money is real on the fake database (a confirmed Venmo payment, or credit the stage first gives as a "Ticket stage credit"
// adjustment), so the books read all zeros (scripts/integrity-checks-tournament.sql) at every stage. A new stage first takes out the last one's
// ticket credit rows and test credit (the fake database only).
// The page's own words and buttons live in src/pages/admin/TournamentTest.tsx, which only a preview build carries.

// Zip 59 (🎾59.polish), the stages for the polish piece:
//   closed         6 paid and Pay by passed an hour ago: new tickets and the waitlist are closed ("Tickets closed. Pay by was ...")
//   hidden         canceled, then Hidden: out of Home; Settings > Advanced > Hidden tournaments lists it with Restore
//   (canceled)     the Canceled card has Hide on the organizer's Home
//   (signup)       sign-up open: view as Vic, Sign up: the ticket punch
// Zip 60 (🎾60.formatvote): the players vote the format. The tournament is "The Cold Open", created on "Let players vote".
//   vote_open      sign-up open, the vote open: 3 on the list (Parker votes Locked doubles, Rowan Americano, Sage Either). View as Vic, Sign up, see
//                  "Format you'd like"; the card says "Tournament style TBD" and "~7:30 PM"
//   vote_majority  the date locked by the organizer's real Pick date: Americano wins 3 to 1 (Wren and Christopher Either), the alert shows for Vic
//   vote_finalize  the Finalize screen (pass 2): all 10 names on the list and able to make the date, a 6 to 4 vote (Americano 6, Locked doubles 4,
//                  no Either); NOT locked. As Alex, tap the date on the tournament page: the Finalize screen opens. (The "over" line needs more than 12
//                  players, and the preview has 10 names, so it does not show here.)
//   vote_tie       the same with Locked 1, Americano 1, Either 2: a tie, the first tournament goes to Locked doubles, the alert says just the format
export const TEST_STAGES = ['none', 'signup', 'date_picked', 'tickets_open', 'all_locked', 'odd', 'canceled', 'rescheduled', 'closed', 'hidden', 'vote_open', 'vote_majority', 'vote_tie', 'vote_finalize'] as const;
type Stage = (typeof TEST_STAGES)[number];

/** The fixed names and their picks (Kai is not one of the preview's names, so Kai is not here). Levels in hundredths. */
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
  all_locked: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'spot', pay: 'cash' },
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

const TEST_CREDIT = 'adjusted:Ticket stage credit';

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
    ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND kind = 'mark' AND task LIKE 'tournament_hidden:%'").bind(group.id),
  ]);
  if (stage === 'none') return { ok: true, stage };
  if (stage === 'vote_open' || stage === 'vote_majority' || stage === 'vote_tie' || stage === 'vote_finalize') return voteStage(ctx, group, stage);

  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  // The date everyone on the list can make: the third Thursday of next month (or the middle offered date).
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  const best = thursdays[2] ?? dates[Math.floor(dates.length / 2)];
  const tickets = TICKET_STAGES[['canceled', 'rescheduled', 'closed', 'hidden'].includes(stage) ? 'tickets_open' : stage] ?? null;
  // Alex: picking the date opens tickets, so every stage after Sign-up open has them open (Canceled and Rescheduled then run the real taps).
  const picked = stage !== 'signup';
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const payBy = stage === 'odd' || stage === 'closed' ? new Date(ctx.nowMs - 3_600_000).toISOString() : defaultPayBy(best, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by)
         VALUES (?, ?, ?, ${STORED_PLAN.size}, ${STORED_PLAN.courts}, ${STORED_PLAN.minutes}, ${STORED_PLAN.start}, 1600, 1400, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        format === 'americano' ? 'Winter Americano' : 'Winter Classic',
        JSON.stringify([...new Set([...dates, best])].sort()),
        picked ? best : null,
        picked ? 'tickets' : 'signup',
        at(0),
        ctx.nowIso,
        picked ? ctx.nowIso : null,
        at(1),
        format,
        format === 'americano' ? 700 : 0,
        picked ? payBy : null,
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
  if (stage === 'canceled' || stage === 'hidden') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?").bind(ctx.nowIso, ctx.nowIso, id),
      ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: id, playerId: null, why: 'cancel', endedReason: 'canceled', nowIso: ctx.nowIso, when: tournamentCanceled }),
    ]);
  }
  // Zip 59: hidden = canceled, then the same one row a Hide tap writes (the tournament and its tickets stay).
  if (stage === 'hidden') {
    await ctx.db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), group.id, hiddenTask(id), ctx.nowIso).run();
  }
  if (stage === 'rescheduled') {
    await ctx.db.batch([
      ctx.db.prepare("UPDATE tournaments SET status = 'rescheduled', final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ?").bind(ctx.nowIso, id),
      ctx.db.prepare("UPDATE tournament_signups SET dates = '[]', updated_at = ? WHERE tournament_id = ?").bind(ctx.nowIso, id),
    ]);
  }
  return { ok: true, stage, format, id, signedUp: n, tickets: k, date: picked && stage !== 'rescheduled' ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}


/** Zip 60: the vote stages. The date is locked by the very code the organizer's Pick date runs (lockDate), so the count and the alert are the real ones. */
const VOTERS: Record<'vote_open' | 'vote_majority' | 'vote_tie' | 'vote_finalize', { name: string; level: number; vote: 'locked' | 'americano' | 'either' }[]> = {
  vote_open: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
  ],
  vote_majority: [
    { name: 'Parker', level: 360, vote: 'americano' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'locked' },
    { name: 'Wren', level: 320, vote: 'either' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'either' },
  ],
  vote_finalize: [
    { name: 'Parker', level: 360, vote: 'americano' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'americano' },
    { name: 'Wren', level: 320, vote: 'americano' },
    { name: 'Quinn', level: 250, vote: 'americano' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'americano' },
    { name: 'Zoe', level: 275, vote: 'locked' },
    { name: 'Reese', level: 340, vote: 'locked' },
    { name: 'Vic', level: 320, vote: 'locked' },
    { name: 'Alex', level: 340, vote: 'locked' },
  ],
  vote_tie: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
    { name: 'Wren', level: 320, vote: 'either' },
  ],
};

async function voteStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: 'vote_open' | 'vote_majority' | 'vote_tie' | 'vote_finalize') {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  const best = thursdays[2] ?? dates[Math.floor(dates.length / 2)];
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, shown_at, format, second_credit_cents, format_source)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, ${STORED_PLAN.courts}, ${STORED_PLAN.minutes}, ${STORED_PLAN.start}, 1600, 1400, ?, NULL, 'signup', 'all', ?, ?, ?, 'doubles', 700, 'vote')`,
      )
      .bind(id, group.id, JSON.stringify([...new Set([...dates, best])].sort()), at(0), ctx.nowIso, at(1)),
  ];
  let n = 0;
  for (const c of VOTERS[stage]) {
    const pid = idOf.get(c.name);
    if (!pid) continue;
    n++;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, format_vote)
           VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, c.level, JSON.stringify([...new Set([...dates.filter((_, i) => i % 2 === n % 2), best])].sort()), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7), c.vote),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
  }
  await ctx.db.batch(statements);
  if (stage === 'vote_majority' || stage === 'vote_tie') {
    const row = await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>();
    await lockDate(ctx, group, row!, { date: best });
  }
  return { ok: true, stage, id, signedUp: n, date: stage === 'vote_majority' || stage === 'vote_tie' ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}
