import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { usePath } from './lib';
import { ToastProvider } from './ui';
import { SetupPage } from './pages/Setup';
import { PlayerHome } from './pages/PlayerHome';
import { SiteHome } from './pages/SiteHome';
import { LinkPage } from './pages/LinkPage';
import { AdminApp } from './pages/Admin';

function App() {
  const path = usePath();
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/g\/([A-Za-z0-9_-]+)\/?$/))) return <PlayerHome groupKey={m[1]} />;
  if ((m = path.match(/^\/t\/([A-Za-z0-9_-]+)\/?$/))) return <LinkPage token={m[1]} />;
  if (/^\/admin\/?$/.test(path)) return <AdminApp />;
  if (/^\/setup\/?$/.test(path)) return <SetupPage />;
  return <SiteHome />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
