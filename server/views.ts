import type {
  AdminPlayer,
  AdminRosterEntry,
  AdminSessionView,
  EligibleSubstitute,
  PlayerSessionView,
  ShortGameInfo,
} from '../shared/api';
import { cardWindows, deadlineMs } from '../shared/cards';
import { isPaymentClaim, moneySeen, NO_SEAT_CREDIT, type SeatCredit } from '../shared/credit';
import { holidayFor } from '../shared/holidays';
import { courtSplit, flatAtFinalize } from '../shared/pricing';
import { capOf, type GroupSettings } from '../shared/settings';
import { countText, joinOutcome, openSpots } from '../shared/spots';
import { computeSessionState } from '../shared/status';
import {
  confirmedOf,
  courtCostOf,
  flatOf,
  type PlayerRow,
  priceOf,
  type RosterRow,
  pricesFor,
  type SessionRow,
  statusInput,
  usualDaysOf,
  waitlistOf,
  waitQueue,
} from './repo';
import { bookingOpensMs } from '../shared/time';
import { agreedStart, isWaitingOnTime } from '../shared/timeShift';
import { guestIn, guestOwed, guestViewOf, headCount, lateShortSpots, seatUnits, sharesPaid } from '../shared/guestSpot';
import { dropLeavesShort, FEE_KEPT, FEE_MIN_PLAYERS, feeSplitOf, lateFeeCutoffMs, lateFeeKind, lateFeePriceCents } from '../shared/lateFees';

