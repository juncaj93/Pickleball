// "Home collapse" (HOME_COLLAPSE, Nov 2026): the player Home shows only THIS WEEK and NEXT WEEK; every later game sits behind one
// "More sessions" button. This file tests the switch (header, Settings row, kill switch, stamp, log line) and that the server's answer is
// the same either way apart from the one flag. The layout itself is tested in the browser (e2e/zip6.cjs).
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { HOME_COLLAPSE_HEADER, homeCollapseAllowed } from '../shared/homeCollapse';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [HOME_COLLAPSE_HEADER]: 'on' };

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard');
  }
  return r.data;
}
const group = async (w: W, headers: Record<string, string> = {}) => (await (await playerPhone(w, 'Blair')).call('GET', '/api/group', undefined, headers)).data;

describe('HOME_COLLAPSE switch', () => {
  it('H1 the var is allowed unless it says off', () => {
    expect(homeCollapseAllowed(undefined)).toBe(true);
    expect(homeCollapseAllowed('on')).toBe(true);
    expect(homeCollapseAllowed(' Off ')).toBe(false);
  });
  it('H2 ships off: the player view carries no flag, the dashboard only the Settings row value', async () => {
    const w = await world();
    expect('homeCollapse' in (await group(w))).toBe(false);
    expect((await dash(w)).homeCollapseForAll).toBe(false);
  });
  it('H3 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await group(w, on)).homeCollapse).toBe(true);
    expect('homeCollapse' in (await group(w))).toBe(false);
    expect('homeCollapse' in (await group(w, { [HOME_COLLAPSE_HEADER]: 'yes' }))).toBe(false);
  });
  it('H4 the Settings switch turns it on for everyone and off again (no deploy), one row, logged, organizer only; players notice on their next check', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await w.organizer.call('PUT', '/api/admin/home-collapse-switch', { on: true })).status).toBe(200);
    await w.organizer.call('PUT', '/api/admin/home-collapse-switch', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'home_collapse_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await group(w)).homeCollapse).toBe(true);
    expect((await dash(w)).homeCollapseForAll).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === 'home_collapse_on');
    expect(activityText({ ...act }, 'America/Detroit', 'Alex')).toBe('Alex switched "Home collapse" on');
    expect((await w.app.client().call('PUT', '/api/admin/home-collapse-switch', { on: true })).status).toBe(401);
    expect((await blair.call('PUT', '/api/admin/home-collapse-switch', { on: false })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/home-collapse-switch', { on: false });
    expect('homeCollapse' in (await group(w))).toBe(false);
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(v0);
  });
  it('H5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ HOME_COLLAPSE: 'off' });
    await w.organizer.call('PUT', '/api/admin/home-collapse-switch', { on: true });
    expect('homeCollapse' in (await group(w, on))).toBe(false);
  });
  it('H6 the server sends the same games either way: the flag is the only difference', async () => {
    const w = await world();
    const off = await group(w);
    const withIt = await group(w, on);
    const { homeCollapse, ...rest } = withIt;
    expect(homeCollapse).toBe(true);
    expect(rest).toEqual(off);
  });
});
