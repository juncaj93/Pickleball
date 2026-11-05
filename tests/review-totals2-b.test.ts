import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world(opts: { late?: boolean; split?: boolean } = {}) {
  const w = await setupGroup(new TestApp());
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  if (opts.late) expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  if (opts.split) expect((await w.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
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
const sane = (t: any) => {
  for (const v of [t.courtCostCents, t.collectedCents, t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.yourCostCents, t.projected.yourCostCourtCents, t.projected.yourCostMembershipCents]) expect(v).toBeGreaterThanOrEqual(0);
  expect(t.yourCostCourtCents + t.yourCostMembershipCents).toBe(t.yourCostCents);
  expect(t.projected.yourCostCourtCents + t.projected.yourCostMembershipCents).toBe(t.projected.yourCostCents);
};

async function feeKept(w: W, others: string[], paid: string[], orgIn = false) {
  const s0 = await firstSession(w);
  await fill(w, s0, others, paid, orgIn);
  w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
  const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
  expect(c.status, c.text).toBe(200);
  return { s0, month: monthOf(Date.parse(s0.startsAt)) };
}

describe('fee-kept cancel, no split', () => {
  it('3 in, 2 paid: venue charged 4800, kept 2800; Edit charge No drops both; Edit charge 2500 counts 2500 and keeps 2800', async () => {
    const w = await world({ late: true });
    const { s0, month } = await feeKept(w, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey']);
    let t = (await money(w, month)).rework;
    expect(t).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 2800, yourCostCents: 5000 });
    expect(t.projected).toMatchObject({ courtCount: 1, addedCourts: 0, playersPayCents: 4200, yourCostCents: 3600 });
    sane(t);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 2500 }, on);
    t = (await money(w, month)).rework;
    expect(t).toMatchObject({ courtCostCents: 2500, collectedCents: 2800, yourCostCents: 2700 });
    sane(t);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false }, on);
    t = (await money(w, month)).rework;
    expect(t).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0, yourCostCents: 3000 });
    expect(t.projected).toMatchObject({ courtCount: 0, playersPayCents: 0, yourCostCents: 3000 });
    sane(t);
    // old page: collected counted for fee kept even with the charge removed?
    const old = await money(w, month, {});
    console.log('OLD page after charge No:', old.collectedCents, old.courtCostCents);
  });
});

describe('late-fee no-show', () => {
  it('finalize with 3 played and one no-show who paid: no-show owes, not collected twice; numbers by hand', async () => {
    const w = await world({ late: true });
    const s0 = await firstSession(w);
    const month = monthOf(Date.parse(s0.startsAt));
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    const f = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { played: [(await dash(w)).players.find((p: any) => p.name === 'Blair').id, (await dash(w)).players.find((p: any) => p.name === 'Casey').id, (await dash(w)).players.find((p: any) => p.name === 'Devon').id] });
    expect(f.status, f.text).toBe(200);
    const t = (await money(w, month)).rework;
    // 3 played at $14; Emery (no show, short of 4) paid $14 and it stays on the game: 4 x 1400 = 5600 collected
    expect(t).toMatchObject({ courtCostCents: 4800, collectedCents: 5600 });
    sane(t);
    expect(t.projected.playersPayCents).toBe(4200);
  });
});

describe('credit-paid seat', () => {
  it('a player who paid $14 to a canceled game then uses that credit in another game that is finalized', async () => {
    const w = await world();
    const g = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);
    const [a, b] = g;
    await fill(w, a, ['Blair'], ['Blair']);
    // cancel a early with no charge: Blair gets $14 credit
    w.app.now = Date.parse(a.startsAt) - 30 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${a.id}/decision`, { decision: 'cancel', confirm: true }, on)).status).toBe(200);
    await fill(w, b, ['Blair', 'Casey', 'Devon'], ['Casey', 'Devon']);
    w.app.now = Date.parse(b.endsAt) + HOUR;
    const f = await w.organizer.call('POST', `/api/admin/sessions/${b.id}/finalize`, { everyone: true });
    expect(f.status, f.text).toBe(200);
    const month = monthOf(Date.parse(b.startsAt));
    const m = await money(w, month);
    const t = m.rework;
    console.log('credit-paid month', month, JSON.stringify({ ...t, projected: undefined }), 'old', m.collectedCents, m.heldCents, m.creditsOwedCents);
    sane(t);
  });
});
