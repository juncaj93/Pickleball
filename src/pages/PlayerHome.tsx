import { useEffect, useState } from 'react';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { formatMonthDay, formatShortDate, formatTimeRange, formatWeekday } from '../../shared/time';
import { api, ApiError, setGroupKey, setViewAs, storageGet, storageSet, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { Chip, ConfirmDialog, Empty, ErrorState, FirstVisitNotice, Notice, Spinner, useToast } from '../ui';

const SHOW_FIRST = 4;

type JoinResponse = { result: 'confirmed' | 'already_confirmed' | 'waitlisted'; position?: number; madeSix?: boolean };

const GOOD_NEWS = {
  made_six: "Good news, we now have 6, an even number, so you're in.",
  spot_opened: "Good news, a spot opened up, so you're in.",
};

function joinedText(d: JoinResponse): string {
  if (d.result === 'waitlisted') return `You're #${d.position} on the waitlist`;
  return d.madeSix ? GOOD_NEWS.made_six : "You're in";
}

/**
 * The player's one screen. Also used by the organizer's "View as...", where
 * every request carries the chosen player and taps really happen for them.
 */
export function PlayerHome({ groupKey, viewAs, onExit }: { groupKey: string | null; viewAs?: { id: string; name: string }; onExit?: () => void }) {
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
  if (load.error?.status === 404 && !viewAs) {
    return (
      <>
        <TopBar eyebrow="Pickleball" title="Link not working" />
        <main className="page">
          <Notice tone="danger" title="This group link isn't valid">
            It may have been replaced with a new one. Ask the organizer for the current link.
          </Notice>
        </main>
      </>
    );
  }

  const pickName = !!g && !viewAs && (!g.me || switching);
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
        eyebrow={g?.group.name ?? 'Pickleball'}
        title={!g ? 'Pickleball' : pickName ? 'Who are you?' : `Welcome, ${g.me?.name ?? viewAs?.name}`}
        sub={
          g?.me && !pickName && !viewAs ? (
            <button className="not-you" onClick={() => setSwitching(true)}>
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
            {!viewAs && <FirstVisitNotice>This site never texts you. Reminders come from {g.group.organizerName ?? 'your organizer'}.</FirstVisitNotice>}
            {g.suggestion && <SuggestionCard key={g.suggestion.sessionId} g={g} onChanged={load.reload} />}
            {!viewAs && <HomeScreenTip />}
            {(g.owed.length > 0 || g.creditBalanceCents > 0) && <OwedCard g={g} />}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} g={g} onChanged={load.reload} />
            ))}
            {g.sessions.length > SHOW_FIRST && (
              <button className="btn ghost block" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `More sessions (${g.sessions.length - SHOW_FIRST})`}
              </button>
            )}
          </>
        )}
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

