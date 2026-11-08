// "Money page rework" (MONEY_REWORK, Nov 2026): the switch, the two Totals cards' numbers, "Hide from list" (it must never lose data),
// "Edit charge" on a canceled game, and the cancel sheet accepting "Were you charged?" at any time. The screens are checked in
// e2e/money-rework.cjs. Admin only: nothing saved, charged or sent to a player may depend on it, and OFF must be exactly as before.
import { COURT, comingUnbooked, PLAYERS, YOURS } from './projectedZip13';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER, moneyReworkAllowed } from '../shared/moneyRework';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const on = { [MONEY_REWORK_HEADER]: 'on' };

async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
async function money(w: W, month: string, headers: Record<string, string> = on) {
  const r = await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, headers);
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const books = (w: W) =>
  JSON.stringify([
    w.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all(),
    w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(),
    w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all(),
  ]);
const call = (w: W, method: string, path: string, body?: unknown, headers: Record<string, string> = on) => w.organizer.call(method, path, body, headers);

/** Book a game, put these players in (organizer too when asked), and mark the named ones paid. */
async function fill(w: W, game: { id: string }, names: string[], paid: string[], organizerIn = false) {
  await w.organizer.call('POST', `/api/admin/sessions/${game.id}/booked`, {});
  for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${game.id}/join`, {});
  if (organizerIn) await w.organizer.call('POST', `/api/admin/sessions/${game.id}/me`, { in: true });
  const sv = (await dash(w)).sessions.find((s: any) => s.id === game.id);
  for (const n of paid) {
    const r = sv.roster.find((x: any) => x.name === n);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${game.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(res.status, res.text).toBe(200);
  }
}
const upcoming = async (w: W) => (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);

/** One played, finalized game: Blair, Casey, Devon paid, Emery owes, organizer in: five played, $11 each. Court is the typical $48. */
async function playedGame() {
  const w = await world();
  const s0 = await firstSession(w);
  await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon'], true);
  w.app.now = Date.parse(s0.endsAt) + HOUR;
  const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
  expect(fin.status, fin.text).toBe(200);
  return { w, s0, month: monthOf(Date.parse(s0.startsAt)) };
}

describe('MONEY_REWORK switch', () => {
  it('S1 the var is allowed unless it says off', () => {
    expect(moneyReworkAllowed(undefined)).toBe(true);
    expect(moneyReworkAllowed('on')).toBe(true);
    expect(moneyReworkAllowed(' OFF ')).toBe(false);
  });
  it('S2 ship state: off for everyone, nothing new in the dashboard or the month', async () => {
    const { w, month } = await playedGame();
    const d = await dash(w);
    expect(d.moneyRework).toBe(false);
    expect(d.moneyReworkForAll).toBe(false);
    expect(d.hiddenGames).toBeUndefined();
    expect(d.sessions.every((s: any) => s.hiddenFromList === undefined)).toBe(true);
    expect((await money(w, month, {})).rework).toBeUndefined();
  });
  it('S3 the private header turns it on for that request only', async () => {
    const { w } = await playedGame();
    expect((await dash(w, on)).moneyRework).toBe(true);
    expect((await dash(w, { [MONEY_REWORK_HEADER]: 'yes' })).moneyRework).toBe(false);
    expect((await dash(w)).moneyRework).toBe(false);
  });
  it('S4 the Settings switch turns it on for everyone, and off again, no deploy', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(200);
    let d = await dash(w);
    expect(d.moneyRework).toBe(true);
    expect(d.moneyReworkForAll).toBe(true);
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'money_rework_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/money-rework', { on: false })).status).toBe(200);
    d = await dash(w);
    expect(d.moneyRework).toBe(false);
    expect(d.moneyReworkForAll).toBe(false);
  });
  it('S5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ MONEY_REWORK: 'off' });
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: true });
    expect((await dash(w, on)).moneyRework).toBe(false);
    expect((await dash(w)).moneyRework).toBe(false);
  });
  it('S6 the change shows in Activity, and only the organizer can flip it', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: true });
    const act = await w.organizer.call('GET', '/api/admin/activity');
    expect(act.data.entries.some((e: { action: string }) => e.action === 'money_rework_on')).toBe(true);
    expect((await w.app.client().call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(401);
  });
  it('S7 no migration was added for it', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.at(-1)).toBe('0017_court.sql'); // Zip 14 added 0017 (the court column); this feature itself still adds none
  });
  it('S8 with it off, the new endpoints refuse and the old numbers are untouched', async () => {
    const { w, s0, month } = await playedGame();
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true }, {})).status).toBe(409);
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true }, {})).status).toBe(409);
    const m = await money(w, month, {});
    expect(m.courtCostCents).toBe(4800);
    expect(m.collectedCents).toBe(3300);
  });
});

describe('Totals: real numbers only', () => {
  it('T1 so far: court $48 for the played game, membership $30, collected from players, your cost the rest', async () => {
    const { w, month } = await playedGame();
    const t = (await money(w, month)).rework;
    // Five played at $11: Blair, Casey and Devon paid $11 each (their $14 less $3 back); Emery never paid (owes, not collected).
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800, membershipCents: 3000, owedToVenueCents: 7800, collectedCents: 3300, yourCostCents: 4500, yourCostCourtCents: 1500, yourCostMembershipCents: 3000 });
    expect(t.yourCostCourtCents + t.yourCostMembershipCents).toBe(t.yourCostCents);
  });
  it('T2 the old numbers on the same page are exactly what they were (rework only adds a block)', async () => {
    const { w, month } = await playedGame();
    const a = await money(w, month, {});
    const { rework, ...b } = await money(w, month);
    expect(rework).toBeDefined();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('T3 projected adds booked games still coming and assumes 3 players pay $14 for EVERY court: each court costs the organizer $6', async () => {
    const { w, s0, month } = await playedGame();
    const next = (await upcoming(w)).find((s: any) => monthOf(Date.parse(s.startsAt)) === month && s.id !== s0.id);
    expect(next).toBeDefined();
    await fill(w, next, ['Blair', 'Casey', 'Emery'], []);
    const t = (await money(w, month)).rework;
    // Two courts: the venue total is unchanged (2 x $48 + $30), the players pay 3 x $14 x 2 = $84, so the organizer's estimate is $30 + $6 x 2.
    expect(t.projected).toMatchObject({ courtCount: 2, addedCourts: 1, courtCostCents: 9600, membershipCents: 3000, totalCents: 12600, playersPayCents: 8400, yourCostCents: 4200, yourCostCourtCents: 1200, yourCostMembershipCents: 3000 });
    // "So far" did not move: the coming game is not finalized.
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 3300 });
  });
  it('T4 the projection does not depend on who is in: 3 x $14 a court whether 3, 4 or 5 are signed up', async () => {
    const { w, s0, month } = await playedGame();
    const next = (await upcoming(w)).find((s: any) => monthOf(Date.parse(s.startsAt)) === month && s.id !== s0.id)!;
    await fill(w, next, ['Blair', 'Casey', 'Devon', 'Emery'], [], true);
    expect((await money(w, month)).rework.projected).toMatchObject({ addedCourts: 1, playersPayCents: 8400, yourCostCents: 4200 });
  });
  it('T5 (Zip 13) a coming game with no court booked counts in Projected as if it will be played', async () => {
    const { w, s0, month } = await playedGame();
    const next = (await upcoming(w)).find((s: any) => monthOf(Date.parse(s.startsAt)) === month && s.id !== s0.id)!;
    for (const n of ['Blair', 'Casey', 'Emery']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${next.id}/join`, {});
    // Before Zip 13 it added nothing; now it is one more court, the same as a booked one (and so is any other game still to come).
    const x = await comingUnbooked(w.organizer, month, [s0.id, next.id]);
    expect((await money(w, month)).rework.projected).toMatchObject({ addedCourts: 1 + x, courtCostCents: 9600 + x * COURT, playersPayCents: 8400 + x * PLAYERS });
    // Canceled: out again.
    const c = await w.organizer.call('POST', `/api/admin/sessions/${next.id}/decision`, { decision: 'cancel', confirm: true }, on);
    expect(c.status, c.text).toBe(200);
    expect((await money(w, month)).rework.projected).toMatchObject({ addedCourts: x, courtCostCents: 4800 + x * COURT });
  });
  it('T6 players covering more than the courts: your cost never goes below $0 and the parts still add up', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    // Five paid $14 + organizer in: price $9 ($5 back each): collected 5 x $9 = $45; still under the court. Use the flat 4: 4 x $14 = $56 > $48.
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    expect(t.collectedCents).toBe(5600);
    // Court $48 + membership $30 = $78 owed; players paid $56; surplus $8 goes toward the membership.
    expect(t).toMatchObject({ owedToVenueCents: 7800, yourCostCents: 2200, yourCostCourtCents: 0, yourCostMembershipCents: 2200 });
    for (const v of [t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.yourCostCents, t.collectedCents]) expect(v).toBeGreaterThanOrEqual(0);
  });
  it('T7 a month with no games has no membership unless it is the current month', async () => {
    const { w } = await playedGame();
    expect((await money(w, '2026-05')).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0, membershipCents: 0, owedToVenueCents: 0, yourCostCents: 0 });
    const cur = (await money(w, monthOf(w.app.now))).rework;
    expect(cur.membershipCents).toBe(3000);
  });
});

