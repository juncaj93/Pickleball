// Zip 49 (money fixes from Audit C): the fake world for tests/zip49-money.test.ts. Started from the Zip 47 audit probes' helpers.
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { expect } from 'vitest';
import type { GroupView } from '../shared/api';
import { activityText } from '../shared/activity';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';

export const ORG = 'Alex';
export const PRICE = 1400;
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
export { HOUR };
const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

export interface Opts {
  lateFees?: boolean;
  guests?: boolean;
  split?: boolean;
  cheaper?: boolean;
  maxPlayers?: number;
  env?: Record<string, string>;
}

export async function world(opts: Opts = {}) {
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
  if (opts.guests) expect((await ctx.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true })).status).toBe(200);
  if (opts.lateFees ?? true) expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  if (opts.split) expect((await ctx.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
  if (opts.cheaper) expect((await ctx.organizer.call('PUT', '/api/admin/cheaper-fix-switch', { on: true })).status).toBe(200);
  const headers: Record<string, string> = {};
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
  return { id: s.id as string, start: Date.parse(s.startsAt), end: Date.parse(s.endsAt) };
}
export async function join(w: W, sid: string, names: string[]) {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
}
export async function orgIn(w: W, sid: string, inn = true) {
  const r = await admin(w, 'POST', `/api/admin/sessions/${sid}/me`, { in: inn });
  expect(r.status, r.text).toBe(200);
  return r.data;
}
export const drop = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/withdraw`, {});
  expect(r.status, r.text).toBe(200);
  return r.data;
};
export const markPaid = async (w: W, sid: string, name: string) => {
  const r = await admin(w, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: true });
  expect(r.status, r.text).toBe(200);
};
export const addGuest = (w: W, sid: string, host: string, name = 'Sam') => admin(w, 'POST', `/api/admin/sessions/${sid}/guest`, { playerId: w.byName[host], name });
export const sessOf = async (w: W, sid: string) => (await dash(w)).sessions.find((s: any) => s.id === sid);
export const rowOf = async (w: W, sid: string, name: string) => (await sessOf(w, sid)).roster.find((r: any) => r.name === name);
export const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
export const owedOf = async (w: W, name: string, sid: string) => (await view(w, name)).owed.find((o) => o.sessionId === sid) ?? null;
export const mineOn = async (w: W, name: string, sid: string) => (await view(w, name)).sessions.find((s) => s.id === sid)!;
export function health(w: W) {
  const raw = (w.app.db as any).raw;
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
export const at = (w: W, start: number, h: number) => {
  w.app.now = start - h * HOUR;
};
export const finalize = (w: W, sid: string, played: string[], extra: Record<string, unknown> = {}) =>
  admin(w, 'POST', `/api/admin/sessions/${sid}/finalize`, { played: played.map((n) => w.byName[n]), ...extra });
export const roster = (w: W, sid: string, name: string, action: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.byName[name], action });
export const ids = (w: W, names: string[]) => names.map((n) => w.byName[n]);
/** The pot balance as the organizer sees it. */
export async function credit(w: W, name: string): Promise<number> {
  const d = await dash(w);
  return d.creditLedger?.find((c: any) => c.playerId === w.byName[name])?.balanceCents ?? 0;
}
/** Every History line, in plain words. */
export async function lines(w: W, start: number): Promise<string[]> {
  return (await dash(w)).audit.map((a: any) => activityText({ ...a, sessionStartsAt: new Date(start).toISOString() }, 'America/Detroit', ORG));
}
export const selfPaid = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/paid`, { paid: true });
  expect(r.status, r.text).toBe(200);
};
