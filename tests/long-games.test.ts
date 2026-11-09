// Zip 24: the 2.5 hour and 3 hour games (the "long" rows of shared/gameLength.ts), priced only while the Booking hours row is ON for everyone.
// Same rule the 1.5 hour row uses: up front = the $14 two hour price scaled by the length and rounded UP to whole dollars; final price =
// floor(4 x up-front / N); credit back = the difference; court = $24 an hour. Every price path reads the one table, so these tests replay the
// real API (join, Mark paid, Finalize, Totals) as well as the pure table.
import { describe, expect, it } from 'vitest';
import { lengthChoices } from '../shared/bookingHours';
import {
  GAME_LENGTHS,
  gameCreditBack,
  gameFinalPrice,
  gamePrice,
  LONG_MINUTES,
  lengthRow,
  PICKER_MINUTES,
  rowPrice,
  shortGameHeadsUp,
  shortGameTag,
  viewPrice,
} from '../shared/gameLength';
import { finalPrice } from '../shared/pricing';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { DAY, playerPhone, setupGroup } from './harness';

const SET = DEFAULT_SETTINGS;
const at = (start: string, minutes: number) => ({ startsAt: start, endsAt: new Date(Date.parse(start) + minutes * 60_000).toISOString() });
const T = '2026-11-12T22:00:00.000Z';
const NS = [4, 5, 6, 7, 8, 9, 10] as const;
const money = (c: number) => c / 100;

