// Zip 7 (Nov 2026): Tonight glow (TONIGHT_GLOW), Color cleanup (COLOR_CLEANUP), Simpler player cards (PLAYER_CARDS_SIMPLE).
// Tested here: the tonight/tomorrow rule in Eastern time (never reads today's real date), the three switches (header, Settings row, kill switch,
// stamp, log line, "off = same as today"), and the color tokens in src/zip7.css. The look itself is tested in the browser (e2e/zip7.cjs).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { COLOR_CLEANUP_HEADER, PLAYER_CARDS_HEADER, TONIGHT_GLOW_HEADER, tileDay, zip7Allowed } from '../shared/zip7';
import { zonedTimeToUtc } from '../shared/time';
import { PIN, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const at = (y: number, m: number, d: number, h: number, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);
const iso = (ms: number) => new Date(ms).toISOString();

describe('tonight / tomorrow tags (Eastern time)', () => {
  const game = iso(at(2026, 11, 5, 20)); // Thu Nov 5, 8:00 PM ET
  it('Z1 game day is tonight, the day before is tomorrow, other days have no tag', () => {
    expect(tileDay(game, TZ, at(2026, 11, 5, 9), true)).toBe('tonight');
    expect(tileDay(game, TZ, at(2026, 11, 4, 9), true)).toBe('tomorrow');
    expect(tileDay(game, TZ, at(2026, 11, 3, 9), true)).toBeNull();
    expect(tileDay(game, TZ, at(2026, 11, 6, 9), true)).toBeNull();
  });
  it('Z2 just before and just after midnight Eastern', () => {
    expect(tileDay(game, TZ, at(2026, 11, 4, 23, 59), true)).toBe('tomorrow');
    expect(tileDay(game, TZ, at(2026, 11, 5, 0, 1), true)).toBe('tonight');
    // 11:59 PM that night: still game day for a game that has not started (a late game).
    const late = iso(at(2026, 11, 5, 23, 30));
    expect(tileDay(late, TZ, at(2026, 11, 5, 23, 59), true)).toBe('tonight');
    expect(tileDay(late, TZ, at(2026, 11, 6, 0, 1), true)).toBeNull();
  });
  it('Z3 a UTC date that has already rolled over does not matter (9 PM ET is the next day in UTC)', () => {
    const now = at(2026, 11, 5, 21); // 02:00Z on Nov 6
    expect(iso(now).startsWith('2026-11-06')).toBe(true);
    expect(tileDay(iso(at(2026, 11, 5, 22)), TZ, now, true)).toBe('tonight');
    expect(tileDay(iso(at(2026, 11, 6, 19)), TZ, now, true)).toBe('tomorrow');
  });
  it('Z4 daylight saving: the fall-back day (Nov 1, 2026, 25 hours) and the spring-forward day (Mar 8, 2026, 23 hours)', () => {
    // Fall back: Sun Nov 1. A Sat Oct 31 evening "now" and a Sun Nov 1 evening game: tomorrow, whichever hour.
    const sun = iso(at(2026, 11, 1, 19));
    expect(tileDay(sun, TZ, at(2026, 10, 31, 0, 30), true)).toBe('tomorrow');
    expect(tileDay(sun, TZ, at(2026, 10, 31, 23, 59), true)).toBe('tomorrow');
    expect(tileDay(sun, TZ, at(2026, 11, 1, 0, 1), true)).toBe('tonight');
    // The repeated 1 AM hour on Nov 1 is still game day.
    expect(tileDay(sun, TZ, Date.parse('2026-11-01T05:30:00Z'), true)).toBe('tonight'); // 1:30 AM EDT
    expect(tileDay(sun, TZ, Date.parse('2026-11-01T06:30:00Z'), true)).toBe('tonight'); // 1:30 AM EST
    // Spring forward: Sun Mar 8.
    const mar = iso(at(2026, 3, 8, 19));
    expect(tileDay(mar, TZ, at(2026, 3, 7, 23, 59), true)).toBe('tomorrow');
    expect(tileDay(mar, TZ, at(2026, 3, 8, 0, 1), true)).toBe('tonight');
    expect(tileDay(mar, TZ, at(2026, 3, 8, 3, 30), true)).toBe('tonight');
    expect(tileDay(iso(at(2026, 3, 9, 19)), TZ, at(2026, 3, 8, 18), true)).toBe('tomorrow');
  });
  it('Z5 a canceled or started game wears no tag; month and year ends work', () => {
    expect(tileDay(game, TZ, at(2026, 11, 5, 9), false)).toBeNull();
    expect(tileDay(iso(at(2027, 1, 1, 19)), TZ, at(2026, 12, 31, 12), true)).toBe('tomorrow');
    expect(tileDay(iso(at(2026, 12, 1, 19)), TZ, at(2026, 11, 30, 12), true)).toBe('tomorrow');
  });
});

const SWITCHES = [
  { name: 'tonight glow', header: TONIGHT_GLOW_HEADER, flag: 'tonightGlow', all: 'tonightGlowForAll', path: '/api/admin/tonight-glow-switch', task: 'tonight_glow_on', var: 'TONIGHT_GLOW', log: 'Tonight glow' },
  { name: 'color cleanup', header: COLOR_CLEANUP_HEADER, flag: 'colorCleanup', all: 'colorCleanupForAll', path: '/api/admin/color-cleanup-switch', task: 'color_cleanup_on', var: 'COLOR_CLEANUP', log: 'Color cleanup' },
  { name: 'simpler player cards', header: PLAYER_CARDS_HEADER, flag: 'playerCardsSimple', all: 'playerCardsSimpleForAll', path: '/api/admin/player-cards-switch', task: 'player_cards_on', var: 'PLAYER_CARDS_SIMPLE', log: 'Simpler player cards' },
] as const;

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
  return r.data;
}
const group = async (w: W, headers: Record<string, string> = {}) => (await (await playerPhone(w, 'Blair')).call('GET', '/api/group', undefined, headers)).data;

