import { Fragment, useEffect, useRef, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoNote, venmoPayUrl } from '../../shared/money';
import { DEFAULT_TIMEZONE, formatMonthDay, formatShortDate, formatTimeRange, formatWeekday, localParts, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, setGroupKey, setViewAs, storageGet, storageSet, useLoad, copyText } from '../lib';
import { TopBar } from '../Shell';
import { ConfirmDialog, CourtIcon, Empty, SpotPills, ErrorState, Notice, Spinner, useToast } from '../ui';
import { courtStatus } from '../../shared/court';
import { OrganizerLink } from './SiteHome';

const SHOW_FIRST = 6;

type JoinResponse = { result: 'confirmed' | 'already_confirmed' | 'waitlisted' | 'standby'; position?: number; madeSix?: boolean };

const GOOD_NEWS = {
  made_six: "Good news, we now have 6, an even number, so you're in.",
  spot_opened: "Good news, a spot opened up, so you're in.",
  court_opened: "Good news, the court opened, so you're in.",
};

function joinedText(d: JoinResponse): string {
  if (d.result === 'waitlisted') return `You're #${d.position} on the waitlist`;
  if (d.result === 'standby') return `You're on standby, #${d.position}`;
  return d.madeSix ? GOOD_NEWS.made_six : "You're in";
}

/**
 * The player's one screen. Also used by the organizer's "View as...", where
 * every request carries the chosen player and taps really happen for them.
 */