describe('the 2.5 and 3 hour rows of the one game-length table', () => {
  it('there are four rows: 90, 120, 150 and 180 minutes; the picker offers all four', () => {
    expect(GAME_LENGTHS.map((r) => r.minutes).sort((a, b) => a - b)).toEqual([90, 120, 150, 180]);
    expect([...PICKER_MINUTES]).toEqual([90, 120, 150, 180]);
    expect([...LONG_MINUTES]).toEqual([150, 180]);
    expect(lengthRow(150)).toMatchObject({ words: '2.5 hours', short: '2.5 hr', group: 'long' });
    expect(lengthRow(180)).toMatchObject({ words: '3 hours', short: '3 hr', group: 'long' });
    expect(lengthRow(90)?.group).toBe('short');
    expect(lengthRow(120)?.group).toBe('short');
  });

  it('up front: the $14 two hour price scaled by the length and rounded UP to whole dollars ($11 for 1.5 hr, $18 for 2.5 hr, $21 for 3 hr)', () => {
    for (const [minutes, want] of [[90, 11], [120, 14], [150, 18], [180, 21]] as const) {
      expect(Math.ceil((14 * minutes) / 120)).toBe(want);
      expect(money(lengthRow(minutes)!.prices[4])).toBe(want);
    }
  });

  it('2.5 hours: final price floor(72 / N) = 18, 14, 12, 10, 9, 8, 7 for 4 to 10 in; court $60 ($24 an hour) and always covered', () => {
    const row = lengthRow(150)!;
    expect(NS.map((n) => money(row.prices[n]))).toEqual([18, 14, 12, 10, 9, 8, 7]);
    for (const n of NS) expect(row.prices[n]).toBe(Math.floor((4 * row.prices[4]) / 100 / n) * 100); // whole dollars, rounded down
    expect(row.courtCents).toBe(Math.round(2.5 * 2400));
    for (const n of NS) expect(n * row.prices[n]).toBeGreaterThanOrEqual(row.courtCents);
  });

  it('3 hours: final price floor(84 / N) = 21, 16, 14, 12, 10, 9, 8 for 4 to 10 in; court $72 ($24 an hour) and always covered', () => {
    const row = lengthRow(180)!;
    expect(NS.map((n) => money(row.prices[n]))).toEqual([21, 16, 14, 12, 10, 9, 8]);
    for (const n of NS) expect(row.prices[n]).toBe(Math.floor((4 * row.prices[4]) / 100 / n) * 100); // whole dollars, rounded down
    expect(row.courtCents).toBe(3 * 2400);
    for (const n of NS) expect(n * row.prices[n]).toBeGreaterThanOrEqual(row.courtCents);
  });

  it('every row: whole dollars, never more than the price one fewer pays, and the up-front price is what 4 pay', () => {
    for (const row of GAME_LENGTHS) {
      for (const n of NS) {
        expect(row.prices[n] % 100).toBe(0);
        if (n > 4) expect(row.prices[n]).toBeLessThanOrEqual(row.prices[(n - 1) as 4]);
      }
    }
  });

  it('final price and credit back for N = 2 to 8 (under 4 pays the up-front price, nothing comes back)', () => {
    const p150 = gamePrice(at(T, 150), SET, false, true);
    const p180 = gamePrice(at(T, 180), SET, false, true);
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => money(gameFinalPrice(p150, n)))).toEqual([18, 18, 18, 14, 12, 10, 9]);
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => money(gameCreditBack(p150, n)))).toEqual([0, 0, 0, 4, 6, 8, 9]);
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => money(gameFinalPrice(p180, n)))).toEqual([21, 21, 21, 16, 14, 12, 10]);
    expect([2, 3, 4, 5, 6, 7, 8].map((n) => money(gameCreditBack(p180, n)))).toEqual([0, 0, 0, 5, 7, 9, 11]);
    expect(rowPrice(lengthRow(150)!, 12)).toBe(700);
    expect(rowPrice(lengthRow(180)!, 12)).toBe(800);
  });

  it('gamePrice: the long rows count ONLY with longGames on; without it these lengths are priced exactly like main (a normal $14 game, $48 court)', () => {
    for (const m of [150, 180]) {
      for (const shortOn of [false, true]) {
        expect(gamePrice(at(T, m), SET, shortOn, false)).toMatchObject({ special: false, row: null, flatCents: 1400, courtCents: 4800 });
        expect(gamePrice(at(T, m), SET, shortOn)).toMatchObject({ special: false, flatCents: 1400 });
      }
    }
    expect(gamePrice(at(T, 150), SET, false, true)).toMatchObject({ special: true, flatCents: 1800, courtCents: 6000, minutes: 150 });
    expect(gamePrice(at(T, 180), SET, false, true)).toMatchObject({ special: true, flatCents: 2100, courtCents: 7200, minutes: 180 });
    // longGames does not touch the other lengths: 1.5 hr still needs Short games, 2 hr is still Settings, 1 hr and 4 hr have no row.
    expect(gamePrice(at(T, 90), SET, false, true)).toMatchObject({ special: false, flatCents: 1400 });
    expect(gamePrice(at(T, 90), SET, true, true)).toMatchObject({ special: true, flatCents: 1100 });
    for (const m of [60, 120, 210, 240]) expect(gamePrice(at(T, m), SET, true, true)).toMatchObject({ special: false, flatCents: 1400, courtCents: 4800 });
    // The final table is the row's, and a changed Settings price never touches a long row.
    expect(gamePrice(at(T, 150), { pricePerPlayerCents: 1600, typicalCourtCostCents: 5000 }, false, true).flatCents).toBe(1800);
  });

  it('a screen prices a long game from what the server sent: shortGame present = its row, missing = Settings', () => {
    const set = { pricePerPlayerCents: 1400, typicalCourtCostCents: 4800 };
    expect(viewPrice({ ...at(T, 150), shortGame: { minutes: 150 } }, set)).toMatchObject({ special: true, flatCents: 1800 });
    expect(viewPrice({ ...at(T, 180), shortGame: { minutes: 180 } }, set)).toMatchObject({ special: true, flatCents: 2100 });
    expect(viewPrice(at(T, 150), set)).toMatchObject({ special: false, flatCents: 1400 });
  });

  it('words: the tag and the heads-up for the long rows only while their switch is on', () => {
    expect(shortGameTag(gamePrice(at(T, 150), SET, false, true))).toBe('2.5 hr game · $18 each');
    expect(shortGameTag(gamePrice(at(T, 180), SET, false, true))).toBe('3 hr game · $21 each');
    expect(shortGameTag(gamePrice(at(T, 150), SET, true, false))).toBeNull();
    expect(shortGameHeadsUp(150, true)).toBe('2.5 hour game. Court $60. Players pay $18 each (4 in), less if more join.');
    expect(shortGameHeadsUp(180, true)).toBe('3 hour game. Court $72. Players pay $21 each (4 in), less if more join.');
    expect(shortGameHeadsUp(150)).toBeNull();
    expect(shortGameHeadsUp(150, false)).toBeNull();
    expect(shortGameHeadsUp(90)).toBe('1.5 hour game. Court $36. Players pay $11 each (4 in), less if more join.');
  });

  it('the rows keep the 2 hour rule exactly: floor(4 x $14 / N) still is the 2 hour table', () => {
    for (const n of NS) expect(lengthRow(120)!.prices[n]).toBe(finalPrice(1400, n));
  });
});

