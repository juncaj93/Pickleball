import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoNote, venmoPayUrl } from '../../shared/money';
import { creditBackNote } from '../../shared/pricing';
import { DEFAULT_TIMEZONE, playerDay, wantInSubline, wantInTitle, formatMonthDay, formatShortDate, formatTimeRange, formatTimeShort, formatWeekday, localParts, ordinal, weekTier, type WeekTier } from '../../shared/time';
import { creditHintText, creditUsedMessage } from '../../shared/credit';
import { CreditChip, CreditSheet } from './CreditSheet';
import { api, ApiError, isDemo, setGroupKey, setViewAs, storageSet, useLoad, usePretend, setPretend, useRefreshOnReturn, copyText, openVenmo, useDemoVersion } from '../lib';
import { ModeButton, TopBar } from '../Shell';
import { CalendarPlusIcon, ConfirmDialog, Empty, ErrorState, NamesLine, Notice, SpotDots, Spinner, useToast } from '../ui';
import { courtStatus } from '../../shared/court';
import { OrganizerLink } from './SiteHome';
import '../credit-player.css';
import '../player-cards.css';

const SHOW_FIRST = 6;

const TIER_LABEL: Record<WeekTier, string> = { this: 'This week', next: 'Next week', later: 'Later' };

type JoinResponse = { result: 'confirmed' | 'already_confirmed' | 'waitlisted' | 'standby'; position?: number };

const GOOD_NEWS = {
  spot_opened: "Good news, a spot opened up, so you're in.",
  court_opened: "Good news, the court opened, so you're in.",
};

