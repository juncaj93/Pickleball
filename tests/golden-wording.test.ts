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
const OLD_CARDS = { noMarks: '5ce16421029746d7ae71d9b6347ec0dfb34e7f4d70c091ed0690e926e89ff986', withMarks: 'c3237a057954ab5905c3cc4e71df2cb47e5a98366b4e82d9c8ae4a2b7142d3d3' };

describe('booking alert wording', () => {
  for (const [name, marks] of [['noMarks', new Set<string>()], ['withMarks', MARKS]] as const) {
    it(`only "Then tap I booked it" became "Then set it to Booked" (${name})`, () => {
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
