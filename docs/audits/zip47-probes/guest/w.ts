// Zip 47 audit probes (guest spot money). Helpers copied from tests/guest-spot.test.ts world().
import { expect } from 'vitest';
import { GUEST_SPOT } from '../../../shared/guestSpot';
import { LATE_FEES_HEADER } from '../../../shared/lateFees';
import type { GroupView } from '../../../shared/api';
import { activityText } from '../../../shared/activity';
import { type Client, HOUR, PIN, setupGroup, TestApp } from '../../harness';

export const ORG = 'Alex';
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
export { HOUR };

export async function world(opts: { on?: 'settings' | 'header' | 'off'; maxPlayers?: number; lateFees?: boolean; env?: Record<string, string> } = {}) {
  const app = new TestApp();
  Object.assign(app.env, opts.env ?? {});
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: ORG };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  for (const [i, n] of EXTRA.entries()) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-03${String(i).padStart(2, '0')}` });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  const on = opts.on ?? 'settings';
  if (on === 'settings') {
    const r = await ctx.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true });
    expect(r.status, r.text).toBe(200);
  }
  if (opts.lateFees) expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  const headers: Record<string, string> = on === 'header' ? { [GUEST_SPOT.header]: 'on' } : {};
  if (opts.lateFees) headers[LATE_FEES_HEADER] = 'on';
  return { ...ctx, headers, phones: new Map<string, Client>() };
}
export type W = Awaited<ReturnType<typeof world>>;

export async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
export async function phone(w: W, name: string): Promise<Client> {
  let c = w.phones.get(name);
  if (!c) {
    c = w.app.client();
    c.groupKey = w.groupKey;
    const res = await c.call('POST', '/api/me', { playerId: w.byName[name] });
    if (res.status !== 200) throw new Error(`pick name failed: ${res.text}`);
    w.phones.set(name, c);
  }
  return c;
}
export const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body, w.headers);
export const admin = (w: W, method: string, path: string, body?: unknown) => w.organizer.call(method, path, body, w.headers);
export async function view(w: W, name: string): Promise<GroupView> {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
export async function game(w: W, nth = 0) {
  const d = await dash(w);
  const s = d.sessions.filter((x: any) => Date.parse(x.startsAt) > w.app.now && !x.state.flags.canceled)[nth];
  return { id: s.id as string, start: Date.parse(s.startsAt) };
}
export async function join(w: W, sid: string, names: string[]) {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
}
export const addGuest = (w: W, sid: string, host: string, name = 'Sam') => admin(w, 'POST', `/api/admin/sessions/${sid}/guest`, { playerId: w.byName[host], name });
export async function adminGame(w: W, sid: string) {
  return (await dash(w)).sessions.find((s: any) => s.id === sid);
}
export async function rowOf(w: W, sid: string, n: string) {
  return (await adminGame(w, sid)).roster.find((x: any) => x.name === n);
}
export async function mineOn(w: W, name: string, sid: string) {
  return (await view(w, name)).sessions.find((s) => s.id === sid)!;
}
export async function credit(w: W, name: string): Promise<number> {
  const d = await dash(w);
  return d.creditLedger?.find((c: any) => c.playerId === w.byName[name])?.balanceCents ?? 0;
}
export const markPaid = (w: W, sid: string, name: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: true });
export const drop = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/withdraw`, {});
export const removeOwn = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/remove-guest`, {});
export const adminRemoveGuest = (w: W, sid: string, host: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/guest/remove`, { playerId: w.byName[host] });
export const finalize = (w: W, sid: string, body: unknown) => admin(w, 'POST', `/api/admin/sessions/${sid}/finalize`, body);
export const ids = (w: W, names: string[]) => names.map((n) => w.byName[n]);
export async function lines(w: W, start: number) {
  return (await dash(w)).audit.map((a: any) => activityText({ ...a, sessionStartsAt: new Date(start).toISOString() }, 'America/Detroit', ORG));
}
/** Raw SQL read on the fake DB. */
export const raw = (w: W, sql: string, ...args: unknown[]) => (w.app.db as any).raw.prepare(sql).all(...args);
/** Every ledger row of a player, for the books. */
export const ledger = (w: W, name: string) => raw(w, 'SELECT kind, amount_cents, reason, session_id, ended_at, ended_reason FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid', w.byName[name]);
export async function money(w: W, month = '2026-10') {
  const r = await admin(w, 'GET', `/api/admin/money?month=${month}`);
  expect(r.status, r.text).toBe(200);
  return r.data;
}
