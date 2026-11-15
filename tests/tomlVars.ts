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
  // Zip 45 review: every line must be readable. A single-quoted or indented line is valid TOML that Cloudflare would apply, so reading it
  // as "missing" would call a pulled kill switch allowed. Anything that is not a comment, a blank or NAME = "value" stops here.
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*) = "([^"]*)"\s*(#.*)?$/.exec(line);
    if (!m) throw new Error(`wrangler.toml ${section}: cannot read this line, write it as NAME = "value" with no indent: ${line}`);
    out[m[1]] = m[2];
  }
  return out;
}

/** The kill switch rule every "allowed unless off" switch uses: missing or anything but "off" = allowed. */
export const killSwitchAllows = (value: string | undefined) => (value ?? 'on').trim().toLowerCase() !== 'off';

/** Allowed on live AND on previews (no "off" line in either section). */
export const allowedOnBoth = (name: string) => killSwitchAllows(tomlSection('[vars]')[name]) && killSwitchAllows(tomlSection('[env.preview.vars]')[name]);
