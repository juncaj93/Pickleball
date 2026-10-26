import { type FormEvent, useState } from 'react';
import { type GroupSettings, SETTING_LIMITS } from '../../../shared/settings';
import { formatDateTime, TIMEZONE_OPTIONS } from '../../../shared/time';
import { api, ApiError, copyText, getTheme, navigate, setTheme, type ThemeChoice } from '../../lib';
import { ConfirmDialog, Notice, NumberField, parseWhole, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';

const MAIN_SETTING = {
  key: 'checkInHours' as const,
  label: 'Day-before check-in (hours before play)',
  hint: 'When check-in texts and the "short on players" warning start.',
};

const ADVANCED_SETTINGS: { key: keyof GroupSettings; label: string; hint?: string }[] = [
  { key: 'horizonWeeks', label: 'Plan sessions ahead (weeks)' },
  { key: 'bookingLeadDays', label: 'Booking reminder (days before play)' },
  { key: 'defaultDeadlineHours', label: 'Cancellation deadline for new sessions (hours before play)', hint: "Northville's rule is 12. You can change it on any booking." },
];

const ACTION_TEXT: Record<string, string> = {
  booking_updated: 'Booking changed',
  session_canceled: 'Session canceled',
  session_reopened: 'Session reopened',
  decision_keep: 'Kept session as is',
  decision_try_fill: 'Chose to try to fill',
  marked_paid: 'Marked paid',
  marked_unpaid: 'Marked unpaid',
  player_added: 'Player added',
  player_updated: 'Player edited',
  settings_updated: 'Settings changed',
  session_rescheduled: 'Session moved',
  pin_changed: 'PIN changed',
  player_link_rotated: 'Player link replaced',
  roster_confirm: 'Gave a spot',
  roster_waitlist: 'Moved to waitlist',
  roster_withdraw: 'Removed from session',
  roster_confirm_attendance: 'Marked as coming',
};

export function SettingsTab({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const g = ctx.d.group;
  const tz = g.timezone;
  const [name, setName] = useState(g.name);
  const [venmo, setVenmo] = useState(g.venmoUrl ?? '');
  const [nums, setNums] = useState<Record<keyof GroupSettings, string>>(
    () => Object.fromEntries(Object.entries(g.settings).map(([k, v]) => [k, String(v)])) as Record<keyof GroupSettings, string>,
  );
  const [numErrors, setNumErrors] = useState<Partial<Record<keyof GroupSettings, string>>>({});
  const [theme, setThemeChoice] = useState<ThemeChoice>(getTheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askRotate, setAskRotate] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Number fields are only checked here, on Save, never while typing.
    const errors: Partial<Record<keyof GroupSettings, string>> = {};
    const settings = {} as GroupSettings;
    for (const k of Object.keys(nums) as (keyof GroupSettings)[]) {
      const r = parseWhole(nums[k], SETTING_LIMITS[k][0], SETTING_LIMITS[k][1]);
      if ('error' in r) errors[k] = r.error;
      else settings[k] = r.value;
    }
    setNumErrors(errors);
    if (Object.keys(errors).length) return setError('Fix the highlighted numbers, then save.');
    setBusy(true);
    try {
      await api('PUT', '/api/admin/group', { name, venmoUrl: venmo || null, settings });
      toast('Settings saved');
      await ctx.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function changePin(e: FormEvent) {
    e.preventDefault();
    setPinMsg(null);
    try {
      await api('POST', '/api/admin/pin', { currentPin: curPin, newPin });
      setPinMsg({ ok: true, text: 'PIN changed. Other signed-in devices were signed out.' });
      setCurPin('');
      setNewPin('');
    } catch (err) {
      setPinMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not change PIN.' });
    }
  }

  return (
    <>
      <section className="card stack" aria-labelledby="link-title">
        <h2 id="link-title">Player link</h2>
        <p className="small muted">Send this to your players. Anyone with it can see the schedule, so keep it in the group.</p>
        <code className="link">{g.playerLink}</code>
        <div className="btn-row">
          <button className="btn small" onClick={async () => toast((await copyText(g.playerLink)) ? 'Link copied' : "Couldn't copy")}>
            Copy link
          </button>
          <button className="btn small ghost" onClick={() => setAskRotate(true)}>
            Replace link
          </button>
        </div>
      </section>

      <form className="card stack" onSubmit={save}>
        <h2>Group</h2>
        <label className="field">
          Group name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <label className="field">
          Venmo link
          <input type="url" inputMode="url" value={venmo} onChange={(e) => setVenmo(e.target.value)} placeholder="https://venmo.com/u/" />
        </label>
        <p className="small muted">
          Time zone: {TIMEZONE_OPTIONS.find((o) => o.value === tz)?.label ?? tz}. Sessions are Tuesdays and Thursdays, 8:00–10:00 PM.
        </p>
        <NumberField
          label={MAIN_SETTING.label}
          hint={MAIN_SETTING.hint}
          value={nums[MAIN_SETTING.key]}
          onChange={(v) => setNums((n) => ({ ...n, [MAIN_SETTING.key]: v }))}
          error={numErrors[MAIN_SETTING.key]}
        />
        <details className="advanced" open={ADVANCED_SETTINGS.some((a) => numErrors[a.key]) || undefined}>
          <summary>Advanced</summary>
          <div className="stack">
            {ADVANCED_SETTINGS.map((a) => (
              <NumberField
                key={a.key}
                label={a.label}
                hint={a.hint}
                value={nums[a.key]}
                onChange={(v) => setNums((n) => ({ ...n, [a.key]: v }))}
                error={numErrors[a.key]}
              />
            ))}
          </div>
        </details>
        {error && <Notice tone="danger">{error}</Notice>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      <section className="card stack" aria-labelledby="look-title">
        <h2 id="look-title">Appearance</h2>
        <div className="segmented" role="group" aria-label="Light or dark">
          {(
            [
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              aria-pressed={theme === v}
              onClick={() => {
                setTheme(v);
                setThemeChoice(v);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="small muted">System follows your phone's setting. Saved on this phone only.</p>
      </section>

      <form className="card stack" onSubmit={changePin}>
        <h2>Change PIN</h2>
        <label className="field">
          Current PIN
          <input type="password" inputMode="numeric" autoComplete="current-password" value={curPin} onChange={(e) => setCurPin(e.target.value.replace(/\D/g, ''))} maxLength={12} />
        </label>
        <label className="field">
          New PIN (6–12 digits)
          <input type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} maxLength={12} />
        </label>
        {pinMsg && <Notice tone={pinMsg.ok ? 'ok' : 'danger'}>{pinMsg.text}</Notice>}
        <button className="btn secondary" type="submit" disabled={curPin.length < 6 || newPin.length < 6}>
          Change PIN
        </button>
      </form>

      <section className="card stack">
        <h2>Backup</h2>
        <p className="small muted">Download every session, player status, and payment as a spreadsheet file (CSV).</p>
        <a className="btn secondary" href="/api/admin/export" download="pickleball-export.csv">
          Download CSV
        </a>
      </section>

      <section className="card stack">
        <h2>How this works</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Texts are never sent automatically. The site writes each message; you review it and press send in your phone's Messages app.</li>
          <li>Alerts only appear when you open this page. Nothing pings your phone in the background.</li>
          <li>Times are shown in Eastern time.</li>
          <li>Payments are marked by you after you check Venmo. Nothing connects to Venmo or a bank.</li>
          <li>The PIN and private link are light protection for a friend group, not bank-grade security.</li>
        </ul>
      </section>

      <section className="card stack" aria-labelledby="audit-title">
        <h2 id="audit-title">Recent changes</h2>
        {ctx.d.audit.length === 0 ? (
          <p className="muted">No changes yet.</p>
        ) : (
          <ul className="list small">
            {ctx.d.audit.slice(0, 30).map((a) => (
              <li key={a.id}>
                <strong>{ACTION_TEXT[a.action] ?? a.action}</strong>
                {typeof a.details.player === 'string' ? ` · ${a.details.player}` : ''}
                {typeof a.details.name === 'string' ? ` · ${a.details.name}` : ''}
                <div className="muted">{formatDateTime(a.createdAt, tz)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        className="btn ghost block"
        onClick={async () => {
          await api('POST', '/api/admin/logout', {}).catch(() => {});
          navigate('/');
        }}
      >
        Sign out
      </button>

      <ConfirmDialog
        open={askRotate}
        title="Replace the player link?"
        body="The old link stops working right away. You'll need to send everyone the new one."
        confirmLabel="Replace link"
        danger
        onConfirm={async () => {
          setAskRotate(false);
          try {
            await api('POST', '/api/admin/rotate-link', {});
            await ctx.reload();
            toast('New link ready. Copy and share it.');
          } catch {
            toast("Couldn't replace the link.");
          }
        }}
        onCancel={() => setAskRotate(false)}
      />
    </>
  );
}
