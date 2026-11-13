// Zip 27: the money fixes from Audit A (docs/audits/AUDIT_A_2026-11.md on PR #117), A-01 to A-05, and the test gaps it named.
//  A-01  a finalized (or canceled) game keeps the price rules it was finalized under: Short games / Booking hours OFF, a new "Price per
//        player" or "Typical court cost" never re-price it (Totals, the game row, a no-show debt, a Reopen and redo).
//  A-02  a game made pricier after people paid cash: a late cancel with the fee kept, a late drop and a no-show ask for the gap.
//  A-03  the health check's "credit on a seat" limit is the price table's top price, not a fixed $14.
//  A-04  Remove refuses a player who is still in a game that has not ended.
//  A-05  "Spent matches Totals" (SPENT_TOTALS, ships OFF): Players Spent counts what Totals counts.
// Gaps: a switch turned off after Finalize; a price raised then a late cancel; removing a player with upcoming seats; Second Chance with
// Booking hours ON; every length 1.5 / 2 / 2.5 / 3 hr for N = 1 to 10 played, organizer in and out.
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GAME_LENGTHS, lengthRow, rowPrice } from '../shared/gameLength';
import { finalPrice } from '../shared/pricing';
import { SPENT_TOTALS, spentText, spentTotalsAllowed } from '../shared/spentTotals';
import { SECOND_CHANCE } from '../shared/secondChance';
import { formatPrice } from '../shared/money';
import { lockedPrice, priceLockDetail } from '../server/repo';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';
import { buildWorld, flipPriceRules, moneyDump, settledPart } from './zip27-world';

vi.setConfig({ testTimeout: 120_000 });

const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const MAIN_DUMP = JSON.parse(readFileSync(pjoin(process.cwd(), 'tests/fixtures/zip27-main-dump.json'), 'utf8'));

