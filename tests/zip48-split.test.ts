// Zip 48 (speed split): the guard. Builds the site twice, the real way (organizer screens in their own file) and the old way (PB_ONE_FILE=1,
// everything in one file, vite.config.ts), and checks:
// 1. Size budget: a player's first visit (the page, its script and its style file) stays within the Zip 48 size plus a small margin, so the
//    player download cannot silently get fat again. If a change really needs more, raise the budget here on purpose and say why.
// 2. Players get no organizer file: the page names no organizer file, and the player script holds no organizer screen.
// 3. /admin starts the organizer files at once (dist/admin.html), with the organizer style file AFTER the main one.
// 4. Same look on /admin: the style rules /admin ends up with (main file, then organizer file) are, rule for rule and in order, the ones the
//    old one-file build had. Fails, for example, when a new style file is added at the end of src/main.tsx but not to src/admin-late.css.
// 5. The player copy of the credit list styles (src/credit-history.css) is still an exact copy of its block in src/credit-admin.css.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Zip 48 sizes, gzipped (Sun Nov 15, 2026): script 136.6 KB, style 35.0 KB, page 0.9 KB. Budget = that plus about 3%. */
export const BUDGET = { scriptKB: 141, styleKB: 36.5, pageKB: 1.5, totalKB: 177 };

const ROOT = join(__dirname, '..');
let split = '';
let one = '';

function build(outDir: string, extraEnv: Record<string, string> = {}) {
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: 'zip48-test', ...extraEnv },
    stdio: 'pipe',
  });
}

const asset = (dir: string, re: RegExp) => {
  const hits = readdirSync(join(dir, 'assets')).filter((f) => re.test(f));
  if (hits.length !== 1) throw new Error(`expected one ${re} in ${dir}/assets, found ${hits.join(', ') || 'none'}`);
  return hits[0];
};
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8');
const gzKB = (text: string) => gzipSync(Buffer.from(text), { level: 9 }).length / 1024;

/** Top-level CSS rules of a minified file, in order (an @media block counts as one). */
export function cssRules(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out.filter(Boolean);
}

/**
 * What actually decides the look: when the same rule appears twice, the later copy always wins over the earlier one (same selector, same
 * strength, later), so the earlier copy can be dropped without changing anything on screen.
 */
export function effective(rules: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = rules.length - 1; i >= 0; i--) {
    if (seen.has(rules[i])) continue;
    seen.add(rules[i]);
    out.push(rules[i]);
  }
  return out.reverse();
}

beforeAll(() => {
  split = mkdtempSync(join(tmpdir(), 'pb-zip48-split-'));
  one = mkdtempSync(join(tmpdir(), 'pb-zip48-one-'));
  build(split);
  build(one, { PB_ONE_FILE: '1' });
}, 240_000);

afterAll(() => {
  for (const d of [split, one]) if (d) rmSync(d, { recursive: true, force: true });
});

describe('Zip 48: the player download', () => {
  it('stays within the size budget', () => {
    const page = read(split, 'index.html');
    const script = read(split, `assets/${asset(split, /^index-.*\.js$/)}`);
    const style = read(split, `assets/${asset(split, /^index-.*\.css$/)}`);
    const sizes = { pageKB: gzKB(page), scriptKB: gzKB(script), styleKB: gzKB(style) };
    const total = sizes.pageKB + sizes.scriptKB + sizes.styleKB;
    expect(sizes.scriptKB, `player script ${sizes.scriptKB.toFixed(1)} KB gzipped`).toBeLessThanOrEqual(BUDGET.scriptKB);
    expect(sizes.styleKB, `player style ${sizes.styleKB.toFixed(1)} KB gzipped`).toBeLessThanOrEqual(BUDGET.styleKB);
    expect(sizes.pageKB).toBeLessThanOrEqual(BUDGET.pageKB);
    expect(total, `player first visit ${total.toFixed(1)} KB gzipped`).toBeLessThanOrEqual(BUDGET.totalKB);
    // Before Zip 48 (main 1b06c34..b8ba448, the same measure): script 227.0 KB + style 46.6 KB. The split must keep at least 80 KB of that off.
    expect(227.0 + 46.6 - (sizes.scriptKB + sizes.styleKB)).toBeGreaterThan(80);
  });

  it('names no organizer file and holds no organizer screen', () => {
    const page = read(split, 'index.html');
    expect(page).not.toMatch(/AdminEntry|zip11-/);
    const script = read(split, `assets/${asset(split, /^index-.*\.js$/)}`);
    const admin = read(split, `assets/${asset(split, /^AdminEntry-.*\.js$/)}`);
    // Words only the organizer screens draw: in the organizer file, not in the player file.
    for (const w of ['Feature switches', 'Cancel session', 'Mark refunded', 'Add game', 'Edit game', 'Venue charge']) {
      expect(admin.includes(w), `"${w}" in the organizer file`).toBe(true);
      expect(script.includes(w), `"${w}" in the player file`).toBe(false);
    }
    // The player file only reaches the organizer file through the one on-demand import.
    expect(script.match(/AdminEntry-[\w-]+\.js/g)?.length ?? 0).toBeGreaterThan(0);
    expect(script).not.toMatch(/^import[^;]*AdminEntry/m);
  });
});

