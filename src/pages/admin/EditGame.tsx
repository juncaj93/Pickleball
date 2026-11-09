import '../../admin-r3.css';
import { type FormEvent, useState } from 'react';
import { checkBookingTimes } from '../../../shared/bookingHours';
import type { AdminSessionView } from '../../../shared/api';
import { type CourtSwitch as CourtSwitchValue, courtSwitchOf } from '../../../shared/court';
import { COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { cancelByShort, formatShortDate, formatTimeRange, fromLocalInputValue, toLocalInputValue } from '../../../shared/time';
import { api } from '../../lib';
import { CourtReserveLink, Pickleball, useToast } from '../../ui';
import { canMove, useMotion } from '../../motion';
import type { AdminCtx } from '../Admin';
import { CourtSwitch } from './CourtSwitch';
import { HideAgain, useAction } from './Sessions';
import { boxMinutes, ShortGameHeadsUp } from './ShortGame';
import { CourtRow } from '../../GameDay';
import { GameTimeCard, startForDate } from './TimePicker';

/**
 * "Edit game": the court status, the date and times, and the CourtReserve
 * link in one sheet with one Save. Moving the game works exactly like the old
 * Move session (same server call, players are not texted). Changing only the
 * status saves only the status. The cancel-by time is not a field: it is
 * always 12 hours before the start and moves with it.
 */
/** How long the green Saved shows before the toast comes up and the sheet slides away (motion only). */
const SAVED_SHOW_MS = 360;

export function EditGameForm({ ctx, s, onDone }: { ctx: AdminCtx; s: AdminSessionView; onDone: (moved: boolean, statusChanged: boolean) => void }) {
  const tz = ctx.d.group.timezone;
  const startLocal = toLocalInputValue(s.startsAt, tz);
  const current = courtSwitchOf(s);
  const [status, setStatus] = useState<CourtSwitchValue>(current);
  const [date, setDate] = useState(startLocal.slice(0, 10));
  const [start, setStart] = useState(startLocal.slice(11));
  const [end, setEnd] = useState(toLocalInputValue(s.endsAt, tz).slice(11));
  const [error, setError] = useState<string | null>(null);
  // The short label ("Veteran's Day", "Court 3"): the new layout only (ADMIN_V2). It is the game's note, changed with Save.
  const labelOn = ctx.d.adminV2 === true;
  const [label, setLabel] = useState(s.note ?? '');
  const labelChanged = labelOn && label.trim() !== (s.note ?? '');
  // Zip 14 (GAME_DAY_CARD): the Court row, picked on the court map, saved with Save. Off: no row, never changed.
  const courtOn = ctx.d.gameDayCard === true;
  const [court, setCourt] = useState<number | null>(s.courtNum ?? null);
  const courtChanged = courtOn && court !== (s.courtNum ?? null);
  // The game's length (2 hours usually): a new start moves the end with it, unless the end is changed by hand.
  const lengthMin = Math.max(30, Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000));
  // Zip 24 (BOOKING_HOURS): the tap-to-pick times. Start and length are picked, End is start + length. Off: the time boxes below, exactly as before.
  const picker = ctx.d.bookingHours === true;
  const [len, setLen] = useState(lengthMin);
  const pickDate = (v: string) => {
    setDate(v);
    // A new date with other hours: the start stays when it still fits, else it moves into that day's hours (length kept).
    if (picker) setStart((cur) => startForDate(v, cur, len));
  };
  const pickStart = (v: string) => {
    setStart(v);
    if (picker) return;
    const m = /^(\d{2}):(\d{2})$/.exec(v);
    if (!m) return;
    const total = Math.min(Number(m[1]) * 60 + Number(m[2]) + lengthMin, 23 * 60 + 59);
    setEnd(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
  };
  const { busy, run } = useAction(ctx);
  // Motion: Save spins a small pickleball, then shows a green "Saved" with a check for a moment before the sheet goes
  // (and the toast comes up). The save itself is never held back: only the closing waits, about a third of a second.
  const motion = useMotion();
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const started = s.state.flags.started;
  const over = s.state.flags.past;
  const startsAt = date && start ? fromLocalInputValue(`${date}T${start}`, tz) : null;
  // Picker: End is the start plus the length (a game that ends after midnight, which only an old game can, is still right).
  const endsAt = picker ? (startsAt ? new Date(Date.parse(startsAt) + len * 60_000).toISOString() : null) : date && end ? fromLocalInputValue(`${date}T${end}`, tz) : null;
  // Compared to the minute (the boxes hold minutes): a stored time with seconds never counts as a change.
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  const timeChanged = !started && !!startsAt && !!endsAt && (minute(startsAt) !== minute(s.startsAt) || minute(endsAt) !== minute(s.endsAt));
  const statusChanged = status !== current;
  // Zip 24: the hours rule on a CHANGED time only (the pickers cannot offer an out-of-hours time, so this is the backstop: a date change on
  // an odd-length game). An old game that is outside the hours and is not being moved is never blocked.
  const hoursCheck = picker && timeChanged && startsAt && endsAt ? checkBookingTimes(startsAt, endsAt, tz) : null;
  const blocked = hoursCheck !== null && !hoursCheck.ok;

  const savedText = () => (timeChanged || labelChanged ? 'Game saved' : courtChanged && !statusChanged ? (court === null ? 'Court cleared' : `Court ${court} saved`) : 'Court status saved');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!timeChanged && !statusChanged && !labelChanged && !courtChanged) return onDone(false, false);
    let moved = false;
    const easing = motion && canMove();
    const ok = await run(async () => {
      // The move first (it can be turned down: a time already taken, in the past), then the status.
      if (timeChanged) moved = !!(await api<{ changed: boolean }>('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt, endsAt })).changed;
      if (statusChanged) await api('POST', `/api/admin/sessions/${s.id}/court-status`, { status });
      if (labelChanged) await api('PUT', `/api/admin/sessions/${s.id}/note`, { note: label.trim() });
      if (courtChanged) await api('PUT', `/api/admin/sessions/${s.id}/court-number`, { court });
    }, easing ? undefined : savedText());
    if (ok && easing) {
      // The green Saved shows, then the toast comes up and the sheet slides away.
      setSaved(true);
      await new Promise((r) => setTimeout(r, SAVED_SHOW_MS));
      toast(savedText());
      // Even if the sheet was closed during the Saved moment, the follow-up step (Moved text) still happens, as with the motion off.
      onDone(moved, statusChanged);
    } else if (ok) onDone(moved, statusChanged);
    else if (moved) await ctx.reload(); // the move went through even though the switch did not
  }

  // Admin screens, round 3 (ADMIN_R3): no "Court" label above the switch, tighter spacing so the sheet fits one small phone screen.
  const r3 = ctx.d.adminR3 === true;
  const saveButton = (
    <button className={`btn big${saved ? ' m-saved' : ''}`} type="submit" disabled={busy || saved || blocked || (!started && (!startsAt || !endsAt))} aria-busy={motion && busy ? true : undefined}>
      {saved ? (
        <>
          <svg className="m-saved-check" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Saved
        </>
      ) : busy ? (
        <>
          {motion && (
            <span className="m-btn-ball" aria-hidden="true">
              <Pickleball />
            </span>
          )}
          Saving…
        </>
      ) : (
        'Save'
      )}
    </button>
  );
  if (picker) {
    return (
      <form className="stack edit-game bh-form" onSubmit={submit} data-bh-form="edit">
        {started ? (
          <div className="bh-card" data-bh-card="times">
            {!over && (
              <div className="bh-top">
                <CourtSwitch value={status} onPick={setStatus} label="Court status" />
              </div>
            )}
            <p className="small muted">This game already started, so the date and time are locked.</p>
          </div>
        ) : (
          <GameTimeCard
            ctx={ctx}
            date={date}
            onDate={pickDate}
            start={start}
            onStart={setStart}
            lengthMin={len}
            onLength={setLen}
            top={!over ? <CourtSwitch value={status} onPick={setStatus} label="Court status" /> : undefined}
            court={courtOn ? { value: court, onChange: setCourt } : null}
          />
        )}
        {!started && blocked && hoursCheck && !hoursCheck.ok && (
          <p className="field-error bh-message" data-bh-message role="alert">
            {hoursCheck.message}
          </p>
        )}
        {/* "Time may shift": a new start on a game with players in asks them on their Home. Nothing is sent. (Shown only when it applies.) */}
        {!started && ctx.d.timeShift !== false && timeChanged && startsAt && minute(startsAt) !== minute(s.startsAt) && s.roster.some((r) => r.status === 'confirmed' && r.playerId !== (ctx.d.me?.id ?? null)) && (
          <p className="small ts-note" data-ts-note>
            Players who are in will be asked to confirm the new time.
          </p>
        )}
        {started && courtOn && <CourtRow value={court} onChange={setCourt} />}
        {labelOn && (
          <label className="bh-card bh-note" data-label-field>
            <span className="bh-lab">Label</span>
            <input className="bh-box" type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={courtOn ? "Veteran's Day" : "Veteran's Day, Court 3"} autoComplete="off" />
          </label>
        )}
        {error && <p className="field-error">{error}</p>}
        {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
        {/* One row, pinned at the bottom of the sheet: the blue CourtReserve button (as before, a shorter name) and Save, equal halves. */}
        <div className="bh-actions" data-bh-actions>
          <CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Change court</CourtReserveLink>
          {saveButton}
        </div>
      </form>
    );
  }
  return (
    <form className={`stack edit-game${r3 ? ' edit-game-r3' : ''}`} onSubmit={submit}>
      {!over && (
        <div className="field">
          {!r3 && <span id="edit-court-label">Court</span>}
          <CourtSwitch value={status} onPick={setStatus} label="Court status" />
        </div>
      )}
      <p className="small cancel-by-line" data-cancel-by>
        Cancel by {cancelByShort(timeChanged && startsAt ? startsAt : s.startsAt, tz)}, set automatically.
      </p>
      {started ? (
        <p className="small muted">This game already started, so the date and time are locked.</p>
      ) : (
        <>
          <label className="field">
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <div className="time-pair">
            <label className="field">
              Start
              <input type="time" value={start} onChange={(e) => pickStart(e.target.value)} required />
            </label>
            <label className="field">
              End
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </label>
          </div>
          <ShortGameHeadsUp ctx={ctx} minutes={boxMinutes(start, end)} />
          {timeChanged && startsAt && endsAt && (
            <p className="small">
              New time: <strong>{formatShortDate(startsAt, tz)}, {formatTimeRange(startsAt, endsAt, tz)}</strong>
            </p>
          )}
          {/* "Time may shift": a new start on a game with players in asks them on their Home. Nothing is sent. */}
          {ctx.d.timeShift !== false && timeChanged && startsAt && minute(startsAt) !== minute(s.startsAt) && s.roster.some((r) => r.status === 'confirmed' && r.playerId !== (ctx.d.me?.id ?? null)) && (
            <p className="small ts-note" data-ts-note>
              Players who are in will be asked to confirm the new time.
            </p>
          )}
        </>
      )}
      {courtOn && <CourtRow value={court} onChange={setCourt} />}
      {labelOn && (
        <label className="field" data-label-field>
          Label
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={courtOn ? "Veteran's Day" : "Veteran's Day, Court 3"} autoComplete="off" />
        </label>
      )}
      {error && <p className="field-error">{error}</p>}
      <CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Change court on CourtReserve</CourtReserveLink>
      {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
      <button className={`btn big${saved ? ' m-saved' : ''}`} type="submit" disabled={busy || saved || blocked || (!started && (!startsAt || !endsAt))} aria-busy={motion && busy ? true : undefined}>
        {saved ? (
          <>
            <svg className="m-saved-check" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </>
        ) : busy ? (
          <>
            {motion && (
              <span className="m-btn-ball" aria-hidden="true">
                <Pickleball />
              </span>
            )}
            Saving…
          </>
        ) : (
          'Save'
        )}
      </button>
    </form>
  );
}
