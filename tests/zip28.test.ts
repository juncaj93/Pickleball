// Zip 28 (small cleanup from both audits): the Mac build check (B01), the deploy guard (A-06), and the Add game / Edit game
// CourtReserve links (item 1). Look-only and tooling only: no money, no database.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide } from '../scripts/deploy.mjs';
import { findNameProblems, trackedFiles } from '../scripts/check-file-names.mjs';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';

const ROOT = resolve(__dirname, '..');

describe('B01: no two files differ only by capital letters (the Mac build)', () => {
  it('the repository has none, and every relative import is spelled like its file', () => {
    const problems = findNameProblems(trackedFiles(ROOT), (f) => readFileSync(join(ROOT, f), 'utf8'));
    expect(problems).toEqual([]);
  });

  it('the two pairs that broke the Mac build are gone (DoNow / doNow, MoneyRework / moneyRework)', () => {
    const files = trackedFiles(ROOT);
    for (const f of files.filter((x) => x.startsWith('src/pages/admin/'))) {
      const same = files.filter((x) => x.startsWith('src/pages/admin/') && x.replace(/\.[^.]+$/, '').toLowerCase() === f.replace(/\.[^.]+$/, '').toLowerCase());
      expect(new Set(same.map((x) => x.replace(/\.[^.]+$/, ''))).size, same.join(' and ')).toBe(1);
    }
  });

  it('fails on two files that differ only by case', () => {
    const p = findNameProblems(['src/a/Foo.ts', 'src/a/foo.ts'], () => '');
    expect(p.some((x) => x.includes('differ only by capital letters'))).toBe(true);
  });

  it('fails on a .ts next to a .tsx whose names match apart from capitals (the DoNow / doNow trap)', () => {
    const p = findNameProblems(['src/x/DoNow.tsx', 'src/x/doNow.ts'], () => '');
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(' ')).toContain('DoNow.tsx and src/x/doNow.ts');
  });

  it('allows a normal same-name pair (thing.ts next to thing.d.ts is fine; so is Thing.tsx alone)', () => {
    expect(findNameProblems(['src/x/thing.ts', 'src/x/thing.d.ts', 'src/x/Other.tsx'], () => '')).toEqual([]);
  });

  it('fails on an import spelled with the wrong case', () => {
    const files = ['src/b/Money.ts', 'src/b/use.ts'];
    const p = findNameProblems(files, (f) => (f === 'src/b/use.ts' ? "import { x } from './money';" : ''));
    expect(p.join(' ')).toContain("imports './money' but the file is spelled src/b/Money.ts");
  });

  it('accepts exact-case imports of files, folders and dynamic imports', () => {
    const files = ['src/b/Money.ts', 'src/b/lib/index.ts', 'src/b/use.ts'];
    const text = "import a from './Money'; const c = await import('./lib'); export * from './Money';";
    expect(findNameProblems(files, (f) => (f === 'src/b/use.ts' ? text : ''))).toEqual([]);
  });
});

