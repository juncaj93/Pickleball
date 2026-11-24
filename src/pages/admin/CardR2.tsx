import type { AdminSessionView } from '../../../shared/api';
import { dateKeyOf } from '../../../shared/bookingHours';
import { holidayCovered } from '../../../shared/venueHours';
import { type CourtSwitch as CourtSwitchValue, courtStatus, courtSwitchOf } from '../../../shared/court';
import { rosterLine } from '../../../shared/guestSpot';
import { COURTRESERVE_BOOKING_URL } from '../../../shared/settings';
import { cancelByIso, cardTime, formatMonthDay, formatShortDate, formatTime, localParts, ordinal, weekFade } from '../../../shared/time';
import { useRef, useState } from 'react';
import { api, ApiError, isIOS, useNow } from '../../lib';
import { siteAddress, smsHref } from '../../../shared/messages';
import { stillInTextR2 } from '../../../shared/textsR2';
import { BANNER_TIMING, CourtReserveLink, PlayersLine, Sheet, useToast } from '../../ui';
import { COURT_MAX, COURT_MIN } from '../../../shared/gameDay';
import { type Hold, startHold, trackHeld } from '../../undoHold';
import { actingStamp } from '../../InstantTaps';
import { ADMIN_UNDO_MS } from '../../../shared/zip13';
import { MAX_PLAYERS_LIMIT } from '../../../shared/spots';
import { gameMinutes, lengthWords } from '../../../shared/gameLength';
import { COURT_NAME, directionsUrl } from '../../../shared/zip9';
import { DirectionsArrowIcon } from '../../CardButtons';
import { RollText, useJustChanged, useLiveChanged } from '../../motion';
import { stillInText, tsClass, tsKind, tsTime, useCourtFlip, type TsKind } from '../../timeShift';
import { DateTile } from '../PlayerHome';
import { adminTileDay } from '../../zip7';
import type { AdminCtx } from '../Admin';
import { courtLine, ShortPanel, useAction } from './Sessions';
import { GameMenu } from './GameMenu';
import { isPlayed, lateDropsAll } from './todo';
import '../../admin-r2.css';
import '../../admin-card86.css';
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
  // Zip 42 "Guest spot": each guest right after its host (rosterLine gives the plain names when there is no guest).
  const inLine = rosterLine(s.roster, 'confirmed');
  const waitLine = rosterLine(s.roster, 'waitlisted');
  let confirmedNames = inLine.names;
  let waitNames = waitLine.names;
  let guestAt = inLine.guestAt;
  let waitGuestAt = waitLine.guestAt;
  if (seat !== null && meId && ctx.d.me) {
    if (seat && !mineRow) {
      // Joining: the last spot after everyone, or the waitlist when the game is full.
      // "Card cleanup" (Zip 10): no cap and no waitlist, so the organizer is always drawn in.
      if (ctx.d.cardCleanup !== true && confirmedNames.length >= ctx.d.group.settings.maxPlayers) {
        waitNames = [...waitNames, ctx.d.me.name];
        if (waitGuestAt) waitGuestAt = [...waitGuestAt, false];
      }
      // At the database's 12 the server says no: nothing is drawn ahead of that answer.
      else if (ctx.d.cardCleanup !== true || confirmedNames.length < MAX_PLAYERS_LIMIT) {
        confirmedNames = [...confirmedNames, ctx.d.me.name];
        if (guestAt) guestAt = [...guestAt, false];
      }
    } else if (!seat && mineRow) {
      const a = rosterLine(s.roster, 'confirmed', meId);
      const b = rosterLine(s.roster, 'waitlisted', meId);
      confirmedNames = a.names;
      waitNames = b.names;
      guestAt = a.guestAt;
      waitGuestAt = b.guestAt;
    }
  }
  const canceled = s.state.flags.canceled;
  const showSwitch = !canceled && !s.state.flags.past && !s.state.flags.started;
  const start = cardTime(s.startsAt, s.endsAt, tz).start;
  const inCount = s.payableCount;
  const ts: TsKind | null = tsKind(court.kind);
  const flip = useCourtFlip(`admin-${s.id}`, ts);
  const whoKey = s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted').map((r) => `${r.playerId}:${r.status}`).join(',');
  const whoChanged = useLiveChanged(whoKey);
  const paidFlash = useLiveChanged(s.paidCount);
  const blink = whoChanged || paidFlash;
  const timeFade = useJustChanged(start, 300);
  const needsBook = !!courtNeed && !canceled;
  const length = lengthWords(gameMinutes(s.startsAt, s.endsAt));
  // Zip 29: the Court | arrow button is for today's game and the coming ones; a game on an earlier day keeps what it showed (the cancel-by clock / nothing).
  const dayNum = (ms: number) => {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const todayOrComing = dayNum(Date.parse(s.startsAt)) >= dayNum(now);
  // Zip 29: everyone who is in has paid (a green check), or somebody still owes (amber $). Nobody in yet: the plain green $ as before.
  const paidState = inCount > 0 ? (s.paidCount >= inCount ? 'all' : 'owed') : 'none';
  // Zip 86: the green stripe on the left only when the organizer is In (the tap shows at once).
  const meIn = seat !== null ? seat : mineRow?.status === 'confirmed';
  // Zip 86: the court-cancel deadline, one small gray line under the names, only on the day it falls (and before it passes).
  const cancelBy = live ? cancelByFoot(s.startsAt, now, tz) : null;
  const cancelToday = !!cancelBy && dayNum(Date.parse(cancelByIso(s.startsAt))) === dayNum(now);
  return (
    <div className="r2-wrap">
      <article
        id={`session-${s.id}`}
        tabIndex={-1}
        className={`card scard scard-r2 scard86 court-${court.kind}${blink ? ' m-blink' : ''}`}
        data-court={court.kind}
        data-switch={switchValue}
        data-me-in={meIn ? 'yes' : undefined}
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
            {/* Zip 29: the game's own length ("2 hours", "1.5 hours") in small gray under the time. */}
            {length && (
              <div className="scard-length" data-card-length aria-hidden="true">
                {length}
              </div>
            )}
            <ShortGameTilePill ctx={ctx} s={s} />
          </div>
          <div className="r2-mid">
            <h2 id={`as-${s.id}`} className="sr-only">
              {formatShortDate(s.startsAt, tz)}, {formatTime(s.startsAt, tz)}
            </h2>
            {/* Zip 86 (picture 10): the court status as ONE button (a tap flips Booked / Not booked, with Undo) and the organizer's In / Out beside it. */}
            {showSwitch ? (
              <div className="r86-actions" data-r86-actions>
                <StatusButton ctx={ctx} s={s} value={switchValue} onPicked={setPicked} />
                {live && <InOut ctx={ctx} s={s} seat={seat} onSeat={setSeat} />}
              </div>
            ) : (
              <div className="court-line top-line">{courtLine(court)}</div>
            )}
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
                {...(guestAt ? { guestAt } : {})}
                {...(waitGuestAt ? { waitGuestAt } : {})}
                waitLabel="Waitlist"
                everyone={ctx.d.players.map((p) => p.name)}
                maxPlayers={ctx.d.group.settings.maxPlayers}
                cleanup={ctx.d.cardCleanup === true}
              />
            )}
            {cancelToday && (
              <p className="r86-cancel-by" data-cancel-by>
                Cancel the court by {cancelBy!.text}
              </p>
            )}
            {s.timeCheck && ctx.d.timeShift !== false && <ConfirmLine ctx={ctx} s={s} />}
          </div>
          <div className="r2-gear">
            {/* Zip 32 (bug fix): a played (finalized) game has no gear: its menu (Players, Cancel session) was clipped by the sheet, and Reopen is the way to change it. */}
            {!isPlayed(s) && <GameMenu ctx={ctx} s={s} canCalendar={court.kind === 'booked' && live} />}
          </div>
        </div>
        {!canceled && (
          <div className="r86-foot" data-r2-foot>
            <button
              type="button"
              className={`r86-paid${paidFlash ? ' m-flash' : ''}`}
              data-paid-cell
              data-paid-state={paidState}
              data-all-paid={inCount > 0 && s.paidCount === inCount ? 'yes' : undefined}
              aria-label={`${s.paidCount} of ${inCount} paid. Open the players list.`}
              onClick={() => ctx.open('roster', s.id)}
            >
              <span className="r86-paid-mark" aria-hidden="true">
                {paidState === 'all' ? (
                  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m3.6 8.4 2.8 2.8 6-6.4" />
                  </svg>
                ) : (
                  '$'
                )}
              </span>
              <span className="r86-paid-text">
                <RollText text={`${s.paidCount} of ${inCount} paid`} />
              </span>
            </button>
            {needsBook ? (
              <span className="r2-book r86-book" data-court-need>
                <span className="sr-only">Court still needs to be booked. </span>
                <CourtReserveLink href={COURTRESERVE_BOOKING_URL} small>
                  Book
                </CourtReserveLink>
              </span>
            ) : (
              todayOrComing && (ctx.d.gameDayCard === true || s.courtNum !== undefined) && <CourtButton ctx={ctx} s={s} dayLabel={formatShortDate(s.startsAt, tz)} />
            )}
            {todayOrComing && <DirectionsButton dayLabel={formatShortDate(s.startsAt, tz)} />}
          </div>
        )}
        {s.state.flags.shortOnPlayers && <ShortPanel ctx={ctx} s={s} />}
      </article>
      {s.holiday && <HolidayTab ctx={ctx} s={s} />}
    </div>
  );
}

