// Zip 50: a re-check of the Zip 48 split (the organizer screens in their own download), in three parts:
// (a) The organizer files are useless without the PIN: the built organizer files hold no private value (no phone number, PIN, secret,
//     group key, Venmo or Zelle value, no player name), even when the build machine has real secrets in its environment; and every
//     /api/admin/* route answers 401 to a phone without the organizer cookie (signed out, with the group link, a player, a forged
//     cookie), with nothing changed in the database.
// (b) Every deep link still opens the same screen: the page router's own address rules, read from src/main.tsx, give each address its
//     screen; every private test link (?something=on) is read by the player download as soon as the page starts, so it works on /admin
//     before the organizer file arrives (and on the player screens, where the organizer file never comes).
// (c) An old page after a deploy recovers by reloading once (src/adminChunk.ts loadOrRecover, run for real with a fake organizer file):
//     exactly one reload, written down in sessionStorage first; a second failure within a minute shows Try again (no loop); storage
//     blocked or not keeping the note: no reload; no signal: Try again, no reload; a tap on Try again may reload.
// One build (about 5 seconds). No network: the server runs in-process on an in-memory database, the fetches in (c) are fakes.
// Never write a real value into this file: the secrets below are random values made for this run.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { routeList } from '../server/app';
import { firstSession, PIN, PLAYER_NAMES, playerPhone, SETUP_TOKEN, setupGroup, TestApp } from './harness';
import { SMALL_CAST, SMALL_LONG, SMALL_ORGANIZER } from '../scripts/preview-world-small';
import { isAdminPath, RELOAD_GUARD_MS, RELOAD_KEY } from '../src/adminRecover';

const ROOT = join(__dirname, '..');
const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

// ---------------------------------------------------------------------------------------------------------------------------------
// The build: once, with random "secrets" in the build machine's environment (the names the server reads), and hidden source maps
// (the .map files say which source file went into which built file; the built files themselves are byte for byte a normal build,
// with no map comment).
// ---------------------------------------------------------------------------------------------------------------------------------
const CANARY = {
  SETUP_TOKEN: `canary-setup-${randomBytes(12).toString('hex')}`,
  CRON_SECRET: `canary-cron-${randomBytes(12).toString('hex')}`,
  ORGANIZER_READONLY_PIN: String(10_000_000 + (randomBytes(4).readUInt32BE() % 89_999_999)),
  TELEGRAM_BOT_TOKEN: `${100000 + (randomBytes(3).readUIntBE(0, 3) % 899999)}:canary${randomBytes(16).toString('hex')}`,
  TELEGRAM_CHAT_ID: `-100${randomBytes(5).readUIntBE(0, 5)}`,
  GO_LINKS: `canary-golinks-${randomBytes(8).toString('hex')}`,
  // A VITE_ name is the kind a build CAN bake in when code reads it (import.meta.env); none is read, so none may show up.
  VITE_CANARY: `canary-vite-${randomBytes(8).toString('hex')}`,
};

let dist = '';
let assets: string[] = [];
/** The files /admin adds (dist/admin.html's extra lines): the organizer script, its own pieces, its style file. */
let organizerFiles: string[] = [];
let mainJs = '';
const sourcesOf = new Map<string, string[]>();

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'zip50-dist-'));
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error', '--sourcemap', 'hidden'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: 'zip50-test', ...CANARY },
    stdio: 'pipe',
  });
  assets = readdirSync(join(dist, 'assets'));
  const adminHtml = readFileSync(join(dist, 'admin.html'), 'utf8');
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
  organizerFiles = [...adminHtml.matchAll(/href="\/assets\/([^"]+)"/g)].map((m) => m[1]).filter((f) => !indexHtml.includes(`/assets/${f}`));
  mainJs = /src="\/assets\/(index-[^"]+\.js)"/.exec(indexHtml)![1];
  for (const f of assets.filter((x) => x.endsWith('.js.map'))) {
    const map = JSON.parse(readFileSync(join(dist, 'assets', f), 'utf8')) as { sources: string[] };
    sourcesOf.set(
      f.replace(/\.map$/, ''),
      map.sources.filter((s) => !s.includes('node_modules')).map((s) => s.replace(/^.*?\/(src|shared|server|scripts|migrations)\//, '$1/').replace(/\?raw$/, '')),
    );
  }
}, 120_000);

afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const built = (f: string) => readFileSync(join(dist, 'assets', f), 'utf8');

/** Phone-number shapes: (313) 555-0100, 313-555-0100, 313.555.0100, +1 313 555 0100, and ten digits in a row. */
function phoneShapes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\d.])(?:\+?1[-. ]?)?\(?([2-9]\d{2})\)?[-. ]?(\d{3})[-. ](\d{4})(?!\d)/g)) out.push(m[1] + m[2] + m[3]);
  for (const m of text.matchAll(/(?<![\d.\w])([2-9]\d{2})([2-9]\d{2})(\d{4})(?![\d.\w])/g)) out.push(m[1] + m[2] + m[3]);
  return out;
}
/** A 555 exchange is a made-up number (TV, examples); every other phone-shaped string counts as real. Never print one. */
const realPhones = (text: string) => phoneShapes(text).filter((n) => n.slice(3, 6) !== '555');

describe('Zip 50 (a): the organizer files hold no private value', () => {
  it('the build has organizer files, and admin.html is the only page that names them', () => {
    expect(organizerFiles.some((f) => /^AdminEntry-.*\.js$/.test(f))).toBe(true);
    expect(organizerFiles.some((f) => /^AdminEntry-.*\.css$/.test(f))).toBe(true);
    const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
    for (const f of organizerFiles) expect(indexHtml).not.toContain(f);
    // The built files carry no map comment (the maps here are this test's own, "hidden"), as in a real build.
    for (const f of assets.filter((x) => /\.(js|css)$/.test(x))) expect(built(f), f).not.toMatch(/sourceMappingURL/);
  });

  it('no secret from the build machine is baked into any built file (organizer files included)', () => {
    const files = [
      ...assets.filter((f) => /\.(js|css|html)$/.test(f)).map((f) => join(dist, 'assets', f)),
      join(dist, 'index.html'),
      join(dist, 'admin.html'),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [name, value] of Object.entries(CANARY)) if (text.includes(value)) hits.push(`${name} in ${file.replace(dist, 'dist')}`);
    }
    expect(hits).toEqual([]);
  });

  it('no PIN or setup token the repository knows (tests, the preview database notes) is in the organizer files', () => {
    const previewPin = /PIN `(\d{6})`/.exec(src('docs/PREVIEW_FAKE_DB.md'))![1];
    const known = { harnessPin: PIN, previewPin, harnessSetupToken: SETUP_TOKEN, devSetupToken: 'local-dev-setup-token' };
    for (const f of organizerFiles) {
      const text = built(f);
      for (const [name, value] of Object.entries(known)) expect(text.includes(value), `${name} in ${f}`).toBe(false);
    }
  });

  it('no real phone number in the organizer files (only made-up 555 examples in the hints)', () => {
    for (const f of organizerFiles) {
      // Count only: a phone number must never be printed, even by a failing test.
      expect(realPhones(built(f)).length, `phone-shaped strings that are not 555 examples in ${f}`).toBe(0);
    }
    // The check itself finds a number in every shape it claims to (random digits made at run time, never written here or printed).
    const dig = (n: number, first = 2) => String(first + (randomBytes(1)[0] % (10 - first))) + Array.from(randomBytes(n - 1), (b) => b % 10).join('');
    const [a, b, c] = [dig(3), dig(3, 6), dig(4, 0)];
    const sample = `x (${a}) ${b}-${c} y ${a}-${b}-${c} z ${a}.${b}.${c} w +1 ${a} ${b} ${c} v ${a}${b}${c} u`;
    expect(realPhones(sample).length).toBe(5);
    expect(realPhones(`(${a}) 555-${c}`).length).toBe(0);
  });

  it('no Zelle or Venmo value in the organizer files (Zip 50: no built-in Zelle number anywhere), Venmo only as a hint', () => {
    // Zip 50: there is no Zelle default in the code any more; the organizer file has no Zelle value of its own either.
    expect(sourcesOf.get(mainJs)).toContain('shared/settings.ts');
    for (const f of organizerFiles.filter((x) => x.endsWith('.js'))) {
      expect(sourcesOf.get(f) ?? [], f).not.toContain('shared/settings.ts');
      const text = built(f);
      const venmo = [...text.matchAll(/venmo\.com\/(?:u\/)?([A-Za-z0-9_-]*)/gi)].map((m) => m[1]).filter((u) => u !== '' && u !== 'Name' && u !== 'code');
      expect(venmo, `Venmo usernames in ${f}`).toEqual([]);
      expect(text).not.toMatch(/venmo:\/\/[^"'`]*recipients=[A-Za-z0-9]/i);
      expect(text, f).not.toMatch(/zelleNumber\s*:\s*["'`]\d/);
    }
  });

  it('no group key and no player name in the organizer files (the organizer word "Alex" in the button names is wording)', () => {
    const names = [...new Set([...SMALL_CAST, SMALL_LONG, ...PLAYER_NAMES])].filter((n) => n !== SMALL_ORGANIZER);
    expect(names.length).toBeGreaterThan(10);
    for (const f of organizerFiles) {
      const text = built(f);
      for (const n of names) expect(new RegExp(`\\b${n}\\b`).test(text), `${n} in ${f}`).toBe(false);
      // A group link carries a long random key: none is written into a built file.
      expect(text, f).not.toMatch(/\/g\/[A-Za-z0-9_-]{12,}/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) The server side: every organizer route refuses a phone without the organizer cookie.
// ---------------------------------------------------------------------------------------------------------------------------------
function dbSnapshot(app: TestApp, skip = ['login_attempts', 'rate_events']): string {
  const tables = (app.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map((t) => t.name)
    .filter((t) => !skip.includes(t));
  return tables.map((t) => `${t}:${JSON.stringify(app.db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

describe('Zip 50 (a): every /api/admin route answers 401 without the organizer cookie', () => {
  const ADMIN = routeList().filter((r) => r.path.startsWith('/api/admin/'));
  /** Anyone may call these: the PIN screen itself, and signing out (which only clears this phone's cookie). */
  const OPEN = ['POST /api/admin/login', 'POST /api/admin/logout'];

  it('the route list is the live one, and every organizer route is under /api/admin/', () => {
    const app = src('server/app.ts');
    const declared = [...app.matchAll(/^route\('([A-Z]+)', '(\/api\/admin\/[^']+)'/gm)].map((m) => `${m[1]} ${m[2].replace(/:\w+/g, ':param')}`);
    expect(declared.length).toBeGreaterThan(100);
    expect(ADMIN.map((r) => `${r.method} ${r.path}`).sort()).toEqual([...new Set(declared)].sort());
    // Organizer handlers (server/admin.ts) are only wired to /api/admin/ addresses.
    const elsewhere = [...app.matchAll(/^route\('[A-Z]+', '([^']+)', admin\./gm)].map((m) => m[1]).filter((p) => !p.startsWith('/api/admin/'));
    expect(elsewhere).toEqual([]);
  });

  it('signed out, on the group link, a player phone, forged cookies: 401 admin_required on every route, no data, nothing changes', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const caseyPhone = await playerPhone(ctx, 'Casey');
    await caseyPhone.call('POST', `/api/sessions/${s.id}/join`, {});
    const ids = { session: s.id, player: ctx.byName.Casey };
    const bare = ctx.app.client();
    const onLink = ctx.app.client();
    onLink.groupKey = ctx.groupKey;
    const blair = await playerPhone(ctx, 'Blair');
    const forged = await playerPhone(ctx, 'Devon');
    forged.cookies.set('pb_admin', 'B'.repeat(43));
    const forgedRo = await playerPhone(ctx, 'Emery');
    forgedRo.cookies.set('pb_admin', 'ro.' + 'A'.repeat(43));
    // The real organizer cookie, from the organizer's own phone, pasted with one letter changed.
    const real = ctx.organizer.cookies.get('pb_admin')!;
    expect(real).toBeTruthy();
    const tampered = await playerPhone(ctx, 'Frankie');
    tampered.cookies.set('pb_admin', real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A'));

    const fill = (p: string) =>
      p
        .replace(/sessions\/:param/, `sessions/${ids.session}`)
        .replace(/players\/:param/, `players/${ids.player}`)
        .replace(/:param/g, ids.player);
    const bodies: Record<string, unknown>[] = [{}, { on: true, booked: true, paid: true, playerId: ids.player, confirm: true, pin: PIN, month: '2026-10' }];
    const before = dbSnapshot(ctx.app);
    const wrong: string[] = [];
    let calls = 0;
    for (const [label, who] of [['signed out', bare], ['group link', onLink], ['player', blair], ['forged', forged], ['forged ro', forgedRo], ['tampered', tampered]] as const) {
      for (const r of ADMIN) {
        const key = `${r.method} ${r.path}`;
        if (OPEN.includes(key)) continue;
        const asks: { path: string; body?: Record<string, unknown> }[] =
          r.method === 'GET' ? [{ path: fill(r.path) }, { path: `${fill(r.path)}?month=2026-10&session=${ids.session}` }] : bodies.map((body) => ({ path: fill(r.path), body }));
        for (const a of asks) {
          const res = await who.call(r.method, a.path, a.body, { Origin: 'https://club.example' });
          calls++;
          // Known, harmless: Court answer checks its one field before the sign-in (an empty body gets "booked must be..."). It shows
          // nothing and changes nothing; with a real answer it is the same 401 as every other route (the second body).
          if (key === 'POST /api/admin/sessions/:param/court-answer' && a.body && !('booked' in a.body) && res.status === 400 && res.data?.error === 'invalid_booked') continue;
          // A cookie that starts like the read-only one is refused every write before any route runs (server/app.ts, the view-only
          // guard): 403 view_only, also refused, also nothing shown. Its reads get the same 401 as everyone.
          if (label === 'forged ro' && r.method !== 'GET' && res.status === 403 && res.data?.error === 'view_only') continue;
          if (res.status !== 401 || res.data?.error !== 'admin_required') wrong.push(`${label}: ${key} ${res.status} ${res.data?.error}`);
          // A refusal carries no organizer data: only the error and its message.
          if (res.status === 401 && Object.keys(res.data ?? {}).some((k) => k !== 'error' && k !== 'message')) wrong.push(`${key} 401 with ${Object.keys(res.data).join(',')}`);
          if (/Casey|Blair|555-01/.test(res.text)) wrong.push(`${key} answered with player data`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(calls).toBeGreaterThan(600);
    expect(dbSnapshot(ctx.app)).toBe(before);
    // The same phones with the PIN would get in: the sweep really reached the routes (not refused for some other reason).
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
  });

  it('the PIN screen and sign out: a wrong PIN is 401 wrong_pin and signs nobody in; sign out signs nobody in', async () => {
    const ctx = await setupGroup();
    const c = ctx.app.client();
    const wrongPin = [...String(PIN)].map((d) => String((Number(d) + 1) % 10)).join('');
    const bad = await c.call('POST', '/api/admin/login', { pin: wrongPin }, { Origin: 'https://club.example' });
    expect(bad.status).toBe(401);
    expect(bad.data?.error).toBe('wrong_pin');
    expect((await c.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await c.call('POST', '/api/admin/logout', {}, { Origin: 'https://club.example' })).status).toBe(200);
    expect((await c.call('GET', '/api/admin/dashboard')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) Deep links.
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The page router of src/main.tsx (function App), read from the file itself and run on an address: the address rules in their order,
 * so this follows any change to them. Answers the screen's component name.
 */
function routerFromMain(): (path: string) => string {
  const main = src('src/main.tsx');
  const body = /function App\(\) \{([\s\S]*?)\n\}/.exec(main)![1];
  const rules: { test: (p: string) => boolean; screen: string }[] = [];
  for (const line of body.split('\n')) {
    let m: RegExpExecArray | null;
    if ((m = /path\.match\((\/.+\/)\)\)\) return <(\w+)/.exec(line))) {
      const re = new Function(`return ${m[1]}`)() as RegExp;
      rules.push({ test: (p) => re.test(p), screen: m[2] });
    } else if ((m = /if \((\/.+\/)\.test\(path\)\)\s*\{?\s*(?:return <(\w+))?/.exec(line))) {
      const re = new Function(`return ${m[1]}`)() as RegExp;
      // The old /t/ link: rewrites the address, then the home page (the next lines say so).
      rules.push({ test: (p) => re.test(p), screen: m[2] ?? (/\/\^\\\/t/.test(m[1]) ? 'SiteHome' : '?') });
    } else if ((m = /if \(isAdminPath\(path\)\) return <(\w+)/.exec(line))) {
      rules.push({ test: isAdminPath, screen: m[1] });
    } else if ((m = /^\s*return <(\w+) \/>;\s*$/.exec(line)) && rules.length > 3) {
      rules.push({ test: () => true, screen: m[1] });
    }
  }
  return (path: string) => rules.find((r) => r.test(path))?.screen ?? 'none';
}

describe('Zip 50 (b): every deep link opens its screen', () => {
  const screen = routerFromMain();
  /** Cloudflare Pages (checked on the preview, docs/STAGE_NOTES.md Zip 48): /admin/ and /admin.html answer 308 to /admin, keeping the ?... */
  const pages = (url: string) => {
    const u = new URL(url, 'https://club.example');
    if (u.pathname === '/admin/' || u.pathname === '/admin.html') u.pathname = '/admin';
    return u;
  };

  it('the address rules read from src/main.tsx are all there (the reader itself is checked)', () => {
    expect(screen('/g/AbC_12-x')).toBe('PlayerHome');
    expect(screen('/nothing')).toBe('SiteHome');
  });

  it('organizer links: /admin, /admin/, the Telegram links and every ?word=on open the organizer screens', () => {
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const links = [
      '/admin',
      '/admin/',
      '/admin.html',
      `/admin?unpaid=${uuid}`, // Telegram 1's "Text the 2 who haven't paid"
      '/admin?lastscreenadmin=on',
      '/admin/?lastscreenadmin=on',
      '/admin?noontest=on',
      '/admin?playersredo=on&swapbutton=on',
      '/admin?venmorequest=on',
      '/admin?xmasmode=all&xmasdate=2026-12-05',
    ];
    for (const l of links) {
      const u = pages(l);
      expect(screen(u.pathname), l).toBe('AdminRoute');
      // The 308 keeps every ?word.
      expect(u.search, l).toBe(new URL(l, 'https://club.example').search);
    }
    // The links the server sends to the organizer are exactly these shapes.
    expect(src('server/alerts.ts')).toContain("url: `${siteUrl}/admin` }");
    expect(src('server/telegram-links.ts')).toContain('/admin\\\\?unpaid=[0-9a-f-]{36}$');
    // The first draw waits for the organizer file only on the organizer address, using the same test.
    expect(src('src/main.tsx')).toContain('if (isAdminPath(window.location.pathname)) {');
  });

  it('player links and the rest: the same screens as before the split, never the organizer screens', () => {
    const table: [string, string][] = [
      ['/', 'SiteHome'],
      ['/?as=Parker', 'SiteHome'],
      ['/?as=Parker&xmasmode=me', 'SiteHome'],
      ['/?s=0f8fad5b-d9cb-469f-a165-70867728950e', 'SiteHome'],
      ['/g/AbCdEf123_-x', 'PlayerHome'],
      ['/g/AbCdEf123_-x/', 'PlayerHome'],
      ['/g/AbCdEf123_-x?as=Parker', 'PlayerHome'],
      ['/go/abc.def-1', 'GoPage'],
      ['/go/abc.def-1/', 'GoPage'],
      ['/gt/preview', 'GameDayTextPage'],
      ['/setup', 'SetupPage'],
      ['/setup/', 'SetupPage'],
      ['/t/abc', 'SiteHome'],
      ['/admin/x', 'SiteHome'],
      ['/administrator', 'SiteHome'],
      ['/admins', 'SiteHome'],
      ['/g/admin', 'PlayerHome'],
    ];
    for (const [url, want] of table) expect(screen(new URL(url, 'https://club.example').pathname), url).toBe(want);
  });

  it('every private test link (?word=on) is read by the player download as the page starts, so it works on /admin before the organizer file', () => {
    // Every module that reads the address when it loads ("if (typeof window !== 'undefined')" at the top of the file plus the address).
    const files = [...readdirSync(join(ROOT, 'src'), { recursive: true })]
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => `src/${f.replace(/\\/g, '/')}`);
    const readsAtLoad = files.filter((f) => {
      const t = src(f);
      return /^if \(typeof window !== 'undefined'\)/m.test(t) && /location\.search/.test(t);
    });
    expect(readsAtLoad).toEqual(expect.arrayContaining(['src/lib.ts', 'src/homeScreenTip.tsx']));
    const main = sourcesOf.get(mainJs)!;
    for (const f of readsAtLoad) expect(main, `${f} is in the player download`).toContain(f);
    // The organizer files read the address only while drawing (?unpaid=), never when they load.
    for (const f of organizerFiles.filter((x) => x.endsWith('.js'))) {
      for (const s of sourcesOf.get(f) ?? []) {
        expect(readsAtLoad, `${s} (organizer file) reads the address when it loads`).not.toContain(s);
      }
    }
    // Every link word the shared switches name, and the ones src/lib.ts reads by name, is in the player script.
    const words = new Set<string>();
    for (const f of readdirSync(join(ROOT, 'shared')).filter((x) => x.endsWith('.ts'))) {
      for (const m of src(`shared/${f}`).matchAll(/\b(?:link|dateLink|modeLink):\s*'([a-z0-9]+)'/g)) words.add(m[1]);
    }
    for (const m of src('src/lib.ts').matchAll(/\.get\('([a-z0-9]+)'\)/g)) words.add(m[1]);
    for (const m of src('src/lib.ts').matchAll(/for \(const name of \[([^\]]+)\]\)/g)) for (const w of m[1].matchAll(/'([a-z0-9]+)'/g)) words.add(w[1]);
    expect(words.size).toBeGreaterThan(40);
    for (const w of ['lastscreenadmin', 'noontest', 'playersredo', 'venmorequest', 'gamedaytest', 'xmasmode', 'xmasdate']) expect(words.has(w), w).toBe(true);
    const js = built(mainJs);
    const missing = [...words].filter((w) => !js.includes(`"${w}"`) && !js.includes(`'${w}'`) && !js.includes(`\`${w}\``));
    expect(missing).toEqual([]);
  });

  it('View as and Pretend stay inside the organizer screens, drawn with the player screen from the player download', () => {
    const admin = sourcesOf.get(organizerFiles.find((f) => /^AdminEntry-.*\.js$/.test(f))!)!;
    expect(admin).toContain('src/pages/Admin.tsx');
    expect(admin).not.toContain('src/pages/PlayerHome.tsx');
    expect(sourcesOf.get(mainJs)).toContain('src/pages/PlayerHome.tsx');
    expect(src('src/pages/Admin.tsx')).toMatch(/<PlayerHome[\s\S]{0,200}viewAs=\{viewing\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (c) An old page after a deploy: src/adminChunk.ts run for real, with a fake organizer file, fake storage and a fake site.
// ---------------------------------------------------------------------------------------------------------------------------------
/** src/adminChunk.ts, the parts used here (imported by its path at run time: its organizer import is not for the node typecheck). */
type Chunk = {
  loadAdmin(): Promise<unknown>;
  loadedAdmin(): unknown;
  loadOrRecover(userAsked: boolean): Promise<'loaded' | 'reloading' | 'offline' | 'failed' | 'slow'>;
  SLOW_MS: number;
};
const CHUNK_PATH = join(ROOT, 'src/adminChunk.ts');
const NOW = Date.parse('2026-11-15T20:00:00.000Z');

describe('Zip 50 (c): an old cached page recovers by reloading once, never a loop', () => {
  let store: Map<string, string>;
  let reload: ReturnType<typeof vi.fn>;
  let site: ReturnType<typeof vi.fn>;
  let entryLoads = 0;

  function fakeSessionStorage(mode: 'ok' | 'throws' | 'forgets' = 'ok') {
    if (mode === 'throws') {
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
      return;
    }
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (mode === 'ok') store.set(k, String(v));
        },
        removeItem: (k: string) => void store.delete(k),
      },
    });
  }

  /** A fresh page (module state gone, sessionStorage kept): the organizer file fails ('gone'), arrives ('ok'), or never answers ('stuck'). */
  async function openPage(files: 'gone' | 'ok' | 'stuck' | ('gone' | 'ok' | 'stuck')[]): Promise<Chunk> {
    const seq = Array.isArray(files) ? files : [files];
    let n = 0;
    vi.resetModules();
    vi.doMock('../src/pages/AdminEntry', async () => {
      entryLoads++;
      const file = seq[Math.min(n++, seq.length - 1)];
      if (file === 'gone') throw new TypeError('Failed to fetch dynamically imported module: /assets/AdminEntry-OLD.js');
      if (file === 'stuck') await new Promise(() => undefined);
      return { AdminApp: () => null };
    });
    return (await import(/* @vite-ignore */ CHUNK_PATH)) as Chunk;
  }

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  function freshWorld({ siteUp = true, onLine = true, storage = 'ok' as 'ok' | 'throws' | 'forgets' } = {}) {
    vi.setSystemTime(NOW);
    store = new Map();
    entryLoads = 0;
    reload = vi.fn();
    site = vi.fn(async () => (siteUp ? new Response(null, { status: 200 }) : Promise.reject(new TypeError('Failed to fetch'))));
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('navigator', { onLine });
    vi.stubGlobal('fetch', site);
    vi.stubGlobal('document', { addEventListener: () => undefined, querySelectorAll: () => [] });
    fakeSessionStorage(storage);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../src/pages/AdminEntry');
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it('the organizer file arrives: Admin, no reload, no question to the site, one fetch for many callers', async () => {
    freshWorld();
    const c = await openPage('ok');
    const [a, b] = await Promise.all([c.loadAdmin(), c.loadAdmin()]);
    expect(a).toBe(b);
    expect(await c.loadOrRecover(false)).toBe('loaded');
    expect(c.loadedAdmin()).toBe(a);
    expect(entryLoads).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    expect(site).not.toHaveBeenCalled();
  });

  it('old page after a deploy (the file is gone, the site answers): exactly one reload, written down in sessionStorage first', async () => {
    freshWorld();
    const c = await openPage('gone');
    expect(await c.loadOrRecover(false)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(RELOAD_KEY)).toBe(String(NOW));
    // The question to the site: the page address, HEAD, never stored.
    expect(site).toHaveBeenCalledTimes(1);
    const [url, init] = site.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/');
    expect(init.method).toBe('HEAD');
    expect(init.cache).toBe('no-store');
  });

  it('the reloaded page still cannot get it (within a minute): Try again, no second reload, and it stays that way', async () => {
    freshWorld();
    // Page 1: reloads once.
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('reloading');
    // Pages after it, each a few seconds later (the reload, then the phone's own reloads or a back-online retry): never another reload.
    for (let i = 1; i <= 5; i++) {
      vi.setSystemTime(NOW + i * 5_000);
      expect(await (await openPage('gone')).loadOrRecover(false), `page ${i + 1}`).toBe('failed');
    }
    expect(reload).toHaveBeenCalledTimes(1);
    // The note still says the first reload's time (a failure does not move it, so the minute is not stretched forever).
    expect(store.get(RELOAD_KEY)).toBe(String(NOW));
    // A tap on Try again may reload (a person asked; it cannot loop by itself).
    expect(await (await openPage('gone')).loadOrRecover(true)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a later deploy, more than a minute after the last reload: one more reload by itself, then Try again again', async () => {
    freshWorld();
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('reloading');
    vi.setSystemTime(NOW + RELOAD_GUARD_MS + 1);
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('reloading');
    vi.setSystemTime(NOW + RELOAD_GUARD_MS + 2_000);
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('failed');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('the reload works: the new page gets the file and opens Admin; the note does not get in the way', async () => {
    freshWorld();
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('reloading');
    vi.setSystemTime(NOW + 2_000);
    expect(await (await openPage('ok')).loadOrRecover(false)).toBe('loaded');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('storage blocked (sessionStorage throws): never a reload by itself, Try again instead', async () => {
    freshWorld({ storage: 'throws' });
    for (let i = 0; i < 3; i++) expect(await (await openPage('gone')).loadOrRecover(false)).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
    // A tap on Try again still reloads (one tap, one reload).
    expect(await (await openPage('gone')).loadOrRecover(true)).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('storage that does not keep the note (writes silently dropped): never a reload by itself', async () => {
    freshWorld({ storage: 'forgets' });
    for (let i = 0; i < 3; i++) expect(await (await openPage('gone')).loadOrRecover(false)).toBe('failed');
    expect(reload).not.toHaveBeenCalled();
  });

  it('no signal (the phone says offline): Try again with the no-connection words, no reload, no question sent, nothing written', async () => {
    freshWorld({ onLine: false });
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('offline');
    expect(await (await openPage('gone')).loadOrRecover(true)).toBe('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(site).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('the site does not answer (the phone thinks it is online): Try again, no reload, nothing written', async () => {
    freshWorld({ siteUp: false });
    expect(await (await openPage('gone')).loadOrRecover(false)).toBe('offline');
    expect(await (await openPage('gone')).loadOrRecover(true)).toBe('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('a failed fetch is forgotten: no signal, then the signal is back: the next try asks again and opens Admin, no reload', async () => {
    freshWorld({ onLine: false });
    const c = await openPage(['gone', 'ok']);
    expect(await c.loadOrRecover(false)).toBe('offline');
    expect(c.loadedAdmin()).toBeNull();
    vi.stubGlobal('navigator', { onLine: true });
    expect(await c.loadOrRecover(false)).toBe('loaded');
    expect(entryLoads).toBe(2);
    expect(c.loadedAdmin()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a stalled download: after 15 seconds Try again ("slow") with no reload; a tap with the site answering reloads', async () => {
    freshWorld();
    // The page opens with real timers (loading a module uses them), then the clock is held for the 15 seconds.
    const c = await openPage('stuck');
    // Fresh fake timers on the real global (the Date-only ones of this block were put in before window was a fake).
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    expect(vi.isFakeTimers()).toBe(true);
    try {
      const first = c.loadOrRecover(false);
      expect(vi.getTimerCount()).toBe(1); // the 15-second timer really is the fake one
      await vi.advanceTimersByTimeAsync(c.SLOW_MS);
      expect(await first).toBe('slow');
      expect(reload).not.toHaveBeenCalled();
      expect(site).not.toHaveBeenCalled();
      const tap = c.loadOrRecover(true);
      await vi.advanceTimersByTimeAsync(c.SLOW_MS);
      expect(await tap).toBe('reloading');
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    }
  });

  it('the screen: Try again is the only thing that passes "a person asked"; back online and the first try never do', () => {
    const route = src('src/pages/AdminRoute.tsx');
    expect(route).toContain("useState<{ n: number; userAsked: boolean }>({ n: 0, userAsked: false })");
    expect(route).toContain('const again = () => setAttempt((a) => ({ n: a.n + 1, userAsked: false }));');
    expect(route).toContain('onRetry={() => setAttempt((a) => ({ n: a.n + 1, userAsked: true }))}');
    expect(route.match(/userAsked: true/g)?.length).toBe(1);
    // 'reloading' keeps the loading screen (no flash of Try again while the page is being replaced).
    expect(route).toContain("else if (r === 'offline' || r === 'failed' || r === 'slow') setStatus(r);");
  });
});
