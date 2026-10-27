import { useEffect, useState } from 'react';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoPayUrl } from '../../shared/money';
import { formatMonthDay, formatShortDate, formatTimeRange, formatWeekday } from '../../shared/time';
import { api, ApiError, setGroupKey, setViewAs, storageSet, useLoad } from '../lib';
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
            {g.owed.length > 0 && <OwedCard g={g} />}
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
  return (
    <section className="stack" aria-label="Pick your name">
      <p className="muted">Tap your name. This phone remembers it.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="name-grid">
        {g.players.map((p) => (
          <button
            key={p.id}
            className={`btn ${g.me?.id === p.id ? '' : 'secondary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api('POST', '/api/me', { playerId: p.id });
                onPicked();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not save your name.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
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
          </p>
          {o.reminder && (
            <p className="small muted">{who} may not have marked this paid yet. If you already paid, no action needed.</p>
          )}
          <PayButton g={g} cents={o.amountCents} startsAt={o.startsAt} />
        </div>
      ))}
      <p className="small muted">Opening Venmo doesn't mark you paid. {who} does that after the money arrives.</p>
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
        </div>
        {chip}
      </div>

      {s.canceled ? (
        <p className="muted">Canceled.</p>
      ) : (
        <>
          {inSession && mine.promotion && <Notice tone="ok">{GOOD_NEWS[mine.promotion]}</Notice>}
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
            {s.confirmed.length > 0 && (
              <ul className="going" aria-label="Who's going">
                {s.confirmed.map((p) => (
                  <li key={p.name} className={p.name === g.me?.name ? 'me' : undefined}>
                    {p.name}
                    {p.attendanceConfirmed && <span aria-label=", checked in"> ✓</span>}
                  </li>
                ))}
              </ul>
            )}
            {s.waitlist.length > 0 && (
              <p className="small">
                <span className="muted">Waitlist: </span>
                {s.waitlist.map((w, i) => `${i + 1}. ${w.name}`).join('  ·  ')}
              </p>
            )}
          </div>
          {inSession && mine.refundCents !== null && (
            <p className="small muted">
              6 playing, so {g.group.organizerName ?? 'the organizer'} refunds you {formatPrice(mine.refundCents)}.
            </p>
          )}
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