export function PlayerHome({
  groupKey,
  viewAs,
  onExit,
  plain,
  onLinkOnly,
  onWordNeeded,
}: {
  groupKey: string | null;
  viewAs?: { id: string; name: string };
  onExit?: () => void;
  /** Opened at the plain site address (no private link). */
  plain?: boolean;
  /** The organizer switched to link-only while this page was open. */
  onLinkOnly?: () => void;
  /** A group word is now needed on this phone. */
  onWordNeeded?: () => void;
}) {
  setGroupKey(viewAs ? null : groupKey);
  setViewAs(viewAs?.id ?? null);
  useEffect(() => () => setViewAs(null), []);
  const load = useLoad(() => api<GroupView>('GET', '/api/group'), [groupKey, viewAs?.id]);
  const [switching, setSwitching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // A shared link like ?s=<session id> opens with that session highlighted.
  const [focusId] = useState(() => new URLSearchParams(window.location.search).get('s'));
  const scrolled = useRef(false);

  useEffect(() => {
    if (load.data && groupKey && !viewAs) storageSet('pb_group_key', groupKey);
  }, [load.data, groupKey, viewAs]);

  const g = load.data;
  // Scroll to a shared session once the schedule shows (after picking a name).
  const focusIndex = g && focusId ? g.sessions.findIndex((s) => s.id === focusId) : -1;
  const choosing = !!g && !viewAs && (!g.me || switching);
  useEffect(() => {
    if (!g || choosing || focusIndex < 0 || scrolled.current) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById(`row-${focusId}`)?.scrollIntoView({ block: 'center' }));
  }, [g, choosing, focusIndex, focusId]);
  useEffect(() => {
    if (!plain || !load.error) return;
    if (load.error.status === 404) onLinkOnly?.();
    if (load.error.status === 403) onWordNeeded?.();
  }, [plain, load.error, onLinkOnly, onWordNeeded]);
  if (plain && (load.error?.status === 404 || load.error?.status === 403)) return <Spinner />;
  if (load.error?.status === 404 && !viewAs) {
    return (
      <>
        <TopBar eyebrow={SITE_NAME} title="Link not working" />
        <main className="page">
          <Notice tone="danger" title="This group link isn't valid">
            It may have been replaced with a new one. Ask the organizer for the current link.
          </Notice>
        </main>
      </>
    );
  }

  const pickName = !!g && !viewAs && (!g.me || switching);
  const tz = g?.group.timezone ?? DEFAULT_TIMEZONE;
  const sessions = g ? (showAll || focusIndex >= SHOW_FIRST ? g.sessions : g.sessions.slice(0, SHOW_FIRST)) : [];

  return (
    <>
      {viewAs && (
        <div className="viewas-banner" role="status">
          <span>
            Viewing as <strong>{viewAs.name}</strong>
          </span>
          <button className="btn small" onClick={onExit}>
            Exit
          </button>
        </div>
      )}
      <TopBar
        eyebrow={g?.group.name ?? SITE_NAME}
        title={!g ? SITE_NAME : pickName ? 'Who are you?' : `Welcome, ${g.me?.name ?? viewAs?.name}`}
        titleExtra={
          g?.me && !pickName && !viewAs ? (
            <button className="not-you" aria-label="Not you?" onClick={() => setSwitching(true)}>
              not you?
            </button>
          ) : undefined
        }
      />
      <main className="page stack-lg">
        {load.loading && !g && <Spinner />}
        {load.error && load.error.status !== 404 && <ErrorState error={load.error} onRetry={load.reload} />}

        {g && pickName && (
          <NamePicker
            g={g}
            onPicked={async () => {
              setSwitching(false);
              await load.reload();
            }}
            onCancel={g.me ? () => setSwitching(false) : undefined}
          />
        )}

        {g && !pickName && (
          <>
            {g.payDue.length > 0 && <PayCard g={g} />}
            {g.suggestion && <SuggestionCard key={g.suggestion.sessionId} g={g} onChanged={load.reload} />}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            <div className="schedule">
              {sessions.map((s, i) => (
                <Fragment key={s.id}>
                  {(i === 0 || weekStart(s.startsAt, tz) !== weekStart(sessions[i - 1].startsAt, tz)) && (
                    <h3 className="week-break">{weekLabel(s.startsAt, Date.parse(g.now), tz)}</h3>
                  )}
                  <ScheduleRow
                    s={s}
                    g={g}
                    highlight={s.id === focusId}
                    creditNote={s.id === g.sessions.find((x) => !x.past)?.id ? g.creditBalanceCents : 0}
                    onChanged={load.reload}
                  />
                </Fragment>
              ))}
            </div>
            {g.sessions.length > SHOW_FIRST && (
              <button className="btn ghost block" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `More sessions (${g.sessions.length - SHOW_FIRST})`}
              </button>
            )}
            {!viewAs && g.me && <CalendarSubscribe />}
            {!viewAs && <HomeScreenTip />}
          </>
        )}
        {plain && !viewAs && <OrganizerLink />}
      </main>
    </>
  );
}