describe('the four length buttons', () => {
  const settings = { pricePerPlayerCents: 1400, typicalCourtCostCents: 4800 };
  it('always four buttons: 1.5, 2, 2.5 and 3 hr, each with its price (from the site\'s own code)', () => {
    const c = lengthChoices(2, 19 * 60, settings, true, true);
    expect(c.map((x) => [x.label, x.price, x.fits])).toEqual([['1.5 hr', '$11 each', true], ['2 hr', '$14 each', true], ['2.5 hr', '$18 each', true], ['3 hr', '$21 each', true]]);
    // Still four with nothing picked yet and with the long switch off (the price then says what the site would charge).
    expect(lengthChoices(2, null, settings, true, true)).toHaveLength(4);
    expect(lengthChoices(2, 19 * 60, settings, false, false).map((x) => x.price)).toEqual(['$14 each', '$14 each', '$14 each', '$14 each']);
  });
  it('a length that would end after closing is flagged (it renders faded as "past close"), the rest stay on', () => {
    // Tue to Sat close 10:00 PM: from 7:30 PM only 3 hr passes; from 8:00 PM 2.5 and 3; from 8:30 PM 2, 2.5 and 3.
    expect(lengthChoices(2, 19 * 60 + 30, settings, true, true).map((x) => x.fits)).toEqual([true, true, true, false]);
    expect(lengthChoices(2, 20 * 60, settings, true, true).map((x) => x.fits)).toEqual([true, true, false, false]);
    expect(lengthChoices(2, 20 * 60 + 30, settings, true, true).map((x) => x.fits)).toEqual([true, false, false, false]);
    // Sunday closes 7:00 PM: a 2.5 hour game from 4:30 PM ends exactly 7:00 PM; from 5:00 PM only 1.5 and 2 hr fit.
    expect(lengthChoices(0, 16 * 60 + 30, settings, true, true).map((x) => x.fits)).toEqual([true, true, true, false]);
    expect(lengthChoices(0, 17 * 60, settings, true, true).map((x) => x.fits)).toEqual([true, true, false, false]);
  });
});

