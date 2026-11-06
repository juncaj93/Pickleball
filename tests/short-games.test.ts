// Zip 9, item A: 1.5 hour games ("Short games", SHORT_GAMES). The one game-length table, every price path, both switch states,
// and the credit chain with short games mixed in (replayed through the real API, real dollars).
import { describe, expect, it } from 'vitest';
import {
  boxMinutes,
  GAME_LENGTHS,
  NORMAL_MINUTES,
  SHORT_MINUTES,
  gameCreditBack,
  gameFinalPrice,
  gameFinalPreview,
  gameMinutes,
  gamePrice,
  isShortGame,
  lengthRow,
  lengthWords,
  rowPrice,
  shortGameHeadsUp,
  shortGameTag,
  viewPrice,
} from '../shared/gameLength';
import { finalPrice } from '../shared/pricing';
import { feeSplitPrice } from '../shared/lateFees';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { sessionCalendar } from '../shared/calendar';
import { DAY, HOUR, playerPhone, setupGroup } from './harness';

const SET = DEFAULT_SETTINGS;
const at = (start: string, minutes: number) => ({ startsAt: start, endsAt: new Date(Date.parse(start) + minutes * 60_000).toISOString() });
const NS = [4, 5, 6, 7, 8, 9, 10] as const;

describe('the one game-length table (shared/gameLength.ts)', () => {
  it('has exactly two rows today, 90 and 120 minutes, keyed by minutes', () => {
    expect(GAME_LENGTHS.map((r) => r.minutes).sort((a, b) => a - b)).toEqual([90, 120]);
    expect(lengthRow(90)?.courtCents).toBe(3600);
    expect(lengthRow(120)?.courtCents).toBe(4800);
    for (const m of [60, 150, 180, 210, 240]) expect(lengthRow(m)).toBeNull();
  });

  it('the normal row is exactly the live rule: floor(4 x $14 / N) = 14, 11, 9, 8, 7, 6, 5 and a $48 court', () => {
    const normal = lengthRow(NORMAL_MINUTES)!;
    expect(NS.map((n) => normal.prices[n] / 100)).toEqual([14, 11, 9, 8, 7, 6, 5]);
    for (const n of NS) expect(normal.prices[n]).toBe(finalPrice(SET.pricePerPlayerCents, n));
    expect(normal.courtCents).toBe(SET.typicalCourtCostCents);
    // $24 an hour.
    expect(normal.courtCents).toBe(2 * 2400);
  });

  it('the short row: $11 $9 $7 $6 $5 for 4 to 8, proposed $4 $4 for 9 and 10, court $36 ($24 an hour), and the court stays covered', () => {
    const short = lengthRow(SHORT_MINUTES)!;
    expect(NS.map((n) => short.prices[n] / 100)).toEqual([11, 9, 7, 6, 5, 4, 4]);
    expect(short.courtCents).toBe(Math.round(1.5 * 2400));
    // Never more than the price one fewer pays, and N in always pay at least the court.
    for (const n of NS) {
      if (n > 4) expect(short.prices[n]).toBeLessThanOrEqual(short.prices[(n - 1) as 4]);
      expect(n * short.prices[n]).toBeGreaterThanOrEqual(short.courtCents);
    }
    // Whole dollars only.
    for (const n of NS) expect(short.prices[n] % 100).toBe(0);
  });

  it('rowPrice clamps: under 4 pays the 4 price, more than 10 (Max players allows 12) pays the 10 price', () => {
    const short = lengthRow(90)!;
    expect(rowPrice(short, 2)).toBe(1100);
    expect(rowPrice(short, 11)).toBe(400);
    expect(rowPrice(short, 12)).toBe(400);
  });

  it('length is End minus Start; "short" is exactly 90 minutes', () => {
    expect(gameMinutes('2026-11-12T00:30:00.000Z', '2026-11-12T02:00:00.000Z')).toBe(90);
    expect(isShortGame('2026-11-12T00:30:00.000Z', '2026-11-12T02:00:00.000Z')).toBe(true);
    expect(isShortGame('2026-11-12T00:30:00.000Z', '2026-11-12T02:30:00.000Z')).toBe(false);
    expect(isShortGame('2026-11-12T00:30:00.000Z', '2026-11-12T01:59:00.000Z')).toBe(false);
    expect(gameMinutes('bad', 'worse')).toBe(0);
  });

  it('gamePrice: switch off = Settings for every length; on = the row for 90, Settings for 120 and for every length with no row', () => {
    const t = '2026-11-12T00:30:00.000Z';
    for (const m of [60, 90, 120, 150, 180]) {
      const off = gamePrice(at(t, m), SET, false);
      expect(off).toMatchObject({ special: false, flatCents: 1400, courtCents: 4800, row: null });
    }
    expect(gamePrice(at(t, 90), SET, true)).toMatchObject({ special: true, flatCents: 1100, courtCents: 3600, minutes: 90 });
    for (const m of [60, 120, 150, 180, 240]) expect(gamePrice(at(t, m), SET, true)).toMatchObject({ special: false, flatCents: 1400, courtCents: 4800 });
    // A changed Settings price still drives the normal game (exactly as live), never the short row.
    expect(gamePrice(at(t, 120), { pricePerPlayerCents: 1600, typicalCourtCostCents: 5000 }, true).flatCents).toBe(1600);
    expect(gamePrice(at(t, 90), { pricePerPlayerCents: 1600, typicalCourtCostCents: 5000 }, true).flatCents).toBe(1100);
  });

  it('final price and credit back, both tables, N = 1 to 12', () => {
    const t = '2026-11-12T00:30:00.000Z';
    const normal = gamePrice(at(t, 120), SET, true);
    const short = gamePrice(at(t, 90), SET, true);
    for (let n = 1; n <= 12; n++) {
      expect(gameFinalPrice(normal, n)).toBe(finalPrice(1400, n));
      expect(gameCreditBack(normal, n)).toBe(1400 - finalPrice(1400, n));
    }
    expect([1, 2, 3].map((n) => gameFinalPrice(short, n))).toEqual([1100, 1100, 1100]);
    expect(NS.map((n) => gameFinalPrice(short, n) / 100)).toEqual([11, 9, 7, 6, 5, 4, 4]);
    expect(NS.map((n) => gameCreditBack(short, n) / 100)).toEqual([0, 2, 4, 5, 6, 7, 7]);
    expect(gameFinalPreview(short, 6, (c) => `$${c / 100}`)).toBe('6 played · $7 each · $4 credit back each');
  });

  it('the late-cancel fee split uses the game\'s own table ($9 at 5 in, $7 at 6 for a short game; $11 and $9 for a normal one)', () => {
    const t = '2026-11-12T00:30:00.000Z';
    expect(feeSplitPrice(1400, 5)).toBe(1100);
    expect(feeSplitPrice(gamePrice(at(t, 120), SET, true), 6)).toBe(900);
    expect(feeSplitPrice(gamePrice(at(t, 90), SET, true), 5)).toBe(900);
    expect(feeSplitPrice(gamePrice(at(t, 90), SET, true), 6)).toBe(700);
    expect(feeSplitPrice(gamePrice(at(t, 90), SET, true), 4)).toBeNull();
  });

  it('words: the heads-up, the tag, the time line', () => {
    expect(shortGameHeadsUp(90)).toBe('1.5 hour game. Court $36. Players pay $11 each (4 in), less if more join.');
    expect(shortGameHeadsUp(120)).toBeNull();
    expect(shortGameHeadsUp(60)).toBeNull();
    expect(shortGameTag(gamePrice(at('2026-11-12T00:30:00.000Z', 90), SET, true))).toBe('1.5 hr game · $11 each');
    expect(shortGameTag(gamePrice(at('2026-11-12T00:30:00.000Z', 120), SET, true))).toBeNull();
    expect(shortGameTag(gamePrice(at('2026-11-12T00:30:00.000Z', 90), SET, false))).toBeNull();
    expect([120, 90, 60, 150, 180, 45, 100].map(lengthWords)).toEqual(['2 hours', '1.5 hours', '1 hour', '2.5 hours', '3 hours', '45 min', '1 hr 40 min']);
  });

  it('the Add game boxes: 7:30 to 9:00 PM is 90 minutes; any change takes the heads-up away', () => {
    expect(boxMinutes('19:30', '21:00')).toBe(90);
    expect(boxMinutes('19:30', '21:30')).toBe(120);
    expect(boxMinutes('19:30', '19:00')).toBeNull();
    expect(boxMinutes('', '21:00')).toBeNull();
  });

  it('a screen prices a game from what the server sent: shortGame present = its row, missing = Settings', () => {
    const s = at('2026-11-12T00:30:00.000Z', 90);
    expect(viewPrice({ ...s, shortGame: { minutes: 90 } }, SET).flatCents).toBe(1100);
    expect(viewPrice(s, SET).flatCents).toBe(1400);
  });

  it('Add to calendar: a 1.5 hour game gives a 90 minute event (DTEND is the real end)', () => {
    const ics = sessionCalendar({ id: 'x', startsAt: '2026-11-13T00:30:00.000Z', endsAt: '2026-11-13T02:00:00.000Z', location: 'Court', nowIso: '2026-11-06T15:00:00.000Z', timezone: 'America/Detroit' });
    expect(ics).toMatch(/DTSTART;TZID=America\/Detroit:20261112T193000/);
    expect(ics).toMatch(/DTEND;TZID=America\/Detroit:20261112T210000/);
  });
});

