import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_WAIT_MS, drawPatches, failureWords, LoadTracker, SAVE_WAIT_MS, SaveLine, TapQueue } from '../src/instant';

// Independent review of the instant-tap helper (src/instant.ts). Each test proved one finding; after the fixes each one checks the fix.

type Data = { paid: string[] };
const pay = (...names: string[]) => (d: Data): Data => ({ ...d, paid: [...d.paid, ...names] });
const tick = () => new Promise((r) => setTimeout(r, 0));
function later<T = void>() {
  let ok!: (v: T) => void;
  let no!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => {
    ok = a;
    no = b;
  });
  return { p, ok, no };
}

function screen() {
  const tracker = new LoadTracker();
  tracker.on = true;
  const state = { server: { paid: [] as string[] }, drawn: { paid: [] as string[] } as Data, failLoad: false };
  const load = async () => {
    const n = tracker.begin();
    const snap = { paid: [...state.server.paid] };
    await tick();
    if (state.failLoad) throw new Error('offline');
    if (tracker.accept(n)) state.drawn = snap;
  };
  // useLoad.reload never rejects (it catches and sets `error`), so the real confirm never throws either.
  const confirm = () => load().catch(() => undefined);
  const q = new TapQueue<(d: Data) => Data>(() => {}, confirm, tracker, new SaveLine());
  const view = () => drawPatches(state.drawn, q.patches());
  return { q, state, view, load, tracker };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('review: instant taps', () => {
  it('"I paid" for two games, the first saves and the second fails: the screen ends right (A paid) and the usual words are plain (the screen says how many saved, PlayerHome usePaid failText)', async () => {
    const { q, state, view } = screen();
    // usePaid (PlayerHome.tsx): one tap, one key, one patch, a save that loops over every owed game.
    const res = await q.run({
      key: 'paid:A,B',
      patch: pay('A', 'B'),
      save: async () => {
        state.server.paid.push('A'); // POST /api/sessions/A/paid went in
        throw Object.assign(new Error('Server error'), { status: 500 }); // POST /api/sessions/B/paid failed
      },
    });
    expect(res.status).toBe('failed');
    await tick();
    await tick();
    expect(state.server.paid).toEqual(['A']); // money DID move for A
    expect(view().paid).toEqual(['A']); // the screen (after the reload) shows A paid
    // The usual words keep the name as written ("I paid", not "i paid"); usePaid replaces them when some games went through.
    if (res.status === 'failed') expect(failureWords(res.error, 'I paid')).toBe("I paid didn't save. Nothing changed.");
    // Also offline after the first one:
    expect(failureWords({ status: 0 }, 'I paid')).toBe("No signal. I paid didn't save, nothing changed.");
  });

  it('after dispose() and attach() again (React StrictMode practice unmount, then the effect runs again) a good poll still drops a saved patch', async () => {
    const { q, state, view, load } = screen();
    state.failLoad = true; // the confirm reload right after the save fails
    expect((await q.run({ key: 'row:A', patch: pay('A'), save: async () => void state.server.paid.push('A') })).status).toBe('ok');
    q.dispose(); // StrictMode dev: the cleanup runs once...
    q.attach(); // ...and the effect runs again (InstantTaps.tsx, ReworkOps.tsx)
    state.failLoad = false;
    await load(); // the next 5-second poll draws fresh data
    expect(q.busy('row:A')).toBe(false);
    expect(q.patches()).toHaveLength(0);
    void view;
  });

  it('known and accepted: saved but every reload fails for 15 s, the patch is let go (never stuck); the next good load shows the server again', async () => {
    vi.useFakeTimers();
    const tracker = new LoadTracker();
    tracker.on = true;
    const server = { paid: [] as string[] };
    let drawn: Data = { paid: [] };
    const q = new TapQueue<(d: Data) => Data>(() => {}, async () => undefined /* offline: nothing drawn */, tracker, new SaveLine());
    const res = await q.run({ key: 'row:A', patch: pay('A'), save: async () => void server.paid.push('A') });
    expect(res.status).toBe('ok');
    expect(drawPatches(drawn, q.patches()).paid).toEqual(['A']);
    vi.advanceTimersByTime(CONFIRM_WAIT_MS + 1);
    expect(server.paid).toEqual(['A']);
    expect(drawPatches(drawn, q.patches()).paid).toEqual([]); // the screen now says "unpaid" again; a re-tap is possible
    expect(q.busy('row:A')).toBe(false);
    drawn = { paid: [] };
  });

  it('one save that never answers holds the taps after it for at most SAVE_WAIT_MS, then they are sent', async () => {
    vi.useFakeTimers();
    const tracker = new LoadTracker();
    tracker.on = true;
    const q = new TapQueue<(d: Data) => Data>(() => {}, async () => undefined, tracker, new SaveLine());
    const hung = later();
    void q.run({ key: 'row:A', patch: pay('A'), save: () => hung.p });
    let bSent = false;
    void q.run({ key: 'row:B', patch: pay('B'), save: async () => void (bSent = true) });
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS - 100);
    expect(bSent).toBe(false); // still in order while A may yet answer
    await vi.advanceTimersByTimeAsync(200);
    expect(bSent).toBe(true); // A never answered: B goes anyway
  });
});
