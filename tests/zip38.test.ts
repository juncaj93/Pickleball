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
  BUBBLE_BACK,
  BUBBLE_FIRST,
  CHRISTMAS_SKIN,
  christmasSkinAllowed,
  BACK_KEY,
  HINT_KEY,
  inChristmasWindow,
  logoFor,
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

  it('available: the theme starts off, the first-visit bubble shows, then fades by itself; a tap turns it on with the second bubble; off again leaves the logo', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage();
    const s = await load();
    s.setSkinAvailable(true, false);
    expect(attrs['data-skin']).toBeUndefined();
    let now = s.skinOnNow();
    expect(now).toBe(false);
    expect(store[HINT_KEY]).toBe('1');
    vi.advanceTimersByTime(2100);
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBe('in');
    expect(store[THEME_KEY]).toBe('on');
    expect(s.skinOnNow()).toBe(true);
    vi.advanceTimersByTime(s.IN_MS + 50);
    expect(attrs['data-skin-anim']).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(attrs['data-skin-anim']).toBe('out');
    expect(store[THEME_KEY]).toBe('off');
    expect(s.skinOnNow()).toBe(false);
    now = s.skinOnNow();
    vi.advanceTimersByTime(s.OUT_MS + 50);
    expect(attrs['data-skin-anim']).toBeUndefined();
  });
  it('remembered on: a phone that turned it on comes back with the theme on and no bubble and no pop-in marker', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable(true, false);
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBeUndefined();
  });
  it('not available (outside the window or switch off): nothing is set, a tap does nothing, nothing is written', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ store: { [THEME_KEY]: 'on' } });
    const s = await load();
    s.setSkinAvailable(false, false);
    expect(attrs['data-skin']).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[HINT_KEY]).toBeUndefined();
  });
  it('the window closes while the page is open (Jan 1): everything is put away at the next answer', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable(true, false);
    expect(attrs['data-skin']).toBe('christmas');
    s.setSkinAvailable(false, false);
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinOnNow()).toBe(false);
  });
  it('leaving the player Home (admin, another page) puts everything back', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ store: { [THEME_KEY]: 'on', [HINT_KEY]: '1' } });
    const s = await load();
    s.setSkinAvailable(true, false);
    s.resetSkin();
    expect(attrs['data-skin']).toBeUndefined();
    expect(s.skinOnNow()).toBe(false);
  });
  it('View as (the organizer\'s demo copy): starts off whatever this phone chose, no bubble, nothing remembered', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ store: { [THEME_KEY]: 'on' } });
    const s = await load();
    s.setSkinAvailable(true, true);
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[HINT_KEY]).toBeUndefined();
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(store[THEME_KEY]).toBe('on'); // the organizer's own memory is untouched
    s.toggleSkin();
    expect(store[THEME_KEY]).toBe('on');
  });
  it('reduced motion: the swaps are instant (no pop-in or spin marker is ever set)', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ reduced: true });
    const s = await load();
    s.setSkinAvailable(true, false);
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
    s.setSkinAvailable(true, false);
    expect(s.skinOnNow()).toBe(false);
    expect(s.skinStateNow().bubble).toBe('first');
    vi.advanceTimersByTime(2100);
    expect(s.skinStateNow().bubble).toBeNull();
    s.resetSkin();
    vi.advanceTimersByTime(100);
    s.setSkinAvailable(true, false); // the player Home comes back
    expect(s.skinStateNow().bubble).toBeNull(); // not shown a second time (storage cannot remember it, the page does)
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
  });
  it('another join or a tap within the 3 seconds cannot leave the jingle on (its own timer)', () => {
    const src = readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(!jingle\) return undefined;\s*const t = setTimeout\(\(\) => setJingle\(false\), 3000\);\s*return \(\) => clearTimeout\(t\);\s*\}, \[jingle\]\);/);
  });
  it('leaving the player Home resets before the next screen paints (layout cleanup)', () => {
    expect(readFileSync(new URL('../src/skin/useSkinRoot.ts', import.meta.url), 'utf8')).toContain('useLayoutEffect(() => resetSkin, [])');
  });
  it('"Tap to switch back" shows only the first time the theme is turned ON on a phone (not every time, not in View as)', async () => {
    vi.useFakeTimers();
    const { store } = fakePage();
    const s = await load();
    s.setSkinAvailable(true, false);
    vi.advanceTimersByTime(2100);
    s.toggleSkin(); // on, first time
    expect(s.skinStateNow().bubble).toBe('back');
    expect(store[BACK_KEY]).toBe('1');
    vi.advanceTimersByTime(2100);
    expect(s.skinStateNow().bubble).toBeNull();
    s.toggleSkin(); // off
    s.toggleSkin(); // on again
    expect(s.skinStateNow().on).toBe(true);
    expect(s.skinStateNow().bubble).toBeNull();
    // A page reload (a new store) on the same phone: still never again.
    s.resetSkin();
    vi.resetModules();
    const again = await load();
    again.setSkinAvailable(true, false);
    again.toggleSkin();
    again.toggleSkin();
    again.toggleSkin();
    expect(again.skinStateNow().bubble).toBeNull();
    // View as: no bubble at all.
    vi.resetModules();
    fakePage();
    const demo = await load();
    demo.setSkinAvailable(true, true);
    demo.toggleSkin();
    expect(demo.skinStateNow().bubble).toBeNull();
  });
  it('the test mode (private link): the theme is ON at every open, whatever this phone remembered, no bubbles, nothing remembered, until the link is turned off', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ store: { [THEME_KEY]: 'off' } });
    const s = await load();
    s.setSkinAvailable(true, false, true);
    expect(attrs['data-skin']).toBe('christmas');
    expect(s.skinStateNow().bubble).toBeNull();
    expect(store[HINT_KEY]).toBeUndefined();
    expect(attrs['data-skin-anim']).toBeUndefined(); // no pop-in at open
    s.toggleSkin(); // a tap on the logo still works for this visit...
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[THEME_KEY]).toBe('off'); // ...but nothing is written
    expect(s.skinStateNow().bubble).toBeNull();
    // The next open: ON again.
    s.resetSkin();
    vi.resetModules();
    const { attrs: attrs2 } = fakePage({ store: { [THEME_KEY]: 'off' } });
    const s2 = await load();
    s2.setSkinAvailable(true, false, true);
    expect(attrs2['data-skin']).toBe('christmas');
    // The link turned off: the server answers without the flag, the phone puts everything away.
    s2.setSkinAvailable(false, false, false);
    expect(attrs2['data-skin']).toBeUndefined();
  });
  it('a phone that blocks storage: available, toggles on and off without a single error', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ block: true });
    const s = await load();
    expect(() => s.setSkinAvailable(true, false)).not.toThrow();
    expect(() => s.toggleSkin()).not.toThrow();
    expect(attrs['data-skin']).toBe('christmas');
    expect(() => s.toggleSkin()).not.toThrow();
    expect(attrs['data-skin']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Part C: the switch
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
/** Flip the Settings row (signs in again first, so it works after the clock has jumped). */
const flip = async (w: W, on: boolean) => {
  await signIn(w);
  const r = await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { on });
  expect(r.status).toBe(200);
};

