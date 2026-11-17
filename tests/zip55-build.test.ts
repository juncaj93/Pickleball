// Zip 55, Tournaments piece 1: what the BUILT site holds.
//  1. A live build (PB_PREVIEW_BUILD unset or empty, as `npm run deploy` always builds) has no Tournament test page anywhere: not its words, not
//     its file, not its server call's address. A preview build (PB_PREVIEW_BUILD=1, as `npm run deploy:preview`) has it.
//  2. The player's first download (the main script and style) does not carry the tournament screens: they are their own file, fetched only when
//     the server sends a tournament for that phone (src/TournamentSlot.tsx). So with the switch off a player downloads nothing new.
//  3. The deploy script builds a preview with PB_PREVIEW_BUILD=1 and production with it empty, whatever the shell had.
// Two builds, about 10 seconds each.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main as deployMain } from '../scripts/deploy.mjs';

const ROOT = join(__dirname, '..');
let live = '';
let preview = '';

function build(outDir: string, env: Record<string, string>) {
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: 'zip55-test', ...env },
    stdio: 'pipe',
  });
}

/** Every built text file (scripts, styles, pages), as one map. */
function files(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(dir, { recursive: true }).map(String)) {
    if (/\.(js|css|html)$/.test(f)) out.set(f, readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}

beforeAll(() => {
  live = mkdtempSync(join(tmpdir(), 'pb-zip55-live-'));
  preview = mkdtempSync(join(tmpdir(), 'pb-zip55-preview-'));
  build(live, { PB_PREVIEW_BUILD: '' });
  build(preview, { PB_PREVIEW_BUILD: '1' });
}, 240_000);

afterAll(() => {
  for (const d of [live, preview]) if (d) rmSync(d, { recursive: true, force: true });
});

/** The page's own words and markup. */
const MARKERS = ['Tournament test', 'data-tm-test', 'No tournament', 'Nothing open, to try Create tournament'];

describe('Zip 55: the Tournament test page exists only in a preview build', () => {
  it('a live build has none of it, in any file', () => {
    for (const [f, text] of files(live)) for (const m of MARKERS) expect(text.includes(m), `${m} in ${f}`).toBe(false);
  });

  it("the server call's address is only in the View as copy's file (which runs the server's own code), and there it answers Not found off a preview", () => {
    const withRoute = [...files(live).entries()].filter(([, t]) => t.includes('/api/admin/tournament-test')).map(([f]) => f);
    expect(withRoute.every((f) => /assets\/load-[^/]+\.js$/.test(f)), withRoute.join(', ')).toBe(true);
  });

  it('a preview build has it (so the check above can see it)', () => {
    const all = [...files(preview).values()].join('\n');
    for (const m of MARKERS) expect(all.includes(m), m).toBe(true);
  });

  it("the player's first download does not carry the tournament screens (their own file, fetched only when a tournament is sent)", () => {
    const page = readFileSync(join(live, 'index.html'), 'utf8');
    const main = /src="\/assets\/(index-[^"]+\.js)"/.exec(page)![1];
    const style = /href="\/assets\/(index-[^"]+\.css)"/.exec(page)![1];
    const js = readFileSync(join(live, 'assets', main), 'utf8');
    const css = readFileSync(join(live, 'assets', style), 'utf8');
    for (const words of ['See who’s signed up', 'We’re picking the date', 'Step 1 of 2', 'Back out of tournament', 'Only you can see this']) expect(js.includes(words), words).toBe(false);
    expect(css.includes('.tc-track')).toBe(false);
    // The tournament file exists and holds them.
    const all = [...files(live).entries()].filter(([f]) => f !== `assets/${main}`).map(([, t]) => t).join('\n');
    expect(all.includes('Only you can see this')).toBe(true);
    // The admin.html page (organizer files) never preloads the player tournament file either way: only the organizer's own.
    expect(readFileSync(join(live, 'admin.html'), 'utf8').includes('TournamentHome')).toBe(false);
  });
});

describe('Zip 55: the deploy script sets the preview flag', () => {
  const git = () => ({ branch: 'claude/zip-55', dirty: false });
  it('a preview builds with PB_PREVIEW_BUILD=1, production with it empty', () => {
    const seen: Record<string, string | undefined>[] = [];
    const run = (cmd: string, _a: string[], env?: Record<string, string>) => {
      if (cmd === 'npm') seen.push(env ?? {});
      return 0;
    };
    expect(deployMain(['preview'], { git, run, out: () => {}, err: () => {} })).toBe(0);
    expect(seen[0].PB_PREVIEW_BUILD).toBe('1');
    const HEAD = 'a'.repeat(40);
    const good = { head: HEAD, remoteMain: HEAD, live: { relation: 'same' as const, sha: HEAD } };
    // Sat Nov 14, 10:00 AM Eastern: a quiet hour.
    const prod = deployMain(['production'], { git: () => ({ branch: 'main', dirty: false }), network: () => good, now: () => Date.parse('2026-11-14T15:00:00Z'), run, out: () => {}, err: () => {} });
    expect(prod).toBe(0);
    expect(seen[1].PB_PREVIEW_BUILD).toBe('');
  });
});
