// How a game whose court is not booked looks to a player. Display only: nothing
// here is sent to the server or changes a record, an amount, credit or a refund.
//
// We expect to get a court, so until one is booked such a game works like any
// other game: "Court not booked", "3 of 4 in", "I'm in" / "You're in" with Drop
// out, and no money prompts (nobody pays before a court is booked). The words
// waitlist, waiting and standby are not used for it. (Behind the scenes the
// server still keeps people who tap I'm in on a game that is waiting on the
// venue's court list in order; the screen simply calls them in.) Once the court
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
  // Everyone who tapped I'm in counts as in, in the order they did.
  const confirmed = [...s.confirmed, ...s.waitlist.map((w) => ({ name: w.name, attendanceConfirmed: false }))];
  const mine = s.mine
    ? {
        ...s.mine,
        ...(s.mine.status === 'waitlisted' ? { status: 'confirmed' as const, waitlistPosition: null } : {}),
        // No money prompts before a court is booked. A payment that is already recorded stays and shows.
        ...(s.mine.paymentStatus === 'paid' ? {} : { oweCents: 0, creditCents: 0, paidEarlierCents: 0, useCreditCents: 0 }),
      }
    : s.mine;
  return {
    ...s,
    confirmed,
    waitlist: [],
    countText: countText(confirmed.length, maxPlayers),
    full: confirmed.length >= maxPlayers,
    joinAs: 'in',
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
