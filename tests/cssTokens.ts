// Zip 78: the site's color tokens as real colors, for tests that check contrast. Every color lives in the token list at the top of
// src/styles.css (light first, then the site's own Dark); other stylesheets only name tokens. `resolve` follows var() chains (and a
// file's own names, passed in `extra`) down to a #rrggbb color, and mixes color-mix(in srgb, A p%, B) the way the browser does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Theme = 'light' | 'dark';
const css = readFileSync(join(__dirname, '..', 'src/styles.css'), 'utf8');
const head = css.slice(0, css.indexOf('/* ---------- Base ---------- */'));

function block(start: string): Record<string, string> {
  const i = head.indexOf(start);
  if (i < 0) throw new Error(`no ${start} in src/styles.css`);
  let depth = 0;
  let j = head.indexOf('{', i);
  const from = j + 1;
  for (; j < head.length; j++) {
    if (head[j] === '{') depth++;
    else if (head[j] === '}' && --depth === 0) break;
  }
  return Object.fromEntries([...head.slice(from, j).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LIGHT = block(':root {');
const DARK = { ...LIGHT, ...block(":root[data-theme='dark'] {") };

/** The declarations of every block in `cssText` whose selector matches `sel` (a regex), as name -> value (later wins). */
export function declsOf(cssText: string, sel: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of cssText.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g))
    if (sel.test(m[1].trim())) for (const d of m[2].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A token or value as #rrggbb in that theme. `extra`: a stylesheet's own custom properties (they win over the site's). */
export function resolve(value: string, theme: Theme, extra: Record<string, string> = {}, depth = 0): string {
  if (depth > 20) throw new Error(`token loop at ${value}`);
  const v = value.trim();
  const table = { ...(theme === 'light' ? LIGHT : DARK), ...extra };
  const name = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v);
  if (name) {
    const got = table[name[1]] ?? name[2];
    if (got === undefined) throw new Error(`unknown token ${name[1]}`);
    return resolve(got, theme, extra, depth + 1);
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const p = Number(mix[2]) / 100;
    const a = rgbOf(resolve(mix[1], theme, extra, depth + 1));
    const b = mix[3] === 'transparent' ? a : rgbOf(resolve(mix[3], theme, extra, depth + 1));
    return hex(...(a.map((x, i) => x * p + b[i] * (1 - p)) as [number, number, number]));
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('').toLowerCase();
  throw new Error(`not a color: ${v}`);
}

/** WCAG contrast of two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = rgbOf(h).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