/** Shown once per phone, and never inside the home screen app itself. */
function HomeScreenTip() {
  const [show, setShow] = useState(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !standalone && !storageGet('pb_seen_a2hs');
  });
  if (!show) return null;
  return (
    <div className="hint-banner" role="note" aria-label="Add to Home Screen">
      <div style={{ flex: 1 }}>
        <p>
          <strong>Put Pickleball on your Home Screen</strong>
        </p>
        <HomeScreenSteps />
      </div>
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

function PayButton({ g, cents, startsAt }: { g: GroupView; cents: number; startsAt: string }) {
  const pay = payLink(g, cents, startsAt);
  if (!pay.url) return null;
  return (
    <a className="btn block" href={pay.url} target="_blank" rel="noopener noreferrer">
      Pay {formatPrice(cents)} with Venmo
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
    const inNow = joined.result !== 'waitlisted';
    return (
      <section className="card stack suggest" aria-label="Your answer">
        <h2>{joinedText(joined)}</h2>
        <p className="muted small">
          {formatShortDate(s.startsAt, tz)} · {formatTimeRange(s.startsAt, s.endsAt, tz)}
        </p>
        {inNow && <PayButton g={g} cents={g.group.priceCents} startsAt={s.startsAt} />}
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

/**
 * Everyone on the list, in one place: people who signed up are solid pills
 * with a check mark, waiting people are outlined, everyone else is faded
 * plain text. Neutral colors only; green, amber and red mean status.
 */
function Roster({ s, g }: { s: PlayerSessionView; g: GroupView }) {
  const going = new Set(s.confirmed.map((p) => p.name));
  const waiting = new Map(s.waitlist.map((p, i) => [p.name, i + 1]));
  const rest = g.players.map((p) => p.name).filter((n) => !going.has(n) && !waiting.has(n));
  const me = g.me?.name;
  return (
    <ul className="roster" aria-label="Who's going">
      {s.confirmed.map((p) => (
        <li key={p.name} className={`in${p.name === me ? ' me' : ''}`}>
          <span aria-hidden="true">✓ </span>
          {p.name}
          <span className="sr-only">, going</span>
        </li>
      ))}
      {s.waitlist.map((p) => (
        <li key={p.name} className={`waiting${p.name === me ? ' me' : ''}`}>
          {p.name} · waitlist #{waiting.get(p.name)}
        </li>
      ))}
      {!s.canceled &&
        rest.map((n) => (
          <li key={n} className="out">
            {n}
            <span className="sr-only">, not signed up</span>
          </li>
        ))}
    </ul>
  );
}

export function HolidayPill({ name, venueNote }: { name: string; venueNote?: boolean }) {
  return (
    <span className="holiday">
      {name}
      {venueNote ? ' · check venue hours' : ''}
    </span>
  );
}

function OwedCard({ g }: { g: GroupView }) {
  const tz = g.group.timezone;
  const who = g.group.organizerName ?? 'The organizer';
  return (
    <section className="card stack" aria-label="Payments">
      {g.owed.map((o) => (
        <div key={o.sessionId} className="stack" style={{ gap: 8 }}>
          <p>
            <strong>
              You owe {formatPrice(o.amountCents)} for {formatShortDate(o.startsAt, tz)}
            </strong>
            {o.creditCents > 0 && <> (includes your {formatPrice(o.creditCents)} credit)</>}
            {o.discount && <span className="small muted"> · 6-person discount</span>}
          </p>
          {o.reminder && (
            <p className="small muted">{who} may not have marked this paid yet. If you already paid, no action needed.</p>
          )}
          <PayButton g={g} cents={o.amountCents} startsAt={o.startsAt} />
        </div>
      ))}
      {g.owed.length > 0 && <p className="small muted">Opening Venmo doesn't mark you paid. {who} does that after the money arrives.</p>}
      {g.creditBalanceCents > 0 && <p>You have a {formatPrice(g.creditBalanceCents)} credit toward your next session.</p>}
    </section>
  );
}

function SessionCard({ s, g, onChanged }: { s: PlayerSessionView; g: GroupView; onChanged: () => Promise<void> }) {
  const tz = g.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [askOut, setAskOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waitlisted = mine?.status === 'waitlisted';
  const open = !s.canceled && !s.started;

  async function run(path: string, label: (data: any) => string) {
    setBusy(true);
    setError(null);
    try {
      toast(label(await api<any>('POST', `/api/sessions/${s.id}/${path}`, {})));
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      await onChanged();
    } finally {
      setBusy(false);
      setAskOut(false);
    }
  }

  const chip = s.canceled ? (
    <Chip tone="muted">Canceled</Chip>
  ) : inSession ? (
    <Chip tone="ok">You're in</Chip>
  ) : waitlisted ? (
    <Chip tone="info">#{mine.waitlistPosition} on waitlist</Chip>
  ) : null;

  return (
    <article className="card stack" aria-labelledby={`s-${s.id}`}>
      <div className="spread">
        <div>
          <h2 id={`s-${s.id}`} className="card-date">
            {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}
          </h2>
          <div className="card-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</div>
          {s.holiday && <HolidayPill name={s.holiday} />}
        </div>
        {chip}
      </div>

      {s.canceled ? (
        <p className="muted">Canceled.</p>
      ) : (
        <>
          {inSession && mine.promotion && <Notice tone="ok">{GOOD_NEWS[mine.promotion]}</Notice>}
          {inSession && mine.creditComing && (
            <Notice tone="info">6 are playing. You'll get a {formatPrice(g.group.creditCents)} credit toward your next session.</Notice>
          )}
          {inSession && mine.discount && mine.shareCents !== null && (
            <p className="small">
              <strong>6-person discount:</strong> you owe {formatPrice(mine.shareCents)}.
            </p>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {open &&
            (inSession || waitlisted ? (
              <button className="btn secondary block big" disabled={busy} onClick={() => setAskOut(true)}>
                I'm out
              </button>
            ) : (
              <button className="btn block big" disabled={busy} onClick={() => run('join', joinedText)}>
                {s.joinAs === 'in' ? "I'm in" : 'Join waitlist'}
              </button>
            ))}
          {open && inSession && s.confirmationOpen && !mine.attendanceConfirmed && (
            <div className="spread" style={{ alignItems: 'center' }}>
              <span className="small">Still coming?</span>
              <button className="btn small" disabled={busy} onClick={() => run('confirm', () => 'Thanks, see you there')}>
                Yes, I'm coming
              </button>
            </div>
          )}
          <div className="stack" style={{ gap: 6 }}>
            <p className="small muted">{s.goingText}</p>
            <Roster s={s} g={g} />
          </div>
          {inSession && open && (
            <a className="btn small ghost" href={`/api/sessions/${s.id}/calendar.ics`}>
              Add to Calendar
            </a>
          )}
        </>
      )}

      <ConfirmDialog
        open={askOut}
        title={waitlisted ? 'Leave the waitlist?' : `Out for ${formatShortDate(s.startsAt, tz)}?`}
        body={waitlisted ? 'You lose your place in line.' : 'Your spot opens up for someone else.'}
        confirmLabel="I'm out"
        danger
        busy={busy}
        onConfirm={() => run('withdraw', () => "You're out for this one")}
        onCancel={() => setAskOut(false)}
      />
    </article>
  );
}
