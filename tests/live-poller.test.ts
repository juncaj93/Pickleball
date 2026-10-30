import { describe, expect, it } from 'vitest';
import { LivePoller, LIVE_UPDATES, type LiveConfig, type LiveEnv } from '../src/livecore';

// The live-updates rhythm, run on a fake clock.

class Clock {
  t = 0;
  timers: { at: number; fn: () => void; id: number }[] = [];
  n = 0;
  visible = true;
  stamp = 's1';
  fail: null | { status: number } = null;
  asked: number[] = [];
  changes: string[] = [];
  env: LiveEnv = {
    now: () => this.t,
    setTimer: (fn, ms) => {
      const id = ++this.n;
      this.timers.push({ at: this.t + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      this.timers = this.timers.filter((x) => x.id !== id);
    },
    fetchStamp: async () => {
      this.asked.push(this.t);
      if (this.fail) throw this.fail;
      return this.stamp;
    },
    onChange: (s) => this.changes.push(s),
    isVisible: () => this.visible,
  };
  /** Move time forward, running timers (and the promises they start) in order. */
  async run(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.t = end;
  }
}

const SEC = 1000;
const MIN = 60 * SEC;
const make = (cfg: LiveConfig = LIVE_UPDATES) => {
  const c = new Clock();
  const p = new LivePoller(c.env, cfg);
  p.setKnown('s1');
  return { c, p };
};
const gaps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

describe('live updates: rhythm', () => {
  it('asks every 5 seconds while the person is active', async () => {
    const { c, p } = make();
    p.start();
    await c.run(30 * SEC);
    expect(c.asked).toEqual([5, 10, 15, 20, 25, 30].map((x) => x * SEC));
  });

  it('only reports a change when the stamp differs', async () => {
    const { c, p } = make();
    p.start();
    await c.run(12 * SEC);
    expect(c.changes).toEqual([]);
    c.stamp = 's2';
    await c.run(6 * SEC);
    expect(c.changes).toEqual(['s2']);
  });

  it('slows to every 15 seconds after 2 minutes without a touch, and stops after 10', async () => {
    const { c, p } = make();
    p.start();
    await c.run(15 * MIN);
    const late = c.asked.filter((t) => t > 2 * MIN && t <= 10 * MIN);
    expect(new Set(gaps(late))).toEqual(new Set([15 * SEC]));
    expect(c.asked.filter((t) => t > 10 * MIN + 15 * SEC)).toEqual([]);
  });

  it('a touch after it stopped checks right away and speeds up again', async () => {
    const { c, p } = make();
    p.start();
    await c.run(15 * MIN);
    const before = c.asked.length;
    p.touch();
    await c.run(1);
    expect(c.asked.length).toBe(before + 1);
    await c.run(10 * SEC);
    expect(c.asked.length).toBe(before + 3);
  });

  it('does not ask at all while the tab is hidden, and asks once when it is visible again', async () => {
    const { c, p } = make();
    p.start();
    await c.run(8 * SEC);
    c.visible = false;
    p.hide();
    const n = c.asked.length;
    await c.run(30 * MIN);
    expect(c.asked.length).toBe(n);
    c.visible = true;
    c.stamp = 's2';
    p.show();
    await c.run(1);
    expect(c.asked.length).toBe(n + 1);
    expect(c.changes).toEqual(['s2']);
  });

  it('backs off on 429 / 5xx / offline: doubles up to 60 seconds, then recovers', async () => {
    const { c, p } = make();
    p.start();
    c.fail = { status: 429 };
    await c.run(10 * MIN - 1);
    // Keep touching so it stays in the active rhythm and only the back-off slows it.
    const waits = gaps(c.asked);
    expect(waits[0]).toBe(10 * SEC);
    expect(Math.max(...waits)).toBeLessThanOrEqual(60 * SEC);
    expect(waits.slice(0, 4)).toEqual([10 * SEC, 20 * SEC, 40 * SEC, 60 * SEC]);
    c.fail = null;
    p.touch();
    await c.run(2 * MIN);
    const ok = gaps(c.asked.filter((t) => t > 10 * MIN));
    expect(ok.at(-1)).toBeLessThanOrEqual(60 * SEC);
  });

  it('offline (status 0) backs off the same way', async () => {
    const { c, p } = make();
    p.start();
    c.fail = { status: 0 };
    await c.run(2 * MIN);
    expect(gaps(c.asked).slice(0, 3)).toEqual([10 * SEC, 20 * SEC, 40 * SEC]);
  });

  it('a bad link (404 / 403) stops asking for good', async () => {
    const { c, p } = make();
    p.start();
    c.fail = { status: 404 };
    await c.run(5 * MIN);
    expect(c.asked.length).toBe(1);
  });

  it('kill switch: off means no checks at all', async () => {
    const { c, p } = make({ ...LIVE_UPDATES, on: false });
    p.start();
    p.touch();
    await c.run(10 * MIN);
    expect(c.asked).toEqual([]);
  });

  it('kill switch: a longer wait slows it down', async () => {
    const { c, p } = make({ ...LIVE_UPDATES, activeMs: 30 * SEC });
    p.start();
    await c.run(2 * MIN);
    expect(c.asked.length).toBe(4);
  });

  it('never has two checks in flight', async () => {
    const c = new Clock();
    let open = 0;
    let most = 0;
    c.env.fetchStamp = async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 0));
      open--;
      return 's1';
    };
    const p = new LivePoller(c.env);
    p.setKnown('s1');
    p.start();
    for (let i = 0; i < 20; i++) {
      p.touch();
      p.show();
    }
    await c.run(MIN);
    expect(most).toBe(1);
  });
});

describe('live updates: cost over a simulated hour', () => {
  it('one phone, touching every minute for an hour: 720 checks at most', async () => {
    const { c, p } = make();
    p.start();
    for (let i = 0; i < 60; i++) {
      p.touch();
      await c.run(MIN);
    }
    expect(c.asked.length).toBeLessThanOrEqual(720);
  });

  it('one phone left open and untouched for an hour: about 2 minutes fast + 8 minutes slow', async () => {
    const { c, p } = make();
    p.start();
    await c.run(60 * MIN);
    expect(c.asked.length).toBeLessThanOrEqual(24 + 32 + 2);
  });

  it('a phone that is hidden all hour sends nothing', async () => {
    const { c, p } = make();
    c.visible = false;
    p.start();
    p.hide();
    await c.run(60 * MIN);
    expect(c.asked.length).toBe(0);
  });

  it('a whole group of 10, every one of them tapping every 100 seconds for 2 hours (the worst case): well under 100,000 a day', async () => {
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const { c, p } = make();
      p.start();
      for (let t = 0; t < 120 * MIN; t += 100 * SEC) {
        p.touch();
        await c.run(100 * SEC);
      }
      total += c.asked.length;
    }
    expect(total).toBeLessThanOrEqual(14_500);
  });

  it('a failing server never gets more than one request per minute from a phone after back-off', async () => {
    const { c, p } = make();
    p.start();
    c.fail = { status: 503 };
    for (let i = 0; i < 60; i++) {
      p.touch();
      await c.run(MIN);
    }
    expect(c.asked.filter((t) => t > 5 * MIN).length).toBeLessThanOrEqual(56);
  });
});
