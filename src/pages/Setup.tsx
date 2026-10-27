import { type FormEvent, useState } from 'react';
import { api, ApiError, copyText, navigate } from '../lib';
import { TopBar } from '../Shell';
import { Notice, NumberField, parseWhole, useToast } from '../ui';

interface PlayerDraft {
  name: string;
  phone: string;
}

export function SetupPage() {
  const toast = useToast();
  const [setupToken, setSetupToken] = useState('');
  const [groupName, setGroupName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [venmoUrl, setVenmoUrl] = useState('');
  const [horizonWeeks, setHorizonWeeks] = useState('6');
  const [horizonError, setHorizonError] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerDraft[]>(Array.from({ length: 6 }, () => ({ name: '', phone: '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const setPlayer = (i: number, patch: Partial<PlayerDraft>) =>
    setPlayers((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin !== pin2) return setError("The two PINs don't match.");
    const filled = players.filter((p) => p.name.trim());
    if (filled.length === 0) return setError('Add at least one player.');
    const weeks = parseWhole(horizonWeeks, 1, 12);
    setHorizonError('error' in weeks ? weeks.error : null);
    if ('error' in weeks) return setError('Check the number of weeks.');
    setBusy(true);
    try {
      const res = await api<{ playerLink: string }>('POST', '/api/setup', {
        setupToken,
        groupName,
        timezone: 'America/Detroit',
        pin,
        venmoUrl: venmoUrl || null,
        horizonWeeks: weeks.value,
        players: filled.map((p) => ({ name: p.name, phone: p.phone || null })),
      });
      setDone(res.playerLink);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <TopBar eyebrow="Setup complete" title={groupName || 'Your group'} />
        <main className="page stack-lg">
          <div className="card stack">
            <h2>Share this link with your players</h2>
            <p className="muted">Anyone with this link can see the schedule and pick a name, so share it only with the group.</p>
            <code className="link">{done}</code>
            <button className="btn" onClick={async () => toast((await copyText(done)) ? 'Link copied' : "Couldn't copy")}>
              Copy player link
            </button>
          </div>
          <button className="btn block" onClick={() => navigate('/admin')}>
            Go to the organizer dashboard
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar eyebrow="First-time setup" title="Set up your group" />
      <main className="page">
        <form className="stack-lg" onSubmit={submit} noValidate>
          <div className="card stack">
            <label className="field">
              Setup code
              <span className="hint">The SETUP_TOKEN secret you saved in Cloudflare. Only needed once.</span>
              <input type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" required />
            </label>
            <label className="field">
              Group name
              <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={60} required placeholder="Tuesday/Thursday Pickleball" />
            </label>
            <p className="small muted">Sessions: every Tuesday and Thursday, 8:00–10:00 PM Eastern time.</p>
            <NumberField label="Plan sessions this many weeks ahead" value={horizonWeeks} onChange={setHorizonWeeks} error={horizonError} />
          </div>

          <div className="card stack">
            <h2>Organizer PIN</h2>
            <p className="small muted">6 to 12 digits. Only you use it. It's stored scrambled (hashed), so nobody can read it back, including you.</p>
            <label className="field">
              PIN
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} maxLength={12} required />
            </label>
            <label className="field">
              PIN again
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} maxLength={12} required />
            </label>
          </div>

          <div className="card stack">
            <h2>Payments</h2>
            <label className="field">
              Your Venmo link (optional)
              <span className="hint">For example https://venmo.com/u/your-name. Players tap it to pay you.</span>
              <input type="url" inputMode="url" value={venmoUrl} onChange={(e) => setVenmoUrl(e.target.value)} placeholder="https://venmo.com/u/" />
            </label>
          </div>

          <div className="card stack">
            <h2>Players</h2>
            <p className="small muted">
              Phone numbers are optional and only used to prefill texts you send. Add one only if that player agreed to get reminder texts.
            </p>
            {players.map((p, i) => (
              <fieldset key={i} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="section-title" style={{ margin: '0 0 6px' }}>
                  Player {i + 1}
                </legend>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <label className="sr-only" htmlFor={`pn-${i}`}>
                    Player {i + 1} name
                  </label>
                  <input id={`pn-${i}`} type="text" placeholder="Name" value={p.name} maxLength={40} onChange={(e) => setPlayer(i, { name: e.target.value })} />
                  <label className="sr-only" htmlFor={`pp-${i}`}>
                    Player {i + 1} phone
                  </label>
                  <input id={`pp-${i}`} type="tel" placeholder="Phone (optional)" value={p.phone} maxLength={25} onChange={(e) => setPlayer(i, { phone: e.target.value })} />
                </div>
              </fieldset>
            ))}
            <button type="button" className="btn secondary" onClick={() => setPlayers((ps) => [...ps, { name: '', phone: '' }])} disabled={players.length >= 20}>
              Add another player
            </button>
          </div>

          {error && (
            <Notice tone="danger" title="Can't finish setup">
              {error}
            </Notice>
          )}
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Setting up…' : 'Create group'}
          </button>
        </form>
      </main>
    </>
  );
}
