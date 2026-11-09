import { type FormEvent, type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { flushHolds } from '../../undoHold';
import { clearLastAdmin, signedOutLastAdmin } from '../../lastAdmin';
import { parseDollars } from '../../../shared/money';
import { UNPAID_LIMIT } from '../../../shared/unpaidNudge';
import { DEFAULT_VENUE_NAME, DEFAULT_ZELLE_NUMBER, type GroupSettings, hhmmToMinutes, minutesLabel, minutesToHHMM, SETTING_LIMITS } from '../../../shared/settings';
import { finalPrice } from '../../../shared/pricing';
import { setPretend, api, ApiError, copyText, getTheme, navigate, setTheme, storageGet, storageSet, type ThemeChoice, VIEW_ONLY_MESSAGE } from '../../lib';
import { ConfirmDialog, Notice, parseWhole, Sheet, useToast } from '../../ui';
import { formatDateTime, formatShortDate, formatTime, localParts } from '../../../shared/time';
import { type Autosave, AutoInput, SaveMark, SaveProblem, useAutosave } from './autosave';
import type { AdminCtx } from '../Admin';
import { useInstant } from '../../InstantTaps';
import '../../money-rework.css';

type MoneyKey = 'pricePerPlayerCents' | 'typicalCourtCostCents' | 'monthlyMembershipCents';
type WholeKey = Exclude<keyof GroupSettings, MoneyKey | 'defaultStartMinutes' | 'defaultEndMinutes' | 'shortGames' | 'noCap'>;

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
  (extra: { type?: string; maxLength?: number; placeholder?: string; inputMode?: 'url' | 'tel'; autoComplete?: string; autoCapitalize?: string }) =>
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
  // Instant taps (INSTANT_TAPS): what the server last confirmed, so a failed save goes back to exactly that (two quick failing flips
  // cannot leave the screen wrong), and a second flip of the access box while it saves is ignored. Off: unused.
  const confirmedAccess = useRef(g.openAccess);
  const savingAccess = useRef(false);
  const confirmedDate = useRef(g.firstSessionDate ?? '');
  const latestDate = useRef(g.firstSessionDate ?? '');
  const [openAccess, setOpenAccess] = useState(g.openAccess);
  const [theme, setThemeChoice] = useState<ThemeChoice>(getTheme);
  const [askRotate, setAskRotate] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sections = useOpenSections();
  const a = ctx.d.alerts;
  // Admin screens, round 3 (ADMIN_R3): Appearance and First session date are gone, the two switch rows moved into Feature
  // switches, Access and Change PIN moved into Advanced. Same settings, same saves; only where they are shown changes.
  const r3 = ctx.d.adminR3 === true;

  async function changePin(e: FormEvent) {
    e.preventDefault();
    setPinMsg(null);
    try {
      await api('POST', '/api/admin/pin', { currentPin: curPin, newPin });
      // Zip 12 step C: a new PIN throws this phone's saved organizer screen away (src/lastAdmin.ts).
      clearLastAdmin();
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
    key: 'name' | 'organizerName' | 'venmoUrl' | 'venueName' | 'venueAddress' | 'zelleNumber',
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

  // Access and Change PIN: one body each, shown as their own section (as before) or, with round 3, inside Advanced.
  const accessBody = (
    <>
    <div className="set-row-wrap" data-row="openAccess">
      <label className="check">
        <input
          type="checkbox"
          checked={openAccess}
          onChange={(e) => {
            const next = e.target.checked;
            if (auto.instant && savingAccess.current) return;
            setOpenAccess(next);
            if (!auto.instant) return void auto.save('openAccess', { openAccess: next });
            // Instant taps (INSTANT_TAPS): a failed save (any reason) puts the box back where the server has it.
            savingAccess.current = true;
            void auto.save('openAccess', { openAccess: next }).then((ok) => {
              savingAccess.current = false;
              if (ok) return void (confirmedAccess.current = next);
              setOpenAccess(confirmedAccess.current);
              auto.clear('openAccess');
              if (ctx.d.viewOnly === true) toast(VIEW_ONLY_MESSAGE);
              else toast("That didn't save. It's back to what it was.", 'error');
            });
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
    </>
  );
  const pinBody = (
    <>
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
    </>
  );

  return (
    <>
      {/* The things used most, in one compact card. */}
      {/* Round 3 (ADMIN_R3): this card (Player link + Copy, and the Appearance row) is gone, so the page starts with the settings. */}
      {!r3 && (
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
          {!r3 && (
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
          )}
        </section>
      )}

      {/* Every row saves itself; there is no Save button. */}
      <div className="card set-list" role="group" aria-label="Group settings">
        <Section id="group" title="Group" note={g.name} sections={sections}>
          {text('name', 'Group name', g.name, { maxLength: 60 }, { required: 'Enter a group name.' })}
          {text('organizerName', 'Your name', g.organizerName ?? '', { maxLength: 40 })}
          {/* Round 2 (ADMIN_R2): the Venmo link row lives in Settings > Money instead. */}
          {ctx.d.adminR2 !== true &&
            text('venmoUrl', 'Venmo link', g.venmoUrl ?? '', { type: 'url', inputMode: 'url', placeholder: 'https://venmo.com/u/' }, {
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
          {ctx.d.adminR2 === true &&
            text('venmoUrl', 'Venmo link', g.venmoUrl ?? '', { type: 'url', inputMode: 'url', placeholder: 'https://venmo.com/u/' }, {
              hint: 'Where Pay sends players',
              check: (t) => (/^https?:\/\/\S+\.\S+/.test(t) ? null : 'Enter a full link starting with https://'),
            })}
          {text('zelleNumber', 'Apple Pay / Zelle number', g.zelleNumber ?? DEFAULT_ZELLE_NUMBER, { type: 'tel', inputMode: 'tel', maxLength: 24, placeholder: DEFAULT_ZELLE_NUMBER }, {
            hint: 'Shown on the Pay sheet',
            check: (t) => (/^[0-9+().\s-]{7,24}$/.test(t) ? null : 'Enter a phone number, like 248-555-0123.'),
          })}
          {!r3 && <PayAlwaysRow ctx={ctx} auto={auto} />}
        </Section>

        <Section id="schedule" title="Schedule" note={`Tue & Thu ${minutesLabel(g.settings.defaultStartMinutes)}`} sections={sections}>
          {!r3 && (
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
                  const next = e.target.value;
                  setFirstDate(next);
                  latestDate.current = next;
                  // A date saves right away; a cleared box means "no first date".
                  if (!next || /^\d{4}-\d{2}-\d{2}$/.test(next))
                    void auto.save('firstSessionDate', { firstSessionDate: next || null }).then((ok) => {
                      if (!auto.instant) return;
                      // Instant taps: a save that did not go through puts the box back to the date the server has.
                      if (ok) confirmedDate.current = next;
                      // Only while the box still shows this date: a later pick that is saving (or saved) is never undone.
                      else if (latestDate.current === next) {
                        setFirstDate(confirmedDate.current);
                        auto.clear('firstSessionDate');
                        if (ctx.d.viewOnly === true) toast(VIEW_ONLY_MESSAGE);
                        else toast("That didn't save. It's back to what it was.", 'error');
                      }
                    });
                }}
              />
            </div>
            <SaveProblem state={auto.rows.firstSessionDate} />
          </div>
          )}
          <UsualTimeRow ctx={ctx} />
          {whole('checkInHours', 'Day-before check-in (hours before play)')}
          {whole('lastCallHours', 'Last call (hours before play)')}
          {!r3 && <TimeShiftRow ctx={ctx} auto={auto} />}
        </Section>

        {!r3 && (
          <Section id="access" title="Access" note={g.openAccess ? 'Open' : 'Link only'} sections={sections}>
            {accessBody}
          </Section>
        )}

        <Section id="alerts" title="Alerts" note={!a.connected ? 'Not connected' : a.enabled ? 'On' : 'Off'} sections={sections}>
          <AlertsBody ctx={ctx} auto={auto} />
        </Section>

        <Section id="advanced" title="Advanced" sections={sections}>
          {ADVANCED_SETTINGS.map((a) => whole(a.key, a.label, a.hint))}
          {ctx.d.adminR2 === true && <HiddenPlayers ctx={ctx} />}
          {ctx.d.moneyRework === true && <HiddenGames ctx={ctx} />}
          {r3 && (
            <details className="advanced" data-adv="access">
              <summary>
                <span>
                  Access<span className="set-note"> · {g.openAccess ? 'Open' : 'Link only'}</span>
                </span>
              </summary>
              {accessBody}
            </details>
          )}
          {r3 && (
            <details className="advanced" data-adv="pin">
              <summary>Change PIN</summary>
              {pinBody}
            </details>
          )}
        </Section>

        <Section
          id="switches"
          title="Feature switches"
          note={
            ctx.d.moneyRework === true
              ? undefined
              : [ctx.d.totalsRefreshForAll ? 'Totals refresh on' : '', ctx.d.errorAlertsForAll ? 'Error alerts on' : '', ctx.d.unpaidNudgeForAll ? 'Unpaid nudge on' : '', ctx.d.afterGameCardForAll ? 'After-game cards on' : '', ctx.d.secondChanceForAll ? 'Second Chance on' : '', ctx.d.gameDayCardForAll ? 'Game day card on' : '', ctx.d.adminUndoForAll ? 'Undo on' : '', ctx.d.swapButtonForAll ? 'Swap on' : '', ctx.d.playersRedoForAll ? 'Players redo on' : '', ctx.d.speedLastScreenAdminForAll ? 'Instant admin on' : '', ctx.d.seatDotsForAll ? 'Seat dots on' : '', ctx.d.speedLastScreenForAll ? 'Last screen on' : '', ctx.d.speedDirectLoadForAll ? 'Load at once on' : '', ctx.d.speedFewerQueriesForAll ? 'Fewer trips on' : '', ctx.d.alertCardsForAll ? 'Alert cards on' : '', ctx.d.cardCleanupForAll ? 'Card cleanup on' : '', ctx.d.shortGamesForAll ? 'Short games on' : '', ctx.d.cardTimeButtonsForAll ? 'Card time on' : '', ctx.d.lastCallTextsForAll ? 'Last call texts on' : '', ctx.d.tonightGlowForAll ? 'Tonight glow on' : '', ctx.d.colorCleanupForAll ? 'Color cleanup on' : '', ctx.d.playerCardsSimpleForAll ? 'Simpler player cards on' : '', ctx.d.homeCollapseForAll ? 'Home collapse on' : '', ctx.d.adjustCreditForAll ? 'Adjust credit on' : '', ctx.d.venmoRequestForAll ? 'Venmo request on' : '', ctx.d.instantTapsForAll ? 'Instant taps on' : '', ctx.d.moneyReworkForAll ? 'Money rework on' : '', ctx.d.adminV2ForAll ? 'New layout on' : '', ctx.d.adminR2ForAll ? 'Round 2 on' : '', ctx.d.adminR3ForAll ? 'Round 3 on' : '', ctx.d.payNoteForAll ? 'Venmo note on' : '', ctx.d.playerFix1ForAll ? 'Player fixes on' : '', ctx.d.paySheetForAll ? 'Pay sheet on' : '', ctx.d.lateFeesForAll ? 'Late fees on' : '', ctx.d.textsR2ForAll ? 'Texts round 2 on' : '', ctx.d.lateFeeSplitForAll ? 'Fee split on' : ''].filter(Boolean).join(', ') || undefined
          }
          sections={sections}
        >
          {ctx.d.moneyRework === true ? (
            <TidySwitches ctx={ctx} auto={auto} r3={r3} />
          ) : (
            <>
              <TotalsRefreshRow ctx={ctx} auto={auto} />
              <ErrorAlertsRow ctx={ctx} auto={auto} />
              <UnpaidNudgeRow ctx={ctx} auto={auto} />
              <AfterGameRow ctx={ctx} auto={auto} />
              <SecondChanceRow ctx={ctx} auto={auto} />
              <GameDayRow ctx={ctx} auto={auto} />
              <Zip13Rows ctx={ctx} auto={auto} />
              <InstantAdminRow ctx={ctx} auto={auto} />
              <SeatDotsRow ctx={ctx} auto={auto} />
              <SpeedRows ctx={ctx} auto={auto} />
              <AlertCardsRow ctx={ctx} auto={auto} />
              <CardCleanupRow ctx={ctx} auto={auto} />
              <ShortGamesRow ctx={ctx} auto={auto} />
              <CardTimeRow ctx={ctx} auto={auto} />
              <LastCallRow ctx={ctx} auto={auto} />
              <TonightGlowRow ctx={ctx} auto={auto} />
              <ColorCleanupRow ctx={ctx} auto={auto} />
              <PlayerCardsRow ctx={ctx} auto={auto} />
              <HomeCollapseRow ctx={ctx} auto={auto} />
              <AdjustCreditRow ctx={ctx} auto={auto} />
              <VenmoRequestRow ctx={ctx} auto={auto} />
              <InstantTapsRow ctx={ctx} auto={auto} />
              <MoneyReworkRow ctx={ctx} auto={auto} />
              <AdminV2Row ctx={ctx} auto={auto} />
              <AdminR2Row ctx={ctx} auto={auto} />
              <AdminR3Row ctx={ctx} auto={auto} />
              <PayNoteRow ctx={ctx} auto={auto} />
              <PlayerFix1Row ctx={ctx} auto={auto} />
              <PaySheetRow ctx={ctx} auto={auto} />
              <LateFeesRow ctx={ctx} auto={auto} />
              <TextsR2Row ctx={ctx} auto={auto} />
              <LateFeeSplitRow ctx={ctx} auto={auto} />
              {r3 && <TimeShiftRow ctx={ctx} auto={auto} />}
              {r3 && <PayAlwaysRow ctx={ctx} auto={auto} />}
              <MotionRow ctx={ctx} auto={auto} which="player" />
              <MotionRow ctx={ctx} auto={auto} which="admin" />
            </>
          )}
        </Section>
      </div>

      <div className="card set-list">
        {!r3 && (
          <Section id="pin" title="Change PIN" sections={sections}>
            {pinBody}
          </Section>
        )}
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
          // Undo on admin toasts: a save still held for its Undo goes (and lands) before signing out. Nothing held: no wait.
          await flushHolds();
          setPretend(null);
          // Zip 12 step C: signing out throws this phone's saved organizer screen away first, and no answer still on its way may keep a
          // new one until the next sign-in (src/lastAdmin.ts).
          signedOutLastAdmin();
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
  const r3 = ctx.d.adminR3 === true;
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

  // Instant taps (INSTANT_TAPS): a failed save puts the switch back where the server last had it, with a toast; a second flip of the
  // same switch while it saves is ignored. Off: as before (the switch stays and "Tap to retry" shows).
  const instant = useInstant();
  const toast = useToast();
  const confirmedAlerts = useRef(on);
  const savingAlert = useRef(new Set<AlertKey>());
  function flip(key: AlertKey, value: boolean) {
    if (instant && savingAlert.current.has(key)) return;
    setOn((cur) => ({ ...cur, [key]: value }));
    if (!instant) return void auto.save(`alert-${key}`, { [key]: value }, '/api/admin/alerts');
    savingAlert.current.add(key);
    void auto.save(`alert-${key}`, { [key]: value }, '/api/admin/alerts').then((ok) => {
      savingAlert.current.delete(key);
      if (ok) {
        confirmedAlerts.current = { ...confirmedAlerts.current, [key]: value };
        return;
      }
      setOn((cur) => ({ ...cur, [key]: confirmedAlerts.current[key] }));
      auto.clear(`alert-${key}`);
      if (ctx.d.viewOnly === true) toast(VIEW_ONLY_MESSAGE);
      else toast("That didn't save. The switch is back where it was.", 'error');
    });
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
      {r3 ? (
        <>
          {/* Round 3 (ADMIN_R3): one button. It sends the smart-alert test (a short test message, with the link to the next game). */}
          <div className="alert-test">
            <button type="button" className="btn small secondary" data-smart-test onClick={sendSmartTest} disabled={smartTest?.status === 'sending'}>
              {smartTest?.status === 'sending' ? 'Sending…' : 'Test smart alert'}
            </button>
            {smartTest?.status === 'sent' && (
              <span className="alert-result ok" role="status">
                ✓ Sent to Telegram
              </span>
            )}
          </div>
          {smartTest?.status === 'failed' && <Notice tone="danger">{smartTest.message}</Notice>}
        </>
      ) : (
        <>
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
      )}
    </>
  );
}

/**
 * Settings > Schedule > Usual game time: the start and end for NEW Tue and
 * Thu games. One compact row; "Change" opens a small sheet. Existing games
 * keep their times (change one game from its Edit booking).
 */
function UsualTimeRow({ ctx }: { ctx: AdminCtx }) {
  const g = ctx.d.group.settings;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(minutesToHHMM(g.defaultStartMinutes));
  const [end, setEnd] = useState(minutesToHHMM(g.defaultEndMinutes));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickStart = (v: string) => {
    // A new start moves the end with it, keeping the game the same length (2 hours by default).
    const oldStart = hhmmToMinutes(start);
    const oldEnd = hhmmToMinutes(end);
    const next = hhmmToMinutes(v);
    setStart(v);
    if (next !== null && oldStart !== null && oldEnd !== null && oldEnd > oldStart) setEnd(minutesToHHMM(Math.min(next + (oldEnd - oldStart), 23 * 60 + 59)));
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    const s = hhmmToMinutes(start);
    const t = hhmmToMinutes(end);
    if (s === null || t === null) return setProblem('Pick a start and an end time.');
    if (s > SETTING_LIMITS.defaultStartMinutes[1]) return setProblem('Pick a start time before 11:00 PM.');
    if (t <= s) return setProblem('The end time must be after the start time.');
    setProblem(null);
    setBusy(true);
    try {
      await api('PUT', '/api/admin/group', { settings: { defaultStartMinutes: s, defaultEndMinutes: t } });
      await ctx.reload();
      toast('Usual time saved');
      setOpen(false);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : "Couldn't save the time.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="set-row-wrap" data-row="usualTime">
      <div className="set-row">
        <span className="set-label">
          <span className="set-name">Usual game time</span>
          <span className="set-hint" data-usual-time>
            {minutesLabel(g.defaultStartMinutes)} to {minutesLabel(g.defaultEndMinutes)}
          </span>
        </span>
        <button
          type="button"
          className="btn small secondary set-input"
          onClick={() => {
            setStart(minutesToHHMM(g.defaultStartMinutes));
            setEnd(minutesToHHMM(g.defaultEndMinutes));
            setProblem(null);
            setOpen(true);
          }}
        >
          Change
        </button>
      </div>
      <Sheet open={open} title="Usual game time" onClose={() => setOpen(false)}>
        <form className="stack" onSubmit={save}>
          <p className="small muted">For new Tuesday and Thursday games only. Games already on the schedule keep their times; change one from its Edit booking.</p>
          <div className="time-pair">
            <label className="field">
              Start
              <input type="time" step={300} value={start} onChange={(e) => pickStart(e.target.value)} required />
            </label>
            <label className="field">
              End
              <input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required aria-invalid={problem ? true : undefined} />
            </label>
          </div>
          {problem && <Notice tone="danger">{problem}</Notice>}
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </Sheet>
    </div>
  );
}

/**
 * Round 3 switch behavior (ADMIN_R3): the switch moves the instant it is tapped, the toast confirms once the server has it,
 * and a failed save snaps the switch back (with a short toast). `snap` false = exactly the old behavior (no toast, no snap back).
 */
function useFlip(initial: boolean, ctx: AdminCtx, auto: Autosave, key: string, path: string, label: string, snapAsked: boolean) {
  const toast = useToast();
  // Instant taps (INSTANT_TAPS): every switch snaps back on a failed save, with a toast, and a second flip while it saves is ignored.
  const instant = useInstant();
  // Signed in with the read-only PIN (server/viewOnly.ts): every switch snaps back, with the calm "View only" note (never a red error).
  const viewOnly = ctx.d.viewOnly === true;
  const snap = snapAsked || !!instant || viewOnly;
  const [on, setOn] = useState(initial);
  // What the server last confirmed: a failed save always snaps back to this (so two quick failing taps cannot leave it wrong).
  const confirmed = useRef(initial);
  const saving = useRef(false);
  const flip = (next: boolean) => {
    if (instant && saving.current) return;
    saving.current = true;
    setOn(next);
    void auto.save(key, { on: next }, path).then((ok) => {
      saving.current = false;
      if (snap) {
        if (ok) {
          confirmed.current = next;
          toast(`${label} ${next ? 'on' : 'off'}`);
        } else {
          setOn(confirmed.current);
          // The switch is back where it was, so no "tap to retry" line (a retry would save a value the switch no longer shows).
          auto.clear(key);
          if (viewOnly) toast(VIEW_ONLY_MESSAGE);
          else toast("That didn't save. The switch is back where it was.", 'error');
        }
      }
      return ctx.reload();
    });
  };
  return { on, flip };
}

/**
 * "Ask for payment on every game": players who are in see Pay on every game, Booked, Waitlist or Not booked.
 * Off: Pay waits for Court booked, except on a phone that opened the site with ?payalways=on (a private test).
 * Saves itself. It only changes what the player screen shows; no money moves.
 */
function PayAlwaysRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.payAlwaysForAll, ctx, auto, 'payAlwaysAll', '/api/admin/pay-always', 'Payment on every game', ctx.d.adminR3 === true);
  return (
    <div className="set-row-wrap" data-row="payAlwaysAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Ask for payment on every game <SaveMark state={auto.rows.payAlwaysAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Pay shows before the court is booked" : <>Pay shows before the court is booked. Off: only phones opened with ?payalways=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-pay-always-all
          onChange={(e) => flip(e.target.checked)}
        />
      </label>
      <SaveProblem state={auto.rows.payAlwaysAll} />
    </div>
  );
}

/**
 * "Moved-game notice for everyone": players who are in confirm a moved start time (Still in / Can't make it).
 * Off: only a phone that opened the site with ?timeshift=on sees it (a private test). Saves itself; no money moves.
 */
function TimeShiftRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.timeShiftForAll, ctx, auto, 'timeShiftAll', '/api/admin/time-shift', 'Moved-game notice', ctx.d.adminR3 === true);
  return (
    <div className="set-row-wrap" data-row="timeShiftAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Moved-game notice for everyone <SaveMark state={auto.rows.timeShiftAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Players confirm a moved start time" : <>Players confirm a new start time. Off: only phones opened with ?timeshift=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-time-shift-all
          onChange={(e) => flip(e.target.checked)}
        />
      </label>
      <SaveProblem state={auto.rows.timeShiftAll} />
    </div>
  );
}

/**
 * "Late drops owe $14" (LATE_FEES, shared/lateFees.ts). CHANGES MONEY: a late drop that leaves a game below 4, a no-show
 * with fewer than 4 played, and a late cancel the venue did not waive leave the person owing their $14 (a sub clears it).
 * Off: only phones opened with ?latefees=on (a private test). Saves itself, no deploy.
 */
function LateFeesRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.lateFeesForAll, ctx, auto, 'lateFeesAll', '/api/admin/late-fees', 'Late drops owe $14', false);
  return (
    <div className="set-row-wrap" data-row="lateFeesAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Late drops owe $14 <SaveMark state={auto.rows.lateFeesAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Changes money: late drops under 4 owe $14 unless a sub steps in" : <>Changes money: inside 12 hours, a drop that leaves fewer than 4 owes unless someone takes the spot. Off: only phones opened with ?latefees=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-late-fees-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.lateFeesAll} />
    </div>
  );
}

