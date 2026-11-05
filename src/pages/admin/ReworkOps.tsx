import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { applyOps, opKey, type ReworkOp } from './reworkOptimistic';

// Instant taps on the reworked Money page (MONEY_REWORK): the provider keeps the taps whose save is still running and hands the page a copy
// of the screen's data with them already drawn (reworkOptimistic.ts). Other screens never see it.

interface Store {
  /** Draws the taps still saving on top of a list of games (for a month loaded on its own). */
  patch: (sessions: AdminSessionView[]) => AdminSessionView[];
  start: (op: ReworkOp) => number;
  end: (id: number) => void;
  busy: (key: string) => boolean;
}
const OpsContext = createContext<Store | null>(null);

/** Wraps the Money page: gives `children` a ctx whose data already shows the taps in flight. */
export function ReworkOpsProvider({ ctx, children }: { ctx: AdminCtx; children: (ctx: AdminCtx) => ReactNode }) {
  const [ops, setOps] = useState<{ id: number; op: ReworkOp }[]>([]);
  const next = useRef(1);
  const start = useCallback((op: ReworkOp) => {
    const id = next.current++;
    setOps((cur) => [...cur, { id, op }]);
    return id;
  }, []);
  const end = useCallback((id: number) => setOps((cur) => cur.filter((o) => o.id !== id)), []);
  const keys = useMemo(() => new Set(ops.map((o) => opKey(o.op))), [ops]);
  const store = useMemo<Store>(
    () => ({ start, end, busy: (k) => keys.has(k), patch: (sessions) => applyOps({ ...ctx.d, sessions }, ops.map((o) => o.op)).sessions }),
    [start, end, keys, ctx.d, ops],
  );
  const view = useMemo<AdminCtx>(() => ({ ...ctx, d: applyOps(ctx.d, ops.map((o) => o.op)) }), [ctx, ops]);
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
  const store = useContext(OpsContext);
  const toast = useToast();
  const flying = useRef(new Set<string>());
  if (!store) return null;
  return async (op, save, success) => {
    const key = opKey(op);
    // A second tap on the same thing while its save runs is ignored (no double save, no flicker).
    if (flying.current.has(key)) return false;
    flying.current.add(key);
    const id = store.start(op);
    try {
      await save();
      if (success) toast(success);
      await ctx.reload();
      return true;
    } catch {
      toast("Couldn't save, nothing changed", 'error');
      void ctx.reload().catch(() => {});
      return false;
    } finally {
      store.end(id);
      flying.current.delete(key);
    }
  };
}

/** The same instant-tap picture for a list of games loaded on its own (an older month). Outside the Money page the list is returned as it is. */
export function useReworkPatch(): (sessions: AdminSessionView[]) => AdminSessionView[] {
  const store = useContext(OpsContext);
  return store ? store.patch : (sessions) => sessions;
}
