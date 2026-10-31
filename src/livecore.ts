// Live updates, the brain. No browser code in here, so tests can run it with a fake clock.
//
// The page asks one tiny question ("did anything change?") and only loads the
// full game list when the answer differs. How often it asks depends on whether
// the person is around:
//   touched in the last 2 minutes   every 5 seconds
//   2 to 10 minutes of quiet        every 15 seconds
//   10 minutes of quiet             stops until the next touch
//   tab hidden / screen off         stops; one check the moment it is visible again
// Trouble (offline, 429, 5xx) doubles the wait up to 60 seconds, silently.

/**
 * THE KILL SWITCH. Set `on` to false to turn live updates off everywhere (the
 * page then only refreshes the old ways: after a tap and on coming back).
 * To slow it down instead, raise `activeMs` / `idleMs`.
 */
export const LIVE_UPDATES = {
  on: true,
  /** Wait between checks while the person is active. */
  activeMs: 5_000,
  /** Wait between checks after `slowAfterMs` without a tap or scroll. */
  idleMs: 15_000,
  slowAfterMs: 2 * 60_000,
  /** No checks at all after this long without a tap or scroll, until the next one. */
  stopAfterMs: 10 * 60_000,
  /** Trouble doubles the wait, never past this. */
  maxBackoffMs: 60_000,
};

export type LiveConfig = typeof LIVE_UPDATES;

export interface LiveEnv {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
  /** Ask the server for the current stamp. Throws an object with a numeric `status` (0 offline) on trouble. */
  fetchStamp(): Promise<string>;
  /** The stamp differs from the one the screen was drawn from. */
  onChange(stamp: string): void;
  isVisible(): boolean;
  /** Optional: the check itself worked (changed or not). Lets a screen say when it last looked. */
  onChecked?(): void;
}

/** Trouble worth backing off for: offline, rate limit, server errors. */
export function isTrouble(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status !== 'number' || status === 0 || status === 429 || status >= 500;
}

export class LivePoller {
  private known: string | null = null;
  private lastTouch: number;
  private lastCheck: number;
  private timer: unknown = null;
  private inFlight = false;
  private backoff = 0;
  private running = false;
  private dead = false;
  /** How many checks went out (for tests and the usage math). */
  checks = 0;

  constructor(
    private env: LiveEnv,
    private cfg: LiveConfig = LIVE_UPDATES,
  ) {
    this.lastTouch = env.now();
    this.lastCheck = env.now();
  }

  /** The stamp the screen was drawn from (every full load tells us). */
  setKnown(stamp: string | null) {
    this.known = stamp;
  }

  start() {
    if (!this.cfg.on || this.running) return;
    this.running = true;
    this.lastTouch = this.env.now();
    this.lastCheck = this.env.now();
    this.plan();
  }

  stop() {
    this.running = false;
    this.clear();
  }

  /** A tap, scroll or key. Wakes a stopped poller and speeds up a slow one. */
  touch() {
    const was = this.env.now() - this.lastTouch;
    this.lastTouch = this.env.now();
    if (!this.running || this.dead) return;
    if (was >= this.cfg.slowAfterMs) {
      // Was slow or stopped: look right away (at most one check per active wait), then go fast.
      this.clear();
      this.plan();
    }
  }

  /** The tab went hidden / the screen turned off. */
  hide() {
    this.clear();
  }

  /** Visible again: that counts as a touch, and checks once right now. */
  show() {
    if (!this.running || this.dead) return;
    this.lastTouch = this.env.now();
    this.backoff = 0;
    this.clear();
    void this.check();
  }

  private clear() {
    if (this.timer !== null) this.env.clearTimer(this.timer);
    this.timer = null;
  }

  /** The wait before the next check, or null when it should stay quiet. */
  nextWait(): number | null {
    const quiet = this.env.now() - this.lastTouch;
    if (quiet >= this.cfg.stopAfterMs) return null;
    const base = quiet >= this.cfg.slowAfterMs ? this.cfg.idleMs : this.cfg.activeMs;
    return Math.max(base, this.backoff);
  }

  private plan() {
    this.clear();
    if (!this.running || this.dead || !this.env.isVisible()) return;
    const wait = this.nextWait();
    if (wait === null) return;
    const due = this.lastCheck + wait - this.env.now();
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      void this.check();
    }, Math.max(0, due));
  }

  private async check() {
    if (!this.running || this.dead || this.inFlight || !this.env.isVisible()) return;
    this.inFlight = true;
    this.lastCheck = this.env.now();
    this.checks++;
    try {
      const stamp = await this.env.fetchStamp();
      this.backoff = 0;
      this.env.onChecked?.();
      if (this.known !== null && stamp !== this.known) this.env.onChange(stamp);
      else if (this.known === null) this.known = stamp;
    } catch (err) {
      if (isTrouble(err)) {
        const base = this.nextWait() ?? this.cfg.activeMs;
        this.backoff = Math.min(this.cfg.maxBackoffMs, Math.max(base, this.backoff) * 2);
      } else {
        // 404 / 403: the link is not good any more. The full load shows that; stop asking.
        this.dead = true;
      }
    } finally {
      this.inFlight = false;
      this.plan();
    }
  }
}
