// Zip 38 (🎾38.xmas): the Christmas skin (CHRISTMAS_SKIN, "Christmas skin"), ships OFF. A look-only theme for the PLAYER screens.
//  Part A, the window rule: the Friday after US Thanksgiving through Dec 31, Eastern (2026 and 2027 dates, the edges, every year 2020 to 2040).
//  Part B, the phone's memory: the theme starts OFF, the choice is remembered, the first-visit bubble shows once, a phone that blocks storage
//          never crashes, the logo stays after the theme is turned off, reduced motion turns every swap instant.
//  Part C, the switch: OFF means unchanged (no flag, no row read outside the window), the Settings row, the private link, the kill switch, the
//          preview-only date and var, the answer carries one flag and nothing else, the admin answers never get it.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityText } from '../shared/activity';
import {
  BACK_KEY,
  BUBBLE_BACK,
  BUBBLE_FIRST,
  CHRISTMAS_SKIN,
  christmasSkinAllowed,
  HINT_KEY,
  inChristmasWindow,
  logoFor,
  parseMode,
  parsePretendDate,
  readTheme,
  sameEasternDay,
  takeFirstVisitHint,
  thanksgivingDay,
  THEME_KEY,
  windowStartDay,
  writeTheme,
  type Memory,
} from '../shared/christmasSkin';
import { PIN, playerPhone, setupGroup } from './harness';

vi.setConfig({ testTimeout: 120_000 });

/** An Eastern wall-clock time as a moment (EST in winter: UTC-5, EDT before Nov 1: UTC-4). */
const est = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h + 5, mi, s);
const edt = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h + 4, mi, s);

describe('Part A: the window (Friday after Thanksgiving through Dec 31, Eastern)', () => {
  it('Thanksgiving is the 4th Thursday of November', () => {
    expect(thanksgivingDay(2025)).toBe(27);
    expect(thanksgivingDay(2026)).toBe(26);
    expect(thanksgivingDay(2027)).toBe(25);
    expect(thanksgivingDay(2028)).toBe(23);
    expect(thanksgivingDay(2029)).toBe(22);
    expect(thanksgivingDay(2030)).toBe(28);
  });
  it('2026: opens Fri Nov 27, runs through Thu Dec 31', () => {
    expect(windowStartDay(2026)).toBe(27);
    expect(new Date(Date.UTC(2026, 10, 27)).getUTCDay()).toBe(5); // a Friday
    expect(new Date(Date.UTC(2026, 11, 31)).getUTCDay()).toBe(4); // a Thursday
    expect(inChristmasWindow(est(2026, 11, 27, 0, 0, 0))).toBe(true);
    expect(inChristmasWindow(est(2026, 11, 27, 12))).toBe(true);
    expect(inChristmasWindow(est(2026, 12, 5, 12))).toBe(true);
    expect(inChristmasWindow(est(2026, 12, 25, 12))).toBe(true);
    expect(inChristmasWindow(est(2026, 12, 31, 23, 59, 59))).toBe(true);
  });
  it('2026: Thanksgiving itself (Nov 26) and everything before it is out; Jan 1 is out', () => {
    expect(inChristmasWindow(est(2026, 11, 26, 12))).toBe(false);
    expect(inChristmasWindow(est(2026, 11, 26, 23, 59, 59))).toBe(false);
    expect(inChristmasWindow(est(2026, 11, 12, 15))).toBe(false);
    expect(inChristmasWindow(edt(2026, 10, 31, 12))).toBe(false);
    expect(inChristmasWindow(est(2027, 1, 1, 0, 0, 0))).toBe(false);
    expect(inChristmasWindow(est(2027, 1, 1, 12))).toBe(false);
    expect(inChristmasWindow(est(2027, 3, 1, 12))).toBe(false);
  });
  it('2027: Thanksgiving Nov 25, opens Fri Nov 26', () => {
    expect(windowStartDay(2027)).toBe(26);
    expect(new Date(Date.UTC(2027, 10, 26)).getUTCDay()).toBe(5);
    expect(inChristmasWindow(est(2027, 11, 25, 23, 59, 59))).toBe(false);
    expect(inChristmasWindow(est(2027, 11, 26, 0, 0, 0))).toBe(true);
    expect(inChristmasWindow(est(2027, 12, 31, 23, 59))).toBe(true);
    expect(inChristmasWindow(est(2028, 1, 1, 0, 0, 0))).toBe(false);
  });
  it('the edges are Eastern, not UTC: 7:00 PM Eastern on Dec 31 is already Jan 1 in UTC and is still IN; midnight Eastern Nov 27 is 5:00 AM UTC', () => {
    expect(inChristmasWindow(Date.UTC(2027, 0, 1, 4, 59, 59))).toBe(true); // Dec 31, 11:59:59 PM EST
    expect(inChristmasWindow(Date.UTC(2027, 0, 1, 5, 0, 0))).toBe(false); // Jan 1, 12:00 AM EST
    expect(inChristmasWindow(Date.UTC(2026, 10, 27, 4, 59, 59))).toBe(false); // Nov 26, 11:59:59 PM EST
    expect(inChristmasWindow(Date.UTC(2026, 10, 27, 5, 0, 0))).toBe(true); // Nov 27, 12:00 AM EST
  });
  it('every year from 2020 to 2040: the first day is the Friday after the 4th Thursday, never earlier than Nov 23 or later than Nov 29, and Dec 31 is in', () => {
    for (let y = 2020; y <= 2040; y++) {
      const day = windowStartDay(y);
      expect(new Date(Date.UTC(y, 10, day)).getUTCDay()).toBe(5);
      expect(day).toBeGreaterThanOrEqual(23);
      expect(day).toBeLessThanOrEqual(29);
      expect(inChristmasWindow(est(y, 11, day, 6))).toBe(true);
      expect(inChristmasWindow(est(y, 11, day - 1, 20))).toBe(false);
      expect(inChristmasWindow(est(y, 12, 31, 20))).toBe(true);
      expect(inChristmasWindow(est(y + 1, 1, 1, 6))).toBe(false);
    }
  });
  it('the preview-only pretend date: a real YYYY-MM-DD becomes noon-ish Eastern that day; anything else is nothing', () => {
    expect(parsePretendDate('2026-12-05')).toBe(Date.UTC(2026, 11, 5, 17));
    expect(inChristmasWindow(parsePretendDate('2026-11-27')!)).toBe(true);
    expect(inChristmasWindow(parsePretendDate('2026-11-26')!)).toBe(false);
    expect(inChristmasWindow(parsePretendDate('2026-12-31')!)).toBe(true);
    expect(inChristmasWindow(parsePretendDate('2027-01-01')!)).toBe(false);
    for (const bad of [null, undefined, '', 'on', '2026-13-01', '2026-02-30', '2026-1-5', '12/05/2026', '2026-12-05T10:00', '1999-12-25', '3000-12-25', 'off']) expect(parsePretendDate(bad as never)).toBeNull();
  });
});

