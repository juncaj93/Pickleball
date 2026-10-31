import { useRef, useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  canceledMessage,
  movedMessage,
  deadlineAlertMessage,
  siteAddress,
} from '../../../shared/messages';
import { CHARGE_ASK_HOURS, reopenRequestedReason } from '../../../shared/credit';
import { formatPrice, parseDollars } from '../../../shared/money';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { DateTile, HolidayPill } from '../PlayerHome';
import { cancelByCardLine, cancelByIso, cancelByShort, cardTime, formatTime, formatShortDate, weekFade } from '../../../shared/time';
import { api, ApiError, useNow } from '../../lib';
import { BANNER_TIMING } from '../../ui';
import { startHold, undoHold, UNDO_MS } from '../../hold';
import { Chip, ConfirmDialog, CourtIcon, CourtReserveLink, Notice, PlayersLine, Sheet, SmsDraft, useToast } from '../../ui';
import { type CourtKind, type CourtSwitch as CourtSwitchValue, courtStatus, courtSwitchOf } from '../../../shared/court';
import { type AdminCtx } from '../Admin';
import { CourtSwitch } from './CourtSwitch';
import { EditGameForm } from './EditGame';
import { GameMenu } from './GameMenu';
import { reach, reminderText } from './textMenu';
import { markTask } from './DoNow';
import { isPlayed, lateDropsAll } from './todo';
import '../../credit-session.css';
import '../../admin-cards.css';

export type SheetKind = 'edit' | 'roster' | 'payments' | 'cancel' | 'canceled' | 'moved' | 'moved_set';

export function useAction(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function run(fn: () => Promise<unknown>, success?: string) {
    if (working.current) return false;
    working.current = true;
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
      working.current = false;
      setBusy(false);
    }
  }
  return { busy, run };
}