type W = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group(switches: string[] = ['short-games-switch', 'late-fees']) {
  const w = await setupGroup();
  for (const name of MORE) await w.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${MORE.indexOf(name)}0` });
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const sw of switches) expect((await w.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status, sw).toBe(200);
  const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  w.byName = Object.fromEntries(d.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  w.app.now = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern
  return w;
}
const dash = async (w: W, h: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
const game = async (w: W, id: string) => (await dash(w)).sessions.find((s: { id: string }) => s.id === id);
const seat = async (w: W, id: string, name: string) => (await game(w, id)).roster.find((r: { name: string }) => r.name === name);
const pot = async (w: W, name: string) => (await dash(w)).creditLedger.find((l: { playerId: string }) => l.playerId === w.byName[name])?.balanceCents ?? 0;
const phones = new WeakMap<W, Record<string, Awaited<ReturnType<typeof playerPhone>>>>();
async function phone(w: W, name: string) {
  const all = phones.get(w) ?? {};
  phones.set(w, all);
  all[name] ??= await playerPhone(w, name);
  return all[name];
}
const mineOf = async (w: W, name: string, id: string) => ((await (await phone(w, name)).call('GET', '/api/group')).data.sessions.find((s: { id: string }) => s.id === id) ?? {}).mine;
/** A game `minutes` long starting `day` at 22:00 UTC (5:00 PM Eastern in November: inside the venue hours for every length). */
async function addGame(w: W, day: string, minutes: number): Promise<{ id: string; start: number }> {
  const startsAt = `${day}T22:00:00.000Z`;
  const res = await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(), note: null });
  expect(res.status, res.text).toBe(200);
  return { id: res.data.id, start: Date.parse(startsAt) };
}
async function joinAll(w: W, id: string, names: string[]) {
  for (const n of names) {
    if (n === 'Alex') expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/me`, { in: true })).status).toBe(200);
    else expect((await (await phone(w, n)).call('POST', `/api/sessions/${id}/join`, {})).status).toBe(200);
  }
}
async function pay(w: W, id: string, names: string[]) {
  for (const n of names) expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName[n], paid: true })).status).toBe(200);
}
async function setLength(w: W, id: string, start: number, minutes: number) {
  const r = await w.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + minutes * 60_000).toISOString() });
  expect(r.status, r.text).toBe(200);
}
function health(w: W) {
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = (w.app.db as any).raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const month = async (w: W, m: string, h: Record<string, string> = {}) => (await w.organizer.call('GET', `/api/admin/money?month=${m}`, undefined, h)).data;

// ---------- The before/after proof ----------

describe('before/after proof: the fake world of every length reads exactly like main', () => {
  for (const [key, bookingHours] of [['live switches', false], ['booking hours on', true]] as const) {
    it(`${key}: every finalized game, every past month, every player screen and Spent equal main's (tests/fixtures/zip27-main-dump.json)`, async () => {
      expect(await moneyDump(await buildWorld({ bookingHours }))).toEqual(MAIN_DUMP[key]);
    });
  }
});

// ---------- A-01 ----------

describe('A-01: a finalized game keeps the price rules it was finalized under', () => {
  for (const bookingHours of [false, true]) {
    it(`a switch turned off after Finalize (and a new Price per player and Typical court cost): nothing settled moves${bookingHours ? ', Booking hours on and then off' : ''}`, async () => {
      const w = await buildWorld({ bookingHours });
      const before = settledPart(await moneyDump(w));
      await flipPriceRules(w, { bookingHours });
      const after = settledPart(await moneyDump(w));
      expect(after).toEqual(before);
      // The games still ahead DO follow the new rules (that is what the switches are for): the open Nov 11 game is now $15 a seat.
      const d = await dash(w);
      const ahead = d.sessions.find((s: { startsAt: string }) => s.startsAt === '2026-11-11T23:00:00.000Z');
      expect(ahead.roster.find((r: { name: string }) => r.name === 'Casey').shareCents).toBe(1500);
      expect(ahead.court.costCents).toBe(5000);
    });
  }

  it('Reopen and Finalize again after Short games is turned off: the 1.5 hour price table, the $36 court and the $4 credit back each stay', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 90);
    const six = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'];
    await joinAll(w, g.id, six);
    await pay(w, g.id, six);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1100);
    w.app.now = g.start + 2 * HOUR;
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(fin.data.priceCents).toBe(700);
    expect(await pot(w, 'Blair')).toBe(400);
    const totals = (await month(w, '2026-11')).rework;
    // The audit's case: turn Short games off, then Reopen and Finalize.
    expect((await w.organizer.call('PUT', '/api/admin/short-games-switch', { on: false })).status).toBe(200);
    expect((await month(w, '2026-11')).rework).toEqual(totals);
    expect((await game(w, g.id)).court.costCents).toBe(3600);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    // While reopened it is still a $11 game (not $14): no seat owes anything.
    expect((await game(w, g.id)).roster.filter((r: { owesCents: number }) => r.owesCents > 0)).toEqual([]);
    const redo = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(redo.status, redo.text).toBe(200);
    expect(redo.data.priceCents).toBe(700); // main gives $9 here, and $2 back instead of $4
    for (const n of six) expect(await pot(w, n)).toBe(400);
    expect((await month(w, '2026-11')).rework).toEqual(totals);
  });

  it('the lock: written at Finalize in the same step; only counts while the game is that length; a bad lock is ignored', async () => {
    const w = await group(['short-games-switch', 'late-fees', 'booking-hours-switch']);
    const g = await addGame(w, '2026-11-10', 150);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    w.app.now = g.start + 3 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    const raw = (w.app.db as any).raw;
    const lock = raw.prepare("SELECT detail FROM task_log WHERE session_id = ? AND task = 'price_lock' AND kind = 'mark'").get(g.id) as { detail: string };
    expect(JSON.parse(lock.detail)).toEqual({ m: 150, flat: 1800, court: 6000, row: 150 });
    const startsAt = new Date(g.start).toISOString();
    const endsAt = (m: number) => new Date(g.start + m * 60_000).toISOString();
    expect(lockedPrice({ starts_at: startsAt, ends_at: endsAt(150), price_lock: lock.detail })).toMatchObject({ special: true, flatCents: 1800, courtCents: 6000 });
    expect(lockedPrice({ starts_at: startsAt, ends_at: endsAt(120), price_lock: lock.detail })).toBeNull();
    expect(lockedPrice({ starts_at: startsAt, ends_at: endsAt(150), price_lock: '{bad' })).toBeNull();
    expect(lockedPrice({ starts_at: startsAt, ends_at: endsAt(150), price_lock: '{"m":150,"flat":-1,"court":0,"row":null}' })).toBeNull();
    expect(lockedPrice({ starts_at: startsAt, ends_at: endsAt(150), price_lock: null })).toBeNull();
    expect(priceLockDetail({ minutes: 120, special: false, row: null, flatCents: 1400, courtCents: 4800 })).toBe('{"m":120,"flat":1400,"court":4800,"row":null}');
    // The lock is bookkeeping: it is not one of the card marks the organizer screen gets.
    expect((await dash(w)).marks ?? []).not.toContain(`${g.id}:price_lock`);
    // Booking hours off for everyone: the finalized 2.5 hour game still reads $18 and $60.
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false });
    expect((await game(w, g.id)).court.costCents).toBe(6000);
    expect((await game(w, g.id)).shortGame).toEqual({ minutes: 150, flatCents: 1800, courtCents: 6000 });
  });

  it('a game finalized before Zip 27 (no lock) gets one from what it shows, right before a price switch or money setting changes; other saves write nothing', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 90);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = g.start + 2 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    const raw = (w.app.db as any).raw;
    raw.prepare("DELETE FROM task_log WHERE task = 'price_lock'").run(); // as if finalized on main
    const count = () => (raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'price_lock'").get() as { n: number }).n;
    const d = await dash(w);
    await w.organizer.call('PUT', '/api/admin/group', { settings: { ...d.group.settings, horizonWeeks: d.group.settings.horizonWeeks } });
    expect(count()).toBe(0);
    await w.organizer.call('PUT', '/api/admin/group', { settings: { ...d.group.settings, typicalCourtCostCents: 5200 } });
    expect(count()).toBe(1);
    expect((await game(w, g.id)).court.costCents).toBe(3600);
    // The private test link on this phone (Short games for one phone) never shapes a lock: it is what everyone sees.
    raw.prepare("DELETE FROM task_log WHERE task = 'price_lock'").run();
    await w.organizer.call('PUT', '/api/admin/short-games-switch', { on: false }, { 'X-Short-Games': 'on' });
    expect(JSON.parse((raw.prepare("SELECT detail FROM task_log WHERE task = 'price_lock'").get() as { detail: string }).detail)).toEqual({ m: 90, flat: 1100, court: 3600, row: 90 });
  });

  it('a canceled game reopened (gear > Reopen) is a live game again: its lock goes and it follows today\'s rules', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-12', 90);
    await joinAll(w, g.id, ['Blair', 'Casey']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    await w.organizer.call('PUT', '/api/admin/short-games-switch', { on: false }); // locks the canceled game at $11
    const raw = (w.app.db as any).raw;
    expect(raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE session_id = ? AND task = 'price_lock'").get(g.id)).toEqual({ n: 1 });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE session_id = ? AND task = 'price_lock'").get(g.id)).toEqual({ n: 0 });
    await joinAll(w, g.id, ['Devon']);
    expect((await seat(w, g.id, 'Devon')).shareCents).toBe(1400);
  });
});