/**
 * Zip 86: the Time check, short: one amber line ("2 of 4 confirmed") only while someone still has to confirm, with today's Text buttons for
 * who is still waiting (the same text and links as the box it replaces). Everyone confirmed: nothing.
 */
function ConfirmLine({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const c = s.timeCheck!;
  if (c.confirmedCount >= c.inCount) return null;
  const tz = ctx.d.group.timezone;
  const body = ctx.d.textsR2 === true ? stillInTextR2(s.startsAt, tz, Date.parse(ctx.d.now), siteAddress(ctx.d.group.playerLink)) : stillInText(s.startsAt, tz, siteAddress(ctx.d.group.playerLink));
  return (
    <div className="r86-confirm" data-time-check>
      <span className="r86-confirm-words">
        {c.confirmedCount} of {c.inCount} confirmed
      </span>
      {c.waiting.map((w) => (
        <a key={w.playerId} className="r86-text" href={smsHref(w.phone, body, isIOS)} aria-label={`Text ${w.name}: ${body}`}>
          Text {w.name}
        </a>
      ))}
    </div>
  );
}

/**
 * Zip 86 (round 2, Alex): the court button. "Court 4", or a gray "Court ?" until a court is set; a tap opens the quick court picker right away
 * (the venue's courts 1 to 16 as big buttons, and Clear). One tap saves it (the same PUT .../court-number as Edit game) and the button shows it
 * at once; with Undo on the toast has Undo and the save waits 5 seconds (a second pick inside that time replaces the first, nothing sent for
 * it). Only while "Game day card" is on (the server takes court numbers only then).
 */
function CourtButton({ ctx, s, dayLabel }: { ctx: AdminCtx; s: AdminSessionView; dayLabel: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // What was just picked (undefined: show the server's court).
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const held = useRef<Hold | null>(null);
  // Review fix: saves sent and not yet read back (until then `saved` may be stale, so a pick is never skipped as "already saved").
  const inflight = useRef(0);
  const undoOn = ctx.d.adminUndo === true;
  const saved = s.courtNum ?? null;
  const shown = picked !== undefined ? picked : saved;
  const pick = (court: number | null) => {
    setOpen(false);
    // An earlier pick is still on its way (held or saving): this one always goes too, so the last pick wins.
    let pending = picked !== undefined;
    const mine = ++latest.current;
    setPicked(court);
    const said = court === null ? 'Court cleared' : `Court ${court} saved`;
    let hold: Hold | null = null;
    if (undoOn) {
      const dropped = held.current?.undo() === true;
      held.current = null;
      if (dropped && court === saved && inflight.current === 0) {
        setPicked(undefined);
        toast('Undone. Nothing was saved.', 'ok', { keep: true });
        return;
      }
      if (dropped && inflight.current === 0) pending = false;
    }
    if (court === saved && !pending && inflight.current === 0) {
      setPicked(undefined);
      return;
    }
    if (undoOn) {
      const h = startHold();
      hold = held.current = h;
      toast(said, 'ok', {
        keep: true,
        stayMs: ADMIN_UNDO_MS - BANNER_TIMING.fadeIn,
        action: {
          label: 'Undo',
          onClick: () => {
            if (!h.undo()) return void toast('Already saved. Change it back by hand.', 'ok');
            if (mine === latest.current) setPicked(undefined);
            toast('Undone. Nothing was saved.', 'ok', { keep: true });
            void ctx.reload().catch(() => {});
          },
        },
      });
    }
    const as = hold ? actingStamp() : '';
    chain.current = chain.current.then(async () => {
      if (hold && !(await hold.decided)) return;
      try {
        if (hold && actingStamp() !== as) throw new ApiError(409, 'screen_changed', 'Nothing was sent: the screen changed before it could save.');
        inflight.current++;
        try {
          await api('PUT', `/api/admin/sessions/${s.id}/court-number`, { court });
        } finally {
          inflight.current--;
        }
        if (mine === latest.current && !hold) toast(said);
      } catch (err) {
        toast(err instanceof ApiError ? `${err.message} It went back.` : 'That did not save, so it went back. Check your connection and try again.', 'error');
        if (mine === latest.current) {
          await ctx.reload().catch(() => {});
          if (mine === latest.current) setPicked(undefined);
        }
        return;
      }
      // Read back after every save (not only the newest), so `saved` is never stale when the next pick is judged.
      inflight.current++;
      try {
        await ctx.reload();
      } catch {
        /* the next refresh brings it */
      } finally {
        inflight.current--;
      }
      if (mine === latest.current) setPicked(undefined);
    });
    if (hold) trackHeld(chain.current);
  };
  return (
    <>
      <button
        type="button"
        className={shown === null ? 'r86-court r86-court-none' : 'r86-court'}
        aria-haspopup="dialog"
        aria-label={shown === null ? `No court set for ${dayLabel}. Pick the court.` : `Court ${shown} for ${dayLabel}. Change the court.`}
        onClick={() => setOpen(true)}
        data-court-num={shown ?? 'none'}
        {...(shown !== null ? { 'data-court-joined': true } : {})}
      >
        {shown === null ? 'Court ?' : `Court ${shown}`}
      </button>
      <Sheet calmFocus open={open} title={`Court for ${dayLabel}`} onClose={() => setOpen(false)} className="r86-picker-sheet">
        {(
          <div className="r86-picker" data-court-picker>
            <div className="r86-picker-grid" role="group" aria-label="Courts">
              {Array.from({ length: COURT_MAX - COURT_MIN + 1 }, (_, i) => COURT_MIN + i).map((n) => (
                <button key={n} type="button" className="r86-pick" aria-pressed={shown === n} onClick={() => pick(n)} data-court-pick={n}>
                  {n}
                </button>
              ))}
            </div>
            <button type="button" className="btn block secondary r86-pick-clear" disabled={shown === null} onClick={() => pick(null)} data-court-pick-clear>
              Clear
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** Zip 86: directions as its own button (the same address and link as the player card's Directions button). */
function DirectionsButton({ dayLabel }: { dayLabel: string }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return (
    <a className="r86-dir" href={directionsUrl(COURT_NAME, ua)} target="_blank" rel="noopener noreferrer" data-court-directions aria-label={`Directions to the courts for ${dayLabel}`}>
      <DirectionsArrowIcon />
    </a>
  );
}

/**
 * The organizer's own seat. Zip 86 (picture 10): ONE button, soft green "✓ In" or gray "Out"; a tap flips it. It answers the tap at once: the
 * seat count, the dots and the names on the card follow. With Undo on (ADMIN_UNDO) the toast has Undo and the save waits 5 seconds, like the
 * court status; off, the save goes out at once and the toast shows when the server answers. If the server refuses or cannot be reached,
 * everything snaps back and says so. Quick taps are sent in order and the last one wins. Same request and same rules as before.
 */
function InOut({ ctx, s, seat, onSeat }: { ctx: AdminCtx; s: AdminSessionView; seat: boolean | null; onSeat: (v: boolean | null) => void }) {
  const toast = useToast();
  const me = ctx.d.me;
  const mine = me ? s.roster.find((r) => r.playerId === me.id && (r.status === 'confirmed' || r.status === 'waitlisted')) : undefined;
  const day = formatShortDate(s.startsAt, ctx.d.group.timezone);
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const held = useRef<Hold | null>(null);
  const undoOn = ctx.d.adminUndo === true;
  const isIn = seat ?? !!mine;
  const waiting = mine?.status === 'waitlisted' && seat === null;
  const send = (goingIn: boolean) => {
    const me_ = ++latest.current;
    onSeat(goingIn);
    let said = goingIn ? 'You’re in' : 'You’re out';
    let hold: Hold | null = null;
    if (undoOn) {
      // Review fix: a second tap while the first is still held drops the first (nothing saved; never Out then In again, which would free the
      // seat and put the organizer on the waitlist). Back where the server is: nothing to send at all.
      const dropped = held.current?.undo() === true;
      held.current = null;
      if (dropped && goingIn === !!mine) {
        onSeat(null);
        toast('Undone. Nothing was saved.', 'ok', { keep: true });
        return;
      }
      const h = startHold();
      hold = held.current = h;
      toast(said, 'ok', {
        keep: true,
        stayMs: ADMIN_UNDO_MS - BANNER_TIMING.fadeIn,
        action: {
          label: 'Undo',
          onClick: () => {
            if (!h.undo()) return void toast('Already saved. Change it back by hand.', 'ok');
            if (me_ === latest.current) onSeat(null);
            toast('Undone. Nothing was saved.', 'ok', { keep: true });
            void ctx.reload().catch(() => {});
          },
        },
      });
    }
    const as = hold ? actingStamp() : '';
    chain.current = chain.current.then(async () => {
      if (hold && !(await hold.decided)) return;
      try {
        if (hold && actingStamp() !== as) throw new ApiError(409, 'screen_changed', 'Nothing was sent: the screen changed before it could save.');
        const res = await api<{ result: string; position?: number }>('POST', `/api/admin/sessions/${s.id}/me`, { in: goingIn });
        const wait = goingIn && (res.result === 'waitlisted' || res.result === 'standby');
        if (wait) said = `You’re ${ordinal(res.position ?? 1)} on the waitlist`;
        if (me_ === latest.current && (!hold || wait)) toast(said);
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
    if (hold) trackHeld(chain.current);
  };
  return (
    <button
      type="button"
      className={isIn ? 'r86-inout r86-in' : 'r86-inout'}
      aria-pressed={isIn}
      aria-label={isIn ? `You’re in for ${day}${waiting ? ' (on the waitlist)' : ''}. Tap to go out.` : `You’re out of ${day}. Tap to go in.`}
      onClick={() => send(!isIn)}
      data-inout={isIn ? 'in' : 'out'}
    >
      {isIn && (
        <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3.4 8.4 2.9 2.9 6.3-6.6" />
        </svg>
      )}
      {isIn ? (waiting ? 'Waitlist' : 'In') : 'Out'}
    </button>
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

/**
 * The holiday note: a faint tab under the card at the bottom right, "Election Day · hours confirmed? [Yes]". Once confirmed it
 * becomes plain faint text, "Election Day ✓", with no tab. Undo lives in the game's gear menu.
 */
function HolidayTab({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const { busy, run } = useAction(ctx);
  if (!s.holiday) return null;
  // Zip 81: a one-day special hours entry on this date already says the venue's hours: no question.
  if (ctx.d.bookingHours === true && holidayCovered(ctx.d.group.venueHours, dateKeyOf(Date.parse(s.startsAt), ctx.d.group.timezone))) return null;
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

/** Zip 86: the court status on the one button: a tap flips it (Alex: no Waitlist). */
const NEXT_STATUS: Record<CourtSwitchValue, CourtSwitchValue> = { not_booked: 'booked', booked: 'not_booked' };
const STATUS_WORDS: Record<CourtSwitchValue, string> = { not_booked: 'Not booked', booked: 'Booked' };

/**
 * Zip 86 (picture 10): the court status as ONE button: solid green "Booked" with a small ball-yellow dot, or amber "Not booked" (Alex, round 2:
 * no Waitlist). A tap flips it and answers at once: the button and the card's marks follow, the save goes out in the background (with Undo on:
 * the toast has Undo and the save waits 5 seconds; a second tap inside that time drops the first, so nothing is sent). If the server refuses or
 * cannot be reached, it snaps back and says so. The same court-status call as the old switch.
 */
function StatusButton({ ctx, s, value, onPicked }: { ctx: AdminCtx; s: AdminSessionView; value: CourtSwitchValue; onPicked: (v: CourtSwitchValue | null) => void }) {
  const toast = useToast();
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Undo on admin toasts (ADMIN_UNDO, Zip 13): the button moves at once, the save waits 5 seconds (src/undoHold.ts). A newer tap lets the older
  // one save first, so the server always ends on the last tap. Off: saved at once.
  const held = useRef<Hold | null>(null);
  const undoOn = ctx.d.adminUndo === true;
  const pick = (to: CourtSwitchValue) => {
    const mine = ++latest.current;
    onPicked(to);
    const said = to === 'booked' ? 'Court booked' : 'Court not booked';
    let hold: Hold | null = null;
    if (undoOn) {
      // Review fix: the next tap while the last is still held drops it, so only the status the organizer stops on is saved (Not booked to
      // Booked never saves the Waitlist step in between, which the server would log as "court opened"). Back to the saved status: nothing sent.
      const dropped = held.current?.undo() === true;
      held.current = null;
      if (dropped && to === courtSwitchOf(s)) {
        onPicked(null);
        toast('Undone. Nothing was saved.', 'ok', { keep: true });
        return;
      }
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
            // An older tap may have saved meanwhile: show what the server has now.
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
        // Only the newest tap decides what the button shows: a failure of an older one is reported but does not move it.
        toast(err instanceof ApiError ? `${err.message} It went back.` : 'That did not save, so it went back. Check your connection and try again.', 'error');
        if (mine === latest.current) {
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
  };
  const day = formatShortDate(s.startsAt, ctx.d.group.timezone);
  return (
    <button
      type="button"
      className={`r86-status r86-${value}`}
      aria-label={`Court status for ${day}: ${STATUS_WORDS[value]}. Tap for ${STATUS_WORDS[NEXT_STATUS[value]]}.`}
      onClick={() => pick(NEXT_STATUS[value])}
      data-status={value}
    >
      <span className="r86-status-dot" aria-hidden="true" />
      {STATUS_WORDS[value]}
    </button>
  );
}