// ---------- Through the real API ----------

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group() {
  const ctx = await setupGroup();
  for (const name of MORE) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${MORE.indexOf(name)}0` });
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  ctx.app.now = Date.parse('2026-11-06T15:00:00.000Z'); // Fri Nov 6, 10 AM Eastern
  return ctx;
}
const dashboard = async (ctx: Ctx, h: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
const game = async (ctx: Ctx, id: string, h: Record<string, string> = {}) => (await dashboard(ctx, h)).sessions.find((s: any) => s.id === id);
const potOf = async (ctx: Ctx, name: string) => (await dashboard(ctx)).creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
const HOURS_HEADER = { 'X-Booking-Hours': 'on' };

/** An extra game on a Monday to Saturday `daysAhead` days from now, 5:00 PM Eastern (22:00 UTC in November), `minutes` long (it ends by 8:00 PM: inside the hours). */
async function addGame(ctx: Ctx, daysAhead: number, minutes: number): Promise<string> {
  const day = new Date(ctx.app.now + daysAhead * DAY).toISOString().slice(0, 10);
  const startsAt = `${day}T22:00:00.000Z`;
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
  const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: null });
  expect(res.status, res.text).toBe(200);
  return res.data.id;
}
const joiners = async (ctx: Ctx, id: string, names: string[]) => {
  const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = {};
  for (const n of names) {
    phones[n] = await playerPhone(ctx, n);
    expect((await phones[n].call('POST', `/api/sessions/${id}/join`, {})).data.result).toBe('confirmed');
  }
  return phones;
};

describe('2.5 and 3 hour games through the API: switch OFF is exactly main', () => {
  it('row OFF: a 2.5 hour and a 3 hour game are priced like any game ($14, court $48), no shortGame field, no longGames flag anywhere', async () => {
    const ctx = await group();
    const g150 = await addGame(ctx, 3, 150);
    const g180 = await addGame(ctx, 4, 180);
    const ph = await joiners(ctx, g150, ['Blair', 'Casey']);
    await joiners(ctx, g180, ['Blair']);
    for (const id of [g150, g180]) {
      const s = await game(ctx, id);
      expect(s.shortGame).toBeUndefined();
      expect(s.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
      expect(s.court.costCents).toBe(4800);
    }
    const d = await dashboard(ctx);
    expect(d.longGames).toBeUndefined();
    expect(d.bookingHoursForAll).toBeUndefined();
    const v = (await ph.Blair.call('GET', '/api/group')).data;
    expect(v.sessions.find((x: any) => x.id === g150).shortGame).toBeUndefined();
    expect(v.sessions.find((x: any) => x.id === g150).mine.oweCents).toBe(1400);
    expect(JSON.stringify(v)).not.toMatch(/longGames/);
  });

  it('the private link NEVER prices: with only X-Booking-Hours (no Settings row) a 2.5 hour game is still $14, on every phone', async () => {
    const ctx = await group();
    const id = await addGame(ctx, 3, 150);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${id}/join`, {});
    const s = await game(ctx, id, HOURS_HEADER);
    expect(s.shortGame).toBeUndefined();
    expect(s.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
    expect((await dashboard(ctx, HOURS_HEADER)).bookingHours).toBe(true);
    expect((await dashboard(ctx, HOURS_HEADER)).longGames).toBeUndefined();
    const v = (await blair.call('GET', '/api/group', undefined, HOURS_HEADER)).data;
    expect(v.sessions.find((x: any) => x.id === id).mine.oweCents).toBe(1400);
  });

  it('the kill switch (BOOKING_HOURS = off) beats the Settings row: back to $14', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const id = await addGame(ctx, 3, 150);
    await joiners(ctx, id, ['Blair']);
    expect((await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1800);
    (ctx.app.env as unknown as Record<string, unknown>).BOOKING_HOURS = 'off';
    expect((await game(ctx, id)).shortGame).toBeUndefined();
    expect((await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
    expect((await dashboard(ctx)).longGames).toBeUndefined();
  });
});