/**
 * "No Venmo? note": a small note on the player screen, a couple of seconds after Pay is tapped, when the Venmo app did
 * not open ("No Venmo? Pay Alex directly"). Display only. Off: only a phone opened with ?paynote=on sees it (a private
 * test). Saves itself, no deploy.
 */
function PayNoteRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.payNoteForAll, ctx, auto, 'payNoteAll', '/api/admin/pay-note', 'No Venmo? note', false);
  return (
    <div className="set-row-wrap" data-row="payNoteAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            No Venmo? note <SaveMark state={auto.rows.payNoteAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Tells players without Venmo to pay you directly" : <>Tells a player without the Venmo app to pay you directly. Off: only phones opened with ?paynote=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-pay-note-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.payNoteAll} />
    </div>
  );
}

/**
 * "Player screen fixes": on game day, Pay and "I paid" also sit on tonight's game card (the "Tonight: you owe" card at
 * the top stays), and the blue TONIGHT tag gets more room. Display only. Off: only a phone opened with ?playerfix1=on
 * sees it (a private test). Saves itself, no deploy.
 */
function PlayerFix1Row({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.playerFix1ForAll, ctx, auto, 'playerFix1All', '/api/admin/player-fix1', 'Player screen fixes', false);
  return (
    <div className="set-row-wrap" data-row="playerFix1All">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Player screen fixes <SaveMark state={auto.rows.playerFix1All} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Pay on tonight's card, roomier TONIGHT tag" : <>Pay and I paid on tonight's game card too, and a roomier TONIGHT tag. Off: only phones opened with ?playerfix1=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-player-fix1-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.playerFix1All} />
    </div>
  );
}

