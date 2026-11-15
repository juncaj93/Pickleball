// Zip 45: wrangler.toml's plain variables, read the way the deploy reads them, for the tests that check a switch's kill switch.
// Since Zip 45 an "allowed unless off" switch has NO line (a missing value reads exactly like "on"), so tests ask "is it allowed?",
// not "is there an on line?". tests/variables-proof.test.ts holds the full proof.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TomlSection = '[vars]' | '[env.preview.vars]';

/** One section's plain variables ('[vars]' = production, '[env.preview.vars]' = previews). Only a line that is exactly the header counts. */
export function tomlSection(section: TomlSection, toml = readFileSync(join(process.cwd(), 'wrangler.toml'), 'utf8')): Record<string, string> {
  const start = toml.indexOf(`\n${section}\n`);
  if (start < 0) throw new Error(`no ${section} in wrangler.toml`);
  const rest = toml.slice(start + section.length + 2);
  const end = rest.search(/\n\[/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

/** The kill switch rule every "allowed unless off" switch uses: missing or anything but "off" = allowed. */
export const killSwitchAllows = (value: string | undefined) => (value ?? 'on').trim().toLowerCase() !== 'off';

/** Allowed on live AND on previews (no "off" line in either section). */
export const allowedOnBoth = (name: string) => killSwitchAllows(tomlSection('[vars]')[name]) && killSwitchAllows(tomlSection('[env.preview.vars]')[name]);
