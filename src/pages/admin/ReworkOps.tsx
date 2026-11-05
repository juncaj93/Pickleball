import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { useToast } from '../../ui';
import { SaveLine, TapQueue } from '../../instant';
import { secondTapOnOther, useInstant } from '../../InstantTaps';
import type { AdminCtx } from '../Admin';
import { applyOps, opKey, type ReworkOp } from './reworkOptimistic';

// Instant taps on the reworked Money page (MONEY_REWORK): the provider keeps the taps whose save is still running and hands the page a copy
// of the screen's data with them already drawn (reworkOptimistic.ts). Other screens never see it. The rules (a second tap on the same row
// is ignored, a failed save puts the screen back) are the site's one shared instant-tap helper (src/instant.ts). With "Instant taps"
// (INSTANT_TAPS) on, the Money page also shares the rest of the screen's save order and its guard against old poll answers.

interface Store {
  /** Draws the taps still saving on top of a list of games (for a month loaded on its own). */
  patch: (sessions: AdminSessionView[]) => AdminSessionView[];
  queue: TapQueue<ReworkOp>;
  busy: (key: string) => boolean;
  /** Instant taps (INSTANT_TAPS) is on for this phone. */
  instant: boolean;
}
const OpsContext = createContext<Store | null>(null);

/** Wraps the Money page: gives `children` a ctx whose data already shows the taps in flight. */
export function ReworkOpsProvider({ ctx, children }: { ctx: AdminCtx; children: (ctx: AdminCtx) => ReactNode }) {
  const instant = useInstant();
  const [tick, setTick] = useState(0);
  const reload = useRef(ctx.reload);
  reload.current = ctx.reload;
  const queue = useRef<TapQueue<ReworkOp> | null>(null);
  if (!queue.current) {
    queue.current = instant
      ? new TapQueue<ReworkOp>(() => setTick((n) => n + 1), () => reload.current(), instant.tracker, instant.line)
      : new TapQueue<ReworkOp>(() => setTick((n) => n + 1), () => reload.current(), null, new SaveLine(false));
  }
  const q = queue.current;
  useEffect(() => () => q.dispose(), [q]);
  const busy = useCallback((k: string) => q.busy(k), [q]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ops = useMemo(() => q.patches(), [q, tick]);
  const on = !!instant;
  const store = useMemo<Store>(() => ({ queue: q, busy, instant: on, patch: (sessions) => applyOps({ ...ctx.d, sessions }, ops).sessions }), [q, busy, on, ctx.d, ops, tick]);
  const view = useMemo<AdminCtx>(() => ({ ...ctx, d: applyOps(ctx.d, ops) }), [ctx, ops]);
  return <OpsContext.Provider value={store}>{children(view)}</OpsContext.Provider>;
}

/** Is a save for this row (or game) still running? Its buttons wait, so a second tap cannot double-save. */
export function useReworkBusy(): (op: ReworkOp) => boolean {
  const store = useContext(OpsContext);
  return (op) => !!store?.busy(opKey(op));
}

/**
 * Run a tap the instant-tap way: draw it now, save in the background, say so when the server confirms, and on a failure put the screen back
 * exactly as it was and say "Couldn't save, nothing changed". Returns null outside the Money page (the caller then does what it always did).
 */
export function useReworkRun(ctx: AdminCtx): ((op: ReworkOp, save: () => Promise<unknown>, success?: string) => Promise<boolean>) | null {
  void ctx;
  const store = useContext(OpsContext);
  const toast = useToast();
  if (!store) return null;
  return async (op, save, success) => {
    // With instant taps on, the second half of a double tap that lands on another row (the paid row moved) is ignored.
    if (store.instant && secondTapOnOther(opKey(op))) return false;
    const res = await store.queue.run({
      key: opKey(op),
      patch: op,
      save: async () => {
        const value = await save();
        if (success) toast(success);
        return value;
      },
    });
    if (res.status === 'failed') toast("Couldn't save, nothing changed", 'error');
    return res.status === 'ok';
  };
}

/** The same instant-tap picture for a list of games loaded on its own (an older month). Outside the Money page the list is returned as it is. */
export function useReworkPatch(): (sessions: AdminSessionView[]) => AdminSessionView[] {
  const store = useContext(OpsContext);
  return store ? store.patch : (sessions) => sessions;
}
