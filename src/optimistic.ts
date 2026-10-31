// "Instant feel" for I'm in and Drop out. The card changes the moment the
// person taps; if the server says no, the overlay is simply removed and the
// real data shows again. A held drop also draws in the credit it gives back
// (the server's own amounts), so the chip shows it with the banner. Nothing
// is saved by this file: the ledger only changes when the server does it.

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
      dropCreditCents: 0,
      dropCashCents: 0,
      dropClaimCents: 0,
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

/**
 * A held drop's money, drawn in at once (the "You dropped out. $14 credit returned." banner shows at the same
 * moment): the credit on the seat and the cash paid toward it are back in the pot, so the CREDIT chip and the
 * credit sheet show the new balance and the return. The amounts are the server's own (`dropCreditCents`,
 * `dropCashCents`: exactly what the drop moves). Undo removes the overlay and the screen is as before; when the
 * drop is sent, the real data replaces it with the same numbers. An unconfirmed I paid moves nothing (a claim).
 */
function creditAfterDrops(g: GroupView, overlay: Overlay, nowIso: string): GroupView['credit'] {
  if (!g.credit || !Object.values(overlay).includes('drop')) return g.credit;
  let back = 0;
  const history = [...g.credit.history];
  for (const s of g.sessions) {
    if (overlay[s.id] !== 'drop' || !s.mine) continue;
    const credit = s.mine.dropCreditCents ?? 0;
    const cash = s.mine.dropCashCents ?? 0;
    back += credit + cash;
    // The credit used on that game ends (it went back), and the cash becomes a credit entry, newest first.
    for (let i = 0; i < history.length; i++) {
      const e = history[i];
      if (credit > 0 && e.kind === 'used' && e.sessionId === s.id && !e.endedAt) history[i] = { ...e, endedAt: nowIso, endedReason: 'dropped' };
    }
    if (cash > 0)
      history.unshift({ id: `held-drop-${s.id}`, kind: 'kept', cents: cash, sessionId: s.id, sessionStartsAt: s.startsAt, at: nowIso, endedAt: null, endedReason: null, reason: 'dropped', playedCount: null });
  }
  if (back === 0) return g.credit;
  return { ...g.credit, balanceCents: g.credit.balanceCents + back, usableCents: g.credit.usableCents + back, history };
}

/** The screen's data with the taps that are still waiting on the server drawn in. */
export function applyOverlay(g: GroupView, overlay: Overlay, nowIso = new Date().toISOString()): GroupView {
  const ids = Object.keys(overlay);
  if (ids.length === 0 || !g.me) return g;
  const name = g.me.name;
  return {
    ...g,
    credit: creditAfterDrops(g, overlay, nowIso),
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
