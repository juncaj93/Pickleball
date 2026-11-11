// Zip 29, item 1: the site is "Pickleball". "Pickleball Bros" / "Pickle Bros" must not come back anywhere a person can see it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_NAME, siteNameFor } from '../shared/settings';

const ROOT = join(__dirname, '..');
// Folders and files that may keep the old words on purpose:
//  - docs/STAGE_NOTES.md, docs/AUDIT*.md, docs/audits: history of what was true when it was written
//  - migrations: an applied migration is never edited (the old name is only in its first comment line)
//  - this test file itself
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.wrangler', 'audits', 'migrations', 'screenshots', 'state-gallery']);
const SKIP_FILES = new Set(['STAGE_NOTES.md', 'package-lock.json', 'zip29-rename.test.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : files(p);
    if (SKIP_FILES.has(name) || /^AUDIT.*\.md$/.test(name)) return [];
    return /\.(ts|tsx|cjs|mjs|js|html|css|json|webmanifest|md|toml|txt)$/.test(name) ? [p] : [];
  });
}

describe('Zip 29 rename to Pickleball', () => {
  it('no file says "Pickleball Bros", "Pickle Bros" or "Bros" as the site name', () => {
    const bad: string[] = [];
    for (const p of files(ROOT)) {
      const text = readFileSync(p, 'utf8');
      if (/pickle(ball)? bros/i.test(text)) bad.push(p.replace(ROOT, ''));
    }
    // docs/SITE_RULES.md says "was Pickleball Bros until Zip 29" on purpose (one history note).
    expect(bad.filter((p) => !p.endsWith('docs/SITE_RULES.md'))).toEqual([]);
  });

  it('the fallback name is Pickleball and the tab/Home Screen names match', () => {
    expect(SITE_NAME).toBe('Pickleball');
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
    expect(html).toContain('<title>Pickleball</title>');
    expect(html).toContain('content="Pickleball" />');
    expect(manifest.name).toBe('Pickleball');
    expect(manifest.short_name).toBe('Pickleball');
  });

  it('the tab name is the Settings group name, and Pickleball when it is blank', () => {
    expect(siteNameFor('Tuesday Crew')).toBe('Tuesday Crew');
    expect(siteNameFor('  Tuesday Crew  ')).toBe('Tuesday Crew');
    expect(siteNameFor('   ')).toBe('Pickleball');
    expect(siteNameFor('')).toBe('Pickleball');
    expect(siteNameFor(undefined)).toBe('Pickleball');
    expect(siteNameFor(null)).toBe('Pickleball');
  });
});
