import { useEffect, useState } from 'react';
import { activityText } from '../../../shared/activity';
import type { ActivityEntry, ActivityPage, AdminSessionView } from '../../../shared/api';
import { formatDateTime, formatShortDate, formatTimeRange } from '../../../shared/time';
import { api, ApiError } from '../../lib';
import { Empty, ErrorState, Sheet, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';
import { SessionCard } from './Sessions';
import { lateDropsAll } from './todo';

/** History: played sessions, or everything anyone did, newest first. Organizer only. */
export function HistoryTab({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<'sessions' | 'activity'>('sessions');
  return (
    <section className="stack history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title" className="sr-only">
          History
        </h2>
        <div className="chips" role="group" aria-label="Show">
          <button className="chip-btn" aria-pressed={view === 'sessions'} onClick={() => setView('sessions')}>
            Sessions
          </button>
          <button className="chip-btn" aria-pressed={view === 'activity'} onClick={() => setView('activity')}>
            Activity
          </button>
        </div>
      </div>
      {view === 'sessions' ? <PastSessions ctx={ctx} /> : <Activity ctx={ctx} />}
    </section>
  );
}

/** "All paid", "2 unpaid", or nothing when nobody owed anything. */
function moneyStatus(s: AdminSessionView): { text: string; tone: 'ok' | 'warn' } | null {
  if (s.state.flags.canceled) return null;
  const owing = s.roster.filter((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null);
  if (owing.length) return { text: `${owing.length} unpaid`, tone: 'warn' };
  if (s.roster.some((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'paid')) return { text: 'All paid', tone: 'ok' };
  return null;
}

function PastSessions({ ctx }: { ctx: AdminCtx }) {
  // The server's time, so the list matches what the server counts as played.
  const nowMs = Date.parse(ctx.d.now);
  const tz = ctx.d.group.timezone;
  const [openId, setOpenId] = useState<string | null>(null);
  const past = ctx.d.sessions.filter((s) => Date.parse(s.endsAt) <= nowMs).reverse();
  const open = past.find((s) => s.id === openId) ?? null;
  if (past.length === 0) return <Empty>No played sessions yet.</Empty>;
  return (
    <>
      <ul className="card history-list" aria-label="Past sessions">
        {past.map((s) => {
          const played = s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
          const money = moneyStatus(s);
          const late = lateDropsAll(s).length;
          return (
            <li key={s.id} data-session={s.id}>
              <button className="history-row" onClick={() => setOpenId(s.id)}>
                <span className="h-top">
                  <span className="h-date">{formatShortDate(s.startsAt, tz)}</span>
                  <span className="h-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</span>
                  {money && <span className={`h-money ${money.tone}`}>{money.text}</span>}
                </span>
                <span className="h-who">
                  {s.state.flags.canceled ? (
                    <span className="h-canceled">{s.courtState === 'not_opened' ? "Court didn't open" : 'Canceled'}</span>
                  ) : (
                    <>
                      <strong>{played.length} played</strong>
                      {played.length > 0 && <span className="h-names">{played.join(', ')}</span>}
                    </>
                  )}
                  {late > 0 && <span className="late-tag">{late === 1 ? 'Late drop' : `${late} late drops`}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Sheet open={!!open} title={open ? formatShortDate(open.startsAt, tz) : ''} onClose={() => setOpenId(null)}>
        {open && <SessionCard ctx={ctx} s={open} />}
      </Sheet>
    </>
  );
}

function Activity({ ctx }: { ctx: AdminCtx }) {
  const tz = ctx.d.group.timezone;
  const organizer = ctx.d.group.organizerName || 'Organizer';
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  async function load(before?: string) {
    setBusy(true);
    try {
      const page = await api<ActivityPage>('GET', `/api/admin/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      setEntries((cur) => (before && cur ? [...cur, ...page.entries] : page.entries));
      setMore(page.more);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Could not load the activity.'));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (error && !entries) return <ErrorState error={error} onRetry={() => load()} />;
  if (!entries) return <Spinner />;
  if (entries.length === 0) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <>
      <ul className="card activity-list" aria-label="Activity">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="a-text">{activityText(e, tz, organizer)}</span>
            <time className="a-time" dateTime={e.createdAt}>
              {formatDateTime(e.createdAt, tz)}
            </time>
          </li>
        ))}
      </ul>
      {more && (
        <button className="btn ghost block" disabled={busy} onClick={() => load(entries[entries.length - 1].createdAt)}>
          {busy ? 'Loading…' : 'Show older'}
        </button>
      )}
    </>
  );
}