describe('Canceled games count only if the venue charged', () => {
  async function canceledGame(chargedCents?: number, hoursBefore = 6) {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey'], ['Blair']);
    w.app.now = Date.parse(s0.startsAt) - hoursBefore * HOUR;
    const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, ...(chargedCents ? { chargedCents } : {}) }, on);
    expect(res.status, res.text).toBe(200);
    return { w, s0, month: monthOf(Date.parse(s0.startsAt)) };
  }
  it('C1 charged: the amount is the court cost and counts; the credit that went back is not collected', async () => {
    const { w, month } = await canceledGame(4800);
    const t = (await money(w, month)).rework;
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 0 });
  });
  it('C2 not charged: counts for nothing', async () => {
    const { w, month } = await canceledGame();
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0 });
  });
  it('C3 Edit charge: Yes counts the usual court cost, No takes it away, and no seat or credit moves', async () => {
    const { w, s0, month } = await canceledGame();
    await dash(w); // the dashboard adds the coming games the clock has reached: take the picture after that
    const before = books(w);
    let r = await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true });
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ changed: true, chargedCents: 4800 });
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
    expect((await dash(w, on)).sessions.find((s: any) => s.id === s0.id).chargedCents).toBe(4800);
    r = await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false });
    expect(r.data).toMatchObject({ changed: true, chargedCents: 0 });
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0 });
    expect(books(w)).toBe(before);
  });
  it('C4 Edit charge with an amount, a repeat is a no-op, and it is in Activity', async () => {
    const { w, s0, month } = await canceledGame();
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 2500 });
    expect((await money(w, month)).rework).toMatchObject({ courtCostCents: 2500 });
    const again = await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 2500 });
    expect(again.data.changed).toBe(false);
    const act = await w.organizer.call('GET', '/api/admin/activity');
    expect(act.data.entries.filter((e: { action: string }) => e.action === 'charge_edited')).toHaveLength(1);
  });
  it('C5 Edit charge is only for a canceled game', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const r = await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('not_canceled');
  });
  it('C6 reopening and canceling again starts the charge over from that cancel', async () => {
    const { w, s0, month } = await canceledGame(4800);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'reopen' }, on);
    w.app.now = Date.parse(s0.startsAt) - 5 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true }, on);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0 });
  });
  it('C7 the cancel sheet may answer "Were you charged?" more than 12 hours out, with the switch on only', async () => {
    const on1 = await canceledGame(4800, 30);
    expect((await money(on1.w, on1.month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
    // Off: the amount is ignored outside the 12 hours, exactly as before.
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair'], []);
    w.app.now = Date.parse(s0.startsAt) - 30 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, chargedCents: 4800 });
    expect((await money(w, monthOf(Date.parse(s0.startsAt)), {})).courtCostCents).toBe(0);
  });
});

