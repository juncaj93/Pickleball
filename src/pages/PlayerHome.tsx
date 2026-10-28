import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoNote, venmoPayUrl } from '../../shared/money';
import { DEFAULT_TIMEZONE, formatMonthDay, formatShortDate, formatTimeRange, formatWeekday, localParts, weekFade, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, isDemo, setGroupKey, setViewAs, storageGet, storageSet, useLoad, usePretend, setPretend, useRefreshOnReturn, copyText, demoOn, useDemoVersion } from '../lib';
import { ModeButton, TopBar } from '../Shell';
import { CalendarPlusIcon, ConfirmDialog, CourtIcon, Empty, ErrorState, NamesLine, Notice, SpotDots, Spinner, useToast } from '../ui';
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
 * every request carries the chosen player and it's look-only: taps say
 * "Demo only" and nothing is saved.
 */
export function PlayerHome({
  groupKey,
  viewAs,
  onExit,
  onViewAs,
  plain,
  onLinkOnly,
  onWordNeeded,
  topBar,
}: {
  groupKey: string | null;
  /** "View as...": the organizer's "Pretending it's..." bar, kept with the View as bar at the top. */
  topBar?: ReactNode;
  viewAs?: { id: string; name: string };
  onExit?: () => void;
  /** "View as...": "not you?" picked a different player to view as. Nothing is saved. */
  onViewAs?: (p: { id: string; name: string }) => void;
  /** Opened at the plain site address (no private link). */
  plain?: boolean;
  /** The organizer switched to link-only while this page was open. */
  onLinkOnly?: () => void;
  /** A group word is now needed on this phone. */
  onWordNeeded?: () => void;
}) {
  setGroupKey(viewAs ? null : groupKey);
  setViewAs(viewAs?.id ?? null);
  // Set again on mount (before the load below runs) and cleared on the way out.
  useEffect(() => {
    setViewAs(viewAs?.id ?? null);
    return () => setViewAs(null);
  }, [viewAs?.id]);
  const pretend = usePretend();
  // Pretend time is for the organizer's screens; the plain player page always runs on real time.
  useEffect(() => {
    if (!viewAs) setPretend(null);
  }, [viewAs]);
  const demo = useDemoVersion();
  const load = useLoad(() => api<GroupView>('GET', '/api/group'), [groupKey, viewAs?.id, pretend, demo]);
  useRefreshOnReturn(load.refresh);
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
  const choosing = !!g && (switching || (!viewAs && !g.me));
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

  const pickName = !!g && (switching || (!viewAs && !g.me));
  const tz = g?.group.timezone ?? DEFAULT_TIMEZONE;
  const sessions = g ? (showAll || focusIndex >= SHOW_FIRST ? g.sessions : g.sessions.slice(0, SHOW_FIRST)) : [];

  return (
    <>
      {/* "View as...": a small bar of its own above the player's real screen. */}
      {viewAs && (
        <div className="demo-bars">
          {topBar}
          <div className="viewas-banner" role="region" aria-label="Viewing as a player">
            <span>
              Viewing as <strong>{viewAs.name}</strong>
            </span>
            <button className="btn small" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      )}
      <TopBar
        eyebrow={g?.group.name ?? SITE_NAME}
        title={!g ? SITE_NAME : pickName ? 'Who are you?' : (g.me?.name ?? viewAs?.name ?? SITE_NAME)}
        titleExtra={
          g?.me && !pickName ? (
            <button className="not-you" aria-label="Not you?" onClick={() => setSwitching(true)}>
              not you?
            </button>
          ) : undefined
        }
        tools={<ModeButton preview={!!viewAs} />}
      />
      <main className="page stack-lg">
        {load.loading && !g && <Spinner />}
        {load.error && load.error.status !== 404 && <ErrorState error={load.error} onRetry={load.reload} />}

        {g && pickName && (
          <NamePicker
            g={g}
            demo={
              viewAs
                ? (p) => {
                    // Only changes who the organizer is viewing as; nothing is saved anywhere.
                    setSwitching(false);
                    onViewAs?.(p);
                    window.scrollTo(0, 0);
                  }
                : undefined
            }
            onPicked={async () => {
              setSwitching(false);
              await load.reload();
            }}
            onCancel={g.me ? () => setSwitching(false) : undefined}
          />
        )}

        {g && !pickName && (
          <>
            {g.payDue.length > 0 && <PayCard g={g} onChanged={load.reload} />}
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
            {/* The end of the page: just a thin line and a little space. */}
            <div className="page-end" aria-hidden="true" />
          </>
        )}
        {/* Organizer sign-in only on "Who are you?", never under the schedule. */}
        {plain && !viewAs && pickName && <OrganizerLink />}
      </main>
    </>
  );
}

