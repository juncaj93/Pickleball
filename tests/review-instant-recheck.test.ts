import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_WAIT_MS, SaveLine } from '../src/instant';

// Re-check of the reviewer fixes: the SaveLine cap proved to start when a save was HANDED IN; it now starts when its turn begins.

afterEach(() => vi.useRealTimers());

describe('review re-check: SaveLine SAVE_WAIT_MS', () => {
  it('slow (not hung) saves queued together keep tap order: each waits for the one before (no two in flight)', async () => {
    vi.useFakeTimers();
    const line = new SaveLine();
    const log: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    // Each save answers after 3 s (a slow phone network), five taps made at the same moment.
    const save = (name: string) => () => {
      log.push(`${name} sent`);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((r) =>
        setTimeout(() => {
          inFlight--;
          log.push(`${name} done`);
          r();
        }, 3_000),
      );
    };
    const all = ['A', 'B', 'C', 'D', 'E'].map((n) => line.add(save(n)));
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(all);
    expect(SAVE_WAIT_MS).toBe(10_000);
    expect(log).toEqual(['A sent', 'A done', 'B sent', 'B done', 'C sent', 'C done', 'D sent', 'D done', 'E sent', 'E done']);
    expect(maxInFlight).toBe(1);
  });
});