/** A phone's memory made of a plain object. */
const memory = (initial: Record<string, string> = {}): Memory & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, get: (k) => (k in data ? data[k] : null), set: (k, v) => void (data[k] = v) };
};
const blocked: Memory = {
  get: () => {
    throw new Error('storage blocked');
  },
  set: () => {
    throw new Error('storage blocked');
  },
};

describe('Part B: the phone\'s memory and the logo', () => {
  it('the theme starts OFF on every phone; only an explicit "on" turns it on', () => {
    expect(readTheme(memory())).toBe(false);
    expect(readTheme(memory({ [THEME_KEY]: 'off' }))).toBe(false);
    expect(readTheme(memory({ [THEME_KEY]: 'garbage' }))).toBe(false);
    expect(readTheme(memory({ [THEME_KEY]: 'on' }))).toBe(true);
  });
  it('the choice is remembered per phone: on, then off, then on', () => {
    const m = memory();
    writeTheme(m, true);
    expect(readTheme(m)).toBe(true);
    writeTheme(m, false);
    expect(readTheme(m)).toBe(false);
    writeTheme(m, true);
    expect(m.data[THEME_KEY]).toBe('on');
    expect(readTheme(m)).toBe(true);
  });
  it('the first-visit bubble shows once on a phone, and never again (even after the theme is turned on and off)', () => {
    const m = memory();
    expect(takeFirstVisitHint(m)).toBe(true);
    expect(m.data[HINT_KEY]).toBe('1');
    expect(takeFirstVisitHint(m)).toBe(false);
    writeTheme(m, true);
    writeTheme(m, false);
    expect(takeFirstVisitHint(m)).toBe(false);
    // Another phone has its own memory.
    expect(takeFirstVisitHint(memory())).toBe(true);
  });
  it('a phone that blocks storage never crashes: reads say "off" and "show the hint", writes are swallowed', () => {
    expect(readTheme(blocked)).toBe(false);
    expect(() => writeTheme(blocked, true)).not.toThrow();
    expect(takeFirstVisitHint(blocked)).toBe(true);
    expect(() => takeFirstVisitHint(blocked)).not.toThrow();
  });
  it('the logo: the Christmas one inside the window, the normal one outside, and it does not depend on the theme being on', () => {
    expect(logoFor(true)).toBe('/logo-xmas.png');
    expect(logoFor(false)).toBe('/logo.png');
    // (The header gets one argument only: the window. The theme's on/off cannot change it: see src/skin/SkinLogo.tsx, which never reads `on` for the picture.)
    const src = readFileSync(new URL('../src/skin/SkinLogo.tsx', import.meta.url), 'utf8');
    expect(src).toContain('THEME.logoSrc(true)');
    expect(src).not.toMatch(/logoSrc\(skin\.on/);
  });
  it('the two bubbles say exactly the brief\'s words, and last about 2 seconds', () => {
    expect(BUBBLE_FIRST).toBe('Tap for Christmas theme');
    expect(BUBBLE_BACK).toBe('Tap to switch back');
    const store = readFileSync(new URL('../src/skin/store.ts', import.meta.url), 'utf8');
    expect(readFileSync(new URL('../shared/christmasSkin.ts', import.meta.url), 'utf8')).toContain('BUBBLE_MS = 2000');
    expect(store).toContain('BUBBLE_MS');
  });
  it('a saved last screen lends its Christmas flag to the same Eastern day only', () => {
    expect(sameEasternDay(est(2026, 12, 31, 10), est(2026, 12, 31, 23, 59))).toBe(true);
    expect(sameEasternDay(est(2026, 12, 31, 23, 59), est(2027, 1, 1, 0, 1))).toBe(false);
    expect(sameEasternDay(est(2026, 11, 26, 12), est(2026, 11, 27, 12))).toBe(false);
  });
  it('the logo file is in public/ (the clean one, 128 x 128 PNG)', () => {
    const png = readFileSync(new URL('../public/logo-xmas.png', import.meta.url));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
  });
});


describe('Part B: the store (theme on and off, bubbles, reduced motion), run with a fake page', () => {
  const realGlobals = { document: (globalThis as any).document, matchMedia: (globalThis as any).matchMedia, localStorage: (globalThis as any).localStorage };
  afterEach(() => {
    for (const [k, v] of Object.entries(realGlobals)) {
      if (v === undefined) delete (globalThis as any)[k];
      else (globalThis as any)[k] = v;
    }
    vi.useRealTimers();
    vi.resetModules();
  });
  /** A fake page: <html> attributes, a phone memory, and prefers-reduced-motion. */
  function fakePage({ reduced = false, store = {} as Record<string, string>, block = false } = {}) {
    const attrs: Record<string, string> = {};
    (globalThis as any).document = {
      documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v), removeAttribute: (k: string) => void delete attrs[k], getAttribute: (k: string) => attrs[k] ?? null },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).matchMedia = () => ({ matches: reduced });
    (globalThis as any).localStorage = block
      ? new Proxy({}, { get: () => () => { throw new Error('storage blocked'); } })
      : { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] };
    return { attrs, store };
  }
  const load = async () => import('../src/skin/store');

  it('Everyone: the theme starts off, the first-visit bubble shows then fades; a tap turns it on with "Tap to switch back"; off again leaves the logo', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage();
    const s = await load();
    s.setSkinAvailable('all', false);
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinStateNow().bubble).toBe('first');
    expect(store[HINT_KEY]).toBe('1');
    vi.advanceTimersByTime(2100);
    expect(s.skinStateNow().bubble).toBeNull();
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBe('in');
    expect(store[THEME_KEY]).toBe('on');
    expect(s.skinStateNow().bubble).toBe('back');
    vi.advanceTimersByTime(s.IN_MS + 50);
    expect(attrs['data-skin-anim']).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(attrs['data-skin-anim']).toBe('out');
    expect(store[THEME_KEY]).toBe('off');
    expect(s.skinStateNow().mode).toBe('all'); // the Christmas logo stays
    vi.advanceTimersByTime(s.OUT_MS + 50);
    expect(attrs['data-skin-anim']).toBeUndefined();
  });
  it('Everyone, remembered on: a phone that turned it on comes back with the theme on, no bubble, no pop-in marker', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable('all', false);
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBeUndefined();
  });
  it('Off: nothing is set, a tap does nothing, nothing is written', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ store: { [THEME_KEY]: 'on' } });
    const s = await load();
    s.setSkinAvailable('off', false);
    s.toggleSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[HINT_KEY]).toBeUndefined();
  });
  it('the window closes while the page is open (Jan 1): everything is put away at the next answer', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable('all', false);
    expect(attrs['data-skin']).toBe('christmas');
    s.setSkinAvailable('off', false);
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinOnNow()).toBe(false);
  });
  it('leaving the player Home puts everything back', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable('all', false);
    s.resetSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinOnNow()).toBe(false);
  });
  it('View as: starts off whatever this phone chose, no bubble, nothing remembered', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ store: { [THEME_KEY]: 'on' } });
    const s = await load();
    s.setSkinAvailable('all', true);
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[HINT_KEY]).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(store[THEME_KEY]).toBe('on'); // the organizer's own memory is untouched
    expect(s.skinStateNow().bubble).toBeNull();
    s.toggleSkin();
    expect(store[THEME_KEY]).toBe('on');
  });
  it('reduced motion: the swaps are instant (no pop-in or spin marker is ever set)', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ reduced: true });
    const s = await load();
    s.setSkinAvailable('all', false);
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(attrs['data-skin-anim']).toBeUndefined();
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/animation: none !important/);
    for (const part of ['.skin-bubble', '.xorn', '.ball.xspinb', '.xs-top::before']) expect(block).toContain(part);
  });
  it('a phone that blocks storage sees the first-visit bubble once per page load, not on every return to Home', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ block: true });
    const s = await load();
    s.setSkinAvailable('all', false);
    expect(s.skinStateNow().bubble).toBe('first');
    vi.advanceTimersByTime(2100);
    expect(s.skinStateNow().bubble).toBeNull();
    s.resetSkin();
    s.setSkinAvailable('all', false); // the player Home comes back
    expect(s.skinStateNow().bubble).toBeNull();
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(() => s.toggleSkin()).not.toThrow();
  });
  it('"Tap to switch back" shows only the first time the theme is turned ON on a phone (not every time, not after a reload, not in View as)', async () => {
    vi.useFakeTimers();
    const { store } = fakePage();
    const s = await load();
    s.setSkinAvailable('all', false);
    vi.advanceTimersByTime(2100);
    s.toggleSkin();
    expect(s.skinStateNow().bubble).toBe('back');
    expect(store[BACK_KEY]).toBe('1');
    vi.advanceTimersByTime(2100);
    s.toggleSkin();
    s.toggleSkin();
    expect(s.skinStateNow().on).toBe(true);
    expect(s.skinStateNow().bubble).toBeNull();
    s.resetSkin();
    vi.resetModules();
    const again = await load();
    again.setSkinAvailable('all', false);
    again.toggleSkin();
    again.toggleSkin();
    again.toggleSkin();
    expect(again.skinStateNow().bubble).toBeNull();
    vi.resetModules();
    fakePage();
    const demo = await load();
    demo.setSkinAvailable('all', true);
    demo.toggleSkin();
    expect(demo.skinStateNow().bubble).toBeNull();
  });
  it('Just me: starts from the saved choice, no bubble ever, a tap saves the choice on the SERVER (not on the phone), nothing for storage', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage();
    const s = await load();
    const saved: boolean[] = [];
    s.setMePersist((on) => void saved.push(on));
    s.setSkinAvailable('me', false, false);
    expect(s.skinStateNow().mode).toBe('me');
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinStateNow().bubble).toBeNull();
    expect(store[HINT_KEY]).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(saved).toEqual([true]);
    expect(store[THEME_KEY]).toBeUndefined(); // not kept in this phone's storage (a Home Screen app has its own storage)
    expect(s.skinStateNow().bubble).toBeNull(); // no "Tap to switch back" in Just me
    s.toggleSkin();
    expect(saved).toEqual([true, false]);
    expect(attrs['data-skin']).toBeUndefined();
    // A new page load: the server's saved choice is what shows.
    s.resetSkin();
    s.setSkinAvailable('me', false, true);
    expect(attrs['data-skin']).toBe('christmas');
  });
  it('a phone that blocks storage: Everyone toggles on and off without a single error', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ block: true });
    const s = await load();
    expect(() => s.setSkinAvailable('all', false)).not.toThrow();
    expect(() => s.toggleSkin()).not.toThrow();
    expect(attrs['data-skin']).toBe('christmas');
    expect(() => s.toggleSkin()).not.toThrow();
    expect(attrs['data-skin']).toBeUndefined();
  });
  it('leaving the player Home resets before the next screen paints (layout cleanup)', () => {
    expect(readFileSync(new URL('../src/skin/useSkinRoot.ts', import.meta.url), 'utf8')).toContain('useLayoutEffect(() => resetSkin, [])');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Part C: the 3-way switch
// ---------------------------------------------------------------------------------------------------------------------------------

type W = Awaited<ReturnType<typeof setupGroup>>;
const group = async (w: W, h: Record<string, string> = {}, who = 'Blair') => {
  const c = await playerPhone(w, who);
  return (await c.call('GET', '/api/group', undefined, h)).data;
};
const dash = async (w: W, h: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
const env = (w: W) => w.app.env as unknown as Record<string, unknown>;
/** Put the fake clock at an Eastern moment. */
const at = (w: W, ms: number) => void (w.app.now = ms);
/** The organizer's sign-in lasts a few hours, so after the fake clock jumps weeks ahead, sign in again. */
const signIn = async (w: W) => {
  const r = await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
  expect(r.status).toBe(200);
};
/** Set the 3-way Settings switch (signs in again first, so it works after the clock has jumped). */
const setMode = async (w: W, mode: 'off' | 'me' | 'all') => {
  await signIn(w);
  const r = await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { mode });
  expect(r.status).toBe(200);
};
const setOrganizer = (w: W, name = 'Alex') => void w.app.db.raw.prepare('UPDATE groups SET organizer_name = ?').run(name);

describe('Part C: the 3-way switch (CHRISTMAS_SKIN: Off, Just me, Everyone; ships OFF)', () => {
  it('names, modes and the kill switch', () => {
    expect(CHRISTMAS_SKIN).toEqual({ task: 'christmas_skin_on', meTask: 'christmas_skin_me', meOnTask: 'christmas_skin_me_on', modeHeader: 'X-Christmas-Mode', dateHeader: 'X-Christmas-Date', modeLink: 'xmasmode', dateLink: 'xmasdate', env: 'CHRISTMAS_SKIN', name: 'Christmas skin' });
    expect(parseMode('ME')).toBe('me');
    expect(parseMode(' all ')).toBe('all');
    expect(parseMode('off')).toBe('off');
    for (const bad of [null, undefined, '', 'on', 'everyone', 'just me']) expect(parseMode(bad as never)).toBeNull();
    expect(christmasSkinAllowed(undefined)).toBe(true);
    expect(christmasSkinAllowed(' OFF ')).toBe(false);
  });
  it('Off (ships so): no flag anywhere, even inside the window; the dashboard says nothing', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    expect((await group(w)).christmasSkin).toBeUndefined();
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toBeUndefined();
    await signIn(w);
    expect((await dash(w)).christmasSkinMode).toBeUndefined();
  });
  it('Everyone: every player gets the flag inside the window (Nov 27 to Dec 31), none outside it (Nov 26, Jan 1), no Just me object; the dashboard says "all"', async () => {
    const w = await setupGroup();
    await setMode(w, 'all');
    for (const t of [est(2026, 11, 27, 0, 0, 1), est(2026, 12, 5, 12), est(2026, 12, 25, 9), est(2026, 12, 31, 23, 59, 59)]) {
      at(w, t);
      const a = await group(w);
      expect(a.christmasSkin).toBe(true);
      expect(a.christmasSkinMe).toBeUndefined();
    }
    for (const t of [est(2026, 11, 26, 23, 59, 59), est(2026, 11, 12, 15), est(2027, 1, 1, 0, 0, 0), est(2027, 7, 4, 12)]) {
      at(w, t);
      expect((await group(w)).christmasSkin).toBeUndefined();
    }
    await signIn(w);
    expect((await dash(w)).christmasSkinMode).toBe('all');
    // 2027 works with no edit.
    at(w, est(2027, 11, 25, 20));
    expect((await group(w)).christmasSkin).toBeUndefined();
    at(w, est(2027, 11, 26, 8));
    expect((await group(w)).christmasSkin).toBe(true);
  });
  it('the three choices replace each other: exactly one row at a time; a bad value is refused; players cannot flip it', async () => {
    const w = await setupGroup();
    const rows = () => (w.app.db.raw.prepare("SELECT task FROM task_log WHERE task LIKE 'christmas_skin%' ORDER BY task").all() as { task: string }[]).map((r) => r.task);
    await setMode(w, 'me');
    expect(rows()).toEqual(['christmas_skin_me']);
    await setMode(w, 'all');
    expect(rows()).toEqual(['christmas_skin_on']);
    await setMode(w, 'off');
    expect(rows()).toEqual([]);
    const bad = await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'sometimes' });
    expect(bad.status).toBe(400);
    const old = await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { on: true });
    expect(old.status).toBe(400); // the old on/off body is not a mode
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' })).status).toBe(401);
  });
  it('the kill switch beats every mode', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 12, 5, 12));
    await setMode(w, 'all');
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await group(w)).christmasSkin).toBeUndefined();
    await setMode(w, 'me');
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toBeUndefined();
    env(w).CHRISTMAS_SKIN = 'on';
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toBeDefined();
  });
  it('the old private link does nothing: the header X-Christmas-Skin is ignored everywhere', async () => {
    const w = await setupGroup();
    at(w, est(2026, 11, 13, 10));
    const a = await group(w, { 'X-Christmas-Skin': 'on' });
    expect(a.christmasSkin).toBeUndefined();
    expect(a.christmasSkinMe).toBeUndefined();
    const lib = readFileSync(new URL('../src/lib.ts', import.meta.url), 'utf8');
    expect(lib).not.toContain('X-Christmas-Skin');
    expect(lib).not.toMatch(/gameDayTest\(CHRISTMAS/);
  });
  it('previews only: the mode header and the pretend date; the live site (no preview var) ignores both', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 11, 13, 10));
    const h = (mode: string, day?: string) => ({ 'X-Christmas-Mode': mode, ...(day ? { 'X-Christmas-Date': day } : {}) });
    // Live: nothing listens.
    expect((await group(w, h('all', '2026-12-05'))).christmasSkin).toBeUndefined();
    expect((await group(w, h('me'), 'Alex')).christmasSkinMe).toBeUndefined();
    env(w).CHRISTMAS_SKIN_PREVIEW = 'on';
    expect((await group(w)).christmasSkin).toBeUndefined(); // today (Nov 13) is outside the window, like live
    expect((await group(w, { 'X-Christmas-Date': '2026-12-05' })).christmasSkin).toBe(true); // no mode given: acts like Everyone
    expect((await group(w, h('all', '2026-12-05'))).christmasSkin).toBe(true);
    expect((await group(w, h('all', '2026-11-26'))).christmasSkin).toBeUndefined();
    expect((await group(w, h('all', '2027-01-01'))).christmasSkin).toBeUndefined();
    expect((await group(w, h('off', '2026-12-05'))).christmasSkin).toBeUndefined();
    expect((await group(w, h('all', 'garbage'))).christmasSkin).toBeUndefined();
    // Just me on a preview: only the organizer's own player, on any date (today is before the window).
    const me = await group(w, h('me'), 'Alex');
    expect(me.christmasSkinMe).toEqual({ on: false });
    expect(me.christmasSkin).toBeUndefined();
    expect((await group(w, h('me'), 'Blair')).christmasSkinMe).toBeUndefined();
    // View as carries the date and Everyone like the player it shows, never Just me.
    await signIn(w);
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Blair, ...h('all', '2026-12-05') });
    expect(as.data.christmasSkin).toBe(true);
    const asMe = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Alex, ...h('me') });
    expect(asMe.data.christmasSkinMe).toBeUndefined();
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await group(w, h('all', '2026-12-05'))).christmasSkin).toBeUndefined();
  });
  it('OFF means unchanged: the player answer is the same JSON as before, plus exactly one flag while Everyone shows; outside the window with Everyone it is the same as Off', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    const off = await group(w);
    await setMode(w, 'all');
    const on = await group(w);
    const { christmasSkin, version: onVersion, ...rest } = on;
    const { version: offVersion, ...offRest } = off;
    expect(christmasSkin).toBe(true);
    void onVersion;
    void offVersion;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(offRest));
    at(w, est(2026, 11, 20, 12));
    const everyoneOutside = JSON.stringify(await group(w));
    await setMode(w, 'off');
    expect(everyoneOutside).toBe(JSON.stringify(await group(w)));
  });
  it('Just me costs one read for the organizer\'s own player only; outside the window nobody else asks anything; inside it everyone asks the usual one', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    await setMode(w, 'me');
    const asked: string[] = [];
    const real = w.app.db.prepare.bind(w.app.db);
    (w.app.db as any).prepare = (sql: string) => {
      const stmt = real(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...v: unknown[]) => {
        if (v.some((x) => typeof x === 'string' && x.startsWith('christmas_skin'))) asked.push(`${v.find((x) => typeof x === 'string' && (x as string).startsWith('christmas_skin'))}`);
        return bind(...v);
      };
      return stmt;
    };
    at(w, est(2026, 11, 13, 10));
    await group(w, {}, 'Blair');
    expect(asked).toEqual([]);
    await group(w, {}, 'Alex');
    expect(asked).toEqual(['christmas_skin_me', 'christmas_skin_me_on']);
    asked.length = 0;
    at(w, est(2026, 12, 5, 10));
    await group(w, {}, 'Blair');
    expect(asked).toEqual(['christmas_skin_on']);
  });
  it('the preview-only var is only in [env.preview.vars]; the kill switch is in [vars]', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const at2 = toml.indexOf('[env.preview.vars]');
    const prod = toml.slice(0, at2);
    const preview = toml.slice(at2);
    expect(prod).not.toMatch(/CHRISTMAS_SKIN_PREVIEW/);
    expect(prod).toMatch(/^CHRISTMAS_SKIN = "on"$/m);
    expect(preview).toMatch(/^CHRISTMAS_SKIN_PREVIEW = "on"$/m);
    expect(preview).toMatch(/^CHRISTMAS_SKIN = "on"$/m);
  });
  it('History words and the Settings row: a 3-way control on top of both Feature switches lists (no deploy needed)', () => {
    const line = (action: string) => activityText({ id: 'x', action, details: {}, actorLabel: 'organizer', at: '2026-11-12T20:00:00.000Z', sessionId: null, playerId: null } as never, 'America/Detroit', 'Alex');
    expect(line('christmas_skin_everyone')).toBe('Alex switched "Christmas skin" to Everyone');
    expect(line('christmas_skin_me')).toBe('Alex switched "Christmas skin" to Just me');
    expect(line('christmas_skin_off')).toBe('Alex switched "Christmas skin" off');
    const src = readFileSync(new URL('../src/pages/admin/SettingsTab.tsx', import.meta.url), 'utf8');
    expect(src.match(/<ChristmasSkinRow /g)?.length).toBe(2);
    expect(src).toContain('/api/admin/christmas-skin-switch');
    for (const label of ["label: 'Off'", "label: 'Just me'", "label: 'Everyone'"]) expect(src).toContain(label);
    expect(src).toMatch(/<ChristmasSkinRow ctx=\{ctx\} auto=\{auto\} \/>\s*<CheaperFixRow/);
  });
  it('the skin is a skin: the CSS sits under the theme attribute or the logo button, and the admin screens never set it', () => {
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    const sel = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((b) => b.split('{')[0].trim())
      .filter((s) => s && !s.startsWith('@') && !/^(from|to|[\d.]+%)/.test(s));
    const allowed = /^(html\[data-skin='christmas'\]|html\[data-skin-anim|\.skin-|button\.brand-tile\.skin-logo|\.xorn|\.ball\.xspinb|\.pop\.pop-ball|\.m-burst|\.skin-logo)/;
    const stray = sel.filter((s) => !s.split(',').every((p) => allowed.test(p.trim()) || /^(\d+(\.\d+)?%|from|to)/.test(p.trim())));
    expect(stray).toEqual([]);
    expect(readFileSync(new URL('../src/pages/Admin.tsx', import.meta.url), 'utf8')).not.toMatch(/skin\//);
    expect(readFileSync(new URL('../src/pages/PlayerHome.tsx', import.meta.url), 'utf8')).toContain('useSkinRoot(');
  });
  it('slots: a second theme can swap them (logo, seat, badge, and the CSS block per theme id)', () => {
    const theme = readFileSync(new URL('../src/skin/theme.tsx', import.meta.url), 'utf8');
    for (const slot of ['logoSrc', 'Seat', 'Badge']) expect(theme).toContain(slot);
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    for (const slot of ['Slot: seat marker', 'Slot: section divider', 'Slot: cap', 'Slot: calendar tiles']) expect(css).toContain(slot);
  });
});

