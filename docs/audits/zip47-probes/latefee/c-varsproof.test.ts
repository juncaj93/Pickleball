// Zip 47 audit (switch safety): does tests/variables-proof.test.ts still see every switch that reads an env variable?
// It only checks names that are in its fixture (tests/fixtures/cloudflare-vars-before-zip45.json) or in wrangler.toml.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guestSpotAllowed } from '../../../shared/guestSpot';
import { venueAlertAllowed } from '../../../shared/venueAlert';
import { tomlSection } from '../../tomlVars';

const ROOT = process.cwd();
function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, e);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx|js|mjs)$/.test(e) && !e.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

describe('C. variables proof coverage', () => {
  it('C1 names the code reads that the proof never checks (not in its fixture, not in wrangler.toml)', () => {
    const before = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/cloudflare-vars-before-zip45.json'), 'utf8'));
    const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
    const known = new Set<string>([
      ...Object.keys(before.production.plain),
      ...Object.keys(before.preview.plain),
      ...before.production.secretNames,
      ...before.preview.secretNames,
      ...Object.keys(tomlSection('[vars]', toml)),
      ...Object.keys(tomlSection('[env.preview.vars]', toml)),
    ]);
    const read = new Set<string>();
    for (const f of ['server', 'shared', 'functions', 'src'].flatMap(files)) {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) continue;
        for (const m of line.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)\b/g)) read.add(m[1]);
      }
    }
    // Bindings and test hooks are not variables: DB, ERROR_BOX, SANDBOX, TELEGRAM_FETCH.
    const bindings = new Set(['DB', 'ERROR_BOX', 'SANDBOX', 'TELEGRAM_FETCH']);
    const unchecked = [...read].filter((n) => !known.has(n) && !bindings.has(n)).sort();
    expect(unchecked).toEqual(['GUEST_SPOT', 'GUEST_SPOT_PREVIEW', 'VENUE_ALERT']);
  });

  it('C2 those switches still behave "allowed unless off" (what the proof would have checked)', () => {
    for (const f of [guestSpotAllowed, venueAlertAllowed]) {
      expect(f(undefined)).toBe(true);
      expect(f('on')).toBe(true);
      expect(f(' OFF ')).toBe(false);
    }
  });
});
