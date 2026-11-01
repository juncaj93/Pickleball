import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextTasks } from '../shared/tasks';
import { MARKS, OPTS, SCENARIO, ticks } from './tick-scenarios';

// Nov 1, 2026 (Alex): the booking alerts say "Then set it to Booked" instead of "Then tap I booked it"
// (there is no I booked it button any more). This proves that wording is the ONLY change to every card
// and alert the brain makes from Oct 14 to Nov 27: putting the old words back gives the fingerprint
// stored in tests/fixtures/tick-golden.json before the change.
const OLD_CARDS = { noMarks: 'cdec146b4aeb0e8f274eaa06726b8b48ba59ec014ac08024202467109700208a', withMarks: 'd4cad9c04d0de51a05ce3eaf3f2d07d1eec4d1e95471320679f68f040c726fb2' };

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
