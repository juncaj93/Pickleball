import { type FormEvent, useEffect, useState } from 'react';
import type { ActionLinkDraft, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  bookingMessage,
  canceledMessage,
  movedMessage,
  confirmationMessage,
  deadlineAlertMessage,
  paymentMessage,
  courtWaitlistPollMessage,
  pollMessage,
  replacementMessage,
} from '../../../shared/messages';
import { formatCents, formatPrice, parseDollars } from '../../../shared/money';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL, DEFAULT_VENUE_NAME } from '../../../shared/settings';
import { DateTile, HolidayPill } from '../PlayerHome';
import type { BookingStatus } from '../../../shared/status';
import {
  formatDateTime,
  formatMonthDay,
  formatRelative,
  formatTime,
  formatShortDate,
  formatTimeRange,
  fromLocalInputValue,
  toLocalInputValue,
} from '../../../shared/time';
import { api, ApiError, useNow } from '../../lib';
import { Chip, ConfirmDialog, CourtIcon, CourtReserveLink, Notice, PlayersLine, Sheet, SmsDraft, useToast } from '../../ui';
import { courtStatus } from '../../../shared/court';
import { type AdminCtx, deadlineLine } from '../Admin';

export type SheetKind = 'booking' | 'roster' | 'payments' | 'reminders' | 'invite' | 'cancel' | 'reschedule' | 'poll' | 'canceled' | 'moved';

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
  const paid = s.payableCount > 0 ? `${s.paidCount}/${s.payableCount} paid` : null;
  return (
    <article id={`session-${s.id}`} tabIndex={-1} className={`card scard court-${court.kind}`} data-court={court.kind} aria-labelledby={`as-${s.id}`}>
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
            <span className="sched-time">{formatTimeRange(s.startsAt, s.endsAt, tz)}</span>
            <button className="btn small ghost more-btn" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              {more ? 'Less' : 'More'}
            </button>
          </div>
          {s.holiday && <HolidayControl ctx={ctx} s={s} />}
          {court.kind === 'booked' && (
            <div className="court-line">
              <div className="court-status">
                <CourtIcon kind="booked" />
                <span>{court.text}</span>
              </div>
              {!s.state.flags.past && <div className="court-sub">Cancel by {shortDeadline(s, tz, now)}</div>}
            </div>
          )}
          {(court.kind === 'off' || later) && (
            <div className="court-line">
              <div className="court-status">
                <CourtIcon kind={court.kind} />
                <span>{court.text}</span>
              </div>
              {s.state.flags.canceled && s.canceledAt && <div className="court-sub muted">{formatDateTime(s.canceledAt, tz)}</div>}
            </div>
          )}
          {!s.state.flags.canceled && (
            <PlayersLine
              names={s.roster
                .filter((r) => r.status === 'confirmed')
                .sort((a, b) => (a.confirmedAt ?? '').localeCompare(b.confirmedAt ?? ''))
                .map((r) => r.name)}
              waiting={s.waitlistCount}
              waitingWord={courtWait ? 'on standby' : 'waiting'}
              extra={paid}
            />
          )}
        </div>
      </div>
      {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}

      {/* One main button; court actions live in the banner above, everything else under More. */}
      {live && court.kind === 'booked' && (
        <button className="btn block main-btn" onClick={() => ctx.open('poll', s.id)}>
          Text the group poll
        </button>
      )}
      {more && details.length > 0 && <p className="small muted court-details">{details.join(' · ')}</p>}
      {more && (
        <div className="action-strip">
          <button className="btn small secondary" onClick={() => ctx.open('booking', s.id)}>
            Edit booking
          </button>
          <button className="btn small secondary" onClick={() => ctx.open('roster', s.id)}>
            Players
          </button>
          <button className="btn small secondary" onClick={() => ctx.open('payments', s.id)}>
            Money
          </button>
          {live && (
            <button className="btn small secondary" onClick={() => ctx.open('reminders', s.id)}>
              Texts
            </button>
          )}
          {live && (needsCourt || courtWait || later) && (
            <button className="btn small secondary" onClick={() => ctx.open('poll', s.id)}>
              Text the group poll
            </button>
          )}
          {live && (
            <button className="btn small secondary" onClick={() => ctx.open('reschedule', s.id)}>
              Reschedule
            </button>
          )}
          {live && s.state.flags.openSpots > 0 && !courtWait && (
            <button className="btn small secondary" onClick={() => ctx.open('invite', s.id)}>
              Invite substitutes
            </button>
          )}
          {later && <BookedButton ctx={ctx} s={s} small />}
          {live && s.bookingStatus === 'booked' && (
            <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
              Change or cancel court
            </CourtReserveLink>
          )}
          {(needsCourt || later) && <CourtWaitlistStart ctx={ctx} s={s} />}
          {s.shownEarly && <HideAgain ctx={ctx} s={s} />}
          {!s.state.flags.started && s.courtState !== 'not_opened' && (
            <button className="btn small danger" onClick={() => ctx.open('cancel', s.id)}>
              {s.state.flags.canceled ? 'Reopen session' : 'Cancel session'}
            </button>
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
 * Holiday pill for the organizer: "Election Day · check venue hours" with
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
  const open = s.state.flags.openSpots;
  return (
    <div className="stack">
      <p className="small">
        <strong>{s.confirmedCount} going.</strong> {open} more needed.{' '}
        {s.cancellationDeadlineAt &&
          (passed
            ? booked
              ? 'The cancellation deadline passed, so canceling the court may not be free.'
              : 'The cancellation deadline passed.'
            : `Reschedule or cancel by ${deadlineLine(s, tz, now)}.`)}
      </p>
      <div className="action-strip">
        <button className="btn small" disabled={busy} onClick={() => ctx.open('invite', s.id)}>
          Invite people
        </button>
        <button className="btn small secondary" disabled={busy} onClick={() => ctx.open('reschedule', s.id)}>
          Reschedule
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
    reminders: `Reminders · ${title}`,
    invite: `Invite people · ${title}`,
    reschedule: `Reschedule · ${title}`,
    poll: `Group poll · ${title}`,
    canceled: `Canceled · ${title}`,
    moved: `Moved · ${title}`,
  };
  return (
    <Sheet open={!!s && !!kind} title={kind ? titles[kind as Exclude<SheetKind, 'cancel'>] : ''} onClose={onClose}>
      {s && kind === 'booking' && <BookingForm ctx={ctx} s={s} onDone={onClose} />}
      {s && kind === 'roster' && <RosterManager ctx={ctx} s={s} />}
      {s && kind === 'payments' && <PaymentsManager ctx={ctx} s={s} />}
      {s && kind === 'reminders' && <Reminders ctx={ctx} s={s} />}
      {s && kind === 'invite' && <InviteSubs ctx={ctx} s={s} />}
      {s && kind === 'reschedule' && <RescheduleForm ctx={ctx} s={s} onDone={() => ctx.open('moved', s.id)} />}
      {s && (kind === 'canceled' || kind === 'moved') && <ChangeText ctx={ctx} s={s} canceled={kind === 'canceled'} />}
      {s && kind === 'poll' && (
        <div className="stack">
          <SmsDraft
            to="Group chat"
            phone={null}
            body={
              s.courtState === 'waitlist'
                ? courtWaitlistPollMessage(s, tz, ctx.d.group.playerLink)
                : pollMessage(s, tz, ctx.d.group.venueName || DEFAULT_VENUE_NAME, ctx.d.group.settings.pricePerPlayerCents)
            }
          />
        </div>
      )}
    </Sheet>
  );
}

// ---------- After a cancel or a move ----------

/**
 * The text to send the group after canceling or moving a session, with an
 * optional one-line reason. After a cancel, also who to pay back.
 * Opening Messages never counts as sending.
 */
function ChangeText({ ctx, s, canceled }: { ctx: AdminCtx; s: AdminSessionView; canceled: boolean }) {
  const tz = ctx.d.group.timezone;
  const [reason, setReason] = useState('');
  const body = canceled ? canceledMessage(s, tz, reason) : movedMessage(s, tz, reason);
  return (
    <div className="stack">
      <label className="field">
        Reason (optional)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder={canceled ? 'Rain in the forecast' : 'Court swap'} />
      </label>
      <SmsDraft to="Group chat" phone={null} openLabel="Text the group" body={body} />
      {canceled && <RefundList ctx={ctx} s={s} />}
    </div>
  );
}

/** Everyone who paid for a canceled session, with a Refunded checkbox. A record only; no money moves. */
export function RefundList({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  // Ticks show right away while saving.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const paid = s.roster.filter((r) => r.paymentStatus === 'paid');
  if (paid.length === 0) return null;
  const isRefunded = (r: AdminRosterEntry) => pending[r.playerId] ?? !!r.refundedAt;
  const left = paid.filter((r) => !isRefunded(r)).length;
  return (
    <section className="stack refunds" aria-label="Pay back">
      <h3>Pay back {left > 0 ? `(${left} left)` : '(all done)'}</h3>
      <ul className="rows">
        {paid.map((r) => (
          <li key={r.playerId}>
            <span className="who">
              <strong>{r.name}</strong>
              <span className="small muted">paid {formatPrice(r.paymentAmountCents ?? 0)}</span>
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={isRefunded(r)}
                disabled={busy}
                onChange={async (e) => {
                  const refunded = e.target.checked;
                  setPending((p) => ({ ...p, [r.playerId]: refunded }));
                  await run(() => api('POST', `/api/admin/sessions/${s.id}/refund`, { playerId: r.playerId, refunded }), refunded ? 'Refunded' : 'Unmarked');
                  setPending(({ [r.playerId]: _, ...rest }) => rest);
                }}
              />
              <span>Refunded</span>
            </label>
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
        Cancellation deadline (Eastern time)
        <span className="hint">Starts at {defaultHours} hours before play. Change it if this booking's rule is different.</span>
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
            Court cost (optional)
            <span className="hint">Your own record. Players never see it, and it's never in a text.</span>
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
  const full = s.confirmedCount >= 6;

  return (
    <div className="stack">
      {!live && <Notice tone="muted" title="This session is closed">You can view it but not change who's playing.</Notice>}
      <ul className="list">
        {s.roster.map((r) => (
          <li key={r.playerId} className="stack" style={{ gap: 8 }}>
            <div className="spread">
              <div>
                <strong>{r.name}</strong>
                <div className="small muted">
                  {r.status === 'waitlisted' ? `#${r.waitlistPosition} on waitlist` : ROSTER_LABEL[r.status]}
                  {r.attendanceConfirmedAt ? ' · confirmed attendance' : ''}
                </div>
              </div>
              <Chip tone={r.status === 'confirmed' ? 'ok' : r.status === 'waitlisted' ? 'info' : 'muted'}>{ROSTER_LABEL[r.status]}</Chip>
            </div>
            {live && (
              <div className="btn-row">
                {r.status === 'confirmed' && !r.attendanceConfirmedAt && (
                  <button className="btn small secondary" disabled={busy} onClick={() => act(r.playerId, 'confirm_attendance', `${r.name} marked as coming`)}>
                    Mark coming
                  </button>
                )}
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
  const venmo = ctx.d.group.venmoUrl;
  const { busy, run } = useAction(ctx);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const rows = s.roster.filter((r) => r.status === 'confirmed' || r.paymentStatus === 'paid');
  const setPaid = (r: AdminRosterEntry, paid: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid }), paid ? `${r.name} marked paid` : `${r.name} marked unpaid`);
  const price = ctx.d.group.settings.pricePerPlayerCents;

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <div className="muted small">Each player pays</div>
          <div className="big-amount">{formatPrice(price)}</div>
        </div>
        <Chip tone={s.paidCount === s.payableCount && s.payableCount > 0 ? 'ok' : 'warn'}>
          {s.paidCount}/{s.payableCount} paid
        </Chip>
      </div>
      {s.state.flags.canceled && (
        <>
          <Notice tone="muted" title="Session canceled">
            Nobody owes for it.
          </Notice>
          <RefundList ctx={ctx} s={s} />
        </>
      )}
      <ul className="list">
        {rows.map((r) => (
          <li key={r.playerId} className="stack" style={{ gap: 8 }}>
            <div className="spread">
              <div>
                <strong>{r.name}</strong>
                <div className="small muted">
                  {r.status !== 'confirmed' ? 'No longer playing · ' : ''}
                  {r.paidAt
                    ? `paid ${formatPrice(r.paymentAmountCents ?? 0)} on ${formatShortDate(r.paidAt, tz)}`
                    : `owes ${formatPrice((r.shareCents ?? price) - r.creditCents)}`}
                  {r.discount ? ' · 6-person discount' : ''}
                  {r.creditCents > 0 ? ` · ${formatPrice(r.creditCents)} credit used` : ''}
                </div>
              </div>
              <Chip tone={r.paymentStatus === 'paid' ? 'ok' : 'warn'}>{r.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</Chip>
            </div>
            <div className="btn-row">
              {r.paymentStatus === 'paid' ? (
                <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, false)}>
                  Mark unpaid
                </button>
              ) : (
                r.status === 'confirmed' &&
                !s.state.flags.canceled && (
                  <button className="btn small" disabled={busy} onClick={() => setPaid(r, true)}>
                    Mark paid
                  </button>
                )
              )}
              {r.paymentStatus === 'unpaid' && r.shareCents !== null && !s.state.flags.canceled && (
                <button className="btn small secondary" onClick={() => setDraftFor(draftFor === r.playerId ? null : r.playerId)}>
                  {draftFor === r.playerId ? 'Hide reminder' : 'Payment reminder'}
                </button>
              )}
            </div>
            {draftFor === r.playerId && r.shareCents !== null && (
              <SmsDraft to={r.name} phone={r.phone} body={paymentMessage(r.name, r.shareCents - r.creditCents, s, tz, venmo)} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Reminders ----------

function Reminders({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const [drafts, setDrafts] = useState<ActionLinkDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfirmed = s.roster.filter((r) => r.status === 'confirmed' && !r.attendanceConfirmedAt);
  const dueAt = new Date(Date.parse(s.startsAt) - ctx.d.group.settings.checkInHours * 3600_000).toISOString();
  const unpaid = s.roster.filter((r) => r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ drafts: ActionLinkDraft[] }>('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'attendance' });
      setDrafts(res.drafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare links.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <section className="stack">
        <h3>Day-before check-in</h3>
        <p className="small muted">
          {s.state.flags.checkInsDue
            ? `Due now. ${unconfirmed.length} player${unconfirmed.length === 1 ? '' : 's'} haven't checked in.`
            : Date.parse(dueAt) > now
              ? `Due ${formatDateTime(dueAt, tz)} (${formatRelative(dueAt, now)}).`
              : 'Everyone checked in.'}
        </p>
        {error && <Notice tone="danger">{error}</Notice>}
        {unconfirmed.length > 0 && !drafts && (
          <button className="btn" disabled={busy} onClick={prepare}>
            {busy ? 'Preparing…' : `Prepare ${unconfirmed.length} check-in text${unconfirmed.length === 1 ? '' : 's'}`}
          </button>
        )}
        {drafts?.map((d) => (
          <SmsDraft key={d.playerId} to={d.name} phone={d.phone} body={confirmationMessage(d.name, s, tz, d.url)} />
        ))}
        {drafts && drafts.length === 0 && <p className="muted">Nobody left to remind.</p>}
      </section>

      {unpaid.length > 0 && (
        <section className="stack">
          <h3>Payment reminders</h3>
          {unpaid.map((r) => (
            <SmsDraft key={r.playerId} to={r.name} phone={r.phone} body={paymentMessage(r.name, r.shareCents!, s, tz, ctx.d.group.venmoUrl)} />
          ))}
        </section>
      )}

      <section className="stack">
        <h3>Group text about booking</h3>
        <SmsDraft to="Group chat" phone={null} body={bookingMessage(s, tz)} />
      </section>
    </div>
  );
}

// ---------- Substitutes ----------

function InviteSubs({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(s.eligibleSubstitutes.map((e) => e.playerId)));
  const [drafts, setDrafts] = useState<ActionLinkDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = s.state.flags.openSpots === 0;

  // While invitations are out, check every 8 seconds whether someone claimed the spot.
  useEffect(() => {
    if (!drafts || full) return;
    const t = setInterval(() => void ctx.reload(), 8000);
    return () => clearInterval(t);
  }, [drafts, full, ctx]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ drafts: ActionLinkDraft[] }>('POST', `/api/admin/sessions/${s.id}/links`, {
        kind: 'claim',
        playerIds: [...selected],
      });
      setDrafts(res.drafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare invitations.');
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = { waitlist: 'Waitlist', regular: 'Regular', substitute: 'Sub' };

  return (
    <div className="stack">
      {full ? (
        <Notice tone="ok" title="Spot filled">
          {s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name).join(', ')} are playing. You can stop sending invitations.
        </Notice>
      ) : (
        <p>
          <strong>{s.state.flags.openSpots}</strong> open spot{s.state.flags.openSpots === 1 ? '' : 's'}. Everyone you invite gets a personal link; the first to tap
          it gets the spot.
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {!drafts && !full && (
        <>
          {s.eligibleSubstitutes.length === 0 && <p className="muted">Nobody else is available to invite.</p>}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="section-title">Who to invite</legend>
            {s.eligibleSubstitutes.map((e) => (
              <label key={e.playerId} className="check">
                <input
                  type="checkbox"
                  checked={selected.has(e.playerId)}
                  onChange={(ev) =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (ev.target.checked) next.add(e.playerId);
                      else next.delete(e.playerId);
                      return next;
                    })
                  }
                />
                <span>
                  {e.name} <span className="muted small">· {sourceLabel[e.source]}{e.phone ? '' : ' · no phone saved'}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button className="btn" disabled={busy || selected.size === 0} onClick={prepare}>
            {busy ? 'Preparing…' : `Prepare invitations (${selected.size})`}
          </button>
        </>
      )}
      {drafts && (
        <div className="stack" style={{ opacity: full ? 0.55 : 1 }}>
          {drafts.map((d) => (
            <SmsDraft key={d.playerId} to={d.name} phone={d.phone} body={replacementMessage(s, tz, d.url)} />
          ))}
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
      <p className="small muted">The cancellation deadline resets to {ctx.d.group.settings.defaultDeadlineHours} hours before the new time.</p>
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
            </>
          )}
        </div>
      }
      confirmLabel={reopening ? 'Reopen session' : 'Cancel session'}
      danger={!reopening}
      busy={busy}
      onConfirm={async () => {
        const ok = await run(
          () => api('POST', `/api/admin/sessions/${s.id}/decision`, reopening ? { decision: 'reopen' } : { decision: 'cancel', confirm: true }),
          reopening ? 'Session reopened' : 'Session canceled',
        );
        // After a cancel, go straight to the text for the group and who to pay back.
        if (ok) (reopening ? onClose() : ctx.open('canceled', s.id));
      }}
      onCancel={onClose}
    />
  );
}