it('Z0 the kill switch var is allowed unless it says off', () => {
  expect(zip7Allowed(undefined)).toBe(true);
  expect(zip7Allowed('on')).toBe(true);
  expect(zip7Allowed(' OFF ')).toBe(false);
});

describe.each(SWITCHES)('$name switch', (sw) => {
  it('ships off: no flag on the player view or the dashboard, only the Settings row value', async () => {
    const w = await world();
    expect(sw.flag in (await group(w))).toBe(false);
    const d = await dash(w);
    expect(sw.flag in d).toBe(false);
    expect(d[sw.all]).toBe(false);
  });
  it('the private header turns it on for that phone only (player and organizer screens)', async () => {
    const w = await world();
    expect((await group(w, { [sw.header]: 'on' }))[sw.flag]).toBe(true);
    expect(sw.flag in (await group(w))).toBe(false);
    expect((await dash(w, { [sw.header]: 'on' }))[sw.flag]).toBe(true);
    expect(sw.flag in (await group(w, { [sw.header]: 'yes' }))).toBe(false);
  });
  it('the Settings switch turns it on for everyone and off again; one row, logged, organizer only; players notice on their next check', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const v0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await w.organizer.call('PUT', sw.path, { on: true })).status).toBe(200);
    await w.organizer.call('PUT', sw.path, { on: true });
    expect((await w.app.db.prepare('SELECT COUNT(*) AS n FROM task_log WHERE task = ?').bind(sw.task).first<{ n: number }>())?.n).toBe(1);
    expect((await group(w))[sw.flag]).toBe(true);
    expect((await dash(w))[sw.all]).toBe(true);
    expect((await blair.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: { action: string }) => e.action === sw.task);
    expect(activityText({ ...act }, 'America/Detroit', 'Alex')).toBe(`Alex switched "${sw.log}" on`);
    expect((await w.app.client().call('PUT', sw.path, { on: true })).status).toBe(401);
    expect((await blair.call('PUT', sw.path, { on: false })).status).toBe(401);
    await w.organizer.call('PUT', sw.path, { on: false });
    expect(sw.flag in (await group(w))).toBe(false);
    // Off again: the change stamp is exactly what it was before (no leftover piece).
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(v0);
  });
  it('the kill switch beats both the header and Settings', async () => {
    const w = await world({ [sw.var]: 'off' });
    await w.organizer.call('PUT', sw.path, { on: true });
    expect(sw.flag in (await group(w, { [sw.header]: 'on' }))).toBe(false);
    expect(sw.flag in (await dash(w, { [sw.header]: 'on' }))).toBe(false);
  });
  it('the server sends the same games either way: the flag is the only difference', async () => {
    const w = await world();
    const off = await group(w);
    const { [sw.flag]: flag, ...rest } = await group(w, { [sw.header]: 'on' });
    expect(flag).toBe(true);
    expect(rest).toEqual(off);
  });
});