function NamePicker({
  g,
  onPicked,
  onCancel,
  demo,
}: {
  g: GroupView;
  onPicked: () => void;
  onCancel?: () => void;
  /** "View as...": picking a name only switches the view. */
  demo?: (p: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  async function pick(playerId: string) {
    if (demo) {
      const p = g.players.find((x) => x.id === playerId);
      if (p) demo({ id: p.id, name: p.name });
      return;
    }
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
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="name-grid">
        {g.players.map((p) => (
          <button key={p.id} className={`btn ${g.me?.id === p.id ? '' : 'secondary'}`} disabled={busy} onClick={() => pick(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <button className="btn ghost block" onClick={() => (demo ? toast('Demo: adding a name is off while viewing as a player.') : setAdding(true))}>
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
 * "I tapped Pay" for these sign-ups, remembered on this phone only. It never
 * marks anyone paid; it only brings out the quiet "I paid" button. Keyed by
 * the sign-up time, so "I'm out" then "I'm in" again starts fresh.
 */
function useSent(playerId: string | undefined, signups: { sessionId: string; signupAt: string }[]) {
  const keys = signups.map((x) => `pb_sent_${playerId}_${x.sessionId}_${x.signupAt}`);
  const [, bump] = useState(0);
  return {
    sent: keys.length > 0 && keys.every((k) => storageGet(k) === '1'),
    markSent: () => {
      for (const k of keys) storageSet(k, '1');
      bump((n) => n + 1);
    },
  };
}

const PHONE = /iPhone|iPad|iPod|Android/i;

/**
 * Pay. This page never leaves its tab, so coming back lands right on it with
 * "I paid" ready. On a phone the Venmo app opens on top of it; on a computer
 * the Venmo website opens in a new tab (the link's target="_blank"). In the
 * organizer's demo nothing opens: "I paid" just shows, as it would.
 */
function openVenmo(e: React.MouseEvent<HTMLAnchorElement>, pay: { url: string | null; appUrl: string | null }) {
  if (demoOn()) {
    e.preventDefault();
    return;
  }
  if (!pay.appUrl || !pay.url || !PHONE.test(navigator.userAgent)) return;
  e.preventDefault();
  window.location.href = pay.appUrl;
}

/** "I paid" / "Didn't pay?": the player marks their own payment, for one session or several. */
function usePaid(sessionIds: string[], onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function set(paid: boolean) {
    setBusy(true);
    try {
      for (const id of sessionIds) await api('POST', `/api/sessions/${id}/paid`, { paid });
      toast(paid ? 'Marked paid' : 'Marked not paid');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  return { busy, set };
}

/**
 * Game day's payment card, at the very top: from 8:00 AM on game day until
 * the organizer marks it paid. Several unpaid sessions combine into one total
 * with one Venmo button. The button fills in the amount and a note like
 * "Pickleball Tue Nov 3 - Ryan" when Venmo allows it; otherwise the note shows
 * with Copy. Opening Venmo never marks anyone paid.
 */
function PayCard({ g, onChanged }: { g: GroupView; onChanged: () => Promise<void> }) {
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
  const { sent, markSent } = useSent(g.me?.id, due);
  const paid = usePaid(due.map((o) => o.sessionId), onChanged);
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
      {/* Pay always stays; "I paid" joins it, quiet, once they've tapped Pay. */}
      {pay.url ? (
        <>
          <a
            className="btn block big"
            href={pay.url}
            data-app-href={pay.appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Pay ${formatPrice(total)} with Venmo`}
            onClick={(e) => {
              markSent();
              openVenmo(e, pay);
            }}
          >
            Pay with Venmo
          </a>
          {sent && (
            <button className="btn block secondary" disabled={paid.busy} onClick={() => paid.set(true)}>
              {paid.busy ? 'Saving…' : 'I paid'}
            </button>
          )}
        </>
      ) : (
        <button className="btn block big" disabled={paid.busy} onClick={() => paid.set(true)}>
          {paid.busy ? 'Saving…' : 'I paid'}
        </button>
      )}
      {!pay.url && <p className="small muted">Pay {who} however you usually do.</p>}
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
    </section>
  );
}

/** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
function SuggestionCard({ g, onChanged }: { g: GroupView; onChanged: () => Promise<void> }) {
  const toast = useToast();
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
      if (isDemo(err)) toast(err.message);
      else setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
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

/**
 * "TUE / 3 / NOV" tile for the left of a schedule row, like a paper
 * calendar: red weekday, big dark day, small gray month. `mine` adds a small
 * green check in the corner (you're in).
 */
export function DateTile({ iso, tz, mine }: { iso: string; tz: string; mine?: boolean }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className={`tile${mine ? ' mine' : ''}`} aria-hidden="true">
      <span className="dow">{TILE_DOW[p.weekday]}</span>
      <span className="day">{p.day}</span>
      <span className="mon">{month}</span>
      {mine && (
        <span className="tile-check">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3.2 6.2 1.9 1.9 3.8-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
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
function RowPay({
  g,
  s,
  onTop,
  onChanged,
}: {
  g: GroupView;
  s: PlayerSessionView;
  onTop: boolean;
  onChanged: () => Promise<void>;
}) {
  const mine = s.mine!;
  const btn = 'btn small pay-small';
  const { sent, markSent } = useSent(g.me?.id, [{ sessionId: s.id, signupAt: mine.signupAt }]);
  const paid = usePaid([s.id], onChanged);
  if (mine.paymentStatus === 'paid') {
    return (
      <span className="paid-wrap">
        <span className="paid-tag">✓ Paid</span>
        {/* Only their own "I paid" can be undone here; the organizer's stays. */}
        {mine.selfPaid && (
          <button className="link-btn didnt-pay" disabled={paid.busy} onClick={() => paid.set(false)}>
            Didn't pay?
          </button>
        )}
      </span>
    );
  }
  if (onTop || mine.oweCents <= 0) return <span />;
  const pay = venmoPayUrl(g.group.venmoUrl, mine.oweCents, venmoNote(s.startsAt, g.group.timezone, g.me?.name));
  // No usable Venmo link: "I paid" is the only thing to tap.
  if (!pay.url) {
    return (
      <button className={btn} disabled={paid.busy} onClick={() => paid.set(true)}>
        I paid
      </button>
    );
  }
  // Pay always stays while they owe; a quiet "I paid" joins it once they've tapped Pay.
  return (
    <span className="pay-pair">
      <a
        className={btn}
        href={pay.url}
        data-app-href={pay.appUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Pay ${formatPrice(mine.oweCents)} with Venmo`}
        onClick={(e) => {
          markSent();
          openVenmo(e, pay);
        }}
      >
        Pay {formatPrice(mine.oweCents)}
      </a>
      {sent && (
        <button className="btn small secondary pay-small" disabled={paid.busy} onClick={() => paid.set(true)}>
          I paid
        </button>
      )}
    </span>
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
  onChanged,
  highlight,
}: {
  s: PlayerSessionView;
  g: GroupView;
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
  const askCheckIn = open && inSession && s.confirmationOpen && !mine.attendanceConfirmed;

  async function run(path: string, label: (data: any) => string) {
    setBusy(true);
    try {
      toast(label(await api<any>('POST', `/api/sessions/${s.id}/${path}`, {})));
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      setBusy(false);
      setAskOut(false);
    }
  }

  const court = courtStatus(s, tz);
  const goodNews = inSession && mine.promotion ? (s.courtState === 'opened' && mine.promotion === 'spot_opened' ? GOOD_NEWS.court_opened : GOOD_NEWS[mine.promotion]) : null;

  const names = s.confirmed.map((p) => p.name);
  const onTop = g.payDue.some((o) => o.sessionId === s.id);
  // Row 4 holds Pay (or Paid) and the calendar icon. With nothing to pay
  // there, the calendar icon sits at the end of the who's in row instead, so
  // the card stays short.
  const payShows = inSession && !s.canceled && (mine.paymentStatus === 'paid' || (!onTop && mine.oweCents > 0));
  const rowFour = payShows;
  const calLink = inSession && open && (
    <a className="cal-icon-link" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${formatShortDate(s.startsAt, tz)} to calendar`}>
      <CalendarPlusIcon />
    </a>
  );
  const showCount = !s.canceled && (s.confirmed.length > 0 || !courtWait);
  const fade = weekFade(s.startsAt, Date.parse(g.now), tz);

  return (
    <article
      id={`row-${s.id}`}
      className={`sched${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}`}
      data-fade={fade || undefined}
      data-mine={inSession && !s.canceled ? 'in' : undefined}
      data-holiday={s.holiday || s.extra ? 'yes' : undefined}
      aria-labelledby={`s-${s.id}`}
    >
      <DateTile iso={s.startsAt} tz={tz} mine={inSession && !s.canceled} />
      <div className="sched-body">
        <h2 id={`s-${s.id}`} className="sr-only">
          {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}
          {inSession && !s.canceled ? ". You're in" : ''}
        </h2>
        {/* Row 1: the time. */}
        <div className="sched-head">
          <span className="sched-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</span>
        </div>
        {/* The one button, in its own column beside rows 1 and 2. Sign-up never depends on the court being booked. */}
        {open && (
          <div className="sched-act">
            {inSession || waiting ? (
              <button className="btn secondary sched-btn" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
                I'm out
              </button>
            ) : (
              <button className={`btn sched-btn${courtWait || s.joinAs !== 'in' ? ' long' : ''}`} disabled={busy} aria-busy={busy} onClick={() => run('join', joinedText)}>
                {busy ? 'Saving…' : courtWait ? 'Join standby' : s.joinAs === 'in' ? "I'm in" : 'Join waitlist'}
              </button>
            )}
          </div>
        )}
        {/* Row 2: court status, with a holiday or "Extra game" as small colored words on the same line. */}
        <div className={`sched-status court-${court.kind}`} data-court={court.kind}>
          <span className="court-status">
            <CourtIcon kind={court.kind} />
            <span>{court.playerText}</span>
          </span>
          {s.holiday && <span className="holiday-text">{s.holiday}</span>}
          {s.extra && <span className="holiday-text extra-text">Extra game</span>}
        </div>
        {/* Row 3: "2 of 4 in", a dot per spot, and the names in plain text. */}
        {showCount && (
          <div className="in-line">
            <span className="in-count">{countLine(s)}</span>
            <SpotDots names={names} me={g.me?.name} />
            <NamesLine names={names} me={g.me?.name} />
            {!rowFour && calLink}
          </div>
        )}
        {!s.canceled && (s.waitlist.length > 0 || waiting) && (
          <p className="waitlist-line">
            {courtWait ? 'Standby' : 'Waitlist'}: {s.waitlist.map((w) => w.name).join(', ')}
            {waiting && <strong> · you're #{mine.waitlistPosition}</strong>}
          </p>
        )}

        {s.note && <p className="game-note">{s.note}</p>}
        {goodNews && <Notice tone="ok">{goodNews}</Notice>}
        {inSession && mine.creditComing && (
          <p className="small">6 are playing. You'll get a {formatPrice(g.group.creditCents)} credit toward your next session.</p>
        )}

        {/* A credit shows only on the game it comes off, and only while that game is unpaid (the pay card says it on game day). */}
        {inSession && !onTop && mine.oweCents > 0 && mine.creditCents > 0 && (
          <p className="small">
            {formatPrice(mine.oweCents)}, after your {formatPrice(mine.creditCents)} credit
          </p>
        )}

        {/* The day-before check-in, only while it's asked: a quiet button, so Pay stays the one green one. */}
        {askCheckIn && (
          <div className="confirm-row">
            <span className="small">Still coming?</span>
            <button className="btn small secondary pay-small" disabled={busy} onClick={() => run('confirm', () => 'See you there')}>
              Yes, I'm coming
            </button>
          </div>
        )}

        {/* Row 4, only when needed: Pay (the card's one green button) and the calendar icon. */}
        {rowFour && (
          <div className="row-foot">
            <RowPay g={g} s={s} onTop={onTop} onChanged={onChanged} />
            {calLink}
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
