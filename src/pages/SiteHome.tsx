import { type FormEvent, useState } from 'react';
import { api, ApiError, navigate, storageGet, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { ErrorState, Notice, Spinner } from '../ui';
import { PlayerHome } from './PlayerHome';

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
  const status = useLoad(() => api<Status>('GET', '/api/status'));
  const s = status.data;
  if (status.loading && !s) {
    return (
      <>
        <TopBar eyebrow="Pickleball" title="Pickleball" />
        <Spinner />
      </>
    );
  }
  if (status.error || !s) {
    return (
      <>
        <TopBar eyebrow="Pickleball" title="Pickleball" />
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
      <TopBar eyebrow="Pickleball" title="Welcome" />
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
      <TopBar eyebrow="Pickleball" title="Pickleball" />
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
      <TopBar eyebrow="Pickleball" title="Group word" />
      <main className="page stack-lg">
        <form className="stack" onSubmit={submit}>
          <label className="field">
            What's the group word?
            <span className="hint">You only need it once on this phone. Ask in the group chat if you don't know it.</span>
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
