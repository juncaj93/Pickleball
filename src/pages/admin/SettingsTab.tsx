import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import { parseDollars } from '../../../shared/money';
import { DEFAULT_VENUE_NAME, type GroupSettings, hhmmToMinutes, minutesLabel, minutesToHHMM, SETTING_LIMITS } from '../../../shared/settings';
import { finalPrice } from '../../../shared/pricing';
import { setPretend, api, ApiError, copyText, getTheme, navigate, setTheme, storageGet, storageSet, type ThemeChoice } from '../../lib';
import { ConfirmDialog, Notice, parseWhole, useToast } from '../../ui';
import { formatDateTime, formatTime, localParts } from '../../../shared/time';
import { type Autosave, AutoInput, SaveMark, SaveProblem, useAutosave } from './autosave';
import type { AdminCtx } from '../Admin';

type MoneyKey = 'pricePerPlayerCents' | 'typicalCourtCostCents' | 'monthlyMembershipCents';
type WholeKey = Exclude<keyof GroupSettings, MoneyKey | 'defaultStartMinutes' | 'defaultEndMinutes'>;

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** Number and dollar boxes: the name on the left, a small box on the right. */
/** Enter (or Done on the phone keypad) saves a number box by leaving it. */
const enterLeaves = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.currentTarget.blur();
  }
};
const numberBox = ({ id, value, onChange, onBlur, invalid }: { id: string; value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean }) => (
  <input
    id={id}
    className="set-input"
    type="text"
    inputMode="numeric"
    pattern="[0-9]*"
    enterKeyHint="done"
    autoComplete="off"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={enterLeaves}
    onBlur={onBlur}
    aria-invalid={invalid || undefined}
  />
);
const moneyBox = ({ id, value, onChange, onBlur, invalid }: { id: string; value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean }) => (
  <span className="money-input set-input">
    <span aria-hidden="true">$</span>
    <input
      id={id}
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={enterLeaves}
      onBlur={onBlur}
      aria-invalid={invalid || undefined}
    />
  </span>
);
const textBox =
  (extra: { type?: string; maxLength?: number; placeholder?: string; inputMode?: 'url'; autoComplete?: string; autoCapitalize?: string }) =>
  ({ id, value, onChange, onBlur, invalid }: { id: string; value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean }) => (
    <input id={id} type={extra.type ?? 'text'} {...extra} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={invalid || undefined} />
  );

/** Which collapsed Settings sections are open, remembered on this phone. */
const OPEN_KEY = 'pb_settings_open';
function useOpenSections() {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(storageGet(OPEN_KEY) || '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  function set(id: string, isOpen: boolean) {
    setOpen((cur) => {
      if (cur.has(id) === isOpen) return cur;
      const next = new Set(cur);
      if (isOpen) next.add(id);
      else next.delete(id);
      storageSet(OPEN_KEY, JSON.stringify([...next]));
      return next;
    });
  }
  return { open, set };
}

/** A collapsed section: one 44px row that opens with a tap. */
function Section({
  id,
  title,
  note,
  sections,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  sections: ReturnType<typeof useOpenSections>;
  children: ReactNode;
}) {
  return (
    <details className="set-sect" data-section={id} open={sections.open.has(id)} onToggle={(e) => sections.set(id, e.currentTarget.open)}>
      <summary>
        <span>{title}</span>
        {note && <span className="set-note">{note}</span>}
      </summary>
      <div className="set-body">{children}</div>
    </details>
  );
}

const ADVANCED_SETTINGS: { key: WholeKey; label: string; hint?: string }[] = [
  { key: 'horizonWeeks', label: 'Plan sessions ahead (weeks)' },
  { key: 'bookingLeadDays', label: 'Booking reminder (days before play)' },
  { key: 'defaultDeadlineHours', label: 'Cancellation deadline for new sessions (hours before play)', hint: "Northville's rule: 12" },
];

