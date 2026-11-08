// History > Activity: each log entry as one plain sentence, like
// "Ryan said I'm in for Tue, Nov 3" or "Robin marked Ryan paid for Tue, Nov 3".
import type { ActivityEntry } from './api';
import { formatPrice } from './money';
import { formatShortDate } from './time';

/**
 * Was this done by someone other than the organizer? A player's own tap (their name), or anything else that is not the
 * organizer ("organizer" and "organizer as Ryan" are both the organizer's own hands). Admin screens round 2 highlights these.
 */
export function doneByOthers(e: Pick<ActivityEntry, 'actorLabel'> & { details?: Record<string, unknown> }): boolean {
  if (e.details?.organizer === true) return false; // the organizer's own I'm in / Out is logged under their real name
  return !/^organizer( as .+)?$/.test(e.actorLabel);
}

/**
 * The sentence for one entry. `organizer` is the organizer's name (from Settings), or "Organizer".
 * `opts.names` (Money page rework): finds a player's name from their id when the entry itself did not keep one, so a line says who
 * it was about instead of "someone"; it also words the few actions that used to read as a bare action name.
 */
export function activityText(e: ActivityEntry, tz: string, organizer: string, opts: { names?: (playerId: string) => string | null } = {}): string {
  const d = e.details;
  const known = opts.names && typeof d.playerId === 'string' ? opts.names(d.playerId) : null;
  const player = typeof d.player === 'string' ? d.player : typeof d.name === 'string' ? d.name : (known ?? 'someone');
  const day = e.sessionStartsAt ? formatShortDate(e.sessionStartsAt, tz) : null;
  const forDay = day ? ` for ${day}` : '';
  const ofDay = day ? ` of ${day}` : '';
  const late = d.late === true ? ' (late drop)' : '';
  const via = d.via === 'link' ? ' from a texted link' : '';

  // What a player did, in their own words.
  const playerDid = (who: string): string | null => {
    switch (e.action.replace(/^(player|as_player)_/, '')) {
      case 'join':
        if (d.result === 'waitlisted') return `${who} joined the waitlist${forDay}`;
        if (d.result === 'standby') return `${who} joined standby${forDay}`;
        return `${who} said I'm in${forDay}`;
      case 'withdraw':
        return `${who} dropped out${ofDay}${late}${via}`;
      case 'check_in':
        return `${who} confirmed they're coming${forDay}${via}`;
      case 'decline':
        return `${who} said no${forDay}`;
      case 'claim':
        return `${who} took the open spot${forDay}${via}`;
      default:
        return null;
    }
  };
  const act = /^(as_)?player_(join|withdraw|check_in|decline|claim)$/.exec(e.action);
  if (act) return playerDid(act[1] ? `${organizer} (as ${player})` : player) as string;

  const who = organizer;
  const changes = d as Record<string, { to?: unknown } | undefined>;
  switch (e.action) {
    case 'player_self_paid':
    case 'player_self_unpaid': {
      const by = e.actorLabel.startsWith('organizer as') ? `${organizer} (as ${player})` : player;
      return e.action === 'player_self_paid' ? `${by} marked their payment paid${forDay}` : `${by} unmarked their payment${forDay}`;
    }
    case 'player_self_added':
      return `${player} added their own name`;
    case 'marked_paid':
      return d.confirmed ? `${who} confirmed ${player}'s payment${forDay}` : `${who} marked ${player} paid${forDay}`;
    case 'marked_unpaid':
      return d.previousAmountCents === undefined && typeof d.creditReturnedCents === 'number'
        ? `${who} took ${player}'s ${formatPrice(d.creditReturnedCents)} credit off the game${forDay}`
        : `${who} marked ${player} unpaid${forDay}`;
    case 'court_paid':
      return `${who} marked the court paid${forDay}`;
    case 'court_unpaid':
      return `${who} marked the court as not paid yet${forDay}`;
    case 'refund_marked':
      return `${who} paid ${player} back${forDay}`;
    case 'refund_cleared':
      return `${who} undid paying ${player} back${forDay}`;
    case 'court_booked':
      return `${who} booked${day ? ` ${day}` : ' a court'}`;
    case 'court_opened':
      return `${who} marked the court opened${forDay}`;
    case 'court_waitlist':
      return `${who} went on the court waitlist${forDay}`;
    case 'court_not_opened':
      return `${who} marked the court didn't open${forDay}`;
    case 'booking_updated':
      if (changes.booking_status?.to === 'booked') return `${who} booked${day ? ` ${day}` : ' a court'}`;
      return `${who} edited a booking${forDay}`;
    case 'session_added':
      return `${who} added a game${forDay}`;
    case 'session_canceled':
      return `${who} canceled${day ? ` ${day}` : ' a session'}${d.feeKept === true ? (splitOf(d) ? ` (venue did not waive the fee: ${splitOf(d)!.count} were in, everyone in owes ${formatPrice(splitOf(d)!.priceCents)})` : ' (venue did not waive the fee: everyone in still owes)') : d.venueWaived === true ? ' (venue waived the fee)' : typeof d.chargedCents === 'number' && d.chargedCents > 0 ? ` (venue charged ${formatPrice(d.chargedCents)})` : ''}`;
    case 'session_reopened':
      return `${who} reopened${day ? ` ${day}` : ' a session'}`;
    case 'session_rescheduled':
      return `${who} moved a session${typeof d.from === 'string' ? ` from ${formatShortDate(d.from, tz)}` : ''}${typeof d.to === 'string' ? ` to ${formatShortDate(d.to, tz)}` : ''}`;
    case 'session_shown_early':
      return `${who} showed${day ? ` ${day}` : ' a session'} before the first session date`;
    case 'session_hidden_again':
      return `${who} hid${day ? ` ${day}` : ' a session'} again`;
    case 'holiday_hours_confirmed':
      return `${who} confirmed venue hours${forDay}`;
    case 'holiday_hours_unconfirmed':
      return `${who} undid venue hours${forDay}`;
    case 'decision_keep':
      return `${who} kept${day ? ` ${day}` : ' a session'} as is`;
    case 'decision_try_fill':
      return `${who} chose to fill${day ? ` ${day}` : ' a session'}`;
    case 'session_finalized':
      return `${who} finalized${day ? ` ${day}` : ' a game'}${typeof d.played === 'number' ? `: ${d.played} played` : ''}${typeof d.priceCents === 'number' ? `, ${formatPrice(d.priceCents)} each` : ''}`;
    case 'finalize_reopened':
      return `${who} reopened the finalize${forDay}`;
    case 'credit_back':
      return `${player} got ${typeof d.amountCents === 'number' ? formatPrice(d.amountCents) : 'money'} back as credit${forDay}${d.reason === 'dropped' ? ' (dropped out)' : d.reason === 'canceled' ? (d.split === true ? ' (canceled late, fee split)' : ' (canceled)') : d.reason === 'not_played' ? ' (did not play)' : ''}`;
    case 'refund_requested':
      return `${player} asked for ${typeof d.amountCents === 'number' ? formatPrice(d.amountCents) : 'a'} refund of their credit`;
    case 'refund_request_canceled':
      return `${player} took back their refund request`;
    case 'refund_request_declined':
      return `${who} put off ${player}'s refund request`;
    case 'late_drop_done':
      return opts.names && player !== 'someone' ? `${who} handled ${player}'s late drop${forDay}` : `${who} handled a late drop${forDay}`;
    case 'roster_confirm':
      return `${who} gave ${player} a spot${forDay}`;
    case 'roster_waitlist':
      return `${who} moved ${player} to the waitlist${forDay}`;
    case 'roster_withdraw':
      return `${who} took ${player} out${ofDay}`;
    case 'roster_confirm_attendance':
      return `${who} marked ${player} as coming${forDay}`;
    case 'credit_cleared':
      return `${who} cleared ${player}'s credit`;
    case 'credit_kept':
      return `${who} kept ${player}'s payment as credit${forDay}`;
    case 'credit_kept_undone':
      return `${who} undid keeping ${player}'s payment as credit${forDay}`;
    case 'credit_used':
      return `${typeof d.amountCents === 'number' ? `${player} used ${formatPrice(d.amountCents)} credit${forDay}` : `${player} used credit${forDay}`}${d.auto === true ? ' (automatic at sign-up)' : ''}`;
    case 'cash_out_used':
      return `${player} put ${typeof d.fromRequestCents === 'number' ? formatPrice(d.fromRequestCents) : 'part'} of their cash out request toward the game${forDay}`;
    case 'credit_undone':
      return `${player} took back the credit they used${forDay}`;
    case 'credit_refund_marked':
      return `${who} paid ${player}'s credit back`;
    case 'credit_refund_undone':
      return `${who} undid paying ${player}'s credit back`;
    case 'player_added':
      return `${who} added ${player}`;
    case 'player_updated':
      return `${who} edited ${player}`;
    case 'player_hidden':
      return `${who} hid ${player} from the name list`;
    case 'player_deleted':
      return `${who} removed ${player}`;
    case 'settings_updated':
      return `${who} changed settings`;
    case 'pin_changed':
      return `${who} changed the PIN`;
    case 'player_link_rotated':
      return `${who} replaced the player link`;
    case 'session_note_changed':
      return `${who} changed the label${forDay}${typeof d.to === 'string' ? ` to "${d.to}"` : ' (cleared it)'}`;
    case 'session_hidden_from_players':
      return `${who} removed${day ? ` ${day}` : ' a canceled game'} from the player screen`;
    case 'session_shown_to_players':
      return `${who} showed${day ? ` ${day}` : ' a canceled game'} on the player screen again`;
    case 'pay_note_on':
      return `${who} switched the "No Venmo?" note on`;
    case 'pay_note_off':
      return `${who} switched the "No Venmo?" note off`;
    case 'credit_adjusted': {
      const delta = typeof d.deltaCents === 'number' ? d.deltaCents : 0;
      const after = typeof d.balanceAfterCents === 'number' ? `, ${formatPrice(d.balanceAfterCents)} now` : '';
      return `${player}: credit ${delta < 0 ? '-' : '+'}${formatPrice(Math.abs(delta))}${after}. Adjusted by organizer${typeof d.reason === 'string' && d.reason ? `. Reason: ${d.reason}` : ''}`;
    }
    case 'adjust_credit_on':
      return `${who} switched "Adjust credit" on`;
    case 'adjust_credit_off':
      return `${who} switched "Adjust credit" off`;
    case 'players_redo_on':
      return `${who} switched "Players redo" on`;
    case 'players_redo_off':
      return `${who} switched "Players redo" off`;
    case 'swap_button_on':
      return `${who} switched "Swap to Alex" on`;
    case 'swap_button_off':
      return `${who} switched "Swap to Alex" off`;
    case 'admin_undo_on':
      return `${who} switched "Undo on admin toasts" on`;
    case 'admin_undo_off':
      return `${who} switched "Undo on admin toasts" off`;
    case 'game_day_card_on':
      return `${who} switched "Game day card" on`;
    case 'game_day_card_off':
      return `${who} switched "Game day card" off`;
    case 'session_court_changed':
      return `${who} ${typeof d.to === 'number' ? `set the court${forDay} to Court ${d.to}` : `cleared the court${forDay}`}`;
    case 'seat_dots_on':
      return `${who} switched "Seat dots" on`;
    case 'seat_dots_off':
      return `${who} switched "Seat dots" off`;
    case 'alert_cards_on':
      return `${who} switched "Alert cards" on`;
    case 'alert_cards_off':
      return `${who} switched "Alert cards" off`;
    case 'speed_fewer_queries_on':
      return `${who} switched "Fewer database trips" on`;
    case 'speed_fewer_queries_off':
      return `${who} switched "Fewer database trips" off`;
    case 'speed_direct_load_on':
      return `${who} switched "Load games at once" on`;
    case 'speed_direct_load_off':
      return `${who} switched "Load games at once" off`;
    case 'speed_last_screen_admin_on':
      return `${who} switched "Instant admin" on`;
    case 'speed_last_screen_admin_off':
      return `${who} switched "Instant admin" off`;
    case 'speed_last_screen_on':
      return `${who} switched "Show last screen at once" on`;
    case 'speed_last_screen_off':
      return `${who} switched "Show last screen at once" off`;
    case 'card_cleanup_on':
      return `${who} switched "Card cleanup" on`;
    case 'card_cleanup_off':
      return `${who} switched "Card cleanup" off`;
    case 'short_games_on':
      return `${who} switched "Short games" on`;
    case 'short_games_off':
      return `${who} switched "Short games" off`;
    case 'card_time_buttons_on':
      return `${who} switched "Card time and buttons" on`;
    case 'card_time_buttons_off':
      return `${who} switched "Card time and buttons" off`;
    case 'last_call_texts_on':
      return `${who} switched "Last call texts" on`;
    case 'last_call_texts_off':
      return `${who} switched "Last call texts" off`;
    case 'home_collapse_on':
      return `${who} switched "Home collapse" on`;
    case 'home_collapse_off':
      return `${who} switched "Home collapse" off`;
    case 'tonight_glow_on':
      return `${who} switched "Tonight glow" on`;
    case 'tonight_glow_off':
      return `${who} switched "Tonight glow" off`;
    case 'color_cleanup_on':
      return `${who} switched "Color cleanup" on`;
    case 'color_cleanup_off':
      return `${who} switched "Color cleanup" off`;
    case 'player_cards_on':
      return `${who} switched "Simpler player cards" on`;
    case 'player_cards_off':
      return `${who} switched "Simpler player cards" off`;
    case 'venmo_request_on':
      return `${who} switched "Venmo request" on`;
    case 'venmo_request_off':
      return `${who} switched "Venmo request" off`;
    case 'motion_on':
      return `${who} switched the player animations on`;
    case 'motion_off':
      return `${who} switched the player animations off`;
    case 'motion_admin_on':
      return `${who} switched the organizer animations on`;
    case 'motion_admin_off':
      return `${who} switched the organizer animations off`;
    case 'instant_taps_on':
      return `${who} switched "Instant taps" on`;
    case 'instant_taps_off':
      return `${who} switched "Instant taps" off`;
    case 'player_fix1_on':
      return `${who} switched "Player screen fixes" on`;
    case 'player_fix1_off':
      return `${who} switched "Player screen fixes" off`;
    case 'texts_r2_on':
      return `${who} switched "Texts and alerts, round 2" on`;
    case 'texts_r2_off':
      return `${who} switched "Texts and alerts, round 2" off`;
    case 'pay_sheet_on':
      return `${who} switched the Pay sheet on`;
    case 'pay_sheet_off':
      return `${who} switched the Pay sheet off`;
    case 'admin_v2_on':
      return `${who} switched the new admin layout on`;
    case 'admin_v2_off':
      return `${who} switched the new admin layout off`;
    case 'late_fees_on':
      return `${who} switched "Late drops owe $14" on`;
    case 'late_fee_split_on':
      return `${who} switched "Late-cancel fee split" on`;
    case 'late_fee_split_off':
      return `${who} switched "Late-cancel fee split" off`;
    case 'late_fees_off':
      return `${who} switched "Late drops owe $14" off`;
    case 'late_fee_owed':
      return `${player} owes ${d.kind === 'canceled_late' ? `their ${typeof d.priceCents === 'number' ? formatPrice(d.priceCents) : '$14'} (canceled late, fee not waived)` : d.kind === 'no_show' ? `their ${typeof d.priceCents === 'number' ? formatPrice(d.priceCents) : '$14'} (did not play, fewer than 4 played)` : `their ${typeof d.priceCents === 'number' ? formatPrice(d.priceCents) : '$14'} (late drop, game short)`}${forDay}`;
    case 'late_fee_cleared':
      return d.why === 'sub'
        ? `${typeof d.sub === 'string' ? d.sub : 'A sub'} took ${player}'s spot: ${player}'s $14 cleared${forDay}`
        : d.why === 'canceled'
          ? `${player}'s late drop cleared (game canceled)${forDay}`
          : `${who} cleared ${player}'s $14 (${d.why === 'venue' ? 'venue waived' : 'my choice'})${forDay}`;
    case 'admin_r2_on':
      return `${who} switched the admin screens round 2 on`;
    case 'admin_r2_off':
      return `${who} switched the admin screens round 2 off`;
    case 'admin_r3_on':
      return `${who} switched the admin screens round 3 on`;
    case 'admin_r3_off':
      return `${who} switched the admin screens round 3 off`;
    case 'payment_claim_confirmed':
      // The words with the player's name are the Money page rework's; without it this reads as it always did (the generic line below).
      if (opts.names) return `${who} confirmed ${player}'s I paid${forDay}`;
      return `${who}: ${e.action.replace(/_/g, ' ')}${forDay}`;
    case 'payment_claim_cleared':
      if (opts.names) return `${who} cleared ${player}'s I paid${forDay}`;
      return `${who}: ${e.action.replace(/_/g, ' ')}${forDay}`;
    case 'session_hidden_from_list':
      return `${who} hid${day ? ` ${day}` : ' a game'} from the lists`;
    case 'session_shown_in_list':
      return `${who} restored${day ? ` ${day}` : ' a game'} to the lists`;
    case 'charge_edited':
      return `${who} changed the venue charge${forDay}${typeof d.chargedCents === 'number' ? (d.chargedCents > 0 ? ` to ${formatPrice(d.chargedCents)}` : ' to none') : ''}`;
    case 'money_rework_on':
      return `${who} switched the Money page rework on`;
    case 'money_rework_off':
      return `${who} switched the Money page rework off`;
    case 'player_admin_hidden':
      return `${who} hid ${player} from the Players list`;
    case 'player_admin_unhidden':
      return `${who} unhid ${player}`;
    default:
      return `${who}: ${e.action.replace(/_/g, ' ')}${forDay}`;
  }
}

