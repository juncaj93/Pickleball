// The SMALL fake world for the preview database (Alex, Nov 8): the same short list of made-up names in every zip, so the "Who are you?"
// list is short. The fixed list and what each name is for is in docs/PREVIEW_FAKE_DB.md ("The fixed names"); future zips give new
// scenarios to these names instead of adding new ones. `npm run db:seed:preview` builds this world (scripts/seed-preview.ts).
//
// The older, bigger world in scripts/seed-preview-world.ts (Avery to Morgan) stays as it is for the local browser tests, which tap those
// names; it never goes to the preview database any more.
//
// Everything is played out on a throwaway in-memory copy of the real site with a fake clock, through the real site rules (joins, pays,
// cancels, Finalize), so every number on the preview is honest. Nothing here reads or writes anything but that copy.

import { backupToSql } from './backup-sql.mjs';
import { extraRows, FAKE_GROUP_NAME, OFF_ON_LIVE, PREVIEW_SWITCHES_ON, previewPin, SETUP_TOKEN, wipeExtras, World, ZIP13_SWITCHES_ON, type Seed } from './seed-preview-world';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { holidayFor } from '../shared/holidays';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 'America/Detroit';

/** The organizer (also a player who pays the venue, never the group). */
export const SMALL_ORGANIZER = 'Alex';
/** A long made-up name (it must fit on a Money row next to "Request" and "Mark paid"). */
export const SMALL_LONG = 'Christopher Vanderberg';
/** The eight made-up players every zip reuses, in the order of docs/PREVIEW_FAKE_DB.md. */
export const SMALL_CAST = ['Vic', 'Wren', 'Zoe', 'Quinn', 'Rowan', 'Parker', 'Reese', 'Sage'] as const;
/** Every name on the small preview: the organizer, the eight, the long name. Nothing else. */
export const SMALL_NAMES = [SMALL_ORGANIZER, ...SMALL_CAST, SMALL_LONG] as const;
/** Venmo saved for these; the others show "no Venmo saved". */
export const SMALL_WITH_VENMO = ['Vic', 'Parker', 'Rowan', SMALL_LONG];
/** No phone number saved (Text all skips this one). */
export const SMALL_NO_NUMBER = 'Reese';

/**
 * PREVIEW SWITCHES RULE: the rows that are ON on live (read with the read-only PIN before each re-seed) plus the zip being built.
 * Zips 14, 15 and 16 shipped with their rows OFF; LATER_ON_LIVE lists the ones Alex has switched on since (read on live, see STAGE_NOTES).
 */
// Read on live with the read-only PIN, Sun Nov 8, 7:05 PM Eastern: every Settings row is on, these three included. Unpaid nudge: on live
// since Sun Nov 8 evening (Alex, Zip 18 round 2).
export const LATER_ON_LIVE: readonly string[] = ['game_day_card_on', 'second_chance_on', 'after_game_card_on', 'unpaid_nudge_on'];
/** Being built: Extended time (Zip 31). Check-in pay line (Zip 34) is still being tried too. Players sheet redo (Zip 32) is still being tried too. Acting for others (Zip 30) is still being tried too. Spent matches Totals (Zip 27), Booking hours (Zip 24) and Totals refresh (Zip 23) shipped OFF and are still being tried, so they stay on here too. */
export const BUILDING_ON: readonly string[] = ['totals_refresh_on', 'booking_hours_on', 'spent_totals_on', 'acting_others_on', 'players_sheet_redo_on', 'checkin_pay_line_on', 'extended_time_on', 'home_screen_tip_on', 'game_day_text_on'];

export function smallSwitchRows(nowMs: number): string {
  const at = new Date(nowMs).toISOString();
  const rows = [...PREVIEW_SWITCHES_ON.filter((t) => !OFF_ON_LIVE.includes(t)), ...ZIP13_SWITCHES_ON, ...LATER_ON_LIVE, ...BUILDING_ON];
  return [...new Set(rows)].map((task) => `INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'preview-${task}', id, NULL, '${task}', 'mark', '${at}' FROM groups;`).join('\n') + '\n';
}

