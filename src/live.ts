import { useEffect, useRef } from 'react';
import { liveIsBusy, onLiveQuiet } from './busy';
import { api, demoOn } from './lib';
import { LIVE_UPDATES, LivePoller } from './livecore';


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
  // The tiny check works but the full load does not: wait (doubling, up to a minute) instead of reloading every check.
  const cooldown = useRef({ until: 0, wait: 0 });

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
        const ok = await reloadRef.current();
        if (ok) cooldown.current = { until: 0, wait: 0 };
        else {
          const wait = Math.min(LIVE_UPDATES.maxBackoffMs, Math.max(LIVE_UPDATES.activeMs, cooldown.current.wait * 2));
          cooldown.current = { until: Date.now() + wait, wait };
        }
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
        if (demoOn() || Date.now() < cooldown.current.until) return;
        if (liveIsBusy()) pending.current = true;
        else void apply();
      },
    });
    p.setKnown(version);
    poller.current = p;
    const stopWaiting = onLiveQuiet(() => {
      if (pending.current && Date.now() >= cooldown.current.until) void apply();
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
