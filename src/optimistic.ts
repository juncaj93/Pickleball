// "Instant feel" for I'm in and Drop out. The card changes the moment the
// person taps; if the server says no, the overlay is simply removed and the
// real data shows again. Never used for payments: money states only change
// after the server confirms.

import type { GroupView, PlayerSessionView } from '../shared/api';
import { countText, joinOutcome } from '../shared/spots';

export type Overlay = Record<string, 'join' | 'drop'>;

/** Can a tap on "I'm in" be shown at once? Only a plain spot: not a waitlist, not standby, not canceled or started. */
export function canJoinInstantly(s: PlayerSessionView): boolean {
  return !s.canceled && !s.started && s.joinAs === 'in' && !s.full && s.courtState !== 'waitlist' && (!s.mine || (s.mine.status !== 'confirmed' && s.mine.status !== 'waitlisted'));
}

function joined(s: PlayerSessionView, name: string, max: number): PlayerSessionView {
  if (s.confirmed.some((c) => c.name === name)) return s;
  const confirmed = [...s.confirmed, { name, attendanceConfirmed: false }];
  return {
    ...s,
    confirmed,
    countText: countText(confirmed.length, max),
    full: confirmed.length >= max,
    joinAs: joinOutcome(confirmed.length, max),
    openSpots: Math.max(0, max - confirmed.length),
    // No money line yet: what they owe appears once the server has answered.
    mine: {
      status: 'confirmed',
      waitlistPosition: null,
      attendanceConfirmed: false,
      promotion: null,
      shareCents: null,
      paymentStatus: 'unpaid',
      selfPaid: false,
      signupAt: new Date().toISOString(),
      oweCents: 0,
      creditCents: 0,
      paidEarlierCents: 0,
      paidWithCredit: false,
      useCreditCents: 0,
      creditBackCents: 0,
    },
  };
}

function dropped(s: PlayerSessionView, name: string, max: number): PlayerSessionView {
  const confirmed = s.confirmed.filter((c) => c.name !== name);
  return {
    ...s,
    confirmed,
    // Also off the waiting list (a game with no court booked shows those people as in).
    waitlist: s.waitlist.filter((c) => c.name !== name),
    countText: countText(confirmed.length, max),
    full: confirmed.length >= max,
    joinAs: joinOutcome(confirmed.length, max),
    openSpots: s.canceled || s.started ? 0 : Math.max(0, max - confirmed.length),
    mine: null,
  };
}

/** The screen's data with the taps that are still waiting on the server drawn in. */
export function applyOverlay(g: GroupView, overlay: Overlay): GroupView {
  const ids = Object.keys(overlay);
  if (ids.length === 0 || !g.me) return g;
  const name = g.me.name;
  return {
    ...g,
    sessions: g.sessions.map((s) => {
      const kind = overlay[s.id];
      if (!kind) return s;
      return kind === 'join' ? joined(s, name, g.group.maxPlayers) : dropped(s, name, g.group.maxPlayers);
    }),
    // A held drop must not leave a Pay card for that game at the top.
    payDue: g.payDue.filter((o) => overlay[o.sessionId] !== 'drop'),
    owed: g.owed.filter((o) => overlay[o.sessionId] !== 'drop'),
  };
}