/** `{ shortGame }` for a game priced from its own game-length row ("Short games" on, a 1.5 hour game), else nothing at all. */
function shortGameOf(session: SessionRow, settings: GroupSettings): { shortGame?: ShortGameInfo } {
  const gp = priceOf(session, settings);
  return gp.special ? { shortGame: { minutes: gp.minutes, flatCents: gp.flatCents, courtCents: gp.courtCents } } : {};
}

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
  /** The TIME_SHIFT switch: ask a player who is in to confirm a start time that changed after they agreed to one. */
  timeShift = false,
  /** The LATE_FEES switch for this screen (server/lateFees.ts): the drop dialog and banner say what a late drop costs. */
  lateFees = false,
): PlayerSessionView {
  const confirmed = confirmedOf(roster);
  // "Card cleanup" (Zip 10): players never see a waitlist. Someone still on one (only possible while the switch is on for a test phone
  // alone; switching it on for everyone moves every waiter in) reads as not in yet: their I'm in takes a seat like anyone's.
  const noWaitlist = settings.noCap === true;
  const waitlist = noWaitlist ? [] : waitlistOf(roster);
  const prices = pricesFor(session, roster, settings);
  const mine = meId ? roster.find((r) => r.player_id === meId && !(noWaitlist && r.status === 'waitlisted')) : undefined;
  const started = nowMs >= Date.parse(session.starts_at);
  const canceled = session.status === 'canceled';
  const owes = !!mine && mine.status === 'confirmed' && mine.payment_status === 'unpaid' && prices.has(mine.player_id);
  const price = mine ? (prices.get(mine.player_id)?.cents ?? 0) : 0;
  const owe = owes ? Math.max(0, price - pot.seat.usedCents - pot.seat.cashCents) : 0;
  const paidNow = mine && mine.payment_status === 'paid' && !mine.refunded_at ? (mine.payment_amount_cents ?? 0) : 0;
  const claimed = !!mine && paidNow > 0 && !!mine.self_paid_at;
  // Late fees (shared/lateFees.ts): past the cancel-by with the switch on, a drop that leaves the game short keeps their
  // money on it (nothing comes back), and the dialog and banner say so.
  const feeCents = flatOf(session, settings);
  // Zip 42 "Guest spot": guests count like players, and a seat with its guest in pays (and drops) for two. No guest: as before.
  const heads = headCount(confirmed);
  const myUnits = mine ? seatUnits(mine) : 1;
  const queue = noWaitlist ? [] : waitQueue(roster);
  const lateWindow =
    lateFees && !!mine && mine.status === 'confirmed' && !canceled && !started && nowMs >= lateFeeCutoffMs(session.starts_at);
  // The real waitlist (also when hidden), the same count the server's late-drop rule uses.
  // Zip 42: my own waiting guest leaves with me, so it is not someone who could take my spot (server/lateFees.ts LEAVES_SHORT says the same).
  const waitersLeft = waitQueue(roster).filter((e) => !(e.guest && e.row.id === mine?.id)).length;
  // Round 3 (Alex): a host and guest leaving owe only the spots the game is short: 4 minus everyone left, at most the spots they take.
  // A host who still owes a guest's spot removed late leaves 2 spots too (that one is already owed). No guest: exactly dropLeavesShort.
  const myHeads = mine && guestIn(mine) ? 2 : 1;
  const mySpots = mine && (guestIn(mine) || guestOwed(mine)) ? 2 : 1;
  const shortSpots = lateWindow ? lateShortSpots(heads - myHeads + waitersLeft, mySpots, FEE_MIN_PLAYERS) : 0;
  const dropOwes = lateWindow && (mySpots === 1 ? dropLeavesShort(heads - (myUnits - 1), waitersLeft) : shortSpots > 0);
  const owedUnits = mySpots === 1 ? myUnits : Math.max(1, shortSpots);
  // Removing my guest alone (I stay) leaves the game below 4: the guest's share stays owed until someone takes the spot.
  const removeOwes = lateWindow && !isOrganizer && !!mine && guestIn(mine) && heads - 1 + waitersLeft < FEE_MIN_PLAYERS;
  const openFee = mine ? lateFeeKind(mine, session, isOrganizer) : null;
  const ownRow: PlayerSessionView['mine'] = mine
    ? {
        status: mine.status,
        waitlistPosition: mine.status === 'waitlisted' ? queue.findIndex((e) => !e.guest && e.row.id === mine.id) + 1 : null,
        attendanceConfirmed: !!mine.attendance_confirmed_at,
        // "Card cleanup" (Zip 10): no waitlist, so no "Good news, a spot opened up" either (also for an older move-in).
        promotion: !noWaitlist && mine.status === 'confirmed' && mine.promotion_reason ? 'spot_opened' : null,
        shareCents: prices.get(mine.player_id)?.cents ?? null,
        paymentStatus: mine.payment_status,
        selfPaid: !!mine.self_paid_at,
        signupAt: mine.confirmed_at ?? mine.claimed_at,
        oweCents: owe,
        creditCents: mine.payment_status === 'unpaid' ? pot.seat.usedCents : 0,
        // What a drop out would give back right now (the same sums as seatMoneyBackStatements): credit used on the
        // seat goes back to the pot; cash paid toward it (and cash held against it) comes back as credit.
        // An unconfirmed "I paid" freezes the seat on a drop: nothing moves until the organizer confirms it (dropClaimCents).
        dropCreditCents: isOrganizer || claimed || dropOwes ? 0 : pot.seat.usedCents,
        dropCashCents: isOrganizer || claimed || dropOwes ? 0 : pot.seat.cashCents + Math.max(0, paidNow - pot.seat.usedCents - pot.seat.cashCents),
        dropClaimCents: isOrganizer || !claimed || dropOwes ? 0 : Math.max(paidNow, pot.seat.usedCents + pot.seat.cashCents),
        paidEarlierCents: mine.payment_status === 'unpaid' ? pot.seat.cashCents : 0,
        paidWithCredit: mine.payment_status === 'paid' && pot.seat.usedCents > 0 && pot.seat.usedCents >= (mine.payment_amount_cents ?? 0),
        useCreditCents: owes && !canceled ? Math.min(pot.usableCents, owe) : 0,
        // Once that credit is all spent the "Your $14 is now credit. Request refund" line would point at nothing, so it goes.
        creditBackCents: pot.hasCredit === false ? 0 : pot.seat.backCents,
        ...(lateWindow
          ? {
              lateDrop: {
                cancelByAt: new Date(lateFeeCutoffMs(session.starts_at)).toISOString(),
                owes: dropOwes,
                // Zip 27 (A-02): a seat paid below the fee (the game was made longer after the payment) would owe only the rest: the dialog says
                // that ("you still owe $3"). Every other seat: exactly as before.
                ...(!isOrganizer && mine.payment_status === 'paid' && !mine.refunded_at && !claimed && paidNow > 0 && paidNow < feeCents * owedUnits
                  ? { paid: false, feeCents: feeCents * owedUnits - paidNow }
                  : { paid: !isOrganizer && (paidNow > 0 || pot.seat.usedCents + pot.seat.cashCents > 0), feeCents: feeCents * owedUnits }),
                // Zip 42 round 3: only for a host with a guest: how many spots a drop would leave short (0 to 2), and whether removing the
                // guest alone would leave the game below 4.
                ...(mySpots === 2 ? { guestSpots: shortSpots, ...(guestIn(mine) ? { removeOwes } : {}) } : {}),
              },
            }
          : {}),
        // A late cancel with the fee split owes the split price (shared/lateFees.ts); every other fee the flat price.
        lateFee: openFee
          ? {
              kind: openFee,
              oweCents: mine.payment_status === 'unpaid' ? Math.max(0, lateFeePriceCents(openFee, session, feeCents) * myUnits - pot.seat.usedCents - pot.seat.cashCents) : 0,
              ...(openFee === 'canceled_late' && feeSplitOf(session) ? { priceCents: feeSplitOf(session)!.priceCents } : {}),
            }
          : null,
        ...(() => {
          const gv = guestViewOf(mine);
          if (gv && gv.status !== 'late') return { guest: { name: gv.name, status: gv.status, shareCents: feeCents } };
          // Round 3: a guest removed late whose spot is still owed ("Sam's spot: you owe $14 unless someone takes it").
          return gv && guestOwed(mine) && !canceled ? { guestOwed: { name: gv.name, cents: feeCents, paid: mine.payment_status === 'paid' && !mine.refunded_at } } : {};
        })(),
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
    confirmed: confirmed.flatMap((r) => [
      { name: r.display_name, attendanceConfirmed: !!r.attendance_confirmed_at },
      ...(guestIn(r) ? [{ name: r.guest_name as string, attendanceConfirmed: !!r.attendance_confirmed_at, guestOf: r.display_name }] : []),
    ]),
    waitlist: queue.length === waitlist.length ? waitlist.map((r) => ({ name: r.display_name })) : queue.map((e) => (e.guest ? { name: e.row.guest_name as string, guestOf: e.row.display_name } : { name: e.row.display_name })),
    openSpots: canceled || started ? 0 : openSpots(heads, capOf(settings)),
    countText: countText(heads, noWaitlist ? Number.POSITIVE_INFINITY : settings.maxPlayers),
    full: !noWaitlist && heads >= settings.maxPlayers,
    joinAs: noWaitlist ? 'in' : joinOutcome(heads, settings.maxPlayers),
    holiday: holidayFor(session.starts_at, tz),
    courtState: session.court_state,
    extra: !!session.is_extra,
    note: session.note,
    bookingOpen: nowMs >= bookingOpensMs(session.starts_at, settings.bookingLeadDays, tz),
    bookingOpensAt: new Date(bookingOpensMs(session.starts_at, settings.bookingLeadDays, tz)).toISOString(),
    past: nowMs >= Date.parse(session.ends_at),
    finalized: session.finalized_at ? { playedCount: session.final_played_count ?? 0, priceCents: session.final_price_cents ?? feeCents } : null,
    ...shortGameOf(session, settings),
    // With LATE_FEES on, one clock: start minus 12 hours (the late-drop rule uses the same one).
    dropCutoffAt: new Date(lateFees ? lateFeeCutoffMs(session.starts_at) : deadlineMs({ startsAt: session.starts_at, cancellationDeadlineAt: session.cancellation_deadline_at }, settings)).toISOString(),
    confirmationOpen:
      !canceled && !started && nowMs >= Date.parse(session.starts_at) - settings.checkInHours * 3600_000,
    mine: ownRow && isOrganizer ? { ...ownRow, ...NO_MONEY, lateFee: null } : ownRow,
    // Only a player who is in, on a game still ahead: never the organizer (confirmed automatically), a dropped
    // player or a real standby seat.
    timeAsk:
      timeShift && mine && !isOrganizer && mine.status === 'confirmed' && !canceled && !started && !session.finalized_at && isWaitingOnTime(mine.time_confirmed, session.starts_at)
        ? { wasStartsAt: agreedStart(mine.time_confirmed)! }
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
  /** The TIME_SHIFT switch: "Confirmed 2 of 3 · Waiting on Dan". */
  timeShift = false,
): AdminSessionView {
  const confirmed = confirmedOf(roster);
  const waitlist = waitlistOf(roster);
  // Zip 42: the whole line, waiting guests included (no guest: the same entries as waitlist).
  const queue = waitQueue(roster);
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
      // An open late fee (shared/lateFees.ts) owes like a seat that is in, also on a seat that left or a game canceled late.
      const fee = lateFeeKind(r, session, me);
      const owes = !me && (r.status === 'confirmed' || fee) && r.payment_status === 'unpaid' && share !== null ? Math.max(0, share - seat.usedCents - seat.cashCents) : 0;
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
        moneySeen: moneySeen({
          paymentStatus: r.payment_status,
          paymentAmountCents: r.payment_amount_cents,
          refunded: !!r.refunded_at,
          selfPaid: !!r.self_paid_at,
          creditCents: seat.usedCents,
          cashCents: seat.cashCents,
          priceCents: share,
          finalizedAt: session.finalized_at ?? null,
        }),
        played: r.played === null || r.played === undefined ? null : r.status === 'withdrawn' ? null : r.played === 1,
        // The organizer's own late drop: owed until cleared, never "paid" (their seat's payment is the court payment).
        lateFee: fee
          ? me
            ? { kind: fee, paid: false, oweCents: flatOf(session, settings) * seatUnits(r) }
            : { kind: fee, paid: r.payment_status === 'paid' && !r.refunded_at, oweCents: owes }
          : null,
        isOrganizer: me,
        waitlistPosition: r.status === 'waitlisted' ? queue.findIndex((e) => !e.guest && e.row.id === r.id) + 1 : null,
        ...(() => {
          const gv = guestViewOf(r);
          if (!gv) return {};
          const at = queue.findIndex((e) => e.guest && e.row.id === r.id);
          // Round 2: each person's own paid line (the money is still one record on this seat).
          const p = gv.status === 'confirmed' && share !== null && seatUnits(r) === 2 ? pairPaid(r, share, me ? NO_SEAT_CREDIT : potFor(r)) : null;
          return {
            guest: {
              name: gv.name,
              status: gv.status,
              ...(gv.status === 'waitlisted' ? { waitlistPosition: at >= 0 ? at + 1 : null } : {}),
              ...(p ? { shareCents: p.shareCents, paid: p.guest, hostPaid: p.host, hostOwesCents: p.hostOwesCents, guestOwesCents: p.guestOwesCents } : {}),
              ...(gv.status === 'confirmed' && session.finalized_at && r.played === 1 ? { played: r.guest_played !== 0 } : {}),
            },
          };
        })(),
        promotedAt: r.status === 'confirmed' ? r.promoted_at : null,
        refundedAt: r.payment_status === 'paid' ? r.refunded_at : null,
        lateDropAt: r.status === 'withdrawn' ? r.late_drop_at : null,
        lateDropDoneAt: r.status === 'withdrawn' ? r.late_drop_done_at : null,
        // "Card cleanup" (Zip 10): no "Spot opened" text card on organizer Home (also for an older move-in).
        promotionReason: settings.noCap !== true && r.status === 'confirmed' && r.promotion_reason ? 'spot_opened' : null,
        promotionNotifiedAt: r.promotion_notified_at,
      };
    });

  // Other players only: the organizer pays the venue and is never counted as owing.
  const others = confirmed.filter((r) => r.player_id !== organizerId);
  // Seats that pay: everyone in a game that is on, plus open late fees (a late drop, a no-show, a late cancel the venue charged).
  const feeRows = roster.filter((r) => r.player_id !== organizerId && lateFeeKind(r, session));
  const payers = [...(session.status !== 'canceled' ? others.filter((r) => prices.has(r.player_id) && !lateFeeKind(r, session)) : []), ...feeRows];
  // Round 2 (Alex): "x of y paid" counts people: a host and the guest each count, each with their own paid share. No guest: seats, as before.
  const pairOf = (r: RosterRow) => (seatUnits(r) === 2 && guestIn(r) && prices.has(r.player_id) ? pairPaid(r, prices.get(r.player_id)!.cents, potFor(r)) : null);
  const payable = payers.reduce((n, r) => n + (pairOf(r) ? 2 : 1), 0);
  const paidCount = payable
    ? payers.reduce((n, r) => {
        const p = pairOf(r);
        return n + (p ? Number(p.host) + Number(p.guest) : r.payment_status === 'paid' ? 1 : 0);
      }, 0)
    : 0;
  const feeKept = session.status === 'canceled' && session.canceled_by === FEE_KEPT;

  // The organizer's court row: the full court cost, what the other players
  // cover (what they owe before finalizing, what the group kept after), and
  // whether the venue has been paid.
  const myRow = organizerId ? roster.find((r) => r.player_id === organizerId) : undefined;
  const hasCourt = (session.status !== 'canceled' || feeKept) && (session.booking_status === 'booked' || confirmed.length > 0);
  const courtCost = courtCostOf(session, settings);
  const split = courtSplit(
    courtCost,
    roster
      .filter((r) => r.player_id !== organizerId)
      .map((r) => {
        const seat = potFor(r);
        const fee = lateFeeKind(r, session);
        // An open late fee still owed: its whole price.
        if (fee && r.payment_status === 'unpaid') return prices.get(r.player_id)?.cents ?? 0;
        // A claim (unconfirmed "I paid" on a seat that left) is not money the players cover.
        if (!fee && isPaymentClaim({ status: r.status, paymentStatus: r.payment_status, selfPaid: !!r.self_paid_at, refundedAt: r.refunded_at, played: session.finalized_at && r.played === 0 ? false : null }, session.status === 'canceled')) return 0;
        if (r.payment_status === 'paid' && !r.refunded_at) return (r.payment_amount_cents ?? 0) - seat.backCents;
        // An unpaid seat: its whole price (what they still owe, plus credit and cash already put on it).
        if (r.status === 'confirmed' && r.payment_status === 'unpaid') return prices.get(r.player_id)?.cents ?? 0;
        return 0;
      }),
  );
  const gp = priceOf(session, settings);
  const paidByPlayed = roster.filter((r) => r.player_id !== organizerId && r.played === 1 && r.payment_status === 'paid' && !r.refunded_at).map((r) => r.payment_amount_cents ?? 0);
  const finalized = session.finalized_at
    ? {
        at: session.finalized_at,
        playedCount: session.final_played_count ?? 0,
        priceCents: session.final_price_cents ?? gp.flatCents,
        creditBackCents: roster.filter((r) => r.player_id !== organizerId).reduce((sum, r) => sum + potFor(r).finalizedBackCents, 0),
        // A 1.5 hour game ("Short games" on) is not priced floor(4 x flat / N), so with no payment to go on its flat price is its row's.
        flatCents:
          gp.special && !paidByPlayed.some((c) => c > 0)
            ? gp.flatCents
            : flatAtFinalize(paidByPlayed, gp.flatCents, session.final_played_count ?? 0, session.final_price_cents ?? gp.flatCents),
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
    feeSplit: feeSplitOf(session),
    ...shortGameOf(session, settings),
    cancelReason: session.status === 'canceled' ? session.cancel_reason : null,
    state,
    roster: entries,
    confirmedCount: headCount(confirmed),
    waitlistCount: queue.length,
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
    timeCheck: timeShift ? timeCheckOf(session, confirmed, organizerId, nowMs) : null,
  };
}

