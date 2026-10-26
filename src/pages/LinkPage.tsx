import { useState } from 'react';
import type { ActionTokenView } from '../../shared/api';
import { formatTimeRange, formatWeekday, formatMonthDay } from '../../shared/time';
import { api, ApiError, useLoad } from '../lib';
import { TopBar } from '../Shell';
import { ConfirmDialog, ErrorState, Notice, Spinner } from '../ui';

type Outcome = 'confirmed_attendance' | 'withdrawn' | 'claimed' | 'already_confirmed' | 'spot_taken';

const OUTCOME_TEXT: Record<Outcome, { tone: 'ok' | 'info' | 'warn'; title: string; body: string }> = {
  confirmed_attendance: { tone: 'ok', title: "You're confirmed", body: 'See you on the court.' },
  withdrawn: { tone: 'info', title: "You're out for this one", body: 'Your spot is open for someone else. Thanks for the heads-up.' },
  claimed: { tone: 'ok', title: "You're in!", body: 'The spot is yours.' },
  already_confirmed: { tone: 'ok', title: 'You already have a spot', body: 'Nothing else to do.' },
  spot_taken: { tone: 'warn', title: 'Sorry, this spot has already been claimed', body: 'Someone else got there first.' },
};

/** The page behind a personal link in a text message. No PIN or name picking needed. */
export function LinkPage({ token }: { token: string }) {
  const load = useLoad(() => api<ActionTokenView>('POST', '/api/link', { token }), [token]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askDrop, setAskDrop] = useState(false);

  async function act(action: 'confirm' | 'withdraw' | 'claim') {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ outcome: Outcome; view: ActionTokenView }>('POST', '/api/link/act', { token, action });
      setOutcome(res.outcome);
      load.setData(res.view);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      setAskDrop(false);
    }
  }

  const v = load.data;
  return (
    <>
      <TopBar eyebrow="Pickleball" title={v ? `Hi ${v.playerName}` : 'Your pickleball link'} />
      <main className="page stack-lg">
        {load.loading && !v && <Spinner />}
        {load.error && (load.error.status === 404 ? (
          <Notice tone="danger" title="This link doesn't work">
            It may be mistyped or replaced by a newer one. Ask the organizer for a fresh link.
          </Notice>
        ) : (
          <ErrorState error={load.error} onRetry={load.reload} />
        ))}
        {v && (
          <>
            <div className="card stack">
              <div>
                <div className="card-date">
                  {formatWeekday(v.session.startsAt, v.timezone)}, {formatMonthDay(v.session.startsAt, v.timezone)}
                </div>
                <div className="card-time">{formatTimeRange(v.session.startsAt, v.session.endsAt, v.timezone)}</div>
                {v.session.venueName && <div className="card-time">{v.session.venueName}</div>}
              </div>
              {v.scope === 'claim' && !outcome && (
                <p>
                  {v.session.openSpots > 0
                    ? `${v.session.openSpots} spot${v.session.openSpots === 1 ? ' is' : 's are'} open. First to claim gets it.`
                    : 'No spots are open right now.'}
                </p>
              )}
              {v.scope === 'attendance' && !outcome && v.myStatus === 'confirmed' && (
                <p>{v.attendanceConfirmed ? "You've confirmed. You can still drop out below." : 'Are you still in?'}</p>
              )}
            </div>

            {outcome && (
              <Notice tone={OUTCOME_TEXT[outcome].tone} title={OUTCOME_TEXT[outcome].title}>
                {OUTCOME_TEXT[outcome].body}
              </Notice>
            )}
            {error && <Notice tone="danger" title="That didn't work">{error}</Notice>}

            {!v.valid && !outcome && (
              <Notice tone="warn" title="This link can't be used">
                {v.invalidReason}
              </Notice>
            )}

            {v.valid && v.scope === 'attendance' && v.myStatus === 'confirmed' && (
              <div className="stack">
                {!v.attendanceConfirmed && (
                  <button className="btn block" disabled={busy} onClick={() => act('confirm')}>
                    Confirm I'm in
                  </button>
                )}
                <button className="btn danger block" disabled={busy} onClick={() => setAskDrop(true)}>
                  I need to drop out
                </button>
              </div>
            )}
            {v.valid && v.scope === 'attendance' && v.myStatus !== 'confirmed' && !outcome && (
              <Notice tone="info" title="You don't have a spot in this session">
                Nothing to confirm.
              </Notice>
            )}
            {v.valid && v.scope === 'claim' && outcome !== 'claimed' && v.myStatus !== 'confirmed' && v.session.openSpots > 0 && (
              <button className="btn block" disabled={busy} onClick={() => act('claim')}>
                {busy ? 'Claiming…' : 'Claim this spot'}
              </button>
            )}
            {v.scope === 'claim' && v.myStatus === 'confirmed' && !outcome && (
              <Notice tone="ok" title="You already have a spot" />
            )}
          </>
        )}
        <ConfirmDialog
          open={askDrop}
          title="Drop out of this session?"
          body="Your spot opens up for someone else. You can rejoin later from the group page if a spot is still open."
          confirmLabel="Yes, drop me"
          danger
          busy={busy}
          onConfirm={() => act('withdraw')}
          onCancel={() => setAskDrop(false)}
        />
      </main>
    </>
  );
}