// ---------- A-02 ----------

describe('A-02: a game made pricier after people paid cash, then a late fee: the gap is asked for', () => {
  it('1.5 hr paid $11 cash, made 2 hr, canceled 3 hours before, fee kept (no split): each owes $3, the $11 stays as paid earlier, Totals counts $55 then $70', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 90);
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    await pay(w, g.id, five);
    await setLength(w, g.id, g.start, 120);
    expect((await seat(w, g.id, 'Blair')).owesCents).toBe(0); // the documented rule until a fee or Finalize: paid, settled later
    w.app.now = g.start - 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    for (const n of five) {
      const r = await seat(w, g.id, n);
      expect([r.paymentStatus, r.owesCents, r.paidEarlierCents]).toEqual(['unpaid', 300, 1100]);
      const mine = await mineOf(w, n, g.id);
      expect(mine.lateFee).toMatchObject({ kind: 'canceled_late', oweCents: 300 });
      expect(await pot(w, n)).toBe(0); // nothing moved into or out of the pot
    }
    expect(health(w)).toEqual({});
    const m = await month(w, '2026-11');
    expect(m.sessions.find((s: { startsAt: string }) => s.startsAt === new Date(g.start).toISOString()).collectedCents).toBe(5500);
    await pay(w, g.id, five);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1400);
    expect((await month(w, '2026-11')).sessions.find((s: { startsAt: string }) => s.startsAt === new Date(g.start).toISOString()).collectedCents).toBe(7000);
    // Clear one (venue waived): the whole $14 comes back as credit.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('with the fee split on: 4 in owes the $3 gap each; 6 in is split at $9 and the $2 above it comes back', async () => {
    for (const [count, owe, back] of [[4, 300, 0], [6, 0, 200]] as const) {
      const w = await group(['short-games-switch', 'late-fees', 'late-fee-split']);
      const g = await addGame(w, '2026-11-10', 90);
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'].slice(0, count);
      await joinAll(w, g.id, names);
      await pay(w, g.id, names);
      await setLength(w, g.id, g.start, 120);
      w.app.now = g.start - 3 * HOUR;
      expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
      for (const n of names) {
        expect((await seat(w, g.id, n)).owesCents, `${count} in, ${n}`).toBe(owe);
        expect(await pot(w, n)).toBe(back);
      }
      expect(health(w)).toEqual({});
    }
  });

  it('a late drop that leaves the game short, on a seat paid $11 before the game was made 2 hours: owes the $3; a sub clears it and the $11 comes back', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 90);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 120);
    w.app.now = g.start - 3 * HOUR;
    // The drop dialog already says the $3 (not "Your $14 stays"), and so does the drop's answer (its toast).
    expect((await mineOf(w, 'Blair', g.id)).lateDrop).toMatchObject({ owes: true, paid: false, feeCents: 300 });
    const drop = await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(drop.status).toBe(200);
    expect(drop.data.lateFee).toEqual({ cents: 300, paid: false });
    const r = await seat(w, g.id, 'Blair');
    expect([r.status, r.paymentStatus, r.owesCents]).toEqual(['withdrawn', 'unpaid', 300]);
    expect((await mineOf(w, 'Blair', g.id)).lateFee).toMatchObject({ kind: 'late_drop', oweCents: 300 });
    expect(health(w)).toEqual({});
    await joinAll(w, g.id, ['Frankie']); // a sub takes the spot: the oldest debt clears
    expect((await seat(w, g.id, 'Blair')).owesCents).toBe(0);
    expect(await pot(w, 'Blair')).toBe(1100);
    expect(health(w)).toEqual({});
  });

  it('a no-show with 3 played, on a seat paid $11 before the game was made 2 hours: owes the $3 like the 3 who played (before: $0)', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 90);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 120);
    w.app.now = g.start + 3 * HOUR;
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) });
    expect(fin.status, fin.text).toBe(200);
    for (const n of four) expect((await seat(w, g.id, n)).owesCents, n).toBe(300);
    // Emery's own screen: the Pay list asks for $3 "(did not play)" (a past game shows there, not as a card).
    const owed = (await (await phone(w, 'Emery')).call('GET', '/api/group')).data.owed.find((o: { sessionId: string }) => o.sessionId === g.id);
    expect(owed).toMatchObject({ amountCents: 300, lateFee: 'no_show' });
    expect(health(w)).toEqual({});
    // Reopen undoes it all the usual way (the cash stays held, so a redo with everyone played still owes the same $3 each).
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect(health(w)).toEqual({});
  });

  it('Booking hours turned on raises an open 2.5 hour game from $14 to $18: a late cancel then asks the $4 each', async () => {
    const w = await group(['short-games-switch', 'late-fees']);
    const g = await addGame(w, '2026-11-10', 150);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1400);
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    w.app.now = g.start - 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    for (const n of four) expect((await seat(w, g.id, n)).owesCents).toBe(400);
    expect(health(w)).toEqual({});
  });

  it('nothing changes when the price did not go up: the same late cancel on a game paid at its own price leaves every seat paid', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon']);
    await pay(w, g.id, ['Blair', 'Casey', 'Devon']);
    w.app.now = g.start - 3 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    for (const n of ['Blair', 'Casey', 'Devon']) expect([(await seat(w, g.id, n)).paymentStatus, (await seat(w, g.id, n)).owesCents]).toEqual(['paid', 0]);
    const raw = (w.app.db as any).raw;
    expect(raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason = 'cash'").get()).toEqual({ n: 0 });
  });
});

