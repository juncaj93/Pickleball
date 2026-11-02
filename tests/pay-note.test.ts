// "No Venmo? Pay Alex directly" (PAY_NOTE, Nov 2026): the switch only. Ships OFF (Settings > Feature switches), a private
// test link (?paynote=on sends the X-Pay-Note header), a kill switch var. Display only: nothing saved or charged depends on it.
// The note itself (timing, hidden page, first name) is checked in tests/venmo-fallback.test.ts and e2e/layout-polish.cjs.
import { describe, expect, it } from 'vitest';
import { PAY_NOTE_HEADER, payNoteAllowed } from '../shared/payNote';
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

describe('PAY_NOTE switch', () => {
  it('N1 the var is allowed unless it says off', () => {
    expect(payNoteAllowed(undefined)).toBe(true);
    expect(payNoteAllowed('on')).toBe(true);
    expect(payNoteAllowed(' OFF ')).toBe(false);
  });
  it('N2 ships OFF: nobody sees it, the Settings row is off', async () => {
    const w = await world();
    expect((await group(w, 'Alex')).payNote).toBe(false);
    expect((await dash(w)).payNoteForAll).toBe(false);
  });
  it('N3 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await group(w, 'Alex', { [PAY_NOTE_HEADER]: 'on' })).payNote).toBe(true);
    expect((await group(w, 'Alex', { [PAY_NOTE_HEADER]: 'yes' })).payNote).toBe(false);
    expect((await group(w, 'Blair')).payNote).toBe(false);
  });
  it('N4 Settings switch: on for everyone with no deploy, off again, one stored row', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/pay-note', { on: true })).data).toEqual({ ok: true, on: true });
    expect((await group(w, 'Alex')).payNote).toBe(true);
    expect((await group(w, 'Blair')).payNote).toBe(true);
    expect((await dash(w)).payNoteForAll).toBe(true);
    await w.organizer.call('PUT', '/api/admin/pay-note', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'pay_note_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/pay-note', { on: false })).data).toEqual({ ok: true, on: false });
    expect((await group(w, 'Alex')).payNote).toBe(false);
    expect((await dash(w)).payNoteForAll).toBe(false);
  });
  it('N5 the kill switch beats the header and Settings', async () => {
    const w = await world({ PAY_NOTE: 'off' });
    await w.organizer.call('PUT', '/api/admin/pay-note', { on: true });
    expect((await group(w, 'Alex', { [PAY_NOTE_HEADER]: 'on' })).payNote).toBe(false);
    expect((await group(w, 'Blair')).payNote).toBe(false);
  });
  it('N6 the change shows in Activity and moves both change stamps (open phones pick it up)', async () => {
    const w = await world();
    const adminBefore = (await w.organizer.call('GET', '/api/admin/version')).data.v;
    const c = await playerPhone(w, 'Alex');
    const playerBefore = (await c.call('GET', '/api/group/version')).data.v;
    await w.organizer.call('PUT', '/api/admin/pay-note', { on: true });
    expect((await w.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(adminBefore);
    expect((await c.call('GET', '/api/group/version')).data.v).not.toBe(playerBefore);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: { action: string }) => e.action === 'pay_note_on')).toBe(true);
  });
  it('N7 only the organizer can flip it', async () => {
    const w = await world();
    expect((await w.app.client().call('PUT', '/api/admin/pay-note', { on: true })).status).toBe(401);
  });
  it('N8 nothing else on the player screen changes with it on', async () => {
    const w = await world();
    const strip = (g: Record<string, unknown>) => {
      const { payNote, version, now, ...rest } = g;
      return JSON.stringify(rest);
    };
    expect(strip(await group(w, 'Alex', { [PAY_NOTE_HEADER]: 'on' }))).toBe(strip(await group(w, 'Alex')));
  });
  it('N9 wrangler.toml allows it for production and for previews, and docs/FEATURE_SWITCHES.md lists it', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect((toml.match(/^PAY_NOTE = "on"$/gm) ?? []).length).toBe(2);
    expect(readFileSync('docs/FEATURE_SWITCHES.md', 'utf8')).toMatch(/`PAY_NOTE`/);
  });
});
