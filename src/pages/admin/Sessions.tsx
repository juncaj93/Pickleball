import { type FormEvent, useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  canceledMessage,
  movedMessage,
  deadlineAlertMessage,
  siteAddress,
} from '../../../shared/messages';
import { CHARGE_ASK_HOURS, reopenRequestedReason } from '../../../shared/credit';
import { formatCents, formatPrice, parseDollars } from '../../../shared/money';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { DateTile, HolidayPill } from '../PlayerHome';
import type { BookingStatus } from '../../../shared/status';
import {
  formatDateTime,
  formatMonthDay,
  formatTime,
  formatShortDate,
  formatTimeRange,
  fromLocalInputValue,
  toLocalInputValue,
  weekFade,
} from '../../../shared/time';
import { api, ApiError, useNow } from '../../lib';
import { Chip, ConfirmDialog, CourtIcon, CourtReserveLink, CalendarPlusIcon, GearIcon, Notice, PlayersLine, Sheet, SmsDraft, useToast } from '../../ui';
import { courtStatus } from '../../../shared/court';
import { type AdminCtx, deadlineLine } from '../Admin';
import { reach, reminderText } from './textMenu';
import { isPlayed, lateDropsAll } from './todo';
import { TextButton } from './Texts';
import '../../credit-session.css';

export type SheetKind = 'booking' | 'roster' | 'payments' | 'cancel' | 'canceled' | 'moved';

