import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { hiddenTask, lockDate, setTournamentsForAll, type SignupRow, todayKey, type TournamentRow } from './tournament';
import { gamesFor, type GameRow, playerDayView, type TeamRow, writeTeamsAndGames } from './tournamentDay';
import { previewSiteFor } from './secondChance';
import { organizerIdOf } from './repo';
import { dayKey, dayParts, FORMATS, monthsBetween, monthStartPlus, NIGHT_START_MINUTES, STORED_PLAN } from '../shared/tournament';
import { localParts, zonedTimeToUtc } from '../shared/time';
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
// the preview's 10 names the 16 spots (the cap since Zip 63) never fill: no stage can show standby (it starts after 16; no new names are allowed).
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
// Zip 63 (🎾63.tickets): the pay countdown. Each is Tickets open (6 paid; Vic, Zoe and Reese with no ticket) with Pay by set from now, and the
// tournament the day after Pay by (the usual: Pay by the night before). View as Vic: the alert at the top of Home.
//   pay_3d, pay_2d  Pay by 7:00 PM three or two days from today: amber "3 days left to pay" / "2 days left to pay"
//   pay_1d          Pay by 7:00 PM tomorrow: amber "Payment due tomorrow"
//   pay_today       Pay by tonight, at least 6.5 hours from now (7:00 PM when that is far enough): red "Payment due today"
//   pay_hours       Pay by 5 hours 20 minutes from now: red "Due in 5 hours"
//   pay_minutes     Pay by 42 minutes from now: red "Due in 42 minutes" (it counts down while the page is open)
//   pay_late        Pay by an hour ago, and Wren backed out after it (a freed spot, the existing late rule): red "Your payment is late"
//   pay_closed      Pay by an hour ago, no spot freed: tickets closed for Vic, so no countdown (the card says Tickets closed)
export const COUNTDOWN_STAGES = ['pay_3d', 'pay_2d', 'pay_1d', 'pay_today', 'pay_hours', 'pay_minutes', 'pay_late', 'pay_closed'] as const;
// Zip 64 (🎾64.finalize): the style rules and late paying. Each is Tickets open with Pay by an hour ago (tickets closed for the style), the vote's
// winner Locked doubles, Plays 7:30 to 10:00 PM.
//   style_even     all 10 names locked in: Locked doubles stays (an even number)
//   style_odd      9 locked in (Vic on the list, not paid): the first screen that reads it switches to Americano (History, the organizer's card
//                  "switched to Americano", a Telegram alert where alerts are connected); players see "Tournament style is now Americano."
//   style_back     switched to Americano for 9, then Vic paid late: 10 locked in, the organizer's "Switch back to Locked doubles?" (Switch, Not now)
//   late_open      6 locked in, Pay by an hour ago, spots open: Vic, Zoe and Reese can still pay (red "Your payment is late", Pay now works)
//   late_cut       the same tournament TODAY, starting in 2 hours: inside the last 3 hours, tickets are closed for Vic ("Tickets are closed.")
//   zip64_start    the preview's calm start: The Cold Open, the vote open, 8 on the list (everyone but Vic and Reese), all able to make the third
//                  Thursday of next month (part 8: the organizer's plan is for 10: 2 courts, 2.5 hours). Vic sees the short ticket before signing up (mock 00); Parker signed up (mock 01); Alex can Finalize.
export const STYLE_STAGES = ['style_even', 'style_odd', 'style_back', 'late_open', 'late_cut', 'zip64_start'] as const;
// Zip 66 (🎾66.admincard): the organizer's card and the in-or-out alert.
//   zip66_start    the preview's calm start: The Cold Open, the vote open, 8 on the list (everyone but Vic and Reese; the same as zip64_start).
//                  Organizer Home: the card is one closed line; open it, tap Votes (who voted what), tap Not signed up (the players who played
//                  lately and are not on the list: Vic and Reese on the preview), Copy reminder text.
//   missed_date    the same list, but Sage did NOT pick the date most can make, and the organizer finalized it (tickets open, nobody paid). View as
//                  Sage: "The Cold Open is <day>" / "Can you make it?" with I'm in · $16 and Can't make it, and no pay countdown. Organizer Home:
//                  Not signed up lists Sage.
export const ZIP66_STAGES = ['zip66_start', 'missed_date'] as const;
// Zip 57 (🎾57.tourney3): teams and game day. "The Cold Open", Locked doubles, 8 locked in (the brief's four teams: Net Ninjas Vic and Wren,
// Dill With It Sage and Christopher, Kitchen Crew Rowan and Zoe, Third Shot Gang Parker and Quinn), Pay by passed, courts 1 and 2.
//   day_ready        TODAY, the night started 10 minutes ago, no teams yet: Home says "8 locked in. Draft the teams." (the calm start)
//   teams_drafted    the same with the four teams drafted (mock 15), not published: Publish teams or Redo the draw
//   teams_published  published, the night two days from now: Vic sees Your team, Your games, All teams (mock 16)
//   game1            published, the night started a minute ago, no results: Vic sees Game 1 with We won (mock 17)
//   mid              started 45 minutes ago (7:30 to 9:30 PM): Vic said Net Ninjas won Game 1 (Parker is asked to confirm), Kitchen Crew vs Dill With
//                    It still playing, the night behind: the Time check on Home (mocks 18, 19, 48)
//   pools_done       every round robin game in: standings final, the Final and the 3rd place game set
//   backed_out       published before the night, then Zoe backed out after Pay by: 7 locked in, the style switched to Americano (the amber card
//                    with Copy text for the group); players see "Tournament style is now Americano." and no teams
// The 12 players pools look (mock 51) cannot be made with the 10 names: GET /api/tournament/pools-look draws it (look only, a preview link).
export const DAY_STAGES = ['day_ready', 'teams_drafted', 'teams_published', 'game1', 'mid', 'pools_done', 'backed_out'] as const;
type DayStage = (typeof DAY_STAGES)[number];
const isDayStage = (s: string): s is DayStage => (DAY_STAGES as readonly string[]).includes(s);
export const TEST_STAGES = [...DAY_STAGES, 'none', 'signup', 'date_picked', 'tickets_open', 'all_locked', 'odd', 'canceled', 'rescheduled', 'closed', 'hidden', 'vote_open', 'vote_majority', 'vote_tie', 'vote_finalize', 'speed_check', ...COUNTDOWN_STAGES, ...STYLE_STAGES, ...ZIP66_STAGES] as const;
const isStyleStage = (s: string): boolean => (STYLE_STAGES as readonly string[]).includes(s);
type CountdownStage = (typeof COUNTDOWN_STAGES)[number];
const isCountdown = (s: string): s is CountdownStage => (COUNTDOWN_STAGES as readonly string[]).includes(s);