/**
 * "Texts and alerts, round 2": the new wording for every text the site prepares, the new wording and timing of the Telegram
 * alerts, and the cancel sheet answering No to "Did the venue waive the fee?". No money rule changes. Off: only a phone opened
 * with /admin?textsr2=on sees the new texts (a private test); the Telegram alerts change only when this is on for everyone.
 * Saves itself, no deploy.
 */
function TextsR2Row({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.textsR2ForAll, ctx, auto, 'textsR2All', '/api/admin/texts-r2', 'Texts and alerts, round 2', false);
  return (
    <div className="set-row-wrap" data-row="textsR2All">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Texts and alerts, round 2 <SaveMark state={auto.rows.textsR2All} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "New text wording and alert times, cancel sheet starts on No" : <>New wording for texts and Telegram alerts, new alert times, cancel sheet starts on No. Off: only phones opened with /admin?textsr2=on get the new texts</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-texts-r2-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.textsR2All} />
    </div>
  );
}

/**
 * "Late-cancel fee split" (LATE_FEE_SPLIT, shared/lateFees.ts). CHANGES MONEY: a cancel inside 12 hours where the venue kept the
 * fee, with 5 or more in, prices every seat like a played game (6 in: $9 each, $5 back as credit to anyone who paid $14).
 * Needs "Late drops owe $14" on. Off: only a phone opened with /admin?latefeesplit=on splits it. Saves itself, no deploy.
 */
function LateFeeSplitRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.lateFeeSplitForAll, ctx, auto, 'lateFeeSplitAll', '/api/admin/late-fee-split', 'Late-cancel fee split', false);
  return (
    <div className="set-row-wrap" data-row="lateFeeSplitAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Late-cancel fee split <SaveMark state={auto.rows.lateFeeSplitAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Changes money: late cancel with 5+ in pays the played price" : <>Venue keeps the fee on a late cancel with 5 or more in: everyone owes the played-game price (6 in: $9), extra comes back as credit. Needs late fees on. Off: everyone owes $14</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-late-fee-split-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.lateFeeSplitAll} />
    </div>
  );
}

/**
 * "Pay sheet": a Pay button opens a small sheet (Pay with the Venmo app, Copy Venmo @handle, Apple Pay / Zelle / cash line,
 * I paid) instead of jumping straight into the app. Display only. Off: only a phone opened with ?paysheet=on sees it (a
 * private test). Saves itself, no deploy.
 */
function PaySheetRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.paySheetForAll, ctx, auto, 'paySheetAll', '/api/admin/pay-sheet', 'Pay sheet', false);
  return (
    <div className="set-row-wrap" data-row="paySheetAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Pay sheet <SaveMark state={auto.rows.paySheetAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "Pay opens a sheet: Venmo, copy handle, Zelle" : <>Pay opens a small sheet: Venmo app, copy my Venmo, Zelle line, I paid. Off: only phones opened with ?paysheet=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-pay-sheet-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.paySheetAll} />
    </div>
  );
}

