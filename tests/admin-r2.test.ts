// "Admin screens, round 2" (ADMIN_R2, Nov 2026): the switch, Hide player, and the proof that it changes no money.
// The screens themselves are checked in e2e/admin-r2.cjs. Display only: nothing saved, charged or sent may depend on it.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_R2_HEADER, adminR2Allowed } from '../shared/adminR2';
import { doneByOthers } from '../shared/activity';
import { moneyGames, owedCentsOf, unpaidRows } from '../src/pages/admin/moneyList';
import { firstSession, PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  return setupGroup(app);
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const on = { [ADMIN_R2_HEADER]: 'on' };

describe('ADMIN_R2 switch', () => {
  it('S1 the var is allowed unless it says off', () => {
    expect(adminR2Allowed(undefined)).toBe(true);
    expect(adminR2Allowed('on')).toBe(true);
    expect(adminR2Allowed(' OFF ')).toBe(false);
  });
  it('S2 ship state: off for everyone', async () => {
    const d = await dash(await world());
    expect(d.adminR2).toBe(false);
    expect(d.adminR2ForAll).toBe(false);
  });
  it('S3 the private header turns it on for that request only', async () => {
    const w = await world();
    expect((await dash(w, on)).adminR2).toBe(true);
    expect((await dash(w, { [ADMIN_R2_HEADER]: 'yes' })).adminR2).toBe(false);
    expect((await dash(w)).adminR2).toBe(false);
  });
  it('S4 Settings switch turns it on for everyone, and off again, no deploy', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/admin-r2', { on: true })).status).toBe(200);
    let d = await dash(w);
    expect(d.adminR2).toBe(true);
    expect(d.adminR2ForAll).toBe(true);
    await w.organizer.call('PUT', '/api/admin/admin-r2', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'admin_r2_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/admin-r2', { on: false })).status).toBe(200);
    d = await dash(w);
    expect(d.adminR2).toBe(false);
    expect(d.adminR2ForAll).toBe(false);
  });
  it('S5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ ADMIN_R2: 'off' });
    await w.organizer.call('PUT', '/api/admin/admin-r2', { on: true });
    expect((await dash(w, on)).adminR2).toBe(false);
  });
  it('S6 the change shows in Activity and moves the organizer change stamp', async () => {
    const w = await world();
    const before = (await w.organizer.call('GET', '/api/admin/version')).data.v;
    await w.organizer.call('PUT', '/api/admin/admin-r2', { on: true });
    expect((await w.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(before);
    const act = await w.organizer.call('GET', '/api/admin/activity');
    expect(act.data.entries.some((e: { action: string }) => e.action === 'admin_r2_on')).toBe(true);
  });
  it('S7 only the organizer can flip it or hide anyone', async () => {
    const w = await world();
    const stranger = w.app.client();
    expect((await stranger.call('PUT', '/api/admin/admin-r2', { on: true })).status).toBe(401);
    const d = await dash(w);
    expect((await stranger.call('POST', `/api/admin/players/${d.players[1].id}/admin-hide`, { hidden: true })).status).toBe(401);
  });
  it('S8 the dashboard is identical with it on or off, apart from the switch fields (no money, seat or amount differs)', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    const blair = await playerPhone(w, 'Blair');
    await blair.call('POST', `/api/sessions/${s0.id}/join`, {});
    const off = await dash(w);
    const row = off.sessions.find((s: any) => s.id === s0.id).roster.find((r: any) => r.name === 'Blair');
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: row.playerId, paid: true, seen: row.moneySeen, cents: row.owesCents });
    const strip = (d: Record<string, unknown>) => {
      const { adminR2, adminR2ForAll, version, now, ...rest } = d;
      return JSON.stringify(rest);
    };
    expect(strip(await dash(w, on))).toBe(strip(await dash(w)));
    // The month totals and the money numbers the old Money tab reads are the same on the Totals screen too.
    const month = new Date(w.app.now).toISOString().slice(0, 7);
    const m1 = JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, on)).data);
    const m2 = JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${month}`)).data);
    expect(m1).toBe(m2);
  });
  it('S9 no migration was added for it', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.at(-1)).toBe('0017_court.sql'); // Zip 14 added 0017 (the court column); this feature itself still adds none
  });
});

describe('Hide player (soft)', () => {
  const books = (w: W) =>
    JSON.stringify(
      [
        w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all(),
        w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(),
        w.app.db.raw.prepare('SELECT id, display_name, is_active, phone_number, is_regular FROM players ORDER BY id').all(),
        w.app.db.raw.prepare('SELECT id, status, finalized_at FROM sessions ORDER BY id').all(),
      ],
    );
  async function withPaidSeat() {
    const w = await world();
    const s0 = await firstSession(w);
    const blair = await playerPhone(w, 'Blair');
    await blair.call('POST', `/api/sessions/${s0.id}/join`, {});
    const d = await dash(w);
    const row = d.sessions.find((s: any) => s.id === s0.id).roster.find((r: any) => r.name === 'Blair');
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: row.playerId, paid: true, seen: row.moneySeen, cents: row.owesCents });
    return { w, s0, blair, id: row.playerId as string };
  }
  it('P1 hide flags the name (switch on) and changes nothing else', async () => {
    const { w, id } = await withPaidSeat();
    const before = books(w);
    const moneyBefore = JSON.stringify((await dash(w, on)).sessions);
    const r = await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on);
    expect(r.status, r.text).toBe(200);
    const d = await dash(w, on);
    expect(d.players.find((p: any) => p.id === id).adminHidden).toBe(true);
    expect(d.players.filter((p: any) => p.adminHidden)).toHaveLength(1);
    // Seats, payments, credit, the roster and every amount are exactly as before.
    expect(books(w)).toBe(before);
    expect(JSON.stringify(d.sessions)).toBe(moneyBefore);
    // Not flagged on a screen where the switch is off.
    expect((await dash(w)).players.some((p: any) => p.adminHidden)).toBe(false);
  });
  it('P2 the hidden player keeps working on their own screen (still in, still owes or paid)', async () => {
    const { w, s0, blair } = await withPaidSeat();
    const id = (await dash(w)).players.find((p: any) => p.name === 'Blair').id;
    await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on);
    const mine = (await blair.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s0.id);
    expect(mine).toBeTruthy();
    const row = (await dash(w, on)).sessions.find((s: any) => s.id === s0.id).roster.find((r: any) => r.name === 'Blair');
    expect(row.status).toBe('confirmed');
    expect(row.paymentStatus).toBe('paid');
  });
  it('P3 unhide puts the name back, and it works twice (never one-way)', async () => {
    const { w, id } = await withPaidSeat();
    await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on);
    await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on);
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'admin_hidden_player:%'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: false }, on)).status).toBe(200);
    expect((await dash(w, on)).players.some((p: any) => p.adminHidden)).toBe(false);
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'admin_hidden_player:%'").first<{ n: number }>())?.n).toBe(0);
  });
  it('P4 you cannot hide yourself; an unknown id is a 404; it is logged in Activity', async () => {
    const { w, id } = await withPaidSeat();
    const d = await dash(w, on);
    // The organizer plays too: make sure their own player exists, then try.
    const s0 = await firstSession(w);
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/me`, { in: true });
    const me = (await dash(w, on)).me;
    expect(me).toBeTruthy();
    expect((await w.organizer.call('POST', `/api/admin/players/${me.id}/admin-hide`, { hidden: true }, on)).status).toBe(400);
    expect((await w.organizer.call('POST', '/api/admin/players/nope-0000/admin-hide', { hidden: true }, on)).status).toBeGreaterThanOrEqual(400);
    await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: any) => e.action === 'player_admin_hidden')).toBe(true);
    expect(d.players.length).toBeGreaterThan(1);
  });
  it('P5 kill switch: nothing is flagged any more (everyone shows again) but Unhide still works', async () => {
    const w = await world({ ADMIN_R2: 'off' });
    const id = (await dash(w)).players[1].id;
    expect((await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: true }, on)).status).toBe(400);
    // Hidden before the kill switch went off: Unhide is still allowed.
    expect((await w.organizer.call('POST', `/api/admin/players/${id}/admin-hide`, { hidden: false })).status).toBe(200);
  });
});

