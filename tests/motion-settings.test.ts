// Zip 6, item 12: the two animation switches (MOTION for the player screens, MOTION_ADMIN for the organizer screens) now have rows in
// Settings > Feature switches, next to every other switch. Behavior unchanged: with nobody touching a row, each works exactly as it did
// (the wrangler.toml value rules, the private ?motion=on / ?motionadmin=on phone links work). A row flip works with no deploy.
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { MOTION_ADMIN_HEADER, MOTION_HEADER } from '../shared/motion';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const player = async (w: W, headers: Record<string, string> = {}) => (await (await playerPhone(w, 'Blair')).call('GET', '/api/group', undefined, headers)).data;
const flip = (w: W, which: 'player' | 'admin', on: boolean) => w.organizer.call('PUT', '/api/admin/motion-switch', { which, on });

describe('Motion switches: behavior is unchanged until a Settings row is touched', () => {
  it('M1 var on, no row: both on for everyone (as live today); the rows read On; nothing was added to the database', async () => {
    const w = await world({ MOTION: 'on', MOTION_ADMIN: 'on' });
    expect((await player(w)).motion).toBe(true);
    const d = await dash(w);
    expect(d.motion).toBe(true);
    expect(d.motionPlayersForAll).toBe(true);
    expect(d.motionAdminForAll).toBe(true);
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'motion%'").first<{ n: number }>())?.n).toBe(0);
  });
  it('M2 var not on, no row: both dark; only a phone with its private link sees it (the player link and the organizer link are separate)', async () => {
    const w = await world();
    expect((await player(w)).motion).toBe(false);
    expect((await dash(w)).motion).toBe(false);
    expect((await dash(w)).motionPlayersForAll).toBe(false);
    expect((await player(w, { [MOTION_HEADER]: 'on' })).motion).toBe(true);
    expect((await dash(w, { [MOTION_ADMIN_HEADER]: 'on' })).motion).toBe(true);
    // The player phone's link does not turn on the organizer side, and the other way round.
    expect((await dash(w, { [MOTION_HEADER]: 'on' })).motion).toBe(false);
    expect((await player(w, { [MOTION_ADMIN_HEADER]: 'on' })).motion).toBe(false);
  });
  it('M3 the stamp players poll is unchanged while no row is touched: flipping a row changes it, putting it back gives the very same stamp', async () => {
    const w = await world({ MOTION: 'on' });
    const blair = await playerPhone(w, 'Blair');
    const stamp = async () => (await blair.call('GET', '/api/group/version')).data.v;
    const v0 = await stamp();
    expect(await stamp()).toBe(v0);
    await flip(w, 'player', false);
    expect(await stamp()).not.toBe(v0);
    await flip(w, 'player', true);
    expect(await stamp()).toBe(v0);
  });
});

describe('Motion switches: the Settings rows', () => {
  it('M4 turning players\' animations off in Settings works at once, for everyone, with no deploy; the private link still shows them', async () => {
    const w = await world({ MOTION: 'on', MOTION_ADMIN: 'on' });
    const v0 = (await (await playerPhone(w, 'Blair')).call('GET', '/api/group/version')).data.v;
    expect((await flip(w, 'player', false)).status).toBe(200);
    expect((await player(w)).motion).toBe(false);
    expect((await dash(w)).motionPlayersForAll).toBe(false);
    // Only the player side changed: the organizer's own switch is untouched.
    expect((await dash(w)).motion).toBe(true);
    expect((await dash(w)).motionAdminForAll).toBe(true);
    expect((await player(w, { [MOTION_HEADER]: 'on' })).motion).toBe(true);
    // Players' screens notice on their next 5-second check.
    expect((await (await playerPhone(w, 'Blair')).call('GET', '/api/group/version')).data.v).not.toBe(v0);
  });
  it('M5 turning the organizer animations off works the same way, and on again clears the row (the wrangler.toml value rules again)', async () => {
    const w = await world({ MOTION: 'on', MOTION_ADMIN: 'on' });
    await flip(w, 'admin', false);
    expect((await dash(w)).motion).toBe(false);
    expect((await dash(w)).motionAdminForAll).toBe(false);
    expect((await dash(w, { [MOTION_ADMIN_HEADER]: 'on' })).motion).toBe(true);
    await flip(w, 'admin', true);
    expect((await dash(w)).motion).toBe(true);
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'motion%'").first<{ n: number }>())?.n).toBe(0);
  });
  it('M6 a row can also turn it on when wrangler.toml has it dark', async () => {
    const w = await world();
    await flip(w, 'player', true);
    await flip(w, 'admin', true);
    expect((await player(w)).motion).toBe(true);
    expect((await dash(w)).motion).toBe(true);
    await flip(w, 'player', false);
    expect((await player(w)).motion).toBe(false);
  });
  it('M7 each flip is logged in plain words, organizer only, and a bad value is refused', async () => {
    const w = await world({ MOTION: 'on', MOTION_ADMIN: 'on' });
    await flip(w, 'player', false);
    await flip(w, 'admin', false);
    const acts = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    const text = (action: string) => activityText({ ...acts.find((e: { action: string }) => e.action === action) }, 'America/Detroit', 'Alex');
    expect(text('motion_off')).toBe('Alex switched the player animations off');
    expect(text('motion_admin_off')).toBe('Alex switched the organizer animations off');
    expect((await w.app.client().call('PUT', '/api/admin/motion-switch', { which: 'player', on: true })).status).toBe(401);
    expect((await (await playerPhone(w, 'Blair')).call('PUT', '/api/admin/motion-switch', { which: 'player', on: true })).status).toBe(401);
    expect((await w.organizer.call('PUT', '/api/admin/motion-switch', { which: 'everyone', on: true })).status).toBe(400);
    expect((await w.organizer.call('PUT', '/api/admin/motion-switch', { which: 'player' })).status).toBe(400);
  });
  it('M8 the demo (View as) follows the row like the live site (Zip 18: it no longer always shows motion)', async () => {
    const w = await world({ MOTION: 'on' });
    await flip(w, 'player', false);
    w.app.env.SANDBOX = true;
    expect((await player(w)).motion).toBe(false);
    await flip(w, 'player', true);
    expect((await player(w)).motion).toBe(true);
  });
});
