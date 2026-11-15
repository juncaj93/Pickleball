import { useEffect, useState } from 'react';
import { TopBar } from '../Shell';
import { ScheduleSkeleton, Spinner } from '../ui';
import { rememberedAdminMotion } from '../motion';

// Zip 48: the organizer's "loading" screen lives in the player download, so the same screen shows while the organizer file is on its way
// (src/pages/AdminRoute.tsx) and while the organizer data is on its way (src/pages/Admin.tsx). One screen, no jump between the two steps.
// Moved here unchanged from src/pages/Admin.tsx; every class it uses is styled by the player download's style file.

/** The organizer's first-load screen: the title bar, then the soft placeholder cards (organizer motion on) or the plain spinner. */
export function AdminLoadingScreen() {
  return (
    <>
      <TopBar eyebrow="Organizer" title="Dashboard" />
      {/* The soft placeholder cards (the same shimmer the player page uses) only when this phone already knows the organizer motion is on; otherwise the plain spinner, as before. */}
      {rememberedAdminMotion() ? <AdminLoading /> : <Spinner />}
    </>
  );
}

/**
 * The first load, with the organizer motion on: soft placeholder cards (the same shimmer the player page uses), not drawn
 * at all if the data is here within 250 ms. The real cards then appear in place: nothing rises or slides in.
 */
// Zip 48: the loading screen can be handed from the organizer-file step (AdminRoute) to the data step (Admin) without a gap. These remember
// when the first one appeared, so the second one carries on (shimmer already showing stays showing) instead of hiding it for 250 ms again.
const LATE_MS = 250;
let shownSince: number | null = null;
let goneAt: number | null = null;

function AdminLoading() {
  const [late, setLate] = useState(() => {
    const now = Date.now();
    // A hand-over happens in the same moment; anything older is a new loading screen (for example after a trip to the player screen).
    if (shownSince === null || goneAt === null || now - goneAt > 100) shownSince = now;
    goneAt = null;
    return now - shownSince >= LATE_MS;
  });
  useEffect(() => {
    const left = LATE_MS - (Date.now() - (shownSince ?? Date.now()));
    const t = setTimeout(() => setLate(true), Math.max(0, left));
    return () => {
      clearTimeout(t);
      goneAt = Date.now();
    };
  }, []);
  return (
    <main className="page stack-lg admin-page admin-loading" role="status">
      <span className="sr-only">Loading…</span>
      {late && <ScheduleSkeleton />}
    </main>
  );
}