/** The split on a "session_canceled" line (LATE_FEE_SPLIT): { count, priceCents }, or null. */
function splitOf(d: Record<string, unknown>): { count: number; priceCents: number } | null {
  const x = d.split as { count?: unknown; priceCents?: unknown } | undefined;
  return x && typeof x.count === 'number' && typeof x.priceCents === 'number' ? { count: x.count, priceCents: x.priceCents } : null;
}

// ---------- A quieter Activity list (Money page rework) ----------

/** What a player's seat is in a game, as far as the log shows: in, on the waitlist, or out. */
type SeatState = 'in' | 'waitlist' | 'out';

/** Where did this entry leave the player's seat (null when it says nothing about one)? Only the actions that change a seat. */
function seatAfter(e: ActivityEntry): SeatState | null {
  const a = e.action.replace(/^(player|as_player)_/, '');
  const who = e.action.startsWith('roster_');
  const result = typeof e.details.result === 'string' ? e.details.result : '';
  if (who) {
    if (e.action === 'roster_confirm') return result === 'waitlisted' || result === 'standby' ? 'waitlist' : 'in';
    if (e.action === 'roster_waitlist') return 'waitlist';
    if (e.action === 'roster_withdraw') return 'out';
    return null;
  }
  if (a === 'join') return result === 'waitlisted' || result === 'standby' ? 'waitlist' : 'in';
  if (a === 'withdraw' || a === 'decline') return 'out';
  return null;
}

