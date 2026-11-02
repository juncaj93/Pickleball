// "New admin layout" (ADMIN_V2, Nov 2026): the switch only. The screens themselves are checked in e2e/admin-v2.cjs.
// Display only: nothing that is saved, charged or sent may depend on it.
import { describe, expect, it } from 'vitest';
import { ADMIN_V2_HEADER, adminV2Allowed } from '../shared/adminV2';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const ctx = await setupGroup(app);
  return ctx;
}
const dash = async (w: Awaited<ReturnType<typeof world>>, headers: Record<string, string> = {}) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
};

describe('ADMIN_V2 switch', () => {
  it('S1 the var is allowed unless it says off', () => {
    expect(adminV2Allowed(undefined)).toBe(true);
    expect(adminV2Allowed('on')).toBe(true);
    expect(adminV2Allowed(' OFF ')).toBe(false);
  });
  it('S2 ship state: off for everyone', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.adminV2).toBe(false);
    expect(d.adminV2ForAll).toBe(false);
  });
  it('S3 the private header turns it on for that request only', async () => {
    const w = await world();
    expect((await dash(w, { [ADMIN_V2_HEADER]: 'on' })).adminV2).toBe(true);
    expect((await dash(w, { [ADMIN_V2_HEADER]: 'yes' })).adminV2).toBe(false);
    expect((await dash(w)).adminV2).toBe(false);
  });
  it('S4 Settings switch turns it on for everyone, and off again, no deploy', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/admin-v2', { on: true })).status).toBe(200);
    let d = await dash(w);
    expect(d.adminV2).toBe(true);
    expect(d.adminV2ForAll).toBe(true);
    // Tapping on twice keeps one stored row.
    await w.organizer.call('PUT', '/api/admin/admin-v2', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'admin_v2_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/admin-v2', { on: false })).status).toBe(200);
    d = await dash(w);
    expect(d.adminV2).toBe(false);
    expect(d.adminV2ForAll).toBe(false);
  });
  it('S5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ ADMIN_V2: 'off' });
    await w.organizer.call('PUT', '/api/admin/admin-v2', { on: true });
    expect((await dash(w, { [ADMIN_V2_HEADER]: 'on' })).adminV2).toBe(false);
  });
  it('S6 the change shows in Activity and moves the organizer change stamp', async () => {
    const w = await world();
    const before = (await w.organizer.call('GET', '/api/admin/version')).data.v;
    await w.organizer.call('PUT', '/api/admin/admin-v2', { on: true });
    expect((await w.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(before);
    const act = await w.organizer.call('GET', '/api/admin/activity');
    expect(act.data.entries.some((e: { action: string }) => e.action === 'admin_v2_on')).toBe(true);
  });
  it('S7 only the organizer can flip it', async () => {
    const w = await world();
    const stranger = w.app.client();
    expect((await stranger.call('PUT', '/api/admin/admin-v2', { on: true })).status).toBe(401);
  });
  it('S8 nothing else in the dashboard changes with it on', async () => {
    const w = await world();
    const off = await dash(w);
    const on = await dash(w, { [ADMIN_V2_HEADER]: 'on' });
    const strip = (d: Record<string, unknown>) => {
      const { adminV2, version, now, ...rest } = d;
      return JSON.stringify(rest);
    };
    expect(strip(on)).toBe(strip(off));
  });
});

