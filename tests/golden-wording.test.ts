import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextTasks } from '../shared/tasks';
import { MARKS, OPTS, SCENARIO, ticks } from './tick-scenarios';

// Nov 1, 2026 (Alex): the booking alerts say "Then set it to Booked" instead of "Then tap I booked it"
// (there is no I booked it button any more). This proves that wording is the ONLY change to every card
// and alert the brain makes from Oct 14 to Nov 27: putting the old words back gives the fingerprint
// stored in tests/fixtures/tick-golden.json before the change.
// Zip 8 (Nov 6): the finalize reminder moved to 10:30 PM game night, so the finalize cards appear later and their alert time
// changed; every other card was checked identical to the old code at every tick of the sweep, and the alert lines in
// tick-golden.json changed only for finalize. Fingerprints recomputed then (the Zip 7 ones were cdec146b... and d4cad9c0...).
// Zip 11 (Nov 7): the unused "I booked it" button and the game-day check (6:15 / 7:15 AM, already off under TEXTS_R2) were deleted. A
// one-off check ran the old brain (main, fb44afc) and the new one at all 12,684 ticks of both sweeps: the new cards and alerts were the old
// ones minus exactly those two things. tick-golden.json lost only its 9 ":gameday" lines. Fingerprints recomputed then (the Zip 8 ones
// were 5ce16421... and c3237a05...).
const OLD_CARDS = { noMarks: '9a8288652c1e57b35f60be6e6c45b04e03f9e390f73048ec3392977864d3520e', withMarks: '840b89744515811fae5434564fed85eb05f703cf39967c3f0092ad9f1277f8af' };

describe('booking alert wording', () => {
  for (const [name, marks] of [['noMarks', new Set<string>()], ['withMarks', MARKS]] as const) {
    it(`only "Then tap I booked it" became "Then set it to Booked" (${name})`, { timeout: 30_000 }, () => {
      const back = createHash('sha256');
      let seen = 0;
      for (const now of ticks()) {
        const json = JSON.stringify(nextTasks(now, SCENARIO, marks, OPTS));
        seen += json.split('Then set it to Booked').length - 1;
        expect(json).not.toContain('Then tap I booked it');
        back.update(json.replaceAll('Then set it to Booked', 'Then tap I booked it'));
      }
      expect(seen).toBeGreaterThan(0);
      expect(back.digest('hex')).toBe(OLD_CARDS[name]);
    });
  }

  it('the golden file holds the new words', () => {
    const golden = readFileSync(new URL('./fixtures/tick-golden.json', import.meta.url), 'utf8');
    expect(golden).toContain('Then set it to Booked');
    expect(golden).not.toContain('tap I booked it');
  });
});