export async function buildSmallPreview(startMs = Date.now()): Promise<Seed> {
  const w = new World();
  const summary: string[] = [];
  const N = startMs;
  const nowDate = new Date(N);
  const monthStartMs = (back: number) => Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - back, 1, 17);
  w.now = monthStartMs(3);
  const phones: Record<string, string | null> = { Alex: '(313) 555-0100', Vic: '(313) 555-0101', Wren: '(313) 555-0102', Zoe: '(313) 555-0103', Quinn: '(313) 555-0104', Rowan: '(313) 555-0105', Parker: '(313) 555-0106', Reese: null, Sage: '(313) 555-0108', [SMALL_LONG]: '(313) 555-0199' };
  await w.org.ok('POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: FAKE_GROUP_NAME,
    pin: previewPin(),
    venmoUrl: 'https://venmo.com/u/pickleball-preview-fake',
    players: SMALL_NAMES.filter((n) => phones[n]).map((name) => ({ name, phone: phones[name] })),
  });
  await w.org.ok('PUT', '/api/admin/group', { organizerName: SMALL_ORGANIZER, venueName: 'Fake Courts', venueAddress: '1 Made Up Way' });
  await w.org.ok('POST', '/api/admin/players', { name: SMALL_NO_NUMBER });
  let dash = await w.org.ok('GET', '/api/admin/dashboard');
  for (const name of SMALL_WITH_VENMO) {
    const p = (dash.players as any[]).find((x) => x.name === name);
    await w.org.ok('PUT', `/api/admin/players/${p.id}`, { name, phone: p.phone, isRegular: p.isRegular, isActive: p.isActive, canReceiveSubstituteInvites: p.canReceiveSubstituteInvites, usualDays: p.usualDays, venmo: `@${name.split(' ')[0].toLowerCase()}-fake` });
  }
  w.groupKey = String(dash.group.privateLink).split('/g/')[1];
  for (const p of dash.players as { id: string; name: string }[]) w.ids[p.name] = p.id;
  for (const n of SMALL_NAMES) if (!w.ids[n]) throw new Error(`setup: no player ${n}`);

  const games = () => (dash.sessions as any[]).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const refresh = async () => {
    dash = await w.org.ok('GET', '/api/admin/dashboard');
  };
  const at = async (ms: number) => {
    const before = w.now;
    w.now = Math.max(w.now, ms);
    if (w.now - before > 6 * HOUR) {
      await w.org.ok('POST', '/api/admin/login', { pin: previewPin() });
      for (const phone of w.phones.values()) phone.cookies.clear();
    }
    await refresh();
  };
  const ms = (iso: string) => Date.parse(iso);
  const eastDate = (t: number) => {
    const q = localParts(t, TZ);
    return `${q.year}-${q.month}-${q.day}`;
  };
  const join = async (name: string, g: any) => (await w.pick(name)).ok('POST', `/api/sessions/${g.id}/join`, {});
  const orgPays = (name: string, g: any) => w.org.ok('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids[name], paid: true });
  const setCourt = (g: any, status: 'booked' | 'waitlist' | 'not_booked') => w.org.ok('POST', `/api/admin/sessions/${g.id}/court-status`, { status });
  const orgIn = (g: any) => w.org.ok('POST', `/api/admin/sessions/${g.id}/me`, { in: true });
  /** A new game at this local time, or the next free half hour after it (another step may already have a game there). */
  const makeAt = async (t: number, minutes = 120, note: string | null = null, extra: Record<string, unknown> = {}) => {
    for (const shift of [0, 30, 60, 90, 120, 150, 180]) {
      const start = t + shift * 60_000;
      const res = await w.org.call('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + minutes * 60_000).toISOString(), note, ...extra });
      if (res.status === 409) continue;
      if (res.status >= 300) throw new Error(`POST /api/admin/sessions -> ${res.status} ${res.text.slice(0, 300)}`);
      await refresh();
      return games().find((x) => x.id === res.data.id);
    }
    throw new Error(`no free time near ${new Date(t).toISOString()}`);
  };
  const localAt = (dayMs: number, h: number, m = 0) => {
    const q = localParts(dayMs, TZ);
    return zonedTimeToUtc(q.year, q.month, q.day, h, m, TZ);
  };

  // 0. Older months (Money's month list): two games a month for the last three months, 4 players, all paid $14, finalized (no credit moves).
  let oldGames = 0;
  for (let back = 3; back >= 1; back--) {
    const from = monthStartMs(back);
    const to = monthStartMs(back - 1);
    await at(from - 5 * DAY);
    const inMonth = games().filter((g) => ms(g.startsAt) >= from && ms(g.startsAt) < to);
    for (const [k, g] of [inMonth[1], inMonth[inMonth.length - 3]].filter(Boolean).entries()) {
      const names = k === 0 ? ['Parker', 'Rowan', 'Quinn', SMALL_LONG] : ['Sage', 'Parker', 'Reese', SMALL_LONG];
      await at(ms(g.startsAt) - 2 * DAY);
      await setCourt(g, 'booked');
      for (const n of names) await join(n, g);
      for (const n of names) await orgPays(n, g);
      await at(ms(g.endsAt) + 2 * HOUR);
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
      w.db.raw.prepare('UPDATE sessions SET shown_early = 1 WHERE id = ?').run(g.id);
      oldGames++;
    }
  }
  summary.push(`${oldGames} older games over the last three months: 4 players each, all paid $14, finalized (the month list on Money)`);
  await at(N - 12 * DAY);

  // 1. After-game cards (Zip 16), part 1: three morning games 3 and 2 days back, joined and paid now; finalized at the very end (the seed
  //    time), so the credit is brand new and the cards show for 7 days. Rowan and Sage get $8 back over two games; Parker $5; Quinn owes $3 more.
  const morning = async (daysBack: number, h: number) => makeAt(localAt(N - daysBack * DAY, h));
  const ag1 = await morning(3, 10);
  const ag2 = await morning(2, 10);
  const ag3 = await morning(2, 13);
  const agPlan: [any, string[], string[]][] = [
    [ag1, ['Parker', 'Rowan', 'Sage', 'Reese', SMALL_LONG], ['Parker', 'Rowan', 'Sage', 'Reese', SMALL_LONG]],
    [ag2, ['Rowan', 'Sage', 'Reese', SMALL_LONG], ['Rowan', 'Sage', 'Reese', SMALL_LONG]],
    [ag3, ['Quinn', 'Sage', 'Reese', SMALL_LONG], ['Sage', 'Reese', SMALL_LONG]],
  ];
  for (const [g, names, paid] of agPlan) {
    await setCourt(g, 'booked');
    await orgIn(g);
    for (const n of names) await join(n, g);
    for (const n of paid) await orgPays(n, g);
  }
  const agIds = new Set([ag1.id, ag2.id, ag3.id]);

  // Pick the regular games around "now".
  await refresh();
  const ended = games().filter((g) => ms(g.endsAt) <= N && !agIds.has(g.id));
  const coming = games().filter((g) => ms(g.startsAt) > N);
  if (ended.length < 2 || coming.length < 5) throw new Error(`not enough games around now (${ended.length} past, ${coming.length} coming)`);
  const pastBooked = ended[ended.length - 2];
  const pastNeverBooked = ended[ended.length - 1];
  const [u0, u1, u2, u3, u4] = coming;
  await w.org.ok('PUT', '/api/admin/group', { firstSessionDate: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms(pastBooked.startsAt))) });

  // 2. Unpaid nudge (Zip 17): Vic, Wren and Zoe never paid for 1, 2 and 3 past games (7:00 AM games on three different days from the
  //    booked past game on). Alex is in each. Finalized at now (below).
  const nudgeGames: any[] = [];
  for (const day of [0, 1, 2]) nudgeGames.push(await makeAt(localAt(ms(pastBooked.startsAt) + day * DAY, 7)));
  for (const g of nudgeGames) {
    await setCourt(g, 'booked');
    await orgIn(g);
  }
  for (const n of ['Vic', 'Wren', 'Zoe']) await join(n, nudgeGames[0]);
  for (const n of ['Wren', 'Zoe']) await join(n, nudgeGames[1]);
  await join('Zoe', nudgeGames[2]);

  // 3. Money page: a canceled test game with nobody in (the one game that can be hidden), only when there is room before the last past game.
  if (ms(pastNeverBooked.startsAt) - ms(pastBooked.startsAt) >= 4.5 * DAY) {
    const tg = await makeAt(ms(pastBooked.startsAt) + DAY, 120, 'Test game');
    await w.org.ok('POST', `/api/admin/sessions/${tg.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Test game' });
    summary.push('"Test game" (canceled early, nobody in, no money): the game to hide on Money');
  }

  // 4. The booked past game: played, all paid $14, NOT finalized: the organizer's Finalize card.
  await setCourt(pastBooked, 'booked');
  for (const n of ['Parker', 'Rowan', 'Quinn', SMALL_LONG]) await join(n, pastBooked);
  for (const n of ['Parker', 'Rowan', 'Quinn', SMALL_LONG]) await orgPays(n, pastBooked);
  summary.push('past game, booked, played, NOT finalized (Parker, Rowan, Quinn, Christopher Vanderberg, all paid $14): the organizer Finalize card');

  // 5. The last past game was never booked: Alex, Reese and Christopher Vanderberg signed up, nobody answered "Did you guys play?".
  await at(ms(pastNeverBooked.startsAt) - 2 * DAY);
  await orgIn(pastNeverBooked);
  for (const n of [SMALL_NO_NUMBER, SMALL_LONG]) await join(n, pastNeverBooked);
  await at(Math.min(ms(pastNeverBooked.endsAt) + HOUR, N));
  summary.push('past game, never booked (Alex, Reese, Christopher Vanderberg), not finalized: "Did you guys play?"');

  // 6. Organizer's own games earlier this month (Players "Spent" = Money "Your cost so far"), when there is room before now.
  {
    const q = localParts(N, TZ);
    const monthStart = zonedTimeToUtc(q.year, q.month, 1, 0, 0, TZ);
    let t = Math.ceil(Math.max(w.now + 2 * HOUR, monthStart + 2 * HOUR) / (15 * 60_000)) * 15 * 60_000;
    let made = 0;
    for (const names of [['Parker', 'Quinn', SMALL_LONG], ['Rowan', 'Sage', 'Parker']]) {
      let g: any = null;
      while (!g && t + 2.5 * HOUR <= N - 30 * 60_000) {
        const res = await w.org.call('POST', '/api/admin/sessions', { startsAt: new Date(t).toISOString(), endsAt: new Date(t + 2 * HOUR).toISOString(), note: null });
        if (res.status === 409) t += 30 * 60_000;
        else if (res.status >= 300) throw new Error(res.text);
        else {
          await refresh();
          g = games().find((x) => x.id === res.data.id);
        }
      }
      if (!g) break;
      await setCourt(g, 'booked');
      await orgIn(g);
      for (const n of names) await join(n, g);
      for (const n of names) await orgPays(n, g);
      await at(ms(g.endsAt) + 15 * 60_000);
      await w.org.ok('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
      made++;
      t = Math.ceil((w.now + HOUR) / (15 * 60_000)) * 15 * 60_000;
    }
    summary.push(made === 2 ? 'Alex played 2 four-player games earlier this month (all paid, finalized): Spent = Money "Your cost so far"' : `Alex's games this month: ${made} of 2 fit before now`);
  }

  await at(N);
  // The nudge games are over: Finalize at the flat price (4, 3 and 2 played: $14 each, nobody paid).
  for (const g of nudgeGames) await w.org.ok('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
  summary.push('Unpaid nudge: Vic owes $14 for 1 past game, Wren $28 for 2, Zoe $42 for 3 (signing up is blocked while Unpaid nudge is on)');

  // 7. A canceled game with a reason: Reese paid $14 first, so it comes back as credit; then Reese asks Alex to cash it out (pending).
  await setCourt(u4, 'booked');
  await join(SMALL_NO_NUMBER, u4);
  await orgPays(SMALL_NO_NUMBER, u4);
  await join('Parker', u4);
  await w.org.ok('POST', `/api/admin/sessions/${u4.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Court closed' });
  await (await w.pick(SMALL_NO_NUMBER)).ok('POST', '/api/me/refund-request', { cents: 1400 });
  summary.push('canceled game "Court closed": Reese paid $14 and got it back as credit, then asked for a $14 cash out (Home card)');

  // 8. The next game: Booked, every payment state. Parker paid cash (I paid, confirmed), Vic and Christopher Vanderberg owe $14; Quinn
  //    tapped I paid and then dropped out (an unanswered claim on Home).
  await setCourt(u0, 'booked');
  await orgIn(u0);
  for (const n of ['Parker', 'Vic', SMALL_LONG]) await join(n, u0);
  await (await w.pick('Parker')).ok('POST', `/api/sessions/${u0.id}/paid`, { paid: true, cents: 1400 });
  await w.org.ok('POST', `/api/admin/sessions/${u0.id}/claim`, { playerId: w.ids.Parker, paid: true });
  await join('Quinn', u0);
  await (await w.pick('Quinn')).ok('POST', `/api/sessions/${u0.id}/paid`, { paid: true, cents: 1400 });
  await (await w.pick('Quinn')).ok('POST', `/api/sessions/${u0.id}/withdraw`, {});
  // Zip 32 (Players sheet redo): Reese said no to this game, so its Players sheet shows the grey "Reese declined" line and a chip to give the spot back.
  await (await w.pick(SMALL_NO_NUMBER)).ok('POST', `/api/sessions/${u0.id}/decline`, {});
  summary.push('game 1 (Booked): Alex in; Parker paid cash; Vic and Christopher Vanderberg owe $14; Quinn tapped I paid, then dropped (claim on Home); Reese declined (Players sheet: "Reese declined")');

  // 9. The court on the venue's Waitlist (players read "Court not booked"), 3 in.
  await setCourt(u1, 'waitlist');
  for (const n of ['Vic', 'Wren', SMALL_LONG]) await join(n, u1);
  summary.push('game 2 (court Waitlist): Vic, Wren, Christopher Vanderberg in');

  // 10. Not booked, 3 of 4 in.
  for (const n of ['Parker', 'Wren', SMALL_LONG]) await join(n, u2);
  summary.push('game 3 (Not booked): "3 of 4 in" (Parker, Wren, Christopher Vanderberg)');

  // 11. Booked, 8 in (Alex and 7): Parker and Christopher Vanderberg paid, Vic tapped I paid (self-reported), the rest owe.
  await setCourt(u3, 'booked');
  await orgIn(u3);
  for (const n of ['Parker', 'Vic', 'Wren', 'Zoe', 'Quinn', SMALL_NO_NUMBER, SMALL_LONG]) await join(n, u3);
  for (const n of ['Parker', SMALL_LONG]) await orgPays(n, u3);
  await (await w.pick('Vic')).ok('POST', `/api/sessions/${u3.id}/paid`, { paid: true, cents: 1400 });
  summary.push('game 4 (Booked, 8 in): Parker and Christopher Vanderberg paid; Vic tapped I paid (self-reported); the rest owe $14');

  // 12. Late drops: a game 11 hours out (already inside its 12-hour cancel-by), Booked, 4 in, Christopher Vanderberg paid cash.
  const upcomingAt = async (hoursAhead: number, note: string | null) => {
    const g = await makeAt(Math.ceil((N + hoursAhead * HOUR) / (30 * 60_000)) * 30 * 60_000, 120, note);
    await setCourt(g, 'booked');
    return g;
  };
  const lg = await upcomingAt(11, 'Late-fee test');
  // (Not Vic, Wren or Zoe: a drop there is a fee, and their counts must stay 1, 2 and 3.)
  for (const n of ['Quinn', 'Rowan', 'Sage', SMALL_LONG]) await join(n, lg);
  await orgPays(SMALL_LONG, lg);
  summary.push('"Late-fee test" (11 hours out, inside its cancel-by): Quinn, Rowan, Sage, Christopher Vanderberg in; a drop leaves 3 and owes $14');

  // 13. Late-cancel fee split: 10 hours out, Booked, 6 in (Alex, Parker, Vic, Wren, Quinn, Christopher Vanderberg); Parker and Christopher
  //     Vanderberg paid. Cancel it and answer No: each owes $9, the two who paid get $5 back.
  const sg = await upcomingAt(10, 'Fee split test');
  await orgIn(sg);
  for (const n of ['Parker', 'Quinn', 'Rowan', 'Sage', SMALL_LONG]) await join(n, sg);
  for (const n of ['Parker', SMALL_LONG]) await orgPays(n, sg);
  summary.push('"Fee split test" (10 hours out): 6 in (Alex, Parker, Quinn, Rowan, Sage, Christopher Vanderberg), Parker and Christopher Vanderberg paid; Cancel session > No: $9 each');

  // 14. Money page: "Mixed payments" (Parker and Christopher Vanderberg paid; Vic with Venmo and Wren without owe), "All paid" (4 of 4).
  const mixed = await upcomingAt(20, 'Mixed payments');
  for (const n of ['Parker', SMALL_LONG, 'Vic', 'Wren']) await join(n, mixed);
  for (const n of ['Parker', SMALL_LONG]) await orgPays(n, mixed);
  const allPaid = await upcomingAt(44, 'All paid');
  for (const n of ['Parker', 'Vic', 'Quinn', SMALL_LONG]) await join(n, allPaid);
  for (const n of ['Parker', 'Vic', 'Quinn', SMALL_LONG]) await orgPays(n, allPaid);
  // Text all: Parker paid; Vic, Wren and Quinn owe with numbers; Reese owes with NO number (Text all skips Reese).
  const chase = await upcomingAt(68, 'Owes, one no number');
  for (const n of ['Parker', 'Vic', 'Wren', 'Quinn', SMALL_NO_NUMBER]) await join(n, chase);
  await orgPays('Parker', chase);
  summary.push('"Mixed payments", "All paid" and "Owes, one no number" (Reese has no number: Text all skips Reese)');

  // 15. A late-canceled game with the fee split ($11): 5 in (Alex, Parker paid; Quinn, Reese, Christopher Vanderberg owe $11, not $14).
  await w.org.ok('PUT', '/api/admin/late-fees', { on: true });
  await w.org.ok('PUT', '/api/admin/late-fee-split', { on: true });
  const split11 = await upcomingAt(11.5, 'Fee split $11');
  await orgIn(split11);
  // (Not Quinn: one more debt would hide Quinn's "You owe $3 more" card, which shows only for a single owed game.)
  for (const n of ['Parker', 'Rowan', SMALL_NO_NUMBER, SMALL_LONG]) await join(n, split11);
  await orgPays('Parker', split11);
  await w.org.ok('POST', `/api/admin/sessions/${split11.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
  summary.push('"Fee split $11" (canceled late, fee kept): Rowan, Reese and Christopher Vanderberg owe $11; Parker paid $14 and got $3 back');

  // 16. A game TONIGHT and TOMORROW always exist (Tonight glow); 9 PM or later counts the next day as tonight.
  const pt = localParts(N, TZ);
  const dayShift = pt.hour >= 21 ? 1 : 0;
  const hasOpenGameOn = (date: string) => games().some((g) => !g.state.flags.canceled && ms(g.endsAt) > N && eastDate(ms(g.startsAt)) === date);
  const tonightStart = zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift, 20, 15, TZ);
  const tonightDate = eastDate(tonightStart);
  if (!hasOpenGameOn(tonightDate)) {
    const start = Math.max(tonightStart, Math.ceil((N + 30 * 60_000) / 900_000) * 900_000);
    if (eastDate(start) === tonightDate) {
      const tg = await makeAt(start, 120, 'Tonight test');
      await setCourt(tg, 'booked');
      for (const n of ['Parker', 'Rowan', SMALL_LONG]) await join(n, tg);
      summary.push('"Tonight test": Booked, 3 in (Parker, Rowan, Christopher Vanderberg)');
    }
  }
  const tomorrowStart = zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift + 1, 18, 45, TZ);
  if (!hasOpenGameOn(eastDate(tomorrowStart))) {
    const tm = await makeAt(tomorrowStart, 120, 'Tomorrow test');
    for (const n of ['Sage', SMALL_LONG]) await join(n, tm);
    summary.push('"Tomorrow test": not booked, 2 in (Sage, Christopher Vanderberg)');
  }

  // 17. Short games: one 1.5 hour game about 3 days out, Booked, 4 in: Parker paid $11; Vic, Wren and Quinn owe $11.
  await w.org.ok('PUT', '/api/admin/short-games-switch', { on: true });
  const shortGame = await makeAt(localAt(N + 3 * DAY, 19, 30), 90);
  await setCourt(shortGame, 'booked');
  for (const n of ['Parker', 'Vic', 'Wren', 'Quinn']) await join(n, shortGame);
  await orgPays('Parker', shortGame);
  summary.push('1.5 hour game (Booked, 4 in): Parker paid $11; Vic, Wren and Quinn owe $11');

  // 18. Card cleanup on (no waitlist, no cap): a "1 in" game (Vic).
  await w.org.ok('PUT', '/api/admin/card-cleanup-switch', { on: true });
  const one = await makeAt(localAt(N + 2 * DAY, 18), 120);
  await setCourt(one, 'booked');
  await join('Vic', one);
  summary.push('"1 in" game (Booked, Vic). (No 12-in game on the small preview: there are only 10 names.)');

  // 19. Alert cards: a moved game (7:00 to 7:30 PM after Parker, Quinn and Christopher Vanderberg were in), a credit adjustment, two
  //     regulars with a Want in card, and a late drop someone took.
  const moved = await makeAt(localAt(N + 5 * DAY, 19), 120);
  await setCourt(moved, 'booked');
  for (const n of ['Parker', 'Quinn', SMALL_LONG]) await join(n, moved);
  const movedTo = ms(moved.startsAt) + 30 * 60_000;
  await w.org.ok('PUT', `/api/admin/sessions/${moved.id}/time`, { startsAt: new Date(movedTo).toISOString(), endsAt: new Date(movedTo + 2 * HOUR).toISOString() });
  summary.push('moved game (7:00 to 7:30 PM): Parker, Quinn and Christopher Vanderberg see Still in / Can\'t make it');
  const taken = await upcomingAt(9, null);
  for (const n of [SMALL_NO_NUMBER, 'Parker', 'Quinn', 'Vic']) await join(n, taken);
  await (await w.pick(SMALL_NO_NUMBER)).ok('POST', `/api/sessions/${taken.id}/withdraw`, {});
  await join(SMALL_LONG, taken);
  summary.push('late drop taken: Reese dropped inside the 12 hours, Christopher Vanderberg took the spot: Reese sees "You no longer owe $14"');

  // 20. Game day card (Zip 14): two extra games tonight, "Court 3" (Parker paid; Vic, Wren, Quinn owe) and "Court TBD".
  {
    const takenStarts = new Set(games().map((g) => ms(g.startsAt)));
    const slots = [[17, 0], [21, 30], [19, 30], [20, 45], [21, 45], [15, 0], [12, 0], [10, 0]].map(([h, m]) => zonedTimeToUtc(pt.year, pt.month, pt.day + dayShift, h, m, TZ));
    const free = slots.filter((t) => t > N + 30 * 60_000 && eastDate(t) === tonightDate && !takenStarts.has(t)).slice(0, 2).sort((a, b) => a - b);
    if (free.length >= 2) {
      await w.org.ok('PUT', '/api/admin/game-day-card-switch', { on: true });
      for (const [i, start] of free.entries()) {
        const res = await w.org.ok('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null, ...(i === 0 ? { court: 3 } : {}) });
        await refresh();
        const g = games().find((x) => x.id === res.id);
        await setCourt(g, 'booked');
        // (Not Vic, Wren or Quinn: tonight's money joins the owe card at once, and would change their cards.)
        for (const n of i === 0 ? ['Parker', 'Rowan', 'Sage', SMALL_LONG] : ['Parker', 'Rowan', SMALL_LONG]) await join(n, g);
        if (i === 0) await orgPays('Parker', g);
      }
      await w.org.ok('PUT', '/api/admin/game-day-card-switch', { on: false });
      await refresh();
      summary.push('game day: two extra games tonight, Court 3 (Parker paid; Rowan, Sage, Christopher Vanderberg owe) and Court TBD (Parker, Rowan, Christopher Vanderberg)');
    } else summary.push('game day: no room for two more games tonight (seeded late); the card shows on the tonight game only');
  }

  // 21. Second Chance (Zip 15): game day D, the next Tue or Thu whose only game is the empty regular one (else the first day with no game).
  {
    const onDay = (t: number) => games().filter((g) => eastDate(ms(g.startsAt)) === eastDate(t));
    let dKey: { y: number; m: number; d: number } | null = null;
    let regular: any = null;
    for (let i = 1; i <= 42 && !dKey; i++) {
      const t = N + i * DAY;
      const q = localParts(t, TZ);
      const wd = new Date(Date.UTC(q.year, q.month - 1, q.day, 12)).getUTCDay();
      const day = onDay(t);
      if ((wd === 2 || wd === 4) && day.length === 1 && !holidayFor(day[0].startsAt, TZ) && !day[0].extra && !day[0].state.flags.canceled && day[0].roster.length === 0) {
        dKey = { y: q.year, m: q.month, d: q.day };
        regular = day[0];
      }
    }
    for (let i = 1; i <= 21 && !dKey; i++) {
      const q = localParts(N + i * DAY, TZ);
      if (onDay(N + i * DAY).length === 0) dKey = { y: q.year, m: q.month, d: q.day };
    }
    if (!dKey) throw new Error('no free day for the Second Chance game day');
    const D = dKey;
    const atD = (h: number, m: number, dayOffset = 0) => zonedTimeToUtc(D.y, D.m, D.d + dayOffset, h, m, TZ);
    const make = async (h: number, m: number) => {
      for (const shift of [0, -30, 30, -60, 60, -90, 90]) {
        const start = atD(h, m) + shift * 60_000;
        const res = await w.org.call('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), note: null });
        if (res.status === 409) continue;
        if (res.status >= 300) throw new Error(`POST /api/admin/sessions -> ${res.status} ${res.text.slice(0, 300)}`);
        await refresh();
        return games().find((x) => x.id === res.data.id);
      }
      throw new Error('no free time on game day');
    };
    const chance = regular ?? (await make(19, 30));
    await orgIn(chance);
    for (const n of ['Parker', 'Wren']) await join(n, chance);
    await orgPays('Parker', chance);
    await w.org.ok('POST', `/api/admin/sessions/${chance.id}/decision`, { decision: 'cancel', confirm: true });
    const two = await make(17, 15);
    await orgIn(two);
    await join('Quinn', two);
    await w.org.ok('POST', `/api/admin/sessions/${two.id}/decision`, { decision: 'cancel', confirm: true });
    w.db.raw.prepare('UPDATE sessions SET canceled_at = ? WHERE id IN (?, ?)').run(new Date(atD(21, 0, -1)).toISOString(), chance.id, two.id);
    const same = await make(20, 15);
    for (const n of [SMALL_LONG, 'Vic', SMALL_NO_NUMBER]) await join(n, same);
    await orgPays(SMALL_LONG, same);
    w.db.raw.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').run(new Date(atD(10, 0)).toISOString(), same.id);
    await refresh();
    summary.push(`Second Chance game day ${D.y}-${String(D.m).padStart(2, '0')}-${String(D.d).padStart(2, '0')}: canceled the night before with 3 in (Alex, Parker paid then credit, Wren); one with 2 in (Alex, Quinn): no card; a same-day game (Christopher Vanderberg paid; Vic and Reese owe)`);
  }

  // 22. After-game cards (Zip 16), part 2: finalize the three morning games now. Game 1: 6 played, $9, $5 back. Game 2: 5 played, $11,
  //     $3 back (Rowan and Sage: one card, $8). Game 3: finalized with 5 played ($11), Quinn pays $11, then Reopen and a redo with 4
  //     played ($14): Quinn owes $3 more; Reese did not play: $14 back as credit.
  await w.org.ok('POST', `/api/admin/sessions/${ag1.id}/finalize`, { everyone: true });
  await w.org.ok('POST', `/api/admin/sessions/${ag2.id}/finalize`, { everyone: true });
  await w.org.ok('POST', `/api/admin/sessions/${ag3.id}/finalize`, { everyone: true });
  await w.org.ok('POST', `/api/admin/sessions/${ag3.id}/payment`, { playerId: w.ids.Quinn, paid: true });
  await w.org.ok('POST', `/api/admin/sessions/${ag3.id}/reopen`, {});
  await w.org.ok('POST', `/api/admin/sessions/${ag3.id}/finalize`, { played: [w.ids[SMALL_ORGANIZER], w.ids.Quinn, w.ids.Sage, w.ids[SMALL_LONG]] });
  summary.push('After-game cards: Parker $5 back; Rowan and Sage $8 back from two games; Quinn owes $3 more after a redo');

  // 23. Last, so nothing above spends it: Sage gets a +$5 hand credit adjustment and is a regular for Tue and Thu (Want in card); Rowan is
  //     a Thursday regular (Want in card for Thursday).
  await w.org.ok('PUT', '/api/admin/adjust-credit-switch', { on: true });
  const sagePot = (await (await w.pick('Sage')).ok('GET', '/api/group')).credit.balanceCents as number;
  await w.org.ok('POST', `/api/admin/players/${w.ids.Sage}/credit-adjust`, { direction: 'add', cents: 500, seen: sagePot, reason: 'Thanks for bringing balls' });
  w.db.raw.prepare("UPDATE players SET usual_days = '2,4', is_regular = 1 WHERE id = ?").run(w.ids.Sage);
  w.db.raw.prepare("UPDATE players SET usual_days = '4', is_regular = 1 WHERE id = ?").run(w.ids.Rowan);
  summary.push(`Sage: credit adjusted +$5 ("Thanks for bringing balls", ${(sagePot + 500) / 100} dollars now) and a Tue/Thu regular (Want in card); Rowan: a Thursday regular`);

  await refresh();
  const names = (dash.players as { name: string }[]).map((p) => p.name).sort();
  if (names.join('|') !== [...SMALL_NAMES].sort().join('|')) throw new Error(`the small preview must have exactly the fixed names, has: ${names.join(', ')}`);

  const backupRes = await w.org.call('GET', '/api/admin/backup');
  const backup = JSON.parse(backupRes.text);
  backup.tables.player_devices = [];
  await w.settle();
  const sql = wipeExtras() + (backupToSql(backup) as string) + extraRows(w) + smallSwitchRows(N);
  return { sql, summary };
}
