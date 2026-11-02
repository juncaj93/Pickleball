// "New admin layout" (ADMIN_V2, Nov 2026): the switch only. The screens themselves are checked in e2e/admin-v2.cjs.
// Display only: nothing that is saved, charged or sent may depend on it.
import { describe, expect, it } from 'vitest';
import { ADMIN_V2_HEADER, adminV2Allowed } from '../shared/adminV2';
import { PIN, setupGroup, TestApp } from './harness';

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