function useAction(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      if (success) toast(success);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

export function SessionCard({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const live = !s.state.flags.canceled && !s.state.flags.started;
  const [more, setMore] = useState(false);
  const court = courtStatus(
    { ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past, bookingOpen: s.state.flags.bookingWindowOpen },
    tz,
  );
  const later = court.kind === 'later';
  const courtWait = court.kind === 'waitlist';
  const needsCourt = court.kind === 'needs';
  const details = [
    s.reservationReference ? `Reservation #${s.reservationReference}` : null,
    s.courtCostCents !== null ? `${formatCents(s.courtCostCents)} (only you see this)` : null,
  ].filter(Boolean);
  return (
    <article id={`session-${s.id}`} tabIndex={-1} className={`card scard court-${court.kind}`} data-court={court.kind} data-fade={weekFade(s.startsAt, now, tz) || undefined} data-remind={s.state.flags.bookingPromptDue || undefined} aria-labelledby={`as-${s.id}`}>
      {needsCourt && (
        <div className="court-banner" role="group" aria-label="Court">
          <div className="court-status">
            <CourtIcon kind="needs" />
            <span>{court.text}</span>
          </div>
          <div className="banner-btns">
            <CourtReserveLink href={COURTRESERVE_BOOKING_URL}>Book</CourtReserveLink>
            <BookedButton ctx={ctx} s={s} />
          </div>
        </div>
      )}
      {courtWait && (
        <div className="court-banner" role="group" aria-label="Court">
          <div className="court-status">
            <CourtIcon kind="waitlist" />
            <span>{court.text}</span>
          </div>
          {live && <CourtWaitButtons ctx={ctx} s={s} />}
        </div>
      )}
      <div className="scard-main">
        <DateTile iso={s.startsAt} tz={tz} />
        <div className="scard-body">
          <div className="scard-top">
            <h2 id={`as-${s.id}`} className="sr-only">
              {formatShortDate(s.startsAt, tz)}
            </h2>
            <div className="top-left">
              <span className="sched-time">
                <span className="nowrap">{formatTimeRange(s.startsAt, s.endsAt, tz)}</span>
                {s.extra && <span className="extra-tag">Extra game</span>}
              </span>
            </div>
            <div className="card-icons">
              <button
                className="icon-round"
                aria-label={`Session options for ${formatShortDate(s.startsAt, tz)}`}
                aria-expanded={more}
                aria-controls={`opts-${s.id}`}
                onClick={() => setMore((v) => !v)}
              >
                <GearIcon />
              </button>
            </div>
          </div>
          {s.note && <div className="game-note">{s.note}</div>}
          {s.holiday && <HolidayControl ctx={ctx} s={s} />}
          {lateDropsAll(s).length > 0 && (
            <div className="late-line">
              <span className="late-tag">Late drop</span> {lateDropsAll(s).map((r) => `${r.name} ${formatTime(r.lateDropAt!, tz)}`).join(', ')}
            </div>
          )}
          {court.kind === 'booked' && (
            <div className="court-line">
              <div className="pc-top">
                <div className="court-status">
                  <CourtIcon kind="booked" />
                  <span>{court.text}</span>
                </div>
              </div>
              {!s.state.flags.past && <div className="pc-sub">Cancel by {shortDeadline(s, tz, now)}</div>}
            </div>
          )}
          {(court.kind === 'off' || later) && (
            <div className="court-line">
              <div className="court-status">
                <CourtIcon kind={court.kind} />
                <span>{court.text}</span>
              </div>
            </div>
          )}
          {!s.state.flags.canceled && (
            <PlayersLine
              names={s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name)}
              waitlist={s.roster.filter((r) => r.status === 'waitlisted').map((r) => r.name)}
              waitLabel={courtWait ? 'Standby' : 'Waitlist'}
              everyone={ctx.d.players.map((p) => p.name)}
              maxPlayers={ctx.d.group.settings.maxPlayers}
              after={live ? <OrganizerInOut ctx={ctx} s={s} /> : undefined}
            />
          )}
        </div>
      </div>
      {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}

      {/* Options, from the gear: the Text button, then a 2 by 2 grid. */}
      {more && (
        <div className="options" id={`opts-${s.id}`}>
          {details.length > 0 && <p className="small muted court-details">{details.join(' · ')}</p>}
          {/* One "Text" button: Share the game, Day before, Last call, and the rest. */}
          <TextButton ctx={ctx} s={s} />
          <div className="opt-grid">
            <button className="btn secondary" onClick={() => ctx.open('booking', s.id)}>
              Edit booking
            </button>
            <button className="btn secondary" onClick={() => ctx.open('roster', s.id)}>
              Players
            </button>
            <CourtReserveLink href={COURTRESERVE_CANCEL_URL}>Modify court</CourtReserveLink>
            {/* Once the court is booked, Add to calendar sits here with the other options. */}
            {court.kind === 'booked' && live && (
              <a className="btn secondary cal-opt" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${formatShortDate(s.startsAt, tz)} to calendar`}>
                <CalendarPlusIcon />
                Add to calendar
              </a>
            )}
            <button className="btn danger" disabled={s.state.flags.started || s.courtState === 'not_opened'} onClick={() => ctx.open('cancel', s.id)}>
              {s.state.flags.canceled ? 'Reopen session' : 'Cancel session'}
            </button>
          </div>
          {(later || needsCourt || s.shownEarly) && (
            <div className="opt-extra">
              {later && <BookedButton ctx={ctx} s={s} small />}
              {(needsCourt || later) && <CourtWaitlistStart ctx={ctx} s={s} />}
              {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** "Oct 27, 7:30 AM", plus "(passed)" once it's gone. Short enough for one line on the card. */
function shortDeadline(s: AdminSessionView, tz: string, nowMs: number): string {
  if (!s.cancellationDeadlineAt) return 'not set';
  const when = `${formatMonthDay(s.cancellationDeadlineAt, tz)}, ${formatTime(s.cancellationDeadlineAt, tz)}`;
  return Date.parse(s.cancellationDeadlineAt) <= nowMs ? `${when} (passed)` : when;
}

/**
 * The organizer playing: a small gray "I'm in" at the right end of the
 * players row (never a second green button), which turns into "✓ You're in"
 * with a small "Out". Real sign-ups under their name from Settings, with the
 * same rules as everyone.
 */
function OrganizerInOut({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  const toast = useToast();
  const me = ctx.d.me;
  const mine = me ? s.roster.find((r) => r.playerId === me.id && (r.status === 'confirmed' || r.status === 'waitlisted')) : undefined;
  const day = formatShortDate(s.startsAt, ctx.d.group.timezone);
  const set = (goingIn: boolean) =>
    run(async () => {
      const res = await api<{ result: string; position?: number }>('POST', `/api/admin/sessions/${s.id}/me`, { in: goingIn });
      toast(!goingIn ? "You're out" : res.result === 'waitlisted' || res.result === 'standby' ? `You're #${res.position} on the waitlist` : "You're in");
    });
  if (!mine) {
    return (
      <button className="btn small secondary me-in" disabled={busy} aria-label={`I'm in for ${day}`} onClick={() => set(true)}>
        {busy ? 'Saving…' : "I'm in"}
      </button>
    );
  }
  return (
    <span className="me-state">
      <span className="me-in-text">{mine.status === 'confirmed' ? "You're in" : 'Waitlist'}</span>
      <button className="link-btn me-out" disabled={busy} aria-label={`Out of ${day}`} onClick={() => set(false)}>
        Out
      </button>
    </span>
  );
}

/** "I booked it": one tap, no questions. The deadline starts at 12 hours before play. */
function BookedButton({ ctx, s, small }: { ctx: AdminCtx; s: AdminSessionView; small?: boolean }) {
  const { busy, run } = useAction(ctx);
  return (
    <>
      <button className={small ? 'btn small secondary' : 'btn'} disabled={busy} onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/booked`, {}), 'Court booked')}>
        {busy ? 'Saving…' : 'I booked it'}
      </button>
    </>
  );
}

/** "Court opened" / "Didn't open" while on the venue's court waitlist. Both one tap, "Didn't open" asks first. */
export function CourtWaitButtons({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  const [ask, setAsk] = useState(false);
  return (
    <div className="banner-btns">
      <button
        className="btn"
        disabled={busy}
        onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/booked`, {}), 'Court opened')}
      >
        Court opened
      </button>
      <button className="btn secondary" disabled={busy} onClick={() => setAsk(true)}>
        Didn't open
      </button>
      <ConfirmDialog
        open={ask}
        title="The court didn't open?"
        body={`This session gets marked off with "Court didn't open." Standby players see that, and nobody owes anything.`}
        confirmLabel="Mark it off"
        danger
        busy={busy}
        onConfirm={async () => {
          await run(() => api('POST', `/api/admin/sessions/${s.id}/court`, { action: 'not_opened' }), "Marked: court didn't open");
          setAsk(false);
        }}
        onCancel={() => setAsk(false)}
      />
    </div>
  );
}

function CourtWaitlistStart({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  return (
    <button
      className="btn small secondary"
      disabled={busy}
      onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/court`, { action: 'waitlist' }), "On the court waitlist")}
    >
      On court waitlist
    </button>
  );
}

function HideAgain({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  return (
    <button className="btn small secondary" disabled={busy} onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/show`, { shown: false }), 'Hidden again')}>
      Hide this session
    </button>
  );
}