describe('Part D: Just me (the organizer\'s own player only)', () => {
  const meCall = (w: W, who: string, on: boolean, h: Record<string, string> = {}) => playerPhone(w, who).then((c) => c.call('POST', '/api/christmas-skin-me', { on }, h));

  it('Just me: only the organizer\'s own player gets anything (the theme choice, any date); the answer has no Christmas logo flag; nobody else is touched', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    await setMode(w, 'me');
    for (const t of [est(2026, 11, 13, 10), est(2026, 12, 5, 12), est(2027, 3, 3, 12)]) {
      at(w, t);
      const alex = await group(w, {}, 'Alex');
      expect(alex.christmasSkinMe).toEqual({ on: false });
      expect(alex.christmasSkin).toBeUndefined();
      for (const who of ['Blair', 'Casey']) {
        const other = await group(w, {}, who);
        expect(other.christmasSkin).toBeUndefined();
        expect(other.christmasSkinMe).toBeUndefined();
      }
    }
    await signIn(w);
    expect((await dash(w)).christmasSkinMode).toBe('me');
  });
  it('Alex\'s theme choice is kept on the server (so a Home Screen app has it), and only Alex can save it', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    await setMode(w, 'me');
    at(w, est(2026, 11, 13, 10));
    const on = await meCall(w, 'Alex', true);
    expect(on.status).toBe(200);
    expect(on.data.applied).toBe(true);
    // A brand new phone (nothing stored): picking the name Alex is enough.
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: true });
    // Another player cannot save it, and nothing changes.
    const blair = await meCall(w, 'Blair', false);
    expect(blair.data.applied).toBe(false);
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: true });
    const off = await meCall(w, 'Alex', false);
    expect(off.data.applied).toBe(true);
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: false });
  });
  it('the save only works in Just me, never in View as, never against the kill switch', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 11, 13, 10));
    // Off or Everyone: no.
    for (const mode of ['off', 'all'] as const) {
      await setMode(w, mode);
      expect((await meCall(w, 'Alex', true)).data.applied).toBe(false);
    }
    await setMode(w, 'me');
    // View as (the organizer's demo copy of Alex) neither gets it nor saves it.
    await signIn(w);
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Alex });
    expect(as.data.christmasSkinMe).toBeUndefined();
    const post = await w.organizer.call('POST', '/api/christmas-skin-me', { on: true }, { 'X-View-As': w.byName.Alex });
    expect(post.data.applied).toBe(false);
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: false });
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await meCall(w, 'Alex', true)).data.applied).toBe(false);
    env(w).CHRISTMAS_SKIN = 'on';
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: false });
  });
  it('switching away from Just me hides it again; the saved choice is not lost but shows nothing', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 12, 5, 12));
    await setMode(w, 'me');
    await meCall(w, 'Alex', true);
    await setMode(w, 'off');
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toBeUndefined();
    await setMode(w, 'me');
    expect((await group(w, {}, 'Alex')).christmasSkinMe).toEqual({ on: true });
  });
  it('the page: in Just me the NORMAL logo is the tap (no Christmas picture, no bubble, the normal tile fill); Everyone gets the Christmas picture', () => {
    const logo = readFileSync(new URL('../src/skin/SkinLogo.tsx', import.meta.url), 'utf8');
    expect(logo).toContain("const christmasLogo = skin.mode === 'all';");
    expect(logo).toContain("src={christmasLogo ? THEME.logoSrc(true) : '/logo.png'}");
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    expect(css).toMatch(/button\.brand-tile\.skin-logo\.skin-logo-all \{\s*background: var\(--bg\);/);
    expect(css).not.toMatch(/\.skin-logo-me \{[^}]*background/);
    const store = readFileSync(new URL('../src/skin/store.ts', import.meta.url), 'utf8');
    expect(store).toContain("state.mode === 'all' && !demo && !backShown");
  });
});