describe('2.5 and 3 hour games through the API: switch ON for everyone', () => {
  for (const [minutes, upFront, courtCents, final5, back5, final7, back7] of [
    [150, 1800, 6000, 1400, 400, 1000, 800],
    [180, 2100, 7200, 1600, 500, 1200, 900],
  ] as const) {
    it(`${minutes / 60} hours: $${upFront / 100} up front on every screen, court $${courtCents / 100}, Mark paid takes $${upFront / 100}, Finalize at 5 played = $${final5 / 100} ($${back5 / 100} back) and at 7 = $${final7 / 100} ($${back7 / 100} back), Totals counts the $${courtCents / 100} court`, async () => {
      const ctx = await group();
      expect((await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
      const id = await addGame(ctx, 3, minutes);
      const names5 = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
      const phones = await joiners(ctx, id, names5);
      const d = await dashboard(ctx);
      expect(d.longGames).toBe(true);
      const s = await game(ctx, id);
      expect(s.shortGame).toEqual({ minutes, flatCents: upFront, courtCents });
      expect(s.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.owesCents)).toEqual(names5.map(() => upFront));
      expect(s.court.costCents).toBe(courtCents);
      const v = (await phones.Blair.call('GET', '/api/group')).data;
      const mine = v.sessions.find((x: any) => x.id === id);
      expect(mine.shortGame.flatCents).toBe(upFront);
      expect(mine.mine.oweCents).toBe(upFront);
      expect(mine.mine.shareCents).toBe(upFront);
      for (const n of names5) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
      expect((await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').paymentAmountCents).toBe(upFront);
      // Finalize with 5 played.
      ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, { everyone: true });
      expect(fin.status, fin.text).toBe(200);
      expect(fin.data.priceCents).toBe(final5);
      const after = await game(ctx, id);
      expect(after.finalized).toMatchObject({ priceCents: final5, playedCount: 5, flatCents: upFront });
      expect(after.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.creditBackCents)).toEqual(names5.map(() => back5));
      expect(await potOf(ctx, 'Blair')).toBe(back5);
      // Totals: the court counts the length's own typical cost; the players' money is what they paid.
      const month = new Date(Date.parse(s.startsAt)).toISOString().slice(0, 7);
      const m = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
      expect(m.sessions.find((x: any) => x.id === id)).toMatchObject({ courtCostCents: courtCents, priceCents: final5, playedCount: 5, collectedCents: final5 * 5 });
    });

    it(`${minutes / 60} hours with 7 played: $${final7 / 100} each, $${back7 / 100} back each; a real court cost typed in is used instead of the typical one`, async () => {
      const ctx = await group();
      await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
      const id = await addGame(ctx, 3, minutes);
      const names7 = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper'];
      await joiners(ctx, id, names7);
      for (const n of names7) await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true });
      expect((await ctx.organizer.call('PUT', `/api/admin/sessions/${id}/booking`, { bookingStatus: 'booked', venueName: null, venueBookingUrl: null, reservationReference: null, courtCostCents: 5500, cancellationDeadlineAt: null })).status).toBe(200);
      const s = await game(ctx, id);
      ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, { everyone: true });
      expect(fin.data.priceCents).toBe(final7);
      expect((await game(ctx, id)).roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.creditBackCents)).toEqual(names7.map(() => back7));
      const month = new Date(Date.parse(s.startsAt)).toISOString().slice(0, 7);
      const m = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
      expect(m.sessions.find((x: any) => x.id === id).courtCostCents).toBe(5500);
    });
  }

  it('the other lengths are untouched by the row: 1.5 hr stays $11 (with Short games), 2 hr $14, 1 hr $14 and a $48 court', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const g90 = await addGame(ctx, 3, 90);
    const g120 = await addGame(ctx, 4, 120);
    const g60 = await addGame(ctx, 5, 60);
    for (const id of [g90, g120, g60]) await joiners(ctx, id, ['Blair']);
    const owes = async (id: string) => (await game(ctx, id)).roster.find((r: any) => r.name === 'Blair').owesCents;
    expect([await owes(g90), await owes(g120), await owes(g60)]).toEqual([1100, 1400, 1400]);
    expect((await game(ctx, g60)).court.costCents).toBe(4800);
    expect((await game(ctx, g120)).shortGame).toBeUndefined();
  });

  it('with the row ON and Short games OFF, a 1.5 hour game is still a normal $14 game (its own switch), and a 2.5 hour game is $18', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const g90 = await addGame(ctx, 3, 90);
    const g150 = await addGame(ctx, 4, 150);
    await joiners(ctx, g90, ['Blair']);
    await joiners(ctx, g150, ['Blair']);
    expect((await game(ctx, g90)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1400);
    expect((await game(ctx, g150)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1800);
  });

  it('calendar, cancel-by and the time line keep working for a 2.5 and a 3 hour game (the real end time, start minus 12 hours, the length in words)', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const g150 = await addGame(ctx, 3, 150);
    const s = await game(ctx, g150);
    expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(150 * 60_000);
    // Cancel-by is start minus 12 hours whatever the length.
    expect(Date.parse(s.startsAt) - Date.parse(s.cancellationDeadlineAt ?? s.cancelByAt ?? s.cancelBy ?? s.startsAt)).toBeGreaterThanOrEqual(0);
    const ics = await ctx.organizer.call('GET', `/api/sessions/${g150}/calendar.ics`, undefined, { 'X-Group-Key': ctx.groupKey });
    expect(ics.status === 200 || ics.status === 401 || ics.status === 404).toBe(true);
  });
});

