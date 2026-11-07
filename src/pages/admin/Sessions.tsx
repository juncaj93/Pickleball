import { MAX_PLAYERS_LIMIT } from '../../../shared/spots';
import { useEffect, useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  canceledMessage,
  movedMessage,
  deadlineAlertMessage,
  siteAddress,
  smsHref,
} from '../../../shared/messages';
import { isIOS } from '../../lib';
import { CHARGE_ASK_HOURS, reopenRequestedReason } from '../../../shared/credit';
import { formatPrice, parseDollars } from '../../../shared/money';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../../../shared/settings';
import { DateTile, HolidayPill } from '../PlayerHome';
import { adminTileDay } from '../../zip7';
import { ClearChoices, EditableDraft, lateFeeLine, PlayersText } from './LateFees';
import { lateCancelText } from './textMenu';
import { feeSplitPrice } from '../../../shared/lateFees';
import { cancelByCardLine, cancelByIso, cancelByShort, cardTime, formatTime, formatShortDate, weekFade } from '../../../shared/time';
import { api, ApiError, useNow } from '../../lib';
import { BANNER_TIMING } from '../../ui';
import { flushHold, startHold, undoHold, UNDO_MS } from '../../hold';
import { AlertCard } from '../../AlertCard';
import { Chip, ConfirmDialog, CourtIcon, CourtReserveLink, Notice, PlayersLine, Sheet, SmsDraft, useToast } from '../../ui';
import { type CourtKind, type CourtSwitch as CourtSwitchValue, courtStatus, courtSwitchOf } from '../../../shared/court';
import { type AdminCtx } from '../Admin';
import { CourtSwitch } from './CourtSwitch';
import { EditGameForm } from './EditGame';
import { SessionCardR2 } from './CardR2';
import { GameMenu } from './GameMenu';
import { reach, reminderText } from './textMenu';
import { markTask } from './DoNow';
import { isPlayed, lateDropsAll } from './todo';
import '../../credit-session.css';
import '../../admin-cards.css';
import { stillInText, tsClass, tsKind, tsTime, useCourtFlip, type TsKind } from '../../timeShift';
import { canceledCreditTextR2, movedTextR2, stillInTextR2 } from '../../../shared/textsR2';
import { RollText, useJustChanged, useLiveChanged } from '../../motion';

export type SheetKind = 'edit' | 'roster' | 'payments' | 'cancel' | 'canceled' | 'moved' | 'moved_set' | 'players_text';

export { useAction } from './action';
import { opTap, useAction } from './action';
import { viewFlat, viewPrice } from '../../../shared/gameLength';
import { ShortGameTilePill } from './ShortGame';

/**
 * One organizer game card. `courtNeed` (new layout, or round 2): this game is the one "Court still needs to be booked" is
 * about, so its card says it and carries the Book button. With "Admin screens, round 2" on, the card is drawn by CardR2.tsx.
 */
export function SessionCard({ ctx, s, courtNeed }: { ctx: AdminCtx; s: AdminSessionView; courtNeed?: boolean }) {
  if (ctx.d.adminR2 === true) return <SessionCardR2 ctx={ctx} s={s} courtNeed={courtNeed} />;
  return <SessionCardClassic ctx={ctx} s={s} courtNeed={courtNeed} />;
}