/** Zip 63: Pay by for a countdown stage, from now (Eastern). */
function countdownPayBy(stage: CountdownStage, nowMs: number, tz: string): number {
  const today = dayParts(todayKey(nowMs, tz));
  const at7 = (plusDays: number) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + plusDays));
    return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 19, 0, tz);
  };
  switch (stage) {
    case 'pay_3d':
      return at7(3);
    case 'pay_2d':
      return at7(2);
    case 'pay_1d':
      return at7(1);
    case 'pay_today': {
      // 7:00 PM tonight when that is 6.5 hours away or more; later tonight otherwise (on the half hour, before midnight when it can be).
      const want = nowMs + 6.5 * 3_600_000;
      if (at7(0) >= want) return at7(0);
      const half = Math.ceil(want / 1_800_000) * 1_800_000;
      return Math.min(half, at7(1) - 19 * 3_600_000 - 60_000);
    }
    case 'pay_hours':
      return nowMs + (5 * 60 + 20) * 60_000;
    case 'pay_minutes':
      return nowMs + 42 * 60_000 + 30_000;
    case 'pay_late':
    case 'pay_closed':
      return nowMs - 3_600_000;
  }
}

/** Zip 63: the day after a moment (Eastern), as 'YYYY-MM-DD': the tournament of a countdown stage. */
function dayAfter(ms: number, tz: string): string {
  const p = dayParts(todayKey(ms, tz));
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
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
  style_even: [
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
  style_odd: [
    { name: 'Alex', place: 'spot', pay: 'free' },
    { name: 'Parker', place: 'spot', pay: 'cash' },
    { name: 'Rowan', place: 'spot', pay: 'cash' },
    { name: 'Sage', place: 'spot', pay: 'credit' },
    { name: 'Christopher Vanderberg', place: 'spot', pay: 'cash' },
    { name: 'Wren', place: 'spot', pay: 'cash' },
    { name: 'Quinn', place: 'spot', pay: 'cash' },
    { name: 'Zoe', place: 'spot', pay: 'cash' },
    { name: 'Reese', place: 'spot', pay: 'cash' },
    { name: 'Vic', place: 'none', pay: 'none' },
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
  if (isDayStage(stage)) return dayStage(ctx, group, stage);
  if (stage === 'vote_open' || stage === 'vote_majority' || stage === 'vote_tie' || stage === 'vote_finalize' || stage === 'speed_check' || stage === 'zip64_start' || stage === 'zip66_start' || stage === 'missed_date') return voteStage(ctx, group, stage);

  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  // The date everyone on the list can make: the third Thursday of next month (or the middle offered date).
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  // Zip 63: a countdown stage's tournament is the day after its Pay by.
  const countdownBy = isCountdown(stage) ? countdownPayBy(stage, ctx.nowMs, group.timezone) : null;
  // Zip 64: late_cut is today, starting 2 hours from now (inside the last 3 hours before the start).
  const nowLocal = localParts(ctx.nowMs, group.timezone);
  const cutStart = Math.min(23 * 60, Math.ceil((nowLocal.hour * 60 + nowLocal.minute + 120) / 5) * 5);
  const best =
    stage === 'late_cut' ? todayKey(ctx.nowMs, group.timezone) : countdownBy !== null ? dayAfter(countdownBy, group.timezone) : (thursdays[2] ?? dates[Math.floor(dates.length / 2)]);
  // Zip 64: a picked date has the real times (Plays): 7:30 to 10:00 PM, as Finalize starts on.
  const plays = stage === 'late_cut' ? { start: cutStart, minutes: Math.min(150, 24 * 60 - cutStart) } : { start: 19 * 60 + 30, minutes: 150 };
  const ticketKey: Stage =
    ['canceled', 'rescheduled', 'closed', 'hidden', 'late_open', 'late_cut'].includes(stage) || isCountdown(stage) ? 'tickets_open' : stage === 'style_back' ? 'style_even' : stage;
  const tickets = TICKET_STAGES[ticketKey] ?? null;
  // Alex: picking the date opens tickets, so every stage after Sign-up open has them open (Canceled and Rescheduled then run the real taps).
  const picked = stage !== 'signup';
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const payBy =
    countdownBy !== null
      ? new Date(countdownBy).toISOString()
      : stage === 'odd' || stage === 'closed' || isStyleStage(stage)
        ? new Date(ctx.nowMs - 3_600_000).toISOString()
        : defaultPayBy(best, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source)
         VALUES (?, ?, ?, ${STORED_PLAN.size}, ${STORED_PLAN.courts}, ${picked ? plays.minutes : STORED_PLAN.minutes}, ${picked ? plays.start : STORED_PLAN.start}, 1600, 1400, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        isStyleStage(stage) ? 'The Cold Open' : format === 'americano' ? 'Winter Americano' : 'Winter Classic',
        JSON.stringify([...new Set([...dates, best])].sort()),
        picked ? best : null,
        picked ? 'tickets' : 'signup',
        at(0),
        ctx.nowIso,
        picked ? ctx.nowIso : null,
        at(1),
        format,
        format === 'americano' || isStyleStage(stage) ? 700 : 0,
        picked ? payBy : null,
        isStyleStage(stage) ? 'vote' : null,
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
  // Zip 63: the late stage's freed spot: the same History line a back out after Pay by writes (Wren held a spot since before Pay by and gave it
  // up), and Wren off the list with no ticket, so the spot count and the line agree.
  if (stage === 'pay_late') {
    const wren = idOf.get('Wren');
    if (wren) {
      const outAt = new Date(ctx.nowMs - 30 * 60_000).toISOString();
      await ctx.db.batch([
        ctx.db.prepare('DELETE FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').bind(id, wren),
        ctx.db.prepare("UPDATE credit_ledger SET ended_at = ?, ended_reason = 'dropped' WHERE player_id = ? AND reason = ? AND ended_at IS NULL").bind(outAt, wren, tourReason(id)),
        ctx.db.prepare("UPDATE tournament_signups SET status = 'out', updated_at = ? WHERE tournament_id = ? AND player_id = ?").bind(outAt, id, wren),
        ctx.db
          .prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) VALUES (?, ?, NULL, 'Wren', 'tournament_back_out', ?, ?)")
          .bind(newId(), group.id, JSON.stringify({ tournament: 'Winter Classic', tournamentId: id, freedSpot: true, player: 'Wren', playerId: wren }), outAt),
      ]);
    }
  }
  // Zip 64: style_back = the odd switch already happened (9 locked in, half an hour ago), then Vic paid late: 10 now.
  if (stage === 'style_back') {
    await ctx.db
      .prepare("UPDATE tournaments SET format = 'americano', format_source = ? WHERE id = ?")
      .bind(`odd:${new Date(ctx.nowMs - 30 * 60_000).toISOString()}`, id)
      .run();
    const vic = idOf.get('Vic');
    if (vic) await ctx.db.prepare('UPDATE tournament_tickets SET place_at = ?, paid_at = ?, updated_at = ? WHERE tournament_id = ? AND player_id = ?').bind(ctx.nowIso, ctx.nowIso, ctx.nowIso, id, vic).run();
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


/**
 * Zip 60: the vote stages. The date is locked by the very code the organizer's Pick date runs (lockDate), so the count and the alert are the real ones.
 * Zip 62 (🎾62.speed): `speed_check` is The Cold Open as it is on live: Everyone, the vote open, every fixed name but the organizer on the list.
 */
type VoteStage = 'vote_open' | 'vote_majority' | 'vote_tie' | 'vote_finalize' | 'speed_check' | 'zip64_start' | 'zip66_start' | 'missed_date';
const ZIP64_VOTERS: { name: string; level: number; vote: 'locked' | 'americano' | 'either' }[] = [
  { name: 'Parker', level: 360, vote: 'locked' },
  { name: 'Rowan', level: 350, vote: 'americano' },
  { name: 'Sage', level: 300, vote: 'either' },
  { name: 'Christopher Vanderberg', level: 300, vote: 'locked' },
  { name: 'Wren', level: 320, vote: 'either' },
  { name: 'Quinn', level: 250, vote: 'locked' },
  { name: 'Zoe', level: 275, vote: 'either' },
  { name: 'Alex', level: 340, vote: 'americano' },
];
const VOTERS: Record<VoteStage, { name: string; level: number; vote: 'locked' | 'americano' | 'either' }[]> = {
  zip64_start: ZIP64_VOTERS,
  zip66_start: ZIP64_VOTERS,
  missed_date: ZIP64_VOTERS,
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
  speed_check: [
    { name: 'Parker', level: 360, vote: 'locked' },
    { name: 'Rowan', level: 350, vote: 'americano' },
    { name: 'Sage', level: 300, vote: 'either' },
    { name: 'Wren', level: 320, vote: 'americano' },
    { name: 'Quinn', level: 250, vote: 'locked' },
    { name: 'Christopher Vanderberg', level: 300, vote: 'either' },
    { name: 'Zoe', level: 275, vote: 'americano' },
    { name: 'Reese', level: 340, vote: 'locked' },
    { name: 'Vic', level: 320, vote: 'either' },
  ],
};

async function voteStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: VoteStage) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const all = testDates(todayKey(ctx.nowMs, group.timezone));
  // Zip 64: the calm start offers next month only, like The Cold Open on live (the stub then reads "DEC", as in the mocks).
  const dates = stage === 'zip64_start' || stage === 'zip66_start' || stage === 'missed_date' ? all.filter((d) => d.slice(0, 7) === all[0].slice(0, 7)) : all;
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
  // Every voter can make `best`; Zip 66's missed_date: Sage cannot (every other offered date she can).
  const picksFor = (name: string, n: number) =>
    stage === 'missed_date' && name === 'Sage' ? dates.filter((d) => d !== best) : [...new Set([...dates.filter((_, i) => i % 2 === n % 2), best])].sort();
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
        .bind(newId(), id, pid, c.level, JSON.stringify(picksFor(c.name, n)), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7), c.vote),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
  }
  await ctx.db.batch(statements);
  const locks = stage === 'vote_majority' || stage === 'vote_tie' || stage === 'missed_date';
  if (locks) {
    const row = await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>();
    await lockDate(ctx, group, row!, { date: best });
  }
  return { ok: true, stage, id, signedUp: n, date: locks ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}


// ---------------------------------------------------------------------------------------------------------------------
// Zip 57: the game day stages (see DAY_STAGES above). Teams and games are written the way Publish writes them (tournamentDay.ts), results the way
// the players' and the organizer's taps write them.
// ---------------------------------------------------------------------------------------------------------------------

/** The brief's four teams, in seat order (seat 1 plays seat 2 in round 1: Net Ninjas vs Third Shot Gang, as mocks 16 and 17 draw it). */
const DAY_TEAMS: { name: string; a: string; b: string; la: number; lb: number }[] = [
  { name: 'Net Ninjas', a: 'Vic', b: 'Wren', la: 320, lb: 320 },
  { name: 'Third Shot Gang', a: 'Parker', b: 'Quinn', la: 360, lb: 250 },
  { name: 'Kitchen Crew', a: 'Rowan', b: 'Zoe', la: 350, lb: 275 },
  { name: 'Dill With It', a: 'Sage', b: 'Christopher Vanderberg', la: 340, lb: 300 },
];

async function dayStage(ctx: Ctx, group: Awaited<ReturnType<typeof requireAdmin>>, stage: DayStage) {
  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const tz = group.timezone;
  const nowLocal = localParts(ctx.nowMs, tz);
  const nowMin = nowLocal.hour * 60 + nowLocal.minute;
  const today = todayKey(ctx.nowMs, tz);
  const later = stage === 'teams_published' || stage === 'backed_out';
  const date = later ? dayAfter(ctx.nowMs + 86_400_000, tz) : today;
  // The night: started 10 minutes ago (45 for mid, a minute for game1), on the 5 minutes; 7:30 PM two days from now for the later ones.
  const ago = stage === 'mid' ? 45 : stage === 'game1' ? 1 : stage === 'pools_done' ? 100 : 10;
  const start = later ? 19 * 60 + 30 : Math.max(0, Math.floor((nowMin - ago) / 5) * 5);
  // The whole plan (2.5 hours; 2 hours for mid, so the Time check shows), also when that runs past midnight (a late test).
  const minutes = stage === 'mid' ? 120 : 150;
  const id = newId();
  const t0 = ctx.nowMs - 3 * 86_400_000;
  const at = (m: number) => new Date(t0 + m * 60_000).toISOString();
  const payBy = new Date(ctx.nowMs - 3_600_000).toISOString();
  const published = stage !== 'day_ready' && stage !== 'teams_drafted';
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents, pay_by, format_source, teams_at, court_numbers)
         VALUES (?, ?, 'The Cold Open', ${STORED_PLAN.size}, 2, ?, ?, 1600, 1400, ?, ?, 'tickets', 'all', ?, ?, ?, ?, 'doubles', 700, ?, NULL, ?, '[1,2]')`,
      )
      .bind(id, group.id, minutes, start, JSON.stringify([date]), date, at(0), ctx.nowIso, at(5), at(1), payBy, published ? at(400) : null),
  ];
  let n = 0;
  for (const team of DAY_TEAMS) {
    for (const [name, level] of [
      [team.a, team.la],
      [team.b, team.lb],
    ] as [string, number][]) {
      const pid = idOf.get(name);
      if (!pid) continue;
      n++;
      statements.push(
        ctx.db
          .prepare(`INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES (?, ?, ?, 'in', ?, NULL, ?, ?, ?, ?)`)
          .bind(newId(), id, pid, level, JSON.stringify([date]), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
        ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, level, at(10 + n * 7)),
        ctx.db
          .prepare(
            `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, paid_at, created_at, updated_at)
             VALUES (?, ?, ?, 'spot', ?, 1600, 0, 1600, ?, ?, ?)`,
          )
          .bind(newId(), id, pid, at(200 + n * 11), at(200 + n * 11), at(200 + n * 11), at(200 + n * 11)),
      );
    }
  }
  await ctx.db.batch(statements);
  if (stage === 'day_ready') return { ok: true, stage, id, date };
  const row = (await ctx.db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id).first<TournamentRow>())!;
  const teams = DAY_TEAMS.map((x) => ({ id: newId(), name: x.name, a: idOf.get(x.a) ?? null, b: idOf.get(x.b) ?? null, pool: null, changed: false, out: null }));
  const plan = gamesFor(row, teams.length);
  // Draft (not published): the same rows Draft teams writes. Published: the same rows Publish writes, games and all.
  await ctx.db.batch(writeTeamsAndGames(ctx.db, row, teams, published ? plan.games : null, plan.playTo, ctx.nowIso, '1 = 1', []));
  const iso = (minsAgo: number) => new Date(ctx.nowMs - minsAgo * 60_000).toISOString();
  if (stage === 'mid') {
    // Game 1 (Net Ninjas, seat 1, side a): Vic's We won 2 minutes ago, not confirmed yet.
    await ctx.db.prepare("UPDATE tournament_games SET claim = 'a', claim_at = ?, updated_at = ? WHERE tournament_id = ? AND num = 1").bind(iso(2), iso(2), id).run();
  }
  if (stage === 'pools_done') {
    // Every round robin game in, as the players' Confirm writes it: seat 1 wins everything, seat 2 beats 3 and 4, seat 3 beats 4.
    const games = (await ctx.db.prepare("SELECT num, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND stage = 'pool' ORDER BY num").bind(id).all<{ num: number; slot_a: string; slot_b: string }>()).results;
    await ctx.db.batch(
      games.map((g, i) =>
        ctx.db
          .prepare("UPDATE tournament_games SET winner = ?, result_at = ?, result_by = 'players', updated_at = ? WHERE tournament_id = ? AND num = ?")
          .bind(Number(g.slot_a.slice(1)) < Number(g.slot_b.slice(1)) ? 'a' : 'b', iso(90 - i * 12), iso(90 - i * 12), id, g.num),
      ),
    );
  }
  if (stage === 'backed_out') {
    // Zoe backs out after Pay by (the real back out's rows: off the list, the ticket's cash back as one credit entry): 7 locked in. The first
    // screen that reads it switches the style to Americano (zip 64), as it would on the night.
    const zoe = idOf.get('Zoe');
    if (zoe) {
      const outAt = iso(20);
      await ctx.db.batch([
        ctx.db.prepare("UPDATE tournament_signups SET status = 'out', backed_out_at = ?, updated_at = ? WHERE tournament_id = ? AND player_id = ?").bind(outAt, outAt, id, zoe),
        ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: id, playerId: zoe, why: 'back', endedReason: 'dropped', nowIso: outAt, when: () => '1 = 1' }),
        ctx.db
          .prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) VALUES (?, ?, NULL, 'Zoe', 'tournament_back_out', ?, ?)")
          .bind(newId(), group.id, JSON.stringify({ tournament: 'The Cold Open', tournamentId: id, freedSpot: true, player: 'Zoe', playerId: zoe }), outAt),
      ]);
    }
  }
  return { ok: true, stage, id, date, signedUp: n };
}

/**
 * Zip 57, PREVIEW ONLY: GET /api/tournament/pools-look: the 12 players pools night (mock 51) as Vic would see it at round 1, drawn from made-up
 * rows by the real view code (server/tournamentDay.ts playerDayView). The preview has 10 names, so the 6th team is "Kai + Guest". Writes nothing;
 * Not found anywhere but a preview.
 */
export async function poolsLook(ctx: Ctx) {
  if (!previewSiteFor(ctx)) throw new HttpError(404, 'not_found', 'Not found.');
  const tz = 'America/Detroit';
  const nowLocal = localParts(ctx.nowMs, tz);
  const start = Math.max(0, Math.floor((nowLocal.hour * 60 + nowLocal.minute - 5) / 5) * 5);
  const pairs: [string, string, string][] = [
    ['Net Ninjas', 'Vic', 'Wren'],
    ['Third Shot Gang', 'Parker', 'Quinn'],
    ['Kitchen Crew', 'Rowan', 'Zoe'],
    ['Dill With It', 'Sage', 'Christopher'],
    ['Dink Dynasty', 'Reese', 'Alex'],
    ['Lob Stars', 'Kai', 'Guest'],
  ];
  const t = {
    id: 'look',
    group_id: 'look',
    name: 'The Cold Open',
    size: 12,
    courts: 2,
    minutes: 150,
    start_minutes: start,
    ticket_cents: 1600,
    champion_credit_cents: 1400,
    offered_dates: '[]',
    final_date: todayKey(ctx.nowMs, tz),
    status: 'tickets',
    visibility: 'all',
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
    date_picked_at: ctx.nowIso,
    shown_at: ctx.nowIso,
    canceled_at: null,
    format: 'doubles',
    second_credit_cents: 0,
    pay_by: ctx.nowIso,
    teams_at: ctx.nowIso,
    court_numbers: '[1,2]',
    paused_at: null,
  } as TournamentRow;
  const signups = pairs.flatMap(([, a, b]) => [a, b]).map((name) => ({ player_id: `p-${name}`, display_name: name }) as unknown as SignupRow);
  const teams: TeamRow[] = pairs.map(([name, a, b], i) => ({
    id: `team-${i}`,
    tournament_id: 'look',
    seat: i + 1,
    name,
    player_a: `p-${a}`,
    player_b: `p-${b}`,
    pool: i < 3 ? 'A' : 'B',
    out_at: null,
    changed_at: null,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  }));
  const plan = gamesFor(t, 6);
  const games: GameRow[] = plan.games.map((g) => ({
    id: `g-${g.num}`,
    tournament_id: 'look',
    num: g.num,
    round: g.round,
    court: g.court,
    stage: g.stage,
    pool: g.pool,
    slot_a: g.a,
    slot_b: g.b,
    play_to: g.stage === 'pool' ? plan.playTo : 11,
    claim: null,
    claim_at: null,
    disputed_at: null,
    winner: null,
    result_at: null,
    result_by: null,
    skipped: 0,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  }));
  return { day: playerDayView(t, signups, { teams, games }, 'p-Vic', tz, ctx.nowMs) };
}
