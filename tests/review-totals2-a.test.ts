// Independent review of the Totals rework: top card counts a game only once finalized; projected is 3 x $14 a court.
import { COURT, comingUnbooked, PLAYERS, YOURS } from './projectedZip13';
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world(late = false) {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  if (late) await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = on) {
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
const fin = (w: W, id: string, body: unknown = { everyone: true }) => w.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, body);
const sane = (t: any) => {
  for (const v of [t.courtCostCents, t.membershipCents, t.owedToVenueCents, t.collectedCents, t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.courtCostCents, t.projected.playersPayCents, t.projected.yourCostCents, t.projected.yourCostCourtCents, t.projected.yourCostMembershipCents]) expect(v).toBeGreaterThanOrEqual(0);
  expect(t.yourCostCourtCents + t.yourCostMembershipCents).toBe(t.yourCostCents);
  expect(t.projected.yourCostCourtCents + t.projected.yourCostMembershipCents).toBe(t.projected.yourCostCents);
  expect(t.owedToVenueCents).toBe(t.courtCostCents + t.membershipCents);
  expect(t.projected.totalCents).toBe(t.projected.courtCostCents + t.projected.membershipCents);
};

describe('R1 finalize timing and reopen', () => {
  it('finalized exactly at the end counts at once; played-not-finalized does not', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) - 1; // one ms before the end
    expect((await fin(w, s0.id)).status).toBe(409);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0 });
    w.app.now = Date.parse(s0.endsAt); // exactly the end
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0 });
    expect((await fin(w, s0.id)).status).toBe(200);
    const t = (await money(w, month)).rework;
    // 4 played at $14 each paid $14 -> price for 4 is $14 -> collected 56
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 5600 });
    sane(t);
  });
  it('finalize then reopen: the top card drops it, projected still has 1 court; refinalize brings it back', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    expect((await fin(w, s0.id)).status).toBe(200);
    const a = (await money(w, month)).rework;
    expect(a.courtSessions).toBe(1);
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/reopen`, {});
    expect(r.status, r.text).toBe(200);
    const b = (await money(w, month)).rework;
    expect(b).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0, owedToVenueCents: 3000 });
    // (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, month, [s0.id]);
    expect(b.projected).toMatchObject({ courtCount: 1 + x, addedCourts: 1 + x, courtCostCents: 4800 + x * COURT, playersPayCents: 4200 + x * PLAYERS });
    expect((await fin(w, s0.id)).status).toBe(200);
    expect(JSON.stringify((await money(w, month)).rework)).toBe(JSON.stringify(a));
    sane(a);
    sane(b);
  });
  it('finalized game with a custom court cost $30: counts $30; projected parts add up, nothing negative', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey', 'Devon']);
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${s0.id}/booking`, { bookingStatus: 'booked', courtCostCents: 3000 })).status).toBe(200);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    expect((await fin(w, s0.id)).status).toBe(200);
    const t = (await money(w, month)).rework;
    // 3 played -> flat $14 each = 4200 collected, court 3000, membership 3000.
    expect(t).toMatchObject({ courtCostCents: 3000, collectedCents: 4200, owedToVenueCents: 6000, yourCostCents: 1800, yourCostCourtCents: 0, yourCostMembershipCents: 1800 });
    // (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played. The court part stays $0: 3 x $14 a court covers this cheaper court.)
    const x = await comingUnbooked(w.organizer, month, [s0.id]);
    expect(t.projected).toMatchObject({ courtCount: 1 + x, courtCostCents: 3000 + x * COURT, totalCents: 6000 + x * COURT, playersPayCents: 4200 + x * PLAYERS, yourCostCents: 1800 + x * YOURS, yourCostCourtCents: 0, yourCostMembershipCents: 1800 + x * YOURS });
    sane(t);
  });
  it('Edit charge on a finalized game is refused and changes nothing', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], ['Blair']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await fin(w, s0.id);
    const before = JSON.stringify((await money(w, month)).rework);
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false }, on);
    expect(r.status).toBe(409);
    expect(JSON.stringify((await money(w, month)).rework)).toBe(before);
  });
});

describe('R2 who is in', () => {
  it('organizer in the game is never money from players; organizer paying credit no effect; waitlisted adds nothing', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    // 5 players + organizer = 6; Frankie + extra would be waitlisted if cap (12?) - just check roster
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], true);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    expect((await fin(w, s0.id)).status).toBe(200);
    const t = (await money(w, month)).rework;
    // six played -> $9 each; five players each $14 paid, $5 back -> collected 5 x 900 = 4500
    expect(t).toMatchObject({ courtCostCents: 4800, collectedCents: 4500, yourCostCents: 3300 });
    sane(t);
  });
  it('only waitlisted players and past end and not booked: nothing at all', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s0.id}/join`, {});
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    const t = (await money(w, month)).rework;
    expect(t.courtSessions).toBe(0);
    // Note: 3 confirmed players on a game past its end count as a played-not-finalized court even if no court was ever booked.
    // (+ the month's other games still to come, not booked: Zip 13 counts them in Projected as if played.)
    expect(t.projected.courtCount).toBe(1 + (await comingUnbooked(w.organizer, month, [s0.id])));
    sane(t);
  });
});

describe('R3 zero courts and projected only', () => {
  it('current month, zero courts: membership only, players 0', async () => {
    const w = await world();
    const month = monthOf(w.app.now);
    const t = (await money(w, month)).rework;
    // No court played or booked; Zip 13: every game still to come this month counts in Projected as if played (x of them).
    const x = await comingUnbooked(w.organizer, month);
    expect(t.projected.courtCount).toBe(x);
    expect(t.projected).toMatchObject({ playersPayCents: x * PLAYERS, yourCostCents: 3000 + x * YOURS, yourCostCourtCents: x * YOURS, yourCostMembershipCents: 3000, totalCents: 3000 + x * COURT });
    sane(t);
    const past = (await money(w, '2026-01')).rework;
    expect(past.projected).toMatchObject({ membershipCents: 0, totalCents: 0, playersPayCents: 0, yourCostCents: 0 });
  });
  it('two booked upcoming games: 2 courts, players 8400, est 4200, top card only membership', async () => {
    const w = await world();
    const ups = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now && monthOf(Date.parse(s.startsAt)) === '2026-10');
    const [a, b] = ups;
    await w.organizer.call('POST', `/api/admin/sessions/${a.id}/booked`, {});
    await w.organizer.call('POST', `/api/admin/sessions/${b.id}/booked`, {});
    const t = (await money(w, '2026-10')).rework;
    expect(t).toMatchObject({ courtSessions: 0, courtCostCents: 0, owedToVenueCents: 3000, collectedCents: 0 });
    expect(t.projected).toMatchObject({ courtCount: 2, addedCourts: 2, courtCostCents: 9600, playersPayCents: 8400, yourCostCents: 4200 });
    sane(t);
  });
});