// ---------- A-03 ----------

describe('A-03: the health check uses the price table, not a fixed $14', () => {
  it('its limit is the top up-front price in GAME_LENGTHS ($21) or the Settings price, whichever is higher', () => {
    expect(INTEGRITY).toContain(`MAX(${Math.max(...GAME_LENGTHS.map((r) => rowPrice(r, 4)))}, `);
    expect(Math.max(...GAME_LENGTHS.map((r) => rowPrice(r, 4)))).toBe(2100);
  });
  for (const minutes of [150, 180]) {
    it(`a ${minutes / 60} hour game paid in full with credit reads 0 (it read 1 before)`, async () => {
      const w = await group(['short-games-switch', 'late-fees', 'booking-hours-switch']);
      const g = await addGame(w, '2026-11-10', minutes);
      const flat = lengthRow(minutes)!.prices[4];
      // $28 of credit for Blair (from two canceled $14 games).
      const two = [await addGame(w, '2026-11-11', 120), await addGame(w, '2026-11-12', 120)];
      for (const c of two) {
        await joinAll(w, c.id, ['Blair']);
        await pay(w, c.id, ['Blair']);
      }
      for (const c of two) expect((await w.organizer.call('POST', `/api/admin/sessions/${c.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
      expect(await pot(w, 'Blair')).toBe(2800);
      await joinAll(w, g.id, ['Blair']);
      expect((await seat(w, g.id, 'Blair')).creditCents).toBe(flat);
      expect(health(w)).toEqual({});
    });
  }
  it('still catches credit above the top price on one seat', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    await joinAll(w, g.id, ['Blair']);
    const raw = (w.app.db as any).raw;
    const add = (kind: string, cents: number, sid: string | null) =>
      raw.prepare('INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT ?, group_id, ?, ?, ?, ?, ? FROM players WHERE id = ?').run(crypto.randomUUID(), w.byName.Blair, kind, cents, sid, new Date(w.app.now).toISOString(), w.byName.Blair);
    add('kept', 2200, null);
    add('used', 2200, g.id);
    expect(health(w)).toMatchObject({ credit_on_seat_over_14: 1 });
  });
});

// ---------- A-04 ----------

describe('A-04: Remove refuses someone still in a game that has not ended', () => {
  it('Casey in the next two games: Remove says so and changes nothing; out of both, Remove hides her as before', async () => {
    const w = await group();
    const a = await addGame(w, '2026-11-10', 120);
    const b = await addGame(w, '2026-11-12', 120);
    await joinAll(w, a.id, ['Casey']);
    await joinAll(w, b.id, ['Casey']);
    const r = await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Casey}`);
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('player_in_games');
    expect(r.data.message).toBe('Casey is still in 2 games (Tue, Nov 10 and Thu, Nov 12). Take Casey out of them first (gear > Players), then remove the name.');
    expect((await dash(w)).players.find((p: { name: string }) => p.name === 'Casey').isActive).toBe(true);
    expect((await seat(w, a.id, 'Casey')).status).toBe('confirmed');
    // Her phone still works: she drops herself out of one, the organizer takes her out of the other.
    expect((await (await phone(w, 'Casey')).call('POST', `/api/sessions/${a.id}/withdraw`, {})).status).toBe(200);
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Casey}`)).data.message).toBe('Casey is still in a game (Thu, Nov 12). Take Casey out of it first (gear > Players), then remove the name.');
    expect((await (await phone(w, 'Casey')).call('POST', `/api/sessions/${b.id}/withdraw`, {})).status).toBe(200);
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Casey}`)).data).toEqual({ result: 'hidden' });
  });
  it('a past game, a canceled game and a waitlist on a past game do not block; nobody with no history is affected', async () => {
    const w = await group();
    const past = await addGame(w, '2026-11-10', 120);
    await joinAll(w, past.id, ['Devon']);
    const canceled = await addGame(w, '2026-11-12', 120);
    await joinAll(w, canceled.id, ['Devon']);
    await w.organizer.call('POST', `/api/admin/sessions/${canceled.id}/decision`, { decision: 'cancel', confirm: true });
    w.app.now = past.start + 3 * HOUR;
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Devon}`)).data).toEqual({ result: 'hidden' });
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Lee}`)).data).toEqual({ result: 'deleted' });
  });
});

