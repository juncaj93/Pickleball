import type { AdminSessionView } from '../../../shared/api';
import { type CourtSwitch as CourtSwitchValue, courtStatus, courtSwitchOf } from '../../../shared/court';
import { COURTRESERVE_BOOKING_URL } from '../../../shared/settings';
import { cancelByIso, cardTime, formatMonthDay, formatShortDate, formatTime, localParts, weekFade } from '../../../shared/time';
import { useRef, useState } from 'react';
import { api, ApiError, useNow } from '../../lib';
import { BANNER_TIMING, CourtReserveLink, PlayersLine, useToast } from '../../ui';
import { type Hold, startHold, trackHeld } from '../../undoHold';
import { actingStamp } from '../../InstantTaps';
import { ADMIN_UNDO_MS } from '../../../shared/zip13';
import { MAX_PLAYERS_LIMIT } from '../../../shared/spots';
import { RollText, useJustChanged, useLiveChanged } from '../../motion';
import { tsClass, tsKind, tsTime, useCourtFlip, type TsKind } from '../../timeShift';
import { DateTile } from '../PlayerHome';
import { adminTileDay } from '../../zip7';
import type { AdminCtx } from '../Admin';
import { courtLine, ShortPanel, TimeCheck, useAction } from './Sessions';
import { CourtSwitch } from './CourtSwitch';
import { GameMenu } from './GameMenu';
import { lateDropsAll } from './todo';
import '../../admin-r2.css';
import { ShortGameTilePill } from './ShortGame';

/**
 * One organizer game card, "Admin screens, round 2" (ADMIN_R2). Same data, same taps and same rules as the card it replaces;
 * only the layout moved: tile and time on the left, the court switch with the seats and names under it, the gear on the right,
 * and one fixed footer of three equal cells: [In | Out] [$ paid count] [cancel-by time, or Book when a court is needed].
 * A holiday note hangs under the card as a faint tab. Nothing here changes a seat, a payment or a price.
 */