function joinedText(d: JoinResponse): string {
  if (d.result === 'waitlisted') return `You're #${d.position} on the waitlist`;
  if (d.result === 'standby') return `You're on standby, #${d.position}`;
  return "You're in";
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
  const [creditOpen, setCreditOpen] = useState(false);
  // The "Want in?" answer ("You're in" + Done) lives here, so the game cards below can refresh at once.
  const [answered, setAnswered] = useState<{ sessionId: string; text: string; startsAt: string; endsAt: string } | null>(null);
  // A shared link like ?s=<session id> opens with that session highlighted.
  const [focusId] = useState(() => new URLSearchParams(window.location.search).get('s'));
  const scrolled = useRef(false);
  // The credit the last screen showed, so a chip that appears later can count up from it.
  const lastBalance = useRef<number | null>(null);

  useEffect(() => {
    if (load.data && groupKey && !viewAs) storageSet('pb_group_key', groupKey);
  }, [load.data, groupKey, viewAs]);

  const g = load.data;
  const balance = g && (switching || (!viewAs && !g.me)) ? null : (g?.credit.balanceCents ?? null);
  useEffect(() => {
    if (balance !== null) lastBalance.current = balance;
  }, [balance]);
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
  const showChip = !!g && !pickName && (g.credit.balanceCents > 0 || !!g.credit.pending);
  const chipStart = lastBalance.current;
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
        chip={showChip ? <CreditChip credit={g.credit} startFrom={chipStart} onOpen={() => setCreditOpen(true)} /> : undefined}
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
            {answered ? (
              <section className="card stack suggest" aria-label="Your answer">
                <h2>{answered.text}</h2>
                <p className="muted small">
                  {formatShortDate(answered.startsAt, tz)} · {formatTimeShort(answered.startsAt, answered.endsAt, tz)}
                </p>
                <button className="btn secondary block" onClick={() => setAnswered(null)}>
                  Done
                </button>
              </section>
            ) : (
              g.suggestion && <SuggestionCard key={g.suggestion.sessionId} g={g} onChanged={load.reload} onJoined={setAnswered} />
            )}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            <div className="schedule">
              {sessions.map((s, i) => {
                const tier = weekTier(s.startsAt, Date.parse(g.now), tz);
                const prev = i > 0 ? weekTier(sessions[i - 1].startsAt, Date.parse(g.now), tz) : null;
                // One header per tier: THIS WEEK, NEXT WEEK, LATER (every week after next shares one).
                const header = prev !== tier ? TIER_LABEL[tier] : null;
                return (
                  <Fragment key={s.id}>
                    {header && <h3 className={`week-break tier-${tier}`}>{header}</h3>}
                    <ScheduleRow s={s} g={g} tier={tier} highlight={s.id === focusId} onChanged={load.reload} />
                  </Fragment>
                );
              })}
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
      {g && <CreditSheet open={creditOpen && showChip} credit={g.credit} tz={tz} organizerName={g.group.organizerName ?? 'Alex'} onClose={() => setCreditOpen(false)} onChanged={load.reload} />}
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
 * Players with credit don't see "I paid" until they tap Pay (Venmo opened).
 * Remembered on this phone, per game.
 */
function usePayTapped(key: string) {
  const storeKey = `pb_pay_tapped_${key}`;
  const read = () => {
    try {
      return localStorage.getItem(storeKey) === '1';
    } catch {
      return false;
    }
  };
  const [tapped, setTapped] = useState(read);
  useEffect(() => setTapped(read()), [storeKey]);
  function mark() {
    setTapped(true);
    try {
      localStorage.setItem(storeKey, '1');
    } catch {
      /* the button simply shows for this visit */
    }
  }
  return { tapped, mark };
}

/**
 * "Use credit": takes the player's credit off the games they owe for, only
 * when they tap. One call per game, earliest first; it stops when a call fails
 * or the credit is used up.
 */
function useCredit(onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function use(sessionIds: string[], owedCents: number, potCents: number) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    let used = 0;
    try {
      let left = potCents;
      let potBefore = 0;
      let owedBefore = 0;
      for (const id of sessionIds) {
        if (left <= 0) break;
        const res = await api<{ ok: boolean; usedCents: number; paid: boolean; potBeforeCents: number; owedBeforeCents: number }>('POST', `/api/sessions/${id}/use-credit`, {});
        if (potBefore === 0) potBefore = res.potBeforeCents;
        owedBefore += res.owedBeforeCents;
        used += res.usedCents;
        left -= res.usedCents;
      }
      // Games the credit never reached still count as owed.
      owedBefore = Math.max(owedBefore, owedCents);
      if (used > 0) toast(creditUsedMessage(used, potBefore, owedBefore));
      else toast('No credit to use right now.');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  /** "Undo" under "Paid with credit": the credit goes back, the game is owed again. */
  async function undo(sessionId: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await api('POST', `/api/sessions/${sessionId}/undo-credit`, {});
      toast('Credit put back');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, use, undo };
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
  const paid = usePaid(due.map((o) => o.sessionId), onChanged);
  const credit = useCredit(onChanged);
  const payTap = usePayTapped(due.map((o) => o.sessionId).join('_'));
  // Spend the pot on the earliest game first; each game takes the smaller of what is left and what it costs.
  const dueByDate = [...due].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  let potLeft = g.credit.usableCents;
  let covered = 0;
  for (const o of dueByDate) {
    const take = Math.max(Math.min(potLeft, o.amountCents), 0);
    covered += take;
    potLeft -= take;
  }
  const showCredit = g.credit.usableCents > 0 && covered > 0;
  // Whenever there is credit to use, "Use credit" is the filled button and Pay is its outline twin (same as on the cards).
  const creditCovers = showCredit;
  const busy = paid.busy || credit.busy;
  const creditBtn = showCredit && (
    <button
      className={`btn block ${creditCovers ? 'big' : 'secondary'}`}
      data-use-credit
      disabled={busy}
      onClick={() => credit.use(dueByDate.map((o) => o.sessionId), total, g.credit.usableCents)}
    >
      {credit.busy ? 'Saving…' : 'Use credit'}
    </button>
  );
  const todayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const tonight = due.length === 1 && todayKey(due[0].startsAt) === todayKey(g.now);
  const title =
    due.length > 1 ? `You owe ${formatPrice(total)} total` : tonight ? `Tonight: you owe ${formatPrice(total)}` : `You owe ${formatPrice(total)} for ${formatShortDate(due[0].startsAt, tz)}`;
  const detail = (o: (typeof due)[number]) =>
    [o.finalized ? 'final price' : null, o.creditCents > 0 ? `after your ${formatPrice(o.creditCents)} credit` : null].filter(Boolean).join(', ');
  // (On this card the amounts are already after any credit; each game's own line says what is left.)
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
      {/* Pay, and a quiet "I paid" right with it for anyone who paid another way (Apple Cash, cash). */}
      {pay.url ? (
        <>
          {creditCovers && creditBtn}
          <a
            className={`btn block ${creditCovers ? 'secondary' : 'big'}`}
            href={pay.url}
            data-app-href={pay.appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Pay ${formatPrice(total)} with Venmo`}
            onClick={(e) => {
              payTap.mark();
              openVenmo(e, pay);
            }}
          >
            Pay with Venmo
          </a>
          {!creditCovers && creditBtn}
          {(!showCredit || payTap.tapped) && (
            <button className="btn block secondary" disabled={busy} onClick={() => paid.set(true)}>
              {paid.busy ? 'Saving…' : 'I paid'}
            </button>
          )}
        </>
      ) : (
        <>
          {creditCovers && creditBtn}
          <button className={`btn block ${creditCovers ? 'secondary' : 'big'}`} disabled={busy} onClick={() => paid.set(true)}>
            {paid.busy ? 'Saving…' : 'I paid'}
          </button>
          {!creditCovers && creditBtn}
        </>
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
function SuggestionCard({ g, onChanged, onJoined }: { g: GroupView; onChanged: () => Promise<void>; onJoined: (a: { sessionId: string; text: string; startsAt: string; endsAt: string }) => void }) {
  const toast = useToast();
  const s = g.suggestion!;
  const tz = g.group.timezone;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // At the max they would wait. On the venue's court waitlist everyone goes on standby, so no count.
  const standby = s.courtState === 'waitlist';
  const waitlistForm = !standby && s.confirmedCount >= g.group.maxPlayers;
  const subline = standby ? '' : wantInSubline(s.confirmedCount, g.group.maxPlayers);

  async function answer(yes: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (yes) {
        // The same call, the same banner and the same refresh as tapping "I'm in" on that game.
        const res = await api<JoinResponse>('POST', `/api/sessions/${s.sessionId}/join`, {});
        toast(joinedText(res));
        onJoined({ sessionId: s.sessionId, text: joinedText(res), startsAt: s.startsAt, endsAt: s.endsAt });
        await onChanged();
      } else {
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

  return (
    <section className="card stack suggest" aria-labelledby="suggest-title">
      <h2 id="suggest-title">{wantInTitle(s.startsAt, tz, Date.parse(g.now), waitlistForm)}</h2>
      {/* Line 1: date and time. Line 2: spots left, or where they would be. */}
      <div className="suggest-when">
        <span className="muted small">
          {formatShortDate(s.startsAt, tz)} · {formatTimeShort(s.startsAt, s.endsAt, tz)}
        </span>
      </div>
      {subline && <p className="muted small suggest-sub">{subline}</p>}
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

/** The organizer's small plain holiday note ("Election Day \u00b7 check hours"). Players no longer see holidays. */
export function HolidayPill({ name, venueNote, confirmed }: { name: string; venueNote?: boolean; confirmed?: boolean }) {
  return (
    <span className="holiday">
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

const CHECK = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The player card's date tile. Normal: weekday, big day, month. Tonight: a
 * blue TONIGHT strip where the weekday would be. Extra (added by hand): an
 * ink tile (cream in dark mode). A check badge on the corner when you're in.
 */
function PlayerTile({ iso, tz, mine, tonight, extra }: { iso: string; tz: string; mine: boolean; tonight: boolean; extra: boolean }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className="tile-wrap" aria-hidden="true">
      <div className={`tile ptile${extra ? ' extra' : ''}${mine ? ' mine' : ''}`}>
        {tonight ? <span className="tonight-tag">TONIGHT</span> : <span className="dow">{TILE_DOW[p.weekday]}</span>}
        <span className="day">{p.day}</span>
        <span className="mon">{month}</span>
      </div>
      {mine && <span className="tile-check">{CHECK}</span>}
    </div>
  );
}

function countLine(s: PlayerSessionView): string {
  if (s.courtState === 'waitlist') return `${s.waitlist.length} on standby`;
  return s.countText;
}

/**
 * What this player owes on a card, in the compact look. At most two lines
 * after the names: the money line (an amber chip with its button beside it, or
 * the green "Paid" pill with the quiet links on the same line) and one line of
 * small links ("I paid", "Drop out"). `drop` is the "Drop out" link. On game
 * day after 8:00 AM the card at the top takes over the buttons and this shows
 * only the chip. In the flat LATER rows the money line is the right column.
 */
function RowPay({
  g,
  s,
  onTop,
  onChanged,
  drop,
}: {
  g: GroupView;
  s: PlayerSessionView;
  onTop: boolean;
  onChanged: () => Promise<void>;
  drop: ReactNode;
}) {
  const mine = s.mine!;
  const paid = usePaid([s.id], onChanged);
  const credit = useCredit(onChanged);
  const payTap = usePayTapped(s.id);
  const busy = paid.busy || credit.busy;
  if (mine.paymentStatus === 'paid') {
    const amount = mine.shareCents;
    return (
      <div className="sched-money stacked">
        <span className="pchip chip-ok paid-tag" data-paid>{mine.paidWithCredit ? 'Paid with credit' : amount ? `Paid ${formatPrice(amount)}` : 'Paid'}</span>
        <span className="inline-links">
          {/* Credit use can be taken back; only their own "I paid" can be undone here, the organizer's stays. */}
          {mine.paidWithCredit && (
            <button className="link-btn quiet-link" data-undo-credit disabled={credit.busy} onClick={() => credit.undo(s.id)}>
              Undo
            </button>
          )}
          {mine.selfPaid && !mine.paidWithCredit && (
            <button className="link-btn quiet-link didnt-pay" disabled={paid.busy} onClick={() => paid.set(false)}>
              Didn't pay?
            </button>
          )}
          {drop}
        </span>
      </div>
    );
  }
  if (mine.oweCents <= 0) {
    return (
      <div className="sched-money stacked">
        <span className="inline-links">{drop}</span>
      </div>
    );
  }
  const left = mine.creditCents > 0;
  // With credit to use, "Use credit" is the filled button and Pay is its outline twin (covers all or part).
  const showCredit = mine.useCreditCents > 0;
  const chipText = left ? `${formatPrice(mine.oweCents)} left to pay` : `${formatPrice(mine.oweCents)} due`;
  const chip = (
    <span className="pchip chip-warn" data-owe>
      {chipText}
      {left && <span className="sr-only">, {formatPrice(mine.creditCents)} credit used</span>}
      {showCredit && !left && <span className="chip-credit"> · {formatPrice(g.credit.usableCents)} credit</span>}
    </span>
  );
  if (onTop) {
    return (
      <div className="sched-money stacked">
        {chip}
        <span className="inline-links">{drop}</span>
      </div>
    );
  }
  const pay = venmoPayUrl(g.group.venmoUrl, mine.oweCents, venmoNote(s.startsAt, g.group.timezone, g.me?.name));
  const filled = 'btn pay-btn';
  const outline = 'btn pay-btn outline';
  const creditBtn = showCredit && (
    <button className={filled} data-use-credit disabled={busy} onClick={() => credit.use([s.id], mine.oweCents, mine.useCreditCents)}>
      Use credit
    </button>
  );
  const creditHint = showCredit && !left ? <span className="credit-hint sr-only">{creditHintText(mine.useCreditCents, g.credit.usableCents, mine.oweCents)}</span> : null;
  const payLabel = `Pay ${formatPrice(mine.oweCents)}`;
  // Always pay first when credit does not cover it; "I paid" stays for anyone who paid another way.
  const payBtn = pay.url ? (
    <a
      className={showCredit ? outline : filled}
      href={pay.url}
      data-app-href={pay.appUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Pay ${formatPrice(mine.oweCents)} with Venmo`}
      onClick={(e) => {
        payTap.mark();
        openVenmo(e, pay);
      }}
    >
      {left ? payLabel : 'Pay'}
    </a>
  ) : (
    <button className={showCredit ? outline : filled} disabled={busy} onClick={() => paid.set(true)}>
      I paid
    </button>
  );
  const iPaid = pay.url && (!showCredit || payTap.tapped) && (
    <button className="link-btn quiet-link" disabled={busy} onClick={() => paid.set(true)}>
      I paid
    </button>
  );
  return (
    <>
      <div className="sched-money pay-line">
        {chip}
        {creditHint}
        <span className="sched-btns">
          {showCredit && creditBtn}
          {payBtn}
        </span>
      </div>
      <div className="sched-links inline-links">
        {iPaid}
        {drop}
      </div>
    </>
  );
}

/**
 * One session in the schedule. Three looks by tier: THIS WEEK (big tile,
 * green outline, soft shadow), NEXT WEEK (smaller, thin outline) and LATER
 * (a flat two-column row). The tile carries the weekday (or TONIGHT), date,
 * and a check when you're in; the short time sits under it. No green tint for
 * joined. The calendar icon sits at the right end of the status line.
 */
function ScheduleRow({
  s,
  g,
  tier,
  onChanged,
  highlight,
}: {
  s: PlayerSessionView;
  g: GroupView;
  tier: WeekTier;
  onChanged: () => Promise<void>;
  /** Opened from a shared link to this session. */
  highlight?: boolean;
}) {
  const tz = g.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  const [askOut, setAskOut] = useState(false);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waiting = mine?.status === 'waitlisted';
  const courtWait = s.courtState === 'waitlist';
  const open = !s.canceled && !s.started;
  const nowMs = Date.parse(g.now);

  async function run(path: string, label: (data: any) => string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      toast(label(await api<any>('POST', `/api/sessions/${s.id}/${path}`, {})));
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
      setAskOut(false);
    }
  }

  const court = courtStatus(s, tz);
  const goodNews = inSession && mine.promotion ? (s.courtState === 'opened' && mine.promotion === 'spot_opened' ? GOOD_NEWS.court_opened : GOOD_NEWS[mine.promotion]) : null;

  const names = s.confirmed.map((p) => p.name);
  const everyone = g.players.map((p) => p.name);
  const onTop = g.payDue.some((o) => o.sessionId === s.id);
  const isIn = inSession && !s.canceled;
  const tonight = open && playerDay(s.startsAt, tz, nowMs).word === 'tonight';
  // Once you're signed up: at the right end of the status line (the tap area reaches past the icon).
  const calLink = isIn && open && (
    <a className="cal-icon-link" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${formatShortDate(s.startsAt, tz)} to calendar`}>
      <CalendarPlusIcon />
    </a>
  );
  const showCount = !s.canceled && (s.confirmed.length > 0 || !courtWait);
  const dropLink = isIn && open && (
    <button className="link-btn quiet-link drop-link" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      Drop out
    </button>
  );
  const payShows = isIn && !!mine && (mine.paymentStatus === 'paid' || mine.oweCents > 0 || onTop);

  // The gray "If 6 play, you get $5 back as credit." for someone who would be 5th or later (not joined, room left, not on a waitlist).
  const notIn = open && !(inSession || waiting);
  const note = notIn && !courtWait && s.joinAs === 'in' && !s.full ? creditBackNote(g.group.priceCents, s.confirmed.length, g.group.maxPlayers, formatPrice) : null;

  // The status line: "You're in · Court booked", the court word with a dot, the waitlist spot, or Canceled (with the organizer's reason).
  const courtWord = <span>{court.playerText}</span>;
  let status: ReactNode;
  if (s.canceled) status = <span className="st-canceled">{s.courtState === 'not_opened' ? court.playerText : s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled'}</span>;
  else if (waiting) status = <span className="st-wait">{courtWait ? 'Standby' : 'Waitlist'}, {ordinal(mine.waitlistPosition ?? 1)} in line</span>;
  else if (isIn)
    status = (
      <>
        <span className="st-lead">
          <strong className="st-in">You're in</strong>
          <span className="st-sep">·</span>
        </span>
        <span className="st-tail">
          <span className="court-status">{courtWord}</span>
          {calLink}
        </span>
      </>
    );
  else
    status = (
      <span className="court-status">
        <span className="court-dot" aria-hidden="true" />
        {courtWord}
      </span>
    );

  const joinBtn = notIn && (
    <button className={`btn sched-btn${tier === 'later' ? ' outline' : ''}`} disabled={busy} aria-busy={busy} onClick={() => run('join', joinedText)}>
      {busy ? 'Saving…' : courtWait ? 'Join standby' : s.joinAs === 'in' ? "I'm in" : 'Join waitlist'}
    </button>
  );
  const leaveBtn = waiting && open && (
    <button className="btn sched-btn outline" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      {courtWait ? 'Leave standby' : 'Leave waitlist'}
    </button>
  );
  const noteEl = note && (
    <p className="credit-note" data-credit-note>
      {note}
    </p>
  );

  return (
    <article
      id={`row-${s.id}`}
      className={`sched tier-${tier}${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}`}
      data-tier={tier}
      data-mine={isIn ? 'in' : undefined}
      data-extra={s.extra ? 'yes' : undefined}
      aria-labelledby={`s-${s.id}`}
    >
      <div className="sched-tilecol">
        <PlayerTile iso={s.startsAt} tz={tz} mine={isIn} tonight={tonight && !s.canceled} extra={s.extra} />
        {(() => {
          const short = formatTimeShort(s.startsAt, s.endsAt, tz);
          // Half-hour games ("7:30–9:30 PM") are wider: a touch smaller so they stay under the tile.
          return (
            <div className={`sched-time${short.length > 10 ? ' long' : ''}`}>
              <span aria-hidden="true">{short}</span>
            </div>
          );
        })()}
      </div>
      <h2 id={`s-${s.id}`} className="sr-only">
        {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}, {formatTimeRange(s.startsAt, s.endsAt, tz)}
        {isIn ? ". You're in" : ''}
      </h2>
      <div className="sched-body">
        <div className="sched-head">
          <div className={`sched-status court-${court.kind}`} data-court={court.kind}>
            {status}
          </div>
        </div>
        <div className="sched-main">
          {showCount && (
            <div className="in-line">
              <span className="in-count">{countLine(s)}</span>
              <SpotDots names={names} me={g.me?.name} />
            </div>
          )}
          {showCount && <NamesLine names={names} me={g.me?.name} everyone={everyone} />}
          {!s.canceled && !waiting && (
            <NamesLine names={s.waitlist.map((w) => w.name)} me={g.me?.name} everyone={everyone} label={courtWait ? 'Standby' : 'Waitlist'} />
          )}
          {waiting && !s.canceled && <p className="sched-sub">You're in if someone drops.</p>}
          {s.canceled && <p className="sched-sub">If you paid, it's now your credit.</p>}

          {s.extra && <span className="sr-only">Extra game</span>}
          {s.note && <p className="game-note">{s.note}</p>}
          {goodNews && <Notice tone="ok">{goodNews}</Notice>}
          {tier === 'later' && noteEl}
        </div>

        {payShows && <RowPay g={g} s={s} onTop={onTop} onChanged={onChanged} drop={dropLink} />}
        {isIn && !payShows && dropLink && (
          <div className="sched-money stacked">
            <span className="inline-links">{dropLink}</span>
          </div>
        )}
        {(joinBtn || leaveBtn) && <div className="sched-money">{joinBtn}{leaveBtn}</div>}
        {tier !== 'later' && noteEl}
      </div>

      <ConfirmDialog
        open={askOut}
        title={waiting ? (courtWait ? 'Leave standby?' : 'Leave the waitlist?') : `Out for ${playerDay(s.startsAt, tz, nowMs).word}?`}
        body={waiting ? 'You lose your place in line.' : 'Your spot opens up for someone else.'}
        confirmLabel={waiting ? (courtWait ? 'Leave standby' : 'Leave waitlist') : 'Drop out'}
        danger
        busy={busy}
        onConfirm={() => run('withdraw', () => (waiting ? "You're off the list" : "You're out"))}
        onCancel={() => setAskOut(false)}
      />
    </article>
  );
}
