// "Pay sheet" (PAY_SHEET, Nov 2026): the switch only. Ships OFF (Settings > Feature switches), a
// private test link (?paysheet=on sends the X-Pay-Sheet header), a kill switch var. Display only: nothing saved or
// charged depends on it. The sheet itself is checked in a real browser in e2e/pay-sheet.cjs. This file also covers the
// Apple Pay / Zelle number in Settings > Money (kept inside settings_json: no schema change).
import { describe, expect, it } from 'vitest';
import { PAY_SHEET_HEADER, paySheetAllowed } from '../shared/paySheet';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';
import { readdirSync, readFileSync } from 'node:fs';
import { DEFAULT_ZELLE_NUMBER, zelleNumberOf } from '../shared/settings';

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

describe('PAY_SHEET switch', () => {
  it('N1 the var is allowed unless it says off', () => {
    expect(paySheetAllowed(undefined)).toBe(true);
    expect(paySheetAllowed('on')).toBe(true);
    expect(paySheetAllowed(' OFF ')).toBe(false);
  });
  it('N2 ships OFF: nobody sees it, the Settings row is off', async () => {
    const w = await world();
    expect((await group(w, 'Alex')).paySheet).toBe(false);
    expect((await dash(w)).paySheetForAll).toBe(false);
  });
  it('N3 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await group(w, 'Alex', { [PAY_SHEET_HEADER]: 'on' })).paySheet).toBe(true);
    expect((await group(w, 'Alex', { [PAY_SHEET_HEADER]: 'yes' })).paySheet).toBe(false);
    expect((await group(w, 'Blair')).paySheet).toBe(false);
  });
  it('N4 Settings switch: on for everyone with no deploy, off again, one stored row', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/pay-sheet', { on: true })).data).toEqual({ ok: true, on: true });
    expect((await group(w, 'Alex')).paySheet).toBe(true);
    expect((await group(w, 'Blair')).paySheet).toBe(true);
    expect((await dash(w)).paySheetForAll).toBe(true);
    await w.organizer.call('PUT', '/api/admin/pay-sheet', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'pay_sheet_on'").first<{ n: number }>())?.n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/pay-sheet', { on: false })).data).toEqual({ ok: true, on: false });
    expect((await group(w, 'Alex')).paySheet).toBe(false);
    expect((await dash(w)).paySheetForAll).toBe(false);
  });
  it('N5 the kill switch beats the header and Settings', async () => {
    const w = await world({ PAY_SHEET: 'off' });
    await w.organizer.call('PUT', '/api/admin/pay-sheet', { on: true });
    expect((await group(w, 'Alex', { [PAY_SHEET_HEADER]: 'on' })).paySheet).toBe(false);
    expect((await group(w, 'Blair')).paySheet).toBe(false);
  });
  it('N6 the change shows in Activity and moves both change stamps (open phones pick it up)', async () => {
    const w = await world();
    const adminBefore = (await w.organizer.call('GET', '/api/admin/version')).data.v;
    const c = await playerPhone(w, 'Alex');
    const playerBefore = (await c.call('GET', '/api/group/version')).data.v;
    await w.organizer.call('PUT', '/api/admin/pay-sheet', { on: true });
    expect((await w.organizer.call('GET', '/api/admin/version')).data.v).not.toBe(adminBefore);
    expect((await c.call('GET', '/api/group/version')).data.v).not.toBe(playerBefore);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: { action: string }) => e.action === 'pay_sheet_on')).toBe(true);
  });
  it('N7 only the organizer can flip it', async () => {
    const w = await world();
    expect((await w.app.client().call('PUT', '/api/admin/pay-sheet', { on: true })).status).toBe(401);
  });
  it('N8 nothing else on the player screen changes with it on', async () => {
    const w = await world();
    const strip = (g: Record<string, unknown>) => {
      const { paySheet, version, now, ...rest } = g;
      return JSON.stringify(rest);
    };
    expect(strip(await group(w, 'Alex', { [PAY_SHEET_HEADER]: 'on' }))).toBe(strip(await group(w, 'Alex')));
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
    const on = (await c.call('GET', '/api/group', undefined, { [PAY_SHEET_HEADER]: 'on' })).data;
    const money = (g: Record<string, unknown>) => JSON.stringify([g.owed, g.payDue, g.credit, (g.sessions as { mine?: unknown }[]).map((s) => s.mine)]);
    expect(money(on)).toBe(money(off));
    expect(await books()).toBe(before);
  });
  it('N9 wrangler.toml allows it for production and for previews, and docs/FEATURE_SWITCHES.md lists it', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect((toml.match(/^PAY_SHEET = "on"$/gm) ?? []).length).toBe(2);
    expect(readFileSync('docs/FEATURE_SWITCHES.md', 'utf8')).toMatch(/`PAY_SHEET`/);
  });

  it('Z1 the Zelle number defaults to 248-247-9231 for players and the organizer, and nothing is stored until it is changed', async () => {
    const w = await world();
    expect(DEFAULT_ZELLE_NUMBER).toBe('248-247-9231');
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('248-247-9231');
    expect((await dash(w)).group.zelleNumber).toBe('248-247-9231');
    const row = await w.app.db.prepare('SELECT settings_json FROM groups LIMIT 1').first<{ settings_json: string }>();
    expect(JSON.parse(row!.settings_json).zelleNumber).toBeUndefined();
    expect(zelleNumberOf(row!.settings_json)).toBe('248-247-9231');
  });
  it('Z2 Settings > Money saves a new number, it shows to players, and saving other settings keeps it', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: '313-555-0142' })).status).toBe(200);
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('313-555-0142');
    await w.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1400 } });
    await w.organizer.call('PUT', '/api/admin/group', { venueName: 'Somewhere' });
    expect((await dash(w)).group.zelleNumber).toBe('313-555-0142');
    expect((await group(w, 'Blair')).group.zelleNumber).toBe('313-555-0142');
    // The numbers in settings still work as before.
    expect((await dash(w)).group.settings.pricePerPlayerCents).toBe(1400);
  });
  it('Z3 a blank number is kept as blank (no line on the sheet), not turned back into the default', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: null });
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('');
    await w.organizer.call('PUT', '/api/admin/group', { name: 'Pickleball Bros' });
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('');
    await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: '248-247-9231' });
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('248-247-9231');
  });
  it('Z4 something that is not a phone number is refused and nothing changes', async () => {
    const w = await world();
    for (const bad of ['hello', '12', '<b>1</b>', '248-247-9231; DROP TABLE players']) {
      const r = await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: bad });
      expect(r.status, bad).toBe(400);
    }
    expect((await group(w, 'Alex')).group.zelleNumber).toBe('248-247-9231');
    expect((await w.app.client().call('PUT', '/api/admin/group', { zelleNumber: '313-555-0142' })).status).toBe(401);
  });
  it('Z5 no schema change: the number lives in settings_json and the migrations folder is untouched', () => {
    const files = readdirSync('migrations').sort();
    expect(files[files.length - 1]).toBe('0016_time_confirmed.sql');
  });
});
