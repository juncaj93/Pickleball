import { type FormEvent, useState } from 'react';
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
  // The game's length (2 hours usually): a new start moves the end with it, unless the end is changed by hand.
  const lengthMin = Math.max(30, Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000));
  const pickStart = (v: string) => {
    setStart(v);
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
  const endsAt = date && end ? fromLocalInputValue(`${date}T${end}`, tz) : null;
  // Compared to the minute (the boxes hold minutes): a stored time with seconds never counts as a change.
  const minute = (iso: string) => Math.floor(Date.parse(iso) / 60_000);
  const timeChanged = !started && !!startsAt && !!endsAt && (minute(startsAt) !== minute(s.startsAt) || minute(endsAt) !== minute(s.endsAt));
  const statusChanged = status !== current;

  const savedText = () => (timeChanged || labelChanged ? 'Game saved' : 'Court status saved');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!timeChanged && !statusChanged && !labelChanged) return onDone(false, false);
    let moved = false;
    const easing = motion && canMove();
    const ok = await run(async () => {
      // The move first (it can be turned down: a time already taken, in the past), then the status.
      if (timeChanged) moved = !!(await api<{ changed: boolean }>('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt, endsAt })).changed;
      if (statusChanged) await api('POST', `/api/admin/sessions/${s.id}/court-status`, { status });
      if (labelChanged) await api('PUT', `/api/admin/sessions/${s.id}/note`, { note: label.trim() });
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

  return (
    <form className="stack edit-game" onSubmit={submit}>
      {!over && (
        <div className="field">
          <span id="edit-court-label">Court</span>
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
      {labelOn && (
        <label className="field" data-label-field>
          Label
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Veteran's Day, Court 3" autoComplete="off" />
        </label>
      )}
      {error && <p className="field-error">{error}</p>}
      <CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Change court on CourtReserve</CourtReserveLink>
      {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
      <button className={`btn big${saved ? ' m-saved' : ''}`} type="submit" disabled={busy || saved || (!started && (!startsAt || !endsAt))} aria-busy={motion && busy ? true : undefined}>
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
