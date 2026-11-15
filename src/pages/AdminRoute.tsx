import { useEffect, useState } from 'react';
import { loadedAdmin, loadOrRecover } from '../adminChunk';
import { TopBar } from '../Shell';
import { AdminLoadingScreen } from './AdminLoading';

// Zip 48 (speed split): /admin in the player download. The organizer screens come from their own file (src/adminChunk.ts).
// - Already here (fetched in the background, or opened before on this page): drawn at once, exactly as before.
// - On its way: the organizer's usual loading screen (the same one the organizer screens show while their data loads), so nothing jumps.
// - Failed: an old page after a deploy reloads once by itself; with no signal, a "Try again" screen (never a blank page), which also tries
//   again by itself when the phone is back online.

type Status = 'loading' | 'offline' | 'failed';

export function AdminRoute() {
  const [mod, setMod] = useState(loadedAdmin);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState<{ n: number; userAsked: boolean }>({ n: 0, userAsked: false });

  useEffect(() => {
    if (mod) return undefined;
    let live = true;
    setStatus('loading');
    loadOrRecover(attempt.userAsked).then((r) => {
      if (!live) return;
      if (r === 'loaded') setMod(loadedAdmin);
      else if (r === 'offline' || r === 'failed') setStatus(r);
      // 'reloading': the page is being replaced; keep the loading screen.
    });
    return () => {
      live = false;
    };
  }, [mod, attempt]);

  // Back online while the Try again screen shows: try by itself.
  useEffect(() => {
    if (mod || status === 'loading') return undefined;
    const again = () => setAttempt((a) => ({ n: a.n + 1, userAsked: false }));
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [mod, status]);

  if (mod) return <mod.AdminApp />;
  if (status === 'loading') return <AdminLoadingScreen />;
  return <AdminLoadFailed offline={status === 'offline'} onRetry={() => setAttempt((a) => ({ n: a.n + 1, userAsked: true }))} />;
}

/** The organizer file did not arrive: the same title bar and the same card as any other "Something went wrong", with Try again. */
export function AdminLoadFailed({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  return (
    <>
      <TopBar eyebrow="Organizer" title="Dashboard" />
      <main className="page">
        <div className="card stack" role="alert">
          <h2>Something went wrong</h2>
          <p className="muted">
            {offline
              ? 'No connection right now, so the organizer page could not load. It tries again by itself when your signal is back.'
              : 'The organizer page could not load.'}
          </p>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      </main>
    </>
  );
}