function NamePicker({ g, onPicked, onCancel }: { g: GroupView; onPicked: () => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  async function pick(playerId: string) {
    setBusy(true);
    try {
      await api('POST', '/api/me', { playerId });
      onPicked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }
  if (adding) return <AddMyName onPick={pick} onDone={onPicked} onBack={() => setAdding(false)} />;
  return (
    <section className="stack" aria-label="Pick your name">
      <p className="muted">Tap your name. This phone remembers it.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="name-grid">
        {g.players.map((p) => (
          <button key={p.id} className={`btn ${g.me?.id === p.id ? '' : 'secondary'}`} disabled={busy} onClick={() => pick(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <button className="btn ghost block" onClick={() => setAdding(true)}>
        Add my name
      </button>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  );
}

type AddStep = { step: 'name' } | { step: 'is_this_you'; matches: { id: string; name: string }[] } | { step: 'days' };

/** Not on the list: type a name, check it isn't a duplicate, then pick preferred days. */
function AddMyName({ onPick, onDone, onBack }: { onPick: (id: string) => Promise<void>; onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [state, setState] = useState<AddStep>({ step: 'name' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(confirmNew: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ result: 'added' | 'looks_like'; matches?: { id: string; name: string }[] }>('POST', '/api/players/self', {
        name,
        confirmNew,
      });
      setState(res.result === 'looks_like' ? { step: 'is_this_you', matches: res.matches ?? [] } : { step: 'days' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add your name.');
      setState({ step: 'name' });
    } finally {
      setBusy(false);
    }
  }

  async function days(d: number[]) {
    setBusy(true);
    try {
      if (d.length) await api('PUT', '/api/me/days', { days: d });
    } catch {
      /* the name is saved either way; days can be set later by the organizer */
    } finally {
      setBusy(false);
      onDone();
    }
  }

  if (state.step === 'is_this_you') {
    return (
      <section className="stack" aria-label="Is this you?">
        <h2>Is this you?</h2>
        <div className="name-grid">
          {state.matches.map((m) => (
            <button key={m.id} className="btn secondary" disabled={busy} onClick={() => onPick(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
        <button className="btn block" disabled={busy} onClick={() => submit(true)}>
          No, I'm new
        </button>
      </section>
    );
  }

  if (state.step === 'days') {
    return (
      <section className="stack" aria-label="Preferred days">
        <h2>Any preferred days?</h2>
        <div className="name-grid">
          <button className="btn secondary" disabled={busy} onClick={() => days([2])}>
            Tuesday
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => days([4])}>
            Thursday
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => days([2, 4])}>
            Both
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => days([])}>
            Skip
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="stack"
      aria-label="Add my name"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void submit(false);
      }}
    >
      <label className="field">
        Your name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" autoFocus required />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn block" type="submit" disabled={busy || !name.trim()}>
        Continue
      </button>
      <button className="btn ghost block" type="button" onClick={onBack}>
        Back
      </button>
    </form>
  );
}

/**
 * A small tip at the very end of the page, shown once per phone and never
 * inside the Home Screen app itself.
 */
function HomeScreenTip() {
  const [show, setShow] = useState(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !standalone && !storageGet('pb_seen_a2hs');
  });
  if (!show) return null;
  return (
    <div className="footer-tip" role="note" aria-label="Add to Home Screen">
      <p>Tip: add Pickleball to your Home Screen. Tap Share, then Add to Home Screen, then Add.</p>
      <button
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => {
          storageSet('pb_seen_a2hs', '1');
          setShow(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function HomeScreenSteps() {
  return (
    <ol className="steps small">
      <li>Tap the Share button.</li>
      <li>Tap Add to Home Screen.</li>
      <li>Tap Add.</li>
    </ol>
  );
}

/**
 * "I tapped Pay with Venmo" for these sessions, remembered on this phone only.
 * It never marks anyone paid; only the organizer's Mark paid does.
 */
function useSent(playerId: string | undefined, sessionIds: string[]) {
  const keys = sessionIds.map((id) => `pb_sent_${playerId}_${id}`);
  const [sent, setSent] = useState(() => keys.length > 0 && keys.every((k) => storageGet(k) === '1'));
  return {
    sent,
    markSent: () => {
      for (const k of keys) storageSet(k, '1');
      setSent(true);
    },
  };
}

/** Quiet note after tapping Pay: the organizer confirms. */
function SentNote({ g }: { g: GroupView }) {
  const who = g.group.organizerName ?? 'The organizer';
  return <span className="sent-note">Sent? {who} confirms when it arrives.</span>;
}

/**
 * Game day's payment card, at the very top: from 8:00 AM on game day until
 * the organizer marks it paid. Several unpaid sessions combine into one total
 * with one Venmo button. The button fills in the amount and a note like
 * "Pickleball Tue Nov 3 - Ryan" when Venmo allows it; otherwise the note shows
 * with Copy. Opening Venmo never marks anyone paid.
 */
function PayCard({ g }: { g: GroupView }) {
  const toast = useToast();
  const tz = g.group.timezone;
  const due = g.payDue;
  const total = due.reduce((sum, o) => sum + o.amountCents, 0);
  const note = venmoNote(
    due.map((o) => o.startsAt),
    tz,
    g.me?.name,
  );
  const pay = venmoPayUrl(g.group.venmoUrl, total, note);
  const { sent, markSent } = useSent(g.me?.id, due.map((o) => o.sessionId));
  const todayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const tonight = due.length === 1 && todayKey(due[0].startsAt) === todayKey(g.now);
  const title =
    due.length > 1 ? `You owe ${formatPrice(total)} total` : tonight ? `Tonight: you owe ${formatPrice(total)}` : `You owe ${formatPrice(total)} for ${formatShortDate(due[0].startsAt, tz)}`;
  const detail = (o: (typeof due)[number]) =>
    [o.discount ? '6-person discount' : null, o.creditCents > 0 ? `after your ${formatPrice(o.creditCents)} credit` : null].filter(Boolean).join(', ');
  const who = g.group.organizerName ?? 'The organizer';
  return (
    <section className="card pay-card" aria-label="Payment">
      <h2>{title}</h2>
      {due.length > 1 ? (
        <ul className="pay-list">
          {due.map((o) => (
            <li key={o.sessionId}>
              {formatShortDate(o.startsAt, tz)}: {formatPrice(o.amountCents)}
              {detail(o) && <span className="muted"> ({detail(o)})</span>}
            </li>
          ))}
        </ul>
      ) : (
        detail(due[0]) && (
          <p className="small">
            {formatPrice(due[0].amountCents)}, {detail(due[0])}
          </p>
        )
      )}
      {pay.url && sent ? (
        <p className="small">
          <SentNote g={g} />{' '}
          <a className="link-btn inline" href={pay.url} target="_blank" rel="noopener noreferrer">
            Open Venmo again
          </a>
        </p>
      ) : pay.url ? (
        <a
          className="btn block big"
          href={pay.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Pay ${formatPrice(total)} with Venmo`}
          onClick={markSent}
        >
          Pay with Venmo
        </a>
      ) : (
        <p className="small muted">Pay {who} however you usually do.</p>
      )}
      {pay.url && !pay.prefilled && (
        <div className="venmo-note">
          <span className="small">
            Send {formatPrice(total)} with the note <strong>{note}</strong>
          </span>
          <button className="btn small secondary" onClick={async () => ((await copyText(note)) ? toast('Note copied') : toast("Couldn't copy the note.", 'error'))}>
            Copy note
          </button>
        </div>
      )}
      {due.some((o) => o.reminder) && <p className="small muted">{who} may not have marked this paid yet. If you already paid, no action needed.</p>}
    </section>
  );
}

/** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
function SuggestionCard({ g, onChanged }: { g: GroupView; onChanged: () => Promise<void> }) {
  const s = g.suggestion!;
  const tz = g.group.timezone;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<JoinResponse | null>(null);

  async function answer(yes: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (yes) setJoined(await api<JoinResponse>('POST', `/api/sessions/${s.sessionId}/join`, {}));
      else {
        await api('POST', `/api/sessions/${s.sessionId}/decline`, {});
        await onChanged();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <section className="card stack suggest" aria-label="Your answer">
        <h2>{joinedText(joined)}</h2>
        <p className="muted small">
          {formatShortDate(s.startsAt, tz)} · {formatTimeRange(s.startsAt, s.endsAt, tz)}
        </p>
        <button className="btn secondary block" onClick={() => void onChanged()}>
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="card stack suggest" aria-labelledby="suggest-title">
      <h2 id="suggest-title">Want in on {formatWeekday(s.startsAt, tz)}?</h2>
      {s.holiday && <HolidayPill name={s.holiday} />}
      <p className="muted small">
        {formatShortDate(s.startsAt, tz)} · {formatTimeRange(s.startsAt, s.endsAt, tz)}
        {s.joinAs === 'waitlist' ? ' · full, you would join the waitlist' : ''}
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => answer(true)}>
          Yes
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => answer(false)}>
          No
        </button>
      </div>
    </section>
  );
}

export function HolidayPill({ name, venueNote, confirmed }: { name: string; venueNote?: boolean; confirmed?: boolean }) {
  return (
    <span className="holiday">
      {confirmed && <span aria-label="venue hours confirmed">✓ </span>}
      {name}
      {venueNote && !confirmed ? ' · check hours' : ''}
    </span>
  );
}

const TILE_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "TUE / 3 / NOV" tile for the left of a schedule row. */
export function DateTile({ iso, tz }: { iso: string; tz: string }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className="tile" aria-hidden="true">
      <span className="dow">{TILE_DOW[p.weekday]}</span>
      <span className="day">{p.day}</span>
      <span className="mon">{month}</span>
    </div>
  );
}

function countLine(s: PlayerSessionView): string {
  const n = s.confirmed.length;
  if (s.courtState === 'waitlist') return `${s.waitlist.length} on standby`;
  if (n === 5) return '5 in · need 4 or 6';
  return n > 4 ? `${n} of 6 in` : `${n} of 4 in`;
}

/**
 * The row's money, kept small: "Pay $14" after signing up (with the Venmo
 * note filled in), then a quiet "Sent?" note once tapped, or "Paid" once the
 * organizer marks it. On game day after 8:00 AM the card at the top takes over.
 */
function RowPay({ g, s, onTop }: { g: GroupView; s: PlayerSessionView; onTop: boolean }) {
  const mine = s.mine!;
  const { sent, markSent } = useSent(g.me?.id, [s.id]);
  if (mine.paymentStatus === 'paid') return <span className="paid-tag">✓ Paid</span>;
  if (onTop || mine.oweCents <= 0) return <span />;
  if (sent) return <SentNote g={g} />;
  const pay = venmoPayUrl(g.group.venmoUrl, mine.oweCents, venmoNote(s.startsAt, g.group.timezone, g.me?.name));
  if (!pay.url) return <span />;
  return (
    <a
      className="btn small pay-small"
      href={pay.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Pay ${formatPrice(mine.oweCents)} with Venmo`}
      onClick={markSent}
    >
      Pay {formatPrice(mine.oweCents)}
    </a>
  );
}

/**
 * One session in the schedule: date tile, time, court status and holiday,
 * who's in (only people who signed up), one big button, and this player's
 * money for it.
 */
function ScheduleRow({
  s,
  g,
  creditNote,
  onChanged,
  highlight,
}: {
  s: PlayerSessionView;
  g: GroupView;
  /** Credit waiting for a session they haven't joined yet; shown on the first upcoming row. */
  creditNote: number;
  onChanged: () => Promise<void>;
  /** Opened from a shared link to this session. */
  highlight?: boolean;
}) {
  const tz = g.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [askOut, setAskOut] = useState(false);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waiting = mine?.status === 'waitlisted';
  const courtWait = s.courtState === 'waitlist';
  const open = !s.canceled && !s.started;

  async function run(path: string, label: (data: any) => string) {
    setBusy(true);
    try {
      toast(label(await api<any>('POST', `/api/sessions/${s.id}/${path}`, {})));
      await onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      setBusy(false);
      setAskOut(false);
    }
  }

  const court = courtStatus(s, tz);
  const goodNews = inSession && mine.promotion ? (s.courtState === 'opened' && mine.promotion === 'spot_opened' ? GOOD_NEWS.court_opened : GOOD_NEWS[mine.promotion]) : null;

  return (
    <article id={`row-${s.id}`} className={`sched${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}`} aria-labelledby={`s-${s.id}`}>
      <DateTile iso={s.startsAt} tz={tz} />
      <div className="sched-body">
        <h2 id={`s-${s.id}`} className="sr-only">
          {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}
        </h2>
        <div className="sched-head">
          <div className="sched-when">
            <span className="sched-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</span>
            {inSession && !s.canceled && <span className="me-tag">You're in</span>}
            {waiting && !s.canceled && <span className="me-tag outline">{courtWait ? 'Standby' : 'Waitlist'} #{mine.waitlistPosition}</span>}
          </div>
          {/* Sign-up never depends on the court being booked. */}
          {open &&
            (inSession || waiting ? (
              <button className="btn secondary sched-btn" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
                I'm out
              </button>
            ) : (
              <button className="btn sched-btn" disabled={busy} aria-busy={busy} onClick={() => run('join', joinedText)}>
                {busy ? 'Saving…' : courtWait ? 'Join standby' : s.joinAs === 'in' ? "I'm in" : 'Join waitlist'}
              </button>
            ))}
        </div>
        <div className={`sched-status court-${court.kind}`} data-court={court.kind}>
          <span className="court-status">
            <CourtIcon kind={court.kind} />
            <span>{court.playerText}</span>
          </span>
          {s.holiday && <HolidayPill name={s.holiday} />}
        </div>

        {goodNews && <Notice tone="ok">{goodNews}</Notice>}
        {inSession && mine.creditComing && (
          <p className="small">6 are playing. You'll get a {formatPrice(g.group.creditCents)} credit toward your next session.</p>
        )}

        {!s.canceled && (s.confirmed.length > 0 || !courtWait) && (
          <div className="in-line">
            <span className="in-count">{countLine(s)}</span>
            <SpotPills names={s.confirmed.map((p) => p.name)} me={g.me?.name} />
          </div>
        )}
        {!s.canceled && s.waitlist.length > 0 && (
          <p className="waitlist-line">
            {courtWait ? 'Standby' : 'Waitlist'}: {s.waitlist.map((w) => w.name).join(', ')}
          </p>
        )}

        {open && inSession && s.confirmationOpen && !mine.attendanceConfirmed && (
          <div className="spread" style={{ alignItems: 'center' }}>
            <span className="small">Still coming?</span>
            <button className="btn small" disabled={busy} onClick={() => run('confirm', () => 'See you there')}>
              Yes, I'm coming
            </button>
          </div>
        )}

        {creditNote > 0 && <p className="small">Credit: {formatPrice(creditNote)} toward your next session.</p>}

        {inSession && !s.canceled && (
          <div className="row-foot">
            <RowPay g={g} s={s} onTop={g.payDue.some((o) => o.sessionId === s.id)} />
            {open && (
              <a className="cal-link" href={`/api/sessions/${s.id}/calendar.ics`}>
                Add to Calendar
              </a>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={askOut}
        title={waiting ? (courtWait ? 'Leave standby?' : 'Leave the waitlist?') : `Out for ${formatShortDate(s.startsAt, tz)}?`}
        body={waiting ? 'You lose your place in line.' : 'Your spot opens up for someone else.'}
        confirmLabel="I'm out"
        danger
        busy={busy}
        onConfirm={() => run('withdraw', () => "You're out")}
        onCancel={() => setAskOut(false)}
      />
    </article>
  );
}

/**
 * "Subscribe in Apple Calendar": a private link listing only this player's
 * sessions. Their phone keeps it up to date with new times and cancellations.
 */
function CalendarSubscribe() {
  const toast = useToast();
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await api<{ off: boolean; webcal?: string }>('GET', '/api/me/calendar');
      if (res.off || !res.webcal) setOff(true);
      else window.location.href = res.webcal;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't make the calendar link.", 'error');
    } finally {
      setBusy(false);
    }
  }
  return <SubscribeBlock busy={busy} off={off} onTap={go} />;
}

export function SubscribeBlock({ busy, off, onTap, label = 'Subscribe in Apple Calendar' }: { busy: boolean; off?: boolean; onTap: () => void; label?: string }) {
  return (
    <div className="subscribe">
      <button className="link-btn" disabled={busy} onClick={onTap}>
        {busy ? 'Getting your link…' : label}
      </button>
      <p className="small muted">
        {off
          ? 'Your calendar link is turned off. Ask the organizer.'
          : 'Apple Calendar refreshes subscribed calendars on its own schedule, so changes can take a while to show.'}
      </p>
    </div>
  );
}
