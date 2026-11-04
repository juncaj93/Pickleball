// Independent review of the MONEY_REWORK Totals: hand-computed numbers against the real data.
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world(settings?: Record<string, unknown>) {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', ...(settings ? { settings } : {}) });
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

describe('review: fee-kept games', () => {
  async function feeKept() {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey']);
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
    expect(res.status, res.text).toBe(200);
    return { w, s0, month: monthOf(Date.parse(s0.startsAt)) };
  }
  it('F1 fee kept: court $48 counts once, collected is what two players paid ($28), same as the old page', async () => {
    const { w, month } = await feeKept();
    const m = await money(w, month);
    expect(m.courtCostCents).toBe(4800);
    expect(m.collectedCents).toBe(2800);
    expect(m.rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 2800, owedToVenueCents: 7800, yourCostCents: 5000 });
  });
  it('F2 fee kept then Edit charge = No: the old fields still say $28 collected, the rework drops it too (players keep owing)', async () => {
    const { w, s0, month } = await feeKept();
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false }, on);
    expect(r.status, r.text).toBe(200);
    const m = await money(w, month);
    // Old collected still counts the fee-kept payments; the rework no longer does. Totals disagree about money that was paid.
    expect(m.collectedCents).toBe(2800);
    expect(m.rework.collectedCents).toBe(0);
  });
  it('F3 fee kept, Edit charge to $25: the court part follows the edit, collected unchanged', async () => {
    const { w, s0, month } = await feeKept();
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 2500 }, on);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 2500, collectedCents: 2800, yourCostCents: 2700, yourCostCourtCents: 0 });
  });
});

describe('review: played, not finalized, projections', () => {
  it('P1 played but not finalized: not in so-far, added to projected at the price its players would pay (5 in = $11 x 4 others)', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair'], true);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    expect(t).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0 });
    expect(t.projected).toMatchObject({ addedCourts: 1, courtCostCents: 4800, playersPayCents: 4400 });
  });
  it('P2 waitlisted players are not counted in projected (max 4, fifth waits)', async () => {
    const w = await world({ maxPlayers: 4 });
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], []);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    expect(sv.roster.filter((r: any) => r.status === 'waitlisted' || r.status === 'waitlist').length).toBe(1);
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    // 4 confirmed x $14 = $56; the waitlisted fifth adds nothing.
    expect(t.projected.playersPayCents).toBe(5600);
  });
  it('P3 organizer marked paid on a played game is never collected', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], [], true);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    const org = sv.roster.find((r: any) => r.isOrganizer);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: org.playerId, paid: true, seen: org.moneySeen, cents: 1400 });
    // Whatever the server says, the organizer's row must not enter the players' share.
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    expect(t.collectedCents).toBe(0);
    void res;
  });
  it('P4 canceled-charged then reopened then played: the court counts once at the played cost, not charge plus cost', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], []);
    w.app.now = Date.parse(s0.startsAt) - 5 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, chargedCents: 4800 }, on);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 2500 }, on);
    expect((await money(w, monthOf(Date.parse(s0.startsAt)))).rework).toMatchObject({ courtSessions: 1, courtCostCents: 2500 });
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'reopen' }, on);
    expect((await money(w, monthOf(Date.parse(s0.startsAt)))).rework).toMatchObject({ courtSessions: 0, courtCostCents: 0 });
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect((await money(w, monthOf(Date.parse(s0.startsAt)))).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
  });
  it('P5 Edit charge rejects a negative or fractional amount', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    w.app.now = Date.parse(s0.startsAt) - 5 * HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true }, on);
    for (const cents of [-500, 12.5, 'abc']) {
      const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents }, on);
      expect(r.status, JSON.stringify(cents)).toBe(400);
    }
  });
});

describe('review: month boundary (Eastern)', () => {
  async function playedAt(startIso: string) {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], []);
    const end = new Date(Date.parse(startIso) + 2 * HOUR).toISOString();
    w.app.db.raw.prepare('UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?').run(startIso, end, s0.id);
    w.app.now = Date.parse(end) + HOUR;
    await dash(w); // sign in again after the clock jump
    const f = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect(f.status, f.text).toBe(200);
    return w;
  }
  it('B1 11:30 PM EDT Oct 31 (03:30Z Nov 1) is October, not November', async () => {
    const w = await playedAt('2026-11-01T03:30:00.000Z');
    expect((await money(w, '2026-10')).rework.courtSessions).toBe(1);
    expect((await money(w, '2026-11')).rework.courtSessions).toBe(0);
  });
  it('B2 11:30 PM EST Nov 30 (04:30Z Dec 1) is November, not December', async () => {
    const w = await playedAt('2026-12-01T04:30:00.000Z');
    expect((await money(w, '2026-11')).rework.courtSessions).toBe(1);
    expect((await money(w, '2026-12')).rework.courtSessions).toBe(0);
  });
  it('B3 midnight Nov 1 EDT (04:00Z) is November; 03:59Z is October', async () => {
    const a = await playedAt('2026-11-01T04:00:00.000Z');
    expect((await money(a, '2026-11')).rework.courtSessions).toBe(1);
    const b = await playedAt('2026-11-01T03:59:00.000Z');
    expect((await money(b, '2026-10')).rework.courtSessions).toBe(1);
  });
});

describe('review: membership in a month with nothing owed yet', () => {
  it('M1 a FUTURE month with only booked coming games: "owed so far" should not already hold membership', async () => {
    const w = await world();
    const games = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now && monthOf(Date.parse(s.startsAt)) === '2026-11');
    expect(games.length).toBeGreaterThan(0);
    await fill(w, games[0], ['Blair', 'Casey', 'Devon', 'Emery'], []);
    const t = (await money(w, '2026-11')).rework;
    // Today is Oct 26: nothing in November has been played, so nothing is owed to the venue so far.
    expect({ courtSessions: t.courtSessions, owed: t.owedToVenueCents, yourCost: t.yourCostCents }).toEqual({ courtSessions: 0, owed: 0, yourCost: 0 });
  });
});