/**
 * "New admin layout": the organizer's History, Money and Home screens, version 2. Display only: nothing that is saved,
 * charged or sent changes. Off: only a phone opened with /admin?adminv2=on sees it (a private test). Saves itself, no deploy.
 */
function AdminV2Row({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.adminV2ForAll, ctx, auto, 'adminV2All', '/api/admin/admin-v2', 'New admin layout', false);
  return (
    <div className="set-row-wrap" data-row="adminV2All">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            New admin layout <SaveMark state={auto.rows.adminV2All} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "New History, Money and Home screens" : <>New History, Money and Home screens. Off: only phones opened with /admin?adminv2=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-admin-v2-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.adminV2All} />
    </div>
  );
}

/**
 * "Admin screens, round 2": the new Home cards, Money list, Players list (with Hide player), History highlight and header.
 * Display only: nothing that is saved, charged or sent changes. Off: only a phone opened with /admin?adminr2=on sees it
 * (a private test). Saves itself, no deploy.
 */
function AdminR2Row({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.adminR2ForAll, ctx, auto, 'adminR2All', '/api/admin/admin-r2', 'Admin screens, round 2', false);
  return (
    <div className="set-row-wrap" data-row="adminR2All">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Admin screens, round 2 <SaveMark state={auto.rows.adminR2All} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "New Home cards, Money, Players, History, header" : <>New Home cards, Money, Players, History and header. Off: only phones opened with /admin?adminr2=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-admin-r2-all
          onChange={(e) => {
            flip(e.target.checked);
          }}
        />
      </label>
      <SaveProblem state={auto.rows.adminR2All} />
    </div>
  );
}

/**
 * "Admin screens, round 3": the new Edit game and Add game forms, the Settings clean-up and the Players page layout.
 * Needs round 2 on as well. Display only: nothing that is saved, charged or sent changes. Off: only a phone opened with
 * /admin?adminr3=on sees it (a private test). Saves itself, no deploy.
 */
function AdminR3Row({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.adminR3ForAll, ctx, auto, 'adminR3All', '/api/admin/admin-r3', 'Admin screens, round 3', true);
  return (
    <div className="set-row-wrap" data-row="adminR3All">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Admin screens, round 3 <SaveMark state={auto.rows.adminR3All} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? "New Edit game, Add game, Settings, Players. Needs round 2" : <>New Edit game, Add game, Settings order and Players list. Needs round 2 on. Off: only phones opened with /admin?adminr3=on</>}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          data-admin-r3-all
          onChange={(e) => flip(e.target.checked)}
        />
      </label>
      <SaveProblem state={auto.rows.adminR3All} />
    </div>
  );
}

/**
 * Settings > Advanced > Hidden players (round 2): the names hidden with "Hide player", each with an Unhide button.
 * Unhiding puts the name straight back on the Players list and the pickers; nothing else about them ever changed.
 */
function HiddenPlayers({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const hidden = ctx.d.players.filter((p) => p.adminHidden);
  async function unhide(id: string, name: string) {
    setBusy(id);
    try {
      await api('POST', `/api/admin/players/${id}/admin-hide`, { hidden: false });
      await ctx.reload();
      toast(`${name} is back on your Players list`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }
  return (
    <details className="advanced hidden-players" data-hidden-players>
      <summary>Hidden players{hidden.length > 0 ? ` (${hidden.length})` : ''}</summary>
      {hidden.length === 0 ? (
        <p className="small muted">Nobody is hidden. Hide someone from their Edit sheet on the Players tab.</p>
      ) : (
        <ul className="rows" aria-label="Hidden players">
          {hidden.map((p) => (
            <li key={p.id} data-hidden-player={p.name}>
              <span className="who">
                <strong>{p.name}</strong>
              </span>
              <button type="button" className="btn small secondary" disabled={busy === p.id} aria-label={`Unhide ${p.name}`} onClick={() => void unhide(p.id, p.name)}>
                Unhide
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * "Money page rework" (MONEY_REWORK, server/moneyRework.ts): the reworked Money page (Games and Totals), Hide from list with Settings >
 * Advanced > Hidden games, Edit charge on a canceled game, the cancel sheet's "Were you charged?" default, this tidier switches page and
 * a quieter History. Admin screens only: no money rule, amount, seat or credit changes. Off: only a phone opened with
 * /admin?moneyrework=on sees it (a private test). Saves itself, no deploy.
 */
function MoneyReworkRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.moneyReworkForAll, ctx, auto, 'moneyReworkAll', '/api/admin/money-rework', 'Money page rework', true);
  return (
    <div className="set-row-wrap" data-row="moneyReworkAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Money page rework <SaveMark state={auto.rows.moneyReworkAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? 'New Money page, hide games, edit charge' : 'New Money page, hide games, edit charge. Off: only phones opened with /admin?moneyrework=on'}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-money-rework-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.moneyReworkAll} />
    </div>
  );
}

/**
 * "Instant taps" (INSTANT_TAPS, server/instantTaps.ts): a tapped button changes the screen at once and saves in the background; a failed
 * save puts the screen back exactly and says what failed. Player and organizer screens. Tap feedback only. Off: only a phone opened with
 * ?instanttaps=on gets it (a private test). Saves itself, no deploy.
 */
function InstantTapsRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.instantTapsForAll, ctx, auto, 'instantTapsAll', '/api/admin/instant-taps', 'Instant taps', true);
  return (
    <div className="set-row-wrap" data-row="instantTapsAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Instant taps <SaveMark state={auto.rows.instantTapsAll} />
          </span>
          <span className="set-hint">{ctx.d.moneyRework === true ? 'Buttons react at once, save in the background' : 'Buttons react at once and save in the background. Off: only phones opened with ?instanttaps=on'}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-instant-taps-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.instantTapsAll} />
    </div>
  );
}

/**
 * "Adjust credit" (ADJUST_CREDIT, server/adjustCredit.ts): the Players sheet gets an Adjust credit row (add or remove credit by hand, with a
 * reason). Off: only a phone opened with /admin?adjustcredit=on. Saves itself, no deploy. Moves no credit by itself.
 */
function AdjustCreditRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.adjustCreditForAll, ctx, auto, 'adjustCreditAll', '/api/admin/adjust-credit-switch', 'Adjust credit', true);
  return (
    <div className="set-row-wrap" data-row="adjustCreditAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Adjust credit <SaveMark state={auto.rows.adjustCreditAll} />
          </span>
          <span className="set-hint">Add or remove a player's credit, with a reason</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-adjust-credit-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.adjustCreditAll} />
    </div>
  );
}

/**
 * Zip 7 switches (server/zip7.ts), all display only, all off at ship. Off: only a phone opened with ?tonightglow=on, ?colorcleanup=on or
 * ?playercards=on. Each saves itself, no deploy.
 */
function Zip7Row({ ctx, auto, rowKey, path, name, hint, flag, dataAttr }: { ctx: AdminCtx; auto: Autosave; rowKey: string; path: string; name: string; hint: string; flag: boolean; dataAttr: string }) {
  const { on, flip } = useFlip(flag, ctx, auto, rowKey, path, name, true);
  return (
    <div className="set-row-wrap" data-row={rowKey}>
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            {name} <SaveMark state={auto.rows[rowKey]} />
          </span>
          <span className="set-hint">{hint}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} {...{ [dataAttr]: true }} onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows[rowKey]} />
    </div>
  );
}
function TonightGlowRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="tonightGlowAll" path="/api/admin/tonight-glow-switch" name="Tonight glow" hint="Green TONIGHT and TOMORROW tags, glowing badge" flag={!!ctx.d.tonightGlowForAll} dataAttr="data-tonight-glow-all" />;
}
function ColorCleanupRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="colorCleanupAll" path="/api/admin/color-cleanup-switch" name="Color cleanup" hint="One color system across the site" flag={!!ctx.d.colorCleanupForAll} dataAttr="data-color-cleanup-all" />;
}
/** "Seat dots" (SEAT_DOTS, server/seatDots.ts): every empty seat a dashed ring. Display only. Off: only ?seatdots=on. */
function SeatDotsRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="seatDotsAll" path="/api/admin/seat-dots-switch" name="Seat dots" hint="Empty seats as dashed rings" flag={!!ctx.d.seatDotsForAll} dataAttr="data-seat-dots-all" />;
}
/** "Alert cards" (ALERT_CARDS, server/zip11.ts, Zip 11): one action-card look for every alert. Display only. Off: only ?alertcards=on. */
function AlertCardsRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="alertCardsAll" path="/api/admin/alert-cards-switch" name="Alert cards" hint="One slim card look for every alert, one button each" flag={!!ctx.d.alertCardsForAll} dataAttr="data-alert-cards-all" />;
}
/** Zip 12 step C, "Instant admin" (SPEED_LAST_SCREEN_ADMIN, server/speed.ts): the organizer screens from the saved copy. Off: only /admin?lastscreenadmin=on. */
function InstantAdminRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="speedLastScreenAdminAll" path="/api/admin/speed-last-screen-admin-switch" name="Instant admin" hint="Your organizer screens show at once, money dimmed, taps wait for fresh data. Not on a game day the first time" flag={!!ctx.d.speedLastScreenAdminForAll} dataAttr="data-speed-last-screen-admin-all" />
}
/** Zip 23, "Totals refresh" (TOTALS_REFRESH, server/totalsRefresh.ts): the new Money > Totals look. Organizer only, display only. Off: only /admin?totalsrefresh=on. */
function TotalsRefreshRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="totalsRefreshAll" path="/api/admin/totals-refresh-switch" name="Totals refresh" hint="Money > Totals: two cards with the cost per court, and a Month by month list. Same numbers" flag={!!ctx.d.totalsRefreshForAll} dataAttr="data-totals-refresh-all" />;
}
/**
 * Zip 21, "Error alerts" (ERROR_ALERTS, server/errorAlerts.ts): a Telegram to you when something on the site goes wrong. No screen
 * changes. The TEST button sends one message marked TEST through the same sender, switch on or off (the private test for this switch).
 */
function ErrorAlertsRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.errorAlertsForAll, ctx, auto, 'errorAlertsAll', '/api/admin/error-alerts-switch', 'Error alerts', true);
  const [test, setTest] = useState<{ status: 'sending' | 'sent' | 'failed'; message?: string } | null>(null);
  async function sendTest() {
    setTest({ status: 'sending' });
    try {
      await api('POST', '/api/admin/error-alerts/test', {});
      setTest({ status: 'sent' });
    } catch (err) {
      setTest({ status: 'failed', message: err instanceof ApiError ? err.message : "Couldn't send the TEST error alert." });
    }
  }
  return (
    <div className="set-row-wrap" data-row="errorAlertsAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Error alerts <SaveMark state={auto.rows.errorAlertsAll} />
          </span>
          <span className="set-hint">A Telegram to you when the clock, the backup or the database fails. At most 1 an hour per kind, 6 a day</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-error-alerts-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.errorAlertsAll} />
      <div className="alert-test">
        <button type="button" className="btn small secondary" data-error-alert-test onClick={sendTest} disabled={test?.status === 'sending'}>
          {test?.status === 'sending' ? 'Sending…' : 'Send TEST error alert'}
        </button>
        {test?.status === 'sent' && (
          <span className="alert-result ok" role="status">
            ✓ Sent to Telegram
          </span>
        )}
      </div>
      {test?.status === 'failed' && <Notice tone="danger">{test.message}</Notice>}
    </div>
  );
}
/** Zip 17, "Unpaid nudge" (UNPAID_NUDGE, server/unpaidNudge.ts): players only. Off: only ?nudge=on on that phone. */
function UnpaidNudgeRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="unpaidNudgeAll" path="/api/admin/unpaid-nudge-switch" name="Unpaid nudge" hint={`"You owe" card words, a Please pay toast after I'm in, and no new sign-up at ${UNPAID_LIMIT} unpaid games until they pay. You can still add anyone`} flag={!!ctx.d.unpaidNudgeForAll} dataAttr="data-unpaid-nudge-all" />;
}
/** Zip 16, "After-game cards" (AFTER_GAME_CARD, server/afterGame.ts): the player's card after Finalize. Display only. Off: only ?aftergame=on. */
function AfterGameRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="afterGameCardAll" path="/api/admin/after-game-card-switch" name="After-game cards" hint="After Finalize, a player whose price went down sees one card: $5 back to your credit. Owes more: You owe $2 more" flag={!!ctx.d.afterGameCardForAll} dataAttr="data-after-game-card-all" />;
}
/** Zip 15, "Second Chance" (SECOND_CHANCE, server/secondChance.ts): same-day game cards on Home, the two Telegrams, Request buttons. Off: only /admin?secondchance=on (cards only, no Telegram). */
function SecondChanceRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="secondChanceAll" path="/api/admin/second-chance-switch" name="Second Chance" hint="Same-day games: reopen a game that was 1 short, Text the group cards, Telegrams at 4 in and 4 paid, Venmo Request buttons on Home" flag={!!ctx.d.secondChanceForAll} dataAttr="data-second-chance-all" />;
}
/** Zip 14, "Game day card" (GAME_DAY_CARD, server/gameDay.ts): the player game day card and the Court row. Off: only ?gameday=on. */
function GameDayRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="gameDayCardAll" path="/api/admin/game-day-card-switch" name="Game day card" hint="On game day: Court and Directions buttons, the court map. Adds the Court row to Add game and Edit game. Not on a game day the first time" flag={!!ctx.d.gameDayCardForAll} dataAttr="data-game-day-card-all" />;
}
/** Zip 13 rows (server/zip13.ts), newest first. All organizer only. Off: only /admin?adminundo=on, ?swapbutton=on, ?playersredo=on. */
function Zip13Rows({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return (
    <>
      <Zip7Row ctx={ctx} auto={auto} rowKey="adminUndoAll" path="/api/admin/admin-undo-switch" name="Undo on admin toasts" hint="5 seconds to undo Mark paid, Finalize, Cancel and more. The save waits, so Undo leaves no trace" flag={!!ctx.d.adminUndoForAll} dataAttr="data-admin-undo-all" />
      <Zip7Row ctx={ctx} auto={auto} rowKey="swapButtonAll" path="/api/admin/swap-button-switch" name="Swap to Alex" hint="Tap Admin at the top for your player page, Go to Admin to come back" flag={!!ctx.d.swapButtonForAll} dataAttr="data-swap-button-all" />
      <Zip7Row ctx={ctx} auto={auto} rowKey="playersRedoAll" path="/api/admin/players-redo-switch" name="Players redo" hint="One-line rows with one money chip, details and edit sheets" flag={!!ctx.d.playersRedoForAll} dataAttr="data-players-redo-all" />
    </>
  );
}
/** Zip 12 speed rows (server/speed.ts). None of them changes money or what a tap does. Off: only ?fewerqueries=on / ?directload=on / ?lastscreen=on. */
function SpeedRows({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return (
    <>
      <Zip7Row ctx={ctx} auto={auto} rowKey="speedLastScreenAll" path="/api/admin/speed-last-screen-switch" name="Show last screen at once" hint="Players see their last screen right away, buttons wait for fresh data" flag={!!ctx.d.speedLastScreenForAll} dataAttr="data-speed-last-screen-all" />
      <Zip7Row ctx={ctx} auto={auto} rowKey="speedDirectLoadAll" path="/api/admin/speed-direct-load-switch" name="Load games at once" hint="The site address asks for the games without waiting" flag={!!ctx.d.speedDirectLoadForAll} dataAttr="data-speed-direct-load-all" />
      <Zip7Row ctx={ctx} auto={auto} rowKey="speedFewerQueriesAll" path="/api/admin/speed-fewer-queries-switch" name="Fewer database trips" hint="Same screens, fewer questions to the database" flag={!!ctx.d.speedFewerQueriesForAll} dataAttr="data-speed-fewer-queries-all" />
    </>
  );
}
/** "Card cleanup" (CARD_CLEANUP, server/zip10.ts, Zip 10): the new card look, no waitlist, no Max players cap. Off: only ?cardcleanup=on. */
function CardCleanupRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="cardCleanupAll" path="/api/admin/card-cleanup-switch" name="Card cleanup" hint="Balls and names on cards, no waitlist, no player cap" flag={!!ctx.d.cardCleanupForAll} dataAttr="data-card-cleanup-all" />;
}
/** "Short games" (SHORT_GAMES, server/zip9.ts, Zip 9): 1.5 hour games get their own price table. CHANGES MONEY. Off: only ?shortgames=on. */
function ShortGamesRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="shortGamesAll" path="/api/admin/short-games-switch" name="Short games" hint="Changes money: 1.5 hour games cost $11 each at 4 in" flag={!!ctx.d.shortGamesForAll} dataAttr="data-short-games-all" />;
}
/** "Card time and buttons" (CARD_TIME_BUTTONS, server/zip9.ts, Zip 9): time line under the date tile, Calendar | Directions. Off: only ?cardtime=on. */
function CardTimeRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="cardTimeAll" path="/api/admin/card-time-switch" name="Card time and buttons" hint="Start time and length under the date, calendar and directions" flag={!!ctx.d.cardTimeButtonsForAll} dataAttr="data-card-time-all" />;
}
/** "Last call texts" (LAST_CALL_TEXTS, server/lastCall.ts, Zip 8): the night-before Check-in and Need players words. Off: only /admin?lastcall=on. */
function LastCallRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="lastCallAll" path="/api/admin/last-call-switch" name="Last call texts" hint="Still in? texts for the group chat" flag={!!ctx.d.lastCallTextsForAll} dataAttr="data-last-call-all" />;
}
function PlayerCardsRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  return <Zip7Row ctx={ctx} auto={auto} rowKey="playerCardsAll" path="/api/admin/player-cards-switch" name="Simpler player cards" hint="No court status on player cards" flag={!!ctx.d.playerCardsSimpleForAll} dataAttr="data-player-cards-all" />;
}

