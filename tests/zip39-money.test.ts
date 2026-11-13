// Zip 39 (🎾39.moneyfix): known money edge cases.
//  1. MADE CHEAPER AFTER PAYING (switch CHEAPER_FIX, ships OFF): a game whose price went DOWN after a player paid (made shorter with Short
//     games on, Booking hours turned off on a 2.5 or 3 hour game) and then a late fee is kept on it (a late cancel with the fee kept, a late
//     drop that leaves the game short, a no-show at Finalize). The fee is the lower price now, so whatever the seat holds above it comes
//     back as credit, the mirror of Zip 27 A-02 (a game made pricier asks the gap). Finalize of a played seat and a Reopen and redo already
//     gave it back (checked here too, on and off).
//  2. DOUBLE FINALIZE: two Finalize taps at the very same moment (same clock to the millisecond, the worst case: the second batch's
//     "this batch finalized the game" check reads true) record and charge exactly what one Finalize does, in every Finalize branch.
//  3. A-18 (same switch): the "Price per player" setting lowered below the credit already on an unpaid seat pays that seat (and a raise
//     makes a credit-paid seat owe the rest), the way the Short games and Booking hours switches already reprice open games.
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHEAPER_FIX, cheaperFixAllowed } from '../shared/cheaperFix';
import { applyFinalize } from '../server/finalize';
import { makeCtx } from '../server/context';
import { getGroup, getSession } from '../server/repo';
import { withShortGames } from '../server/zip9';
import { HOUR, ORIGIN, playerPhone, setupGroup } from './harness';

vi.setConfig({ testTimeout: 120_000 });

const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

