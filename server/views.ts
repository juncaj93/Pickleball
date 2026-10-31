import type {
  AdminPlayer,
  AdminRosterEntry,
  AdminSessionView,
  EligibleSubstitute,
  PlayerSessionView,
} from '../shared/api';
import { cardWindows, deadlineMs } from '../shared/cards';
import { isPaymentClaim, moneySeen, NO_SEAT_CREDIT, type SeatCredit } from '../shared/credit';
import { holidayFor } from '../shared/holidays';
import { courtSplit, flatAtFinalize } from '../shared/pricing';
import type { GroupSettings } from '../shared/settings';
import { countText, joinOutcome, openSpots } from '../shared/spots';
import { computeSessionState } from '../shared/status';
import {
  confirmedOf,
  courtCostOf,
  type PlayerRow,
  type RosterRow,
  pricesFor,
  type SessionRow,
  statusInput,
  usualDaysOf,
  waitlistOf,
} from './repo';
import { bookingOpensMs } from '../shared/time';

/** The organizer pays the venue, so their own player screen carries no share, Pay, credit or "paid". */
const NO_MONEY = {
  shareCents: null,
  paymentStatus: 'not_applicable',
  selfPaid: false,
  oweCents: 0,
  creditCents: 0,
  dropCreditCents: 0,
  dropCashCents: 0,
  dropClaimCents: 0,
  paidEarlierCents: 0,
  paidWithCredit: false,
  useCreditCents: 0,
  creditBackCents: 0,
} as const;

export { NO_SEAT_CREDIT, type SeatCredit };

