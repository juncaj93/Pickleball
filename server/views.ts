import type {
  AdminPlayer,
  AdminRosterEntry,
  AdminSessionView,
  EligibleSubstitute,
  PlayerSessionView,
  RefundDue,
} from '../shared/api';
import type { GroupSettings } from '../shared/settings';
import { goingText, joinOutcome, openSpots } from '../shared/spots';
import { computeSessionState } from '../shared/status';
import {
  confirmedOf,
  type PlayerRow,
  type RosterRow,
  type SessionRow,
  sharesFor,
  statusInput,
  usualDaysOf,
  waitlistOf,
} from './repo';

/** What a player sees. No phone numbers, and payment details only for their own row. */
export function playerSessionView(
  session: SessionRow,
  roster: RosterRow[],
  meId: string | null,
  nowMs: number,
  settings: GroupSettings,
): PlayerSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  const shares = sharesFor(session, roster, settings);
  const mine = meId ? roster.find((r) => r.player_id === meId) : undefined;
  const started = nowMs >= Date.parse(session.starts_at);
  const canceled = session.status === 'canceled';
  const six = !canceled && confirmed.length === 6;
  const othersWaiting = waitlist.filter((r) => r.player_id !== meId).length;
  return {
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    canceled,
    started,
    bookingStatus: session.booking_status,
    venueName: session.venue_name,
    confirmed: confirmed.map((r) => ({ name: r.display_name, attendanceConfirmed: !!r.attendance_confirmed_at })),
    waitlist: waitlist.map((r) => ({ name: r.display_name })),
    openSpots: canceled || started ? 0 : openSpots(confirmed.length, waitlist.length),
    goingText: goingText(confirmed.length, waitlist.length),
    joinAs: joinOutcome(confirmed.length, othersWaiting),
    sixPlaying: six,
    confirmationOpen:
      !canceled && !started && nowMs >= Date.parse(session.starts_at) - settings.checkInHours * 3600_000,
    mine: mine
      ? {
          status: mine.status,
          waitlistPosition: mine.status === 'waitlisted' ? waitlist.findIndex((r) => r.id === mine.id) + 1 : null,
          attendanceConfirmed: !!mine.attendance_confirmed_at,
          promotion: mine.status === 'confirmed' ? mine.promotion_reason : null,
          shareCents: shares.get(mine.player_id) ?? null,
          paymentStatus: mine.payment_status,
          refundCents: six && mine.status === 'confirmed' && settings.refundCentsWhenSix > 0 ? settings.refundCentsWhenSix : null,
        }
      : null,
  };
}

export function adminPlayerView(p: PlayerRow): AdminPlayer {
  return {
    id: p.id,
    name: p.display_name,
    phone: p.phone_number,
    isRegular: !!p.is_regular,
    isActive: !!p.is_active,
    canReceiveSubstituteInvites: !!p.can_receive_substitute_invites,
    sortOrder: p.sort_order,
    usualDays: usualDaysOf(p),
  };
}

/** Waitlisted players first (in order), then regulars, then everyone else. */
export function eligibleSubstitutes(roster: RosterRow[], players: PlayerRow[]): EligibleSubstitute[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: EligibleSubstitute[] = [];
  const seen = new Set<string>();
  for (const r of waitlistOf(roster)) {
    const p = byId.get(r.player_id);
    if (!p || !p.is_active || !p.can_receive_substitute_invites) continue;
    out.push({ playerId: p.id, name: p.display_name, phone: p.phone_number, source: 'waitlist' });
    seen.add(p.id);
  }
  const inSession = new Set(roster.filter((r) => r.status === 'confirmed').map((r) => r.player_id));
  const rest = players
    .filter((p) => p.is_active && p.can_receive_substitute_invites && !inSession.has(p.id) && !seen.has(p.id))
    .sort((a, b) => b.is_regular - a.is_regular || a.sort_order - b.sort_order);
  for (const p of rest) {
    out.push({ playerId: p.id, name: p.display_name, phone: p.phone_number, source: p.is_regular ? 'regular' : 'substitute' });
  }
  return out;
}

/**
 * Money going back out: the flat refund for everyone when 6 are playing,
 * and a full refund for anyone who paid and then left.
 */
export function refundsFor(session: SessionRow, roster: RosterRow[], settings: GroupSettings): RefundDue[] {
  const out: RefundDue[] = [];
  const confirmed = confirmedOf(roster);
  if (session.status !== 'canceled' && confirmed.length === 6 && settings.refundCentsWhenSix > 0) {
    for (const r of confirmed) {
      out.push({ playerId: r.player_id, name: r.display_name, amountCents: settings.refundCentsWhenSix, refunded: !!r.refunded_at, reason: 'six' });
    }
  }
  for (const r of roster) {
    const left = r.status !== 'confirmed' || session.status === 'canceled';
    if (left && r.payment_status === 'paid' && r.payment_amount_cents) {
      out.push({ playerId: r.player_id, name: r.display_name, amountCents: r.payment_amount_cents, refunded: !!r.refunded_at, reason: 'dropped' });
    }
  }
  return out;
}

export function adminSessionView(
  session: SessionRow,
  roster: RosterRow[],
  players: PlayerRow[],
  nowMs: number,
  settings: GroupSettings,
): AdminSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  const shares = sharesFor(session, roster, settings);
  const state = computeSessionState(statusInput(session, roster), nowMs, settings);
  const order = new Map<string, number>();
  confirmed.forEach((r, i) => order.set(r.id, i));
  waitlist.forEach((r, i) => order.set(r.id, 100 + i));

  const entries: AdminRosterEntry[] = [...roster]
    .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.claim_seq - b.claim_seq)
    .map((r) => ({
      playerId: r.player_id,
      name: r.display_name,
      phone: r.phone_number,
      status: r.status,
      claimedAt: r.claimed_at,
      confirmedAt: r.confirmed_at,
      attendanceConfirmedAt: r.attendance_confirmed_at,
      paymentStatus: r.payment_status,
      paidAt: r.paid_at,
      paymentAmountCents: r.payment_amount_cents,
      shareCents: shares.get(r.player_id) ?? null,
      waitlistPosition: r.status === 'waitlisted' ? waitlist.findIndex((w) => w.id === r.id) + 1 : null,
      promotedAt: r.status === 'confirmed' ? r.promoted_at : null,
      promotionReason: r.status === 'confirmed' ? r.promotion_reason : null,
      promotionNotifiedAt: r.promotion_notified_at,
      refundedAt: r.refunded_at,
    }));

  const payable = session.status !== 'canceled' ? confirmed.length : 0;
  const paidCount = payable ? confirmed.filter((r) => r.payment_status === 'paid').length : 0;

  return {
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    status: session.status,
    bookingStatus: session.booking_status,
    venueName: session.venue_name,
    venueBookingUrl: session.venue_booking_url,
    reservationReference: session.reservation_reference,
    cancellationDeadlineAt: session.cancellation_deadline_at,
    adminDecision: session.admin_decision,
    decisionAt: session.decision_at,
    canceledAt: session.canceled_at,
    canceledBy: session.canceled_by,
    state,
    roster: entries,
    confirmedCount: confirmed.length,
    waitlistCount: waitlist.length,
    paidCount,
    payableCount: payable,
    refunds: refundsFor(session, roster, settings),
    eligibleSubstitutes: state.flags.openSpots > 0 ? eligibleSubstitutes(roster, players) : [],
  };
}