/**
 * Holiday pill for the organizer: "Election Day · check hours" with
 * "Hours OK" (read aloud as "Venue is open normal hours"). Once confirmed it shows "✓ Election Day"
 * with Undo. Saved on the session, so it holds on every device.
 */
export function HolidayControl({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  if (!s.holiday) return null;
  const set = (ok: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/holiday-hours`, { ok }), ok ? 'Venue hours confirmed' : 'Undone');
  return (
    <div className="holiday-actions">
      <HolidayPill name={s.holiday} venueNote confirmed={s.holidayHoursOk} />
      {s.holidayHoursOk ? (
        <button className="link-btn" disabled={busy} onClick={() => set(false)}>
          Undo
        </button>
      ) : (
        <button className="link-btn" disabled={busy} onClick={() => set(true)} aria-label="Venue is open normal hours">
          Hours OK
        </button>
      )}
    </div>
  );
}

/**
 * Shown from the day-before check-in when a session needs players. Until the
 * cancellation deadline the organizer can fill, reschedule, or cancel. The
 * site never decides for them.
 */
export function ShortPanel({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const { busy, run } = useAction(ctx);
  const passed = s.state.flags.deadlinePassed;
  const booked = s.bookingStatus === 'booked';
  return (
    <div className="stack">
      <p className="small">
        <strong>{s.confirmedCount} going.</strong> {s.state.flags.playersNeeded} more needed.{' '}
        {s.cancellationDeadlineAt &&
          (passed
            ? booked
              ? 'The cancellation deadline passed, so canceling the court may not be free.'
              : 'The cancellation deadline passed.'
            : `Reschedule or cancel by ${deadlineLine(s, tz, now)}.`)}
      </p>
      <div className="action-strip">
        <button className="btn small secondary" disabled={busy} onClick={() => ctx.open('booking', s.id)}>
          Edit booking
        </button>
        <button className="btn small danger" disabled={busy} onClick={() => ctx.open('cancel', s.id)}>
          Cancel session
        </button>
        {booked && (
          <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
            Cancel court
          </CourtReserveLink>
        )}
        <button
          className="btn small ghost"
          disabled={busy}
          onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'keep' }), 'Keeping it as is')}
        >
          Keep as is
        </button>
      </div>
      {s.cancellationDeadlineAt && !passed && (
        <details>
          <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
            Text this alert to yourself
          </summary>
          <SmsDraft to="You" phone={null} body={deadlineAlertMessage(s, tz, s.cancellationDeadlineAt)} />
        </details>
      )}
    </div>
  );
}

export function SessionSheets({
  ctx,
  sheet,
  onClose,
}: {
  ctx: AdminCtx;
  sheet: { kind: SheetKind; sessionId: string } | null;
  onClose: () => void;
}) {
  const s = sheet ? ctx.d.sessions.find((x) => x.id === sheet.sessionId) : undefined;
  const tz = ctx.d.group.timezone;
  const title = s ? `${formatShortDate(s.startsAt, tz)}` : '';
  const kind = s ? sheet!.kind : null;
  if (kind === 'cancel' && s) return <CancelSheet ctx={ctx} s={s} onClose={onClose} />;
  const titles: Record<Exclude<SheetKind, 'cancel'>, string> = {
    booking: `Booking · ${title}`,
    roster: `Players · ${title}`,
    payments: `Money · ${title}`,
    canceled: `Canceled · ${title}`,
    moved: `Moved · ${title}`,
  };
  return (
    <Sheet open={!!s && !!kind} title={kind ? titles[kind as Exclude<SheetKind, 'cancel'>] : ''} onClose={onClose}>
      {s && kind === 'booking' && (
        <div className="stack">
          <BookingForm ctx={ctx} s={s} onDone={onClose} />
          {!s.state.flags.started && (
            <details className="advanced move-session">
              <summary>Move this session</summary>
              <RescheduleForm ctx={ctx} s={s} onDone={() => ctx.open('moved', s.id)} />
            </details>
          )}
        </div>
      )}
      {s && kind === 'roster' && <RosterManager ctx={ctx} s={s} />}
      {s && kind === 'payments' && <PaymentsManager ctx={ctx} s={s} />}
      {s && (kind === 'canceled' || kind === 'moved') && <ChangeText ctx={ctx} s={s} canceled={kind === 'canceled'} />}
    </Sheet>
  );
}

// ---------- After a cancel or a move ----------

/**
 * The text to send the group after canceling or moving a session, with an
 * optional one-line reason. After a cancel, everyone who paid already has
 * their money as credit. Opening Messages never counts as sending.
 */
function ChangeText({ ctx, s, canceled }: { ctx: AdminCtx; s: AdminSessionView; canceled: boolean }) {
  const tz = ctx.d.group.timezone;
  const [reason, setReason] = useState('');
  const link = siteAddress(ctx.d.group.playerLink);
  const body = canceled ? canceledMessage(s, tz, Date.parse(ctx.d.now), link, reason) : movedMessage(s, s.plannedStartsAt ?? s.startsAt, tz, Date.parse(ctx.d.now), link, reason);
  // Everyone signed up and on the waitlist; never the organizer.
  const who = reach(s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted'), ctx.d.me?.id ?? null);
  return (
    <div className="stack">
      <label className="field">
        Reason (optional)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder={canceled ? 'Rain in the forecast' : 'Court swap'} />
      </label>
      <SmsDraft to="Everyone signed up and waiting" phone={null} phones={who.phones} missing={who.missing} openLabel={canceled ? 'Text the players who were in' : 'Text the players who are in'} body={body} />
      {canceled && <CreditBackList s={s} />}
    </div>
  );
}

/** After a cancel: who got their payment back as credit (automatic; nothing to tap). */
function CreditBackList({ s }: { s: AdminSessionView }) {
  const rows = s.roster.filter((r) => !r.isOrganizer && r.creditBackCents > 0);
  if (rows.length === 0) return null;
  return (
    <section className="stack" aria-label="Credit given back" data-credit-back-list>
      <h3>Now their credit</h3>
      <ul className="rows">
        {rows.map((r) => (
          <li key={r.playerId}>
            <span className="who">
              <strong>{r.name}</strong>
              <span className="small muted">{formatPrice(r.creditBackCents)} credit</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Booking ----------

function BookingForm({ ctx, s, onDone }: { ctx: AdminCtx; s: AdminSessionView; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const [status, setStatus] = useState<BookingStatus>(s.bookingStatus === 'needs_booking' ? 'booked' : s.bookingStatus);
  const [ref, setRef] = useState(s.reservationReference ?? '');
  const [cost, setCost] = useState(s.courtCostCents !== null ? (s.courtCostCents / 100).toFixed(2) : '');
  const [costError, setCostError] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(s.cancellationDeadlineAt ? toLocalInputValue(s.cancellationDeadlineAt, tz) : '');
  const { busy, run } = useAction(ctx);
  const deadlineIso = deadline ? fromLocalInputValue(deadline, tz) : null;
  const defaultHours = ctx.d.group.settings.defaultDeadlineHours;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = cost.trim() === '' ? null : parseDollars(cost);
    setCostError(cost.trim() !== '' && cents === null ? 'Enter an amount like 48 or 48.50.' : null);
    if (cost.trim() !== '' && cents === null) return;
    const ok = await run(
      () =>
        api('PUT', `/api/admin/sessions/${s.id}/booking`, {
          bookingStatus: status,
          venueName: s.venueName,
          venueBookingUrl: s.venueBookingUrl,
          reservationReference: ref || null,
          courtCostCents: cents,
          cancellationDeadlineAt: deadlineIso,
        }),
      'Booking saved',
    );
    if (ok) onDone();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="segmented" role="group" aria-label="Court status">
        {(
          [
            ['needs_booking', 'Not booked'],
            ['booked', 'Booked'],
            ['unavailable', 'Not available'],
          ] as const
        ).map(([v, label]) => (
          <button type="button" key={v} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {label}
          </button>
        ))}
      </div>
      <label className="field">
        Cancellation deadline
        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn small ghost"
        onClick={() => setDeadline(toLocalInputValue(new Date(Date.parse(s.startsAt) - defaultHours * 3600_000).toISOString(), tz))}
      >
        Fill in {defaultHours} hours before start
      </button>
      {deadlineIso && (
        <p className="small">
          Deadline: <strong>{formatDateTime(deadlineIso, tz)}</strong>
        </p>
      )}
      <details className="advanced" open={!!(ref || cost)}>
        <summary>More details</summary>
        <div className="stack">
          <label className="field">
            Reservation number (optional)
            <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
          </label>
          <label className="field">
            Court cost (only you see this)
            <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="48.00" aria-invalid={costError ? true : undefined} />
            {costError && <span className="field-error">{costError}</span>}
          </label>
        </div>
      </details>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save booking'}
      </button>
    </form>
  );
}

// ---------- Roster ----------

const ROSTER_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  waitlisted: 'Waitlist',
  withdrawn: 'Withdrew',
  declined: 'Declined',
};

function RosterManager({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  const [removing, setRemoving] = useState<AdminRosterEntry | null>(null);
  const live = !s.state.flags.canceled && !s.state.flags.started;
  const act = (playerId: string, action: string, msg: string) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/roster`, { playerId, action }), msg);
  const inRoster = new Set(s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted').map((r) => r.playerId));
  const others = ctx.d.players.filter((p) => p.isActive && !inRoster.has(p.id));
  const full = s.confirmedCount >= ctx.d.group.settings.maxPlayers;

  return (
    <div className="stack">
      {!live && <Notice tone="muted">Closed. View only.</Notice>}
      <ul className="list">
        {s.roster.map((r) => (
          <li key={r.playerId} className="stack" style={{ gap: 8 }}>
            <div className="spread">
              <div>
                <strong>{r.name}</strong>
                <div className="small muted">
                  {r.status === 'waitlisted' ? `#${r.waitlistPosition} on waitlist` : ROSTER_LABEL[r.status]}
                </div>
              </div>
              <Chip tone={r.status === 'confirmed' ? 'ok' : r.status === 'waitlisted' ? 'info' : 'muted'}>{ROSTER_LABEL[r.status]}</Chip>
            </div>
            {live && (
              <div className="btn-row">
                {r.status === 'confirmed' && (
                  <button className="btn small secondary" disabled={busy} onClick={() => act(r.playerId, 'waitlist', `${r.name} moved to waitlist`)}>
                    To waitlist
                  </button>
                )}
                {r.status !== 'confirmed' && (
                  <button className="btn small secondary" disabled={busy || full} onClick={() => act(r.playerId, 'confirm', `${r.name} got a spot`)}>
                    Give spot
                  </button>
                )}
                {(r.status === 'confirmed' || r.status === 'waitlisted') && (
                  <button className="btn small danger" disabled={busy} onClick={() => setRemoving(r)}>
                    Remove
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {s.roster.length === 0 && <p className="muted">Nobody has signed up yet.</p>}
      {live && others.length > 0 && (
        <>
          <h3>Add someone</h3>
          <ul className="list">
            {others
              .filter((p) => !s.roster.some((r) => r.playerId === p.id))
              .map((p) => (
                <li key={p.id} className="spread">
                  <span>{p.name}</span>
                  <div className="row">
                    <button className="btn small secondary" disabled={busy || full} onClick={() => act(p.id, 'confirm', `${p.name} got a spot`)}>
                      Give spot
                    </button>
                    <button className="btn small ghost" disabled={busy} onClick={() => act(p.id, 'waitlist', `${p.name} added to waitlist`)}>
                      Waitlist
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove ${removing?.name}?`}
        body="They'll show as withdrawn. If they held a spot, it opens up for someone else."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={async () => {
          if (removing) await act(removing.playerId, 'withdraw', `${removing.name} removed`);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

// ---------- Payments ----------

export function PaymentsManager({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const { busy, run } = useAction(ctx);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  // The organizer is not a row of their own money: they pay the venue (the court row below).
  const rows = s.roster.filter((r) => !r.isOrganizer && (r.status === 'confirmed' || r.paymentStatus === 'paid'));
  const setPaid = (r: AdminRosterEntry, paid: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid }), paid ? `${r.name} marked paid` : `${r.name} marked unpaid`);
  const price = ctx.d.group.settings.pricePerPlayerCents;
  const played = isPlayed(s);
  const fin = s.finalized;
  const myId = s.roster.find((r) => r.isOrganizer)?.playerId ?? ctx.d.me?.id ?? null;
  const setCourtPaid = (paid: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: myId, paid }), paid ? 'Court marked paid' : 'Court marked due');
  const reopen = () => run(() => api('POST', `/api/admin/sessions/${s.id}/reopen`, {}), 'Reopened. Finalize it again from Home.');

  /** One row's money line: what they paid, what came back as credit, or what they owe. */
  const moneyLine = (r: AdminRosterEntry) => {
    const paidWithCredit = r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0);
    const parts: string[] = [];
    if (r.status !== 'confirmed') parts.push(r.status === 'withdrawn' ? 'dropped out' : r.status === 'waitlisted' ? 'on the waitlist' : 'not playing');
    else if (fin && r.played === false) parts.push('did not play');
    if (r.paidAt && r.paymentStatus === 'paid') {
      parts.push(`${paidWithCredit ? 'paid with credit' : 'paid'} ${formatPrice(r.paymentAmountCents ?? 0)} on ${formatShortDate(r.paidAt, tz)}`);
      if (!paidWithCredit && r.creditCents > 0) parts.push(`${formatPrice(r.creditCents)} of it credit`);
      if (r.creditBackCents > 0) parts.push(`${formatPrice(r.creditBackCents)} back as credit`);
      else if (!played && !r.refundedAt) parts.push('not finalized yet');
    } else if (r.status === 'confirmed' && r.shareCents !== null) {
      parts.push(`owes ${formatPrice(r.owesCents)}`);
      if (r.creditCents > 0) parts.push(`${formatPrice(r.creditCents)} credit used`);
    } else if (r.creditBackCents > 0) parts.push(`${formatPrice(r.creditBackCents)} back as credit`);
    return parts.join(' · ');
  };

  return (
    <div className="stack">
      {!s.state.flags.canceled && (
        <div className="spread">
          <div>
            <div className="muted small">{fin ? 'Final price each' : 'Each player pays'}</div>
            <div className="big-amount" data-price-each>
              {formatPrice(fin ? fin.priceCents : price)}
            </div>
            {fin && (
              <div className="small muted" data-finalized-line>
                {fin.playedCount} played · {formatPrice(fin.priceCents)} each
                {fin.creditBackCents > 0 ? ` · ${formatPrice(fin.creditBackCents)} back as credit` : ''}
              </div>
            )}
            {!fin && played === false && Date.parse(s.endsAt) <= Date.parse(ctx.d.now) && <div className="small muted">Not finalized yet. Finalize it from Home.</div>}
          </div>
          {s.payableCount > 0 && (
            <Chip tone={s.paidCount === s.payableCount ? 'ok' : 'warn'}>
              {s.paidCount}/{s.payableCount} paid
            </Chip>
          )}
        </div>
      )}
      {s.state.flags.canceled && (
        <>
          <Notice tone="muted" title="Session canceled">
            Nobody owes for it. Anyone who paid has it as credit.
            {s.chargedCents ? ` The venue charged you ${formatPrice(s.chargedCents)}.` : ''}
          </Notice>
          <CreditBackList s={s} />
        </>
      )}
      {!s.state.flags.canceled && (
        <ul className="list who-paid">
          {s.court && (
            <li className="court-row" data-court={s.id}>
              <div className="pc-top">
                <strong className="pc-name">You pay Northville Pickleball</strong>
                <span className="court-cost">{formatPrice(s.court.costCents)}</span>
              </div>
              <div className="pc-sub">
                <span className="small muted">
                  {s.court.covered
                    ? 'Players cover the court'
                    : `Players cover ${formatPrice(s.court.playersCoverCents)}, your share ${formatPrice(s.court.yourShareCents)}`}
                </span>
                <Chip tone={s.court.paid ? 'ok' : 'warn'}>{s.court.paid ? 'Court paid' : 'Court due'}</Chip>
              </div>
              <div className="pay-btns">
                {myId ? (
                  <button className="btn small secondary" disabled={busy} onClick={() => setCourtPaid(!s.court!.paid)}>
                    {s.court.paid ? 'Unmark' : 'Mark paid'}
                  </button>
                ) : (
                  <span className="small muted">Add your name in Settings (Group &gt; Your name) to mark this paid.</span>
                )}
              </div>
            </li>
          )}
          {rows.map((r) => (
            <li key={r.playerId} className="pay-row" data-pay-row={r.name}>
              <div className="pay-top">
                <div className="pay-who">
                  <strong>{r.name}</strong>
                  {r.selfPaid && r.paymentStatus === 'paid' && <span className="self-tag">self-marked</span>}
                  <div className="small muted">{moneyLine(r)}</div>
                </div>
                <Chip tone={r.paymentStatus === 'paid' ? (played || r.refundedAt ? 'ok' : 'info') : r.owesCents > 0 ? 'warn' : 'muted'}>
                  {r.paymentStatus === 'paid'
                    ? r.refundedAt
                      ? 'Credit'
                      : r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0)
                        ? 'Paid with credit'
                        : 'Paid'
                    : r.owesCents > 0
                      ? 'Unpaid'
                      : 'Nothing owed'}
                </Chip>
              </div>
              <div className="pay-btns">
                {r.paymentStatus === 'paid' && !r.refundedAt ? (
                  <>
                    {r.selfPaid && (
                      <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, true)}>
                        Mark paid
                      </button>
                    )}
                    <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, false)}>
                      Unmark
                    </button>
                  </>
                ) : (
                  r.status === 'confirmed' &&
                  r.owesCents > 0 && (
                    <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, true)}>
                      Mark paid
                    </button>
                  )
                )}
                {r.paymentStatus === 'unpaid' && r.owesCents > 0 && (
                  <button className="btn small secondary" onClick={() => setDraftFor(draftFor === r.playerId ? null : r.playerId)}>
                    {draftFor === r.playerId ? 'Hide reminder' : 'Payment reminder'}
                  </button>
                )}
              </div>
              {draftFor === r.playerId && r.owesCents > 0 && <SmsDraft to={r.name} phone={r.phone} body={reminderText(ctx.d, r.playerId, r.name, s)} />}
            </li>
          ))}
        </ul>
      )}
      {fin && !s.state.flags.canceled && (
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn small secondary" disabled={busy || s.reopenBlockedBy.length > 0 || s.reopenRequestedBy.length > 0} data-reopen onClick={reopen}>
            Reopen
          </button>
          {s.reopenBlockedBy.length > 0 && (
            <p className="small muted" data-reopen-blocked>
              Can't reopen: {s.reopenBlockedBy.join(' and ')} already used or got back credit from this game.
            </p>
          )}
          {s.reopenBlockedBy.length === 0 && s.reopenRequestedBy.length > 0 && (
            <p className="small muted" data-reopen-blocked>
              {reopenRequestedReason(s.reopenRequestedBy)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Reschedule ----------

function RescheduleForm({ ctx, s, onDone }: { ctx: AdminCtx; s: AdminSessionView; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const startLocal = toLocalInputValue(s.startsAt, tz);
  const [date, setDate] = useState(startLocal.slice(0, 10));
  const [start, setStart] = useState(startLocal.slice(11));
  const [end, setEnd] = useState(toLocalInputValue(s.endsAt, tz).slice(11));
  const { busy, run } = useAction(ctx);
  const startsAt = date && start ? fromLocalInputValue(`${date}T${start}`, tz) : null;
  const endsAt = date && end ? fromLocalInputValue(`${date}T${end}`, tz) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt, endsAt }), 'Session moved');
    if (ok) onDone();
  }

  return (
    <form className="stack" onSubmit={submit}>
      {s.bookingStatus === 'booked' && (
        <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
          Change court on CourtReserve
        </CourtReserveLink>
      )}
      <label className="field">
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <label className="field" style={{ flex: 1 }}>
          Start
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field" style={{ flex: 1 }}>
          End
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      {startsAt && endsAt && (
        <p className="small">
          New time: <strong>{formatShortDate(startsAt, tz)}, {formatTimeRange(startsAt, endsAt, tz)}</strong>
        </p>
      )}
      <button className="btn" type="submit" disabled={busy || !startsAt || !endsAt}>
        {busy ? 'Saving…' : 'Move session'}
      </button>
    </form>
  );
}

// ---------- Cancel ----------

function CancelSheet({ ctx, s, onClose }: { ctx: AdminCtx; s: AdminSessionView; onClose: () => void }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const { busy, run } = useAction(ctx);
  const reopening = s.state.flags.canceled;
  // "Were you charged for this court?" is only asked within 12 hours of the start. No is the default.
  const start = Date.parse(s.startsAt);
  const serverNow = Date.parse(ctx.d.now);
  const askCharge = !reopening && serverNow >= start - CHARGE_ASK_HOURS * 3600_000 && serverNow < start;
  const [charged, setCharged] = useState(false);
  const [amount, setAmount] = useState(() => (((s.courtCostCents ?? ctx.d.group.settings.typicalCourtCostCents) || 0) / 100).toFixed(2));
  const [amountError, setAmountError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      title={reopening ? 'Reopen this session?' : `Cancel ${formatShortDate(s.startsAt, tz)}?`}
      body={
        <div className="stack">
          {reopening ? (
            <p>Players can sign up again. Links from before the cancellation stay dead; prepare new ones if needed.</p>
          ) : (
            <>
              <p>Players will see it as canceled, and reminders and payments stop for it.</p>
              <Notice tone="warn" title="This does not cancel your court">
                Cancel the reservation with the venue yourself.
                {s.cancellationDeadlineAt ? ` Venue deadline: ${deadlineLine(s, tz, now)}.` : ''}
              </Notice>
              {s.bookingStatus === 'booked' && (
                <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
                  Cancel court on CourtReserve
                </CourtReserveLink>
              )}
              {askCharge && (
                <fieldset className="charge-ask">
                  <legend>Were you charged for this court?</legend>
                  <div className="segmented" role="group" aria-label="Were you charged for this court?">
                    <button type="button" aria-pressed={!charged} onClick={() => setCharged(false)}>
                      No
                    </button>
                    <button type="button" aria-pressed={charged} onClick={() => setCharged(true)}>
                      Yes
                    </button>
                  </div>
                  {charged && (
                    <label className="field">
                      Amount charged
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setAmountError(null);
                        }}
                        aria-invalid={amountError ? true : undefined}
                      />
                      {amountError && <span className="field-error">{amountError}</span>}
                    </label>
                  )}
                  <p className="small muted">A Yes counts as the court cost for this canceled game in Money. Only you see this.</p>
                </fieldset>
              )}
            </>
          )}
        </div>
      }
      confirmLabel={reopening ? 'Reopen session' : 'Cancel session'}
      danger={!reopening}
      busy={busy}
      onConfirm={async () => {
        let chargedCents = 0;
        if (askCharge && charged) {
          const cents = parseDollars(amount);
          if (cents === null) return setAmountError('Enter an amount like 48 or 48.50.');
          chargedCents = cents;
        }
        const ok = await run(
          () =>
            api(
              'POST',
              `/api/admin/sessions/${s.id}/decision`,
              reopening ? { decision: 'reopen' } : { decision: 'cancel', confirm: true, ...(chargedCents > 0 ? { chargedCents } : {}) },
            ),
          reopening ? 'Session reopened' : 'Session canceled',
        );
        // After a cancel, go straight to the text for the group and who to pay back.
        if (ok) (reopening ? onClose() : ctx.open('canceled', s.id));
      }}
      onCancel={onClose}
    />
  );
}