type W = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group(switches: string[] = ['short-games-switch', 'late-fees'], fix = true) {
  const w = await setupGroup();
  for (const name of MORE) await w.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${MORE.indexOf(name)}0` });
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const sw of [...switches, ...(fix ? ['cheaper-fix-switch'] : [])]) expect((await w.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status, sw).toBe(200);
  const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  w.byName = Object.fromEntries(d.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  w.app.now = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern
  return w;
}
const dash = async (w: W) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
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
const owedOf = async (w: W, name: string, id: string) => ((await (await phone(w, name)).call('GET', '/api/group')).data.owed.find((o: { sessionId: string }) => o.sessionId === id)?.amountCents ?? 0);
async function addGame(w: W, day: string, minutes: number): Promise<{ id: string; start: number }> {
  const startsAt = `${day}T22:00:00.000Z`;
  const res = await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(), note: null });
  expect(res.status, res.text).toBe(200);
  return { id: res.data.id, start: Date.parse(startsAt) };
}
async function joinAll(w: W, id: string, names: string[]) {
  for (const n of names) expect((await (await phone(w, n)).call('POST', `/api/sessions/${id}/join`, {})).status, n).toBe(200);
}
async function pay(w: W, id: string, names: string[]) {
  for (const n of names) expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName[n], paid: true })).status).toBe(200);
}
async function setLength(w: W, id: string, start: number, minutes: number) {
  const r = await w.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + minutes * 60_000).toISOString() });
  expect(r.status, r.text).toBe(200);
}
const lateCancel = async (w: W, id: string) =>
  expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
function health(w: W) {
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = (w.app.db as any).raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const collected = async (w: W, g: { start: number }) =>
  (await w.organizer.call('GET', '/api/admin/money?month=2026-11')).data.sessions.find((s: { startsAt: string }) => s.startsAt === new Date(g.start).toISOString()).collectedCents;
/** Every player's pot plus every Totals month's collected and held: nothing lost, nothing created, whatever the path. */
async function books(w: W) {
  const d = await dash(w);
  const pots = d.creditLedger.reduce((s: number, l: { balanceCents: number }) => s + l.balanceCents, 0);
  let kept = 0;
  for (const m of ['2026-10', '2026-11']) {
    const r = (await w.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
    kept += r.collectedCents + r.heldCents;
  }
  return { pots, kept, total: pots + kept };
}

// ---------- The switch ----------

describe('the switch "Made cheaper after paying" (CHEAPER_FIX, ships OFF)', () => {
  it('names, the kill switch (allowed unless "off"), the Settings row and the organizer-only private link', async () => {
    expect(CHEAPER_FIX).toMatchObject({ task: 'cheaper_fix_on', header: 'X-Cheaper-Fix', link: 'cheaperfix', env: 'CHEAPER_FIX' });
    expect([cheaperFixAllowed(undefined), cheaperFixAllowed('on'), cheaperFixAllowed(' OFF ')]).toEqual([true, true, false]);
    const w = await group(['short-games-switch', 'late-fees'], false);
    expect((await dash(w)).cheaperFixForAll).toBeUndefined();
    expect((await w.organizer.call('PUT', '/api/admin/cheaper-fix-switch', { on: true })).status).toBe(200);
    expect((await dash(w)).cheaperFixForAll).toBe(true);
    expect((await w.organizer.call('PUT', '/api/admin/cheaper-fix-switch', { on: false })).status).toBe(200);
    expect((await dash(w)).cheaperFixForAll).toBeUndefined();
    // A player can not turn it on: the route is the organizer's.
    expect((await (await phone(w, 'Blair')).call('PUT', '/api/admin/cheaper-fix-switch', { on: true })).status).toBe(401);
  });
});

// ---------- 1. Made cheaper after paying ----------

describe('1. a game made cheaper after people paid, then a late fee: the extra comes back as credit', () => {
  it('2 hr paid $14 cash, made 1.5 hr ($11), canceled 3 hours before, fee kept (no split): each keeps $11 on the game and gets $3 back; Totals counts $44; Clear gives the $11', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1400); // unchanged until a fee or Finalize (the documented rule)
    const before = await books(w);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    for (const n of four) {
      const r = await seat(w, g.id, n);
      expect([n, r.paymentStatus, r.paymentAmountCents, r.owesCents]).toEqual([n, 'paid', 1100, 0]);
      expect(await pot(w, n)).toBe(300);
    }
    expect(await collected(w, g)).toBe(4400);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
    // Clear one (venue waived): the $11 left on the seat comes back too, $14 in all.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
  });

  it('switch OFF: exactly as before (the $14 stays on the game, nothing back, Totals counts $56)', async () => {
    const w = await group(['short-games-switch', 'late-fees'], false);
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    for (const n of four) {
      const r = await seat(w, g.id, n);
      expect([r.paymentStatus, r.paymentAmountCents, r.owesCents]).toEqual(['paid', 1400, 0]);
      expect(await pot(w, n)).toBe(0);
    }
    expect(await collected(w, g)).toBe(5600);
    const raw = (w.app.db as any).raw;
    expect(raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get()).toEqual({ n: 0 });
  });

  it('with the fee split on: 4 in (no split) gets the $3 back; 6 in is split at $7 and the $7 above it comes back (as before)', async () => {
    for (const [count, back, kept] of [[4, 300, 1100], [6, 700, 700]] as const) {
      const w = await group(['short-games-switch', 'late-fees', 'late-fee-split']);
      const g = await addGame(w, '2026-11-10', 120);
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'].slice(0, count);
      await joinAll(w, g.id, names);
      await pay(w, g.id, names);
      await setLength(w, g.id, g.start, 90);
      w.app.now = g.start - 3 * HOUR;
      await lateCancel(w, g.id);
      for (const n of names) {
        const r = await seat(w, g.id, n);
        expect([count, n, r.paymentAmountCents, r.owesCents]).toEqual([count, n, kept, 0]);
        expect(await pot(w, n)).toBe(back);
      }
      expect(health(w)).toEqual({});
    }
  });

  it('a seat paid with $14 of credit: the late cancel gives $3 of it back to the pot and $11 stays on the seat', async () => {
    const w = await group();
    const old = await addGame(w, '2026-11-11', 120);
    await joinAll(w, old.id, ['Blair']);
    await pay(w, old.id, ['Blair']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${old.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1400);
    const g = await addGame(w, '2026-11-10', 120);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await seat(w, g.id, 'Blair')).creditCents).toBe(1400);
    await pay(w, g.id, ['Casey', 'Devon', 'Emery']);
    await setLength(w, g.id, g.start, 90);
    const before = await books(w);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    const r = await seat(w, g.id, 'Blair');
    expect([r.paymentStatus, r.paymentAmountCents, r.creditCents, r.owesCents]).toEqual(['paid', 1100, 1100, 0]);
    expect(await pot(w, 'Blair')).toBe(300);
    expect(await collected(w, g)).toBe(4400);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
  });

  it('a late drop that leaves the game short, on a seat paid $14 before the game was made 1.5 hours: $3 back now, $11 stays; a sub gives the $11 back', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    const before = await books(w);
    w.app.now = g.start - 3 * HOUR;
    const drop = await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(drop.status, drop.text).toBe(200);
    const r = await seat(w, g.id, 'Blair');
    expect([r.status, r.paymentStatus, r.paymentAmountCents, r.owesCents]).toEqual(['withdrawn', 'paid', 1100, 0]);
    expect(await pot(w, 'Blair')).toBe(300);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
    await joinAll(w, g.id, ['Frankie']); // a sub takes the spot: the debt clears and the $11 comes back
    expect((await seat(w, g.id, 'Blair')).owesCents).toBe(0);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('switch OFF: the late drop keeps the whole $14 on the game, as before', async () => {
    const w = await group(['short-games-switch', 'late-fees'], false);
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    expect((await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1400);
    expect(await pot(w, 'Blair')).toBe(0);
  });

  it('a no-show with 3 played, on a seat paid $14 before the game was made 1.5 hours: $3 back like the 3 who played; Totals $44; Reopen takes it back', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    const before = await books(w);
    w.app.now = g.start + 3 * HOUR;
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) });
    expect(fin.status, fin.text).toBe(200);
    for (const n of four) {
      expect((await seat(w, g.id, n)).owesCents, n).toBe(0);
      expect(await pot(w, n), n).toBe(300);
    }
    expect(await owedOf(w, 'Emery', g.id)).toBe(0);
    expect(await collected(w, g)).toBe(4400);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    for (const n of four) expect(await pot(w, n), n).toBe(0);
    expect((await books(w)).total).toBe(before.total);
    expect(health(w)).toEqual({});
  });

  it('switch OFF: the no-show keeps $14 on the game (the 3 who played get their $3 back, as before)', async () => {
    const w = await group(['short-games-switch', 'late-fees'], false);
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) })).status).toBe(200);
    expect([await pot(w, 'Blair'), await pot(w, 'Emery')]).toEqual([300, 0]);
    expect(await collected(w, g)).toBe(4 * 1100 + 300);
  });

  it('Booking hours turned off makes an open 2.5 hour game $14 again after people paid $18: a late cancel gives the $4 back', async () => {
    const w = await group(['short-games-switch', 'late-fees', 'booking-hours-switch']);
    const g = await addGame(w, '2026-11-10', 150);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    expect((await seat(w, g.id, 'Blair')).paymentAmountCents).toBe(1800);
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false })).status).toBe(200);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    for (const n of four) {
      expect((await seat(w, g.id, n)).paymentAmountCents).toBe(1400);
      expect(await pot(w, n)).toBe(400);
    }
    expect(health(w)).toEqual({});
  });

  it('already right on main, on or off: a PLAYED seat gets the extra back at Finalize, and a Reopen and redo with more players gives more back', async () => {
    for (const fix of [true, false]) {
      const w = await group(['short-games-switch', 'late-fees'], fix);
      const g = await addGame(w, '2026-11-10', 120);
      const four = ['Blair', 'Casey', 'Devon', 'Emery'];
      await joinAll(w, g.id, four);
      await pay(w, g.id, four);
      await setLength(w, g.id, g.start, 90);
      w.app.now = g.start + 3 * HOUR;
      expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
      for (const n of four) expect(await pot(w, n)).toBe(300); // 4 played a 1.5 hr game: $11
      expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
      for (const n of four) expect(await pot(w, n)).toBe(0);
      expect(health(w)).toEqual({});
    }
  });

  it('nothing moves for a normal game: a late cancel on a game paid at its own price leaves every seat and the ledger exactly as before', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon']);
    await pay(w, g.id, ['Blair', 'Casey', 'Devon']);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    for (const n of ['Blair', 'Casey', 'Devon']) expect([(await seat(w, g.id, n)).paymentStatus, (await seat(w, g.id, n)).paymentAmountCents]).toEqual(['paid', 1400]);
    const raw = (w.app.db as any).raw;
    expect(raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get()).toEqual({ n: 0 });
  });

  it('an unconfirmed "I paid" above the fee is a claim: nothing on it moves until Alex answers', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, ['Casey', 'Devon', 'Emery']);
    expect((await (await phone(w, 'Blair')).call("POST", `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    expect(await pot(w, 'Blair')).toBe(0);
    expect(await pot(w, 'Casey')).toBe(300);
    expect(health(w)).toEqual({});
  });
});