/**
 * "Home collapse" (HOME_COLLAPSE, server/homeCollapse.ts): the player Home shows only this week and next week; every later game sits behind
 * one "More sessions" button. Off: only a phone opened with /?homecollapse=on. Saves itself, no deploy. Display only.
 */
function HomeCollapseRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.homeCollapseForAll, ctx, auto, 'homeCollapseAll', '/api/admin/home-collapse-switch', 'Home collapse', true);
  return (
    <div className="set-row-wrap" data-row="homeCollapseAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Home collapse <SaveMark state={auto.rows.homeCollapseAll} />
          </span>
          <span className="set-hint">Players see this and next week; later games fold</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-home-collapse-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.homeCollapseAll} />
    </div>
  );
}

/**
 * "Venmo request" (VENMO_REQUEST, server/venmoRequest.ts): a blue "Venmo request" link per person who owes, only where a Venmo username is
 * saved. Off: only a phone opened with /admin?venmorequest=on. Saves itself, no deploy. Only shows links.
 */
function VenmoRequestRow({ ctx, auto }: { ctx: AdminCtx; auto: Autosave }) {
  const { on, flip } = useFlip(!!ctx.d.venmoRequestForAll, ctx, auto, 'venmoRequestAll', '/api/admin/venmo-request-switch', 'Venmo request', true);
  return (
    <div className="set-row-wrap" data-row="venmoRequestAll">
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            Venmo request <SaveMark state={auto.rows.venmoRequestAll} />
          </span>
          <span className="set-hint">A Venmo request link for each person who owes</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-venmo-request-all onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows.venmoRequestAll} />
    </div>
  );
}

/**
 * The two animation switches (MOTION for the player screens, MOTION_ADMIN for these organizer screens), moved here so every switch is
 * on one page. Visual only. They start where wrangler.toml has them (both on); flipping a row works at once, no deploy, and the
 * wrangler.toml value still decides when nobody has touched the row. Private test links stay: ?motion=on, /admin?motionadmin=on.
 */
function MotionRow({ ctx, auto, which }: { ctx: AdminCtx; auto: Autosave; which: 'player' | 'admin' }) {
  const player = which === 'player';
  const key = player ? 'motionPlayersAll' : 'motionAdminAll';
  const initial = player ? ctx.d.motionPlayersForAll !== false : ctx.d.motionAdminForAll !== false;
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const confirmed = useRef(initial);
  const saving = useRef(false);
  const flip = (next: boolean) => {
    if (saving.current) return;
    saving.current = true;
    setOn(next);
    void auto.save(key, { which, on: next }, '/api/admin/motion-switch').then((ok) => {
      saving.current = false;
      if (ok) {
        confirmed.current = next;
        toast(`${player ? 'Player' : 'Organizer'} animations ${next ? 'on' : 'off'}`);
      } else {
        setOn(confirmed.current);
        auto.clear(key);
        if (ctx.d.viewOnly === true) toast(VIEW_ONLY_MESSAGE);
        else toast("That didn't save. The switch is back where it was.", 'error');
      }
      return ctx.reload();
    });
  };
  return (
    <div className="set-row-wrap" data-row={key}>
      <label className="set-row">
        <span className="set-label">
          <span className="set-name">
            {player ? 'Animations, players' : 'Animations, organizer'} <SaveMark state={auto.rows[key]} />
          </span>
          <span className="set-hint">{player ? 'Movement on the player screens' : 'Movement on these organizer screens'}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={on} data-motion-switch={which} onChange={(e) => flip(e.target.checked)} />
      </label>
      <SaveProblem state={auto.rows[key]} />
    </div>
  );
}

