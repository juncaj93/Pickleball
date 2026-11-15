// Zip 48 (speed split): what happens when the organizer file does not arrive (src/adminRecover.ts), and the "organizer phone" flag that
// lets the organizer's own player screens fetch the organizer file ahead (src/organizerPhone.ts, src/lastAdmin.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { afterLoadFailed, isAdminPath, RELOAD_GUARD_MS } from '../src/adminRecover';
import { isOrganizerPhone, markOrganizerPhone, ORGANIZER_PHONE_KEY } from '../src/organizerPhone';
import { signedOutLastAdmin } from '../src/lastAdmin';

const NOW = Date.parse('2026-11-15T20:00:00.000Z');

describe('Zip 48: after the organizer file failed', () => {
  it('no signal: the Try again screen, never a reload (a reload would show the phone error page)', () => {
    expect(afterLoadFailed({ online: false, userAsked: false, lastReloadAt: null, nowMs: NOW })).toBe('retry-screen');
    expect(afterLoadFailed({ online: false, userAsked: true, lastReloadAt: null, nowMs: NOW })).toBe('retry-screen');
  });
  it('the site answers (an old page after a deploy): reload once by itself', () => {
    expect(afterLoadFailed({ online: true, userAsked: false, lastReloadAt: null, nowMs: NOW })).toBe('reload');
  });
  it('a second failure within a minute of that reload: the Try again screen, so it never loops', () => {
    expect(afterLoadFailed({ online: true, userAsked: false, lastReloadAt: NOW - 5_000, nowMs: NOW })).toBe('retry-screen');
    expect(afterLoadFailed({ online: true, userAsked: false, lastReloadAt: NOW - RELOAD_GUARD_MS + 1, nowMs: NOW })).toBe('retry-screen');
    expect(afterLoadFailed({ online: true, userAsked: false, lastReloadAt: NOW - RELOAD_GUARD_MS, nowMs: NOW })).toBe('reload');
  });
  it('a tap on Try again may always reload when the site answers', () => {
    expect(afterLoadFailed({ online: true, userAsked: true, lastReloadAt: NOW - 1_000, nowMs: NOW })).toBe('reload');
  });
  it('a reload time in the future (phone clock moved back) does not block the one reload forever', () => {
    expect(afterLoadFailed({ online: true, userAsked: false, lastReloadAt: NOW + 3_600_000, nowMs: NOW })).toBe('reload');
  });
});

describe('Zip 48: which address opens the organizer screens', () => {
  it('only /admin and /admin/, as before', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    for (const p of ['/', '/admin/x', '/administrator', '/g/abc', '/go/x', '/gt/x', '/setup', '/t/x']) expect(isAdminPath(p), p).toBe(false);
  });
  it('the page router uses the same test', () => {
    const main = readFileSync(join(__dirname, '../src/main.tsx'), 'utf8');
    expect(main).toContain('if (isAdminPath(path)) return <AdminRoute />;');
    expect(main).not.toMatch(/from '\.\/pages\/Admin'/);
  });
});

describe('Zip 48: the organizer phone flag', () => {
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => {
    delete g.localStorage;
  });
  function fakeStorage() {
    const m = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    return m;
  }
  it('set by the dashboard, cleared by sign out (and by a "sign in again" answer, which uses the same call)', () => {
    const m = fakeStorage();
    expect(isOrganizerPhone()).toBe(false);
    markOrganizerPhone(true);
    expect(m.get(ORGANIZER_PHONE_KEY)).toBe('1');
    expect(isOrganizerPhone()).toBe(true);
    signedOutLastAdmin(null);
    expect(isOrganizerPhone()).toBe(false);
  });
  it('storage blocked: no flag, no error', () => {
    g.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => markOrganizerPhone(true)).not.toThrow();
    expect(isOrganizerPhone()).toBe(false);
  });
  it('holds no data, only "1"', () => {
    const src = readFileSync(join(__dirname, '../src/organizerPhone.ts'), 'utf8');
    expect(src).toContain("localStorage.setItem(ORGANIZER_PHONE_KEY, '1')");
    expect(src.match(/setItem\(/g)?.length).toBe(1);
  });
  it('the dashboard sets it and the player screen uses it only outside View as', () => {
    const admin = readFileSync(join(__dirname, '../src/pages/Admin.tsx'), 'utf8');
    expect(admin).toContain('if (load.data) markOrganizerPhone(true);');
    const player = readFileSync(join(__dirname, '../src/pages/PlayerHome.tsx'), 'utf8');
    expect(player).toContain('const [organizerPhone] = useState(isOrganizerPhone);');
    expect(player).toContain('const organizerHere = !viewAs && !!g && (g.goToAdmin === true || organizerPhone);');
  });
});