describe('Hide from list: only a game with no money in it, and it never loses data', () => {
  /** Every number on the month (not the list of games under it): Totals are "identical" when these are. */
  const numbers = (m: { sessions?: unknown }) => JSON.stringify({ ...m, sessions: undefined });
  /** An empty, not-booked coming game: nobody in, no court, no money. */
  const emptyGame = async (w: W) => (await upcoming(w)).find((s: any) => s.confirmedCount === 0 && s.bookingStatus !== 'booked')!;
  const hide = (w: W, id: string, hidden = true) => call(w, 'POST', `/api/admin/sessions/${id}/hide-from-list`, { hidden });
  /** A coming game canceled early with these players (who paid) and nothing else. */
  async function canceledGame(players: string[], paid: string[], chargedCents?: number, hoursBefore = 30) {
    const w = await world();
    const s0 = await firstSession(w);
    if (players.length) await fill(w, s0, players, paid);
    w.app.now = Date.parse(s0.startsAt) - hoursBefore * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, ...(chargedCents ? { chargedCents } : {}) }, on);
    return { w, s0, month: monthOf(Date.parse(s0.startsAt)) };
  }
  const blocked = async (w: W, id: string) => {
    const r = await hide(w, id);
    expect(r.status, r.text).toBe(409);
    expect(r.data.error).toBe('has_money');
    expect(r.data.message).toBe('This game has money in it, so it stays in Money.');
    expect((await dash(w, on)).sessions.find((s: any) => s.id === id).hiddenFromList).toBeUndefined();
  };

  it('H1 a no-money game (canceled early, nobody in) hides and restores; only a flag moves and Totals are identical before, while hidden, and after', async () => {
    const { w, s0, month } = await canceledGame([], []);
    await dash(w); // the dashboard adds the coming games the clock has reached: take the picture after that
    const before = books(w);
    const totals = async () => numbers(await money(w, month));
    const t0 = await totals();
    const r = await hide(w, s0.id);
    expect(r.data).toMatchObject({ ok: true, changed: true, hidden: true });
    expect(books(w)).toBe(before);
    const d = await dash(w, on);
    expect(d.sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBe(true);
    expect(d.hiddenGames.map((h: any) => h.id)).toEqual([s0.id]);
    expect(await totals()).toBe(t0); // no money in it, so Totals are the same
    expect((await hide(w, s0.id, false)).data.changed).toBe(true);
    expect(books(w)).toBe(before);
    expect(await totals()).toBe(t0);
    expect((await dash(w, on)).hiddenGames).toEqual([]);
  });
  it('H2 blocked when anyone paid', async () => {
    const { w, s0 } = await canceledGame(['Blair'], ['Blair']); // paid, then canceled: it came back as credit, so a payment AND credit
    await blocked(w, s0.id);
    const w2 = await world();
    const g = (await upcoming(w2))[0];
    await fill(w2, g, ['Blair'], ['Blair']);
    await blocked(w2, g.id);
  });
  it('H3 blocked when anyone holds credit from the game, or used credit on it', async () => {
    const { w, s0 } = await canceledGame(['Blair', 'Casey'], ['Blair']);
    await blocked(w, s0.id);
    // A game canceled where nobody paid: no credit exists, so it can be hidden.
    const free = await canceledGame(['Blair', 'Casey'], []);
    expect((await hide(free.w, free.s0.id)).status).toBe(200); // canceled early, nobody paid: nothing owed, no credit, no charge
  });
  it('H4 blocked when anyone owes: a seat in a game that is on owes $14', async () => {
    const w = await world();
    const g = (await upcoming(w))[1];
    await (await playerPhone(w, 'Casey')).call('POST', `/api/sessions/${g.id}/join`, {});
    await blocked(w, g.id);
  });
  it('H5 blocked when a court is booked (the court is money), even with nobody in', async () => {
    const w = await world();
    const g = (await upcoming(w))[2];
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    await blocked(w, g.id);
  });
  it('H6 blocked when the venue charged a canceled game; allowed once Edit charge makes the charge $0', async () => {
    const { w, s0, month } = await canceledGame([], [], 4800);
    await blocked(w, s0.id);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
    // A test game after Edit charge sets it to $0: now there is no money in it.
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false })).status).toBe(200);
    const before = numbers(await money(w, month));
    expect((await hide(w, s0.id)).status).toBe(200);
    expect(numbers(await money(w, month))).toBe(before);
    expect((await dash(w, on)).hiddenGames.map((h: any) => h.id)).toEqual([s0.id]);
  });
  it('H7 blocked when a late fee is owed (canceled late, venue kept the fee) and when the game was finalized', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], []);
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
    expect(c.status, c.text).toBe(200);
    await blocked(w, s0.id);
    const { w: pw, s0: played } = await playedGame();
    await blocked(pw, played.id);
  });
  it('H8 a game marked hidden that gains money is shown again, in the lists and in Totals (money is never hidden)', async () => {
    const w = await world();
    const g = await emptyGame(w);
    const month = monthOf(Date.parse(g.startsAt));
    expect((await hide(w, g.id)).status).toBe(200);
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    const ph = await playerPhone(w, 'Blair');
    await ph.call('POST', `/api/sessions/${g.id}/join`, {});
    const d = await dash(w, on);
    expect(d.sessions.find((s: any) => s.id === g.id).hiddenFromList).toBeUndefined();
    expect(d.hiddenGames).toEqual([]);
// (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    expect((await money(w, month)).rework.projected.addedCourts).toBe(1 + (await comingUnbooked(w.organizer, month, [g.id])));
  });
  it('H9 a second hide is a no-op (one row per game), and the log says who hid what', async () => {
    const w = await world();
    const g = await emptyGame(w);
    await hide(w, g.id);
    expect((await hide(w, g.id)).data.changed).toBe(false);
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'admin_hidden_game'").first<{ n: number }>())?.n).toBe(1);
    await hide(w, g.id, false);
    const acts = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: { action: string }) => e.action);
    expect(acts).toContain('session_hidden_from_list');
    expect(acts).toContain('session_shown_in_list');
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    expect((await anon.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden: true }, on)).status).toBe(401);
  });
  it('H10 hiding is admin side only: players still see the game, and with the switch off it is a normal game again', async () => {
    const w = await world();
    const g = await emptyGame(w);
    await hide(w, g.id);
    const view = await (await playerPhone(w, 'Blair')).call('GET', '/api/group');
    expect(JSON.stringify(view.data)).toContain(g.id);
    expect((await dash(w, {})).sessions.find((s: any) => s.id === g.id).hiddenFromList).toBeUndefined();
  });
  it('H11 the player-side hide (Remove from player screen) and the admin-side hide are two separate marks: neither undoes the other', async () => {
    const { w, s0 } = await canceledGame([], []);
    await w.organizer.call('PUT', '/api/admin/admin-v2', { on: true });
    const flags = async () => {
      const sv = (await dash(w, on)).sessions.find((s: any) => s.id === s0.id);
      return { player: sv.hiddenFromPlayers, list: sv.hiddenFromList };
    };
    const marks = () => w.app.db.raw.prepare("SELECT task FROM task_log WHERE session_id = ? ORDER BY task").all(s0.id).map((r: any) => r.task);
    // Players first, then the lists.
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide`, { hidden: true })).status).toBe(200);
    expect(await flags()).toEqual({ player: true, list: undefined });
    expect((await hide(w, s0.id)).status).toBe(200);
    expect(await flags()).toEqual({ player: true, list: true });
    expect(marks()).toEqual(['admin_hidden_game', 'hidden_from_players']);
    // Restoring the lists leaves the player-side hide alone.
    await hide(w, s0.id, false);
    expect(await flags()).toEqual({ player: true, list: undefined });
    // And the other way round: hide the lists, show to players again, the list hide stays.
    await hide(w, s0.id);
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide`, { hidden: false });
    expect(await flags()).toEqual({ player: false, list: true });
  });
});

