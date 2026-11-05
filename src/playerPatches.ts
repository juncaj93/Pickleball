// Instant taps (INSTANT_TAPS) on the PLAYER screen: what a tap whose result is certain will look like, drawn at once over the data the
// screen already has (src/instant.ts drops it again once the server's own data is on screen, or at once if the save failed). Only taps
// whose outcome is known before the server answers are here: no money amount is guessed. Where the server decides (I'm in on a full
// game, Use credit, a late drop), nothing is drawn ahead and the tapped button shows it is working instead.

import type { GroupView } from '../shared/api';

/** "I paid": the seat reads "Paid" (self-marked, waiting for the organizer), and the Pay card for that game goes away. */
export function iPaidPatch(sessionIds: string[]): (g: GroupView) => GroupView {
  const ids = new Set(sessionIds);
  return (g) => ({
    ...g,
    sessions: g.sessions.map((s) => (ids.has(s.id) && s.mine ? { ...s, mine: { ...s.mine, paymentStatus: 'paid', selfPaid: true, oweCents: 0 } } : s)),
    payDue: g.payDue.filter((o) => !ids.has(o.sessionId)),
    owed: g.owed.filter((o) => !ids.has(o.sessionId)),
  });
}

/** Leave the waitlist (or standby): off the list at once, the seat reads "withdrawn" the way the server sends it. Nothing is paid on a
 * waiting seat, so no money line moves. */
export function leaveWaitlistPatch(sessionId: string, name: string): (g: GroupView) => GroupView {
  return (g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.id === sessionId && s.mine && s.mine.status === 'waitlisted'
        ? { ...s, mine: { ...s.mine, status: 'withdrawn', waitlistPosition: null, paymentStatus: 'not_applicable', selfPaid: false, oweCents: 0 }, waitlist: s.waitlist.filter((w) => w.name !== name) }
        : s,
    ),
  });
}

/** "Want in?" No: the question goes away at once. */
export function declinePatch(sessionId: string): (g: GroupView) => GroupView {
  return (g) => (g.suggestion && g.suggestion.sessionId === sessionId ? { ...g, suggestion: null } : g);
}
