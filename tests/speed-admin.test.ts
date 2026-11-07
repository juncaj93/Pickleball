// Zip 12 step C, "Instant admin" (SPEED_LAST_SCREEN_ADMIN): the flag rides on the dashboard answer only while on (off: exactly as before), and the
// organizer phone's copy is kept only after a real-PIN sign-in and thrown away by the rules in src/lastAdmin.ts.
import { describe, expect, it, vi } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { buildSeed, previewPin } from '../scripts/seed-preview-world';
import { clearLastAdmin, LAST_ADMIN_KEY, readLastAdmin, saveLastAdmin } from '../src/lastAdmin';
import type { AdminDashboard } from '../shared/api';
import { LAST_SCREEN_MAX_AGE_MS } from '../shared/speed';

vi.setConfig({ testTimeout: 60_000 });
const AT = Date.parse('2026-11-07T17:00:00.000Z');
const RO = '97531864';

async function world(env: Record<string, string> = {}) {
  const { sql } = await buildSeed(AT);
  const raw = createNodeD1(':memory:');
  raw.raw.exec(sql);
  raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task LIKE 'speed_%'");
  const e: any = { DB: raw, ORGANIZER_READONLY_PIN: RO, ...env };
  const call = async (method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    h.set('Origin', 'https://preview.example');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e, AT, () => {});
    const text = await res.text();
    return { status: res.status, text, data: JSON.parse(text), cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
  };
  const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).cookie;
  return { call, admin, env: e };
}
class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('Instant admin on the dashboard answer', () => {
  it('off: no new field at all; the private link or the Settings row turns it on; the kill switch wins', async () => {
    const w = await world();
    const off = (await w.call('GET', '/api/admin/dashboard', w.admin)).data;
    expect('lastScreenAdmin' in off).toBe(false);
    expect('speedLastScreenAdminForAll' in off).toBe(false);
    expect((await w.call('GET', '/api/admin/dashboard', w.admin, undefined, { 'X-Last-Screen-Admin': 'on' })).data.lastScreenAdmin).toBe(true);
    expect((await w.call('PUT', '/api/admin/speed-last-screen-admin-switch', w.admin, { on: true })).status).toBe(200);
    const on = (await w.call('GET', '/api/admin/dashboard', w.admin)).data;
    expect([on.lastScreenAdmin, on.speedLastScreenAdminForAll]).toEqual([true, true]);
    expect(on.audit.some((a: any) => a.action === 'speed_last_screen_admin_on')).toBe(true);
    w.env.SPEED_LAST_SCREEN_ADMIN = 'off';
    expect((await w.call('GET', '/api/admin/dashboard', w.admin, undefined, { 'X-Last-Screen-Admin': 'on' })).data.lastScreenAdmin).toBeUndefined();
  });
  it('the read-only PIN cannot switch it', async () => {
    const w = await world();
    const ro = (await w.call('POST', '/api/admin/login', '', { pin: RO })).cookie;
    expect((await w.call('PUT', '/api/admin/speed-last-screen-admin-switch', ro, { on: true })).status).toBe(403);
  });
});

describe('the organizer copy (src/lastAdmin.ts)', () => {
  async function answers() {
    const w = await world();
    const real = (await w.call('GET', '/api/admin/dashboard', w.admin, undefined, { 'X-Last-Screen-Admin': 'on' })).data as AdminDashboard;
    const ro = (await w.call('POST', '/api/admin/login', '', { pin: RO })).cookie;
    const view = (await w.call('GET', '/api/admin/dashboard', ro, undefined, { 'X-Last-Screen-Admin': 'on' })).data as AdminDashboard;
    const off = (await w.call('GET', '/api/admin/dashboard', w.admin)).data as AdminDashboard;
    return { real, view, off };
  }
  it('kept only after a real-PIN answer with the switch on; never for the read-only PIN, Pretend or the demo; off drops it', async () => {
    const { real, view, off } = await answers();
    const store = new MemStore();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    expect(readLastAdmin(AT + 1000, store)?.view.group.name).toBe(real.group.name);
    expect(view.viewOnly).toBe(true);
    saveLastAdmin(view, { pretend: false, demo: false }, AT, store);
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    saveLastAdmin(real, { pretend: true, demo: false }, AT, store);
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    saveLastAdmin(real, { pretend: false, demo: true }, AT, store);
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    saveLastAdmin(off, { pretend: false, demo: false }, AT, store);
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
  });
  it('older than 3 hours, another build, unreadable: not shown, dropped; clear() empties it', async () => {
    const { real } = await answers();
    const store = new MemStore();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    expect(readLastAdmin(AT + LAST_SCREEN_MAX_AGE_MS - 1, store)).not.toBeNull();
    expect(readLastAdmin(AT + LAST_SCREEN_MAX_AGE_MS, store)).toBeNull();
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    store.setItem(LAST_ADMIN_KEY, JSON.stringify({ ...JSON.parse(store.getItem(LAST_ADMIN_KEY)!), build: 'older' }));
    expect(readLastAdmin(AT + 1000, store)).toBeNull();
    store.setItem(LAST_ADMIN_KEY, '{nope');
    expect(readLastAdmin(AT, store)).toBeNull();
    saveLastAdmin(real, { pretend: false, demo: false }, AT, store);
    clearLastAdmin(store);
    expect(store.getItem(LAST_ADMIN_KEY)).toBeNull();
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(readLastAdmin(AT, broken)).toBeNull();
    expect(() => saveLastAdmin(real, { pretend: false, demo: false }, AT, broken)).not.toThrow();
  });
});