// ---------- Item 5: the Label (the game's note) can be changed after the game exists ----------
describe('Edit game: Label (the note)', () => {
  const sessionOf = async (w: Awaited<ReturnType<typeof world>>) => {
    const d = await dash(w);
    return d.sessions.find((s: any) => Date.parse(s.startsAt) > w.app.now);
  };
  it('L1 changes the label, shows it to the organizer and to players, and logs it', async () => {
    const w = await world();
    const s = await sessionOf(w);
    const r = await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: "  Veteran's Day " });
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ changed: true, note: "Veteran's Day" });
    expect((await sessionOf(w)).note).toBe("Veteran's Day");
    const c = await playerPhone(w, 'Alex');
    expect((await c.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).note).toBe("Veteran's Day");
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'session_note_changed');
    expect(act.details).toMatchObject({ from: null, to: "Veteran's Day" });
  });
  it('L2 an empty label clears it; the same label again changes nothing', async () => {
    const w = await world();
    const s = await sessionOf(w);
    await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'Court 3' });
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'Court 3' })).data.changed).toBe(false);
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: '   ' })).data).toMatchObject({ changed: true, note: null });
    expect((await sessionOf(w)).note).toBeNull();
  });
  it('L3 at most 80 characters; the "Extra game" tag and everything else stay', async () => {
    const w = await world();
    const s = await sessionOf(w);
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'x'.repeat(81) })).status).toBe(400);
    const before = JSON.stringify({ ...s, note: null, roster: s.roster });
    await w.organizer.call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'Fine' });
    const after = await sessionOf(w);
    expect(JSON.stringify({ ...after, note: null, roster: after.roster })).toBe(before);
    expect(after.extra).toBe(s.extra);
  });
  it('L4 only the organizer can change it', async () => {
    const w = await world();
    const s = await sessionOf(w);
    expect((await w.app.client().call('PUT', `/api/admin/sessions/${s.id}/note`, { note: 'x' })).status).toBe(401);
  });
  it('L5 an extra game keeps its tag and its label can be edited', async () => {
    const w = await world();
    const day = new Date(w.app.now + 6 * DAY);
    const startsAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 0)).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 2 * HOUR).toISOString();
    const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: 'Draft' });
    expect(add.status, add.text).toBe(200);
    const d = await dash(w);
    const x = d.sessions.find((s: any) => s.extra && s.note === 'Draft');
    expect(x).toBeTruthy();
    await w.organizer.call('PUT', `/api/admin/sessions/${x.id}/note`, { note: "Veteran's Day" });
    const y = (await dash(w)).sessions.find((s: any) => s.id === x.id);
    expect(y.extra).toBe(true);
    expect(y.note).toBe("Veteran's Day");
  });
});

