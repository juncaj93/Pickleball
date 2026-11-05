import { describe, expect, it } from 'vitest';
import { CONFIRM_WAIT_MS, drawPatches, failureWords, LoadTracker, SaveLine, TapQueue } from '../src/instant';

// The shared instant-tap helper (INSTANT_TAPS, src/instant.ts): success, failure rollback, double taps, ordering, and polls.

type Data = { paid: string[]; on: boolean };
const base: Data = { paid: [], on: false };
const pay = (name: string) => (d: Data): Data => ({ ...d, paid: [...d.paid, name] });

/** A promise we settle by hand, so the test decides when "the server" answers. */
function later<T = void>() {
  let ok!: (v: T) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    ok = a;
    no = b;
  });
  return { p, ok, no };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A tiny screen: `server` is what the server holds, `drawn` what the screen got from its last load. */
function screen(opts: { tracked?: boolean; line?: SaveLine } = {}) {
  const tracker = opts.tracked === false ? null : new LoadTracker();
  if (tracker) tracker.on = true;
  const state = { server: { paid: [] as string[], on: false }, drawn: { paid: [] as string[], on: false } as Data, changes: 0, loads: 0, failLoad: false };
  const load = async () => {
    const n = tracker?.begin() ?? 0;
    state.loads++;
    const snap = { ...state.server, paid: [...state.server.paid] };
    await tick();
    if (state.failLoad) throw new Error('offline');
    if (!tracker || tracker.accept(n)) state.drawn = snap;
  };
  const q = new TapQueue<(d: Data) => Data>(() => state.changes++, load, tracker, opts.line);
  const view = () => drawPatches(state.drawn, q.patches());
  return { q, state, view, load, tracker };
}

