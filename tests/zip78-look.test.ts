// Zip 78 (🎾78.one look): the site-wide look rules, checked in the source so nothing slips back.
//   1. One body font: the rounded display font is gone (no --display, no Bricolage, no font file).
//   2. Colors only from the site's tokens: a color value is written only in a token definition in src/styles.css (and the Christmas skin's own
//      tokens); every other rule names a token. Shades for shadows may be plain black or white with see-through.
//   3. No caret, chevron or "›" anywhere (screens and styles).
//   4. Names are never cut: no "…" cut-off except three lines that are not names (a link, a text preview, the small label over the name).
//   5. One button size set, one chip size, one card corner, one segmented look, the court switch colors defined once.
//   6. No text under 11 px.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, f);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, ext, out);
    else if (ext.test(f)) out.push(rel);
  }
  return out;
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = walk('src', /\.css$/);
const TSX = walk('src', /\.tsx?$/);

/** Every declaration in a stylesheet with the selector it sits under: [selector, property, value]. */
function decls(css: string): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const m of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const d of m[2].matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;]+);?/g)) out.push([m[1].trim(), d[1], d[2].trim()]);
  }
  return out;
}

describe('Zip 78: one body font', () => {
  it('no display font anywhere: no --display, no Bricolage import, no font preload', () => {
    for (const f of [...CSS, ...TSX, 'index.html']) {
      const s = read(f);
      expect(/var\(--display\)|--display\s*:|bricolage/i.test(s), f).toBe(false);
    }
  });
  it('buttons and fields take the page font (the browser default is Arial)', () => {
    expect(noComments(read('src/styles.css'))).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{\s*font-family:\s*inherit;/);
  });
});

describe('Zip 78: colors only from the tokens', () => {
  const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\((?!\s*var\()[^)]*\)|\bhsla?\(/g;
  const shade = (c: string) => /^rgba?\(\s*(0 0 0|255 255 255)\s*\/\s*[\d.]+%?\s*\)$/.test(c);
  it('a color value is written only where a token is defined (src/styles.css, the Christmas skin tokens, art in src/styles.css)', () => {
    const bad: string[] = [];
    for (const f of CSS) {
      for (const [sel, prop, val] of decls(read(f))) {
        if (/mask/.test(prop)) continue;
        const colors = [...val.matchAll(COLOR)].map((m) => m[0]).filter((c) => !shade(c));
        if (!colors.length) continue;
        const tokenDef = prop.startsWith('--');
        if (tokenDef && f === 'src/styles.css') continue;
        if (tokenDef && f === 'src/skin/christmas.css' && /^--(xmas|xo|bg)\b/.test(prop)) continue;
        bad.push(`${f}: ${sel.split('\n').pop()} { ${prop}: ${val} }`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('no color written in screen code (art uses named tokens: the medal, the tie wheel, the ornaments)', () => {
    const bad = TSX.filter((f) => /['"`]#[0-9a-fA-F]{3,8}['"`]|fill="#|stroke="#|stopColor="#|rgba?\(\d+,|#ecff7a|#d8f03b/i.test(read(f)));
    expect(bad).toEqual([]);
  });
  it('the court switch colors are defined once, in the token list', () => {
    const where = CSS.filter((f) => /--sw-booked-bg\s*:/.test(read(f)));
    expect(where).toEqual(['src/styles.css']);
  });
  it('ball yellow is var(--ball) everywhere (no typed copies)', () => {
    const bad = CSS.filter((f) => f !== 'src/styles.css' && /#d8f03b|216 240 59/i.test(read(f)));
    expect(bad).toEqual([]);
  });
});

describe('Zip 78: no carets', () => {
  it('no chevron, caret or › in any screen or style', () => {
    const bad: string[] = [];
    for (const f of TSX) {
      const s = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/[›‹]|className="[^"]*\bchev|<Chev/.test(s)) bad.push(f);
    }
    for (const f of CSS) if (/content:\s*['"][›‹>]|\.[\w-]*chev[\w-]*\s*[{,]/.test(noComments(read(f)))) bad.push(f);
    expect(bad).toEqual([]);
  });
});

describe('Zip 78: names are never cut', () => {
  it('no ellipsis cut-off except four lines that are not names (a link, a text preview, the label over the name, the Players tab’s gray line)', () => {
    const allowed = ['.set-link', '.sg-preview', '.topbar .eyebrow', '.pr-sub'];
    const bad: string[] = [];
    for (const f of CSS)
      for (const [sel, prop, val] of decls(read(f)))
        if (prop === 'text-overflow' && val === 'ellipsis' && !allowed.some((a) => sel.includes(a))) bad.push(`${f}: ${sel}`);
    expect(bad).toEqual([]);
  });
});

describe('Zip 78: one size set', () => {
  const root = noComments(read('src/styles.css'));
  it('buttons, chips and cards have their size tokens', () => {
    for (const t of ['--btn-h: 46px', '--btn-h-sm: 44px', '--btn-h-lg: 54px', '--btn-r: var(--r-md)', '--chip-font: 0.78rem', '--card-r: 20px']) expect(root).toContain(t);
  });
  it('Mark paid has one look: every Mark paid style is the small secondary button (gray fill, ink words, 44 px)', () => {
    const rules: [string, string][] = [
      ['src/mark-paid.css', '.mp-btn'],
      ['src/players-sheet.css', '.ps-btn'],
      ['src/money-rework.css', '.mrw-mark'],
    ];
    for (const [f, sel] of rules) {
      const body = new RegExp(`^${sel.replace('.', '\\.')}[^{]*\\{([^}]*)\\}`, 'm').exec(noComments(read(f)))?.[1] ?? '';
      expect(body, `${f} ${sel}`).toMatch(/height: var\(--btn-h-sm\)/);
      expect(body, `${f} ${sel}`).toMatch(/background: var\(--fill\)/);
      expect(body, `${f} ${sel}`).toMatch(/color: var\(--ink\)/);
      expect(body, `${f} ${sel}`).toMatch(/border-radius: var\(--btn-r\)/);
    }
  });
  it('History uses the one segmented control, not chips', () => {
    expect(read('src/pages/admin/HistoryTab.tsx')).not.toMatch(/chip-btn/);
  });
});

describe('Zip 78: no text under 11 px', () => {
  it('every font size that can shrink has an 11 px floor', () => {
    const bad: string[] = [];
    for (const f of CSS)
      for (const [sel, prop, val] of decls(read(f))) {
        if (prop !== 'font-size' || val.startsWith('max(11px')) continue;
        if (/cqw|vw|\d(\.\d+)?em\b|%/.test(val)) bad.push(`${f}: ${sel.split('\n').pop()} ${val} (shrinks with its box)`);
        const px = [...val.matchAll(/([\d.]+)(rem|px|em)\b/g)].map((m) => Number(m[1]) * (m[2] === 'rem' ? 16 : m[2] === 'em' ? 14 : 1));
        if (px.length && Math.min(...px) < 11) bad.push(`${f}: ${sel.split('\n').pop()} ${val}`);
      }
    expect(bad).toEqual([]);
  });
});