// ---------- A-05 ----------

describe('A-05: "Spent matches Totals" (SPENT_TOTALS, ships OFF)', () => {
  it('the switch: off at ship, kill switch allowed unless "off", the Settings row, the private link, the words', async () => {
    expect(SPENT_TOTALS).toEqual({ task: 'spent_totals_on', header: 'X-Spent-Totals', link: 'spenttotals', env: 'SPENT_TOTALS', name: 'Spent matches Totals' });
    expect(spentTotalsAllowed(undefined)).toBe(true);
    expect(spentTotalsAllowed(' OFF ')).toBe(false);
    expect(spentText(10800, formatPrice)).toBe('$108');
    expect(spentText(-800, formatPrice)).toBe('$8 credit');
    expect(spentText(0, formatPrice)).toBe('$0');
    const w = await group();
    const d = await dash(w);
    expect(d.spentTotals).toBeUndefined();
    expect(d.spentTotalsForAll).toBeUndefined();
    expect((await dash(w, { 'X-Spent-Totals': 'on' })).spentTotals).toBe(true);
    expect((await w.organizer.call('PUT', '/api/admin/spent-totals-switch', { on: true })).status).toBe(200);
    expect(await dash(w)).toMatchObject({ spentTotals: true, spentTotalsForAll: true });
    (w.app.env as unknown as Record<string, unknown>).SPENT_TOTALS = 'off';
    expect((await dash(w)).spentTotals).toBeUndefined();
    const blair = await phone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/spent-totals-switch', { on: false })).status).toBe(401);
    const { BUILDING_ON } = await import('../scripts/preview-world-small');
    expect([...BUILDING_ON]).toContain(SPENT_TOTALS.task);
  });

  it('on: each player\'s Spent for a month adds up to that month\'s Totals "Players paid", late fees included; the organizer\'s credit month shows', async () => {
    const w = await buildWorld({ bookingHours: false });
    const off = (await dash(w)).players;
    expect((await w.organizer.call('PUT', '/api/admin/spent-totals-switch', { on: true })).status).toBe(200);
    const on = (await dash(w)).players;
    // Kit dropped late (Oct 15) and kept $14 on the game; Indy did not play Oct 10 and kept $14; Blair, Casey and Devon paid the canceled-late Oct 14.
    const of = (list: { name: string; spentCents: number }[], n: string) => list.find((p) => p.name === n)!.spentCents;
    expect(of(on, 'Kit') - of(off, 'Kit')).toBe(1400);
    expect(of(on, 'Indy') - of(off, 'Indy')).toBe(1400);
    expect(of(on, 'Blair')).toBeGreaterThan(of(off, 'Blair'));
    // This month (the sheet's month card): every player's Spent adds up to November's "Players paid".
    let sum = 0;
    for (const p of on) if (p.name !== 'Alex') sum += (await w.organizer.call('GET', `/api/admin/players/${w.byName[p.name]}/summary`)).data.month.spentCents;
    expect(sum).toBe((await month(w, '2026-11')).rework.collectedCents);
    // All time: every player's Spent adds up to every month's "Players paid".
    const all = on.filter((p: { name: string }) => p.name !== 'Alex').reduce((t: number, p: { spentCents: number }) => t + p.spentCents, 0);
    expect(all).toBe((await month(w, '2026-10')).rework.collectedCents + (await month(w, '2026-11')).rework.collectedCents);
    // The organizer: "So far" total itself, not clamped at $0.
    const alex = (await w.organizer.call('GET', `/api/admin/players/${w.byName.Alex}/summary`)).data;
    const nov = (await month(w, '2026-11')).rework;
    expect(alex.month.spentCents).toBe(nov.owedToVenueCents - nov.collectedCents);
  });

  it('on: a month where the players paid more than the venue was owed reads as a credit for the organizer (off: $0, as main)', async () => {
    const w = await group(['short-games-switch', 'late-fees', 'money-rework', 'admin-v2', 'admin-r2', 'admin-r3', 'players-redo-switch']);
    // Four 2 hour games in November, 4 paid $14 each and played, organizer out: $224 paid against $192 of courts + the $30 membership
    // = $222 owed, a $2 credit month.
    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      w.app.now = Date.parse('2026-11-09T17:00:00.000Z');
      const g = await addGame(w, day, 120);
      const four = ['Blair', 'Casey', 'Devon', 'Emery'];
      await joinAll(w, g.id, four);
      await pay(w, g.id, four);
      w.app.now = g.start + 3 * HOUR;
      await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    }
    const t = (await month(w, '2026-11')).rework;
    expect(t.owedToVenueCents - t.collectedCents).toBe(-200);
    const sum = async () => (await w.organizer.call('GET', `/api/admin/players/${w.byName.Alex}/summary`)).data.month.spentCents;
    expect(await sum()).toBe(0);
    await w.organizer.call('PUT', '/api/admin/spent-totals-switch', { on: true });
    expect(await sum()).toBe(-200);
  });
});

