// Zip 102 (🎾102.skin first paint): the Christmas skin from the first paint. The phone remembers the last mode the server said (pb_xmas_mode);
// public/theme-2.js, before the page draws, starts a player Home in that mode inside the window (the Christmas logo for Everyone, the theme only
// when this phone had it ON, the logo image fetched at once); the skin store starts from it; the first real answer agrees (nothing moves) or
// switches quietly once and the memory follows. Never /admin. Storage blocked or a first visit: exactly as before.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { earlySkin, inChristmasWindow, MODE_KEY, THEME_KEY, writeMode } from '../shared/christmasSkin';

const SCRIPT = readFileSync(new URL('../public/theme-2.js', import.meta.url), 'utf8');
const est = (y: number, mo: number, d: number, h = 12, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi); // EST (UTC-5) is right for Nov/Dec/Jan

/** Runs public/theme-2.js the way a phone does: an address, a memory, a clock. Returns the <html> attributes and the preloads it added. */
function runEarly(path: string, store: Record<string, string> | 'blocked', nowMs: number) {
  const attrs: Record<string, string> = {};
  const head: { rel: string; as: string; href: string }[] = [];
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(nowMs);
      else super(...(a as [number]));
    }
    static now() {
      return nowMs;
    }
  }
  const localStorage =
    store === 'blocked'
      ? {
          getItem: () => {
            throw new Error('blocked');
          },
        }
      : { getItem: (k: string) => (k in store ? store[k] : null) };
  runInNewContext(SCRIPT, {
    location: { pathname: path },
    localStorage,
    Date: FakeDate,
    Intl,
    Number,
    document: {
      documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) },
      createElement: () => ({ setAttribute() {} }) as any,
      head: { appendChild: (l: any) => void head.push({ rel: l.rel, as: l.as, href: l.href }) },
    },
  });
  return { attrs, head };
}

describe('the early script (public/theme-2.js) and the shared rule agree', () => {
  const paths = ['/', '/g/abc_DEF-1', '/g/abc/', '/admin', '/admin/settings', '/go/x', '/gt/x', '/setup', '/t/x', '/g/', '/g/a/b'];
  const memories: Record<string, string>[] = [
    {},
    { [MODE_KEY]: 'all' },
    { [MODE_KEY]: 'all', [THEME_KEY]: 'on' },
    { [MODE_KEY]: 'all', [THEME_KEY]: 'off' },
    { [MODE_KEY]: 'me-on' },
    { [MODE_KEY]: 'me-off' },
    { [MODE_KEY]: 'off', [THEME_KEY]: 'on' },
    { [MODE_KEY]: 'junk', [THEME_KEY]: 'on' },
    { [THEME_KEY]: 'on' }, // a phone from before Zip 102: no mode yet = plain, exactly as before
  ];
  const clocks = [
    est(2026, 11, 26, 23, 59), // Thanksgiving night: out
    est(2026, 11, 27, 0, 1), // the Friday after: in
    est(2026, 11, 28, 12),
    est(2026, 12, 25, 9),
    est(2026, 12, 31, 23, 59),
    est(2027, 1, 1, 0, 1), // out
    est(2027, 11, 25, 12), // Thanksgiving 2027: out
    est(2027, 11, 26, 12), // in
    est(2026, 7, 4, 12),
  ];
  it('every address x memory x clock gives the same start, the theme only when ON, the hat logo fetched for Everyone', () => {
    for (const p of paths)
      for (const m of memories)
        for (const now of clocks) {
          const want = earlySkin(p, m[MODE_KEY] ?? null, m[THEME_KEY] ?? null, now);
          const { attrs, head } = runEarly(p, m, now);
          const tag = `${p} ${JSON.stringify(m)} ${new Date(now).toISOString()}`;
          expect(attrs['data-skin-early'] ?? null, tag).toBe(want ? `${want.mode}-${want.on ? 'on' : 'off'}` : null);
          expect(attrs['data-skin'] ?? null, tag).toBe(want?.on ? 'christmas' : null);
          expect(head, tag).toEqual(want?.mode === 'all' ? [{ rel: 'preload', as: 'image', href: '/logo-xmas.png' }] : []);
        }
  });
  it('the shared rule follows the window every day of 2020 to 2040 (late Nov to early Jan)', () => {
    for (let y = 2020; y <= 2040; y++)
      for (let t = est(y, 11, 20); t < est(y + 1, 1, 3); t += 86_400_000) {
        expect(!!earlySkin('/', 'all', 'on', t)).toBe(inChristmasWindow(t));
        expect(runEarly('/', { [MODE_KEY]: 'all', [THEME_KEY]: 'on' }, t).attrs['data-skin'] === 'christmas').toBe(inChristmasWindow(t));
      }
  });
  it('/admin never: whatever the memory says', () => {
    for (const p of ['/admin', '/admin/', '/admin/money']) expect(runEarly(p, { [MODE_KEY]: 'all', [THEME_KEY]: 'on' }, est(2026, 12, 5)).attrs).toEqual({});
  });
  it('storage blocked: nothing, no error', () => {
    expect(() => runEarly('/', 'blocked', est(2026, 12, 5))).not.toThrow();
    expect(runEarly('/', 'blocked', est(2026, 12, 5)).attrs).toEqual({});
  });
  it('the dark/light part is unchanged and still first', () => {
    expect(SCRIPT.indexOf("localStorage.getItem('pb_theme')")).toBeGreaterThan(-1);
    expect(SCRIPT.indexOf("localStorage.getItem('pb_theme')")).toBeLessThan(SCRIPT.indexOf('pb_xmas_mode'));
  });
  it('the page links the new file name (phones keep the old theme.js for a day)', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<script src="/theme-2.js"></script>');
    expect(html).not.toContain('/theme.js');
  });
});

