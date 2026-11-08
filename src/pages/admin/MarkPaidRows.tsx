// The compact "who hasn't paid" rows (Alex, Nov 8, zip 15 round 2; mockups/markpaid_mock.html, p15_markpaid.png). One row per person,
// 50 px, thin lines: the name (16 px bold) with the price in small gray right after it, then on the same row "Mark paid" (small amber
// outline) and, with Second Chance on, "Request" (Venmo saved, blue) or "Text" (purple). Five people, then "3 more" opens the rest.
// Used by the Home "Mark paid tonight" / "Who owes you" card (live for everyone, a pure cleanup) and by the Second Chance cards.
// Every tap is the caller's own (the same Mark paid as before: Undo, instant taps); nothing new is saved here.
import { useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import type { AdminCtx } from '../Admin';
import { RequestButton } from './SecondChance';
import '../../mark-paid.css';

export interface MpRow {
  key: string;
  playerId: string;
  name: string;
  cents: number;
  session: Pick<AdminSessionView, 'id' | 'startsAt'>;
}

/** How many rows show before "N more". */
export const MP_SHOWN = 5;

/** The one date every row shares ("Sun, Nov 8"), for the card's header; null when the rows are for different dates. */
export function sharedDate(rows: readonly MpRow[], tz: string): string | null {
  const dates = new Set(rows.map((r) => formatShortDate(r.session.startsAt, tz)));
  return dates.size === 1 ? [...dates][0] : null;
}

export function MarkPaidRows({
  ctx,
  rows,
  onMark,
  disabled,
  showDates,
  label,
}: {
  ctx: AdminCtx;
  rows: readonly MpRow[];
  onMark: (r: MpRow) => void;
  disabled?: boolean;
  /** The rows are for different dates: each row says its own. */
  showDates: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const tz = ctx.d.group.timezone;
  const shown = open ? rows : rows.slice(0, MP_SHOWN);
  const more = rows.length - MP_SHOWN;
  return (
    <>
      <ul className="mp-rows" aria-label={label} data-mp-rows>
        {shown.map((r) => {
          const day = formatShortDate(r.session.startsAt, tz);
          return (
            <li key={r.key} className="mp-row" data-mp-row={r.name}>
              <span className="mp-name">
                <strong>{r.name}</strong>
                <span className="mp-price">{formatPrice(r.cents)}</span>
                {showDates && <span className="mp-when">{day}</span>}
              </span>
              <button type="button" className="mp-btn mp-amber" disabled={disabled} aria-label={`Mark ${r.name} paid for ${day}`} onClick={() => onMark(r)}>
                Mark paid
              </button>
              <RequestButton ctx={ctx} s={r.session} playerId={r.playerId} name={r.name} owesCents={r.cents} />
            </li>
          );
        })}
      </ul>
      {more > 0 && (
        <button type="button" className="mp-more" aria-expanded={open} data-mp-more onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : `${more} more`}
        </button>
      )}
    </>
  );
}
