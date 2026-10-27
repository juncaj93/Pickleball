import { type FormEvent, type ReactNode, useState } from 'react';
import { parseDollars } from '../../../shared/money';
import { DEFAULT_VENUE_NAME, type GroupSettings, SETTING_LIMITS } from '../../../shared/settings';
import { formatDateTime, TIMEZONE_OPTIONS } from '../../../shared/time';
import { api, ApiError, copyText, getTheme, navigate, setTheme, storageGet, storageSet, type ThemeChoice } from '../../lib';
import { ConfirmDialog, Notice, NumberField, parseWhole, useToast } from '../../ui';
import { HomeScreenSteps, SubscribeBlock } from '../PlayerHome';
import { MonthlyMoneyPage } from './MonthlyMoney';
import type { AdminCtx } from '../Admin';

type MoneyKey = 'pricePerPlayerCents' | 'creditCentsWhenSix' | 'typicalCourtCostCents' | 'monthlyMembershipCents';
type WholeKey = Exclude<keyof GroupSettings, MoneyKey>;

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** A dollar amount: label on the left, "$ 14" on the right, decimal keypad, checked on Save. */
function MoneyField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <div className="set-row-wrap">
      <label className="set-row">
        <span className="set-label">
          {label}
          {hint && <span className="set-hint">{hint}</span>}
        </span>
        <span className="money-input set-input">
          <span aria-hidden="true">$</span>
          <input type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
        </span>
      </label>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

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

/** Which section each number lives in, so a bad value opens its section on Save. */
const SECTION_OF: Record<keyof GroupSettings, string> = {
  pricePerPlayerCents: 'money',
  creditCentsWhenSix: 'money',
  typicalCourtCostCents: 'money',
  monthlyMembershipCents: 'money',
  checkInHours: 'schedule',
  lastCallHours: 'schedule',
  horizonWeeks: 'advanced',
  bookingLeadDays: 'advanced',
  defaultDeadlineHours: 'advanced',
};