/** Zip 42 round 2: which person of a pair is paid. A paid seat (an I paid too) counts both; an unpaid one splits what it holds. */
function pairPaid(r: RosterRow, priceCents: number, seat: SeatCredit): ReturnType<typeof sharesPaid> {
  if (r.payment_status === 'paid' && !r.refunded_at) return { host: true, guest: true, shareCents: Math.floor(priceCents / 2), hostOwesCents: 0, guestOwesCents: 0 };
  return sharesPaid(seat.usedCents + seat.cashCents, priceCents, r.guest_first === 1);
}

/**
 * "Confirmed 2 of 3 · Waiting on Dan" for a game whose start time changed after someone in had agreed to one.
 * Everyone in counts, the organizer as confirmed. Null when nobody in was there for a change (or the game is over).
 */
export function timeCheckOf(session: SessionRow, confirmed: RosterRow[], organizerId: string | null, nowMs: number): AdminSessionView['timeCheck'] {
  if (session.status === 'canceled' || session.finalized_at || nowMs >= Date.parse(session.starts_at)) return null;
  const others = confirmed.filter((r) => r.player_id !== organizerId);
  if (!others.some((r) => agreedStart(r.time_confirmed) !== null)) return null;
  const waiting = others.filter((r) => isWaitingOnTime(r.time_confirmed, session.starts_at));
  return {
    confirmedCount: confirmed.length - waiting.length,
    inCount: confirmed.length,
    waiting: waiting.map((r) => ({ playerId: r.player_id, name: r.display_name, phone: r.phone_number, wasStartsAt: agreedStart(r.time_confirmed)! })),
  };
}
