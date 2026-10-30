import { useEffect, useRef } from 'react';
import { liveIsBusy, onLiveQuiet } from './busy';
import { api, demoOn } from './lib';
import { LivePoller } from './livecore';

export { LIVE_UPDATES } from './livecore';

/**
 * Keeps a screen fresh without a reload (see livecore.ts for the rhythm).
 *
 * - `version` is the stamp the screen was drawn from (GroupView.version).
 * - `reload` loads the latest data quietly and says whether it worked.
 * - `enabled` is false while nothing should be polled (the organizer's demo
 *   copy, no name picked, link problems).
 *
 * If a sheet is open, a button is saving or a finger is down, the new data
 * waits and is applied the moment things go quiet.
 */
export function useLiveUpdates({ enabled, version, reload }: { enabled: boolean; version: string | null; reload: () => Promise<boolean> }) {
  const poller = useRef<LivePoller | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const pending = useRef(false);
  const applying = useRef(false);

  // The screen was redrawn from newer data: that is the stamp to compare with now.
  useEffect(() => {
    poller.current?.setKnown(version);
  }, [version]);

  useEffect(() => {
    if (!enabled) return;
    const apply = async () => {
      if (applying.current) return;
      applying.current = true;
      pending.current = false;
      try {
        // A failed quiet load says nothing; the next check sees the old stamp still differs and tries again.
        await reloadRef.current();
      } finally {
        applying.current = false;
      }
    };
    const p = new LivePoller({
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      fetchStamp: async () => (await api<{ v: string }>('GET', '/api/group/version')).v,
      isVisible: () => document.visibilityState === 'visible',
      onChange: () => {
        if (demoOn()) return;
        if (liveIsBusy()) pending.current = true;
        else void apply();
      },
    });
    p.setKnown(version);
    poller.current = p;
    const stopWaiting = onLiveQuiet(() => {
      if (pending.current) void apply();
    });
    const touch = () => p.touch();
    const events = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    window.addEventListener('scroll', touch, { passive: true, capture: true });
    const vis = () => (document.visibilityState === 'visible' ? p.show() : p.hide());
    document.addEventListener('visibilitychange', vis);
    p.start();
    return () => {
      p.stop();
      poller.current = null;
      stopWaiting();
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      window.removeEventListener('scroll', touch, { capture: true });
      document.removeEventListener('visibilitychange', vis);
    };
    // The poller is made once per enabled period; `version` is fed to it by the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
