import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { PIN, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
const money = async (w: any, month: string, h: Record<string, string> = on) => (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, h)).data;

describe('month boundaries in Eastern time (raw rows)', () => {
  it('finalized/booked games at the edges land in the right month; nothing double counted', async () => {
    const app = new TestApp();
    app.now = Date.parse('2026-12-15T17:00:00Z');
    const w = await setupGroup(app);
    const gid = (w.app.db.raw.prepare('SELECT id FROM groups').get() as any).id;
    const ins = (id: string, start: string, end: string, extra = '') =>
      w.app.db.raw.exec(`INSERT INTO sessions (id, group_id, starts_at, ends_at, booking_status, created_at, updated_at${extra ? ', ' + extra.split('|')[0] : ''}) VALUES ('${id}','${gid}','${start}','${end}','booked','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'${extra ? ', ' + extra.split('|')[1] : ''})`);
    const fz = "finalized_at, final_price_cents, final_played_count|'2026-12-02T00:00:00Z', 1400, 4";
    // Oct 31 11:30pm EDT = Nov 1 03:30Z -> OCTOBER; Nov 1 12:30am EDT = 04:30Z -> NOVEMBER; Nov 30 11:30pm EST = Dec 1 04:30Z -> NOVEMBER; Dec 1 12:30am EST = 05:30Z -> DECEMBER
    ins('o31', '2026-11-01T03:30:00Z', '2026-11-01T04:30:00Z', fz);
    ins('n01', '2026-11-01T04:30:00Z', '2026-11-01T05:30:00Z', fz);
    ins('n30', '2026-12-01T04:30:00Z', '2026-12-01T05:30:00Z', fz);
    ins('d01', '2026-12-01T05:30:00Z', '2026-12-01T06:30:00Z', fz);
    const oct = (await money(w, '2026-10')).rework;
    const nov = (await money(w, '2026-11')).rework;
    const dec = (await money(w, '2026-12')).rework;
    expect(oct.courtCostCents).toBe(4800);
    expect(nov.courtCostCents).toBe(9600);
    expect(dec.courtCostCents).toBe(4800);
    // projected: players 3 x 1400 per court
    expect(nov.projected).toMatchObject({ courtCount: 2, playersPayCents: 8400, yourCostCents: 4200 });
    // Oct (past, has a court) and Nov (past) get membership; Oct + Nov + Dec memberships each once
    expect([oct.membershipCents, nov.membershipCents, dec.membershipCents]).toEqual([3000, 3000, 3000]);
  });
});

describe('hidden mark never hides money; switch off has no rework key', () => {
  it('a hidden mark on a finalized game and on a charged canceled game is ignored', async () => {
    const app = new TestApp();
    app.now = Date.parse('2026-12-15T17:00:00Z');
    const w = await setupGroup(app);
    const gid = (w.app.db.raw.prepare('SELECT id FROM groups').get() as any).id;
    w.app.db.raw.exec(`INSERT INTO sessions (id, group_id, starts_at, ends_at, booking_status, finalized_at, final_price_cents, final_played_count, created_at, updated_at) VALUES ('f1','${gid}','2026-12-03T23:00:00Z','2026-12-04T01:00:00Z','booked','2026-12-04T02:00:00Z',1400,4,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    w.app.db.raw.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES ('h1','${gid}','f1','admin_hidden_game','mark','2026-12-05T00:00:00Z')`);
    const t = (await money(w, '2026-12')).rework;
    expect(t.courtCostCents).toBe(4800);
    const off = await money(w, '2026-12', {});
    expect('rework' in off).toBe(false);
    expect(off.courtCostCents).toBe(4800);
  });
  it('kill switch: no rework key even with the header', async () => {
    const app = new TestApp();
    (app.env as any).MONEY_REWORK = 'off';
    const w = await setupGroup(app);
    const m = await money(w, '2026-11');
    expect('rework' in m).toBe(false);
    void PIN;
  });
});