export function SessionCard({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const live = !s.state.flags.canceled && !s.state.flags.started;
  const court = courtStatus(
    { ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past, bookingOpen: s.state.flags.bookingWindowOpen },
    tz,
  );
  // A canceled game shows why, when the organizer said: "Canceled - Thanksgiving".
  if (s.state.flags.canceled && s.cancelReason && s.courtState !== 'not_opened') court.text = `Canceled - ${s.cancelReason}`;
  const later = court.kind === 'later';
  const courtWait = court.kind === 'waitlist';
  const switchValue = courtSwitchOf(s);
  // The switch shows until the game is over. Canceled, started and played games show the gray reason line instead.
  const showSwitch = !s.state.flags.canceled && !s.state.flags.past && !s.state.flags.started;
  const start = cardTime(s.startsAt, s.endsAt, tz).start;
  const cancelBy = live ? cancelByCardLine(s.startsAt, now, tz) : null;
  const inCount = s.payableCount;
  return (
    <article id={`session-${s.id}`} tabIndex={-1} className={`card scard court-${court.kind}`} data-court={court.kind} data-switch={switchValue} data-fade={weekFade(s.startsAt, now, tz) || undefined} data-remind={s.state.flags.bookingPromptDue || undefined} aria-labelledby={`as-${s.id}`}>
      <div className="scard-main">
        <div className="scard-tilecol">
          <DateTile iso={s.startsAt} tz={tz} />
          <div className="scard-time" data-card-time aria-hidden="true">
            {start}
          </div>
        </div>
        <div className="scard-body">
          <h2 id={`as-${s.id}`} className="sr-only">
            {formatShortDate(s.startsAt, tz)}, {formatTime(s.startsAt, tz)}
          </h2>
          <div className="scard-top">
            {showSwitch ? <CardSwitch ctx={ctx} s={s} value={switchValue} /> : <div className="court-line top-line">{courtLine(court)}</div>}
            <div className="card-icons">
              <GameMenu ctx={ctx} s={s} canCalendar={court.kind === 'booked' && live} />
            </div>
          </div>
          {showSwitch && later && <div className="court-sub small muted">{court.text}</div>}
          {(s.extra || s.note) && (
            <div className="game-note">
              {s.extra && <span className="extra-tag">Extra game</span>}
              {s.note}
            </div>
          )}
          {s.holiday && <HolidayControl ctx={ctx} s={s} />}
          {lateDropsAll(s).length > 0 && (
            <div className="late-line">
              <span className="late-tag">Late drop</span> {lateDropsAll(s).map((r) => `${r.name} ${formatTime(r.lateDropAt!, tz)}`).join(', ')}
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
          {(inCount > 0 || cancelBy) && !s.state.flags.canceled && (
            <div className="card-meta">
              {inCount > 0 && (
                <button
                  type="button"
                  className="paid-pill"
                  data-all-paid={s.paidCount === inCount ? 'yes' : undefined}
                  aria-label={`${s.paidCount} of ${inCount} paid. Open the players list.`}
                  onClick={() => ctx.open('roster', s.id)}
                >
                  <span>{s.paidCount} of {inCount} paid</span>
                </button>
              )}
              {cancelBy && <span className="cancel-by-soon">{cancelBy}</span>}
            </div>
          )}
        </div>
      </div>
      {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}
    </article>
  );
}

/** The gray reason line for a game that is canceled, played or already started. */
function courtLine(court: { kind: string; text: string }) {
  return (
    <div className="court-status">
      <CourtIcon kind={court.kind as CourtKind} />
      <span>{court.text}</span>
    </div>
  );
}

/** The card's one-tap switch. Shows the tap at once, saves it, and puts it back if the save fails. */
function CardSwitch({ ctx, s, value }: { ctx: AdminCtx; s: AdminSessionView; value: CourtSwitchValue }) {
  const { busy, run } = useAction(ctx);
  const [picked, setPicked] = useState<CourtSwitchValue | null>(null);
  const shown = picked ?? value;
  return (
    <CourtSwitch
      value={shown}
      disabled={busy}
      label={`Court status for ${formatShortDate(s.startsAt, ctx.d.group.timezone)}`}
      onPick={async (to) => {
        setPicked(to);
        await run(() => api('POST', `/api/admin/sessions/${s.id}/court-status`, { status: to }), to === 'booked' ? 'Court booked' : to === 'waitlist' ? 'On the waitlist' : 'Court not booked');
        setPicked(null);
      }}
    />
  );
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

export function HideAgain({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
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
  const passed = Date.parse(cancelByIso(s.startsAt)) <= now;
  const booked = s.bookingStatus === 'booked';
  return (
    <div className="stack">
      <p className="small">
        <strong>{s.confirmedCount} going.</strong> {s.state.flags.playersNeeded} more needed.{' '}
        {passed
          ? booked
            ? 'The cancellation deadline passed, so canceling the court may not be free.'
            : 'The cancellation deadline passed.'
          : `Reschedule or cancel by ${cancelByShort(s.startsAt, tz)}.`}
      </p>
      <div className="action-strip">
        <button className="btn small secondary" disabled={busy} onClick={() => ctx.open('edit', s.id)}>
          Edit game
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
      {!passed && (
        <details>
          <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
            Text this alert to yourself
          </summary>
          <SmsDraft to="You" phone={null} body={deadlineAlertMessage(s, tz, cancelByIso(s.startsAt))} />
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
    edit: s ? `Edit game · ${formatShortDate(s.startsAt, tz).replace(',', '')}` : '',
    roster: `Players · ${title}`,
    payments: `Money · ${title}`,
    canceled: `Canceled · ${title}`,
    moved: `Moved · ${title}`,
    moved_set: `Moved · ${title}`,
  };
  return (
    <Sheet open={!!s && !!kind} title={kind ? titles[kind as Exclude<SheetKind, 'cancel'>] : ''} onClose={onClose}>
      {s && kind === 'edit' && (
        <EditGameForm
          ctx={ctx}
          s={s}
          // A real move opens the Moved text (and, unless the switch was just set, "Is the court booked for the new time?").
          onDone={(moved, statusChanged) => (moved ? ctx.open(statusChanged ? 'moved_set' : 'moved', s.id) : onClose())}
        />
      )}
      {s && kind === 'roster' && <RosterManager ctx={ctx} s={s} />}
      {s && kind === 'payments' && <PaymentsManager ctx={ctx} s={s} />}
      {s && (kind === 'canceled' || kind === 'moved' || kind === 'moved_set') && <ChangeText ctx={ctx} s={s} canceled={kind === 'canceled'} askCourt={kind === 'moved'} />}
    </Sheet>
  );
}

// ---------- After a cancel or a move ----------

/**
 * The text to send the group after canceling or moving a session, with an
 * optional one-line reason. After a cancel, everyone who paid already has
 * their money as credit. Opening Messages never counts as sending.
 */
function ChangeText({ ctx, s, canceled, askCourt }: { ctx: AdminCtx; s: AdminSessionView; canceled: boolean; askCourt: boolean }) {
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
      <SmsDraft
        to="Everyone signed up and waiting"
        phone={null}
        phones={who.phones}
        missing={who.missing}
        openLabel={canceled ? 'Text the players who were in' : 'Text the players who are in'}
        body={body}
        onOpen={canceled ? () => void markTask(s.id, 'canceled_text').then(ctx.reload, () => {}) : undefined}
      />
      {!canceled && askCourt && <CourtForNewTime ctx={ctx} s={s} />}
      {canceled && <CreditBackList s={s} />}
    </div>
  );
}

/** After a move: "Is the court booked for the new time? Yes / No" sets the court status from the answer. */
function CourtForNewTime({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  const [answer, setAnswer] = useState<boolean | null>(null);
  const pick = async (booked: boolean) => {
    const ok = await run(() => api('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked }), booked ? 'Court marked booked' : 'Court marked not booked');
    if (ok) setAnswer(booked);
  };
  return (
    <fieldset className="charge-ask" data-court-question>
      <legend>Is the court booked for the new time?</legend>
      <div className="segmented" role="group" aria-label="Is the court booked for the new time?">
        <button type="button" aria-pressed={answer === true} disabled={busy} onClick={() => void pick(true)}>
          Yes
        </button>
        <button type="button" aria-pressed={answer === false} disabled={busy} onClick={() => void pick(false)}>
          No
        </button>
      </div>
      {answer === false && (
        <CourtReserveLink href={COURTRESERVE_BOOKING_URL} small>
          Book on CourtReserve
        </CourtReserveLink>
      )}
    </fieldset>
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

// ---------- Roster ----------

const ROSTER_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  waitlisted: 'Waitlist',
  withdrawn: 'Withdrew',
  declined: 'Declined',
};

function RosterManager({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  const toast = useToast();
  const [removing, setRemoving] = useState<AdminRosterEntry | null>(null);
  // Removed people whose Remove is being held for Undo: shown as removed, not sent yet.
  const [held, setHeld] = useState<Set<string>>(new Set());
  const setHeldFor = (playerId: string, on: boolean) =>
    setHeld((h) => {
      const next = new Set(h);
      if (on) next.add(playerId);
      else next.delete(playerId);
      return next;
    });
  /** Remove: shown at once, sent after 5 seconds unless Undo is tapped (or at once if the page closes). */
  function removeHeld(r: AdminRosterEntry) {
    const key = `${s.id}:${r.playerId}`;
    setHeldFor(r.playerId, true);
    startHold(key, {
      send: async (leaving) => {
        await api('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: r.playerId, action: 'withdraw' }, { keepalive: leaving });
      },
      settled: async (err) => {
        if (err) {
          setHeldFor(r.playerId, false);
          toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
        }
        await ctx.reload();
        setHeldFor(r.playerId, false);
      },
      undone: () => setHeldFor(r.playerId, false),
    });
    toast(`${r.name} removed.`, 'ok', { stayMs: UNDO_MS - BANNER_TIMING.fadeIn, action: { label: 'Undo', onClick: () => { if (!undoHold(key)) toast(`Too late, ${r.name} was already removed.`, 'error'); } } });
  }
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
                  {held.has(r.playerId) ? 'Removed' : r.status === 'waitlisted' ? `#${r.waitlistPosition} on waitlist` : ROSTER_LABEL[r.status]}
                </div>
              </div>
              <Chip tone={held.has(r.playerId) ? 'muted' : r.status === 'confirmed' ? 'ok' : r.status === 'waitlisted' ? 'info' : 'muted'}>{held.has(r.playerId) ? 'Removed' : ROSTER_LABEL[r.status]}</Chip>
            </div>
            {live && !held.has(r.playerId) && (
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
        onConfirm={() => {
          if (removing) removeHeld(removing);
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
                    : r.creditCents > 0 && r.status === 'confirmed'
                      ? `Credit ${formatPrice(r.creditCents)}`
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
                  r.status === 'confirmed' && (
                    <>
                      {r.owesCents > 0 && (
                        <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, true)}>
                          Mark paid
                        </button>
                      )}
                      {/* Credit on a seat that still owes ("Credit $3"): Unmark puts it back in their credit. */}
                      {r.paymentStatus === 'unpaid' && r.creditCents > 0 && (
                        <button
                          className="btn small secondary"
                          disabled={busy}
                          data-unmark-credit={r.name}
                          onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: false }), `${r.name}'s credit put back`)}
                        >
                          Unmark
                        </button>
                      )}
                    </>
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

// ---------- Cancel ----------

function CancelSheet({ ctx, s, onClose }: { ctx: AdminCtx; s: AdminSessionView; onClose: () => void }) {
  const tz = ctx.d.group.timezone;
  const { busy, run } = useAction(ctx);
  const reopening = s.state.flags.canceled;
  // "Were you charged for this court?" is only asked within 12 hours of the start. No is the default.
  const start = Date.parse(s.startsAt);
  const serverNow = Date.parse(ctx.d.now);
  const askCharge = !reopening && serverNow >= start - CHARGE_ASK_HOURS * 3600_000 && serverNow < start;
  const [charged, setCharged] = useState(false);
  const [amount, setAmount] = useState(() => (((s.courtCostCents ?? ctx.d.group.settings.typicalCourtCostCents) || 0) / 100).toFixed(2));
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
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
                {` Cancel by ${cancelByShort(s.startsAt, tz)}.`}
              </Notice>
              {s.bookingStatus === 'booked' && (
                <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
                  Cancel court on CourtReserve
                </CourtReserveLink>
              )}
              <label className="field">
                Reason (optional)
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={40} placeholder="Thanksgiving" autoComplete="off" />
              </label>
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
              reopening ? { decision: 'reopen' } : { decision: 'cancel', confirm: true, ...(chargedCents > 0 ? { chargedCents } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) },
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
