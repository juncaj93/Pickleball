import { useEffect, useState } from 'react';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatCents } from '../../shared/money';
import { SPOTS_PER_SESSION } from '../../shared/settings';
import { formatMonthDay, formatShortDate, formatTimeRange, formatWeekday } from '../../shared/time';
import { api, ApiError, safeHref, setGroupKey, storageSet, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { Chip, ConfirmDialog, Empty, ErrorState, FirstVisitNotice, Notice, Spinner, useToast } from '../ui';

const SHOW_FIRST = 4;

export function PlayerHome({ groupKey }: { groupKey: string }) {
  setGroupKey(groupKey);
  const load = useLoad(() => api<GroupView>('GET', '/api/group'), [groupKey]);
  const [switching, setSwitching] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (load.data) storageSet('pb_group_key', groupKey);
  }, [load.data, groupKey]);

  const g = load.data;
  if (load.error?.status === 404) {
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

  const pickName = !!g && (!g.me || switching);
  const sessions = g ? (showAll ? g.sessions : g.sessions.slice(0, SHOW_FIRST)) : [];

  return (
    <>
      <TopBar
        eyebrow="Pickleball · Tue & Thu 8–10 PM"
        title={g?.group.name ?? 'Pickleball'}
        sub={
          g?.me && !switching ? (
            <>
              Playing as <strong>{g.me.name}</strong> ·{' '}
              <button onClick={() => setSwitching(true)}>Not you?</button>
            </>
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
            <FirstVisitNotice>This site never texts you. Reminders come from your organizer.</FirstVisitNotice>
            {g.owed.length > 0 && <OwedCard g={g} />}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} g={g} onChanged={load.reload} />
            ))}
            {g.sessions.length > SHOW_FIRST && (
              <button className="btn secondary block" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer sessions' : `Show all ${g.sessions.length} sessions`}
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
    <section className="stack" aria-labelledby="pick-title">
      <h2 id="pick-title">Who are you?</h2>
      <p className="muted">Pick your name. It's saved on this phone so you only do this once.</p>
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

function OwedCard({ g }: { g: GroupView }) {
  const tz = g.group.timezone;
  const total = g.owed.reduce((a, o) => a + o.amountCents, 0);
  const venmo = safeHref(g.group.venmoUrl);
  return (
    <section className="card stack" aria-labelledby="owed-title">
      <div className="spread">
        <div>
          <h2 id="owed-title">You owe</h2>
          <ul className="list small">
            {g.owed.map((o) => (
              <li key={o.sessionId} className="spread" style={{ padding: '6px 0' }}>
                <span>{formatShortDate(o.startsAt, tz)}</span>
                <span className="amount">{formatCents(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="big-amount num">{formatCents(total)}</div>
      </div>
      {venmo && (
        <a className="btn block" href={venmo} target="_blank" rel="noopener noreferrer">
          Pay with Venmo
        </a>
      )}
      <p className="small muted">The organizer marks you paid after they see the payment. Opening Venmo doesn't mark anything paid.</p>
    </section>
  );
}

const MESSAGES = {
  confirmed: "You're in",
  already_confirmed: "You're in",
  spot_taken: 'Sorry, that spot was just taken',
} as const;

function SessionCard({ s, g, onChanged }: { s: PlayerSessionView; g: GroupView; onChanged: () => Promise<void> }) {
  const tz = g.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [askWithdraw, setAskWithdraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waitlisted = mine?.status === 'waitlisted';
  const meName = g.me?.name;

  async function run(path: string, label?: (data: any) => string) {
    setBusy(true);
    setError(null);
    try {
      const data = await api<any>('POST', `/api/sessions/${s.id}/${path}`, {});
      if (label) toast(label(data));
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      await onChanged();
    } finally {
      setBusy(false);
      setAskWithdraw(false);
    }
  }

  const joinLabel = (d: { result: keyof typeof MESSAGES | 'waitlisted'; position?: number }) =>
    d.result === 'waitlisted' ? `You're #${d.position} on the waitlist` : MESSAGES[d.result];

  const court =
    s.bookingStatus === 'booked'
      ? { tone: 'ok' as const, text: s.venueName ? `Court booked · ${s.venueName}` : 'Court booked' }
      : s.bookingStatus === 'unavailable'
        ? { tone: 'danger' as const, text: 'No court available' }
        : { tone: 'muted' as const, text: 'Court not booked yet' };

  return (
    <article className="card stack" aria-labelledby={`s-${s.id}`}>
      <div className="spread">
        <div>
          <h2 id={`s-${s.id}`} className="card-date">
            {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}
          </h2>
          <div className="card-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</div>
        </div>
        {s.canceled ? (
          <Chip tone="muted">Canceled</Chip>
        ) : s.openSpots === 0 ? (
          <Chip tone="ok">Full</Chip>
        ) : (
          <Chip tone="info">
            {s.openSpots} open
          </Chip>
        )}
      </div>

      {!s.canceled && <Chip tone={court.tone}>{court.text}</Chip>}

      {s.canceled ? (
        <p className="muted">The organizer canceled this session.</p>
      ) : (
        <>
          <ul className="spots" aria-label={`${s.confirmed.length} of ${SPOTS_PER_SESSION} spots taken`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {Array.from({ length: SPOTS_PER_SESSION }, (_, i) => {
              const p = s.confirmed[i];
              if (!p)
                return (
                  <li key={i} className="spot open">
                    Open spot
                  </li>
                );
              return (
                <li key={i} className={`spot ${p.name === meName ? 'me' : ''}`}>
                  <span className="name">{p.name}</span>
                  {p.attendanceConfirmed && (
                    <span className="tick" aria-label="confirmed attendance" title="Confirmed">
                      ✓
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {s.waitlist.length > 0 && (
            <p className="small">
              <span className="muted">Waitlist: </span>
              {s.waitlist.map((w, i) => `${i + 1}. ${w.name}`).join('  ·  ')}
            </p>
          )}
        </>
      )}

      {inSession && (
        <Notice tone="ok" title="You're in">
          {mine.attendanceConfirmed ? "You've confirmed you're coming." : s.confirmationOpen ? 'Please confirm you\'re still coming.' : null}
        </Notice>
      )}
      {waitlisted && <Notice tone="info" title={`You're #${mine.waitlistPosition} on the waitlist`} />}

      {inSession && mine.shareCents !== null && (
        <div className="spread small">
          <span>
            Your share <span className="amount">{formatCents(mine.shareCents)}</span>
          </span>
          <Chip tone={mine.paymentStatus === 'paid' ? 'ok' : 'warn'}>{mine.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</Chip>
        </div>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {!s.canceled && !s.started && (
        <div className="btn-row">
          {!inSession && s.openSpots > 0 && (
            <button className="btn" disabled={busy} onClick={() => run('join', joinLabel)}>
              {waitlisted ? 'Claim open spot' : 'Claim spot'}
            </button>
          )}
          {!inSession && !waitlisted && s.openSpots === 0 && (
            <button className="btn secondary" disabled={busy} onClick={() => run('join', joinLabel)}>
              Join waitlist
            </button>
          )}
          {inSession && s.confirmationOpen && !mine.attendanceConfirmed && (
            <button className="btn" disabled={busy} onClick={() => run('confirm', () => "Thanks, you're confirmed")}>
              Confirm I'm in
            </button>
          )}
          {(inSession || waitlisted) && (
            <button className="btn ghost" disabled={busy} onClick={() => setAskWithdraw(true)}>
              {waitlisted ? 'Leave waitlist' : 'Withdraw'}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={askWithdraw}
        title={waitlisted ? 'Leave the waitlist?' : 'Withdraw from this session?'}
        body={
          waitlisted
            ? 'You lose your place in line. Rejoining puts you at the back.'
            : `Your spot for ${formatShortDate(s.startsAt, tz)} opens up for someone else.`
        }
        confirmLabel={waitlisted ? 'Leave waitlist' : 'Withdraw'}
        danger
        busy={busy}
        onConfirm={() => run('withdraw', () => (waitlisted ? 'You left the waitlist' : "You're out for this session"))}
        onCancel={() => setAskWithdraw(false)}
      />
    </article>
  );
}