function SessionCardClassic({ ctx, s, courtNeed }: { ctx: AdminCtx; s: AdminSessionView; courtNeed?: boolean }) {
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
  const switchValue = courtSwitchOf(s);
  // The switch shows until the game is over. Canceled, started and played games show the gray reason line instead.
  const showSwitch = !s.state.flags.canceled && !s.state.flags.past && !s.state.flags.started;
  const start = cardTime(s.startsAt, s.endsAt, tz).start;
  const cancelBy = live ? cancelByCardLine(s.startsAt, now, tz) : null;
  const inCount = s.payableCount;
  // "Time may shift": the court on the tile's border and the time under it (TIME_SHIFT).
  const ts: TsKind | null = tsKind(court.kind, false);
  const flip = useCourtFlip(`admin-${s.id}`, ts);
  // Motion, live changes only: someone joined or dropped (the card blinks a light green), someone paid (the pill flashes).
  const whoKey = s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted').map((r) => `${r.playerId}:${r.status}`).join(',');
  const whoChanged = useLiveChanged(whoKey);
  const paidFlash = useLiveChanged(s.paidCount);
  const blink = whoChanged || paidFlash;
  // The time under the date tile fades quickly when it changes (an Edit game save).
  const timeFade = useJustChanged(start, 300);
  return (
    <article id={`session-${s.id}`} tabIndex={-1} className={`card scard court-${court.kind}${blink ? ' m-blink' : ''}`} data-court={court.kind} data-switch={switchValue} data-fade={weekFade(s.startsAt, now, tz) || undefined} data-remind={s.state.flags.bookingPromptDue || undefined} aria-labelledby={`as-${s.id}`}>
      <div className="scard-main">
        <div className="scard-tilecol">
          <DateTile iso={s.startsAt} tz={tz} ts={tsClass(ts, flip)} day={adminTileDay(ctx.d, s)} />
          <div className={`scard-time${tsClass(ts, flip)}${timeFade ? ' m-time-fade' : ''}`} data-card-time data-ts={ts ?? undefined} aria-hidden="true">
            {tsTime(start, ts)}
          </div>
          <ShortGameTilePill ctx={ctx} s={s} />
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
          {s.hiddenFromPlayers && s.state.flags.canceled && ctx.d.adminV2 === true && (
            <div className="small muted hidden-tag" data-hidden-tag>
              Not shown to players
            </div>
          )}
          {courtNeed && !s.state.flags.canceled && (
            <div className="court-need" data-court-need>
              Court still needs to be booked
            </div>
          )}
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
              waitLabel="Waitlist"
              everyone={ctx.d.players.map((p) => p.name)}
              maxPlayers={ctx.d.group.settings.maxPlayers}
              cleanup={ctx.d.cardCleanup === true}
              after={live ? <OrganizerInOut ctx={ctx} s={s} /> : undefined}
            />
          )}
          {s.timeCheck && ctx.d.timeShift !== false && <TimeCheck ctx={ctx} s={s} />}
          {(inCount > 0 || cancelBy) && !s.state.flags.canceled && (
            <div className="card-meta">
              {inCount > 0 && (
                <button
                  type="button"
                  className={`paid-pill${paidFlash ? ' m-flash' : ''}`}
                  data-all-paid={s.paidCount === inCount ? 'yes' : undefined}
                  aria-label={`${s.paidCount} of ${inCount} paid. Open the players list.`}
                  onClick={() => ctx.open('roster', s.id)}
                >
                  <span>
                    <RollText text={`${s.paidCount} of ${inCount} paid`} />
                  </span>
                </button>
              )}
              {cancelBy && <span className="cancel-by-soon">{cancelBy}</span>}
            </div>
          )}
        </div>
      </div>
      {courtNeed && !s.state.flags.canceled && (
        <div className="court-need-btn">
          {/* The same link, words and look as the "Book a court" pill above the games. */}
          <CourtReserveLink href={COURTRESERVE_BOOKING_URL} small>
            Book a court
          </CourtReserveLink>
        </div>
      )}
      {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}
    </article>
  );
}

/**
 * "Confirmed 2 of 3" on a game whose start time changed after players were in, and "Waiting on Dan" with a
 * small Text button per person: it opens Messages with the text filled in (the organizer presses send). Nothing is sent by the site.
 */