describe('color tokens (src/zip7.css)', () => {
  const css = readFileSync('src/zip7.css', 'utf8');
  const block = (re: RegExp) => (re.exec(css) ?? ['', ''])[0];
  const light = block(/:root \{[\s\S]*?\n\}/);
  const dark = block(/:root\[data-theme='dark'\] \{[\s\S]*?\n\}/);
  const media = block(/@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme='light'\]\) \{[\s\S]*?\n  \}/);
  const val = (b: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(b)?.[1].trim();
  it('uses the approved purple, credit blue and gray Waitlist values, light and dark', () => {
    expect([val(light, 'z7-text-fill'), val(light, 'z7-text-ink')]).toEqual(['#6a56a6', '#ffffff']);
    expect([val(dark, 'z7-text-fill'), val(dark, 'z7-text-ink')]).toEqual(['#b2a0e6', '#1d1433']);
    expect([val(light, 'z7-credit-fg'), val(light, 'z7-credit-bg')]).toEqual(['#3a4fa3', '#e9edf6']);
    expect([val(dark, 'z7-credit-fg'), val(dark, 'z7-credit-bg')]).toEqual(['#93a6e6', '#202840']);
    expect([val(light, 'z7-wait-bg'), val(light, 'z7-wait-ink')]).toEqual(['#4b5563', '#ffffff']);
    expect([val(dark, 'z7-wait-bg'), val(dark, 'z7-wait-ink')]).toEqual(['#9aa3b0', '#14181c']);
  });
  it('the "follow the phone" dark block has the same values as the Dark choice', () => {
    for (const n of ['z7-text-fill', 'z7-text-ink', 'z7-credit-fg', 'z7-credit-bg', 'z7-wait-bg', 'z7-wait-ink', 'z7-cancel-fg', 'z7-cancel-bg', 'z7-tonight-bg', 'z7-tomorrow-bg']) {
      expect(val(media, n), n).toBe(val(dark, n));
    }
  });
  it('the tokens match the Money screens', () => {
    const money = readFileSync('src/money-rework.css', 'utf8');
    for (const [a, b] of [['z7-text-fill', 'tok-text-fill'], ['z7-credit-fg', 'tok-credit-fg'], ['z7-credit-bg', 'tok-credit-bg']] as const) {
      expect(money).toContain(`--${b}: ${val(light, a)};`);
      expect(money).toContain(`--${b}: ${val(dark, a)};`);
    }
  });
  const ratio = (fg: string, bg: string) => {
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };
  it('text on every new fill is readable (4.5:1) in light and dark', () => {
    for (const [b, mode] of [[light, 'light'], [dark, 'dark']] as const) {
      for (const [fg, bg] of [['z7-tonight-ink', 'z7-tonight-bg'], ['z7-tomorrow-ink', 'z7-tomorrow-bg'], ['z7-text-ink', 'z7-text-fill'], ['z7-credit-fg', 'z7-credit-bg'], ['z7-wait-ink', 'z7-wait-bg'], ['z7-cancel-fg', 'z7-cancel-bg']] as const) {
        expect(ratio(val(b, fg)!, val(b, bg)!), `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('every rule is under an <html> attribute, so with the switches off nothing here applies', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter((sel) => sel && !sel.startsWith('@') && !/^(\d+%|0%|from|to|50%|55%|100%)/.test(sel) && !/^:root(\[data-theme='dark'\])?$/.test(sel) && sel !== ':root:not([data-theme=\'light\'])');
    for (const sel of rules) for (const part of sel.split(',')) expect(part.trim(), part).toMatch(/^:root\[data-(tonight-glow|color-cleanup|player-cards)\]/);
  });
});