// ---------- Through the real API ----------

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
const ON = { 'X-Short-Games': 'on' };

async function group() {
  const ctx = await setupGroup();
  for (const name of MORE) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${MORE.indexOf(name)}0` });
  // The organizer is not one of the players here, so N is just the players who played.
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  return ctx;
}
const dashboard = async (ctx: Ctx, h: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
const game = async (ctx: Ctx, id: string, h: Record<string, string> = {}) => (await dashboard(ctx, h)).sessions.find((s: any) => s.id === id);
const potOf = async (ctx: Ctx, name: string) => (await dashboard(ctx)).creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;

/** An extra game on a day from now, 7:30 PM Eastern, `minutes` long. */
async function addGame(ctx: Ctx, daysAhead: number, minutes: number): Promise<string> {
  const day = new Date(ctx.app.now + daysAhead * DAY).toISOString().slice(0, 10);
  // 7:30 PM Eastern in November (EST, UTC-5) is 00:30 UTC the next day.
  const startsAt = new Date(Date.parse(`${day}T00:30:00.000Z`) + DAY).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
  const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: null });
  expect(res.status, res.text).toBe(200);
  const s = (await dashboard(ctx)).sessions.find((x: any) => x.startsAt === startsAt);
  expect(s).toBeTruthy();
  return s.id;
}

describe('short games through the API', () => {
  it('switch OFF (no Settings row, no header): a 1.5 hour game is priced exactly like any game ($14, $48), no shortGame field anywhere', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    const id = await addGame(ctx, 3, 90);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${id}/join`, {})).data.result).toBe('confirmed');
    const s = await game(ctx, id);
    expect(s.shortGame).toBeUndefined();
    expect(s.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
    const d = await dashboard(ctx);
    expect(d.shortGames).toBeUndefined();
    expect(d.shortGamesForAll).toBe(false);
    const v = (await blair.call('GET', '/api/group')).data;
    expect(v.shortGames).toBeUndefined();
    const mine = v.sessions.find((x: any) => x.id === id);
    expect(mine.shortGame).toBeUndefined();
    expect(mine.mine.oweCents).toBe(1400);
    // The kill switch beats a phone's private link.
    ctx.app.env.SHORT_GAMES = 'off';
    expect((await game(ctx, id, ON)).shortGame).toBeUndefined();
    expect((await game(ctx, id, ON)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
  });

  it('switch ON: every price path uses $11 for a 1.5 hour game and leaves a 2 hour game at $14', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    const on = await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    expect(on.status, on.text).toBe(200);
    const short = await addGame(ctx, 3, 90);
    const normal = await addGame(ctx, 4, 120);
    const d = await dashboard(ctx);
    expect(d.shortGames).toBe(true);
    expect(d.shortGamesForAll).toBe(true);
    const activity = (await ctx.organizer.call('GET', '/api/admin/activity')).data;
    expect(activity.entries.some((e: any) => e.action === 'short_games_on')).toBe(true);

    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    const phones = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await playerPhone(ctx, n)] as const)));
    for (const n of names) {
      expect((await phones[n].call('POST', `/api/sessions/${short}/join`, {})).data.result).toBe('confirmed');
      expect((await phones[n].call('POST', `/api/sessions/${normal}/join`, {})).data.result).toBe('confirmed');
    }
    const sg = await game(ctx, short);
    const ng = await game(ctx, normal);
    // Organizer views: tag info, owes, court.
    expect(sg.shortGame).toEqual({ minutes: 90, flatCents: 1100, courtCents: 3600 });
    expect(ng.shortGame).toBeUndefined();
    expect(sg.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.owesCents)).toEqual([1100, 1100, 1100, 1100, 1100]);
    expect(ng.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.owesCents)).toEqual([1400, 1400, 1400, 1400, 1400]);
    expect(sg.court.costCents).toBe(3600);
    expect(ng.court.costCents).toBe(4800);
    // Player card: "$11 due", Pay (the Venmo link and the Pay sheet both read oweCents).
    const v = (await phones.Blair.call('GET', '/api/group')).data;
    expect(v.shortGames).toBe(true);
    const mine = v.sessions.find((x: any) => x.id === short);
    expect(mine.shortGame.flatCents).toBe(1100);
    expect(mine.mine.oweCents).toBe(1100);
    expect(mine.mine.shareCents).toBe(1100);
    expect(v.sessions.find((x: any) => x.id === normal).mine.oweCents).toBe(1400);
    // Mark paid takes $11.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${short}/payment`, { playerId: ctx.byName.Blair, paid: true })).status).toBe(200);
    expect((await game(ctx, short)).roster.find((r: any) => r.name === 'Blair').paymentAmountCents).toBe(1100);
    // Totals, projected: 3 players x the game's own usual price (3 x $11 for the short one, 3 x $14 for the normal one).
    for (const id of [short, normal]) await ctx.organizer.call('PUT', `/api/admin/sessions/${id}/booking`, { bookingStatus: 'booked', venueName: null, venueBookingUrl: null, reservationReference: null, courtCostCents: null, cancellationDeadlineAt: null });
    const month = new Date(Date.parse(sg.startsAt)).toISOString().slice(0, 7);
    const m = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    expect(m.sessions.find((x: any) => x.id === short).courtCostCents).toBe(0);

    // Finalize with 5 played: $9 each, $2 back to each who paid $11; the normal game: $11 each, $3 back.
    for (const n of names.slice(1)) await ctx.organizer.call('POST', `/api/admin/sessions/${short}/payment`, { playerId: ctx.byName[n], paid: true });
    for (const n of names) await ctx.organizer.call('POST', `/api/admin/sessions/${normal}/payment`, { playerId: ctx.byName[n], paid: true });
    ctx.app.now = Date.parse(sg.endsAt) + 10 * 60_000;
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${short}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    expect(fin.data.priceCents).toBe(900);
    const after = await game(ctx, short);
    expect(after.finalized).toMatchObject({ priceCents: 900, playedCount: 5, flatCents: 1100 });
    expect(after.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.creditBackCents)).toEqual([200, 200, 200, 200, 200]);
    expect(await potOf(ctx, 'Blair')).toBe(200);
    // Totals for the finalized short game: its court counts $36 (typical for 1.5 hours), the players' $45 is collected.
    const m2 = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    const row = m2.sessions.find((x: any) => x.id === short);
    expect(row).toMatchObject({ courtCostCents: 3600, collectedCents: 4500, priceCents: 900, playedCount: 5 });
    ctx.app.now = Date.parse(ng.endsAt) + 10 * 60_000;
    const fin2 = await ctx.organizer.call('POST', `/api/admin/sessions/${normal}/finalize`, { everyone: true });
    expect(fin2.data.priceCents).toBe(1100);
    expect(await potOf(ctx, 'Blair')).toBe(200 + 300);
  });

  it('the per-phone link alone (X-Short-Games: on) prices that phone\'s screens; Settings stays off', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    const id = await addGame(ctx, 3, 90);
    expect((await game(ctx, id)).shortGame).toBeUndefined();
    expect((await game(ctx, id, ON)).shortGame).toEqual({ minutes: 90, flatCents: 1100, courtCents: 3600 });
    const d = await dashboard(ctx, ON);
    expect(d.shortGames).toBe(true);
    expect(d.shortGamesForAll).toBe(false);
  });

  it('auto credit at I\'m in takes at most $11 on a short game; a pending cash out is offered for the $11 too', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    // Give Blair $14 credit: pay $14 into a normal game that is then canceled early.
    const normal = await addGame(ctx, 2, 120);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${normal}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${normal}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const c = await ctx.organizer.call('POST', `/api/admin/sessions/${normal}/decision`, { decision: 'cancel', confirm: true });
    expect(c.status, c.text).toBe(200);
    expect(await potOf(ctx, 'Blair')).toBe(1400);
    const short = await addGame(ctx, 3, 90);
    const j = await blair.call('POST', `/api/sessions/${short}/join`, {});
    expect(j.data.creditCents).toBe(1100);
    const seat = (await game(ctx, short)).roster.find((r: any) => r.name === 'Blair');
    expect(seat).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100, owesCents: 0, creditCents: 1100 });
    expect(await potOf(ctx, 'Blair')).toBe(300);
  });

  it('moving a game from 2 hours to 1.5 hours reprices its seats; back to 2 hours, an $11 cash seat owes the $3 at Finalize (the rule live uses when a price goes up)', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    const id = await addGame(ctx, 3, 120);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${id}/join`, {});
    expect((await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
    const s = await game(ctx, id);
    const mv = await ctx.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: s.startsAt, endsAt: new Date(Date.parse(s.startsAt) + 90 * 60_000).toISOString() });
    expect(mv.status, mv.text).toBe(200);
    expect((await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1100);
    await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const back = await ctx.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: s.startsAt, endsAt: s.endsAt });
    expect(back.status, back.text).toBe(200);
    // Cash is never taken back by a move: the seat still shows its $11 payment until Finalize settles it (as live does after a price
    // change: finalize.ts "Paid the earlier (lower) price ... the cash stays against the seat, the rest is owed").
    let seat = (await game(ctx, id)).roster.find((r: any) => r.name === 'Blair');
    expect(seat).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100 });
    // 4 play, so the price is the full $14: Blair's $11 stays on the seat and $3 is owed.
    for (const n of ['Casey', 'Devon', 'Emery']) {
      await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
      await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true });
    }
    ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    expect(fin.data.priceCents).toBe(1400);
    seat = (await game(ctx, id)).roster.find((r: any) => r.name === 'Blair');
    expect(seat.paymentStatus).toBe('unpaid');
    expect(seat.owesCents).toBe(300);
    expect(seat.paidEarlierCents).toBe(1100);
    expect(await potOf(ctx, 'Blair')).toBe(0);
  });

  it('calendar file for a 1.5 hour game ends 90 minutes after it starts', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    const id = await addGame(ctx, 3, 90);
    const blair = await playerPhone(ctx, 'Blair');
    const res = await blair.call('GET', `/api/sessions/${id}/calendar.ics`);
    expect(res.status).toBe(200);
    const start = /DTSTART;TZID=[^:]+:(\d{8}T\d{6})/.exec(res.text)![1];
    const end = /DTEND;TZID=[^:]+:(\d{8}T\d{6})/.exec(res.text)![1];
    expect(start.slice(9)).toBe('193000');
    expect(end.slice(9)).toBe('210000');
  });

  it('late-cancel fee split on a short game with 5 in: everyone owes $9, a $11 payer gets $2 back', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    await ctx.organizer.call('PUT', '/api/admin/late-fee-split', { on: true });
    const id = await addGame(ctx, 1, 90);
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const s = await game(ctx, id);
    // Inside the 12 hours before the start.
    ctx.app.now = Date.parse(s.startsAt) - 3 * HOUR;
    const c = await ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(c.status, c.text).toBe(200);
    const after = await game(ctx, id);
    expect(after.feeSplit).toEqual({ count: 5, priceCents: 900 });
    expect(await potOf(ctx, 'Blair')).toBe(200);
    expect(after.roster.find((r: any) => r.name === 'Casey').owesCents).toBe(900);
  });
});

// ---------- The credit chain with short games mixed in ----------

interface Step {
  minutes: number;
  players: number;
  price: number;
  creditUsed: number;
  cash: number;
  creditBack: number;
  potAfter: number;
}

describe('credit chain with short games mixed in (Zip 9, item 7)', () => {
  it('normal 6 in, short 6 in using that credit, short 5 in, normal 4 in: nothing lost, doubled or negative', async () => {
    const ctx = await group();
    ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z');
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    const P = 'Blair';
    const others = ['Alex', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules'];
    const phone = await playerPhone(ctx, P);
    const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = { [P]: phone };
    for (const n of others) phones[n] = await playerPhone(ctx, n);
    const plan: Step[] = [
      // Normal game, 6 play: $14 paid, $9 price, $5 back.
      { minutes: 120, players: 6, price: 900, creditUsed: 0, cash: 1400, creditBack: 500, potAfter: 500 },
      // Short game, 6 play: the $5 credit goes on at I'm in, $6 cash makes the $11; price $7, $4 back.
      { minutes: 90, players: 6, price: 700, creditUsed: 500, cash: 600, creditBack: 400, potAfter: 400 },
      // Short game, 5 play: $4 credit + $7 cash = $11; price $9, $2 back.
      { minutes: 90, players: 5, price: 900, creditUsed: 400, cash: 700, creditBack: 200, potAfter: 200 },
      // Normal game, 4 play: $2 credit + $12 cash = $14; price $14, nothing back.
      { minutes: 120, players: 4, price: 1400, creditUsed: 200, cash: 1200, creditBack: 0, potAfter: 0 },
    ];
    const ids: string[] = [];
    for (const [i, step] of plan.entries()) ids.push(await addGame(ctx, 2 + i * 2, step.minutes));
    const report: string[] = [];
    let cashTotal = 0;
    let pricesTotal = 0;
    for (const [i, step] of plan.entries()) {
      const flat = step.minutes === 90 ? 1100 : 1400;
      const potBefore = await potOf(ctx, P);
      const join = await phone.call('POST', `/api/sessions/${ids[i]}/join`, {});
      expect(join.data.result).toBe('confirmed');
      expect(join.data.creditCents ?? 0, `game ${i + 1}: credit used at I'm in`).toBe(step.creditUsed);
      expect(await potOf(ctx, P)).toBe(potBefore - step.creditUsed);
      let mine = (await game(ctx, ids[i])).roster.find((r: any) => r.name === P);
      expect(mine.owesCents, `game ${i + 1}: owes before paying`).toBe(flat - step.creditUsed);
      for (const n of others.slice(0, step.players - 1)) {
        expect((await phones[n].call('POST', `/api/sessions/${ids[i]}/join`, {})).status).toBe(200);
        const o = (await game(ctx, ids[i])).roster.find((r: any) => r.name === n);
        if (o.paymentStatus !== 'paid') expect((await ctx.organizer.call('POST', `/api/admin/sessions/${ids[i]}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
      }
      if (step.cash > 0) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${ids[i]}/payment`, { playerId: ctx.byName[P], paid: true })).status).toBe(200);
      mine = (await game(ctx, ids[i])).roster.find((r: any) => r.name === P);
      expect(mine).toMatchObject({ paymentStatus: 'paid', owesCents: 0, paymentAmountCents: flat });
      const g = await game(ctx, ids[i]);
      ctx.app.now = Date.parse(g.endsAt) + 10 * 60_000;
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${ids[i]}/finalize`, { everyone: true });
      expect(fin.status, fin.text).toBe(200);
      const after = await game(ctx, ids[i]);
      expect(after.finalized.priceCents, `game ${i + 1}`).toBe(step.price);
      mine = after.roster.find((r: any) => r.name === P);
      expect(mine.creditBackCents ?? 0, `game ${i + 1}: credit back`).toBe(step.creditBack);
      const pot = await potOf(ctx, P);
      expect(pot, `game ${i + 1}: pot after`).toBe(step.potAfter);
      expect(pot).toBeGreaterThanOrEqual(0);
      expect(step.creditUsed + step.cash - step.price).toBe(step.creditBack);
      for (const n of others.slice(0, step.players - 1)) {
        const r = after.roster.find((x: any) => x.name === n);
        expect(r.paymentAmountCents - step.price, `${n} game ${i + 1}`).toBe(r.creditBackCents ?? 0);
      }
      cashTotal += step.cash;
      pricesTotal += step.price;
      report.push(
        `Game ${i + 1} (${step.minutes === 90 ? '1.5 hours' : '2 hours'}): ${step.players} play, price $${step.price / 100}. Credit used $${step.creditUsed / 100} + cash $${step.cash / 100} = $${flat / 100}; back as credit $${step.creditBack / 100}; credit after $${pot / 100}.`,
      );
      for (const n of others) {
        const p = await potOf(ctx, n);
        if (p > 0) {
          expect((await phones[n].call('POST', '/api/me/refund-request', { cents: p })).status).toBe(200);
          const req = (await dashboard(ctx)).refundRequests.find((x: any) => x.playerId === ctx.byName[n]);
          expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' })).status).toBe(200);
        }
      }
    }
    expect(cashTotal).toBe(pricesTotal);
    expect(cashTotal).toBe(1400 + 600 + 700 + 1200);
    expect(await potOf(ctx, P)).toBe(0);
    const rows = ctx.app.db.raw
      .prepare('SELECT kind, amount_cents, ended_at FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid')
      .all(ctx.byName[P]) as { kind: string; amount_cents: number; ended_at: string | null }[];
    const live = rows.filter((r) => !r.ended_at);
    expect(live.every((r) => r.amount_cents > 0)).toBe(true);
    expect(live.filter((r) => r.kind === 'kept').reduce((a, r) => a + r.amount_cents, 0)).toBe(500 + 400 + 200);
    expect(live.filter((r) => r.kind === 'used').reduce((a, r) => a + r.amount_cents, 0)).toBe(500 + 400 + 200);
    console.log(`CREDIT CHAIN WITH SHORT GAMES (${P}):\n${report.join('\n')}\nCash paid $${cashTotal / 100} = prices $${pricesTotal / 100}; credit at the end $0.`);
  });
});
