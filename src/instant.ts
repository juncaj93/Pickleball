// Instant taps (INSTANT_TAPS), the one shared helper. Grown out of the Money page's own instant taps (MONEY_REWORK, Zip 4), which now
// runs on it too.
//
// The idea in plain words: a tap lays a small "what this will become" patch over the data the screen already has, so the screen
// changes in the same instant. The real save runs in the background. When the server confirms, the screen reloads the real data and
// the patch is dropped only once that fresh data is on screen (so nothing flickers back). If the save fails, the patch is dropped at
// once, which puts the screen back exactly as it was (nothing underneath was ever changed), and the caller shows a toast.
//
// The safety rules live here, once, for every screen:
//  - A second tap on the same thing while its save runs is ignored (no double charge, no double drop).
//  - Taps on different things still work, and their saves go to the server one after another in the order they were tapped.
//  - A refresh or a 5-second poll that started before a save finished can never draw over it: such an old answer is thrown away
//    (LoadTracker), and the patch stays until data newer than the save is on screen.
//  - The server's answer wins: after a save the screen shows what the server sent back, never the guess.
// Nothing here talks to the network itself; the screen hands in `save` and `confirm`. Pure TypeScript, unit tested.

/** One tap still waiting on the server. `patch` draws it; `savedAt` is set once the server said yes. */
export interface PendingTap<P> {
  id: number;
  key: string;
  patch: P | null;
  /** The load number current when the save landed: the patch is dropped once a load started after it is on screen. */
  savedAt: number | null;
}

/** The longest a saved tap waits for fresh data before it lets go of its patch and its key. */
export const CONFIRM_WAIT_MS = 15_000;

export type TapResult<R> = { status: 'ignored' } | { status: 'ok'; value: R } | { status: 'failed'; error: unknown };

/**
 * Counts the screen's data loads, so an answer that started before a newer one was drawn is thrown away (a slow poll that set off
 * before a save must not draw the old data over it). `on` false: it counts but never throws anything away (exactly the old behavior).
 */
export class LoadTracker {
  on = false;
  private started = 0;
  private drawn = 0;
  private listeners = new Set<() => void>();

  /** A load is setting off. Returns its number. */
  begin(): number {
    return ++this.started;
  }

  /** May the answer of load `n` be drawn? Draws it (remembers it) when yes. */
  accept(n: number): boolean {
    if (this.on && n < this.drawn) return false;
    this.drawn = Math.max(this.drawn, n);
    for (const l of [...this.listeners]) l();
    return true;
  }

  /** The newest load number handed out so far. */
  get newestStarted(): number {
    return this.started;
  }

  /** The newest load whose answer is on screen. */
  get newestDrawn(): number {
    return this.drawn;
  }