describe('Part C: the switch (CHRISTMAS_SKIN, ships OFF)', () => {
  it('names and kill switch', () => {
    expect(CHRISTMAS_SKIN).toEqual({ task: 'christmas_skin_on', testerTask: 'christmas_skin_tester', header: 'X-Christmas-Skin', dateHeader: 'X-Christmas-Date', link: 'christmasskin', dateLink: 'xmasdate', env: 'CHRISTMAS_SKIN', name: 'Christmas skin' });
    expect(christmasSkinAllowed(undefined)).toBe(true);
    expect(christmasSkinAllowed('on')).toBe(true);
    expect(christmasSkinAllowed(' OFF ')).toBe(false);
  });
  it('off at ship: no flag anywhere, even inside the window; the row on + inside the window gives the flag; the row on + outside gives none', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    expect((await group(w)).christmasSkin).toBeUndefined();
    await signIn(w);
    expect((await dash(w)).christmasSkinForAll).toBeUndefined();
    await flip(w, true);
    await signIn(w);
    expect((await dash(w)).christmasSkinForAll).toBe(true);
    // Inside the window, every day we care about.
    for (const t of [est(2026, 11, 27, 0, 0, 1), est(2026, 12, 5, 12), est(2026, 12, 25, 9), est(2026, 12, 31, 23, 59, 59)]) {
      at(w, t);
      expect((await group(w)).christmasSkin).toBe(true);
    }
    // Outside: Nov 26 (Thanksgiving), Nov 12, Jan 1, next summer.
    for (const t of [est(2026, 11, 26, 23, 59, 59), est(2026, 11, 12, 15), est(2027, 1, 1, 0, 0, 0), est(2027, 7, 4, 12)]) {
      at(w, t);
      expect((await group(w)).christmasSkin).toBeUndefined();
    }
    // Off again: no flag inside the window either.
    at(w, est(2026, 12, 5, 12));
    await flip(w, false);
    expect((await group(w)).christmasSkin).toBeUndefined();
    await signIn(w);
    expect((await dash(w)).christmasSkinForAll).toBeUndefined();
  });
  it('2027 works with no edit: the row on, Fri Nov 26, 2027 gives the flag, Thu Nov 25 does not', async () => {
    const w = await setupGroup();
    await flip(w, true);
    at(w, est(2027, 11, 25, 20));
    expect((await group(w)).christmasSkin).toBeUndefined();
    at(w, est(2027, 11, 26, 8));
    expect((await group(w)).christmasSkin).toBe(true);
  });
  it('the kill switch beats the row and the private link', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    await flip(w, true);
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await group(w)).christmasSkin).toBeUndefined();
    expect((await group(w, { 'X-Christmas-Skin': 'on' })).christmasSkin).toBeUndefined();
    env(w).CHRISTMAS_SKIN = 'on';
    expect((await group(w)).christmasSkin).toBe(true);
  });
  it('the private test link (one phone) shows the skin whatever the date, and does nothing for anyone else', async () => {
    const w = await setupGroup();
    at(w, est(2026, 11, 13, 10)); // today, well before the window
    expect((await group(w)).christmasSkin).toBeUndefined();
    expect((await group(w, { 'X-Christmas-Skin': 'on' })).christmasSkin).toBe(true);
    expect((await group(w, { 'X-Christmas-Skin': 'off' })).christmasSkin).toBeUndefined();
    expect((await group(w)).christmasSkin).toBeUndefined();
  });
  it('the pretend date works only on a preview (the var exists only there); the live site ignores it', async () => {
    const w = await setupGroup();
    at(w, est(2026, 11, 13, 10));
    const pretend = (day: string) => ({ 'X-Christmas-Date': day });
    // Live: no preview var, so the header does nothing even with the row on.
    await flip(w, true);
    expect((await group(w, pretend('2026-12-05'))).christmasSkin).toBeUndefined();
    await flip(w, false);
    expect((await group(w, pretend('2026-12-05'))).christmasSkin).toBeUndefined();
    // A preview: the switch is on by itself, and the date decides.
    env(w).CHRISTMAS_SKIN_PREVIEW = 'on';
    expect((await group(w)).christmasSkin).toBeUndefined(); // today (Nov 13) is outside the window, like live
    expect((await group(w, pretend('2026-12-05'))).christmasSkin).toBe(true);
    expect((await group(w, pretend('2026-11-27'))).christmasSkin).toBe(true);
    expect((await group(w, pretend('2026-11-26'))).christmasSkin).toBeUndefined();
    expect((await group(w, pretend('2027-01-01'))).christmasSkin).toBeUndefined();
    expect((await group(w, pretend('garbage'))).christmasSkin).toBeUndefined();
    // View as carries it the same way (the organizer's demo copy follows the same date).
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Blair, ...pretend('2026-12-05') });
    expect(as.status).toBe(200);
    expect(as.data.christmasSkin).toBe(true);
    // The kill switch still wins on a preview.
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await group(w, pretend('2026-12-05'))).christmasSkin).toBeUndefined();
  });
  it('OFF means unchanged: the player answer is the same JSON as before, plus exactly one flag while the skin shows', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    const off = await group(w);
    const on = await group(w, { 'X-Christmas-Skin': 'on' });
    const { christmasSkin, christmasSkinTest, version: onVersion, ...rest } = on;
    const { version: offVersion, ...offRest } = off;
    expect(christmasSkin).toBe(true);
    expect(christmasSkinTest).toBe(true); // the private link is the test mode
    // (`version` is the answer's change fingerprint and is left out of this comparison; every other key and value is identical.)
    void onVersion;
    void offVersion;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(offRest));
    // Outside the window with the row ON: also the same as with the row OFF, byte for byte (same moment).
    at(w, est(2026, 11, 20, 12));
    const rowOff = JSON.stringify(await group(w));
    await flip(w, true);
    expect(JSON.stringify(await group(w))).toBe(rowOff);
  });
  it('outside the window the database is not asked about the switch at all (no extra trip on any ordinary day)', async () => {
    const w = await setupGroup();
    await flip(w, true);
    const asked: string[] = [];
    const real = w.app.db.prepare.bind(w.app.db);
    (w.app.db as any).prepare = (sql: string) => {
      const stmt = real(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...v: unknown[]) => {
        if (v.includes('christmas_skin_on')) asked.push(sql);
        return bind(...v);
      };
      return stmt;
    };
    at(w, est(2026, 11, 13, 10));
    await group(w);
    expect(asked).toEqual([]);
    at(w, est(2026, 12, 5, 10));
    await group(w);
    expect(asked.length).toBeGreaterThan(0);
  });
  it('a player cannot flip it; the organizer\'s own answers (dashboard, Money, Players) never carry the player flag', async () => {
    const w = await setupGroup();
    at(w, est(2026, 12, 5, 12));
    await flip(w, true);
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('PUT', '/api/admin/christmas-skin-switch', { on: false })).status).toBe(401);
    await signIn(w);
    const d = await dash(w);
    expect(d.christmasSkin).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/"christmasSkin":true/);
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
  it('History words and the Settings row (on top of both Feature switches lists, no deploy needed to flip it)', () => {
    const line = (action: string) => activityText({ id: 'x', action, details: {}, actorLabel: 'organizer', at: '2026-11-12T20:00:00.000Z', sessionId: null, playerId: null } as never, 'America/Detroit', 'Alex');
    expect(line('christmas_skin_on')).toBe('Alex switched "Christmas skin" on');
    expect(line('christmas_skin_off')).toBe('Alex switched "Christmas skin" off');
    const src = readFileSync(new URL('../src/pages/admin/SettingsTab.tsx', import.meta.url), 'utf8');
    expect(src.match(/<ChristmasSkinRow /g)?.length).toBe(2);
    expect(src).toContain('/api/admin/christmas-skin-switch');
    expect(src).toMatch(/<ChristmasSkinRow ctx=\{ctx\} auto=\{auto\} \/>\s*<CheaperFixRow/);
  });
  it('the skin is a skin: the CSS sits under the theme attribute or the logo button, and the admin screens never set it', () => {
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    // Every selector in the theme-ON group names html[data-skin='christmas']; the only others are the logo button, bubbles, motion classes.
    const sel = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((b) => b.split('{')[0].trim())
      .filter((s) => s && !s.startsWith('@') && !/^(from|to|[\d.]+%)/.test(s));
    const allowed = /^(html\[data-skin='christmas'\]|html\[data-skin-anim|\.skin-|button\.brand-tile\.skin-logo|\.xorn|\.ball\.xspinb|\.pop\.pop-ball|\.m-burst|\.skin-logo)/;
    const stray = sel.filter((s) => !s.split(',').every((p) => allowed.test(p.trim()) || /^(\d+(\.\d+)?%|from|to)/.test(p.trim())));
    expect(stray).toEqual([]);
    const admin = readFileSync(new URL('../src/pages/Admin.tsx', import.meta.url), 'utf8');
    expect(admin).not.toMatch(/skin\//);
    // Only the player Home mounts the skin hook.
    const home = readFileSync(new URL('../src/pages/PlayerHome.tsx', import.meta.url), 'utf8');
    expect(home).toContain('useSkinRoot(');
  });
  it('slots: a second theme can swap them (logo, seat, badge, and the CSS block per theme id)', () => {
    const theme = readFileSync(new URL('../src/skin/theme.tsx', import.meta.url), 'utf8');
    for (const slot of ['logoSrc', 'Seat', 'Badge']) expect(theme).toContain(slot);
    const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
    for (const slot of ['Slot: seat marker', 'Slot: section divider', 'Slot: cap', 'Slot: calendar tiles']) expect(css).toContain(slot);
  });
});

