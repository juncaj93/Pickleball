import { useEffect, useRef, useState } from 'react';
import { activityText } from '../../../shared/activity';
import type { ActivityEntry, ActivityPage, AdminSessionView } from '../../../shared/api';
import { formatDateTime, formatShortDate, formatTimeRange } from '../../../shared/time';
import { api, ApiError, storageGet, storageSet } from '../../lib';
import { Empty, ErrorState, Sheet, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';
import { SessionCard } from './Sessions';
import { lateDropsAll } from './todo';

/** History: played sessions, or everything anyone did, newest first. Organizer only. */
export function HistoryTab({ ctx }: { ctx: AdminCtx }) {
  // The new layout (ADMIN_V2): Activity first, with a NEW / VIEWED divider. Off: exactly as before.
  if (ctx.d.adminV2 === true) return <HistoryTabV2 ctx={ctx} />;
  return <HistoryTabClassic ctx={ctx} />;
}

function HistoryTabClassic({ ctx }: { ctx: AdminCtx }) {
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

/** "Finalize", "All paid", "2 unpaid", or nothing when nobody owed anything. */
function moneyStatus(s: AdminSessionView): { text: string; tone: 'ok' | 'warn' } | null {
  if (s.state.flags.canceled) return null;
  if (s.needsFinalize) return { text: 'Finalize', tone: 'warn' };
  const owing = s.roster.filter((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.owesCents > 0);
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
          // Once finalized, the people who actually played; until then everyone who was in.
          const played = s.roster.filter((r) => r.status === 'confirmed' && (s.finalized ? r.played !== false : true)).map((r) => r.name);
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
                    <span className="h-canceled">{s.courtState === 'not_opened' ? "Court didn't open" : s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled'}</span>
                  ) : (
                    <>
                      <strong>{s.finalized ? `${s.finalized.playedCount} played · $${s.finalized.priceCents / 100} each` : `${played.length} in`}</strong>
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

// ---------- The new layout (ADMIN_V2) ----------

/** When this phone last left the History tab (an ISO time, kept in this browser only: no database). */
export const HISTORY_SEEN_KEY = 'pb_history_seen';

/** Newest "createdAt" among entries, as milliseconds (0 when none). */
const newestMs = (entries: ActivityEntry[] | null) => (entries ?? []).reduce((m, e) => Math.max(m, Date.parse(e.createdAt) || 0), 0);

/**
 * History, new layout: two tabs, Activity (opens first) and Sessions (today's old list, unchanged). Activity splits at
 * the last visit: a NEW group (what happened since this phone last left the tab) and a VIEWED group (everything older).
 * "Last visit" is stored on this phone when the organizer leaves the tab or closes the site, never while staying on it,
 * so the NEW group stays visible for the whole visit. The very first visit on a phone has no NEW group.
 */
function HistoryTabV2({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<'activity' | 'sessions'>('activity');
  // Fixed for this whole visit (read once, when the tab opens).
  const [baseline] = useState<string | null>(() => storageGet(HISTORY_SEEN_KEY));
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // "Seen" means what was on the screen: the server's time when the list was asked for (from the last load of the page, so
  // never later than the list itself), or the newest row shown. Things that happen after that, even while the tab stays
  // open, are still new on the next visit.
  const clock = useRef(ctx.d.now);
  clock.current = ctx.d.now;
  const seenUpTo = useRef(0);
  async function load(before?: string) {
    setBusy(true);
    try {
      const asked = Date.parse(clock.current) || 0;
      const page = await api<ActivityPage>('GET', `/api/admin/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      if (!before) seenUpTo.current = Math.max(asked, newestMs(page.entries));
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
  // The visit ends when the tab is left (this component goes away) or the site is closed or put away.
  useEffect(() => {
    const remember = () => {
      // Nothing loaded yet: leave the old mark alone, so entries never shown are not counted as viewed.
      if (seenUpTo.current > 0) storageSet(HISTORY_SEEN_KEY, new Date(seenUpTo.current).toISOString());
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') remember();
    };
    window.addEventListener('pagehide', remember);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', remember);
      document.removeEventListener('visibilitychange', hidden);
      remember();
    };
  }, []);
  return (
    <section className="stack history history-v2" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title" className="sr-only">
          History
        </h2>
        <div className="chips" role="group" aria-label="Show">
          <button className="chip-btn" aria-pressed={view === 'activity'} onClick={() => setView('activity')}>
            Activity
          </button>
          <button className="chip-btn" aria-pressed={view === 'sessions'} onClick={() => setView('sessions')}>
            Sessions
          </button>
        </div>
      </div>
      {view === 'sessions' ? (
        <PastSessions ctx={ctx} />
      ) : (
        <ActivityV2 ctx={ctx} baseline={baseline} entries={entries} more={more} error={error} busy={busy} load={load} />
      )}
    </section>
  );
}

function ActivityV2({
  ctx,
  baseline,
  entries,
  more,
  error,
  busy,
  load,
}: {
  ctx: AdminCtx;
  baseline: string | null;
  entries: ActivityEntry[] | null;
  more: boolean;
  error: ApiError | null;
  busy: boolean;
  load: (before?: string) => Promise<void>;
}) {
  const tz = ctx.d.group.timezone;
  const organizer = ctx.d.group.organizerName || 'Organizer';
  if (error && !entries) return <ErrorState error={error} onRetry={() => load()} />;
  if (!entries) return <Spinner />;
  if (entries.length === 0) return <Empty>Nothing has happened yet.</Empty>;
  const since = baseline ? Date.parse(baseline) : NaN;
  const fresh = Number.isFinite(since) ? entries.filter((e) => Date.parse(e.createdAt) > since) : [];
  const old = fresh.length ? entries.filter((e) => !fresh.includes(e)) : entries;
  const list = (rows: ActivityEntry[], label: string) => (
    <ul className="card activity-list" aria-label={label}>
      {rows.map((e) => (
        <li key={e.id}>
          <span className="a-text">{activityText(e, tz, organizer)}</span>
          <time className="a-time" dateTime={e.createdAt}>
            {formatDateTime(e.createdAt, tz)}
          </time>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {fresh.length > 0 && (
        <>
          <div className="week-break hist-break is-new" data-divider="new">
            <h3>
              New since {formatDateTime(baseline!, tz)} · {fresh.length}
            </h3>
          </div>
          {list(fresh, 'New activity')}
          <div className="week-break hist-break" data-divider="viewed">
            <h3>Viewed</h3>
          </div>
        </>
      )}
      {old.length > 0 && list(old, fresh.length ? 'Viewed activity' : 'Activity')}
      {more && (
        <button className="btn ghost block" disabled={busy} onClick={() => load(entries[entries.length - 1].createdAt)}>
          {busy ? 'Loading…' : 'Show older'}
        </button>
      )}
    </>
  );
}