/**
 * The Feature switches page when the Money page rework is on: newest switch first, switches that are off listed above, and every older
 * switch that is already on for everyone folded into one "Live and stable" group. Which group a row sits in is read once when the
 * page opens, so a row never jumps away while you are flipping it. No behavior change: each row is the same row, with the same switch.
 */
function TidySwitches({ ctx, auto, r3 }: { ctx: AdminCtx; auto: Autosave; r3: boolean }) {
  const d = ctx.d;
  // Newest first (the order the switches were built).
  const all: { key: string; on: boolean; node: ReactNode }[] = [
    { key: 'lateFeeSplitAll', on: !!d.lateFeeSplitForAll, node: <LateFeeSplitRow key="lateFeeSplitAll" ctx={ctx} auto={auto} /> },
    { key: 'textsR2All', on: !!d.textsR2ForAll, node: <TextsR2Row key="textsR2All" ctx={ctx} auto={auto} /> },
    { key: 'paySheetAll', on: !!d.paySheetForAll, node: <PaySheetRow key="paySheetAll" ctx={ctx} auto={auto} /> },
    { key: 'playerFix1All', on: !!d.playerFix1ForAll, node: <PlayerFix1Row key="playerFix1All" ctx={ctx} auto={auto} /> },
    { key: 'lateFeesAll', on: !!d.lateFeesForAll, node: <LateFeesRow key="lateFeesAll" ctx={ctx} auto={auto} /> },
    { key: 'adminR3All', on: !!d.adminR3ForAll, node: <AdminR3Row key="adminR3All" ctx={ctx} auto={auto} /> },
    { key: 'adminR2All', on: !!d.adminR2ForAll, node: <AdminR2Row key="adminR2All" ctx={ctx} auto={auto} /> },
    { key: 'payNoteAll', on: !!d.payNoteForAll, node: <PayNoteRow key="payNoteAll" ctx={ctx} auto={auto} /> },
    { key: 'adminV2All', on: !!d.adminV2ForAll, node: <AdminV2Row key="adminV2All" ctx={ctx} auto={auto} /> },
    ...(r3
      ? [
          { key: 'payAlwaysAll', on: !!d.payAlwaysForAll, node: <PayAlwaysRow key="payAlwaysAll" ctx={ctx} auto={auto} /> },
          { key: 'timeShiftAll', on: !!d.timeShiftForAll, node: <TimeShiftRow key="timeShiftAll" ctx={ctx} auto={auto} /> },
        ]
      : []),
    // The two animation switches are the oldest ones (Nov 1), so they sit last.
    { key: 'motionPlayersAll', on: d.motionPlayersForAll !== false, node: <MotionRow key="motionPlayersAll" ctx={ctx} auto={auto} which="player" /> },
    { key: 'motionAdminAll', on: d.motionAdminForAll !== false, node: <MotionRow key="motionAdminAll" ctx={ctx} auto={auto} which="admin" /> },
  ];
  const [stable] = useState(() => new Set(all.filter((x) => x.on).map((x) => x.key)));
  const live = all.filter((x) => stable.has(x.key));
  const rest = all.filter((x) => !stable.has(x.key));
  return (
    <div className="switches-tidy" data-switches-tidy>
      <TotalsRefreshRow ctx={ctx} auto={auto} />
      <ErrorAlertsRow ctx={ctx} auto={auto} />
      <UnpaidNudgeRow ctx={ctx} auto={auto} />
      <AfterGameRow ctx={ctx} auto={auto} />
      <SecondChanceRow ctx={ctx} auto={auto} />
      <GameDayRow ctx={ctx} auto={auto} />
      <Zip13Rows ctx={ctx} auto={auto} />
      <InstantAdminRow ctx={ctx} auto={auto} />
      <SeatDotsRow ctx={ctx} auto={auto} />
      <SpeedRows ctx={ctx} auto={auto} />
      <AlertCardsRow ctx={ctx} auto={auto} />
      <CardCleanupRow ctx={ctx} auto={auto} />
      <ShortGamesRow ctx={ctx} auto={auto} />
      <CardTimeRow ctx={ctx} auto={auto} />
      <LastCallRow ctx={ctx} auto={auto} />
      <TonightGlowRow ctx={ctx} auto={auto} />
              <ColorCleanupRow ctx={ctx} auto={auto} />
              <PlayerCardsRow ctx={ctx} auto={auto} />
              <HomeCollapseRow ctx={ctx} auto={auto} />
      <AdjustCreditRow ctx={ctx} auto={auto} />
      <VenmoRequestRow ctx={ctx} auto={auto} />
      <InstantTapsRow ctx={ctx} auto={auto} />
      <MoneyReworkRow ctx={ctx} auto={auto} />
      {rest.map((x) => x.node)}
      {live.length > 0 && (
        <details className="advanced live-stable" data-live-stable>
          <summary>
            <span>
              Live and stable<span className="set-note"> · {live.length}</span>
            </span>
          </summary>
          {live.map((x) => x.node)}
        </details>
      )}
    </div>
  );
}

/**
 * Settings > Advanced > Hidden games (Money page rework): the games hidden from your Home and Games lists, each with a Restore button.
 * Restoring puts the game straight back; nothing about it was ever deleted.
 */
function HiddenGames({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const tz = ctx.d.group.timezone;
  const hidden = ctx.d.hiddenGames ?? [];
  async function restore(id: string, when: string) {
    setBusy(id);
    try {
      await api('POST', `/api/admin/sessions/${id}/hide-from-list`, { hidden: false });
      await ctx.reload();
      toast(`${when} is back on your lists`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  }
  return (
    <details className="advanced hidden-games" data-hidden-games>
      <summary>
        <span>
          Hidden games<span className="set-note"> · {hidden.length}</span>
        </span>
      </summary>
      {hidden.length === 0 ? (
        <p className="small muted">No games are hidden. Hide one from its card on Money, or the gear menu on Home.</p>
      ) : (
        <ul className="rows" aria-label="Hidden games">
          {hidden.map((h) => {
            const when = formatShortDate(h.startsAt, tz);
            return (
              <li key={h.id} data-hidden-game={h.id}>
                <span className="who">
                  <strong>{h.label}</strong>
                  <span className="small muted">{when} · Hidden from Games</span>
                </span>
                <button type="button" className="btn small secondary" disabled={busy === h.id} aria-label={`Restore ${h.label}, ${when}`} onClick={() => void restore(h.id, when)}>
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
