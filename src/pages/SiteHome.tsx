import { type FormEvent, useEffect, useLayoutEffect, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import { api, ApiError, demoOn, navigate, storageGet, takeEarly, useLoad } from '../lib';
import { clearLastScreen, readLastScreen } from '../lastScreen';
import { ModeButton, TopBar } from '../Shell';
import { CupButton } from '../Champions';
import { hasChampions } from '../../shared/champions';
import { ErrorState, Notice, Spinner } from '../ui';
import { PlayerHome, SavedScreenView } from './PlayerHome';
import { SkinLogo } from '../skin/SkinLogo';
import { resetSkin, useSkin } from '../skin/store';

interface Status {
  setupComplete: boolean;
  setupEnabled: boolean;
  openAccess: boolean;
  wordRequired: boolean;
}

/**
 * The plain site address. When the group is open to anyone it goes straight
 * to "Who are you?" (or "Welcome, Ryan"), after a one-time group word if one
 * is set. Link-only groups get a short "open your link" screen.
 */
export function SiteHome() {
  // "Load games at once" (SPEED_DIRECT_LOAD, src/lib.ts): the first answer may already be on its way.
  const status = useLoad(() => takeEarly<Status>('status') ?? api<Status>('GET', '/api/status'));
  const s = status.data;
  // "Show last screen at once" (src/lastScreen.ts): this phone's saved copy of the games, buttons held, while the checks run.
  const [saved] = useState(() => (demoOn() ? null : readLastScreen('plain')));
  // Not the games (not set up, link only, a group word): an early games answer is dropped, and a saved copy never shows here again.
  const notGames = !!s && (!s.setupComplete || !s.openAccess || s.wordRequired);
  useEffect(() => {
    if (!notGames) return;
    void takeEarly('group')?.catch(() => {});
    clearLastScreen();
  }, [notGames]);
  // Zip 102: while the first checks run, the header and the saved copy wear what this phone started from (public/theme-2.js: the Christmas logo,
  // and the theme if it was on). Not the games after all (not set up, link only, a group word, an error): plain, before that screen paints.
  const skin = useSkin();
  const skinLogo = skin.mode !== 'off' ? <SkinLogo /> : undefined;
  const notHome = notGames || !!status.error;
  useLayoutEffect(() => {
    if (notHome) resetSkin();
  }, [notHome]);
  if (status.loading && !s && saved && saved.view.sessions.length > 0) {
    return (
      <>
        <TopBar
          skinLogo={skinLogo}
          eyebrow={saved.view.group.name}
          title={saved.view.me!.name}
          // Zip 83: the saved copy's cup too (its medal counts), so the header does not move when the real screen comes.
          tools={
            <>
              {hasChampions(saved.view.tourAwards?.medals) && <CupButton path="/api/tournament/champions" held />}
              <ModeButton preview={false} />
            </>
          }
        />
        <main className="page stack-lg">
          <SavedScreenView saved={saved} />
        </main>
      </>
    );
  }
  if (status.loading && !s) {
    return (
      <>
        <TopBar skinLogo={skinLogo} eyebrow={SITE_NAME} title={SITE_NAME} />
        <Spinner />
      </>
    );
  }
  if (status.error || !s) {
    return (
      <>
        <TopBar eyebrow={SITE_NAME} title={SITE_NAME} />
        <main className="page">{status.error && <ErrorState error={status.error} onRetry={status.reload} />}</main>
      </>
    );
  }
  if (!s.setupComplete) return <NotSetUp />;
  if (!s.openAccess) return <LinkOnly />;
  if (s.wordRequired) return <GroupWord onDone={status.reload} />;
  return <PlayerHome groupKey={null} plain onLinkOnly={status.reload} onWordNeeded={status.reload} />;
}

export function OrganizerLink() {
  return (
    <p className="organizer-link">
      <a
        href="/admin"
        onClick={(e) => {
          e.preventDefault();
          navigate('/admin');
        }}
      >
        Organizer sign-in
      </a>
    </p>
  );
}

function NotSetUp() {
  return (
    <>
      <TopBar eyebrow={SITE_NAME} title="Welcome" />
      <main className="page stack-lg">
        <div className="hero stack">
          <div className="big-ball" aria-hidden="true" />
          <p className="muted">Nobody has set up this site yet. The organizer starts here.</p>
          <button className="btn block" onClick={() => navigate('/setup')}>
            Set up the group
          </button>
        </div>
      </main>
    </>
  );
}

function LinkOnly() {
  const lastGroup = storageGet('pb_group_key');
  return (
    <>
      <TopBar eyebrow={SITE_NAME} title={SITE_NAME} />
      <main className="page stack-lg">
        <p className="muted">Open the link your organizer sent you to see the schedule.</p>
        {lastGroup && (
          <button className="btn block" onClick={() => navigate(`/g/${lastGroup}`)}>
            Open my group
          </button>
        )}
        <OrganizerLink />
      </main>
    </>
  );
}

/** Asked once per phone when the organizer set a group word. */
function GroupWord({ onDone }: { onDone: () => void }) {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/access', { word });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <TopBar eyebrow={SITE_NAME} title="Group word" />
      <main className="page stack-lg">
        <form className="stack" onSubmit={submit}>
          <label className="field">
            What’s the group word?
            <span className="hint">You only need it once on this phone. Ask in the group chat if you don’t know it.</span>
            <input type="text" value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="none" autoComplete="off" maxLength={40} autoFocus required />
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button className="btn block" type="submit" disabled={busy || !word.trim()}>
            Continue
          </button>
        </form>
        <OrganizerLink />
      </main>
    </>
  );
}
