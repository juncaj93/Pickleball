import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startEarlyLoads, usePath } from './lib';
import { ToastProvider } from './ui';
import { SetupPage } from './pages/Setup';
import { PlayerHome } from './pages/PlayerHome';
import { SiteHome } from './pages/SiteHome';
import { AdminApp } from './pages/Admin';
import { GoPage } from './pages/GoPage';
import { watchKeyboard } from './keyboard';
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
// Zip 17 "Unpaid nudge" (src/unpaid-nudge.css): only classes the player page adds while the switch is on; loaded with the others.
import './unpaid-nudge.css';

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
  if (/^\/admin\/?$/.test(path)) return <AdminApp />;
  if (/^\/setup\/?$/.test(path)) return <SetupPage />;
  return <SiteHome />;
}

watchKeyboard();
// Zip 12, "Load games at once" (SPEED_DIRECT_LOAD): on the plain address, both first questions leave now (only while the switch is on).
startEarlyLoads(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