export function SessionCardR2({ ctx, s, courtNeed }: { ctx: AdminCtx; s: AdminSessionView; courtNeed?: boolean }) {
  const tz = ctx.d.group.timezone;
  const now = useNow();
  const live = !s.state.flags.canceled && !s.state.flags.started;
  const court = courtStatus(
    { ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past, bookingOpen: s.state.flags.bookingWindowOpen },
    tz,
  );
  if (s.state.flags.canceled && s.cancelReason && s.courtState !== 'not_opened') court.text = `Canceled - ${s.cancelReason}`;
  const later = court.kind === 'later';
  // The court switch answers the tap at once (see CardSwitchR2); this holds what was just tapped until the server's answer is drawn.
  const [picked, setPicked] = useState<CourtSwitchValue | null>(null);
  const switchValue = picked ?? courtSwitchOf(s);
  // The organizer's own seat answers the tap at once too (see InOut): what was just tapped, until the server's answer is drawn.
  const [seat, setSeat] = useState<boolean | null>(null);
  const meId = ctx.d.me?.id ?? null;
  const mineRow = meId ? s.roster.find((r) => r.playerId === meId && (r.status === 'confirmed' || r.status === 'waitlisted')) : undefined;
  let confirmedNames = s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
  let waitNames = s.roster.filter((r) => r.status === 'waitlisted').map((r) => r.name);
  if (seat !== null && meId && ctx.d.me) {
    if (seat && !mineRow) {
      // Joining: the last spot after everyone, or the waitlist when the game is full.
      // "Card cleanup" (Zip 10): no cap and no waitlist, so the organizer is always drawn in.
      if (ctx.d.cardCleanup !== true && confirmedNames.length >= ctx.d.group.settings.maxPlayers) waitNames = [...waitNames, ctx.d.me.name];
      // At the database's 12 the server says no: nothing is drawn ahead of that answer.
      else if (ctx.d.cardCleanup !== true || confirmedNames.length < MAX_PLAYERS_LIMIT) confirmedNames = [...confirmedNames, ctx.d.me.name];
    } else if (!seat && mineRow) {
      confirmedNames = s.roster.filter((r) => r.status === 'confirmed' && r.playerId !== meId).map((r) => r.name);
      waitNames = s.roster.filter((r) => r.status === 'waitlisted' && r.playerId !== meId).map((r) => r.name);
    }
  }
  const canceled = s.state.flags.canceled;
  const showSwitch = !canceled && !s.state.flags.past && !s.state.flags.started;
  const start = cardTime(s.startsAt, s.endsAt, tz).start;
  const inCount = s.payableCount;
  const ts: TsKind | null = tsKind(court.kind, false);
  const flip = useCourtFlip(`admin-${s.id}`, ts);
  const whoKey = s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted').map((r) => `${r.playerId}:${r.status}`).join(',');
  const whoChanged = useLiveChanged(whoKey);
  const paidFlash = useLiveChanged(s.paidCount);
  const blink = whoChanged || paidFlash;
  const timeFade = useJustChanged(start, 300);
  const needsBook = !!courtNeed && !canceled;
  return (
    <div className="r2-wrap">
      <article
        id={`session-${s.id}`}
        tabIndex={-1}
        className={`card scard scard-r2 court-${court.kind}${blink ? ' m-blink' : ''}`}
        data-court={court.kind}
        data-switch={switchValue}
        data-fade={weekFade(s.startsAt, now, tz) || undefined}
        data-remind={s.state.flags.bookingPromptDue || undefined}
        data-r2-card
        aria-labelledby={`as-${s.id}`}
      >
        <div className="r2-top">
          <div className="scard-tilecol">
            <DateTile iso={s.startsAt} tz={tz} ts={tsClass(ts, flip)} day={adminTileDay(ctx.d, s)} />
            <div className={`scard-time${tsClass(ts, flip)}${timeFade ? ' m-time-fade' : ''}`} data-card-time data-ts={ts ?? undefined} aria-hidden="true">
              {tsTime(start, ts)}
            </div>
            <ShortGameTilePill ctx={ctx} s={s} />
          </div>
          <div className="r2-mid">
            <h2 id={`as-${s.id}`} className="sr-only">
              {formatShortDate(s.startsAt, tz)}, {formatTime(s.startsAt, tz)}
            </h2>
            {showSwitch ? <CardSwitchR2 ctx={ctx} s={s} value={switchValue} onPicked={setPicked} /> : <div className="court-line top-line">{courtLine(court)}</div>}
            {showSwitch && later && <div className="court-sub small muted">{court.text}</div>}
            {s.hiddenFromPlayers && canceled && ctx.d.adminV2 === true && (
              <div className="small muted hidden-tag" data-hidden-tag>
                Not shown to players
              </div>
            )}
            {(s.extra || s.note) && (
              <div className="game-note">
                {s.extra && <span className="extra-tag">Extra game</span>}
                {s.note}
              </div>
            )}
            {lateDropsAll(s).length > 0 && (
              <div className="late-line">
                <span className="late-tag">Late drop</span> {lateDropsAll(s).map((r) => `${r.name} ${formatTime(r.lateDropAt!, tz)}`).join(', ')}
              </div>
            )}
            {!canceled && (
              <PlayersLine
                names={confirmedNames}
                waitlist={waitNames}
                waitLabel="Waitlist"
                everyone={ctx.d.players.map((p) => p.name)}
                maxPlayers={ctx.d.group.settings.maxPlayers}
                cleanup={ctx.d.cardCleanup === true}
              />
            )}
            {s.timeCheck && ctx.d.timeShift !== false && <TimeCheck ctx={ctx} s={s} />}
          </div>
          <div className="r2-gear">
            <GameMenu ctx={ctx} s={s} canCalendar={court.kind === 'booked' && live} />
          </div>
        </div>
        {!canceled && (
          <div className="r2-foot" data-r2-foot>
            <div className="r2-cell r2-inout">{live && <InOut ctx={ctx} s={s} seat={seat} onSeat={setSeat} />}</div>
            <div className="r2-cell r2-paidcell">
              <button
                type="button"
                className={`r2-paid${paidFlash ? ' m-flash' : ''}`}
                data-paid-cell
                data-all-paid={inCount > 0 && s.paidCount === inCount ? 'yes' : undefined}
                aria-label={`${s.paidCount} of ${inCount} paid. Open the players list.`}
                onClick={() => ctx.open('roster', s.id)}
              >
                <span className="r2-dol" aria-hidden="true">
                  $
                </span>
                <span className="r2-paid-text">
                  <RollText text={`${s.paidCount} of ${inCount}`} />
                </span>
              </button>
            </div>
            <div className="r2-cell r2-endcell">
              {needsBook ? (
                <span className="r2-book" data-court-need>
                  <span className="sr-only">Court still needs to be booked. </span>
                  <CourtReserveLink href={COURTRESERVE_BOOKING_URL} small>
                    Book
                  </CourtReserveLink>
                </span>
              ) : (
                live && <CancelBy startsAt={s.startsAt} now={now} tz={tz} />
              )}
            </div>
          </div>
        )}
        {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}
      </article>
      {s.holiday && <HolidayTab ctx={ctx} s={s} />}
    </div>
  );
}

