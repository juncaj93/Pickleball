import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startEarlyLoads, usePath } from './lib';
import { ToastProvider } from './ui';
import { SetupPage } from './pages/Setup';
import { PlayerHome } from './pages/PlayerHome';
import { SiteHome } from './pages/SiteHome';
// Zip 48 (speed split): the organizer screens are their own file now, fetched only for /admin (src/adminChunk.ts). The marker keeps the
// place they had in the style order written down (src/adminSlot.ts); keep it on this line, before the late style files below.
// The player's credit sheet list styles (they also live in the organizer file; see the file). Keep it just above the marker.
import './credit-history.css';
import './adminSlot';
import { AdminRoute } from './pages/AdminRoute';
import { isAdminPath, loadAdmin } from './adminChunk';
import { GoPage } from './pages/GoPage';
import { GameDayTextPage } from './pages/GameDayTextPage';
import { watchKeyboard } from './keyboard';
import { watchInputMode } from './inputMode';
// Last, so its big-text rules win over the page styles above.
import './large-text.css';
// Even later: the Zip 7 switches' rules (all under an <html> attribute that only exists while the switch is on).
import './zip7.css';
import './view-only.css';
import './zip9.css';
// Zip 10, Card cleanup: every rule under <html data-card-cleanup> (dormant with the switch off).
import './zip10.css';
// Zip 11, Alert cards: every rule under <html data-alert-cards> (dormant with the switch off).
import './alert-cards.css';
// Seat dots: every rule under <html data-seat-dots> (dormant with the switch off).
import './seat-dots.css';
// Zip 13, Swap to Alex: classes that only exist while it is on for the organizer.
import './swap-button.css';
import './gameday.css';
// Zip 29: the folded TONIGHT tile on the organizer's Home (a real band height, the word centered by layout).
import './zip29.css';
// Zip 17 "Unpaid nudge" (src/unpaid-nudge.css): only classes the player page adds while the switch is on; loaded with the others.
import './unpaid-nudge.css';
// Zip 38: the Christmas skin (every rule sits under html[data-skin='christmas'] or the logo button; last so it wins over the card looks).
import './skin/christmas.css';

function App() {
  const path = usePath();
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/g\/([A-Za-z0-9_-]+)\/?$/))) return <PlayerHome groupKey={m[1]} />;
  // The old personal-link page (/t/<token>) is gone (Zip 11). None was ever sent on the live site; an old one still opens the home page.
  if (/^\/t(\/|$)/.test(path)) {
    window.history.replaceState(null, '', '/');
    return <SiteHome />;
  }
  if ((m = path.match(/^\/go\/([A-Za-z0-9_.-]+)\/?$/))) return <GoPage token={m[1]} />;
  // Zip 37: the hour-before Telegram's private "Text the players" link.
  if ((m = path.match(/^\/gt\/([A-Za-z0-9_.-]+)\/?$/))) return <GameDayTextPage token={m[1]} />;
  if (isAdminPath(path)) return <AdminRoute />;
  if (/^\/setup\/?$/.test(path)) return <SetupPage />;
  return <SiteHome />;
}

watchKeyboard();
// Zip 59: the focus ring only for the keyboard (src/inputMode.ts).
watchInputMode();
// Zip 12, "Load games at once" (SPEED_DIRECT_LOAD): on the plain address, both first questions leave now (only while the switch is on).
startEarlyLoads(window.location.pathname);

function draw() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
}

// Zip 48: opening /admin starts the organizer file now, and the first draw waits for it a moment (at most FIRST_DRAW_WAIT_MS), so a phone
// that has it (or gets it fast) draws the organizer screen straight away, as before, instead of a loading screen first. A failed or slow
// fetch draws at once: src/pages/AdminRoute.tsx shows the loading screen, recovers, or shows Try again. Every other address draws at once.
const FIRST_DRAW_WAIT_MS = 1500;
if (isAdminPath(window.location.pathname)) {
  let drawn = false;
  const drawOnce = () => {
    if (drawn) return;
    drawn = true;
    draw();
  };
  loadAdmin().then(drawOnce, drawOnce);
  setTimeout(drawOnce, FIRST_DRAW_WAIT_MS);
} else {
  draw();
}