/**
 * Is this move one that changed nothing? The server says so itself for a confirm of someone already in ("already_confirmed") and a
 * remove of someone who was not in ("not_in_session"); a move to the waitlist (or in, or out) that repeats where the log already shows
 * the seat is the same thing. A seat the log has not shown yet (older than this page) is never guessed at.
 */
function isNoOpMove(e: ActivityEntry, before: SeatState | undefined): boolean {
  if (!e.action.startsWith('roster_')) return false;
  const result = typeof e.details.result === 'string' ? e.details.result : '';
  if (e.action === 'roster_confirm' && result === 'already_confirmed') return true;
  if (e.action === 'roster_withdraw' && result === 'not_in_session') return true;
  const after = seatAfter(e);
  return after !== null && before !== undefined && before === after;
}

/** Two entries are truly identical: same hands, same action, same game, same details, a minute apart at most. */
const IDENTICAL_MS = 60_000;
const sameEntry = (a: ActivityEntry, b: ActivityEntry) =>
  a.actorLabel === b.actorLabel &&
  a.action === b.action &&
  a.sessionStartsAt === b.sessionStartsAt &&
  JSON.stringify(a.details) === JSON.stringify(b.details) &&
  Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) <= IDENTICAL_MS;

/**
 * The Activity list with the noise taken out (Money page rework): a move that changed nothing is hidden, and an entry that is truly
 * identical to the one just before it (a double tap) shows once. Nothing else is touched, and nothing is deleted: the log itself is
 * unchanged. Entries come newest first, as the server sends them; the order is kept.
 */
export function cleanActivity(entries: ActivityEntry[]): ActivityEntry[] {
  // Walk oldest to newest so each entry knows where its player's seat already was.
  const seat = new Map<string, SeatState>();
  const noop = new Set<string>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const who = typeof e.details.player === 'string' ? e.details.player : typeof e.details.name === 'string' ? e.details.name : null;
    const key = who ? `${e.sessionStartsAt ?? ''}|${who}` : null;
    if (isNoOpMove(e, key ? seat.get(key) : undefined)) {
      noop.add(e.id);
      continue;
    }
    const after = seatAfter(e);
    if (key && after) seat.set(key, after);
  }
  const kept: ActivityEntry[] = [];
  for (const e of entries) {
    if (noop.has(e.id)) continue;
    // Compared with the entries already kept just newer than this one.
    const dup = kept.slice(-5).some((k) => sameEntry(k, e));
    if (!dup) kept.push(e);
  }
  return kept;
}

/**
 * Highlight an entry only when it is new since the last visit AND someone other than the organizer did it (a player's own tap, for
 * example). The organizer's own actions, and anything already viewed, are never highlighted.
 */
export function highlightNew(e: ActivityEntry, isNew: boolean): boolean {
  return isNew && doneByOthers(e);
}
