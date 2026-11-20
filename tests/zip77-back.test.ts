import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Zip 77 (the 🎾75 audit): Back closes the open sheet instead of leaving the site; organizer tab switches go back to the last tab
// (src/backStack.ts). A fake browser history that behaves like the real one: pushState drops the forward entries, history.go is asynchronous
// and fires ONE popstate (with the landed entry's state), Back from the first entry leaves the site.

class FakeHistory {
  entries: { state: unknown }[] = [{ state: null }];
  index = 0;
  left = false;
  constructor(private win: EventTarget) {}
  get state() {
    return this.entries[this.index].state;
  }
  get length() {
    return this.entries.length;
  }
  pushState(state: unknown) {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ state });
    this.index++;
  }
  replaceState(state: unknown) {
    this.entries[this.index] = { state };
  }
  go(n: number) {
    setTimeout(() => {
      const to = this.index + n;
      if (to < 0) {
        this.left = true;
        return;
      }
      this.index = Math.min(this.entries.length - 1, to);
      const e = new Event('popstate') as Event & { state: unknown };
      e.state = this.state;
      this.win.dispatchEvent(e);
    }, 0);
  }
  back() {
    this.go(-1);
  }
}

let win: EventTarget;
let hist: FakeHistory;
let bs: typeof import('../src/backStack');
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(async () => {
  win = new EventTarget();
  hist = new FakeHistory(win);
  vi.stubGlobal('window', win);
  vi.stubGlobal('history', hist);
  vi.resetModules();
  bs = await import('../src/backStack');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A sheet: open() gives Back its entry; close() is what X, Escape or a tap outside does. */
function sheet(refuse = false) {
  let release: (() => void) | null = null;
  const s = {
    open: false,
    closedByBack: 0,
    show() {
      s.open = true;
      release = bs.openLayer(() => {
        s.closedByBack++;
        if (!refuse) s.hide();
      });
    },
    hide() {
      s.open = false;
      release?.();
      release = null;
    },
  };
  return s;
}

describe('zip 77: Back with a sheet open', () => {
  it('Back closes the sheet and stays on the site; the next Back leaves', async () => {
    const a = sheet();
    a.show();
    await settle();
    expect(hist.index).toBe(1);
    hist.back();
    await settle();
    expect([a.open, a.closedByBack, hist.index, hist.left]).toEqual([false, 1, 0, false]);
    hist.back();
    await settle();
    expect(hist.left).toBe(true);
  });

  it('X (or Escape, or a tap outside) gives the entry back: no dead Back afterwards', async () => {
    const a = sheet();
    a.show();
    await settle();
    a.hide();
    await settle();
    expect(hist.index).toBe(0);
    expect(a.closedByBack).toBe(0);
    expect(bs.backStackState()).toEqual({ layers: 0, owned: 0, goingBack: false });
  });

  it('a sheet inside a sheet: Back closes the top one, then the one under it', async () => {
    const a = sheet();
    const b = sheet();
    a.show();
    await settle();
    b.show();
    await settle();
    expect(hist.index).toBe(2);
    hist.back();
    await settle();
    expect([a.open, b.open, hist.index]).toEqual([true, false, 1]);
    hist.back();
    await settle();
    expect([a.open, b.open, hist.index, hist.left]).toEqual([false, false, 0, false]);
  });

  it('one sheet hands over to the next in the same moment: the entry is reused (one Back closes the new one)', async () => {
    const a = sheet();
    const b = sheet();
    a.show();
    await settle();
    a.hide();
    b.show();
    await settle();
    expect(hist.index).toBe(1);
    hist.back();
    await settle();
    expect([b.open, hist.index, hist.left]).toEqual([false, 0, false]);
  });

  it('a parent closing its child too (both at once): both entries go back', async () => {
    const a = sheet();
    const b = sheet();
    a.show();
    b.show();
    await settle();
    expect(hist.index).toBe(2);
    b.hide();
    a.hide();
    await settle();
    expect(hist.index).toBe(0);
  });

  it('a sheet that will not close (busy): Back keeps it open and its entry comes back', async () => {
    const a = sheet(true);
    a.show();
    await settle();
    hist.back();
    await settle();
    expect([a.open, a.closedByBack, hist.index]).toEqual([true, 1, 1]);
    a.hide();
    await settle();
    expect(hist.index).toBe(0);
  });

  it('a fast open, close, open: one entry, Back closes it', async () => {
    const a = sheet();
    a.show();
    a.hide();
    a.show();
    await settle();
    expect(hist.index).toBe(1);
    hist.back();
    await settle();
    expect([a.open, hist.index]).toEqual([false, 0]);
  });
});

describe('zip 77: Back between the organizer’s tabs', () => {
  it('Home > Money > Players: Back to Money, Back to Home, then off the site', async () => {
    const seen: string[] = [];
    bs.markFirstTab('home');
    bs.onTabBack((t) => seen.push(t));
    bs.pushTab('money');
    await settle();
    bs.pushTab('players');
    await settle();
    expect(hist.index).toBe(2);
    hist.back();
    await settle();
    hist.back();
    await settle();
    expect(seen).toEqual(['money', 'home']);
    hist.back();
    await settle();
    expect(hist.left).toBe(true);
  });

  it('a sheet open on a tab: Back closes the sheet first, the tab stays; a tap outside onto another tab closes the sheet and moves there', async () => {
    const seen: string[] = [];
    bs.markFirstTab('home');
    bs.onTabBack((t) => seen.push(t));
    bs.pushTab('money');
    await settle();
    const a = sheet();
    a.show();
    await settle();
    hist.back();
    await settle();
    expect([a.open, seen]).toEqual([false, []]);
    // The tap outside lands on Players: the sheet closes and the tab switches in the same moment.
    a.show();
    await settle();
    a.hide();
    bs.pushTab('players');
    await settle();
    expect((hist.state as { pbTab?: string }).pbTab).toBe('players');
    expect(hist.index).toBe(2);
    hist.back();
    await settle();
    expect(seen).toEqual(['money']);
  });
});
