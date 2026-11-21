import '../../booking-hours.css';
import { type ReactNode, useState } from 'react';
import { clockLabel, dayRule, fitStart, hoursLine, lengthChoices, lengthFits, startSlots, type VenueHoursConfig, weekdayOfDate } from '../../../shared/bookingHours';
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

/** "Nov 11, 2026" for a plain "YYYY-MM-DD" date (what the Date box shows; the native date input sits invisibly on top of it and takes the tap). */
export function dateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 'Pick a date';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "7:30" for a chip (no AM or PM on the chip; the AM and PM labels above the rows say which). */
const chipLabel = (m: number) => clockLabel(m).replace(/ [AP]M$/, '');

/** When the date moves, the start stays if it still fits that day, else it is nudged into the hours. */
export function startForDate(date: string, start: string, lengthMin: number, hours?: VenueHoursConfig | null): string {
  const wd = weekdayOfDate(date);
  const s = hhmmToMinutes(start);
  if (wd === null || s === null) return start;
  // Zip 81: the hours of THIS date (special hours too) when the dashboard has them.
  const f = fitStart(hours ? dayRule(hours, date) : wd, s, lengthMin);
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
  // Zip 81: the hours of the picked DATE (a special entry, a closed day), else the weekday's normal hours as before.
  const weekday = ctx.d.group.venueHours && weekdayOfDate(date) !== null ? dayRule(ctx.d.group.venueHours, date) : (weekdayOfDate(date) ?? 1);
  const closedDay = typeof weekday !== 'number' && weekday.hours === null;
  const startMin = hhmmToMinutes(start);
  const endLabel = startMin === null ? '' : clockLabel(startMin + lengthMin);
  const choices = lengthChoices(weekday, startMin, ctx.d.group.settings, ctx.d.shortGames === true, ctx.d.longGames === true);
  const slots = startSlots(weekday);
  return (
    <div className="bh-card" data-bh-card="times">
      {top && <div className="bh-top">{top}</div>}
      <div className="bh-row">
        <label className="bh-cell">
          <span className="bh-lab">Date</span>
          <span className="bh-box bh-date">
            <span className="bh-date-text" data-bh-date-text>
              {dateText(date)}
            </span>
            <input type="date" className="bh-date-input" {...(dateAttr ? { [dateAttr]: '' } : {})} value={date} onChange={(e) => onDate(e.target.value)} required />
          </span>
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
      <TimeGridSheet
        open={grid}
        title={`Start time · ${weekdayDate(date)}`}
        slots={slots}
        picked={startMin}
        allowed={(m) => lengthFits(weekday, m, lengthMin)}
        onPick={(m) => onStart(minutesToHHMM(m))}
        onClose={() => setGrid(false)}
        closedNote={closedDay ? `${hoursLine(weekday)} Pick another date.` : null}
      />
    </div>
  );
}

/**
 * THE 30-minute time grid (Zip 24's Start time sheet; Zip 81 reuses it for every venue hours box and the usual game time): AM and PM rows of
 * buttons, the picked one green, the ones outside the allowed range dimmed and not tappable. `closedNote`: a closed day says so instead.
 */
export function TimeGridSheet({
  open,
  title,
  slots,
  picked,
  allowed,
  onPick,
  onClose,
  closedNote = null,
}: {
  open: boolean;
  title: string;
  slots: readonly number[];
  picked: number | null;
  allowed: (m: number) => boolean;
  onPick: (m: number) => void;
  onClose: () => void;
  closedNote?: string | null;
}) {
  const am = slots.filter((m) => m < 12 * 60);
  const pm = slots.filter((m) => m >= 12 * 60);
  const chip = (m: number) => {
    const fits = allowed(m);
    return (
      <button
        key={m}
        type="button"
        className="bh-chip"
        data-chip={minutesToHHMM(m % (24 * 60))}
        aria-pressed={m === picked}
        aria-disabled={!fits || undefined}
        disabled={!fits}
        aria-label={clockLabel(m)}
        onClick={() => {
          onPick(m);
          onClose();
        }}
      >
        {m >= 24 * 60 ? '12 AM' : chipLabel(m)}
      </button>
    );
  };
  return (
    <Sheet open={open} title={title} onClose={onClose} className="bh-grid-sheet">
      {open && closedNote && (
        <div className="bh-card bh-gridcard" data-bh-grid data-bh-closed>
          <p className="bh-closed-note">{closedNote}</p>
        </div>
      )}
      {open && !closedNote && (
        <div className="bh-card bh-gridcard" data-bh-grid>
          {am.length > 0 && <div className="bh-ap">AM</div>}
          {am.length > 0 && <div className="bh-grid">{am.map(chip)}</div>}
          {pm.length > 0 && <div className="bh-ap">PM</div>}
          {pm.length > 0 && <div className="bh-grid">{pm.map(chip)}</div>}
        </div>
      )}
    </Sheet>
  );
}

/** Zip 81: 6:00 AM to 12:00 AM (midnight, 1440), every 30 minutes: noon and 11 PM are one tap. */
export const DAY_SLOTS: readonly number[] = Array.from({ length: 37 }, (_, i) => 6 * 60 + i * 30);

/**
 * Zip 81 (Alex: no native time pickers): a button showing the time ("8:00 AM"; midnight "12:00 AM") that opens the grid above. A time off the
 * 30-minute steps (an old saved one) is offered too, so it shows as picked.
 */
export function TimeButton({
  value,
  onChange,
  title,
  label,
  allowed = () => true,
  disabled,
  data,
}: {
  value: number;
  onChange: (m: number) => void;
  title: string;
  label: string;
  allowed?: (m: number) => boolean;
  disabled?: boolean;
  data?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const slots = DAY_SLOTS.includes(value) || value < 0 ? DAY_SLOTS : [...DAY_SLOTS, value].sort((a, b) => a - b);
  return (
    <>
      <button type="button" className="tg-btn" aria-label={`${label}: ${value < 0 ? 'pick' : clockLabel(value)}`} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen(true)} {...data}>
        {value < 0 ? 'Pick' : clockLabel(value)}
      </button>
      <TimeGridSheet open={open} title={title} slots={slots} picked={value} allowed={allowed} onPick={onChange} onClose={() => setOpen(false)} />
    </>
  );
}
