import { type FormEvent, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { type CourtSwitch as CourtSwitchValue, courtSwitchOf } from '../../../shared/court';
import { COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { cancelByShort, formatShortDate, formatTimeRange, fromLocalInputValue, toLocalInputValue } from '../../../shared/time';
import { api } from '../../lib';
import { CourtReserveLink } from '../../ui';
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
export function EditGameForm({ ctx, s, onDone }: { ctx: AdminCtx; s: AdminSessionView; onDone: (moved: boolean, statusChanged: boolean) => void }) {
  const tz = ctx.d.group.timezone;
  const startLocal = toLocalInputValue(s.startsAt, tz);
  const current = courtSwitchOf(s);
  const [status, setStatus] = useState<CourtSwitchValue>(current);
  const [date, setDate] = useState(startLocal.slice(0, 10));
  const [start, setStart] = useState(startLocal.slice(11));
  const [end, setEnd] = useState(toLocalInputValue(s.endsAt, tz).slice(11));
  const [error, setError] = useState<string | null>(null);
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
  const started = s.state.flags.started;
  const over = s.state.flags.past;
  const startsAt = date && start ? fromLocalInputValue(`${date}T${start}`, tz) : null;
  const endsAt = date && end ? fromLocalInputValue(`${date}T${end}`, tz) : null;
  const timeChanged = !started && !!startsAt && !!endsAt && (startsAt !== s.startsAt || endsAt !== s.endsAt);
  const statusChanged = status !== current;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!timeChanged && !statusChanged) return onDone(false, false);
    let moved = false;
    const ok = await run(async () => {
      // The move first (it can be turned down: a time already taken, in the past), then the status.
      if (timeChanged) moved = !!(await api<{ changed: boolean }>('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt, endsAt })).changed;
      if (statusChanged) await api('POST', `/api/admin/sessions/${s.id}/court-status`, { status });
    }, moved || timeChanged ? 'Game saved' : 'Court status saved');
    if (ok) onDone(moved, statusChanged);
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
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Change court on CourtReserve</CourtReserveLink>
      {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
      <button className="btn big" type="submit" disabled={busy || (!started && (!startsAt || !endsAt))}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
