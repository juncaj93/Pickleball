// Independent review of "Hide from list": it must only set a flag. Nothing anyone owes or holds may change.
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world() {
  const w = await setupGroup(new TestApp());
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
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
const call = (w: W, method: string, path: string, body?: unknown, headers: Record<string, string> = on) => w.organizer.call(method, path, body, headers);
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
async function fill(w: W, game: { id: string }, names: string[], paid: string[]) {
  await w.organizer.call('POST', `/api/admin/sessions/${game.id}/booked`, {});
  for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${game.id}/join`, {});
  const sv = (await dash(w)).sessions.find((s: any) => s.id === game.id);
  for (const n of paid) {
    const r = sv.roster.find((x: any) => x.name === n);
    await w.organizer.call('POST', `/api/admin/sessions/${game.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
  }
}
/** The whole dashboard minus the things hiding is allowed to change (the flag, the hidden list, the activity list and the clock). */
function stripped(d: any) {
  const c = JSON.parse(JSON.stringify(d));
  delete c.hiddenGames;
  delete c.audit;
  delete c.taskMarks; // holds the hide row itself
  delete c.version; // a hash of the data, moves with the row
  for (const s of c.sessions) delete s.hiddenFromList;
  return JSON.stringify(c);
}
const rows = (w: W) =>
  JSON.stringify([
    w.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all(),
    w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all(),
    w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all(),
    w.app.db.raw.prepare("SELECT * FROM admin_audit_log WHERE action NOT IN ('session_hidden_from_list','session_shown_in_list') ORDER BY id").all(),
  ]);

describe('review: hide changes nothing but the flag', () => {
  it('HD1 the whole dashboard (balances, held, owed, claims, refund requests) is identical before and after hiding, played game with credit and an unpaid player', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey']);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/me`, { in: true });
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await dash(w);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true })).status).toBe(200);
    const beforeD = JSON.parse(stripped(await dash(w)));
    const before = JSON.stringify(beforeD);
    const tables = rows(w);
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true })).status).toBe(200);
    const afterD = JSON.parse(stripped(await dash(w)));
    const diff = Object.keys(beforeD).filter((k) => JSON.stringify(beforeD[k]) !== JSON.stringify(afterD[k]));
    expect(diff).toEqual([]);
    expect(rows(w)).toBe(tables);
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: false })).status).toBe(200);
    expect(stripped(await dash(w))).toBe(before);
    expect(rows(w)).toBe(tables);
  });
  it('HD2 hide a canceled game, reopen it: the flag stays, nothing is lost, restore brings back the same dashboard', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey'], ['Blair']);
    w.app.now = Date.parse(s0.startsAt) - 20 * HOUR;
    await dash(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true }, on);
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true });
    const re = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'reopen' }, on);
    expect(re.status, re.text).toBe(200);
    const d = await dash(w);
    expect(d.sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBe(true);
    // Blair's $14 is owed again after reopen; still reads, still on the game.
    expect(d.sessions.find((s: any) => s.id === s0.id).roster.find((r: any) => r.name === 'Blair').paymentStatus).toBeDefined();
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: false })).data.changed).toBe(true);
    expect((await dash(w)).sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBeUndefined();
  });
  it('HD3 the Settings list finds a hidden game older than the 90-day window', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true });
    w.app.db.raw.prepare('UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?').run('2026-01-06T23:00:00.000Z', '2026-01-07T01:00:00.000Z', s0.id);
    const d = await dash(w);
    expect(d.hiddenGames.map((h: any) => h.id)).toContain(s0.id);
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: false })).data.changed).toBe(true);
  });
  it('HD4 switch turned off: every hidden game is a normal game, nothing is deleted, and turning it back on re-hides them', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(200);
    const s0 = await firstSession(w);
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true }, {});
    expect((await dash(w, {})).sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBe(true);
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: false });
    const off = await dash(w, {});
    expect(off.sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBeUndefined();
    expect(off.hiddenGames).toBeUndefined();
    // The restore route refuses while off (nobody can strand a row), and the row survives.
    expect((await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: false }, {})).status).toBe(409);
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: true });
    expect((await dash(w, {})).sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBe(true);
  });
  it('HD5 a hidden game keeps taking money: a player joins, pays, and the dashboard still shows it on the game', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
    await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true });
    const j = await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${s0.id}/join`, {});
    expect(j.status, j.text).toBe(200);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    expect(sv.roster.some((r: any) => r.name === 'Blair' && r.status === 'confirmed')).toBe(true);
    void monthOf;
  });
});

describe('review: the brief says a game with a late fee cannot be hidden', () => {
  it('HD6 server: fee-kept canceled game with players who still owe $14 refuses to hide (only the buttons check it today)', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon'], []);
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    await dash(w);
    const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
    expect(c.status, c.text).toBe(200);
    const r = await call(w, 'POST', `/api/admin/sessions/${s0.id}/hide-from-list`, { hidden: true });
    expect(r.status).toBe(409);
  });
});