/**
 * The organizer's own seat: two plain words, In | Out. The one that is true is filled, the moment it is tapped: the seat count, the
 * dots and the names on the card follow at once. The save goes out in the background and the toast shows when the server answers
 * (not after the whole screen reloads). If the server refuses or cannot be reached, everything snaps back and says so. Quick taps
 * are sent in order and the last one wins. Nothing is disabled while it saves. Same request and same rules as the old I'm in.
 */
function InOut({ ctx, s, seat, onSeat }: { ctx: AdminCtx; s: AdminSessionView; seat: boolean | null; onSeat: (v: boolean | null) => void }) {
  const toast = useToast();
  const me = ctx.d.me;
  const mine = me ? s.roster.find((r) => r.playerId === me.id && (r.status === 'confirmed' || r.status === 'waitlisted')) : undefined;
  const day = formatShortDate(s.startsAt, ctx.d.group.timezone);
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const isIn = seat ?? !!mine;
  const send = (goingIn: boolean) => {
    const me_ = ++latest.current;
    onSeat(goingIn);
    chain.current = chain.current.then(async () => {
      let said = goingIn ? "You're in" : "You're out";
      try {
        const res = await api<{ result: string; position?: number }>('POST', `/api/admin/sessions/${s.id}/me`, { in: goingIn });
        if (goingIn && (res.result === 'waitlisted' || res.result === 'standby')) said = `You're #${res.position} on the waitlist`;
        if (me_ === latest.current) toast(said);
      } catch (err) {
        toast(err instanceof ApiError ? `${err.message} It went back.` : 'That did not save, so it went back. Check your connection and try again.', 'error');
        if (me_ === latest.current) {
          // Show what the server really has (an earlier quick tap may have saved), then let go of the tap.
          await ctx.reload().catch(() => {});
          if (me_ === latest.current) onSeat(null);
        }
        return;
      }
      if (me_ !== latest.current) return;
      try {
        await ctx.reload();
      } catch {
        /* the next refresh brings it */
      }
      if (me_ === latest.current) onSeat(null);
    });
  };
  return (
    <div className="r2-seg" role="group" aria-label={`You, ${day}`} data-inout={isIn ? 'in' : 'out'}>
      <button type="button" className="r2-seg-in" aria-pressed={isIn} aria-label={`I'm in for ${day}${mine?.status === 'waitlisted' && seat === null ? ' (you are on the waitlist)' : ''}`} onClick={() => !isIn && send(true)}>
        In
      </button>
      <button type="button" className="r2-seg-out" aria-pressed={!isIn} aria-label={`Out of ${day}`} onClick={() => isIn && send(false)}>
        Out
      </button>
    </div>
  );
}

/**
 * A clock and the time to cancel the court by ("8 AM", "Wed 7 AM", "Nov 25 7 AM"). Red inside the last 24 hours, quiet gray
 * before that. Nothing once the time has passed.
 */
export function cancelByFoot(startsAtIso: string, nowMs: number, tz: string): { text: string; soon: boolean } | null {
  const atIso = cancelByIso(startsAtIso);
  const at = Date.parse(atIso);
  if (nowMs >= at) return null;
  const clock = formatTime(atIso, tz).replace(/[  ]/g, ' ').replace(':00', '');
  const day = (ms: number) => {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const ahead = Math.round((day(at) - day(nowMs)) / 86_400_000);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(at));
  const text = ahead <= 0 ? clock : ahead < 7 ? `${weekday} ${clock}` : `${formatMonthDay(atIso, tz)} ${clock}`;
  return { text, soon: at - nowMs <= 24 * 3_600_000 };
}

function CancelBy({ startsAt, now, tz }: { startsAt: string; now: number; tz: string }) {
  const c = cancelByFoot(startsAt, now, tz);
  if (!c) return null;
  return (
    <span className={`r2-cancel${c.soon ? ' soon' : ''}`} data-cancel-by>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="sr-only">Cancel the court by </span>
      {c.text}
    </span>
  );
}