// ---------- Second Chance with Booking hours ON ----------

describe('Second Chance with Booking hours ON (the audit\'s untested pair)', () => {
  async function canceled() {
    const app = new TestApp();
    const w = await setupGroup(app);
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    for (const sw of ['second-chance-switch', 'booking-hours-switch']) expect((await w.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status).toBe(200);
    const s = (await dash(w)).sessions.find((x: { startsAt: string }) => x.startsAt === '2026-10-28T00:00:00.000Z'); // Tue Oct 27, 8:00 PM
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName.Blair, paid: true });
    w.app.now = Date.parse('2026-10-27T01:00:00Z'); // Mon 9:00 PM: canceled the night before
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    w.app.now = Date.parse('2026-10-27T16:00:00Z'); // Tue noon
    return { w, s };
  }
  const ON = { [SECOND_CHANCE.header]: 'on' };

  it('a reopen inside the venue hours works and the money follows the usual rules (Blair\'s $14 credit pays her seat to the cent)', async () => {
    const { w, s } = await canceled();
    expect(await pot(w, 'Blair')).toBe(1400);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'booking' }, ON)).status).toBe(200);
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'reopen', minutes: 20 * 60 }, ON);
    expect(r.status, r.text).toBe(200);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${s.id}/use-credit`, {})).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await seat(w, s.id, 'Blair'))).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect(health(w)).toEqual({});
  });

  it('a reopen time that would end after closing is refused, and no money moves (A-11, fixed in Zip 35: the game stays canceled)', async () => {
    const { w, s } = await canceled();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'booking' }, ON);
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'reopen', minutes: 21 * 60 + 30 }, ON);
    expect(r.status).toBe(400);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('A-11 (fixed in Zip 35): after that refusal the game is still canceled', async () => {
    const { w, s } = await canceled();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'booking' }, ON);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'reopen', minutes: 21 * 60 + 30 }, ON);
    expect((await game(w, s.id)).state.flags.canceled).toBe(true);
  });
});

// ---------- Every length, N = 1 to 10, organizer in and out ----------

describe('every length (1.5, 2, 2.5, 3 hr) for N = 1 to 10 played, organizer in and out: price, credit back, Money row and Totals agree', () => {
  const DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
  const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
  for (const minutes of [90, 120, 150, 180]) {
    for (const organizerIn of [false, true]) {
      it(`${minutes / 60} hr, organizer ${organizerIn ? 'in' : 'out'}`, async () => {
        const w = await group(['short-games-switch', 'late-fees', 'booking-hours-switch', 'money-rework']);
        const row = lengthRow(minutes)!;
        const flat = rowPrice(row, 4);
        const want = (n: number) => (minutes === 120 ? finalPrice(1400, n) : n < 4 ? flat : rowPrice(row, n));
        let collected = 0;
        for (let n = 1; n <= 10; n++) {
          w.app.now = Date.parse('2026-11-09T17:00:00.000Z');
          const g = await addGame(w, DAYS[n - 1], minutes);
          const payers = OTHERS.slice(0, organizerIn ? n - 1 : n);
          await joinAll(w, g.id, [...(organizerIn ? ['Alex'] : []), ...payers]);
          await pay(w, g.id, payers);
          for (const p of payers) expect((await seat(w, g.id, p)).paymentAmountCents).toBe(flat);
          const pots = Object.fromEntries(await Promise.all(payers.map(async (p) => [p, await pot(w, p)] as const)));
          w.app.now = g.start + minutes * 60_000 + HOUR;
          const fin = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
          expect(fin.status, fin.text).toBe(200);
          expect([n, fin.data.played, fin.data.priceCents]).toEqual([n, n, want(n)]);
          for (const p of payers) expect((await pot(w, p)) - pots[p], `${n} played, ${p}`).toBe(flat - want(n));
          const after = await game(w, g.id);
          expect(after.court.costCents).toBe(row.courtCents);
          expect(after.roster.filter((r: { owesCents: number }) => r.owesCents > 0)).toEqual([]);
          const mrow = (await month(w, '2026-11')).sessions.find((s: { startsAt: string }) => s.startsAt === new Date(g.start).toISOString());
          expect(mrow).toMatchObject({ state: 'played', playedCount: n, priceCents: want(n), courtCostCents: row.courtCents, collectedCents: payers.length * want(n) });
          collected += payers.length * want(n);
          expect(n * want(n)).toBeGreaterThanOrEqual(n < 4 ? 0 : row.courtCents); // 4 or more always cover the court
        }
        const t = (await month(w, '2026-11')).rework;
        expect(t.courtSessions).toBe(10);
        expect(t.courtCostCents).toBe(10 * row.courtCents);
        expect(t.collectedCents).toBe(collected);
        expect(t.yourCostCents).toBe(Math.max(0, t.owedToVenueCents - collected));
        expect(await pot(w, 'Alex')).toBe(0);
        expect(health(w)).toEqual({});
      });
    }
  }
});