describe('A-06: the deploy guard', () => {
  it('production: only from main with a clean folder', () => {
    expect(decide('production', { branch: 'main', dirty: false })).toEqual({ ok: true, branch: 'main' });
    expect(decide('production', { branch: 'main', dirty: true }).ok).toBe(false);
    expect(decide('production', { branch: 'main', dirty: true }).message).toMatch(/not saved in git/);
    const other = decide('production', { branch: 'claude/new-session-x', dirty: false });
    expect(other.ok).toBe(false);
    expect(other.message).toMatch(/not main/);
    const detached = decide('production', { branch: null, dirty: false });
    expect(detached.ok).toBe(false);
    expect(detached.message).toMatch(/detached/);
  });

  it('preview: a detached checkout is refused (it would be a preview called "HEAD"), main is refused, a named branch passes with its own name', () => {
    const detached = decide('preview', { branch: null, dirty: false });
    expect(detached.ok).toBe(false);
    expect(detached.message).toMatch(/HEAD/);
    expect(decide('preview', { branch: 'main', dirty: false }).ok).toBe(false);
    expect(decide('preview', { branch: 'zip-28', dirty: false })).toEqual({ ok: true, branch: 'zip-28', warn: undefined });
    expect(decide('preview', { branch: 'zip-28', dirty: true }).warn).toMatch(/unsaved/);
  });

  it('an unknown kind is refused', () => {
    expect(decide('prod' as never, { branch: 'main', dirty: false }).ok).toBe(false);
  });

  it('end to end in a throwaway git folder (dry run): main clean ok, main dirty refused, feature branch refused for live, detached refused for a preview', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-guard-'));
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), 'one');
    git('add', '.');
    git('commit', '-q', '-m', 'one');
    const run = (kind: string) => spawnSync('node', [join(ROOT, 'scripts/deploy.mjs'), kind, '--dry-run'], { cwd: dir, encoding: 'utf8' });

    const live = run('production');
    expect(live.status).toBe(0);
    expect(live.stdout).toContain('--branch main');

    // `npm run deploy --dry-run` (no `--`) reaches the script only as this environment value: it must still be a dry run.
    const npmDry = spawnSync('node', [join(ROOT, 'scripts/deploy.mjs'), 'production'], { cwd: dir, encoding: 'utf8', env: { ...process.env, npm_config_dry_run: 'true' } });
    expect(npmDry.status).toBe(0);
    expect(npmDry.stdout).toContain('--branch main');

    writeFileSync(join(dir, 'a.txt'), 'two');
    const dirty = run('production');
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toMatch(/not saved in git/);
    git('checkout', '-q', '--', 'a.txt');

    git('checkout', '-q', '-b', 'feature-x');
    const featureLive = run('production');
    expect(featureLive.status).toBe(1);
    const featurePreview = run('preview');
    expect(featurePreview.status).toBe(0);
    expect(featurePreview.stdout).toContain('--branch feature-x');
    expect(featurePreview.stdout).not.toContain('--branch main');

    git('checkout', '-q', '--detach');
    const detachedPreview = run('preview');
    expect(detachedPreview.status).toBe(1);
    expect(detachedPreview.stderr).toMatch(/detached/);
    const detachedLive = run('production');
    expect(detachedLive.status).toBe(1);
  });

  it('package.json: deploy goes through the guard and the build runs the name check', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(pkg.deploy).toBe('node scripts/deploy.mjs production');
    expect(pkg['deploy:preview']).toBe('node scripts/deploy.mjs preview');
    expect(pkg.build.startsWith('node scripts/check-file-names.mjs')).toBe(true);
    expect(pkg.deploy).not.toMatch(/wrangler/);
  });
});

describe('item 1: Add game says "Book court" (new reservation), Edit game keeps "Change court" (bookings list)', () => {
  const admin = readFileSync(join(ROOT, 'src/pages/Admin.tsx'), 'utf8');
  const edit = readFileSync(join(ROOT, 'src/pages/admin/EditGame.tsx'), 'utf8');

  it('the two links are different addresses, and Home\'s Book button uses the booking one', () => {
    expect(COURTRESERVE_BOOKING_URL).not.toBe(COURTRESERVE_CANCEL_URL);
    expect(admin).toMatch(/<CourtReserveLink href=\{COURTRESERVE_BOOKING_URL\} pill>/);
  });

  it('Add game (the pinned bottom row) links COURTRESERVE_BOOKING_URL with the label Book court', () => {
    const row = admin.slice(admin.indexOf('data-bh-actions'), admin.indexOf('data-bh-actions') + 400);
    expect(row).toContain('<CourtReserveLink href={COURTRESERVE_BOOKING_URL}>Book court</CourtReserveLink>');
    expect(row).not.toContain('Change court');
  });

  it('Edit game still says Change court and links the bookings list', () => {
    expect(edit).toContain('<CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Change court</CourtReserveLink>');
    expect(edit).not.toContain('Book court');
  });
});