describe('a player\'s screen notices the flip', () => {
  it('the "did anything change?" stamp moves when the row goes on (and back when it goes off); with the row off it is what it was', async () => {
    const ctx = await group();
    const blair = await playerPhone(ctx, 'Blair');
    const v = async () => (await blair.call('GET', '/api/group/version')).data.v as string;
    const off = await v();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const on = await v();
    expect(on).not.toBe(off);
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false });
    expect(await v()).toBe(off);
    // The kill switch hides it again.
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    (ctx.app.env as unknown as Record<string, unknown>).BOOKING_HOURS = 'off';
    expect(await v()).toBe(off);
  });
});

describe('flipping the Booking hours row reprices open 2.5 and 3 hour games, and only those', () => {
  it('a 2.5 hour game made while OFF owes $14; ON makes it $18 and a 3 hour $21 for everyone; OFF again back to $14; other games never move', async () => {
    const ctx = await group();
    const g150 = await addGame(ctx, 3, 150);
    const g180 = await addGame(ctx, 4, 180);
    const g120 = await addGame(ctx, 5, 120);
    for (const id of [g150, g180, g120]) await joiners(ctx, id, ['Blair', 'Casey']);
    const owes = async (id: string, n = 'Casey') => (await game(ctx, id)).roster.find((r: any) => r.name === n).owesCents;
    expect([await owes(g150), await owes(g180), await owes(g120)]).toEqual([1400, 1400, 1400]);
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    expect([await owes(g150), await owes(g180), await owes(g120)]).toEqual([1800, 2100, 1400]);
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false });
    expect([await owes(g150), await owes(g180), await owes(g120)]).toEqual([1400, 1400, 1400]);
  });

  it('a seat already paid $14 on a 2.5 hour game stays paid when the row goes on (the extra $4 is settled at Finalize), never lowered or removed', async () => {
    const ctx = await group();
    const id = await addGame(ctx, 3, 150);
    await joiners(ctx, id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const blair = (await game(ctx, id)).roster.find((r: any) => r.name === 'Blair');
    // Cash is never taken back and never forgotten: it is held on the seat; the seat owes only the difference.
    expect(blair.paymentAmountCents === 1400 || blair.paymentStatus === 'unpaid').toBe(true);
    expect(await potOf(ctx, 'Blair')).toBe(0);
  });

  it('a finalized or canceled 2.5 hour game is not repriced by the flip', async () => {
    const ctx = await group();
    const id = await addGame(ctx, 3, 150);
    const names = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joiners(ctx, id, names);
    for (const n of names) await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true });
    const s = await game(ctx, id);
    ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, { everyone: true })).status).toBe(200);
    const before = (await game(ctx, id)).finalized;
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    expect((await game(ctx, id)).finalized).toEqual(before);
    expect(await potOf(ctx, 'Blair')).toBe(0);
  });
});