describe('Part D: the private link sticks (test mode) and Alex\'s own player', () => {
  const setOrganizer = (w: W, name = 'Alex') => void w.app.db.raw.prepare('UPDATE groups SET organizer_name = ?').run(name);
  const markCalls = (w: W, who: string, on: boolean, h: Record<string, string> = {}) => playerPhone(w, who).then((c) => c.call('POST', '/api/christmas-skin-tester', { on }, h));

  it('the private link: the whole skin (flag AND test mode), whatever the date and whatever the Settings row says for everyone else', async () => {
    const w = await setupGroup();
    at(w, est(2026, 11, 13, 10)); // before the window, the row never switched on
    const a = await group(w, { 'X-Christmas-Skin': 'on' });
    expect(a.christmasSkin).toBe(true);
    expect(a.christmasSkinTest).toBe(true);
    // Everyone else: nothing.
    const b = await group(w);
    expect(b.christmasSkin).toBeUndefined();
    expect(b.christmasSkinTest).toBeUndefined();
  });
  it('the window and the row alone give the flag but NOT the test mode (the theme starts off for everyone)', async () => {
    const w = await setupGroup();
    await flip(w, true);
    at(w, est(2026, 12, 5, 12));
    const a = await group(w);
    expect(a.christmasSkin).toBe(true);
    expect(a.christmasSkinTest).toBeUndefined();
  });
  it('the organizer\'s own player: the mark gives the test mode on any phone (a Home Screen app) and nobody else is touched', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 11, 13, 10));
    expect((await group(w, {}, 'Alex')).christmasSkin).toBeUndefined();
    const res = await markCalls(w, 'Alex', true, { 'X-Christmas-Skin': 'on' });
    expect(res.status).toBe(200);
    expect(res.data.marked).toBe(true);
    // A brand new phone (no private header): Alex's answer has the whole skin; Blair's and everyone else's has nothing.
    const alex = await group(w, {}, 'Alex');
    expect(alex.christmasSkin).toBe(true);
    expect(alex.christmasSkinTest).toBe(true);
    for (const who of ['Blair', 'Casey']) {
      const other = await group(w, {}, who);
      expect(other.christmasSkin).toBeUndefined();
      expect(other.christmasSkinTest).toBeUndefined();
    }
    // Still there in December with the row OFF for everyone (it ignores both).
    at(w, est(2026, 12, 5, 12));
    expect((await group(w, {}, 'Alex')).christmasSkinTest).toBe(true);
    // The link turned off: gone.
    expect((await markCalls(w, 'Alex', false)).data.marked).toBe(false);
    expect((await group(w, {}, 'Alex')).christmasSkinTest).toBeUndefined();
  });
  it('only the organizer\'s own player can set it (anyone else gets a quiet no and nothing is saved); never in View as; the kill switch beats it', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 11, 13, 10));
    const blair = await markCalls(w, 'Blair', true);
    expect(blair.status).toBe(200);
    expect(blair.data.marked).toBe(false);
    expect((await group(w, {}, 'Alex')).christmasSkin).toBeUndefined();
    await markCalls(w, 'Alex', true);
    // View as (the organizer's demo copy of Alex) does not get it and does not set it.
    await signIn(w);
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Alex });
    expect(as.data.christmasSkin).toBeUndefined();
    // The kill switch hides it; an "off" link still clears the mark even then; "on" waits (the phone keeps its note).
    env(w).CHRISTMAS_SKIN = 'off';
    expect((await group(w, {}, 'Alex')).christmasSkin).toBeUndefined();
    const keep = await markCalls(w, 'Alex', true);
    expect(keep.data.applied).toBe(false);
    env(w).CHRISTMAS_SKIN = 'on';
    expect((await group(w, {}, 'Alex')).christmasSkin).toBe(true); // the earlier mark is still there
    env(w).CHRISTMAS_SKIN = 'off';
    const cleared = await markCalls(w, 'Alex', false);
    expect(cleared.data.applied).toBe(true);
    env(w).CHRISTMAS_SKIN = 'on';
    expect((await group(w, {}, 'Alex')).christmasSkin).toBeUndefined(); // an off link opened while the kill switch was off still cleared it
  });
  it('View as never gets the test mode, even with the private header, and its POST neither sets nor clears the mark', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    at(w, est(2026, 11, 13, 10));
    await signIn(w);
    const as = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Blair, 'X-Christmas-Skin': 'on' });
    expect(as.status).toBe(200);
    expect(as.data.christmasSkin).toBeUndefined();
    expect(as.data.christmasSkinTest).toBeUndefined();
    const post = await w.organizer.call('POST', '/api/christmas-skin-tester', { on: true }, { 'X-View-As': w.byName.Alex });
    expect(post.data.marked).toBe(false);
    expect((await group(w, {}, 'Alex')).christmasSkin).toBeUndefined();
  });
  it('only the organizer\'s own player costs an extra read (everyone else\'s answer asks nothing new)', async () => {
    const w = await setupGroup();
    setOrganizer(w);
    await markCalls(w, 'Alex', true);
    const asked: string[] = [];
    const real = w.app.db.prepare.bind(w.app.db);
    (w.app.db as any).prepare = (sql: string) => {
      const stmt = real(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...v: unknown[]) => {
        if (v.includes('christmas_skin_tester')) asked.push(sql);
        return bind(...v);
      };
      return stmt;
    };
    at(w, est(2026, 11, 13, 10));
    await group(w, {}, 'Blair');
    expect(asked).toEqual([]);
    await group(w, {}, 'Alex');
    expect(asked.length).toBe(1);
  });
  it('the page tells the server only for the private link, once a name is picked, never in View as; and the link also clears the first-ON note', () => {
    const lib = readFileSync(new URL('../src/lib.ts', import.meta.url), 'utf8');
    expect(lib).toContain("if (link === 'on' || link === 'off') storageSet(SERVER_KEY, link);");
    expect(lib).toContain('storageRemove(BACK_KEY);');
    const root = readFileSync(new URL('../src/skin/useSkinRoot.ts', import.meta.url), 'utf8');
    expect(root).toContain("if (!meId || viewAs) return;");
    expect(root).toContain("'/api/christmas-skin-tester'");
    expect(root).toContain('if (res.applied === false) return;');
  });
});