describe('the skin store starts from the early script and settles on the first answer', () => {
  const realGlobals = { document: (globalThis as any).document, matchMedia: (globalThis as any).matchMedia, localStorage: (globalThis as any).localStorage };
  afterEach(() => {
    for (const [k, v] of Object.entries(realGlobals)) {
      if (v === undefined) delete (globalThis as any)[k];
      else (globalThis as any)[k] = v;
    }
    vi.useRealTimers();
    vi.resetModules();
  });
  /** A fake page whose <html> already carries what theme-2.js left (`early`), and a phone memory. */
  function fakePage(early: Record<string, string>, store: Record<string, string> = {}) {
    const attrs: Record<string, string> = { ...early };
    (globalThis as any).document = {
      documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v), removeAttribute: (k: string) => void delete attrs[k], getAttribute: (k: string) => attrs[k] ?? null },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as any).matchMedia = () => ({ matches: false });
    (globalThis as any).localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] };
    return { attrs, store };
  }
  const load = async () => import('../src/skin/store');
  const ON = { 'data-skin-early': 'all-on', 'data-skin': 'christmas' };

  it('remembered ON: the store starts dressed (Christmas logo + theme), no pop-in, no bubble; the same answer moves nothing', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage(ON, { [MODE_KEY]: 'all', [THEME_KEY]: 'on' });
    const s = await load();
    expect(s.skinStateNow()).toMatchObject({ mode: 'all', on: true, phase: 'idle', bubble: null });
    let moves = 0;
    const seen = s.skinStateNow();
    s.setSkinAvailable('all', false, false, true);
    if (s.skinStateNow() !== seen) moves++;
    expect(moves).toBe(0);
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBeUndefined();
    expect(store[MODE_KEY]).toBe('all');
  });
  it('remembered Everyone with the theme OFF: the Christmas logo from the start (mode all), the page plain, the first-visit bubble never again', async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage({ 'data-skin-early': 'all-off' }, { [MODE_KEY]: 'all', [THEME_KEY]: 'off', pb_xmas_hint: '1' });
    const s = await load();
    expect(s.skinStateNow()).toMatchObject({ mode: 'all', on: false, bubble: null });
    expect(attrs['data-skin']).toBeUndefined();
    const seen = s.skinStateNow();
    s.setSkinAvailable('all', false, false, true);
    expect(s.skinStateNow()).toBe(seen);
    // The logo is still the button: a tap turns the theme on with the pop-in.
    s.toggleSkin();
    expect(attrs['data-skin']).toBe('christmas');
    expect(attrs['data-skin-anim']).toBe('in');
  });
  it('server Off on a remembered ON phone: plain at once, quietly (no motion), and the memory says off', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage(ON, { [MODE_KEY]: 'all', [THEME_KEY]: 'on' });
    const s = await load();
    s.setSkinAvailable('off', false, false, true);
    expect(s.skinStateNow().mode).toBe('off');
    expect(attrs['data-skin']).toBeUndefined();
    expect(attrs['data-skin-anim']).toBeUndefined();
    expect(attrs['data-skin-early']).toBeUndefined();
    expect(store[MODE_KEY]).toBe('off');
  });
  it('remembered Everyone, server Just me (another player on this phone gets nothing, Alex gets the normal logo): quiet, memory follows', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ 'data-skin-early': 'all-off' }, { [MODE_KEY]: 'all' });
    const s = await load();
    s.setSkinAvailable('me', false, false, true);
    expect(s.skinStateNow()).toMatchObject({ mode: 'me', on: false, phase: 'idle' });
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[MODE_KEY]).toBe('me-off');
  });
  it('Just me remembered ON, the server says its saved choice is off (another phone tapped it): plain, quietly; a tap is written down', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({ 'data-skin-early': 'me-on', 'data-skin': 'christmas' }, { [MODE_KEY]: 'me-on' });
    const s = await load();
    s.setMePersist(() => {});
    expect(s.skinStateNow()).toMatchObject({ mode: 'me', on: true });
    s.setSkinAvailable('me', false, false, true);
    expect(s.skinStateNow()).toMatchObject({ mode: 'me', on: false, phase: 'idle' });
    expect(attrs['data-skin']).toBeUndefined();
    expect(store[MODE_KEY]).toBe('me-off');
    s.toggleSkin();
    expect(store[MODE_KEY]).toBe('me-on');
  });
  it('first visit / no marker: IDLE as before; the first answer is written down for next time', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage({});
    const s = await load();
    expect(s.skinStateNow().mode).toBe('off');
    s.setSkinAvailable('all', false, false, true);
    expect(store[MODE_KEY]).toBe('all');
    expect(attrs['data-skin']).toBeUndefined();
  });
  it('View as never writes the memory; leaving for admin puts the page back to plain', async () => {
    vi.useFakeTimers();
    const { attrs, store } = fakePage(ON, { [MODE_KEY]: 'all', [THEME_KEY]: 'on' });
    const s = await load();
    s.resetSkin(); // the organizer screens
    expect(attrs['data-skin']).toBeUndefined();
    expect(attrs['data-skin-early']).toBeUndefined();
    s.setSkinAvailable('off', true, false, false); // View as
    expect(store[MODE_KEY]).toBe('all');
  });
  it("React's double setup before the first answer: the start from memory comes back (resumeEarly), and never after an answer", async () => {
    vi.useFakeTimers();
    const { attrs } = fakePage(ON, { [MODE_KEY]: 'all', [THEME_KEY]: 'on' });
    const s = await load();
    s.resetSkin();
    s.resumeEarly();
    expect(s.skinStateNow()).toMatchObject({ mode: 'all', on: true });
    expect(attrs['data-skin']).toBe('christmas');
    s.setSkinAvailable('all', false, false, true);
    s.resetSkin();
    s.resumeEarly();
    expect(s.skinStateNow().mode).toBe('off');
    expect(attrs['data-skin']).toBeUndefined();
  });
  it('markers that disagree (data-skin without the early mark): plain', async () => {
    const { attrs } = fakePage({ 'data-skin': 'christmas' });
    const s = await load();
    expect(s.skinStateNow().mode).toBe('off');
    expect(attrs['data-skin']).toBeUndefined();
  });
  it('writeMode never throws on blocked storage', () => {
    const blocked = {
      get: () => {
        throw new Error('x');
      },
      set: () => {
        throw new Error('x');
      },
    };
    expect(() => writeMode(blocked, 'all')).not.toThrow();
  });
});
