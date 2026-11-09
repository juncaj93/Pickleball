import '../../booking-hours.css';
import { type ReactNode, useState } from 'react';
import { clockLabel, fitStart, lengthChoices, lengthFits, startSlots, weekdayOfDate } from '../../../shared/bookingHours';
import { hhmmToMinutes, minutesToHHMM } from '../../../shared/settings';
import { CourtRow } from '../../GameDay';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';

// Zip 24 (BOOKING_HOURS): the tap-to-pick game times on Add game and Edit game. Replaces the phone's own time boxes. It can only offer
// times inside the venue hours for the chosen date (shared/bookingHours.ts), so an out-of-hours game cannot be picked.
//
// Card 1: Date and Court (halves), Start (opens the grid) and End (auto, muted), then Length: 1.5 hr / 2 hr with "$N each" under each.
// The Start grid is its own sheet: AM and PM, chips every 30 minutes, 4 per row, no AM/PM on a chip. A start where the chosen length would
// pass closing is faded and cannot be tapped; a length that would pass closing for the chosen start says "past close".

/** "Wed Nov 11" for a plain "YYYY-MM-DD" date. */
export function weekdayDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
}

/** "7:30" for a chip (no AM or PM on the chip; the AM and PM labels above the rows say which). */
const chipLabel = (m: number) => clockLabel(m).replace(/ [AP]M$/, '');

/** When the date moves, the start stays if it still fits that day, else it is nudged into the hours. */
export function startForDate(date: string, start: string, lengthMin: number): string {
  const wd = weekdayOfDate(date);
  const s = hhmmToMinutes(start);
  if (wd === null || s === null) return start;
  const f = fitStart(wd, s, lengthMin);
  return f === s ? start : minutesToHHMM(f);
}

export function GameTimeCard({
  ctx,
  date,
  onDate,
  start,
  onStart,
  lengthMin,
  onLength,
  top,
  court,
  dateAttr,
}: {
  ctx: AdminCtx;
  date: string;
  onDate: (v: string) => void;
  start: string;
  onStart: (v: string) => void;
  lengthMin: number;
  onLength: (minutes: number) => void;
  /** Edit game: the status control, first thing in the card. */
  top?: ReactNode;
  /** The court (only while Game day card is on). Left out: the Date box takes the whole row. */
  court?: { value: number | null; onChange: (court: number | null) => void } | null;
  /** The data-attribute name the existing tests look for on the date box. */
  dateAttr?: string;
}) {
  const [grid, setGrid] = useState(false);
  const weekday = weekdayOfDate(date) ?? 1;
  const startMin = hhmmToMinutes(start);
  const endLabel = startMin === null ? '' : clockLabel(startMin + lengthMin);
  const choices = lengthChoices(weekday, startMin, ctx.d.group.settings, ctx.d.shortGames === true);
  const slots = startSlots(weekday);
  const am = slots.filter((m) => m < 12 * 60);
  const pm = slots.filter((m) => m >= 12 * 60);
  const chip = (m: number) => {
    const fits = lengthFits(weekday, m, lengthMin);
    return (
      <button
        key={m}
        type="button"
        className="bh-chip"
        data-chip={minutesToHHMM(m)}
        aria-pressed={m === startMin}
        aria-disabled={!fits || undefined}
        disabled={!fits}
        aria-label={clockLabel(m)}
        onClick={() => {
          onStart(minutesToHHMM(m));
          setGrid(false);
        }}
      >
        {chipLabel(m)}
      </button>
    );
  };
  return (
    <div className="bh-card" data-bh-card="times">
      {top && <div className="bh-top">{top}</div>}
      <div className="bh-row">
        <label className="bh-cell">
          <span className="bh-lab">Date</span>
          <input type="date" className="bh-box" {...(dateAttr ? { [dateAttr]: '' } : {})} value={date} onChange={(e) => onDate(e.target.value)} required />
        </label>
        {court && (
          <div className="bh-cell" data-bh-court>
            <span className="bh-lab" aria-hidden="true">
              Court
            </span>
            <CourtRow value={court.value} onChange={court.onChange} stacked />
          </div>
        )}
      </div>
      <div className="bh-row">
        <div className="bh-cell">
          <span className="bh-lab" id="bh-start-label">
            Start
          </span>
          <button type="button" className="bh-box bh-start" data-bh-start aria-haspopup="dialog" aria-labelledby="bh-start-label bh-start-value" onClick={() => setGrid(true)}>
            <span id="bh-start-value">{startMin === null ? 'Pick' : clockLabel(startMin)}</span>
            <svg className="bh-updown" viewBox="0 0 10 16" aria-hidden="true">
              <path d="M2 6l3-3 3 3M2 10l3 3 3-3" />
            </svg>
          </button>
        </div>
        <div className="bh-cell">
          <span className="bh-lab">End</span>
          <div className="bh-box bh-end" data-bh-end>
            {endLabel}
          </div>
        </div>
      </div>
      <div className="bh-len">
        <span className="bh-lab" id="bh-len-label">
          Length
        </span>
        <div className="bh-lens" role="group" aria-labelledby="bh-len-label">
          {choices.map((c) => (
            <button
              key={c.minutes}
              type="button"
              className="bh-lenbtn"
              data-len={c.minutes}
              aria-pressed={c.minutes === lengthMin}
              aria-disabled={!c.fits || undefined}
              disabled={!c.fits}
              onClick={() => onLength(c.minutes)}
            >
              <span className="bh-len-name">{c.label}</span>
              <small>{c.fits ? c.price : 'past close'}</small>
            </button>
          ))}
        </div>
      </div>
      <Sheet open={grid} title={`Start time · ${weekdayDate(date)}`} onClose={() => setGrid(false)} className="bh-grid-sheet">
        {grid && (
          <div className="bh-card bh-gridcard" data-bh-grid>
            <div className="bh-ap">AM</div>
            <div className="bh-grid">{am.map(chip)}</div>
            <div className="bh-ap">PM</div>
            <div className="bh-grid">{pm.map(chip)}</div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