describe('Top card: a game counts only once it is finalized; projected: $6 a court', () => {
  const dollars = (t: any) => ({ courts: t.courtSessions, court: t.courtCostCents, collected: t.collectedCents, owed: t.owedToVenueCents, yours: t.yourCostCents });
  it('N1 a game that was played but not finalized adds NOTHING to the top card; finalizing it adds the court and the fees at that moment', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR; // over, everyone paid, not finalized
    const month = monthOf(Date.parse(s0.startsAt));
    const before = (await money(w, month)).rework;
    expect(dollars(before)).toEqual({ courts: 0, court: 0, collected: 0, owed: 3000, yours: 3000 }); // only the monthly membership
    // It is in the projection, as one court.
    // (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, month, [s0.id]);
    expect(before.projected).toMatchObject({ courtCount: 1 + x, addedCourts: 1 + x, courtCostCents: 4800 + x * COURT, playersPayCents: 4200 + x * PLAYERS });
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    const after = (await money(w, month)).rework;
    expect(dollars(after)).toEqual({ courts: 1, court: 4800, collected: 5600, owed: 7800, yours: 2200 });
    // The projection did not double count it: still one court.
    expect(after.projected).toMatchObject({ courtCount: 1 + x, addedCourts: x, courtCostCents: 4800 + x * COURT });
  });
  it('N2 a game still to come adds nothing to the top card, even with payments on it', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey', 'Devon']);
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    expect(dollars(t)).toEqual({ courts: 0, court: 0, collected: 0, owed: t.membershipCents, yours: t.membershipCents });
// (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, monthOf(Date.parse(s0.startsAt)), [s0.id]);
    expect(t.projected).toMatchObject({ courtCount: 1 + x, addedCourts: 1 + x });
  });
  it('N3 three courts (one finalized, one played not finalized, one coming): players pay 3 x $14 x 3 = $126, estimate = $30 + $6 x 3 = $48', async () => {
    const w = await world();
    // Three games of the same month (November): the first two get played, the third is still coming.
    const [a, b, c] = (await upcoming(w)).filter((g: any) => monthOf(Date.parse(g.startsAt)) === '2026-11').slice(0, 3);
    const month = '2026-11';
    await fill(w, a, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    await fill(w, b, ['Blair', 'Casey', 'Devon'], []);
    await fill(w, c, ['Blair'], []);
    w.app.now = Date.parse(b.endsAt) + HOUR; // a and b are over
    expect((await w.organizer.call('POST', `/api/admin/sessions/${a.id}/finalize`, { everyone: true })).status).toBe(200);
    const t = (await money(w, month)).rework;
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800 }); // top card: only the finalized game
// (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, month, [a.id, b.id, c.id]);
    expect(t.projected).toMatchObject({ courtCount: 3 + x, courtCostCents: 14400 + x * COURT, totalCents: 17400 + x * COURT, playersPayCents: 12600 + x * PLAYERS, yourCostCents: 4800 + x * YOURS, yourCostCourtCents: 1800 + x * YOURS, yourCostMembershipCents: 3000 });
  });
  it('N4 a court that costs less than the $42 the 3 players pay never makes the estimate go below the membership or negative', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair'], []);
    await w.organizer.call('PUT', `/api/admin/sessions/${s0.id}/booking`, { courtCostCents: 3000 });
    const month = monthOf(Date.parse(s0.startsAt));
    const t = (await money(w, month)).rework;
    if (t.projected.courtCostCents === 3000) expect(t.projected).toMatchObject({ playersPayCents: 4200, yourCostCents: 3000, yourCostCourtCents: 0 });
    for (const v of [t.projected.yourCostCents, t.projected.yourCostCourtCents, t.projected.yourCostMembershipCents]) expect(v).toBeGreaterThanOrEqual(0);
  });
  it('N5 a canceled game the venue charged counts as a court in the top card (it is settled when canceled); with Edit charge on No it does not', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey'], []);
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, chargedCents: 4800 }, on);
    const month = monthOf(Date.parse(s0.startsAt));
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false }, on);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0 });
  });
});