  onDrawn(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

/** The order saves go to the server in: one at a time, in tap order. Several queues (the Money page and the rest of the screen) share one. */
/** The longest a save waits for the one before it: a save that hangs (no answer at all) never holds the taps after it for longer. */
export const SAVE_WAIT_MS = 10_000;

export class SaveLine {
  private chain: Promise<unknown> = Promise.resolve();
  /** `ordered` false: each save goes at once, side by side (the Money page as built in Zip 4, with instant taps off). */
  constructor(private readonly ordered = true) {}
  /** Run `save` after every save handed in before it (a failed one does not stop the next). */
  add<R>(save: () => Promise<R>): Promise<R> {
    if (!this.ordered) return save();
    const turn = this.chain.then(save);
    const settled = turn.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>((r) => (timer = setTimeout(r, SAVE_WAIT_MS)));
    this.chain = Promise.race([settled, cap]).then(() => clearTimeout(timer));
    return turn;
  }
}

export interface RunOptions<P, R> {
  /** One key per thing a tap can change ("row:game:player", "toggle:payAlways"). Same key while saving: the tap is ignored. */
  key: string;
  /** What the screen should show at once (null: nothing changes until the server answers, e.g. a pressed button with a spinner). */
  patch: P | null;
  /** The real save. */
  save: () => Promise<R>;
}

/**
 * The taps in flight for one screen. `onChange` is called whenever the list of patches changes (the screen redraws from
 * `patches()`). `confirm` reloads the screen's data after a save (its failure is fine: the patch then waits for the next good load).
 */
export class TapQueue<P> {
  private pending: PendingTap<P>[] = [];
  private flying = new Set<string>();
  private next = 1;
  private stopWatching: (() => void) | null = null;

  constructor(
    private readonly onChange: () => void,
    private readonly confirm: () => Promise<unknown>,
    private readonly tracker: LoadTracker | null = null,
    private readonly line: SaveLine = new SaveLine(),
  ) {
    this.attach();
  }

  /** Watch the screen's loads (a saved tap's patch goes once fresh data is drawn). Safe to call again after dispose (React StrictMode). */
  attach() {
    if (!this.stopWatching && this.tracker) this.stopWatching = this.tracker.onDrawn(() => this.dropConfirmed());
  }

  /** The patches to draw, oldest tap first. */
  patches(): P[] {
    return this.pending.filter((t) => t.patch !== null).map((t) => t.patch as P);
  }

  /** Is a save for this key still running (or confirmed but not on screen yet)? */
  busy(key: string): boolean {
    return this.flying.has(key);
  }

  /** How many taps are still waiting. */
  get size(): number {
    return this.pending.length;
  }

  dispose() {
    this.stopWatching?.();
    this.stopWatching = null;
  }

  /**
   * Run a tap: draw it now, save in the background (after any earlier tap's save, so the server sees them in tap order), then
   * reload. Resolves when the tap is settled: 'ok' (saved; the patch goes once fresh data is drawn), 'failed' (the patch is gone,
   * the screen is as before), or 'ignored' (the same thing was already saving).
   */
  async run<R>(opts: RunOptions<P, R>): Promise<TapResult<R>> {
    if (this.flying.has(opts.key)) return { status: 'ignored' };
    this.flying.add(opts.key);
    const tap: PendingTap<P> = { id: this.next++, key: opts.key, patch: opts.patch, savedAt: null };
    this.pending.push(tap);
    this.onChange();
    // One save at a time, in tap order. A failed save does not stop the next one.
    const turn = this.line.add(opts.save);
    let value: R;
    try {
      value = await turn;
    } catch (error) {
      this.remove(tap);
      // The real data, in case the server did part of it or something else changed meanwhile (the server's answer wins).
      void this.confirm().catch(() => undefined);
      return { status: 'failed', error };
    }
    if (this.tracker?.on) {
      // Saved. Keep drawing the patch until a load that started after this moment is on screen.
      tap.savedAt = this.tracker.newestStarted;
      try {
        await this.confirm();
      } catch {
        /* offline for a moment: the next good load drops the patch */
      }
      this.dropConfirmed();
      // Never stuck: if no fresh load lands (offline right after the save), let go after a while anyway.
      if (this.pending.includes(tap)) setTimeout(() => this.pending.includes(tap) && this.remove(tap), CONFIRM_WAIT_MS);
    } else {
      // Without a tracker (the Money page as built in Zip 4): drop the patch once the reload has finished.
      try {
        await this.confirm();
      } catch {
        /* keep going */
      }
      this.remove(tap);
    }
    return { status: 'ok', value };
  }

  private remove(tap: PendingTap<P>) {
    const i = this.pending.indexOf(tap);
    if (i >= 0) this.pending.splice(i, 1);
    this.flying.delete(tap.key);
    this.onChange();
  }

  /** Drop every saved tap whose fresh data is now on screen. */
  private dropConfirmed() {
    if (!this.tracker) return;
    const drawn = this.tracker.newestDrawn;
    const done = this.pending.filter((t) => t.savedAt !== null && drawn > t.savedAt);
    if (done.length === 0) return;
    for (const t of done) {
      this.pending.splice(this.pending.indexOf(t), 1);
      this.flying.delete(t.key);
    }
    this.onChange();
  }
}

/** Draw patches (functions from data to data) over the data, oldest first. No patches: the very same object (nothing redraws). */
export function drawPatches<T>(data: T, patches: ((d: T) => T)[]): T {
  return patches.reduce((acc, p) => p(acc), data);
}

/** Plain words for a failed save: the server's own reason when it gave one, else a short "nothing changed". */
export function failureWords(err: unknown, what?: string): string {
  const e = err as { status?: number; message?: string } | null;
  if (e && e.status === 0) return what ? `No signal. ${what} didn't save, nothing changed.` : 'No signal. Nothing changed.';
  if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.message) return e.message;
  return what ? `${what} didn't save. Nothing changed.` : "Couldn't save, nothing changed";
}
