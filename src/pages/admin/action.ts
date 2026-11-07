import { useId, useRef, useState } from 'react';
import type { AdminDashboard } from '../../../shared/api';
import { ApiError } from '../../lib';
import { useToast } from '../../ui';
import { useInstant } from '../../InstantTaps';
import type { AdminCtx } from '../Admin';
import { applyOps, opKey, type ReworkOp } from './reworkOptimistic';

/** Extras for one tap, used only with instant taps on (INSTANT_TAPS). */
export interface ActOptions {
  /** Which thing the tap changes, when one component has several (a row per player). A second tap on the same thing while it saves is ignored. */
  key?: string;
  /** What the screen shows at once, for a tap whose result is certain (Mark paid). Leave out where the server decides. */
  patch?: (d: AdminDashboard) => AdminDashboard;
  /** A few words for the error toast ("Mark paid"). */
  what?: string;
  /** Show the tapped button working (pressed look and spinner) even though a patch is drawn too. */
  press?: boolean;
  /**
   * Undo on admin toasts (ADMIN_UNDO, Zip 13): pass `ctx.d.adminUndo === true`. With instant taps on, the toast shows at once with Undo, the
   * save waits 5 seconds (dropped on Undo), and run() answers true at once (the caller closes its sheet). `onSaved` runs once it really saved.
   */
  undo?: boolean;
  onSaved?: () => void;
}

/**
 * The organizer screens' one "do this, then show the result" helper. Off (instant taps not on for this phone): exactly as it always was,
 * the buttons wait for the save and the full reload, then the toast. On: the shared instant-tap helper (src/InstantTaps.tsx) runs it:
 * a certain result is drawn at once, otherwise the tapped button shows a pressed look and a spinner; a second tap on the same thing is
 * ignored, other taps still work and save in order, and a failure puts the screen back with a plain toast. `busy` stays false then, so
 * nothing else on the screen is grayed out while one tap saves.
 */
export function useAction(ctx: AdminCtx) {
  const toast = useToast();
  const instant = useInstant<AdminDashboard>();
  const id = useId();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function run(fn: () => Promise<unknown>, success?: string, opts: ActOptions = {}) {
    if (instant) {
      if (opts.undo && success) {
        // Held for its Undo window: drawn now, answered now; the save (and onSaved) come 5 seconds later unless Undo is tapped.
        void instant
          .run({ key: `act${id}:${opts.key ?? success}`, patch: opts.patch ?? null, save: fn, saved: success, what: opts.what, press: opts.press, undo: true })
          .then((res) => {
            if (res.status === 'ok') opts.onSaved?.();
          });
        return true;
      }
      const res = await instant.run({ key: `act${id}:${opts.key ?? success ?? ''}`, patch: opts.patch ?? null, save: fn, saved: success, what: opts.what, press: opts.press });
      if (res.status === 'ok') opts.onSaved?.();
      return res.status === 'ok';
    }
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      if (success) toast(success);
      opts.onSaved?.();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  /** Is a tap from this helper still saving? (`key` exactly as passed to run.) Always false with instant taps off. */
  const pending = (key = '') => !!instant?.busy(`act${id}:${key}`);
  return { busy, run, pending };
}

/**
 * A money tap whose result is certain (Mark paid, Unmark, Undo credit, Clear, Reopen), drawn at once the same way the Money page draws
 * it (reworkOptimistic.ts): one key per row, so a second tap on that row waits and another row still works.
 */
export function opTap(op: ReworkOp, what?: string, undo?: boolean): ActOptions {
  // Unmark and Unmark credit would have to work out what the person owes again (credit math): that is the server's to say, so those
  // only show the tapped button working. Mark paid (owes nothing after), Clear (owes nothing), Reopen and Hide are certain.
  const certain = op.kind === 'paid' || op.kind === 'clear' || op.kind === 'reopen' || op.kind === 'hide';
  // With Undo (ADMIN_UNDO) the save waits 5 seconds, so every money tap is drawn at once (an Unmark too: the same picture the Money page
  // draws); the server's answer replaces it once it saves.
  return { key: opKey(op), patch: certain || undo ? (d) => applyOps(d, [op]) : undefined, what, ...(undo ? { undo: true } : {}) };
}