// ---------- Item 6: Remove a canceled game from the player screen (it only hides) ----------
describe('Remove from player screen', () => {
  async function canceledWithMoney(env: Record<string, string> = {}) {
    const w = await world(env);
    const s0 = await firstSession(w);
    const ryan = await playerPhone(w, 'Blair');
    const j = await ryan.call('POST', `/api/sessions/${s0.id}/join`, {});
    expect(j.status, j.text).toBe(200);
    // Ryan paid; then the game is canceled and his payment becomes credit.
    const row = (await dash(w)).sessions.find((s: any) => s.id === s0.id).roster.find((r: any) => r.name === 'Blair');
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: row.playerId, paid: true, seen: row.moneySeen, cents: row.owesCents })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain' })).status).toBe(200);
    return { w, s: s0, ryan };
  }
  const books = (w: Awaited<ReturnType<typeof world>>) =>
    JSON.stringify(
      w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all().concat(w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(), w.app.db.raw.prepare('SELECT id, status, finalized_at, cancel_reason FROM sessions ORDER BY id').all()),
    );
  const onPlayer = async (c: any, id: string) => (await c.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === id);

  it('H1 only a canceled game can be hidden', async () => {
    const w = await world();
    const s = await firstSession(w);
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect(r.status).toBe(409);
    expect((await w.app.client().call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true })).status).toBe(401);
  });
  it('H2 hidden: players no longer see it, the organizer still does, and it stays hidden after a refresh', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    expect(await onPlayer(ryan, s.id)).toBeTruthy(); // the canceled card shows today
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect(r.data).toMatchObject({ ok: true, changed: true, hidden: true });
    for (let i = 0; i < 2; i++) {
      expect(await onPlayer(ryan, s.id)).toBeUndefined();
      expect(await onPlayer(await playerPhone(w, 'Alex'), s.id)).toBeUndefined();
    }
    const mine = (await dash(w)).sessions.find((x: any) => x.id === s.id);
    expect(mine.hiddenFromPlayers).toBe(true);
    expect(mine.state.flags.canceled).toBe(true);
    expect(w.app.db.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").get(s.id)).toEqual({ n: 1 });
  });
  it('H3 nothing about money changes: credit, seats, the ledger and the month totals are identical, credit history keeps its row', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    const before = books(w);
    const creditBefore = (await ryan.call('GET', '/api/group')).data.credit;
    const moneyBefore = JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${new Date(w.app.now).toISOString().slice(0, 7)}`)).data);
    const credBefore = JSON.stringify((await dash(w)).creditLedger);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect(books(w)).toBe(before);
    const creditAfter = (await ryan.call('GET', '/api/group')).data.credit;
    expect(creditAfter).toEqual(creditBefore);
    expect(creditAfter.balanceCents).toBeGreaterThan(0);
    expect(creditAfter.history.some((h: any) => h.sessionId === s.id)).toBe(true);
    expect(JSON.stringify((await w.organizer.call('GET', `/api/admin/money?month=${new Date(w.app.now).toISOString().slice(0, 7)}`)).data)).toBe(moneyBefore);
    expect(JSON.stringify((await dash(w)).creditLedger)).toBe(credBefore);
    // The organizer's Money still lists the canceled game's roster with the credit given back.
    const m = (await dash(w)).sessions.find((x: any) => x.id === s.id);
    expect(m.roster.some((r: any) => r.name === 'Blair' && r.creditBackCents > 0)).toBe(true);
  });
  it('H4 "Show on player screen again" undoes it, and the same call twice changes nothing', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true })).data.changed).toBe(false);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: false })).data.changed).toBe(true);
    expect(await onPlayer(ryan, s.id)).toBeTruthy();
    expect((await dash(w)).sessions.find((x: any) => x.id === s.id).hiddenFromPlayers).toBe(false);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: false })).data.changed).toBe(false);
  });
  it('H5 it is logged, and an open player phone is told something changed', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    const stamp = async () => (await ryan.call('GET', '/api/group/version')).data.v;
    const before = await stamp();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect(await stamp()).not.toBe(before);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: false });
    expect(await stamp()).toBe(before);
    const actions = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => e.action);
    expect(actions).toContain('session_hidden_from_players');
    expect(actions).toContain('session_shown_to_players');
  });
  it('H6 reopening a hidden game makes it a normal game again for players (and a later cancel starts visible)', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    const p = await onPlayer(ryan, s.id);
    expect(p).toBeTruthy();
    expect(p.canceled).toBe(false);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    expect(await onPlayer(ryan, s.id)).toBeTruthy();
  });
  it('H7 the ADMIN_V2 kill switch puts every hidden game back on the player screen', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/hide`, { hidden: true });
    expect(await onPlayer(ryan, s.id)).toBeUndefined();
    w.app.env.ADMIN_V2 = 'off';
    expect(await onPlayer(ryan, s.id)).toBeTruthy();
    w.app.env.ADMIN_V2 = 'on';
    expect(await onPlayer(ryan, s.id)).toBeUndefined();
  });
  it('H8 it does nothing until used: with no hides, the player view is identical to a world without the feature', async () => {
    const { w, s, ryan } = await canceledWithMoney();
    const a = JSON.stringify((await ryan.call('GET', '/api/group')).data.sessions.map((x: any) => x.id));
    expect(a).toContain(s.id);
    expect(w.app.db.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'hidden_from_players'").get()).toEqual({ n: 0 });
  });
  it('H9 no schema change: the same tables and columns as before', () => {
    // The feature stores one row per hidden game in the existing task_log table; migrations are untouched.
    const out = require('node:child_process').execSync('git status --porcelain migrations', { encoding: 'utf8' });
    expect(out.trim()).toBe('');
  });
});