const ADVANCED_SETTINGS: { key: WholeKey; label: string; hint?: string }[] = [
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
  credit_cleared: 'Credit cleared',
  six_drop_sorted: 'Sorted out the drop below 6',
  player_self_added: 'Added their own name',
  player_hidden: 'Name hidden',
  player_deleted: 'Name deleted',
  as_player_join: 'As player: joined',
  as_player_withdraw: 'As player: dropped out',
  as_player_check_in: 'As player: checked in',
  as_player_decline: 'As player: said no',
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
  const [nums, setNums] = useState<Record<WholeKey, string>>(() => ({
    horizonWeeks: String(g.settings.horizonWeeks),
    bookingLeadDays: String(g.settings.bookingLeadDays),
    checkInHours: String(g.settings.checkInHours),
    defaultDeadlineHours: String(g.settings.defaultDeadlineHours),
    lastCallHours: String(g.settings.lastCallHours),
  }));
  const [money, setMoney] = useState<Record<MoneyKey, string>>(() => ({
    pricePerPlayerCents: dollars(g.settings.pricePerPlayerCents),
    creditCentsWhenSix: dollars(g.settings.creditCentsWhenSix),
    typicalCourtCostCents: dollars(g.settings.typicalCourtCostCents),
    monthlyMembershipCents: dollars(g.settings.monthlyMembershipCents),
  }));
  const [moneyPage, setMoneyPage] = useState(false);
  const [numErrors, setNumErrors] = useState<Partial<Record<keyof GroupSettings, string>>>({});
  const [organizerName, setOrganizerName] = useState(g.organizerName ?? '');
  const [venueName, setVenueName] = useState(g.venueName ?? '');
  const [venueAddress, setVenueAddress] = useState(g.venueAddress ?? '');
  const [firstDate, setFirstDate] = useState(g.firstSessionDate ?? '');
  const [openAccess, setOpenAccess] = useState(g.openAccess);
  const [groupWord, setGroupWord] = useState('');
  const [removeWord, setRemoveWord] = useState(false);
  const [theme, setThemeChoice] = useState<ThemeChoice>(getTheme);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askRotate, setAskRotate] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sections = useOpenSections();

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Number fields are only checked here, on Save, never while typing.
    const errors: Partial<Record<keyof GroupSettings, string>> = {};
    const settings = {} as GroupSettings;
    for (const k of Object.keys(nums) as WholeKey[]) {
      const r = parseWhole(nums[k], SETTING_LIMITS[k][0], SETTING_LIMITS[k][1]);
      if ('error' in r) errors[k] = r.error;
      else settings[k] = r.value;
    }
    for (const k of Object.keys(money) as MoneyKey[]) {
      const cents = parseDollars(money[k]);
      if (cents === null || cents > SETTING_LIMITS[k][1]) errors[k] = 'Enter an amount like 14 or 14.50.';
      else settings[k] = cents;
    }
    setNumErrors(errors);
    for (const k of Object.keys(errors) as (keyof GroupSettings)[]) sections.set(SECTION_OF[k], true);
    if (Object.keys(errors).length) return setError('Fix the highlighted numbers, then save.');
    setBusy(true);
    try {
      await api('PUT', '/api/admin/group', {
        name,
        venmoUrl: venmo || null,
        settings,
        organizerName: organizerName || null,
        venueName: venueName || null,
        venueAddress: venueAddress || null,
        firstSessionDate: firstDate || null,
        openAccess,
        // Leave the word alone unless a new one was typed or Remove was tapped.
        ...(groupWord.trim() ? { groupWord: groupWord.trim() } : removeWord ? { groupWord: null } : {}),
      });
      setGroupWord('');
      setRemoveWord(false);
      await ctx.reload();
      toast('Saved');
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

  if (moneyPage) return <MonthlyMoneyPage ctx={ctx} onBack={() => setMoneyPage(false)} />;

  const tzLabel = TIMEZONE_OPTIONS.find((o) => o.value === tz)?.label ?? tz;
  return (
    <>
      {/* The things used most, in one compact card. */}
      <section className="card set-top" aria-label="Quick settings">
        <div className="set-line">
          <span className="set-label">
            <strong>Monthly money</strong>
            <span className="set-hint">Only you see it</span>
          </span>
          <button
            className="btn small"
            onClick={() => {
              setMoneyPage(true);
              window.scrollTo(0, 0);
            }}
          >
            Open
          </button>
        </div>
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
        </div>
      </section>

      <form className="card set-list" onSubmit={save} aria-label="Group settings">
        <Section id="group" title="Group" note={g.name} sections={sections}>
          <label className="field">
            Group name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>
          <label className="field">
            Your name
            <span className="hint">Players see it, like "Robin confirms when it arrives."</span>
            <input type="text" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} maxLength={40} />
          </label>
          <label className="field">
            Venmo link
            <input type="url" inputMode="url" value={venmo} onChange={(e) => setVenmo(e.target.value)} placeholder="https://venmo.com/u/" />
          </label>
          <label className="field">
            Venue name
            <input type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} maxLength={80} placeholder={DEFAULT_VENUE_NAME} />
          </label>
          <label className="field">
            Venue street address
            <input type="text" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} maxLength={160} autoComplete="street-address" />
          </label>
          <p className="set-hint">Time zone: {tzLabel}. Tuesdays and Thursdays, 8:00 to 10:00 PM.</p>
        </Section>

        <Section id="money" title="Money" note={`$${money.pricePerPlayerCents} each`} sections={sections}>
          <MoneyField label="Price per player" value={money.pricePerPlayerCents} onChange={(v) => setMoney((m) => ({ ...m, pricePerPlayerCents: v }))} error={numErrors.pricePerPlayerCents} />
          <MoneyField
            label="Credit per person when 6 play"
            value={money.creditCentsWhenSix}
            onChange={(v) => setMoney((m) => ({ ...m, creditCentsWhenSix: v }))}
            error={numErrors.creditCentsWhenSix}
          />
          <MoneyField
            label="Typical court cost"
            hint="Only you see this"
            value={money.typicalCourtCostCents}
            onChange={(v) => setMoney((m) => ({ ...m, typicalCourtCostCents: v }))}
            error={numErrors.typicalCourtCostCents}
          />
          <MoneyField
            label="Monthly membership"
            hint="Only you see this"
            value={money.monthlyMembershipCents}
            onChange={(v) => setMoney((m) => ({ ...m, monthlyMembershipCents: v }))}
            error={numErrors.monthlyMembershipCents}
          />
        </Section>

        <Section id="schedule" title="Schedule" sections={sections}>
          <label className="set-row">
            <span className="set-label">
              First session
              <span className="set-hint">Nothing before it shows</span>
            </span>
            <input className="set-input wide" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} />
          </label>
          <NumberField
            compact
            label="Day-before check-in (hours before play)"
            value={nums.checkInHours}
            onChange={(v) => setNums((n) => ({ ...n, checkInHours: v }))}
            error={numErrors.checkInHours}
          />
          <NumberField
            compact
            label="Last call (hours before play)"
            value={nums.lastCallHours}
            onChange={(v) => setNums((n) => ({ ...n, lastCallHours: v }))}
            error={numErrors.lastCallHours}
          />
        </Section>

        <Section id="access" title="Access" note={openAccess ? 'Open' : 'Link only'} sections={sections}>
          <label className="check">
            <input type="checkbox" checked={openAccess} onChange={(e) => setOpenAccess(e.target.checked)} />
            Anyone with the site address can use it
          </label>
          {openAccess && (
            <label className="field">
              Group word (optional)
              <span className="hint">{g.hasGroupWord && !removeWord ? 'One is set. Type a new one to change it.' : 'A new phone is asked for it once.'}</span>
              <input type="text" value={groupWord} onChange={(e) => setGroupWord(e.target.value)} autoCapitalize="none" autoComplete="off" maxLength={40} />
            </label>
          )}
          {openAccess && g.hasGroupWord && !removeWord && (
            <button type="button" className="btn small ghost" onClick={() => setRemoveWord(true)}>
              Remove the group word
            </button>
          )}
          {removeWord && <p className="small">The group word will be removed when you save.</p>}
          {g.openAccess ? (
            <details className="advanced">
              <summary>Old private link</summary>
              <p className="small muted">Still works for anyone who has it.</p>
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

        <Section id="advanced" title="Advanced" sections={sections}>
          {ADVANCED_SETTINGS.map((a) => (
            <NumberField compact key={a.key} label={a.label} value={nums[a.key]} onChange={(v) => setNums((n) => ({ ...n, [a.key]: v }))} error={numErrors[a.key]} />
          ))}
        </Section>

        {error && <Notice tone="danger">{error}</Notice>}
        <div className="set-save">
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>

      <div className="card set-list">
        <Section id="calendar" title="Calendar" sections={sections}>
          <p className="set-hint">Every session, with cancellations and time changes. Players get their own link at the bottom of their screen; turn a person's off under Players.</p>
          <OrganizerSubscribe />
        </Section>
        <Section id="a2hs" title="Add to Home Screen" sections={sections}>
          <p className="set-hint">On iPhone, in Safari:</p>
          <HomeScreenSteps />
        </Section>
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
          <p className="set-hint">Every session, player status and payment as a spreadsheet file (CSV).</p>
          <a className="btn secondary" href="/api/admin/export" download="pickleball-export.csv">
            Download CSV
          </a>
        </Section>
        <Section id="audit" title="Recent changes" sections={sections}>
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
        </Section>
      </div>

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

function OrganizerSubscribe() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await api<{ webcal: string }>('GET', '/api/admin/calendar');
      window.location.href = res.webcal;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't make the calendar link.", 'error');
    } finally {
      setBusy(false);
    }
  }
  return <SubscribeBlock busy={busy} onTap={go} />;
}