/** What a player sees. No phone numbers, and payment details only for their own row. */
export function playerSessionView(
  session: SessionRow,
  roster: RosterRow[],
  meId: string | null,
  nowMs: number,
  settings: GroupSettings,
  tz: string,
  /** The viewer is the organizer, who pays the venue: no share, Pay, credit or "paid" shows for them. */
  isOrganizer = false,
  /** This player's own credit: what they can spend now, whether any is left (or a refund request is open), and this seat's part of their pot. */
  pot: { usableCents: number; hasCredit?: boolean; seat: SeatCredit } = { usableCents: 0, seat: NO_SEAT_CREDIT },
): PlayerSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  const prices = pricesFor(session, roster, settings);
  const mine = meId ? roster.find((r) => r.player_id === meId) : undefined;
  const started = nowMs >= Date.parse(session.starts_at);
  const canceled = session.status === 'canceled';
  const owes = !!mine && mine.status === 'confirmed' && mine.payment_status === 'unpaid' && prices.has(mine.player_id);
  const price = mine ? (prices.get(mine.player_id)?.cents ?? 0) : 0;
  const owe = owes ? Math.max(0, price - pot.seat.usedCents - pot.seat.cashCents) : 0;
  const paidNow = mine && mine.payment_status === 'paid' && !mine.refunded_at ? (mine.payment_amount_cents ?? 0) : 0;
  const claimed = !!mine && paidNow > 0 && !!mine.self_paid_at;
  const ownRow: PlayerSessionView['mine'] = mine
    ? {
        status: mine.status,
        waitlistPosition: mine.status === 'waitlisted' ? waitlist.findIndex((r) => r.id === mine.id) + 1 : null,
        attendanceConfirmed: !!mine.attendance_confirmed_at,
        promotion: mine.status === 'confirmed' && mine.promotion_reason ? 'spot_opened' : null,
        shareCents: prices.get(mine.player_id)?.cents ?? null,
        paymentStatus: mine.payment_status,
        selfPaid: !!mine.self_paid_at,
        signupAt: mine.confirmed_at ?? mine.claimed_at,
        oweCents: owe,
        creditCents: mine.payment_status === 'unpaid' ? pot.seat.usedCents : 0,
        // What a drop out would give back right now (the same sums as seatMoneyBackStatements): credit used on the
        // seat goes back to the pot; cash paid toward it (and cash held against it) comes back as credit.
        // An unconfirmed "I paid" freezes the seat on a drop: nothing moves until the organizer confirms it (dropClaimCents).
        dropCreditCents: isOrganizer || claimed ? 0 : pot.seat.usedCents,
        dropCashCents: isOrganizer || claimed ? 0 : pot.seat.cashCents + Math.max(0, paidNow - pot.seat.usedCents - pot.seat.cashCents),
        dropClaimCents: isOrganizer || !claimed ? 0 : Math.max(paidNow, pot.seat.usedCents + pot.seat.cashCents),
        paidEarlierCents: mine.payment_status === 'unpaid' ? pot.seat.cashCents : 0,
        paidWithCredit: mine.payment_status === 'paid' && pot.seat.usedCents > 0 && pot.seat.usedCents >= (mine.payment_amount_cents ?? 0),
        useCreditCents: owes && !canceled ? Math.min(pot.usableCents, owe) : 0,
        // Once that credit is all spent the "Your $14 is now credit. Request refund" line would point at nothing, so it goes.
        creditBackCents: pot.hasCredit === false ? 0 : pot.seat.backCents,
      }
    : null;
  return {
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    canceled,
    cancelReason: canceled ? session.cancel_reason : null,
    started,
    bookingStatus: session.booking_status,
    venueName: session.venue_name,
    confirmed: confirmed.map((r) => ({ name: r.display_name, attendanceConfirmed: !!r.attendance_confirmed_at })),
    waitlist: waitlist.map((r) => ({ name: r.display_name })),
    openSpots: canceled || started ? 0 : openSpots(confirmed.length, settings.maxPlayers),
    countText: countText(confirmed.length, settings.maxPlayers),
    full: confirmed.length >= settings.maxPlayers,
    joinAs: joinOutcome(confirmed.length, settings.maxPlayers),
    holiday: holidayFor(session.starts_at, tz),
    courtState: session.court_state,
    extra: !!session.is_extra,
    note: session.note,
    bookingOpen: nowMs >= bookingOpensMs(session.starts_at, settings.bookingLeadDays, tz),
    bookingOpensAt: new Date(bookingOpensMs(session.starts_at, settings.bookingLeadDays, tz)).toISOString(),
    past: nowMs >= Date.parse(session.ends_at),
    finalized: session.finalized_at ? { playedCount: session.final_played_count ?? 0, priceCents: session.final_price_cents ?? settings.pricePerPlayerCents } : null,
    dropCutoffAt: new Date(deadlineMs({ startsAt: session.starts_at, cancellationDeadlineAt: session.cancellation_deadline_at }, settings)).toISOString(),
    confirmationOpen:
      !canceled && !started && nowMs >= Date.parse(session.starts_at) - settings.checkInHours * 3600_000,
    mine: ownRow && isOrganizer ? { ...ownRow, ...NO_MONEY } : ownRow,
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
    isNew: !!p.is_new,
    venmo: p.venmo_handle,
    lateDrops: 0,
    played: 0,
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

export function adminSessionView(
  session: SessionRow,
  roster: RosterRow[],
  players: PlayerRow[],
  nowMs: number,
  settings: GroupSettings,
  tz: string,
  /** The organizer's player id: they pay the venue, so they have no share and are never counted as owing. */
  organizerId: string | null = null,
  /** The credit pot's part of a seat: credit used on it, and money that came back from it. */
  potFor: (row: RosterRow) => SeatCredit = () => NO_SEAT_CREDIT,
  /** A canceled game the venue still charged for. */
  chargedCents: number | null = null,
  /** Who blocks a reopen: credit from this game already used or refunded, or held by a pending refund request. */
  reopen: { spent: string[]; requested: string[] } = { spent: [], requested: [] },
): AdminSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  const prices = pricesFor(session, roster, settings);
  const state = computeSessionState(statusInput(session, roster), nowMs, settings, tz);
  const order = new Map<string, number>();
  confirmed.forEach((r, i) => order.set(r.id, i));
  waitlist.forEach((r, i) => order.set(r.id, 100 + i));
  const over = nowMs >= Date.parse(session.ends_at);

  const entries: AdminRosterEntry[] = [...roster]
    .sort((a, b) => (order.get(a.id) ?? 1000) - (order.get(b.id) ?? 1000) || a.claim_seq - b.claim_seq)
    .map((r) => {
      const me = r.player_id === organizerId;
      const seat = me ? NO_SEAT_CREDIT : potFor(r);
      const share = me ? null : (prices.get(r.player_id)?.cents ?? null);
      const owes = !me && r.status === 'confirmed' && r.payment_status === 'unpaid' && share !== null ? Math.max(0, share - seat.usedCents - seat.cashCents) : 0;
      return {
        playerId: r.player_id,
        name: r.display_name,
        phone: r.phone_number,
        status: r.status,
        claimedAt: r.claimed_at,
        confirmedAt: r.confirmed_at,
        attendanceConfirmedAt: r.attendance_confirmed_at,
        paymentStatus: r.payment_status,
        selfPaid: !!r.self_paid_at,
        paidAt: r.paid_at,
        paymentAmountCents: r.payment_amount_cents,
        shareCents: share,
        owesCents: owes,
        creditCents: seat.usedCents,
        paidEarlierCents: r.payment_status === 'unpaid' ? seat.cashCents : 0,
        creditBackCents: seat.backCents,
        creditBackReason: seat.backReason,
        // What Remove would give back right now (the same sums as a drop; a claim moves nothing).
        ...(() => {
          const paidNow = r.payment_status === 'paid' && !r.refunded_at ? (r.payment_amount_cents ?? 0) : 0;
          const claimed = paidNow > 0 && !!r.self_paid_at;
          return {
            dropCreditCents: me || claimed ? 0 : seat.usedCents,
            dropCashCents: me || claimed ? 0 : seat.cashCents + Math.max(0, paidNow - seat.usedCents - seat.cashCents),
            dropClaimCents: me || !claimed ? 0 : Math.max(0, paidNow - seat.usedCents - seat.cashCents),
          };
        })(),
        moneySeen: moneySeen({ paymentStatus: r.payment_status, paymentAmountCents: r.payment_amount_cents, refunded: !!r.refunded_at, selfPaid: !!r.self_paid_at, creditCents: seat.usedCents, cashCents: seat.cashCents }),
        played: r.played === null || r.played === undefined ? null : r.played === 1,
        isOrganizer: me,
        waitlistPosition: r.status === 'waitlisted' ? waitlist.findIndex((w) => w.id === r.id) + 1 : null,
        promotedAt: r.status === 'confirmed' ? r.promoted_at : null,
        refundedAt: r.payment_status === 'paid' ? r.refunded_at : null,
        lateDropAt: r.status === 'withdrawn' ? r.late_drop_at : null,
        lateDropDoneAt: r.status === 'withdrawn' ? r.late_drop_done_at : null,
        promotionReason: r.status === 'confirmed' && r.promotion_reason ? 'spot_opened' : null,
        promotionNotifiedAt: r.promotion_notified_at,
      };
    });

  // Other players only: the organizer pays the venue and is never counted as owing.
  const others = confirmed.filter((r) => r.player_id !== organizerId);
  const payable = session.status !== 'canceled' ? others.filter((r) => prices.has(r.player_id)).length : 0;
  const paidCount = payable ? others.filter((r) => prices.has(r.player_id) && r.payment_status === 'paid').length : 0;

  // The organizer's court row: the full court cost, what the other players
  // cover (what they owe before finalizing, what the group kept after), and
  // whether the venue has been paid.
  const myRow = organizerId ? roster.find((r) => r.player_id === organizerId) : undefined;
  const hasCourt = session.status !== 'canceled' && (session.booking_status === 'booked' || confirmed.length > 0);
  const courtCost = courtCostOf(session, settings);
  const split = courtSplit(
    courtCost,
    roster
      .filter((r) => r.player_id !== organizerId)
      .map((r) => {
        const seat = potFor(r);
        // A claim (unconfirmed "I paid" on a seat that left) is not money the players cover.
        if (isPaymentClaim({ status: r.status, paymentStatus: r.payment_status, selfPaid: !!r.self_paid_at, refundedAt: r.refunded_at }, session.status === 'canceled')) return 0;
        if (r.payment_status === 'paid' && !r.refunded_at) return (r.payment_amount_cents ?? 0) - seat.backCents;
        // An unpaid seat: its whole price (what they still owe, plus credit and cash already put on it).
        if (r.status === 'confirmed' && r.payment_status === 'unpaid') return prices.get(r.player_id)?.cents ?? 0;
        return 0;
      }),
  );
  const finalized = session.finalized_at
    ? {
        at: session.finalized_at,
        playedCount: session.final_played_count ?? 0,
        priceCents: session.final_price_cents ?? settings.pricePerPlayerCents,
        creditBackCents: roster.filter((r) => r.player_id !== organizerId).reduce((sum, r) => sum + potFor(r).finalizedBackCents, 0),
        flatCents: flatAtFinalize(
          roster.filter((r) => r.player_id !== organizerId && r.played === 1 && r.payment_status === 'paid' && !r.refunded_at).map((r) => r.payment_amount_cents ?? 0),
          settings.pricePerPlayerCents,
          session.final_played_count ?? 0,
          session.final_price_cents ?? settings.pricePerPlayerCents,
        ),
      }
    : null;

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
    cancelReason: session.status === 'canceled' ? session.cancel_reason : null,
    state,
    roster: entries,
    confirmedCount: confirmed.length,
    waitlistCount: waitlist.length,
    paidCount,
    payableCount: payable,
    court: hasCourt
      ? { costCents: courtCost, typicalCost: session.court_cost_cents === null, ...split, paid: myRow?.payment_status === 'paid', paidAt: myRow?.payment_status === 'paid' ? myRow.paid_at : null }
      : null,
    courtCostCents: session.court_cost_cents,
    chargedCents,
    courtState: session.court_state,
    plannedStartsAt: session.planned_starts_at,
    moved: !!session.planned_starts_at && session.planned_starts_at !== session.starts_at,
    extra: !!session.is_extra,
    note: session.note,
    bookingOpensAt: new Date(bookingOpensMs(session.starts_at, settings.bookingLeadDays, tz)).toISOString(),
    shownEarly: !!session.shown_early,
    holiday: holidayFor(session.starts_at, tz),
    holidayHoursOk: !!session.holiday_hours_ok_at,
    cards: cardWindows(
      {
        startsAt: session.starts_at,
        cancellationDeadlineAt: session.cancellation_deadline_at,
        canceled: session.status === 'canceled',
        dayBeforeDone: !!session.day_before_done_at,
        lastCallDone: !!session.last_call_done_at,
      },
      nowMs,
      settings,
    ),
    finalized,
    needsFinalize: session.status !== 'canceled' && !session.finalized_at && over && roster.some((r) => r.status === 'confirmed' || (r.payment_status === 'paid' && !r.refunded_at && r.player_id !== organizerId)),
    reopenBlockedBy: reopen.spent,
    reopenRequestedBy: reopen.requested,
    eligibleSubstitutes: state.flags.openSpots > 0 ? eligibleSubstitutes(roster, players) : [],
  };
}
