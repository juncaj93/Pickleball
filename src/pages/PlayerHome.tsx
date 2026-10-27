import { Fragment, useEffect, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { DEFAULT_TIMEZONE, formatMonthDay, formatShortDate, formatTimeRange, formatWeekday, localParts, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, setGroupKey, setViewAs, storageGet, storageSet, useLoad } from '../lib';
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

  useEffect(() => {
    if (load.data && groupKey && !viewAs) storageSet('pb_group_key', groupKey);
  }, [load.data, groupKey, viewAs]);

  const g = load.data;
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
  const sessions = g ? (showAll ? g.sessions : g.sessions.slice(0, SHOW_FIRST)) : [];

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
        action={
          g?.me && !pickName && !viewAs ? (
            <button className="topbar-btn" onClick={() => setSwitching(true)}>
              Not you?
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

function payLink(g: GroupView, cents: number, startsAt: string) {
  const note = `Pickleball ${formatShortDate(startsAt, g.group.timezone).replace(',', '')}`;
  return venmoPayUrl(g.group.venmoUrl, cents, note);
}

function PayButton({ g, cents, startsAt, compact }: { g: GroupView; cents: number; startsAt: string; compact?: boolean }) {
  const pay = payLink(g, cents, startsAt);
  if (!pay.url) return null;
  return (
    <a
      className={compact ? 'btn small pay-btn' : 'btn block'}
      href={pay.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Pay ${formatPrice(cents)} with Venmo`}
    >
      {compact ? 'Pay with Venmo' : `Pay ${formatPrice(cents)} with Venmo`}
    </a>
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
    const inNow = joined.result === 'confirmed' || joined.result === 'already_confirmed';
    return (
      <section className="card stack suggest" aria-label="Your answer">
        <h2>{joinedText(joined)}</h2>
        <p className="muted small">
          {formatShortDate(s.startsAt, tz)} · {formatTimeRange(s.startsAt, s.endsAt, tz)}
        </p>
        {inNow && joined.result !== 'standby' && <PayButton g={g} cents={g.group.priceCents} startsAt={s.startsAt} />}
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
      {venueNote && !confirmed ? ' · check venue hours' : ''}
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
 * One session in the schedule: date tile, time, court status and holiday,
 * who's in (only people who signed up), one big button, and this player's
 * money for it.
 */
function ScheduleRow({
  s,
  g,
  creditNote,
  onChanged,
}: {
  s: PlayerSessionView;
  g: GroupView;
  /** Credit waiting for a session they haven't joined yet; shown on the first upcoming row. */
  creditNote: number;
  onChanged: () => Promise<void>;
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
  const owed = g.owed.find((o) => o.sessionId === s.id);
  const who = g.group.organizerName ?? 'The organizer';

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
    <article className={`sched${s.canceled ? ' off' : ''}`} aria-labelledby={`s-${s.id}`}>
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

        {inSession && !s.canceled && (
          <div className="money" aria-label="Money for this session">
            {mine.paymentStatus === 'paid' ? (
              <span className="paid">✓ Paid</span>
            ) : mine.oweCents > 0 ? (
              <>
                <div className="owe-line">
                  <span>
                    <strong>You owe {formatPrice(mine.oweCents)}</strong>
                    {mine.creditCents > 0 && <span className="small muted"> (after {formatPrice(mine.creditCents)} credit)</span>}
                    {mine.discount && <span className="small muted"> · 6-person discount</span>}
                  </span>
                  <PayButton g={g} cents={mine.oweCents} startsAt={s.startsAt} compact />
                </div>
                {owed?.reminder && <p className="small muted">{who} may not have marked this paid yet. If you already paid, no action needed.</p>}
              </>
            ) : null}
          </div>
        )}
        {creditNote > 0 && <p className="small">Credit: {formatPrice(creditNote)} toward your next session.</p>}

        {inSession && open && (
          <a className="cal-link" href={`/api/sessions/${s.id}/calendar.ics`}>
            Add to Calendar
          </a>
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
