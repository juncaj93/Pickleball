// History > Activity: each log entry as one plain sentence, like
// "Ryan said I'm in for Tue, Nov 3" or "Robin marked Ryan paid for Tue, Nov 3".
import type { ActivityEntry } from './api';
import { formatShortDate } from './time';

/** The sentence for one entry. `organizer` is the organizer's name (from Settings), or "Organizer". */
export function activityText(e: ActivityEntry, tz: string, organizer: string): string {
  const d = e.details;
  const player = typeof d.player === 'string' ? d.player : typeof d.name === 'string' ? d.name : 'someone';
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
      return `${who} marked ${player} unpaid${forDay}`;
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
      return `${who} canceled${day ? ` ${day}` : ' a session'}`;
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
    case 'six_drop_sorted':
      return `${who} sorted out the drop below 6${forDay}`;
    case 'late_drop_done':
      return `${who} handled a late drop${forDay}`;
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
    default:
      return `${who}: ${e.action.replace(/_/g, ' ')}${forDay}`;
  }
}