describe('Part E: the look changes (Alex, round 1)', () => {
  const css = readFileSync(new URL('../src/skin/christmas.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../src/skin/theme.tsx', import.meta.url), 'utf8');
  it('my own ornament has no ring any more: just a very faint gold glow and a tiny slow sway, and only mine', () => {
    expect(theme).not.toMatch(/stroke="var\(--primary\)"/);
    expect(theme).not.toMatch(/r=\{r\}/);
    expect(css).toMatch(/\.dots \.xorn\.me:not\(\.xin\):not\(\.xjoin\):not\(\.xjingle\) \{\s*filter: drop-shadow\(0 0 3px rgb\(242 179 61 \/ 32%\)\);\s*animation: xsway 5\.5s ease-in-out infinite;/);
    expect(css).toMatch(/@keyframes xsway \{\s*0%,\s*100% \{\s*transform: rotate\(-2\.5deg\);\s*\}\s*50% \{\s*transform: rotate\(2\.5deg\);/);
  });
  it('the one-by-one glow on tonight cards is gone (no xglow, no game day glow rule, no per-seat delay)', () => {
    expect(css).not.toMatch(/xglow/);
    expect(css).not.toMatch(/sched\.gd \.dots \.xorn/);
    expect(readFileSync(new URL('../src/ui.tsx', import.meta.url), 'utf8')).not.toContain("'--pd'");
  });
  it('the tonight shimmer is about half as bright and softer, same timing, light and dark (this one change is on live)', () => {
    const z7 = readFileSync(new URL('../src/zip7.css', import.meta.url), 'utf8');
    expect([...z7.matchAll(/--z7-sweep: rgb\(255 255 255 \/ (\d+)%\);/g)].map((m) => m[1])).toEqual(['17', '15', '15']);
    expect(z7).toContain('linear-gradient(110deg, transparent 22%, var(--z7-sweep) 50%, transparent 78%)');
    expect(z7).toContain('animation: z7-sweep 3.6s ease-in-out infinite;'); // the same timing
    expect(z7).toMatch(/@keyframes z7-sweep \{\s*0%,\s*55% \{\s*background-position: 130% 0;\s*\}\s*100% \{\s*background-position: -30% 0;/);
  });
});
