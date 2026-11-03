// "Player screen small fixes, round 1" (PLAYER_FIX1, Nov 2026): the switch only. Ships OFF (Settings > Feature switches), a
// private test link (?playerfix1=on sends the X-Player-Fix1 header), a kill switch var. Display only: nothing saved or
// charged depends on it. The two fixes themselves (Pay and I paid on tonight's card, the roomier TONIGHT tag) are checked
// in a real browser in e2e/player-fix1.cjs.
import { describe, expect, it } from 'vitest';
import { PLAYER_FIX1_HEADER, playerFix1Allowed } from '../shared/playerFix1';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';
import { readFileSync } from 'node:fs';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  return setupGroup(app);
}
const dash = async (w: Awaited<ReturnType<typeof world>>) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard');
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const group = async (w: Awaited<ReturnType<typeof world>>, name: string, headers: Record<string, string> = {}) => {
  const c = await playerPhone(w, name);
  return (await c.call('GET', '/api/group', undefined, headers)).data;
};

describe('PLAYER_FIX1 switch', () => {
  it('N1 the var is allowed unless it says off', () => {
    expect(playerFix1Allowed(undefined)).toBe(true);
    expect(playerFix1Allowed('on')).toBe(true);
    expect(playerFix1Allowed(' OFF ')).toBe(false);
  });
  it('N2 ships OFF: nobody sees it, the Settings row is off', async () => {
    const w = await world();
    expect((await group(w, 'Alex')).playerFix1).toBe(false);
    expect((await dash(w)).playerFix1ForAll).toBe(false);
  });
  it('N3 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await group(w, 'Alex', { [PLAYER_FIX1_HEADER]: 'on' })).playerFix1).toBe(true);
    expect((await group(w, 'Alex', { [PLAYER_FIX1_HEADER]: 'yes' })).playerFix1).toBe(false);
    expect((await group(w, 'Blair')).playerFix1).toBe(false);
  });
  it('N4 Settings switch: on for everyone with no deploy, off again, one stored row', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/player-fix1', { on: true })).data).toEqual({ ok: true, on: true });
    expect((await group(w, 'Alex')).playerFix1).toBe(true);
    expect((await group(w, 'Blair')).playerFix1).toBe(true);
    expect((await dash(w)).playerFix1ForAll).toBe(true);
    await w.organizer.call('PUT', '/api/admin/player-fix1', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'player_fix1_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/player-fix1', { on: false })).data).toEqual({ ok: true, on: false });
    expect((await group(w, 'Alex')).playerFix1).toBe(false);
    expect((await dash(w)).playerFix1ForAll).toBe(false);
  });
  it('N5 the kill switch beats the header and Settings', async () => {
    const w = await world({ PLAYER_FIX1: 'off' });
    await w.organizer.call('PUT', '/api/admin/player-fix1', { on: true });
    expect((await group(w, 'Alex', { [PLAYER_FIX1_HEADER]: 'on' })).playerFix1).toBe(false);
    expect((await group(w, 'Blair')).playerFix1).toBe(false);
  });
  it('N6 the change shows in Activity and moves both change stamps (open phones pick it up)', async () => {
    const w = await world();
    const adminBefore = (await w.organizer.call('GET', '/api/admin/version')).data.v;
    const c = await playerPhone(w, 'Alex');
    const playerBefore = (await c.call('GET', '/api/group/version')).data.v;
    await w.organizer.call('PUT', '/api/admin/player-fix1', { on: true });
    expect((await w.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(adminBefore);
    expect((await c.call('GET', '/api/group/version')).data.v).not.toBe(playerBefore);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: { action: string }) => e.action === 'player_fix1_on')).toBe(true);
  });
  it('N7 only the organizer can flip it', async () => {
    const w = await world();
    expect((await w.app.client().call('PUT', '/api/admin/player-fix1', { on: true })).status).toBe(401);
  });
  it('N8 nothing else on the player screen changes with it on', async () => {
    const w = await world();
    const strip = (g: Record<string, unknown>) => {
      const { playerFix1, version, now, ...rest } = g;
      return JSON.stringify(rest);
    };
    expect(strip(await group(w, 'Alex', { [PLAYER_FIX1_HEADER]: 'on' }))).toBe(strip(await group(w, 'Alex')));
  });
  it('N8b a seat owing $14 on game day shows the same amounts, owed list and top-card list with it on or off, and looking moves no money', async () => {
    const w = await world();
    const sessions = (await w.organizer.call('GET', '/api/admin/dashboard')).data.sessions;
    const first = sessions.find((s: { state: { flags: { past: boolean } } }) => !s.state.flags.past);
    await w.organizer.call('POST', `/api/admin/sessions/${first.id}/booked`, {});
    const c = await playerPhone(w, 'Blair');
    await c.call('POST', `/api/sessions/${first.id}/join`, {});
    const books = async () => JSON.stringify((await w.organizer.call('GET', '/api/admin/dashboard')).data.sessions.map((s: { roster: unknown[] }) => s.roster));
    const before = await books();
    const off = (await c.call('GET', '/api/group')).data;
    const on = (await c.call('GET', '/api/group', undefined, { [PLAYER_FIX1_HEADER]: 'on' })).data;
    const money = (g: Record<string, unknown>) => JSON.stringify([g.owed, g.payDue, g.credit, (g.sessions as { mine?: unknown }[]).map((s) => s.mine)]);
    expect(money(on)).toBe(money(off));
    expect(await books()).toBe(before);
  });
  it('N9 wrangler.toml allows it for production and for previews, and docs/FEATURE_SWITCHES.md lists it', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect((toml.match(/^PLAYER_FIX1 = "on"$/gm) ?? []).length).toBe(2);
    expect(readFileSync('docs/FEATURE_SWITCHES.md', 'utf8')).toMatch(/`PLAYER_FIX1`/);
  });
});
