import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The screens' words, all in one string, so trimmed text stays trimmed and
// the text that matters stays put.
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? files(join(dir, f.name)) : f.name.endsWith('.tsx') ? [join(dir, f.name)] : []));
const source = files(join(__dirname, '..', 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('fewer words on screen', () => {
  it('the explanatory sentences are gone', () => {
    for (const gone of [
      'Counts sessions that were played',
      'Regulars get a "Want in?" nudge',
      'Only with their OK',
      'Your own record. Players never see it',
      'Change it if this booking',
      'The cancellation deadline resets',
      'Still works for anyone who has it',
      'spreadsheet file (CSV)',
      'Players see it, like',
      'This phone remembers it',
      'Press send in Messages when it looks right',
      'may not have marked this paid yet',
      'You can view it but not change',
    ]) {
      expect(source, gone).not.toContain(gone);
    }
  });

  it('keeps destructive confirmations, errors, and money lines', () => {
    for (const kept of [
      'Players will see it as canceled, and reminders and payments stop for it.',
      'Cancel the reservation with the venue yourself.',
      'If they never signed up or paid, the name is deleted.',
      'The old link stops working right away.',
      'Mark it off',
      "Couldn't save. Tap to retry.",
      'back as credit.',
      'Cancel by',
      'Missing numbers:',
      'Demo: taps work, nothing is saved.',
    ]) {
      expect(source, kept).toContain(kept);
    }
  });

  it('setting hints are six words or fewer', () => {
    const hints = [...source.matchAll(/hint: ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const h of hints) expect(h.split(/\s+/).length, h).toBeLessThanOrEqual(6);
  });
});
