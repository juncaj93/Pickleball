import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_VENMO_STAY_MS, NO_VENMO_WAIT_MS, noVenmoMessage, watchVenmoLaunch } from '../src/venmoFallback';

/** A stand-in for the page: its visibility, and the listeners the watcher adds. */
function fakePage() {
  const doc = {
    visibilityState: 'visible',
    fns: new Set<() => void>(),
    addEventListener(_t: 'visibilitychange', fn: () => void) {
      this.fns.add(fn);
    },
    removeEventListener(_t: 'visibilitychange', fn: () => void) {
      this.fns.delete(fn);
    },
  };
  const win = {
    fns: new Set<() => void>(),
    addEventListener(_t: 'pagehide', fn: () => void) {
      this.fns.add(fn);
    },
    removeEventListener(_t: 'pagehide', fn: () => void) {
      this.fns.delete(fn);
    },
  };
  const setVisibility = (v: 'visible' | 'hidden') => {
    doc.visibilityState = v;
    [...doc.fns].forEach((f) => f());
  };
  return { doc, win, setVisibility };
}

describe('"No Venmo? Pay Alex directly"', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the organizer first name from the site data, never a fixed name', () => {
    expect(noVenmoMessage('Alex')).toBe('No Venmo? Pay Alex directly');
    expect(noVenmoMessage('Dana Whitfield')).toBe('No Venmo? Pay Dana directly');
    expect(noVenmoMessage('  Sam  ')).toBe('No Venmo? Pay Sam directly');
    expect(noVenmoMessage(null)).toBe('No Venmo? Pay the organizer directly');
    expect(noVenmoMessage('')).toBe('No Venmo? Pay the organizer directly');
  });

  it('the page stayed in view for the whole wait (no app): the note shows exactly once', () => {
    const p = fakePage();
    const onNoApp = vi.fn();
    watchVenmoLaunch(onNoApp, NO_VENMO_WAIT_MS, p.doc, p.win);
    vi.advanceTimersByTime(NO_VENMO_WAIT_MS - 1);
    expect(onNoApp).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onNoApp).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onNoApp).toHaveBeenCalledTimes(1);
    // The watcher cleaned up after itself.
    expect(p.doc.fns.size).toBe(0);
    expect(p.win.fns.size).toBe(0);
  });

  it('the app opened (the page went hidden): nothing shows, not even after coming back', () => {
    const p = fakePage();
    const onNoApp = vi.fn();
    watchVenmoLaunch(onNoApp, NO_VENMO_WAIT_MS, p.doc, p.win);
    vi.advanceTimersByTime(300);
    p.setVisibility('hidden');
    vi.advanceTimersByTime(30_000); // paying in the app
    p.setVisibility('visible'); // back on the page
    vi.advanceTimersByTime(30_000);
    expect(onNoApp).not.toHaveBeenCalled();
  });

  it('the page was left (pagehide): nothing shows', () => {
    const p = fakePage();
    const onNoApp = vi.fn();
    watchVenmoLaunch(onNoApp, NO_VENMO_WAIT_MS, p.doc, p.win);
    [...p.win.fns].forEach((f) => f());
    vi.advanceTimersByTime(10_000);
    expect(onNoApp).not.toHaveBeenCalled();
  });

  it('the page is hidden when the wait ends (a timer that ran late): nothing shows', () => {
    const p = fakePage();
    const onNoApp = vi.fn();
    watchVenmoLaunch(onNoApp, NO_VENMO_WAIT_MS, p.doc, p.win);
    p.doc.visibilityState = 'hidden'; // no event delivered yet
    vi.advanceTimersByTime(NO_VENMO_WAIT_MS + 1);
    expect(onNoApp).not.toHaveBeenCalled();
  });

  it('a second tap starts its own watch; stopping the first one leaves the second alone', () => {
    const p = fakePage();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watchVenmoLaunch(first, NO_VENMO_WAIT_MS, p.doc, p.win);
    stopFirst();
    watchVenmoLaunch(second, NO_VENMO_WAIT_MS, p.doc, p.win);
    vi.advanceTimersByTime(NO_VENMO_WAIT_MS + 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('two taps close together (two Pay buttons) give one note: the newer watch replaces the older', () => {
    const p = fakePage();
    const first = vi.fn();
    const second = vi.fn();
    watchVenmoLaunch(first, NO_VENMO_WAIT_MS, p.doc, p.win);
    vi.advanceTimersByTime(500);
    watchVenmoLaunch(second, NO_VENMO_WAIT_MS, p.doc, p.win);
    vi.advanceTimersByTime(NO_VENMO_WAIT_MS + 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('timing: about 2 seconds to wait, about 6 seconds on screen', () => {
    expect(NO_VENMO_WAIT_MS).toBe(2000);
    expect(NO_VENMO_STAY_MS).toBe(6000);
  });
});