export function SettingsTab({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const g = ctx.d.group;
  const auto = useAutosave(ctx);
  const [firstDate, setFirstDate] = useState(g.firstSessionDate ?? '');
  const [gameTime, setGameTime] = useState({ defaultStartMinutes: minutesToHHMM(g.settings.defaultStartMinutes), defaultEndMinutes: minutesToHHMM(g.settings.defaultEndMinutes) });
  const [openAccess, setOpenAccess] = useState(g.openAccess);
  const [theme, setThemeChoice] = useState<ThemeChoice>(getTheme);
  const [askRotate, setAskRotate] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sections = useOpenSections();
  const a = ctx.d.alerts;

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

  /** A whole-number setting, checked against its limits. */
  const whole = (key: WholeKey, label: string, hint?: string) => (
    <AutoInput
      key={key}
      auto={auto}
      id={key}
      layout="row"
      label={label}
      hint={hint}
      initial={String(g.settings[key])}
      parse={(t) => parseWhole(t, SETTING_LIMITS[key][0], SETTING_LIMITS[key][1])}
      body={(value) => ({ settings: { [key]: value } })}
      saveOnPause={false}
      input={numberBox}
    />
  );
  /** A dollar setting: "14" or "14.50". */
  const money = (key: MoneyKey, label: string, hint?: string) => (
    <AutoInput
      key={key}
      auto={auto}
      id={key}
      layout="row"
      label={label}
      hint={hint}
      initial={dollars(g.settings[key])}
      parse={(t) => {
        const cents = parseDollars(t);
        if (cents === null || cents > SETTING_LIMITS[key][1]) return { error: 'Enter an amount like 14 or 14.50.' };
        // The price players pay is whole dollars, so the final price and every credit stay whole dollars too.
        if (key === 'pricePerPlayerCents' && cents % 100 !== 0) return { error: 'Enter a whole-dollar amount, like 14.' };
        return { value: cents };
      }}
      body={(value) => ({ settings: { [key]: value } })}
      saveOnPause={false}
      input={moneyBox}
    />
  );
  /** A text setting. Empty saves as "not set", unless it's required. */
  const text = (
    key: 'name' | 'organizerName' | 'venmoUrl' | 'venueName' | 'venueAddress',
    label: string,
    initial: string,
    box: Parameters<typeof textBox>[0],
    opts: { hint?: string; required?: string; check?: (t: string) => string | null } = {},
  ) => (
    <AutoInput
      key={key}
      auto={auto}
      id={key}
      layout="field"
      label={label}
      hint={opts.hint}
      initial={initial}
      parse={(t) => {
        const v = t.trim();
        if (!v && opts.required) return { error: opts.required };
        const bad = v && opts.check ? opts.check(v) : null;
        return bad ? { error: bad } : { value: v || null };
      }}
      body={(value) => ({ [key]: value })}
      input={textBox(box)}
    />
  );

  return (
    <>
      {/* The things used most, in one compact card. */}
      <section className="card set-top" aria-label="Quick settings">
        <div className="set-line">
          <span className="set-label">
            <strong>Player link</strong>
            <code className="set-link">{g.playerLink.replace(/^https?:\/\//, '')}</code>
          </span>
          <button className="btn small" onClick={async () => ((await copyText(g.playerLink)) ? toast('Link copied') : toast("Couldn't copy", 'error'))}>
            Copy
          </button>
        </div>
        <div className="set-line">
          <span className="set-label">
            <strong>Appearance</strong>
          </span>
          <div className="segmented compact" role="group" aria-label="Light or dark">
            {(
              [
                ['system', 'Auto'],
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
        </div>
      </section>

      {/* Every row saves itself; there is no Save button. */}
      <div className="card set-list" role="group" aria-label="Group settings">
        <Section id="group" title="Group" note={g.name} sections={sections}>
          {text('name', 'Group name', g.name, { maxLength: 60 }, { required: 'Enter a group name.' })}
          {text('organizerName', 'Your name', g.organizerName ?? '', { maxLength: 40 })}
          {text('venmoUrl', 'Venmo link', g.venmoUrl ?? '', { type: 'url', inputMode: 'url', placeholder: 'https://venmo.com/u/' }, {
            check: (t) => (/^https?:\/\/\S+\.\S+/.test(t) ? null : 'Enter a full link starting with https://'),
          })}
          {text('venueName', 'Venue name', g.venueName ?? '', { maxLength: 80, placeholder: DEFAULT_VENUE_NAME })}
          {text('venueAddress', 'Venue street address', g.venueAddress ?? '', { maxLength: 160, autoComplete: 'street-address' })}
          {whole('maxPlayers', 'Max players per game', `${SETTING_LIMITS.maxPlayers[0]} to ${SETTING_LIMITS.maxPlayers[1]}. Beyond it, people wait`)}
        </Section>

        <Section id="money" title="Money" note={`$${dollars(g.settings.pricePerPlayerCents)} each`} sections={sections}>
          {money('pricePerPlayerCents', 'Price per player')}
          <p className="set-hint final-rule" data-final-rule>
            Final price = 4 x ${dollars(g.settings.pricePerPlayerCents)} divided by players who played, rounded down. With 5: ${dollars(finalPrice(g.settings.pricePerPlayerCents, 5))}, with 6: $
            {dollars(finalPrice(g.settings.pricePerPlayerCents, 6))}, with 8: ${dollars(finalPrice(g.settings.pricePerPlayerCents, 8))}. The rest comes back as credit.
          </p>
          {money('typicalCourtCostCents', 'Typical court cost', 'Only you see this')}
          {money('monthlyMembershipCents', 'Monthly membership', 'Only you see this')}
        </Section>

        <Section id="schedule" title="Schedule" note={`Tue & Thu ${minutesLabel(g.settings.defaultStartMinutes)}`} sections={sections}>
          <div className="set-row-wrap" data-row="firstSessionDate">
            <div className="set-row">
              <label className="set-label" htmlFor="set-first-date">
                <span className="set-name">
                  First session <SaveMark state={auto.rows.firstSessionDate} />
                </span>
                <span className="set-hint">Nothing before it shows</span>
              </label>
              <input
                id="set-first-date"
                className="set-input wide"
                type="date"
                value={firstDate}
                onChange={(e) => {
                  setFirstDate(e.target.value);
                  // A date saves right away; a cleared box means "no first date".
                  if (!e.target.value || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) void auto.save('firstSessionDate', { firstSessionDate: e.target.value || null });
                }}
              />
            </div>
            <SaveProblem state={auto.rows.firstSessionDate} />
          </div>
          {(['defaultStartMinutes', 'defaultEndMinutes'] as const).map((key) => (
            <div className="set-row-wrap" data-row={key} key={key}>
              <div className="set-row">
                <label className="set-label" htmlFor={`set-${key}`}>
                  <span className="set-name">
                    {key === 'defaultStartMinutes' ? 'Usual start time' : 'Usual end time'} <SaveMark state={auto.rows[key]} />
                  </span>
                  <span className="set-hint">{key === 'defaultStartMinutes' ? 'For new Tue and Thu games only' : 'Existing games keep their times'}</span>
                </label>
                <input
                  id={`set-${key}`}
                  className="set-input wide"
                  type="time"
                  step={300}
                  value={gameTime[key]}
                  onChange={(e) => {
                    const v = e.target.value;
                    const minutes = hhmmToMinutes(v);
                    const oldStart = hhmmToMinutes(gameTime.defaultStartMinutes);
                    const oldEnd = hhmmToMinutes(gameTime.defaultEndMinutes);
                    // A new start moves the end with it, keeping the game the same length (2 hours by default).
                    if (key === 'defaultStartMinutes' && minutes !== null && oldStart !== null && oldEnd !== null && oldEnd > oldStart) {
                      const end = Math.min(minutes + (oldEnd - oldStart), 23 * 60 + 59);
                      setGameTime({ defaultStartMinutes: v, defaultEndMinutes: minutesToHHMM(end) });
                      void auto.save(key, { settings: { defaultStartMinutes: minutes, defaultEndMinutes: end } });
                      return;
                    }
                    setGameTime((cur) => ({ ...cur, [key]: v }));
                    if (minutes !== null) void auto.save(key, { settings: { [key]: minutes } });
                  }}
                />
              </div>
              <SaveProblem state={auto.rows[key]} />
            </div>
          ))}
          {whole('checkInHours', 'Day-before check-in (hours before play)')}
          {whole('lastCallHours', 'Last call (hours before play)')}
        </Section>

        <Section id="access" title="Access" note={g.openAccess ? 'Open' : 'Link only'} sections={sections}>
          <div className="set-row-wrap" data-row="openAccess">
            <label className="check">
              <input
                type="checkbox"
                checked={openAccess}
                onChange={(e) => {
                  setOpenAccess(e.target.checked);
                  void auto.save('openAccess', { openAccess: e.target.checked });
                }}
              />
              <span>
                Anyone with the site address can use it <SaveMark state={auto.rows.openAccess} />
              </span>
            </label>
            <SaveProblem state={auto.rows.openAccess} />
          </div>
          {openAccess && (
            <AutoInput
              auto={auto}
              id="groupWord"
              layout="field"
              label="Group word (optional)"
              hint={g.hasGroupWord ? 'Set. Type to change.' : 'Asked once per phone'}
              initial=""
              parse={(t) => (t.trim().length >= 2 ? { value: t.trim() } : { error: 'The group word needs at least 2 letters.' })}
              body={(value) => ({ groupWord: value })}
              input={textBox({ autoCapitalize: 'none', autoComplete: 'off', maxLength: 40 })}
            />
          )}
          {openAccess && g.hasGroupWord && (
            <button type="button" className="btn small ghost" onClick={() => void auto.save('groupWord', { groupWord: null })}>
              Remove the group word
            </button>
          )}
          {g.openAccess ? (
            <details className="advanced">
              <summary>Old private link</summary>
              <code className="link">{g.privateLink}</code>
              <button type="button" className="btn small ghost" onClick={() => setAskRotate(true)}>
                Replace private link
              </button>
            </details>
          ) : (
            <button type="button" className="btn small ghost" onClick={() => setAskRotate(true)}>
              Replace link
            </button>
          )}
        </Section>

        <Section id="alerts" title="Alerts" note={!a.connected ? 'Not connected' : a.enabled ? 'On' : 'Off'} sections={sections}>
          <AlertsBody ctx={ctx} auto={auto} />
        </Section>

        <Section id="advanced" title="Advanced" sections={sections}>
          {ADVANCED_SETTINGS.map((a) => whole(a.key, a.label, a.hint))}
        </Section>
      </div>

      <div className="card set-list">
        <Section id="pin" title="Change PIN" sections={sections}>
          <form className="stack" onSubmit={changePin}>
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
        </Section>
        <Section id="backup" title="Backup" sections={sections}>
          <a className="btn" href="/api/admin/backup" download>
            Download backup file
          </a>
          <p className="small muted">Has phone numbers. Keep it private.</p>
          <a className="btn secondary" href="/api/admin/export" download="pickleball-export.csv">
            Download CSV
          </a>
        </Section>
      </div>

      <button
        className="btn ghost block"
        onClick={async () => {
          setPretend(null);
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
            toast('New link ready');
          } catch {
            toast("Couldn't replace the link.", 'error');
          }
        }}
        onCancel={() => setAskRotate(false)}
      />
    </>
  );
}

type AlertKey = 'enabled' | 'drop36' | 'belowMin' | 'reachedMin' | 'refundRequests' | 'smartAlerts';
const ALERT_SWITCHES: { key: Exclude<AlertKey, 'enabled'>; label: string }[] = [
  { key: 'drop36', label: 'Someone drops within 36 hours' },
  { key: 'belowMin', label: 'A game falls below 4' },
  { key: 'reachedMin', label: "A game reaches 4 (it's on)" },
  { key: 'refundRequests', label: 'Refund requests' },
  { key: 'smartAlerts', label: 'Smart alerts ("Do this now" reminders)' },
];

/**
 * Settings > Alerts: Telegram messages to the organizer only. The switches
 * save themselves; the token and chat ID live on Cloudflare and never show.
 */
function AlertsBody({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const a = ctx.d.alerts;
  const tz = ctx.d.group.timezone;
  const [on, setOn] = useState<Record<AlertKey, boolean>>({
    enabled: a.enabled,
    drop36: a.drop36,
    belowMin: a.belowMin,
    reachedMin: a.reachedMin,
    refundRequests: a.refundRequests,
    smartAlerts: a.smartAlerts,
  });
  const [smartTest, setSmartTest] = useState<{ status: 'sending' } | { status: 'sent' } | { status: 'failed'; message: string } | null>(null);
  const [test, setTest] = useState<{ status: 'sending' } | { status: 'sent' } | { status: 'failed'; message: string } | null>(null);

  function flip(key: AlertKey, value: boolean) {
    setOn((cur) => ({ ...cur, [key]: value }));
    void auto.save(`alert-${key}`, { [key]: value }, '/api/admin/alerts');
  }

  async function sendTest() {
    setTest({ status: 'sending' });
    try {
      await api('POST', '/api/admin/alerts/test', {});
      setTest({ status: 'sent' });
    } catch (err) {
      setTest({ status: 'failed', message: err instanceof ApiError ? err.message : "Couldn't send the test alert." });
    }
    void ctx.reload();
  }

  async function sendSmartTest() {
    setSmartTest({ status: 'sending' });
    try {
      await api('POST', '/api/admin/alerts/smart-test', {});
      setSmartTest({ status: 'sent' });
    } catch (err) {
      setSmartTest({ status: 'failed', message: err instanceof ApiError ? err.message : "Couldn't send the TEST smart alert." });
    }
    void ctx.reload();
  }

  const sameDay = (iso: string) => {
    const x = localParts(Date.parse(iso), tz);
    const y = localParts(Date.parse(ctx.d.now), tz);
    return x.year === y.year && x.month === y.month && x.day === y.day;
  };
  const last = !a.lastAt
    ? 'No alerts yet'
    : a.lastOk === false
      ? 'Last alert failed'
      : `Last alert: ${sameDay(a.lastAt) ? formatTime(a.lastAt, tz) : formatDateTime(a.lastAt, tz)}`;

  const row = (key: AlertKey, label: string, sub: boolean) => (
    <div className="set-row-wrap" data-row={`alert-${key}`} key={key}>
      <label className={`set-row alert-switch${sub ? ' sub' : ''}`}>
        <span className="set-label">
          <span className="set-name">
            {label} <SaveMark state={auto.rows[`alert-${key}`]} />
          </span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on[key]} disabled={sub && !on.enabled} onChange={(e) => flip(key, e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows[`alert-${key}`]} />
    </div>
  );

  return (
    <>
      <p className="alert-status" data-testid="alert-status">
        <span className={`alert-dot${a.connected ? ' on' : ''}`} aria-hidden="true" />
        <span>
          <strong>{a.connected ? 'Connected' : 'Not connected'}</strong>
          <span className={a.lastOk === false ? 'alert-failed' : undefined}> · {last}</span>
        </span>
      </p>
      {a.lastOk === false && a.lastError && <p className="set-hint alert-why">{a.lastError}</p>}
      {row('enabled', 'Telegram alerts to me', false)}
      <div className="alert-subs">{ALERT_SWITCHES.map((s) => row(s.key, s.label, true))}</div>
      <div className="alert-test">
        <button type="button" className="btn small secondary" onClick={sendTest} disabled={test?.status === 'sending'}>
          {test?.status === 'sending' ? 'Sending…' : 'Send test alert'}
        </button>
        {test?.status === 'sent' && (
          <span className="alert-result ok" role="status">
            ✓ Sent to Telegram
          </span>
        )}
      </div>
      {test?.status === 'failed' && <Notice tone="danger">{test.message}</Notice>}
      <div className="alert-test">
        <button type="button" className="btn small secondary" data-smart-test onClick={sendSmartTest} disabled={smartTest?.status === 'sending' || !on.enabled || !on.smartAlerts}>
          {smartTest?.status === 'sending' ? 'Sending…' : 'Send TEST smart alert'}
        </button>
        {smartTest?.status === 'sent' && (
          <span className="alert-result ok" role="status">
            ✓ Sent to Telegram
          </span>
        )}
      </div>
      {smartTest?.status === 'failed' && <Notice tone="danger">{smartTest.message}</Notice>}
      <p className="set-hint">Only you get these. Player names and game times only (a refund request also says the amount). Smart alerts say what to do next (night before, booking day, after the game), checked every 5 minutes, and stay quiet once you tap the button on Home.</p>
    </>
  );
}