describe('Part E: the look and the motion (Alex, rounds 1 and 2)', () => {
  const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../src/skin/theme.tsx', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8');
  it('nothing moves on a card at rest and nothing glows: no ring, no glow, no sway, no pulse, no gold flash in any ornament motion', () => {
    expect(theme).not.toMatch(/stroke="var\(--primary\)"/);
    expect(css).not.toMatch(/xsway|xglow|\.xorn\.me|sched\.gd \.dots \.xorn/);
    const motion = css.slice(css.indexOf('/* ---------- 3. Motion'));
    expect(motion).not.toMatch(/drop-shadow\(0 0 [4-9]px/);
    expect(motion).not.toMatch(/#f2b33d|242 179 61/);
    // The only animations that ever sit on an ornament are the moment classes (pop-in, drop-in, jingle).
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.split('{')).filter((x) => x.length === 2);
    const animated = rules.filter(([sel, body]) => /\.xorn/.test(sel) && /animation:\s*(?!none)/.test(body)).map(([sel]) => sel.trim());
    expect(animated.length).toBeGreaterThan(3);
    for (const sel of animated) expect(sel).toMatch(/\.xin|\.xjoin|\.xjingle|\.pop\.pop-ball|\.m-burst/);
    expect(ui).not.toContain("'--pd'");
  });
  it('the I\'m in drop is the finished animation: drops from above, swings a couple of times, settles (xjoin, 0.95 s), and the jingle after the 4th player', () => {
    expect(css).toMatch(/@keyframes xjoin \{\s*0% \{\s*transform: translateY\(-22px\);\s*opacity: 0;\s*\}\s*30% \{\s*transform: translateY\(0\);\s*opacity: 1;\s*\}\s*48% \{\s*transform: rotate\(11deg\);\s*\}\s*66% \{\s*transform: rotate\(-8deg\);\s*\}\s*82% \{\s*transform: rotate\(4deg\);\s*\}\s*100% \{\s*transform: none;\s*\}\s*\}/);
    expect(css).toContain('animation: xjoin 0.95s ease-out backwards;');
    expect(css).toContain('xjingle 0.9s ease-in-out calc(1s + var(--i, 0) * 160ms)');
  });
  it('every ornament animation plays to the end: each ornament times its own motion and clears it only when the LAST animation of the motion ends', () => {
    expect(theme).toContain("const LAST_ANIMATION: Record<string, string> = { xin: 'xdrop', 'xin xin-j': 'xjingle', xjoin: 'xjoin', 'xjoin xjoin-j': 'xjingle', 'xjingle xjingle-j': 'xjingle' };");
    expect(theme).toContain('e.animationName === LAST_ANIMATION[playing.cls]');
    expect(theme).toContain('MOTION_SAFETY_MS = 4500');
    // The old cut-off: the pop-in class was removed by a 1.7 s timer while the first card's jingle runs until 2.1 s. No timer decides that any more.
    expect(ui).not.toMatch(/popIn \? \(first/);
    expect(ui).not.toContain('setJingle');
    // The longest motion (the top card's pop-in plus jingle, 6 seats) ends well inside the safety net.
    const longest = 0.7 + 5 * 0.16 + 0.9;
    expect(longest).toBeLessThan(4.5);
  });
  it('tiles with a court-status ring (the "~8 PM" games and games with no court set) keep the regular theme\'s ring; red outlines only on set-time games', () => {
    expect(css).toMatch(/\.tile\.ptile:not\(\.ts\),\s*html\[data-skin='christmas'\] \.schedule \.tile\.day-tonight:not\(\.ts\),\s*html\[data-skin='christmas'\] \.schedule \.tile\.day-tomorrow:not\(\.ts\) \{\s*border-color: var\(--xmas-red\) !important;/);
    expect(css).toMatch(/\.ts-booked \.tb-solid \{\s*box-shadow: inset 0 0 0 var\(--tb-w, 2px\) var\(--xmas-red\) !important;/);
    // The regular theme keeps a status tile's own border see-through (its ring is drawn by .tb), which is what stops the doubled ring.
    expect(readFileSync(new URL('../src/time-shift.css', import.meta.url), 'utf8')).toMatch(/\.tile\.ts \{\s*border-color: transparent !important;/);
  });
  it('the tonight shimmer: about 60 percent as bright as in round 1 (13 / 12 / 12 percent, from 35 / 30 / 30 originally), softer band, same timing (this change is on live)', () => {
    const z7 = readFileSync(new URL('../src/zip7.css', import.meta.url), 'utf8');
    expect([...z7.matchAll(/--z7-sweep: rgb\(255 255 255 \/ (\d+)%\);/g)].map((m) => m[1])).toEqual(['13', '12', '12']);
    expect(z7).toContain('linear-gradient(110deg, transparent 22%, var(--z7-sweep) 50%, transparent 78%)');
    expect(z7).toContain('animation: z7-sweep 3.6s ease-in-out infinite;');
    expect(z7).toMatch(/@keyframes z7-sweep \{\s*0%,\s*55% \{\s*background-position: 130% 0;\s*\}\s*100% \{\s*background-position: -30% 0;/);
  });
});
