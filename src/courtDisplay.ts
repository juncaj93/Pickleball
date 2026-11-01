// How a game whose court is not booked looks to a player. Display only: nothing
// here is sent to the server or changes a record, an amount, credit or a refund.
//
// We expect to get a court, so until one is booked such a game works like any
// other game: "Court not booked", "3 of 4 in", "I'm in" / "You're in" with Drop
// out, and no money prompts (nobody pays before a court is booked; credit used at
// sign-up still shows as "Paid with credit" or "Credit $3 used"). The words
// waitlist, waiting and standby are not used for it, unless the game is really
// full beyond the max (then it has a real waitlist, like a booked game). A court
// set to Waitlist is the same as Not booked here: the server gives normal seats.
// (An old standby seat left over from before that rule is drawn as in while there
// is room, until the one-time repair moves it in.) Once the court
// is booked the game shows its normal look, pay prompts included; booked and
// later changed back to not booked, they go away again. Someone who already
// paid stays paid and still sees it. A game with a booked court that is full
// keeps its waitlist wording.

import type { GroupView, PlayerSessionView } from '../shared/api';
import { courtStatus } from '../shared/court';
import { countText } from '../shared/spots';

/** The court is not booked (and the game is still on): not yet, booking not open, or on the venue's waiting list. */
export function isNoCourt(s: PlayerSessionView): boolean {
  const kind = courtStatus(s).kind;
  return kind === 'needs' || kind === 'later' || kind === 'waitlist';
}

/** One game, shown the normal way when its court is not booked. Other games are returned as they are. */
function plainGame(s: PlayerSessionView, maxPlayers: number): PlayerSessionView {
  if (!isNoCourt(s)) return s;
  // A court on Waitlist works like Not booked: real seats while there is room. The server no longer makes standby seats
  // for it, but an old standby seat still left over counts as in as long as there is room; only a full game keeps a waitlist.
  const room = Math.max(0, maxPlayers - s.confirmed.length);
  const lifted = s.waitlist.slice(0, room);
  const stays = s.waitlist.slice(room);
  const confirmed = [...s.confirmed, ...lifted.map((w) => ({ name: w.name, attendanceConfirmed: false }))];
  const mine = s.mine
    ? {
        ...s.mine,
        ...(s.mine.status === 'waitlisted'
          ? (s.mine.waitlistPosition ?? Infinity) <= room
            ? { status: 'confirmed' as const, waitlistPosition: null }
            : { waitlistPosition: (s.mine.waitlistPosition ?? room + 1) - lifted.length }
          : {}),
        // No Pay before a court is booked. A payment that is already recorded stays and shows, and so does credit
        // already used on the seat ("Credit $3 used"). Credit they can still use stays usable (Alex, Oct 31: a
        // player with an unpaid seat and credit always has a way to use it): "Use $14 credit".
        ...(s.mine.paymentStatus === 'paid' ? {} : { oweCents: 0, paidEarlierCents: 0 }),
      }
    : s.mine;
  return {
    ...s,
    confirmed,
    waitlist: stays,
    countText: countText(confirmed.length, maxPlayers),
    full: confirmed.length >= maxPlayers,
    // Only a game that is really full beyond the max sends people to the waitlist, same as a booked one.
    joinAs: confirmed.length >= maxPlayers ? 'waitlist' : 'in',
    openSpots: s.canceled || s.started ? 0 : Math.max(0, maxPlayers - confirmed.length),
    courtState: s.courtState === 'waitlist' ? null : s.courtState,
    // The old third value must not leave a different look (blue) behind: to players it is plain Not booked.
    bookingStatus: s.bookingStatus === 'unavailable' ? 'needs_booking' : s.bookingStatus,
    mine,
  };
}

/** The player's data with every game that has no court booked drawn as a normal game. */
export function courtDisplay(g: GroupView): GroupView {
  const noCourt = new Set(g.sessions.filter(isNoCourt).map((s) => s.id));
  if (noCourt.size === 0) return g;
  const sessions = g.sessions.map((s) => plainGame(s, g.group.maxPlayers));
  const suggested = g.suggestion && noCourt.has(g.suggestion.sessionId) ? sessions.find((s) => s.id === g.suggestion!.sessionId) : null;
  return {
    ...g,
    sessions,
    payDue: g.payDue.filter((o) => !noCourt.has(o.sessionId)),
    owed: g.owed.filter((o) => !noCourt.has(o.sessionId)),
    suggestion:
      g.suggestion && suggested
        ? { ...g.suggestion, joinAs: 'in', courtState: g.suggestion.courtState === 'waitlist' ? null : g.suggestion.courtState, confirmedCount: suggested.confirmed.length, noCourt: true }
        : g.suggestion,
  };
}