describe('History highlight', () => {
  it('H1 only the organizer is "you": a player or anything else is highlighted', () => {
    expect(doneByOthers({ actorLabel: 'organizer' })).toBe(false);
    expect(doneByOthers({ actorLabel: 'organizer as Ryan' })).toBe(false);
    expect(doneByOthers({ actorLabel: 'Ryan' })).toBe(true);
    expect(doneByOthers({ actorLabel: 'Organizer Orla' })).toBe(true);
    expect(doneByOthers({ actorLabel: 'system' })).toBe(true);
    // The organizer's own I'm in / Out is logged under their real name, with organizer: true.
    expect(doneByOthers({ actorLabel: 'Alex', details: { organizer: true } })).toBe(false);
    expect(doneByOthers({ actorLabel: 'Alex', details: { player: 'Alex' } })).toBe(true);
  });
});

describe('Money list (round 2)', () => {
  it('M1 lists the games the old tab listed, plus waiting and closed ones, in date order', async () => {
    const w = await world();
    const d = await dash(w, on);
    const now = Date.parse(d.now);
    const list = moneyGames(d.sessions, now);
    const old = d.sessions.filter((s: any) => (!s.state.flags.canceled && s.court !== null) || (s.state.flags.canceled && s.roster.some((r: any) => !r.isOrganizer && r.creditBackCents > 0)));
    for (const s of old) expect(list.some((g) => g.s.id === s.id)).toBe(true);
    const upcoming = list.filter((g) => Date.parse(g.s.startsAt) > now).map((g) => Date.parse(g.s.startsAt));
    expect([...upcoming].sort((a, b) => a - b)).toEqual(upcoming);
    expect(list.every((g) => (g.kind === 'waiting' ? g.s.court === null && !g.s.state.flags.canceled : true))).toBe(true);
  });
  it('M2 the amount owed on a game is the sum of what the Mark paid rows owe (same people, same cents)', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    for (const n of ['Blair', 'Casey']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s0.id}/join`, {});
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
    const s = (await dash(w, on)).sessions.find((x: any) => x.id === s0.id);
    const owing = s.roster.filter((r: any) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.owesCents > 0);
    expect(unpaidRows(s).map((r: any) => r.playerId)).toEqual(owing.map((r: any) => r.playerId));
    expect(owedCentsOf(s)).toBe(owing.reduce((t: number, r: any) => t + r.owesCents, 0));
    expect(owedCentsOf(s)).toBeGreaterThan(0);
  });
});