// ---------- 2. Double Finalize ----------

/** Every seat and every live credit entry, by name (ids differ between two worlds). */
async function moneyPicture(w: W, id: string) {
  const d = await dash(w);
  const names = new Map(Object.entries(w.byName).map(([n, pid]) => [pid as string, n]));
  const s = d.sessions.find((x: { id: string }) => x.id === id);
  const seats = s.roster.map((r: any) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents, r.owesCents, r.creditCents]).sort();
  const pots = d.creditLedger.map((l: any) => [names.get(l.playerId), l.balanceCents]).sort();
  const raw = (w.app.db as any).raw;
  const rows = raw.prepare('SELECT player_id, kind, amount_cents, reason, ended_at IS NULL AS live FROM credit_ledger WHERE session_id = ?').all(id);
  const ledger = rows.map((r: any) => [names.get(r.player_id), r.kind, r.amount_cents, r.reason, r.live]).sort();
  const audits = raw.prepare("SELECT action, COUNT(*) AS n FROM admin_audit_log WHERE session_id = ? AND action IN ('session_finalized', 'credit_back', 'late_fee_owed') GROUP BY action ORDER BY action").all(id);
  const locks = raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE session_id = ? AND task = 'price_lock'").get(id);
  return { seats, pots, ledger, audits, locks, price: s.finalPriceCents ?? null, money: await w.organizer.call('GET', '/api/admin/money?month=2026-11').then((r) => [r.data.collectedCents, r.data.heldCents]) };
}

