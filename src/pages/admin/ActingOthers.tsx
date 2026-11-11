// Zip 30, "Acting for others" (ACTING_FOR_OTHERS, shared/actingForOthers.ts; mocks acting_for_others_light.png / _dark.png): one slim card at
// the very top of admin Home listing taps a player made for someone else in the last 7 days ("Mitchel signed up for Brandon"). Up to 3 rows,
// then "+N more" (opens History). The X hides what is on the card now, on this phone (like the other Home card X's); History keeps every
// line, and a newer tap shows the card again. Only while the switch is on (the server sends `actingOthers` only then); off: nothing here.
import { useState } from 'react';
import { type ActingRow, afterDismiss } from '../../../shared/actingForOthers';
import { formatTime, formatWeekdayShort, localParts } from '../../../shared/time';
import { storageGet, storageSet } from '../../lib';
import type { AdminCtx } from '../Admin';
import '../../acting-others.css';

const DISMISS_KEY = 'pb_acting_dismissed';
const SHOWN = 3;

const sameDay = (a: string, b: string, tz: string) => {
  const x = localParts(Date.parse(a), tz);
  const y = localParts(Date.parse(b), tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/** "7:12 PM" today, "Mon 7:12 PM" on an earlier day. */
export function rowTime(at: string, now: string, tz: string): string {
  return sameDay(at, now, tz) ? formatTime(at, tz) : `${formatWeekdayShort(at, tz)} ${formatTime(at, tz)}`;
}

export function ActingOthersCard({ ctx, onHistory }: { ctx: AdminCtx; onHistory?: () => void }) {
  const [dismissed, setDismissed] = useState<string | null>(() => storageGet(DISMISS_KEY));
  const all = ctx.d.actingOthers;
  if (!all) return null;
  const rows: ActingRow[] = afterDismiss(all, dismissed);
  if (rows.length === 0) return null;
  const tz = ctx.d.group.timezone;
  const shown = rows.slice(0, SHOWN);
  const more = rows.length - shown.length;
  const dismiss = () => {
    // Everything on the card now (the newest tap's time): a newer tap brings the card back.
    const newest = rows[0].at;
    storageSet(DISMISS_KEY, newest);
    setDismissed(newest);
  };
  return (
    <section className="afo" aria-labelledby="afo-title" data-acting-others>
      <div className="afo-head">
        <span className="afo-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5h15M15 4.5l4 4-4 4" />
            <path d="M20 15.5H5M9 11.5l-4 4 4 4" />
          </svg>
        </span>
        <h2 id="afo-title" className="afo-title">
          Acting for others
        </h2>
        <button type="button" className="afo-x" aria-label="Dismiss: Acting for others (History keeps them)" data-afo-x onClick={dismiss}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ul className="afo-rows">
        {shown.map((r) => (
          <li key={r.id} className="afo-row" data-afo-row={r.id}>
            <span className="afo-text">
              <strong>{r.by ?? 'A new phone'}</strong> <span className="afo-verb">{r.verb} for</span> <strong>{r.name}</strong>
            </span>
            <time className="afo-time" dateTime={r.at}>
              {rowTime(r.at, ctx.d.now, tz)}
            </time>
          </li>
        ))}
        {more > 0 && (
          <li className="afo-row afo-more-row">
            <button type="button" className="afo-more" data-afo-more onClick={onHistory}>
              +{more} more in History
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}
