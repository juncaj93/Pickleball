// "Undo" for a drop out (player) and Remove player (organizer).
//
// Money is involved, so a finished drop is never reversed. The drop is HELD
// for a few seconds instead: the screen shows it done, nothing is sent yet.
// Undo throws the hold away (the server never heard of it). When the time is
// up it is sent exactly like the old instant drop. If the page is closed or
// hidden first, it is sent right then (fetch with keepalive, which survives
// the page going away) so a drop is never lost.

/** How long Undo is offered. */
export const UNDO_MS = 5_000;

export interface Hold {
  /** Send it for real. `leaving` is true when the page is going away. */
  send(leaving: boolean): Promise<void>;
  /** Sent (or failed): the screen should stop showing the held state. */
  settled(err: unknown | null): void | Promise<void>;
  /** Undone: the screen should show the original again. */
  undone(): void;
}

interface Active extends Hold {
  timer: ReturnType<typeof setTimeout>;
  key: string;
  done: boolean;
}

let active: Active | null = null;
/** The send that is on its way (fired, not yet answered), so a tap can wait for it to land. */
let inFlight: Promise<void> | null = null;

async function fire(h: Active, leaving: boolean) {
  if (h.done) return;
  h.done = true;
  clearTimeout(h.timer);
  if (active === h) active = null;
  const run = (async () => {
    try {
      await h.send(leaving);
      await h.settled(null);
    } catch (err) {
      await h.settled(err);
    }
  })();
  inFlight = run;
  await run;
  if (inFlight === run) inFlight = null;
}

/** Hold a send for `ms`. Only one hold at a time: starting another sends the first at once. */
export function startHold(key: string, hold: Hold, ms = UNDO_MS) {
  if (active) void fire(active, false);
  const h: Active = { ...hold, key, done: false, timer: setTimeout(() => void fire(h, false), ms) };
  active = h;
}

/** The person tapped Undo. True if there was still something to undo. */
export function undoHold(key: string): boolean {
  const h = active;
  if (!h || h.key !== key || h.done) return false;
  h.done = true;
  clearTimeout(h.timer);
  active = null;
  h.undone();
  return true;
}

/**
 * Send any held action now and wait until it has landed (or failed): a tap that depends on it goes after.
 * I'm in on another game right after a Drop out: the drop's credit must be on the server before the join, or
 * the new seat would owe money while that credit sits unused.
 */
export async function settleHolds(): Promise<void> {
  if (active) await fire(active, false);
  else if (inFlight) await inFlight;
}

/** Send the held action now (leaving the page, or a new hold starting). */
export function flushHold(leaving = false) {
  if (active) void fire(active, leaving);
}

export const holdPending = (key?: string) => !!active && !active.done && (key === undefined || active.key === key);

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushHold(true);
  });
  window.addEventListener('pagehide', () => flushHold(true));
}

// ---------- A held drop the page may not have sent (it closed or lost signal) ----------

/** Kept in storage while a drop is held, so a page that died before sending it can finish it next time. */
export interface PendingDropNote {
  sessionId?: string;
  at?: number;
}

/** How long after the tap a left-over note is still finished (older ones are dropped: too late to be sure). */
export const PENDING_DROP_MAX_MS = 2 * 60_000;

/**
 * What to do with a left-over drop note when the page opens (or looks again):
 *  - 'keep': this page still holds that drop (its Undo must keep working);
 *  - 'wait' for `ms`: younger than the hold, so another tab may still be holding it; look again after that;
 *  - 'send': the drop never reached the server and they are still in: send it now;
 *  - 'forget': already done (they are out), taken back (they are in again from a later tap), or too old.
 */
export function pendingDropAction(
  note: PendingDropNote | null,
  nowMs: number,
  stillIn: (sessionId: string) => boolean,
  heldHere: (sessionId: string) => boolean,
): { do: 'none' } | { do: 'keep' } | { do: 'wait'; ms: number } | { do: 'send'; sessionId: string } | { do: 'forget' } {
  if (!note) return { do: 'none' };
  if (!note.sessionId || typeof note.at !== 'number') return { do: 'forget' };
  if (heldHere(note.sessionId)) return { do: 'keep' };
  const age = nowMs - note.at;
  if (age < UNDO_MS + 2_000) return { do: 'wait', ms: UNDO_MS + 2_000 - age + 50 };
  if (age >= PENDING_DROP_MAX_MS) return { do: 'forget' };
  return stillIn(note.sessionId) ? { do: 'send', sessionId: note.sessionId } : { do: 'forget' };
}