describe('2. double Finalize: two taps at the same millisecond record and charge exactly what one does', () => {
  // Every Finalize branch at once: cash above the price (part back), cash below it (held, owes the rest: the game was made pricier),
  // credit used on an unpaid seat that covers more than the price, a paid seat that did not play (all back), and, with fewer than 4
  // played and Late drops on, a no-show who owes.
  const scene = async (fewer: boolean, fix: boolean) => {
    const w = await group(['short-games-switch', 'late-fees'], fix);
    const old = await addGame(w, '2026-11-11', 120);
    await joinAll(w, old.id, ['Gale']);
    await pay(w, old.id, ['Gale']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${old.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    const g = await addGame(w, '2026-11-10', 90);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
    await pay(w, g.id, ['Blair', 'Casey', 'Devon']); // $11 each, then the game is made 2 hours ($14)
    await setLength(w, g.id, g.start, 120);
    await pay(w, g.id, ['Emery']); // $14
    w.app.now = g.start + 3 * HOUR;
    const played = fewer ? ['Blair', 'Gale', 'Emery'] : ['Blair', 'Casey', 'Gale', 'Emery', 'Frankie'];
    return { w, g, body: { played: played.map((n) => w.byName[n]) } };
  };
  for (const [fewer, fix] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    it(`${fewer ? '3 played (a no-show owes)' : '5 played of 6'}, switch ${fix ? 'on' : 'off'}: the twin world finalized once and the world tapped three times at once are identical`, async () => {
      const once = await scene(fewer, fix);
      expect((await once.w.organizer.call('POST', `/api/admin/sessions/${once.g.id}/finalize`, once.body)).status).toBe(200);
      const twice = await scene(fewer, fix);
      const tap = () => twice.w.organizer.call('POST', `/api/admin/sessions/${twice.g.id}/finalize`, twice.body);
      const res = await Promise.all([tap(), tap(), tap()]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(res.filter((r) => r.status === 409).every((r) => r.data.error === 'already_finalized')).toBe(true);
      expect(await moneyPicture(twice.w, twice.g.id)).toEqual(await moneyPicture(once.w, once.g.id));
      expect(health(twice.w)).toEqual({});
      // And a late tap after it went in (a slow phone): refused, nothing moves.
      const after = await moneyPicture(twice.w, twice.g.id);
      expect((await tap()).status).toBe(409);
      expect(await moneyPicture(twice.w, twice.g.id)).toEqual(after);
    });
  }
  for (const [fewer, fix] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    it(`the worst case, ${fewer ? '3 played' : '5 played'}, switch ${fix ? 'on' : 'off'}: the whole Finalize step run a second time from the same old read at the same millisecond moves nothing`, async () => {
      // Both "phones" read the game before either wrote: the second one's batch is built from a game that, by the time it runs, the
      // first already finalized at the very same time stamp, so its "this batch finalized the game" check reads TRUE. Every money
      // statement must still find nothing left to do.
      const once = await scene(fewer, fix);
      expect((await once.w.organizer.call('POST', `/api/admin/sessions/${once.g.id}/finalize`, once.body)).status).toBe(200);
      const twice = await scene(fewer, fix);
      const ctx = () => makeCtx(new Request(`${ORIGIN}/api/admin/sessions/${twice.g.id}/finalize`, { method: 'POST' }), twice.w.app.env, twice.w.app.now);
      const c1 = ctx();
      const group = await withShortGames(c1, (await getGroup(c1.db))!);
      const stale = (await getSession(c1.db, group.id, twice.g.id))!;
      const played = new Set<string>(twice.body.played);
      await applyFinalize(c1, group, stale, played, true, null, fix);
      await expect(applyFinalize(ctx(), group, stale, played, true, null, fix)).rejects.toMatchObject({ status: 409, code: 'already_finalized' });
      expect(await moneyPicture(twice.w, twice.g.id)).toEqual(await moneyPicture(once.w, once.g.id));
      expect(health(twice.w)).toEqual({});
    });
  }
});

// ---------- 3. A-18 ----------

describe('3. A-18: the price setting changed while credit sits on an open seat', () => {
  // Gale has $7 of credit (8 played a $14 game: $7 each, $7 back), joins the next game: $7 credit used, owes $7.
  const scene = async (fix: boolean) => {
    const w = await group(['short-games-switch', 'late-fees'], fix);
    const first = await addGame(w, '2026-11-10', 120);
    const eight = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy'];
    await joinAll(w, first.id, eight);
    await pay(w, first.id, eight);
    w.app.now = first.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${first.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(await pot(w, 'Gale')).toBe(700);
    const g = await addGame(w, '2026-11-12', 120);
    await joinAll(w, g.id, ['Gale']);
    expect([(await seat(w, g.id, 'Gale')).paymentStatus, (await seat(w, g.id, 'Gale')).owesCents]).toEqual(['unpaid', 700]);
    return { w, g };
  };
  const setPrice = async (w: W, cents: number) => expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: cents } })).status).toBe(200);

  it('lowered to $6: the seat is paid with the $7 on it (the $1 above comes back at Finalize); raised to $16: it owes $9 again', async () => {
    const { w, g } = await scene(true);
    await setPrice(w, 600);
    let r = await seat(w, g.id, 'Gale');
    expect([r.paymentStatus, r.paymentAmountCents, r.owesCents]).toEqual(['paid', 700, 0]);
    expect(await owedOf(w, 'Gale', g.id)).toBe(0);
    expect(health(w)).toEqual({});
    await setPrice(w, 1600);
    r = await seat(w, g.id, 'Gale');
    expect([r.paymentStatus, r.owesCents, r.creditCents]).toEqual(['unpaid', 900, 700]);
    expect(health(w)).toEqual({});
    await setPrice(w, 600);
    w.app.now = g.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(await pot(w, 'Gale')).toBe(100); // 1 played: the $6 price; $1 of the $7 comes back
    expect(health(w)).toEqual({});
  });

  it('switch OFF: as before, the seat stays unpaid with $7 of credit on a $6 seat', async () => {
    const { w, g } = await scene(false);
    await setPrice(w, 600);
    const r = await seat(w, g.id, 'Gale');
    expect([r.paymentStatus, r.creditCents]).toEqual(['unpaid', 700]);
  });

  it('a finalized game is never touched by the price change (Zip 27 lock), and a 1.5 hour game keeps its own price', async () => {
    const { w, g } = await scene(true);
    const short = await addGame(w, '2026-11-13', 90);
    await joinAll(w, short.id, ['Harper']);
    const harperBefore = await seat(w, short.id, 'Harper');
    const raw = (w.app.db as any).raw;
    const firstGame = raw.prepare("SELECT final_price_cents AS p FROM sessions WHERE finalized_at IS NOT NULL").all();
    await setPrice(w, 600);
    expect(raw.prepare("SELECT final_price_cents AS p FROM sessions WHERE finalized_at IS NOT NULL").all()).toEqual(firstGame);
    expect(await seat(w, short.id, 'Harper')).toEqual(harperBefore);
    expect((await seat(w, g.id, 'Gale')).paymentStatus).toBe('paid');
  });
});