describe('instant taps: the shared helper', () => {
  it('success: drawn at once, saved, and the patch goes only once the fresh data is on screen (no flicker)', async () => {
    const { q, state, view } = screen();
    const save = later();
    const run = q.run({ key: 'row:Avery', patch: pay('Avery'), save: () => save.p.then(() => void state.server.paid.push('Avery')) });
    expect(view().paid).toEqual(['Avery']); // the same instant
    expect(state.server.paid).toEqual([]); // not saved yet
    save.ok();
    expect(await run).toMatchObject({ status: 'ok' });
    expect(state.server.paid).toEqual(['Avery']);
    expect(q.patches()).toHaveLength(0);
    expect(view().paid).toEqual(['Avery']); // now from the server, still shows paid
  });

  it('failure: the screen goes back exactly as it was, nothing half done, and it looks again', async () => {
    const { q, state, view } = screen();
    state.drawn = { paid: ['Blake'], on: true };
    const before = JSON.stringify(view());
    const save = later();
    const run = q.run({ key: 'row:Avery', patch: pay('Avery'), save: () => save.p });
    expect(view().paid).toEqual(['Blake', 'Avery']);
    save.no(Object.assign(new Error('Server error'), { status: 500 }));
    const res = await run;
    expect(res.status).toBe('failed');
    expect(JSON.stringify(view())).toBe(before);
    expect(q.busy('row:Avery')).toBe(false);
    await tick();
    expect(state.loads).toBeGreaterThan(0); // the real data again: the server's answer wins
  });

  it('a double tap on the same thing while it saves does nothing (one save, one patch)', async () => {
    const { q, state, view } = screen();
    let saves = 0;
    const save = later();
    const first = q.run({ key: 'row:Avery', patch: pay('Avery'), save: () => (saves++, save.p) });
    const second = await q.run({ key: 'row:Avery', patch: pay('Avery'), save: () => (saves++, Promise.resolve()) });
    expect(second.status).toBe('ignored');
    expect(view().paid).toEqual(['Avery']); // drawn once, not twice
    save.ok();
    await first;
    expect(saves).toBe(1);
    void state;
  });

  it('taps on different things still work while one saves, and reach the server in the order they were tapped', async () => {
    const { q, state, view } = screen();
    const order: string[] = [];
    const a = later();
    const b = later();
    const ra = q.run({ key: 'row:A', patch: pay('A'), save: () => (order.push('A sent'), a.p.then(() => void state.server.paid.push('A'))) });
    const rb = q.run({ key: 'row:B', patch: pay('B'), save: () => (order.push('B sent'), b.p.then(() => void state.server.paid.push('B'))) });
    expect(view().paid).toEqual(['A', 'B']); // both drawn at once
    await tick();
    expect(order).toEqual(['A sent']); // B waits for A
    b.ok(); // B's answer would be ready first, but it was not even sent yet
    await tick();
    expect(order).toEqual(['A sent']);
    a.ok();
    await Promise.all([ra, rb]);
    expect(order).toEqual(['A sent', 'B sent']);
    expect(state.server.paid).toEqual(['A', 'B']);
    expect(view().paid).toEqual(['A', 'B']);
  });

  it('a failed tap does not stop the next one, and only the failed one goes back', async () => {
    const { q, state, view } = screen();
    const a = later();
    const ra = q.run({ key: 'row:A', patch: pay('A'), save: () => a.p });
    const rb = q.run({ key: 'row:B', patch: pay('B'), save: async () => void state.server.paid.push('B') });
    a.no(Object.assign(new Error('No signal, try again'), { status: 0 }));
    expect((await ra).status).toBe('failed');
    expect((await rb).status).toBe('ok');
    expect(view().paid).toEqual(['B']);
    expect(state.server.paid).toEqual(['B']);
  });

  it('a poll that set off before the save and lands after it can never draw the old data over it', async () => {
    const { q, state, view, tracker } = screen();
    // The poll leaves first (it reads the server before the save), but its answer comes back late.
    const n = tracker!.begin();
    const oldSnap = { ...state.server, paid: [...state.server.paid] };
    await q.run({ key: 'row:A', patch: pay('A'), save: async () => void state.server.paid.push('A') });
    expect(view().paid).toEqual(['A']);
    // The late, old answer:
    if (tracker!.accept(n)) state.drawn = oldSnap;
    expect(view().paid).toEqual(['A']); // thrown away: no flicker back to unpaid
  });

  it('a poll landing while the save is still running does not undo the tap', async () => {
    const { q, state, view, load } = screen();
    const save = later();
    const run = q.run({ key: 'row:A', patch: pay('A'), save: () => save.p.then(() => void state.server.paid.push('A')) });
    await load(); // the 5-second poll, server not saved yet
    expect(view().paid).toEqual(['A']);
    save.ok();
    await run;
    expect(view().paid).toEqual(['A']);
  });

  it('saved but the reload failed (offline for a moment): the patch stays until a good load, never stuck for ever', async () => {
    const { q, state, view, load } = screen();
    state.failLoad = true;
    const res = await q.run({ key: 'row:A', patch: pay('A'), save: async () => void state.server.paid.push('A') });
    expect(res.status).toBe('ok');
    expect(view().paid).toEqual(['A']); // still drawn (the server has it)
    expect(q.busy('row:A')).toBe(true);
    state.failLoad = false;
    await load();
    expect(q.patches()).toHaveLength(0);
    expect(view().paid).toEqual(['A']);
    expect(q.busy('row:A')).toBe(false);
    expect(CONFIRM_WAIT_MS).toBeLessThanOrEqual(15_000);
  });

  it('without a tracker (the Money page with instant taps off) the patch goes when the reload has finished, as built in Zip 4', async () => {
    const { q, state, view } = screen({ tracked: false, line: new SaveLine(false) });
    const order: string[] = [];
    const a = later();
    const ra = q.run({ key: 'A', patch: pay('A'), save: () => (order.push('A'), a.p.then(() => void state.server.paid.push('A'))) });
    const rb = q.run({ key: 'B', patch: pay('B'), save: () => (order.push('B'), Promise.resolve().then(() => void state.server.paid.push('B'))) });
    await tick();
    expect(order).toEqual(['A', 'B']); // side by side, as before
    a.ok();
    await Promise.all([ra, rb]);
    expect(q.patches()).toHaveLength(0);
    expect(view().paid.sort()).toEqual(['A', 'B']);
  });

  it('a tap with nothing to draw (the server decides) still locks out the double tap and reports the answer', async () => {
    const { q, view } = screen();
    const save = later<{ result: string }>();
    const run = q.run({ key: 'join:1', patch: null, save: () => save.p });
    expect(view()).toEqual(base);
    expect(q.busy('join:1')).toBe(true);
    expect((await q.run({ key: 'join:1', patch: null, save: () => Promise.resolve({ result: 'x' }) })).status).toBe('ignored');
    save.ok({ result: 'waitlisted' });
    expect(await run).toEqual({ status: 'ok', value: { result: 'waitlisted' } });
  });

  it('drawPatches: no patches is the very same object (nothing redraws)', () => {
    const d = { paid: [], on: false };
    expect(drawPatches(d, [])).toBe(d);
  });

  it('LoadTracker switched off throws nothing away (exactly the old behavior)', () => {
    const t = new LoadTracker();
    const a = t.begin();
    const b = t.begin();
    expect(t.accept(b)).toBe(true);
    expect(t.accept(a)).toBe(true);
    t.on = true;
    const c = t.begin();
    const d = t.begin();
    expect(t.accept(d)).toBe(true);
    expect(t.accept(c)).toBe(false);
  });

  it('failure words are plain: the server reason, no signal, or nothing changed', () => {
    expect(failureWords({ status: 409, message: 'This game is full' })).toBe('This game is full');
    expect(failureWords({ status: 0, message: 'No signal, try again' }, 'I paid')).toBe("No signal. I paid didn't save, nothing changed.");
    expect(failureWords({ status: 500, message: 'Something went wrong. Try again.' }, 'Mark paid')).toBe("Mark paid didn't save. Nothing changed.");
    expect(failureWords(new Error('x'))).toBe("Couldn't save, nothing changed");
  });
});
