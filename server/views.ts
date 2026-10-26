import type {
  AdminPlayer,
  AdminRosterEntry,
  AdminSessionView,
  EligibleSubstitute,
  PlayerSessionView,
} from '../shared/api';
import { SPOTS_PER_SESSION, type GroupSettings } from '../shared/settings';
import { computeSessionState } from '../shared/status';
import {
  confirmedOf,
  type PlayerRow,
  type RosterRow,
  type SessionRow,
  sharesFor,
  statusInput,
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
  const shares = sharesFor(session, roster);
  const mine = meId ? roster.find((r) => r.player_id === meId) : undefined;
  const started = nowMs >= Date.parse(session.starts_at);
  const canceled = session.status === 'canceled';
  return {
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    canceled,
    started,
    bookingStatus: session.booking_status,
    venueName: session.venue_name,
    courtCostCents: canceled ? null : session.court_cost_cents,
    confirmed: confirmed.map((r) => ({ name: r.display_name, attendanceConfirmed: !!r.attendance_confirmed_at })),
    waitlist: waitlist.map((r) => ({ name: r.display_name })),
    openSpots: canceled || started ? 0 : Math.max(0, SPOTS_PER_SESSION - confirmed.length),
    confirmationOpen:
      !canceled && !started && nowMs >= Date.parse(session.starts_at) - settings.checkInHours * 3600_000,
    mine: mine
      ? {
          status: mine.status,
          waitlistPosition: mine.status === 'waitlisted' ? waitlist.findIndex((r) => r.id === mine.id) + 1 : null,
          attendanceConfirmed: !!mine.attendance_confirmed_at,
          shareCents: shares.get(mine.player_id) ?? null,
          paymentStatus: mine.payment_status,
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
  };
}

/** Waitlisted players first (in order), then regulars, then other subs. */
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

export function adminSessionView(
  session: SessionRow,
  roster: RosterRow[],
  players: PlayerRow[],
  nowMs: number,
  settings: GroupSettings,
): AdminSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  const shares = sharesFor(session, roster);
  const state = computeSessionState(statusInput(session, roster), nowMs, settings);
  const order = new Map<string, number>();
  confirmed.forEach((r, i) => order.set(r.id, i));
  waitlist.forEach((r, i) => order.set(r.id, 100 + i));

  const entries: AdminRosterEntry[] = [...roster]
    .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.claim_seq - b.claim_seq)
    .map((r) => {
      const share = shares.get(r.player_id) ?? null;
      const paid = r.payment_status === 'paid' && r.payment_amount_cents !== null;
      const expected = r.status === 'confirmed' ? (share ?? 0) : 0;
      const diff = paid ? (r.payment_amount_cents as number) - expected : null;
      return {
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
        shareCents: share,
        paymentDifferenceCents: diff !== null && diff !== 0 ? diff : null,
        waitlistPosition: r.status === 'waitlisted' ? waitlist.findIndex((w) => w.id === r.id) + 1 : null,
      };
    });

  const payable = session.status !== 'canceled' && session.court_cost_cents !== null ? confirmed.length : 0;
  const paidCount = payable ? confirmed.filter((r) => r.payment_status === 'paid').length : 0;
  let uncovered = 0;
  if (session.court_cost_cents !== null && session.status !== 'canceled') {
    let covered = 0;
    for (const v of shares.values()) covered += v;
    uncovered = session.court_cost_cents - covered;
  }

  return {
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    status: session.status,
    bookingStatus: session.booking_status,
    venueName: session.venue_name,
    venueBookingUrl: session.venue_booking_url,
    reservationReference: session.reservation_reference,
    courtCostCents: session.court_cost_cents,
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
    uncoveredCents: uncovered,
    eligibleSubstitutes: state.flags.openSpots > 0 ? eligibleSubstitutes(roster, players) : [],
  };
}