/**
 * The holiday note: a faint tab under the card at the bottom right, "Election Day · hours confirmed? [Yes]". Once confirmed it
 * becomes plain faint text, "Election Day ✓", with no tab. Undo lives in the game's gear menu.
 */
function HolidayTab({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  if (!s.holiday) return null;
  if (s.holidayHoursOk) {
    return (
      <div className="r2-holiday-done" data-holiday="confirmed">
        {s.holiday} <span aria-hidden="true">✓</span>
        <span className="sr-only">, venue hours confirmed</span>
      </div>
    );
  }
  return (
    <div className="r2-holiday-row">
      <div className="r2-holiday-tab" data-holiday="ask">
        <span>{s.holiday} · hours confirmed?</span>
        <button type="button" className="r2-yes" disabled={busy} aria-label={`Venue is open normal hours for ${s.holiday}`} onClick={() => run(() => api('POST', `/api/admin/sessions/${s.id}/holiday-hours`, { ok: true }), 'Venue hours confirmed')}>
          Yes
        </button>
      </div>
    </div>
  );
}

/**
 * The court switch on a card, instant: the tapped segment is filled the moment it is tapped (and the card's own marks follow), the save
 * goes out in the background, and the confirmation toast shows as soon as the server answers (not after the whole screen reloads).
 * If the server refuses or cannot be reached, the switch snaps back and says so. Quick second taps are sent in order, the last one wins.
 * Nothing is disabled while it saves. Same request, same rules as the old switch: only the waiting got shorter.
 */
function CardSwitchR2({ ctx, s, value, onPicked }: { ctx: AdminCtx; s: AdminSessionView; value: CourtSwitchValue; onPicked: (v: CourtSwitchValue | null) => void }) {
  const toast = useToast();
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Undo on admin toasts (ADMIN_UNDO, Zip 13): the switch moves at once, the save waits 5 seconds (src/undoHold.ts). A newer tap on this
  // switch lets the older one save first, so the server always ends on the last tap. Off: exactly as before.
  const held = useRef<Hold | null>(null);
  const undoOn = ctx.d.adminUndo === true;
  return (
    <CourtSwitch
      value={value}
      label={`Court status for ${formatShortDate(s.startsAt, ctx.d.group.timezone)}`}
      onPick={(to) => {
        const mine = ++latest.current;
        onPicked(to);
        const said = to === 'booked' ? 'Court booked' : to === 'waitlist' ? 'On the waitlist' : 'Court not booked';
        let hold: Hold | null = null;
        if (undoOn) {
          held.current?.release();
          const h = startHold();
          hold = held.current = h;
          toast(said, 'ok', {
            keep: true,
            stayMs: ADMIN_UNDO_MS - BANNER_TIMING.fadeIn,
            action: {
              label: 'Undo',
              onClick: () => {
                if (!h.undo()) return void toast('Already saved. Change it back by hand.', 'ok');
                if (mine === latest.current) onPicked(null);
                toast('Undone. Nothing was saved.', 'ok', { keep: true });
                // An older tap on this switch may have saved meanwhile: show what the server has now.
                void ctx.reload().catch(() => {});
              },
            },
          });
        }
        const as = hold ? actingStamp() : '';
        chain.current = chain.current.then(async () => {
          if (hold && !(await hold.decided)) return;
          try {
            // Held: sent only as whoever the screen acted as when it was tapped (never into View as or Pretend's demo copy).
            if (hold && actingStamp() !== as) throw new ApiError(409, 'screen_changed', 'Nothing was sent: the screen changed before it could save.');
            await api('POST', `/api/admin/sessions/${s.id}/court-status`, { status: to });
            if (mine === latest.current && !hold) toast(said);
          } catch (err) {
            // Only the newest tap decides what the switch shows: a failure of an older one is reported but does not move it.
            toast(err instanceof ApiError ? `${err.message} The switch went back.` : "That did not save, so the switch went back. Check your connection and try again.", 'error');
            if (mine === latest.current) {
              // Show what the server really has (an earlier quick tap may have saved), then let go of the tap.
              await ctx.reload().catch(() => {});
              if (mine === latest.current) onPicked(null);
            }
            return;
          }
          if (mine !== latest.current) return;
          try {
            await ctx.reload();
          } catch {
            /* the next refresh brings it */
          }
          if (mine === latest.current) onPicked(null);
        });
        if (hold) trackHeld(chain.current);
      }}
    />
  );
}
