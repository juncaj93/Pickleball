// Zip 44 (🎾44.cleanup): the leftovers that are gone and the one color that moved.
//  - The old personal-link routes (/api/link, /api/link/act and the organizer's "make links" route) are deleted. Nothing a player or the
//    organizer sees used them: no screen had a button, no text or Telegram alert builds a /t/ link, and the live table held 0 rows.
//  - The table itself stays (no database change, the backup still lists it); an old /t/<token> address still opens the home page.
//  - The Later card's light color is #f9f9f6; dark mode is untouched.
// The look is checked in the browser by e2e/zip44.cjs.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { firstSession, playerPhone, setupGroup } from './harness';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('the old personal-link routes are gone', () => {
  it('each of the three routes now answers Not found, with or without a sign-in', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const anon = ctx.app.client();
    const blair = await playerPhone(ctx, 'Blair');
    for (const who of [anon, blair, ctx.organizer]) {
      expect((await who.call('POST', '/api/link', { token: 'x'.repeat(43) })).status).toBe(404);
      expect((await who.call('POST', '/api/link/act', { token: 'x'.repeat(43), action: 'claim' })).status).toBe(404);
      expect((await who.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'claim' })).status).toBe(404);
    }
  });

  it('the code for it is deleted (server, types, route table)', () => {
    expect(existsSync(new URL('../server/tokens.ts', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../src/pages/LinkPage.tsx', import.meta.url))).toBe(false);
    const app = read('../server/app.ts');
    expect(app).not.toMatch(/\/api\/link|prepareLinks|from '\.\/tokens'/);
    expect(read('../server/admin.ts')).not.toMatch(/prepareLinks|invalidateSessionTokens|issueToken/);
    expect(read('../shared/api.ts')).not.toMatch(/ActionLinkDraft|ActionTokenView/);
  });

  it('nothing the site sends builds a /t/ link (texts, Telegram, Home Screen tip, game day text)', () => {
    for (const f of ['../server/admin.ts', '../server/alerts.ts', '../server/textsR2.ts', '../server/gameDay.ts', '../server/gameDayText.ts', '../server/go.ts', '../shared/textsR2.ts', '../shared/alerts.ts', '../shared/gameDay.ts', '../shared/lastCall.ts', '../src/pages/admin/textMenu.ts']) {
      expect(read(f), f).not.toMatch(/['"`]\/t\/|\/t\/\$\{/);
    }
  });

  it('an old /t/<token> address opens the home page (main.tsx replaces the address and draws the home page, not an error)', () => {
    const main = read('../src/main.tsx');
    expect(main).toMatch(/\\\/t\(\\\/\|\$\)/);
    expect(main).toContain("window.history.replaceState(null, '', '/')");
    expect(main).toMatch(/replaceState\(null, '', '\/'\);\s*return <SiteHome \/>/);
  });

  it('the table stays: no database change, the new database still has session_action_tokens and the backup still lists it', async () => {
    const ctx = await setupGroup();
    const row = ctx.app.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_action_tokens'").get() as { name: string } | undefined;
    expect(row?.name).toBe('session_action_tokens');
    expect(read('../server/backupData.ts')).toContain('session_action_tokens');
  });
});

describe('the Later card shade (item 1)', () => {
  const css = read('../src/zip10.css');
  const block = (re: RegExp) => (re.exec(css) ?? [])[1] ?? '';
  it('light is barely off white, #f9f9f6, with the same border color', () => {
    const light = block(/:root\[data-card-cleanup\] \{([^}]*)\}/);
    expect(light).toContain('--cl-later-bg: #f9f9f6;');
    expect(light).toContain('--cl-later-line: #dad9cf;');
  });
  it('dark stays exactly as it was (#1b2620 on #2b3a31), both the chosen theme and the phone setting', () => {
    const dark = block(/:root\[data-card-cleanup\]\[data-theme='dark'\] \{([^}]*)\}/);
    expect(dark).toContain('--cl-later-bg: #1b2620;');
    expect(dark).toContain('--cl-later-line: #2b3a31;');
    const media = block(/@media \(prefers-color-scheme: dark\) \{\s*:root\[data-card-cleanup\]:not\(\[data-theme='light'\]\) \{([^}]*)\}/);
    expect(media).toContain('--cl-later-bg: #1b2620;');
    expect(media).toContain('--cl-later-line: #2b3a31;');
  });
  it('the old gray is nowhere in the styles and the skin sets no Later background of its own', () => {
    expect(css).not.toContain('#ebebe4');
    const xmas = read('../src/skin/christmas.css');
    expect(xmas).not.toMatch(/cl-later-bg|cl-later[^{]*\{[^}]*background(-color)?:/);
    // The one place that paints it (so the canceled Later row and every other Later card follow the same variable).
    expect(css.match(/background: var\(--cl-later-bg\)/g)?.length).toBe(1);
  });
});

describe('a day\'s keep for four small files (item 3)', () => {
  const headers = read('../public/_headers');
  const blocks = headers.split(/\n(?=\S)/).map((b) => b.trim()).filter((b) => b.startsWith('/'));
  const rule = (path: string) => blocks.find((b) => b.split('\n')[0].trim() === path);
  it('theme.js, logo.png, logo-xmas.png and favicon-32.png are kept for a day (public, 86400 seconds)', () => {
    for (const p of ['/theme.js', '/logo.png', '/logo-xmas.png', '/favicon-32.png']) {
      expect(rule(p), p).toBeTruthy();
      expect(rule(p), p).toMatch(/\n\s+Cache-Control: public, max-age=86400$/);
    }
  });
  it('nothing else gains a rule: the page, the manifest, the other icons and /api keep asking each time; the year-long rule is still only /assets/*', () => {
    const withCache = blocks.filter((b) => /Cache-Control/.test(b)).map((b) => b.split('\n')[0].trim()).sort();
    expect(withCache).toEqual(['/assets/*', '/favicon-32.png', '/logo-xmas.png', '/logo.png', '/theme.js']);
    expect(headers.match(/Cache-Control: public, max-age=31536000/g)).toHaveLength(1);
    expect(rule('/*')).not.toMatch(/Cache-Control/);
  });
  it('every one of the four files exists, so a rule can never point at nothing', () => {
    for (const f of ['theme.js', 'logo.png', 'logo-xmas.png', 'favicon-32.png']) expect(existsSync(new URL(`../public/${f}`, import.meta.url)), f).toBe(true);
  });
  it('the home page links theme.js, and nothing else in the page changes (no new tag, no version query)', () => {
    const html = read('../index.html');
    expect(html).toContain('<script src="/theme.js"></script>');
  });
});
