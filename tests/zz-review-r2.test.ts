import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GroupView } from '../shared/api';
import { LATE_FEES_HEADER } from '../shared/lateFees';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';

const PRICE = 1400;
const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const ORG = 'Alex';
async function world(mode: 'off' | 'settings' = 'settings') {
  const app = new TestApp();
  const ctx = await setupGroup(app);
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ORG })).status).toBe(200);
  for (const n of ['Gale', 'Harper', 'Indy']) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-02${n.length}${n.charCodeAt(0) % 10}` });
    ctx.byName[n] = r.data.id;
  }
  if (mode === 'settings') expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  return { ...ctx, headers: {} as Record<string, string>, phones: new Map<string, Client>() };
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  if (r.status === 401) { await w.organizer.call('POST', '/api/admin/login', { pin: PIN }); r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers); }
  return r.data;
}
async function phone(w: W, name: string): Promise<Client> {
  let c = w.phones.get(name);
  if (!c) { c = w.app.client(); c.groupKey = w.groupKey; await c.call('POST', '/api/me', { playerId: w.byName[name] }); w.phones.set(name, c); }
  return c;
}
const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body, w.headers);
const admin = (w: W, method: string, path: string, body?: unknown) => w.organizer.call(method, path, body, w.headers);
const view = async (w: W, name: string): Promise<GroupView> => (await call(w, name, 'GET', '/api/group')).data;
async function game(w: W) { const d = await dash(w); const s = d.sessions.filter((x: any) => Date.parse(x.startsAt) > w.app.now && !x.state.flags.canceled)[0]; return { id: s.id as string, start: Date.parse(s.startsAt) }; }
const join = async (w: W, sid: string, names: string[]) => { for (const n of names) expect((await call(w, n, 'POST', `/api/sessions/${sid}/join`, {})).status).toBe(200); };
const rowOf = async (w: W, sid: string, name: string) => (await dash(w)).sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === name);
const sessOf = async (w: W, sid: string) => (await dash(w)).sessions.find((s: any) => s.id === sid);
function health(w: W) {
  const raw = (w.app.db as any).raw;
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const seat = (w: W, sid: string, name: string) => (w.app.db as any).raw.prepare('SELECT status, played, payment_status, payment_amount_cents, refunded_at, late_drop_at, late_drop_done_at FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, w.byName[name]);
const ledger = (w: W, name: string) => (w.app.db as any).raw.prepare('SELECT * FROM credit_ledger WHERE player_id = ?').all(w.byName[name]);

async function orgLateDrop(courtPaid: boolean) {
  const w = await world();
  const g = await game(w);
  expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
  await join(w, g.id, ['Blair', 'Casey', 'Devon']);
  if (courtPaid) expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: true })).status).toBe(200);
  w.app.now = g.start - 3 * HOUR;
  const out = await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
  expect(out.data.lateFee).toBeTruthy();
  return { w, g };
}

describe('review', () => {
  it('A: org late drop open + cancel No', async () => {
    const { w, g } = await orgLateDrop(true);
    console.log('before', seat(w, g.id, ORG), health(w));
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(r.status, r.text).toBe(200);
    console.log('A org row after No', JSON.stringify((await rowOf(w, g.id, ORG)).lateFee), seat(w, g.id, ORG), (await sessOf(w, g.id)).court, health(w));
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName[ORG], why: 'choice' });
    console.log('A clear', c.status, c.text, seat(w, g.id, ORG), ledger(w, ORG), (await sessOf(w, g.id)).court, health(w));
  });
  it('B: org late drop open + cancel Yes', async () => {
    const { w, g } = await orgLateDrop(true);
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: true });
    expect(r.status, r.text).toBe(200);
    console.log('B', seat(w, g.id, ORG), ledger(w, ORG), (await sessOf(w, g.id)).court, health(w), (await rowOf(w, g.id, ORG)).lateFee);
  });
  it('C: org late drop court unpaid, then court paid while out, then sub', async () => {
    const { w, g } = await orgLateDrop(false);
    console.log('C0', seat(w, g.id, ORG), JSON.stringify((await rowOf(w, g.id, ORG)).lateFee));
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: true })).status).toBe(200);
    await join(w, g.id, ['Emery']);
    console.log('C', seat(w, g.id, ORG), ledger(w, ORG), (await sessOf(w, g.id)).court, health(w));
  });
  it('D: org late drop open, game played, finalize', async () => {
    const { w, g } = await orgLateDrop(true);
    const s = await sessOf(w, g.id);
    w.app.now = Date.parse(s.endsAt) + HOUR;
    const d = await dash(w);
    const ss = d.sessions.find((x: any) => x.id === g.id);
    const played = ss.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.playerId);
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    console.log('D finalize', f.status, f.text.slice(0, 300));
    console.log('D', seat(w, g.id, ORG), ledger(w, ORG), (await sessOf(w, g.id)).court, health(w), JSON.stringify((await rowOf(w, g.id, ORG)).lateFee));
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName[ORG], why: 'choice' });
    console.log('D clear', c.status, seat(w, g.id, ORG), ledger(w, ORG), health(w));
  });
  it('E: unmark court while out with org debt, then clear', async () => {
    const { w, g } = await orgLateDrop(true);
    const u = await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: false });
    console.log('E unmark', u.status, seat(w, g.id, ORG), JSON.stringify((await rowOf(w, g.id, ORG)).lateFee));
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName[ORG], why: 'choice' });
    console.log('E clear', c.status, c.text, seat(w, g.id, ORG));
  });
  it('F: org late drop then player late drop; sub joins', async () => {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    w.app.now = g.start - 3 * HOUR;
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
    w.app.now += 1000;
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    w.app.now += 1000;
    await join(w, g.id, ['Emery']);
    console.log('F org', seat(w, g.id, ORG).late_drop_done_at, 'blair', seat(w, g.id, 'Blair').late_drop_done_at);
  });
  it('G: notices with switch off from earlier clears', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = g.start - 3 * HOUR;
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    await join(w, g.id, ['Frankie']);
    await admin(w, 'PUT', '/api/admin/late-fees', { on: false });
    const v = await view(w, 'Blair');
    console.log('G', v.lateFees, JSON.stringify(v.feeNotices));
  });
  it('H: org drops from the player site', async () => {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: true })).status).toBe(200);
    w.app.now = g.start - 3 * HOUR;
    const v0 = await view(w, ORG);
    console.log('H mine before', JSON.stringify(v0.sessions.find((s) => s.id === g.id)!.mine));
    const r = await call(w, ORG, 'POST', `/api/sessions/${g.id}/withdraw`, {});
    console.log('H', r.status, r.text, seat(w, g.id, ORG));
  });
});