export function TimeCheck({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const c = s.timeCheck!;
  // TEXTS_R2: "Pickleball tomorrow is confirmed @ 7:30pm!" with line breaks. Off: the words as they were.
  const body = ctx.d.textsR2 === true ? stillInTextR2(s.startsAt, tz, Date.parse(ctx.d.now), siteAddress(ctx.d.group.playerLink)) : stillInText(s.startsAt, tz, siteAddress(ctx.d.group.playerLink));
  const one = c.waiting.length === 1 ? c.waiting[0] : null;
  // Zip 11, Alert cards: a purple (texting) card inside the game card: "Confirmed 2 of 3", "Waiting on Dan", Text Dan (one Text per person).
  if (ctx.d.alertCards === true) {
    return (
      <AlertCard
        as="div"
        tone="purple"
        icon="clock"
        className="ts-check-ac"
        data={{ 'data-time-check': true }}
        title={`Confirmed ${c.confirmedCount} of ${c.inCount}`}
        sub={c.waiting.length > 0 ? `Waiting on ${c.waiting.map((w) => w.name).join(', ')}` : undefined}
        action={
          one ? (
            <a className="ac-btn" href={smsHref(one.phone, body, isIOS)} aria-label={`Text ${one.name}: ${body}`}>
              Text {one.name}
            </a>
          ) : undefined
        }
        actions={
          c.waiting.length > 1 ? (
            <>
              {c.waiting.map((w) => (
                <a key={w.playerId} className="ac-btn ts-pill" href={smsHref(w.phone, body, isIOS)} aria-label={`Text ${w.name}: ${body}`}>
                  Text {w.name}
                </a>
              ))}
            </>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="ts-check" data-time-check>
      <span className="ts-count">
        Confirmed {c.confirmedCount} of {c.inCount}
      </span>
      {one && (
        <div className="ts-waiting">
          <span className="ts-name">Waiting on {one.name}</span>
          <a className="btn small secondary" href={smsHref(one.phone, body, isIOS)} aria-label={`Text ${one.name}: ${body}`}>
            Text
          </a>
        </div>
      )}
      {/* Several waiting: one compact row, a small Text button per person (it names them). */}
      {c.waiting.length > 1 && (
        <div className="ts-waiting-many">
          <span className="ts-name">Waiting on</span>
          {c.waiting.map((w) => (
            <a key={w.playerId} className="btn small secondary ts-pill" href={smsHref(w.phone, body, isIOS)} aria-label={`Text ${w.name}: ${body}`}>
              Text {w.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** The gray reason line for a game that is canceled, played or already started. */
export function courtLine(court: { kind: string; text: string }) {
  return (
    <div className="court-status">
      <CourtIcon kind={court.kind as CourtKind} />
      <span>{court.text}</span>
    </div>
  );
}

/** The card's one-tap switch. Shows the tap at once, saves it, and puts it back if the save fails. */
export function CardSwitch({ ctx, s, value }: { ctx: AdminCtx; s: AdminSessionView; value: CourtSwitchValue }) {
  const { busy, run, pending } = useAction(ctx);
  const [picked, setPicked] = useState<CourtSwitchValue | null>(null);
  const shown = picked ?? value;
  return (
    <CourtSwitch
      value={shown}
      // Instant taps: the switch shows the tap at once and waits (pending) while it saves, as it always did with `busy`.
      disabled={busy || pending('court')}
      label={`Court status for ${formatShortDate(s.startsAt, ctx.d.group.timezone)}`}
      onPick={async (to) => {
        setPicked(to);
        // (Undo on admin toasts lives on the round 2 switch, CardR2.tsx, the one live uses; this older one is unchanged.)
        await run(() => api('POST', `/api/admin/sessions/${s.id}/court-status`, { status: to }), to === 'booked' ? 'Court booked' : to === 'waitlist' ? 'On the waitlist' : 'Court not booked', { key: 'court' });
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
/** The organizer's own seat on one game: are they in, and the one tap that flips it (same rules as everyone). */
export function useOrganizerInOut(ctx: AdminCtx, s: AdminSessionView) {
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
  return { busy, mine, day, set };
}

/**
 * The organizer playing: a small gray "I'm in" at the right end of the
 * players row (never a second green button), which turns into "✓ You're in"
 * with a small "Out". Real sign-ups under their name from Settings, with the
 * same rules as everyone.
 */
function OrganizerInOut({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, mine, day, set } = useOrganizerInOut(ctx, s);
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
  // Zip 11, Alert cards: the same words and the same four buttons as one card under the game: red before the cancel-by time
  // (a deadline), gray once it passed.
  if (ctx.d.alertCards === true) {
    return (
      <AlertCard
        as="div"
        tone={passed ? 'gray' : 'red'}
        className="short-ac"
        data={{ 'data-short-panel': true }}
        title={`${s.confirmedCount} going, ${s.state.flags.playersNeeded} more needed`}
        sub={passed ? (booked ? 'The cancellation deadline passed, so canceling the court may not be free.' : 'The cancellation deadline passed.') : `Reschedule or cancel by ${cancelByShort(s.startsAt, tz)}.`}
        subTone={passed ? undefined : 'red'}
        actions={
          <>
            <button className="ac-btn ac-out" disabled={busy} onClick={() => ctx.open('edit', s.id)}>
              Edit game
            </button>
            <button className="ac-btn ac-out" data-ac-tone="red" disabled={busy} onClick={() => ctx.open('cancel', s.id)}>
              Cancel session
            </button>
            {booked && (
              <a className="ac-btn" data-ac-tone="blue" href={COURTRESERVE_CANCEL_URL} target="_blank" rel="noopener noreferrer">
                Cancel court
                <span className="sr-only"> (opens CourtReserve)</span>
              </a>
            )}
            <button
              className="ac-btn ac-out"
              data-ac-tone="gray"
              disabled={busy}
              onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'keep' }), 'Keeping it as is')}
            >
              Keep as is
            </button>
          </>
        }
      >
        {!passed && ctx.d.textsR2 !== true && (
          <details className="ac-extra">
            <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
              Text this alert to yourself
            </summary>
            <SmsDraft to="You" phone={null} body={deadlineAlertMessage(s, tz, cancelByIso(s.startsAt))} />
          </details>
        )}
      </AlertCard>
    );
  }
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
      {/* TEXTS_R2: "Text this alert to yourself" is gone (almost never used). */}
      {!passed && ctx.d.textsR2 !== true && (
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
    players_text: `Text the players · ${title}`,
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
      {s && kind === 'players_text' && <PlayersText ctx={ctx} s={s} />}
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
  const r2 = ctx.d.textsR2 === true;
  // TEXTS_R2: the reason typed on the cancel sheet starts in this box, so it reaches the text.
  const [reason, setReason] = useState(r2 && canceled ? (s.cancelReason ?? '') : '');
  const link = siteAddress(ctx.d.group.playerLink);
  // Late fees on and canceled inside 12 hours: the text follows the venue answer (shared/messages.ts). Off: as before.
  const late = canceled ? lateCancelText(ctx.d, s, reason) : null;
  const nowMs = Date.parse(ctx.d.now);
  const body = canceled
    ? r2
      ? canceledCreditTextR2(s, tz, nowMs, link, reason)
      : canceledMessage(s, tz, nowMs, link, reason)
    : r2
      ? movedTextR2(s, s.plannedStartsAt ?? s.startsAt, tz, nowMs, link, reason)
      : movedMessage(s, s.plannedStartsAt ?? s.startsAt, tz, nowMs, link, reason);
  if (late) {
    return (
      <div className="stack" data-late-cancel={late.feeKept ? 'fee_kept' : 'waived'}>
        <EditableDraft to={`${late.to} · ${late.reach.count}`} who={late.reach} initial={late.body} name={late.feeKept ? 'canceled_fee_kept' : 'canceled_today'} openLabel="Text the players who were in" onOpen={() => void markTask(s.id, 'canceled_text').then(ctx.reload, () => {})} />
        {!late.feeKept && <CreditBackList s={s} />}
        <h3 className="section-title">Text the players</h3>
        <PlayersText ctx={ctx} s={s} />
      </div>
    );
  }
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
          {ctx.d.adminR2 === true ? 'Book' : 'Book a court'}
        </CourtReserveLink>
      )}
    </fieldset>
  );
}

/** After a cancel: who got their payment back as credit (automatic; nothing to tap). */
export function CreditBackList({ s }: { s: AdminSessionView }) {
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
    // Says what happens to their money, at once (nothing is sent until Undo runs out).
    const back = r.dropCreditCents + r.dropCashCents;
    const said =
      r.dropClaimCents > 0
        ? `${r.name} removed. Their ${formatPrice(r.dropClaimCents)} I paid waits for your Paid or Didn't pay.`
        : back > 0
          ? `${r.name} removed. ${formatPrice(back)} ${r.dropCashCents > 0 ? 'back as credit' : 'credit returned'}.`
          : `${r.name} removed.`;
    toast(said, 'ok', { stayMs: UNDO_MS - BANNER_TIMING.fadeIn, action: { label: 'Undo', onClick: () => { if (!undoHold(key)) toast(`Too late, ${r.name} was already removed.`, 'error'); } } });
  }
  // Leaving this game's screen sends a held Remove at once, so Players and Money never show the money before it moved.
  useEffect(() => () => flushHold(), []);
  const live = !s.state.flags.canceled && !s.state.flags.started;
  const act = (playerId: string, action: string, msg: string) =>
    // Undo on admin toasts (ADMIN_UNDO): adding someone (Give spot) waits 5 seconds too; Remove already has its own Undo above.
    run(() => api('POST', `/api/admin/sessions/${s.id}/roster`, { playerId, action }), msg, { key: `roster:${playerId}`, ...(ctx.d.adminUndo === true ? { undo: true } : {}) });
  const inRoster = new Set(s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted').map((r) => r.playerId));
  const others = ctx.d.players.filter((p) => p.isActive && !p.adminHidden && !inRoster.has(p.id));
  // "Card cleanup" (Zip 10): no Max players cap and no waitlist; only the database's 12 stops a Give spot.
  const cleanup = ctx.d.cardCleanup === true;
  const full = s.confirmedCount >= (cleanup ? MAX_PLAYERS_LIMIT : ctx.d.group.settings.maxPlayers);

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
                {r.status === 'confirmed' && !cleanup && (
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
                    {!cleanup && (
                      <button className="btn small ghost" disabled={busy} onClick={() => act(p.id, 'waitlist', `${p.name} added to waitlist`)}>
                        Waitlist
                      </button>
                    )}
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

/** One row's money line: what they paid, what came back as credit, or what they owe. Shared by both Money layouts. */
export function payMoneyLine(r: AdminRosterEntry, s: AdminSessionView, tz: string): string {
  const played = isPlayed(s);
  const fin = s.finalized;
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
}

/** The status chip on a player's money row: Paid, Paid with credit, Unpaid, Credit $3, Nothing owed. Shared by both Money layouts. */
export function payChip(r: AdminRosterEntry, s: AdminSessionView): { tone: 'ok' | 'info' | 'warn' | 'muted'; label: string } {
  const played = isPlayed(s);
  if (r.paymentStatus === 'paid') {
    return {
      tone: played || r.refundedAt ? 'ok' : 'info',
      label: r.refundedAt ? 'Credit' : r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0) ? 'Paid with credit' : 'Paid',
    };
  }
  if (r.creditCents > 0 && r.status === 'confirmed') return { tone: r.owesCents > 0 ? 'warn' : 'muted', label: `Credit ${formatPrice(r.creditCents)}` };
  return r.owesCents > 0 ? { tone: 'warn', label: 'Unpaid' } : { tone: 'muted', label: 'Nothing owed' };
}

export function PaymentsManager({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const { busy, run } = useAction(ctx);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  // The organizer is not a row of their own money: they pay the venue (the court row below).
  // Late fees (shared/lateFees.ts) get their own short list below (Mark paid / Unmark and Clear).
  const rows = s.roster.filter((r) => !r.isOrganizer && !r.lateFee && (r.status === 'confirmed' || r.paymentStatus === 'paid'));
  const feeRows = s.roster.filter((r) => r.lateFee);
  const setPaid = (r: AdminRosterEntry, paid: boolean) =>
    // With the amount this screen showed as owed (refused if a Finalize or redo changed it since).
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid, seen: r.moneySeen, ...(paid && r.owesCents > 0 ? { cents: r.owesCents } : {}) }), paid ? `${r.name} marked paid` : `${r.name} marked unpaid`, opTap({ kind: paid ? 'paid' : 'unpaid', sessionId: s.id, playerId: r.playerId }, paid ? 'Mark paid' : 'Unmark', ctx.d.adminUndo === true));
  const price = viewFlat(s, ctx.d.group.settings.pricePerPlayerCents);
  const played = isPlayed(s);
  const fin = s.finalized;
  const myId = s.roster.find((r) => r.isOrganizer)?.playerId ?? ctx.d.me?.id ?? null;
  const setCourtPaid = (paid: boolean) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: myId, paid }), paid ? 'Court marked paid' : 'Court marked due', { key: `court:${s.id}` });
  const reopen = () => run(() => api('POST', `/api/admin/sessions/${s.id}/reopen`, {}), 'Reopened. Finalize it again from Home.', opTap({ kind: 'reopen', sessionId: s.id }, 'Reopen', ctx.d.adminUndo === true));

  const moneyLine = (r: AdminRosterEntry) => payMoneyLine(r, s, tz);

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
          {s.canceledBy === 'organizer_fee_kept' ? (
            <Notice tone="warn" title="Canceled late">
              {s.feeSplit
                ? `The venue did not waive the fee: ${s.feeSplit.count} were in, so everyone who was in owes ${formatPrice(s.feeSplit.priceCents)}.`
                : `The venue did not waive the fee: everyone who was in owes their ${formatPrice(price)}.`}
            </Notice>
          ) : (
            <Notice tone="muted" title="Session canceled">
              Nobody owes for it. Anyone who paid has it as credit.
              {s.chargedCents ? ` The venue charged you ${formatPrice(s.chargedCents)}.` : ''}
            </Notice>
          )}
          <CreditBackList s={s} />
        </>
      )}
      {feeRows.length > 0 && (
        <ul className="list who-paid" aria-label="Late fees" data-late-fees>
          {feeRows.map((r) => (
            <li key={r.playerId} className="pay-row" data-pay-row={r.name} data-late-fee={r.lateFee!.kind}>
              <div className="pc-top">
                <strong className="pc-name">{r.name}</strong>
                <Chip tone={r.lateFee!.paid ? 'ok' : 'warn'}>{r.lateFee!.paid ? 'Paid' : 'Unpaid'}</Chip>
              </div>
              <div className="pc-sub">
                <span className="small muted">{lateFeeLine(r)}</span>
              </div>
              <div className="pay-btns">
                {r.isOrganizer ? null : r.lateFee!.paid ? (
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
                  r.owesCents > 0 && (
                    <button className="btn small secondary" disabled={busy} onClick={() => setPaid(r, true)}>
                      Mark paid
                    </button>
                  )
                )}
                <ClearChoices ctx={ctx} s={s} r={r} />
              </div>
            </li>
          ))}
        </ul>
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
                <Chip tone={payChip(r, s).tone}>{payChip(r, s).label}</Chip>
              </div>
              <div className="pay-btns">
                {r.paymentStatus === 'paid' && !r.refundedAt ? (
                  <>
                    {/* Confirm an I paid while they are in; one on a seat that left is a claim, answered on Home. */}
                    {r.selfPaid && r.status === 'confirmed' && !s.state.flags.canceled && (
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
                          onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: false, seen: r.moneySeen }), `${r.name}'s credit put back`, opTap({ kind: 'creditUndo', sessionId: s.id, playerId: r.playerId }, 'Unmark credit', ctx.d.adminUndo === true))}
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
  // The Money page rework (MONEY_REWORK): the sheet always asks "Were you charged?", starting on No more than 12 hours out and on Yes inside
  // the 12 hours (the venue almost never gives grace). The answer can be flipped either way before Cancel.
  const rw = ctx.d.moneyRework === true && !reopening;
  const inside = serverNow >= start - CHARGE_ASK_HOURS * 3600_000 && serverNow < start;
  const [charged, setCharged] = useState(rw && inside);
  const [amount, setAmount] = useState(() => (((s.courtCostCents ?? s.shortGame?.courtCents ?? ctx.d.group.settings.typicalCourtCostCents) || 0) / 100).toFixed(2));
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Late fees on (shared/lateFees.ts rule 5): the question is "Did the venue waive the fee?", with no default.
  const askWaived = askCharge && ctx.d.lateFees === true;
  // "Late-cancel fee split" (LATE_FEE_SPLIT): with 5 or more in, No prices every seat like a played game (shared/lateFees.ts).
  const flat = viewFlat(s, ctx.d.group.settings.pricePerPlayerCents);
  const splitCents = askWaived && ctx.d.lateFeeSplit === true ? feeSplitPrice(s.shortGame ? viewPrice(s, ctx.d.group.settings) : flat, s.confirmedCount) : null;
  // TEXTS_R2: it starts on No (the venue gives almost no grace, so a late cancel normally keeps the fee). Yes still works exactly as before.
  const [waived, setWaived] = useState<boolean | null>(rw || ctx.d.textsR2 === true ? false : null);
  const [waivedError, setWaivedError] = useState(false);
  // COLOR_CLEANUP: shorter blurbs on this sheet. The long "fee is kept" line becomes one short sentence (the amounts are the same).
  const cleanup = ctx.d.colorCleanup === true;
  const keptLine = (lead: string) => (splitCents !== null ? `${lead}: the fee is kept. Everyone signed up owes ${formatPrice(splitCents)}.` : `${lead}: the fee is kept. Everyone signed up owes ${formatPrice(flat)}.`);
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
              {/* COLOR_CLEANUP: the sheet is shorter, this line goes (the Cancel button says it all). */}
              {!cleanup && <p>Players will see it as canceled, and reminders and payments stop for it.</p>}
              {/* After the start there is no court to cancel any more (and "Cancel by" is in the past). */}
              {!s.state.flags.started && (
                <Notice tone="warn" title="This does not cancel your court">
                  Cancel the reservation with the venue yourself.
                  {` Cancel by ${cancelByShort(s.startsAt, tz)}.`}
                </Notice>
              )}
              {s.bookingStatus === 'booked' && (
                <CourtReserveLink href={COURTRESERVE_CANCEL_URL} small>
                  Cancel court on CourtReserve
                </CourtReserveLink>
              )}
              <label className="field">
                Reason (optional)
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={40} placeholder="Thanksgiving" autoComplete="off" />
              </label>
              {askWaived && !rw && (
                <fieldset className="charge-ask" data-venue-waived>
                  <legend>Did the venue waive the fee or give you credit toward the next booking?</legend>
                  <div className="segmented" role="group" aria-label="Did the venue waive the fee or give you credit toward the next booking?">
                    <button
                      type="button"
                      aria-pressed={waived === true}
                      onClick={() => {
                        setWaived(true);
                        setWaivedError(false);
                      }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      aria-pressed={waived === false}
                      onClick={() => {
                        setWaived(false);
                        setWaivedError(false);
                      }}
                    >
                      No
                    </button>
                  </div>
                  <p className="small muted">
                    {splitCents !== null
                      ? waived === false
                        ? `No: the fee is kept. ${s.confirmedCount} are in, so everyone signed up owes ${formatPrice(splitCents)} (anything paid above that comes back as credit). Late drops still owe ${formatPrice(flat)}.`
                        : waived === true
                          ? 'Yes: everyone gets their money back as credit, nobody owes.'
                          : `Yes: everyone gets money back as credit, nobody owes. No: the fee is kept, everyone signed up owes ${formatPrice(splitCents)}.`
                      : waived === false
                        ? `No: the fee is kept, and everyone signed up still owes their ${formatPrice(flat)} (late drops too).`
                        : waived === true
                          ? 'Yes: everyone gets their money back as credit, nobody owes.'
                          : `Yes: everyone gets money back as credit, nobody owes. No: the fee is kept, everyone signed up still owes ${formatPrice(flat)}.`}
                  </p>
                  {waivedError && <span className="field-error">Pick Yes or No.</span>}
                </fieldset>
              )}
              {rw && askWaived && (
                <fieldset className="charge-ask" data-venue-waived data-were-you-charged>
                  <legend>Were you charged?</legend>
                  <div className="segmented" role="group" aria-label="Were you charged?">
                    <button type="button" aria-pressed={waived === true} data-charged="no" onClick={() => setWaived(true)}>
                      No
                    </button>
                    <button type="button" aria-pressed={waived === false} data-charged="yes" onClick={() => setWaived(false)}>
                      Yes
                    </button>
                  </div>
                  <p className="small muted">
                    {waived === false
                      ? splitCents !== null
                        ? cleanup
                          ? keptLine('Yes')
                          : `Yes: the fee is kept. ${s.confirmedCount} are in, so everyone signed up owes ${formatPrice(splitCents)} (anything paid above that comes back as credit). Late drops still owe ${formatPrice(flat)}.`
                        : cleanup
                          ? keptLine('Yes')
                          : `Yes: the fee is kept, and everyone signed up still owes their ${formatPrice(flat)} (late drops too).`
                      : 'No: everyone gets their money back as credit, nobody owes.'}
                  </p>
                </fieldset>
              )}
              {rw && !askWaived && (
                <fieldset className="charge-ask" data-were-you-charged>
                  <legend>Were you charged?</legend>
                  <div className="segmented" role="group" aria-label="Were you charged?">
                    <button type="button" aria-pressed={!charged} data-charged="no" onClick={() => setCharged(false)}>
                      No
                    </button>
                    <button type="button" aria-pressed={charged} data-charged="yes" onClick={() => setCharged(true)}>
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
              {askCharge && !askWaived && !rw && (
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
        if (askWaived && waived === null) return setWaivedError(true);
        let chargedCents = 0;
        if ((askCharge || rw) && !askWaived && charged) {
          const cents = parseDollars(amount);
          if (cents === null) return setAmountError('Enter an amount like 48 or 48.50.');
          chargedCents = cents;
        }
        // Undo on admin toasts (ADMIN_UNDO): the game shows canceled at once and the cancel waits 5 seconds (dropped on Undo: nothing moves,
        // no credit, no alert). The text for the group comes once it has really saved. Reopen is unchanged.
        const undo = ctx.d.adminUndo === true && !reopening;
        const why = reason.trim() || null;
        const ok = await run(
          () =>
            api(
              'POST',
              `/api/admin/sessions/${s.id}/decision`,
              reopening
                ? { decision: 'reopen' }
                : { decision: 'cancel', confirm: true, ...(chargedCents > 0 ? { chargedCents } : {}), ...(askWaived ? { venueWaived: waived } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) },
            ),
          reopening ? 'Session reopened' : 'Session canceled',
          undo
            ? {
                key: `cancel:${s.id}`,
                undo: true,
                patch: (d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, status: 'canceled', cancelReason: why, state: { ...x.state, flags: { ...x.state.flags, canceled: true } } } : x)) }),
                onSaved: () => ctx.open('canceled', s.id),
              }
            : undefined,
        );
        // After a cancel, go straight to the text for the group and who to pay back.
        if (ok) (reopening || undo ? onClose() : ctx.open('canceled', s.id));
      }}
      onCancel={onClose}
    />
  );
}