describe('Zip 48: /admin', () => {
  it('admin.html is the same page plus the organizer files, style after the main style', () => {
    const page = read(split, 'index.html');
    const admin = read(split, 'admin.html');
    const js = asset(split, /^AdminEntry-.*\.js$/);
    const css = asset(split, /^AdminEntry-.*\.css$/);
    const added = admin.split('\n').filter((l) => !page.split('\n').includes(l));
    expect(added.map((l) => l.trim())).toEqual([
      '<!-- Zip 48: /admin only. The organizer files, started at once (vite.config.ts, adminPage). -->',
      `<link rel="modulepreload" crossorigin href="/assets/${js}">`,
      `<link rel="modulepreload" crossorigin href="/assets/${asset(split, /^zip11-.*\.js$/)}">`,
      `<link rel="stylesheet" crossorigin href="/assets/${css}">`,
    ]);
    // Nothing of the page was lost.
    expect(admin.split('\n').filter((l) => !added.includes(l))).toEqual(page.split('\n'));
    const mainCss = asset(split, /^index-.*\.css$/);
    expect(admin.indexOf(`/assets/${mainCss}`)).toBeGreaterThan(0);
    expect(admin.indexOf(`/assets/${css}`)).toBeGreaterThan(admin.indexOf(`/assets/${mainCss}`));
  });

  it('gets exactly the old style order, rule for rule', () => {
    const mainRules = cssRules(read(split, `assets/${asset(split, /^index-.*\.css$/)}`));
    const adminRules = cssRules(read(split, `assets/${asset(split, /^AdminEntry-.*\.css$/)}`));
    const oldRules = cssRules(read(one, `assets/${asset(one, /^index-.*\.css$/)}`));
    expect(oldRules.length).toBeGreaterThan(2000);
    const now = effective([...mainRules, ...adminRules]);
    const before = effective(oldRules);
    // First difference, in words, if any.
    const at = now.findIndex((r, i) => r !== before[i]);
    expect(at === -1 ? null : { at, now: now[at]?.slice(0, 120), before: before[at]?.slice(0, 120) }).toBeNull();
    expect(now.length).toBe(before.length);
    // The Christmas skin still comes last on /admin (its rules sit under html[data-skin='christmas']).
    expect(now[now.length - 1]).toMatch(/skin/);
  });

  it('the one-file build really is the old layout (no organizer file of its own styles)', () => {
    expect(readdirSync(join(one, 'assets')).filter((f) => /^AdminEntry-.*\.css$/.test(f))).toEqual([]);
  });
});

describe('Zip 48: the player copy of the credit list styles', () => {
  it('is an exact copy of its block in credit-admin.css', () => {
    const copy = readFileSync(join(ROOT, 'src/credit-history.css'), 'utf8');
    const block = copy.slice(copy.indexOf('.credit-history {'));
    expect(block.length).toBeGreaterThan(100);
    expect(readFileSync(join(ROOT, 'src/credit-admin.css'), 'utf8')).toContain(block.trimEnd());
  });
});
