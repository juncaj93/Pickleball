import type { LateFeeKind } from './lateFees';
// Shapes of the JSON the API returns. Shared by server and browser.
import type { CreditReason } from './credit';
import type { GroupSettings } from './settings';
import type { AdminDecision, BookingStatus, SessionRecordStatus, SessionState } from './status';

export type RosterStatus = 'confirmed' | 'waitlisted' | 'withdrawn' | 'declined';
export type PaymentStatus = 'unpaid' | 'paid' | 'not_applicable';

/** A game priced from its own row of the game-length table (shared/gameLength.ts), with "Short games" on. */
export interface ShortGameInfo {
  minutes: number;
  /** The flat price everyone pays up front ($11 for 1.5 hours). */
  flatCents: number;
  /** The court cost when the booking has none entered ($36 for 1.5 hours). */
  courtCents: number;
}

export interface PlayerSessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  /** Why the organizer canceled (up to 40 characters), or null. Only set for a canceled game. */
  cancelReason: string | null;
  /** Zip 14 "Game day card" (server/gameDay.ts): the court, 1 to 16. Only while the switch is on for this screen AND a court is set; missing otherwise. */
  court?: number;
  started: boolean;
  bookingStatus: BookingStatus;
  venueName: string | null;
  confirmed: { name: string; attendanceConfirmed: boolean }[];
  waitlist: { name: string }[];
  /** Spots left before the game is full. */
  openSpots: number;
  /** "3 of 4 in", "5 in", "10 in, full" */
  countText: string;
  /** At the max: anyone else waits. */
  full: boolean;
  /** What the big button does for someone not in yet. */
  joinAs: 'in' | 'waitlist';
  /** US holiday on this date, e.g. "Thanksgiving". */
  holiday: string | null;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** A one-off game the organizer added, with its optional note. */
  extra: boolean;
  note: string | null;
  /** Inside the booking window (14 days by default), and when it opens. */
  bookingOpen: boolean;
  bookingOpensAt: string;
  /** Already played; only listed because this player still owes for it. */
  past: boolean;
  /** The organizer finalized who played: the final price each. */
  finalized: { playedCount: number; priceCents: number } | null;
  /** Only for a game priced from its own game-length row ("Short games" on, a 1.5 hour game; shared/gameLength.ts). Missing: a normal game at group.priceCents. */
  shortGame?: ShortGameInfo;
  confirmationOpen: boolean;
  /** The cancellation deadline. The page sends a drop at once when it is this close, so the 5-second Undo wait never changes how the drop counts. */
  dropCutoffAt: string;
  mine: null | {
    status: RosterStatus;
    waitlistPosition: number | null;
    attendanceConfirmed: boolean;
    /** Moved in from the waitlist: show the "Good news" line. */
    promotion: 'spot_opened' | null;
    /** Their price for this session ($14 until finalized, then the final price; null when nothing is owed). */
    shareCents: number | null;
    paymentStatus: PaymentStatus;
    /** They tapped "I paid" themselves. */
    selfPaid: boolean;
    /** When this sign-up started. A fresh "I'm in" after "I'm out" gets a new one. */
    signupAt: string;
    /** What they still owe for this session, after credit used on it (0 when paid). */
    oweCents: number;
    /** Credit from their pot already used on this session. */
    /** What Drop out would give back right now: credit used on this seat (back to the pot) and cash paid toward it (becomes credit). */
    dropCreditCents: number;
    dropCashCents: number;
    /** An unconfirmed "I paid" a drop would leave for the organizer to confirm (it becomes credit only then). */
    dropClaimCents: number;
    /** Set by the player screen only (src/courtDisplay.ts): on standby for a court the venue has not given yet. */
    standby?: boolean;
    creditCents: number;
    /** Cash they paid toward this session before its price went up (a redo with fewer players). */
    paidEarlierCents: number;
    /** Paid in full with credit from their pot: shows "Paid with credit". */
    paidWithCredit: boolean;
    /** What "Use credit" would take off this session now: the smaller of their usable credit and what they owe. 0 hides the button. */
    useCreditCents: number;
    /**
     * LATE_FEES (shared/lateFees.ts): past the cancel-by (start minus 12 hours) with the switch on for this screen.
     * `owes`: dropping now would leave the game short, so their $14 stays (or is owed) unless someone takes the spot.
     * `paid`: money is on the seat ("Your $14 stays on this game"). Missing: the drop works exactly as before.
     */
    lateDrop?: { cancelByAt: string; owes: boolean; paid: boolean; feeCents: number };
    /** An open late fee on this seat (e.g. a game canceled late that the venue charged): what kind, and what is still owed. */
    /** priceCents: only for a late cancel with the fee split (LATE_FEE_SPLIT), what this seat's share is. */
    lateFee?: { kind: LateFeeKind; oweCents: number; priceCents?: number } | null;
    /** Money from this session that came back to them as credit (they dropped out, it was canceled, they did not play, or they paid more than the final price). 0 once they have no credit left. */
    creditBackCents: number;
  };
  /**
   * "Time may shift": the organizer moved this game's start after this player (who is in) agreed to a time.
   * `wasStartsAt` is the time they last agreed to. Null when there is nothing to ask (or TIME_SHIFT is off).
   */
  timeAsk: { wasStartsAt: string } | null;
  /** Set by the player screen only (src/courtDisplay.ts): the court is on the venue's waitlist (players see Court not booked). */
  venueWaitlist?: boolean;
}

/** One line of a player's credit history. */
export interface CreditEntryView {
  id: string;
  /** kept: money came back as credit. used: spent on a game. refunded: paid back by Venmo. */
  kind: 'kept' | 'used' | 'refunded';
  cents: number;
  sessionId: string | null;
  sessionStartsAt: string | null;
  at: string;
  /** Undone, or went back to the player. It no longer counts. */
  endedAt: string | null;
  endedReason: 'undone' | 'unmarked' | 'dropped' | 'canceled' | null;
  reason: CreditReason | null;
  playedCount: number | null;
  /** This money came back because a late fee was cleared: 'sub' (someone took their spot) or 'cleared' (the organizer cleared it). */
  lateFee?: 'sub' | 'cleared' | null;
  /** An organizer adjustment (reason 'adjusted'): why, and the pot right after it (admin screens). */
  note?: string;
  balanceAfterCents?: number;
}

/** A player's own credit (never anyone else's). */
export interface CreditView {
  /** The pot. */
  balanceCents: number;
  /** The pot minus a pending refund request: what "Use credit" can spend. */
  usableCents: number;
  /** A refund request waiting on the organizer. */
  pending: { id: string; cents: number; at: string } | null;
  /** Live entries, newest first. */
  history: CreditEntryView[];
}

/** Zip 16 (shared/afterGame.ts): one credit record Finalize wrote for this player (credit_ledger kind 'kept', reason 'finalized'). */
export interface AfterGameCredit {
  /** The ledger row's id. */
  id: string;
  sessionId: string;
  startsAt: string;
  /** The row's amount, as written, to the cent. */
  cents: number;
  /** The game's stored final price (sessions.final_price_cents), or null if it is not known. */
  finalPriceCents: number | null;
  playedCount: number | null;
  /** When the credit was given. */
  at: string;
}

export interface GroupView {
  group: { name: string; timezone: string; venmoUrl: string | null; organizerName: string | null; /** Apple Pay / Zelle number for the Pay sheet; "" = none to show; missing = the default. */ zelleNumber?: string; priceCents: number; maxPlayers: number; usualMinutes: number };
  players: { id: string; name: string }[];
  me: { id: string; name: string } | null;
  /** True when the organizer is looking through this player's eyes. */
  viewingAs: boolean;
  /** The moved-game notice is on for this screen (server/timeShift.ts). The court look does not depend on it. */
  timeShift?: boolean;
  /** The MOTION switch (server/motion.ts): the player screens animate. Visual only; false or missing means the screen looks exactly as it did. */
  motion?: boolean;
  /** "Ask for payment on every game" is on for this screen (server/payAlways.ts): Pay shows on games with no court booked too. False or missing: hidden there, as before. */
  payAlways?: boolean;
  /** "No Venmo? Pay Alex directly" is on for this screen (server/payNote.ts). False or missing: Pay behaves exactly as before. */
  payNote?: boolean;
  /** "Player screen small fixes, round 1" is on for this screen (server/playerFix1.ts): Pay and I paid on tonight's card, a roomier TONIGHT tag. False or missing: the screen looks exactly as before. */
  playerFix1?: boolean;
  /** "Pay sheet" is on for this screen (server/paySheet.ts): Pay opens a small sheet. False or missing: Pay behaves exactly as before. */
  paySheet?: boolean;
  /** "Instant taps" is on for this screen (server/instantTaps.ts): taps draw at once and save in the background. Missing: every tap works exactly as before. */
  instantTaps?: boolean;
  /** "Home collapse" is on for this screen (server/homeCollapse.ts): Home shows this week and next week, later games behind one button. Missing: Home is exactly as before. */
  homeCollapse?: boolean;
  /** "Tonight glow" is on for this screen (server/zip7.ts): TONIGHT / TOMORROW tags and the badge glow. Missing: tiles are exactly as before. */
  tonightGlow?: boolean;
  /** "Color cleanup" is on for this screen (server/zip7.ts): the one color system. Missing: colors are exactly as before. */
  colorCleanup?: boolean;
  /** "Simpler player cards" is on for this screen (server/zip7.ts): no court status words or dot on player cards. Missing: cards are exactly as before. */
  playerCardsSimple?: boolean;
  /** "Short games" is on for this screen (server/zip9.ts): a 1.5 hour game carries its own price (`shortGame` on the game) and the calendar uses the real end. Missing: exactly as before. */
  shortGames?: boolean;
  /** "Card time and buttons" is on for this screen (server/zip9.ts): the time line under the date tile and the joined Calendar | Directions button. Missing: cards are exactly as before. */
  cardTimeButtons?: boolean;
  /** "Card cleanup" is on for this screen (server/zip10.ts): no count text, people icon and names, tinted Later cards; no waitlist and no Max players cap. Missing: exactly as before. */
  cardCleanup?: boolean;
  /** "Alert cards" is on for this screen (server/zip11.ts): one action-card look for every alert. Missing: exactly as before. */
  alertCards?: boolean;
  /** Zip 12 "Load games at once" (server/speed.ts): the plain site address asks for this answer together with its set-up check next time. Missing: as before. */
  directLoad?: boolean;
  /** Zip 12 "Show last screen at once" (server/speed.ts): this phone keeps a copy of what it shows (src/lastScreen.ts). Missing: nothing is kept, and an old copy is thrown away. */
  lastScreen?: boolean;
  /** "Seat dots" is on for this screen (server/seatDots.ts): every empty seat a dashed ring. Missing: exactly as before. */
  seatDots?: boolean;
  /** Swap to Alex (Zip 13): this phone is signed in as the organizer (real PIN) and the switch is on: the "Go to Admin" pill. Missing for everyone else. */
  goToAdmin?: true;
  /** Zip 14 "Game day card" is on for this screen (server/gameDay.ts): the game day card, court numbers on the games. Missing: exactly as before. */
  /** Preview only (shared/previewCalm.ts): hide the alert cards (?alerts=all shows them). Never on live. */
  previewCalm?: true;
  /** Zip 17, Unpaid nudge (shared/unpaidNudge.ts): only while on for this phone. The count comes from `owed`. */
  unpaidNudge?: { limit: number };
  gameDayCard?: true;
  /** Zip 14, PREVIEW ONLY (GAME_DAY_TEST): this phone asked to see the next game's date as today. Never on live. */
  gameDayTest?: true;
  /** Zip 16 "After-game cards" is on for this screen (server/afterGame.ts). Missing: exactly as before (no card, owe card as before). */
  afterGameCard?: true;
  /** Zip 16, only while on: this player's own credit back from Finalize in the last 7 days (the real ledger rows). */
  afterGame?: AfterGameCredit[];
  /** Preview only (PREVIEW_CALM is set, previews only): the site is a preview, so ?as=Name may pick that name on this phone. Never on live. */
  preview?: true;
  /** "Late drops owe $14" is on for this screen (server/lateFees.ts). False or missing: drops work exactly as before. */
  lateFees?: boolean;
  /**
   * This player's own late fees that were cleared in the last 60 days (never anyone else's), for a notice they dismiss
   * on this phone: 'sub' someone took their spot, 'cleared' the organizer cleared it (or the game was canceled).
   * `creditCents`: what came back to them as credit (0 when they had not paid).
   */
  feeNotices?: { id: string; startsAt: string; why: 'sub' | 'cleared'; creditCents: number; /** Only for a 1.5 hour game with "Short games" on: what it owed. Missing: group.priceCents. */ feeCents?: number }[];
  now: string;
  sessions: PlayerSessionView[];
  /** Confirmed, unpaid sessions. `reminder` only once the session ended more than 24 hours ago. */
  owed: {
    sessionId: string;
    startsAt: string;
    endsAt: string;
    /** What they actually owe, after credit used on it. */
    amountCents: number;
    creditCents: number;
    /** The session was finalized at this price (owes the remainder, not the flat price). */
    finalized: boolean;
    reminder: boolean;
    /** When this sign-up started (see `mine.signupAt`). */
    signupAt: string;
    /** An open late fee (shared/lateFees.ts): "(late drop)", "(canceled late)" or "(did not play)" after the date. */
    lateFee?: LateFeeKind;
    /**
     * Zip 16 "After-game cards" (shared/afterGame.ts), only while on: this seat was paid at a lower price before Finalize (its cash is
     * held on the seat) and now owes the rest. The game's stored final price and how many played. Missing: exactly as before.
     */
    more?: { finalPriceCents: number; playedCount: number | null };
  }[];
  /**
   * What to pay now, for the card at the top of the screen: owed sessions
   * whose game day has reached 8:00 AM. Nothing before that.
   */
  payDue: GroupView['owed'];
  /** Their credit. Only their own. */
  credit: CreditView;
  /** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
  suggestion: {
    sessionId: string;
    startsAt: string;
    endsAt: string;
    joinAs: 'in' | 'waitlist';
    holiday: string | null;
    /** How many are in now. */
    confirmedCount: number;
    /** The venue's court waitlist: players go on standby. */
    courtState: 'waitlist' | 'opened' | 'not_opened' | null;
    /** Screen only (set by src/courtDisplay.ts): the court is not booked, so the prompt reads like a normal game. */
    noCourt?: boolean;
  } | null;
  /** The "did anything change?" code this data was read at (see server/stamp.ts). */
  version: string;
}

export interface AdminRosterEntry {
  playerId: string;
  name: string;
  phone: string | null;
  status: RosterStatus;
  claimedAt: string;
  confirmedAt: string | null;
  attendanceConfirmedAt: string | null;
  paymentStatus: PaymentStatus;
  /** The player marked it paid themselves; the organizer sees a "self-marked" tag. */
  selfPaid: boolean;
  paidAt: string | null;
  /** What they paid (cash plus credit used), as recorded when marked paid. */
  paymentAmountCents: number | null;
  /** Their price now: $14 until finalized, the final price if they played, null when nothing is owed. */
  shareCents: number | null;
  /** What they still owe right now (0 when paid or nothing owed). */
  owesCents: number;
  waitlistPosition: number | null;
  promotedAt: string | null;
  refundedAt: string | null;
  /** Dropped out after the day-before check-in opened. */
  lateDropAt: string | null;
  lateDropDoneAt: string | null;
  promotionReason: 'spot_opened' | null;
  promotionNotifiedAt: string | null;
  /** Credit from their pot used on this seat. */
  creditCents: number;
  /** Cash paid toward this seat before its price went up. */
  paidEarlierCents: number;
  /** Money from this seat that went back to them as credit, and why. */
  creditBackCents: number;
  creditBackReason: CreditReason | null;
  /** The seat's money as this screen shows it (shared/credit.ts moneySeen): sent back with Mark paid / Unmark. */
  moneySeen: string;
  /** What Remove would give back now: credit back to the pot, cash that becomes credit, an unconfirmed I paid that waits. */
  dropCreditCents: number;
  dropCashCents: number;
  dropClaimCents: number;
  /** Set once the game is finalized: did they play. */
  played: boolean | null;
  /** An open late fee on this seat (shared/lateFees.ts), paid or not. Null for everyone else. */
  lateFee?: { kind: LateFeeKind; paid: boolean; oweCents: number } | null;
  /**
   * This is the organizer. They pay the venue, not the other players, so
   * there is no share or credit here, and their paid mark means "Court paid".
   */
  isOrganizer: boolean;
}

/** Organizer only: the court row on a session's Who paid list. Never sent to players. */
export interface CourtDue {
  /** The full court cost for the session (the booking's cost, else the typical cost). */
  costCents: number;
  typicalCost: boolean;
  /** What the other players owe (or paid) for this session under the usual rules. */
  playersCoverCents: number;
  /** Court cost minus what players cover, never below $0. */
  yourShareCents: number;
  /** Players cover the whole court or more. */
  covered: boolean;
  /** The organizer paid the venue. */
  paid: boolean;
  paidAt: string | null;
}

export interface EligibleSubstitute {
  playerId: string;
  name: string;
  phone: string | null;
  source: 'waitlist' | 'regular' | 'substitute';
}

export interface AdminSessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Zip 14: the court number, 1 to 16, only while "Game day card" is on for this screen and a court is set (missing otherwise).
   *  (Not `court`: that is the court cost, below.) */
  courtNum?: number;
  status: SessionRecordStatus;
  bookingStatus: BookingStatus;
  venueName: string | null;
  venueBookingUrl: string | null;
  reservationReference: string | null;
  cancellationDeadlineAt: string | null;
  adminDecision: AdminDecision;
  decisionAt: string | null;
  canceledAt: string | null;
  canceledBy: string | null;
  /** Canceled late with the fee split (LATE_FEE_SPLIT): how many were in and what each person in owes. Null otherwise. */
  feeSplit?: { count: number; priceCents: number } | null;
  /** Only for a game priced from its own game-length row ("Short games" on, a 1.5 hour game). Missing: a normal game at Settings > Money. */
  shortGame?: ShortGameInfo;
  /** Why the organizer canceled (up to 40 characters), or null. */
  cancelReason: string | null;
  state: SessionState;
  roster: AdminRosterEntry[];
  confirmedCount: number;
  waitlistCount: number;
  /** Other players only; the organizer is never counted. */
  paidCount: number;
  payableCount: number;
  /** The organizer's court row. Null when there is no court to pay for (canceled, or nobody in and not booked). */
  court: CourtDue | null;
  /** Organizer's private record of the court cost. Never sent to players. */
  courtCostCents: number | null;
  /** A canceled game the venue still charged for (answered Yes to "Were you charged?"): that amount counts as its court cost. */
  chargedCents: number | null;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** Moved from its usual time (rescheduled). */
  moved: boolean;
  /** The usual time it was moved from, when moved. */
  plannedStartsAt: string | null;
  /** A one-off game the organizer added, with its optional note. */
  extra: boolean;
  note: string | null;
  /** A canceled game the organizer removed from the player screen (server/hideGame.ts). Still shown on organizer screens. */
  hiddenFromPlayers?: boolean;
  /** "Money page rework": the organizer hid this game from their own Home and Money lists and from Totals (server/moneyRework.ts). */
  hiddenFromList?: boolean;
  /** Screen only, never sent by the server: a Finalize tap on this game is still saving (instant taps), so Money files it as finalized. */
  finalizing?: boolean;
  /** When the booking window opens (14 days before play by default). */
  bookingOpensAt: string;
  shownEarly: boolean;
  holiday: string | null;
  /** Organizer confirmed the venue keeps normal hours that day. */
  holidayHoursOk: boolean;
  /** Day-before and last-call cards are inside their windows (and not marked Done). */
  cards: { dayBefore: boolean; lastCall: boolean };
  /** The organizer finalized who played. `creditBackCents` is what finalizing gave back (not credit from drops before the game). */
  finalized: { at: string; playedCount: number; priceCents: number; creditBackCents: number; flatCents: number } | null;
  /** Over, not canceled, not finalized, and someone was in: shows the Finalize card. */
  needsFinalize: boolean;
  /** Reopen is blocked because some credit from this game was already used or refunded: who. */
  reopenBlockedBy: string[];
  /** Reopen waits because a pending refund request is holding credit from this game: who. */
  reopenRequestedBy: string[];
  eligibleSubstitutes: EligibleSubstitute[];
  /**
   * "Time may shift": the start time changed after someone in agreed to one. Everyone in counts (the organizer as
   * confirmed); `waiting` is who has not said Still in to the current time yet. Null otherwise, or with TIME_SHIFT off.
   */
  timeCheck: { confirmedCount: number; inCount: number; waiting: { playerId: string; name: string; phone: string | null; wasStartsAt: string }[] } | null;
}

export interface AdminPlayer {
  id: string;
  name: string;
  phone: string | null;
  isRegular: boolean;
  isActive: boolean;
  canReceiveSubstituteInvites: boolean;
  sortOrder: number;
  /** 2 = Tuesday, 4 = Thursday. */
  usualDays: number[];
  /** Added their own name and the organizer hasn't reviewed them yet. */
  isNew: boolean;
  /** Organizer only: saved Venmo username (or "id:123") for refunds. Never sent to players. */
  venmo: string | null;
  /** Organizer only: how many times they dropped out late. */
  lateDrops: number;
  /** Organizer only: sessions they've played, ever. */
  played: number;
  /** Admin screens round 2 only: the organizer hid this name from the Players list and pickers (nothing else about them changed). */
  adminHidden?: boolean;
  /** Admin screens round 3 only: money they have paid for games they played, ever, in cents (the Players page "$108 spent"). */
  spentCents?: number;
  /** Players redo (Zip 13) only: games played this month (the same rule as `played`), for the one-line rows. */
  monthPlayed?: number;
}

/** Players redo (Zip 13): a player's details sheet, month and All time (GET /api/admin/players/:id/summary). Organizer only. */
export interface PlayerSummary {
  month: { label: string; played: number; spentCents: number };
  allTime: { played: number; spentCents: number };
  /** This is the organizer: Spent is Money Totals "Your cost so far" (membership + court - what players paid). */
  organizer: boolean;
}

/** One line in History > Activity. */
export interface ActivityEntry {
  id: string;
  /** Who did it: a player's name, "organizer", or "organizer as Name". */
  actorLabel: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  /** The session it was about, if any. */
  sessionStartsAt: string | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /** More, older entries exist (ask with ?before=<oldest createdAt>). */
  more: boolean;
}

export interface AuditEntry {
  id: string;
  sessionId: string | null;
  actorLabel: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** A player's refund request, for the organizer's Home card. */
export interface RefundRequestView {
  id: string;
  playerId: string;
  name: string;
  cents: number;
  createdAt: string;
  /** Organizer only: the player's saved Venmo, so the Refund button is addressed. */
  venmo: string | null;
}

export interface AdminDashboard {
  /** Signed in with the read-only organizer PIN (server/viewOnly.ts): every save is refused. Missing for the real PIN. */
  viewOnly?: true;
  /** The MOTION_ADMIN switch (server/motion.ts): the organizer screens animate. Visual only; false or missing means they look exactly as before. */
  motion?: boolean;
  /** The "did anything change?" stamp this load was drawn from (see /api/admin/version). */
  version: string;
  /** The moved-game notice is on for this screen: Confirmed x of y, Waiting on, the Edit game note (server/timeShift.ts). */
  timeShift?: boolean;
  /** Settings > "Moved-game notice for everyone" is on. */
  timeShiftForAll?: boolean;
  /** Settings > "Ask for payment on every game" is on (for everyone). */
  payAlwaysForAll?: boolean;
  /** The new organizer layout (History, Money, Home v2) is on for this screen (server/adminV2.ts). False or missing: the screens look exactly as before. */
  adminV2?: boolean;
  /** Settings > Feature switches > "New admin layout" is on (for everyone). */
  adminV2ForAll?: boolean;
  /** "Admin screens, round 2" (Home cards, Money, Players, History, header) is on for this screen (server/adminR2.ts). False or missing: the screens look exactly as before. */
  adminR2?: boolean;
  /** Settings > Feature switches > "Admin screens, round 2" is on (for everyone). */
  adminR2ForAll?: boolean;
  /** "Admin screens, round 3" (Edit game, Add game, Settings clean-up, Players layout) is on for this screen (server/adminR3.ts); it also needs round 2 on. False or missing: the screens look exactly as before. */
  adminR3?: boolean;
  /** Settings > Feature switches > "Admin screens, round 3" is on (for everyone). */
  adminR3ForAll?: boolean;
  /** "Late drops owe $14" is on for this screen (server/lateFees.ts): the cancel question asks "Did the venue waive the fee?". */
  lateFees?: boolean;
  /** Settings > Feature switches > "Late drops owe $14" is on (for everyone). */
  lateFeesForAll?: boolean;
  /** "Texts and alerts, round 2" is on for this screen (server/textsR2.ts): the new wording of the prefilled texts, no recipients on the check-in, the cancel sheet answering No. False or missing: everything reads and works as before. */
  textsR2?: boolean;
  /** Settings > Feature switches > "Texts and alerts, round 2" is on (for everyone). */
  textsR2ForAll?: boolean;
  /** "Late-cancel fee split" for this screen (server/lateFeeSplit.ts; the switch alone: it also needs lateFees). Missing: off. */
  lateFeeSplit?: boolean;
  /** "Late-cancel fee split" is on for everyone (Settings > Feature switches). */
  lateFeeSplitForAll?: boolean;
  /** "Money page rework" is on for this screen (server/moneyRework.ts). False or missing: every screen looks and works exactly as before. */
  moneyRework?: boolean;
  /** Settings > Feature switches > "Money page rework" is on (for everyone). */
  moneyReworkForAll?: boolean;
  /** "Instant taps" is on for this screen (server/instantTaps.ts). Missing: every tap works exactly as before. */
  instantTaps?: boolean;
  /** Settings > Feature switches > "Instant taps" is on (for everyone). */
  instantTapsForAll?: boolean;
  /** "Adjust credit" is on for this screen (server/adjustCredit.ts). Missing: the Players sheet has no Adjust credit row. */
  adjustCredit?: boolean;
  /** Settings > Feature switches > "Adjust credit" is on (for everyone). */
  adjustCreditForAll?: boolean;
  /** Settings > Feature switches > "Home collapse" is on (for everyone). */
  homeCollapseForAll?: boolean;
  /** "Last call texts" is on for this screen (server/lastCall.ts): the Check-in and Need players words follow Alex's last call rules. Missing: the words are exactly as before. */
  lastCallTexts?: boolean;
  /** Settings > Feature switches > "Last call texts" is on (for everyone). */
  lastCallTextsForAll?: boolean;
  /** "Tonight glow" is on for this screen / Settings > Feature switches > "Tonight glow" is on (for everyone). */
  tonightGlow?: boolean;
  tonightGlowForAll?: boolean;
  /** "Color cleanup" is on for this screen / Settings row is on (for everyone). */
  colorCleanup?: boolean;
  colorCleanupForAll?: boolean;
  /** "Simpler player cards" is on for this screen / Settings row is on (for everyone). */
  playerCardsSimple?: boolean;
  playerCardsSimpleForAll?: boolean;
  /** "Short games" is on for this screen (server/zip9.ts): 1.5 hour games are priced from their row, the heads-up and tag show. Missing: exactly as before. */
  shortGames?: boolean;
  /** Settings > Feature switches > "Short games" is on (for everyone). */
  shortGamesForAll?: boolean;
  /** "Card time and buttons" is on for this screen / Settings row is on (for everyone). Player cards only. */
  cardTimeButtons?: boolean;
  cardTimeButtonsForAll?: boolean;
  /** "Card cleanup" is on for this screen (server/zip10.ts): new card look, no waitlist, no Max players cap. Missing: exactly as before. */
  cardCleanup?: boolean;
  /** Settings > Feature switches > "Card cleanup" is on (for everyone). */
  cardCleanupForAll?: boolean;
  /** "Alert cards" is on for this screen (server/zip11.ts) / Settings row is on (for everyone). Display only. */
  alertCards?: boolean;
  alertCardsForAll?: boolean;
  /** Zip 12: Settings > Feature switches > "Fewer database trips", "Load games at once", "Show last screen at once" (for everyone). */
  speedFewerQueriesForAll?: boolean;
  speedDirectLoadForAll?: boolean;
  speedLastScreenForAll?: boolean;
  /** Zip 12 step C "Instant admin" is on for this organizer phone (server/speed.ts): it keeps a copy of this answer (src/lastAdmin.ts). Missing: nothing kept, an old copy thrown away. */
  lastScreenAdmin?: boolean;
  /** Settings > Feature switches > "Instant admin" is on (for everyone). */
  speedLastScreenAdminForAll?: boolean;
  /** "Seat dots" is on for this screen / Settings row is on (for everyone). Display only. */
  seatDots?: boolean;
  seatDotsForAll?: boolean;
  /** Zip 13 (shared/zip13.ts), each only while on (off: the answer is exactly as before). The Players redo, its Settings row. */
  playersRedo?: true;
  playersRedoForAll?: true;
  /** With the Players redo on: the month the list counts "played" for ("NOV 2026"). */
  playersRedoMonth?: string;
  /** Swap to Alex: the title swap and Go to Admin, and its Settings row. */
  swapButton?: true;
  swapButtonForAll?: true;
  /** Undo on admin toasts (5 seconds, the save waits), and its Settings row. */
  adminUndo?: true;
  adminUndoForAll?: true;
  /** Zip 14 "Game day card" (shared/gameDay.ts), only while on (off: the answer is exactly as before): the Court row and map on Add game and
   *  Edit game, and the game's court on each AdminSessionView; and its Settings row. */
  gameDayCard?: true;
  gameDayCardForAll?: true;
  /** Zip 16 "After-game cards" (shared/afterGame.ts): its Settings row. */
  afterGameCardForAll?: true;
  /** Zip 15 "Second Chance" (shared/secondChance.ts), only while on (off: the answer is exactly as before): the Home cards, the Request
   *  buttons and the Edit sheet wording; and its Settings row. */
  secondChance?: {
    /** "Now" for these features (the real clock; a preview phone with ?noontest=on: noon on game day). */
    now: string;
    cards: import('./secondChance').ScCard[];
    /** Preview only: the Telegrams are a visible fake, shown on Home. */
    preview?: true;
    fakeTelegrams?: { at: string; sessionId: string; text: string }[];
    pretendNoon?: true;
  };
  secondChanceForAll?: true;
  /** Zip 17: Settings > Feature switches > "Unpaid nudge" is on for everyone. */
  unpaidNudgeForAll?: true;
  /** Preview only (shared/previewCalm.ts): admin Home shows only this zip's cards (?alerts=all shows every one). Never on live. */
  previewCalm?: true;
  /** "Venmo request" is on for this screen (server/venmoRequest.ts). Missing: no request links anywhere. */
  venmoRequest?: boolean;
  /** Settings > Feature switches > "Venmo request" is on (for everyone). */
  venmoRequestForAll?: boolean;
  /** Settings > Feature switches > "Animations, players": the effective state for everyone (wrangler.toml MOTION, changed by the row). */
  motionPlayersForAll?: boolean;
  /** Settings > Feature switches > "Animations, organizer": the effective state for everyone (wrangler.toml MOTION_ADMIN, changed by the row). */
  motionAdminForAll?: boolean;
  /** Settings > Feature switches > "No Venmo? note" is on (for everyone). */
  payNoteForAll?: boolean;
  /** Settings > Feature switches > "Player screen fixes" is on (for everyone). */
  playerFix1ForAll?: boolean;
  /** Settings > Feature switches > "Pay sheet" is on (for everyone). */
  paySheetForAll?: boolean;
  group: {
    name: string;
    timezone: string;
    venmoUrl: string | null;
    organizerName: string | null;
    venueName: string | null;
    venueAddress: string | null;
    /** Settings > Money: the Apple Pay / Zelle number on the Pay sheet ("" = none shown). */
    zelleNumber?: string;
    firstSessionDate: string | null;
    settings: GroupSettings;
    /** What to send players: the plain site address when open, else the private link. */
    playerLink: string;
    /** The long private link; always works. */
    privateLink: string;
    openAccess: boolean;
    hasGroupWord: boolean;
  };
  players: AdminPlayer[];
  sessions: AdminSessionView[];
  audit: AuditEntry[];
  /** Upcoming sessions hidden by the first session date, which the organizer can show. */
  hiddenSessions: { id: string; startsAt: string; endsAt: string }[];
  /** "Money page rework" only: the games the organizer hid from their own lists (Settings > Advanced > Hidden games, each with Restore). */
  hiddenGames?: { id: string; startsAt: string; label: string }[];
  /** "Money page rework" only: how many games Money lists in each month ("2026-11": 12), every month back to the first game. */
  gameMonthCounts?: Record<string, number>;
  /**
   * The credit pot per player who has any history: `balanceCents` is the pot, `reservedCents` is held
   * for a pending refund request, `refundCents` is what "Refund credit balance" pays back now, and every entry, oldest first.
   */
  creditLedger: { playerId: string; balanceCents: number; reservedCents: number; refundCents: number; entries: CreditEntryView[] }[];
  /** Refund requests waiting on the organizer, oldest first. */
  refundRequests: RefundRequestView[];
  /** Unconfirmed "I paid" on a seat that left or a canceled game: the organizer decides (shared/credit.ts isPaymentClaim). */
  paymentClaims: { sessionId: string; startsAt: string; playerId: string; name: string; cents: number; why: 'dropped' | 'canceled' | 'not_played' }[];
  /** The organizer's own player record, once they have one (their name from Settings). */
  me: { id: string; name: string } | null;
  /** "Do this now" taps saved on the server, as "sessionId:mark". */
  taskMarks: string[];
  /** When each court was marked booked on the site, by session id (games booked before Nov 2026 have none). */
  courtBookedAt: Record<string, string>;
  /** Settings > Alerts: the switches and whether Telegram is set up. Never the token or chat ID. */
  alerts: {
    enabled: boolean;
    drop36: boolean;
    belowMin: boolean;
    reachedMin: boolean;
    refundRequests: boolean;
    /** Settings > Alerts > Smart alerts: the "Do this now" Telegram messages. */
    smartAlerts: boolean;
    connected: boolean;
    lastAt: string | null;
    lastOk: boolean | null;
    lastError: string | null;
  };
  now: string;
}

export interface ActionLinkDraft {
  playerId: string;
  name: string;
  phone: string | null;
  url: string;
}

export interface ActionTokenView {
  scope: 'attendance' | 'claim';
  playerName: string;
  timezone: string;
  session: { id: string; startsAt: string; endsAt: string; canceled: boolean; venueName: string | null; openSpots: number };
  myStatus: RosterStatus | null;
  attendanceConfirmed: boolean;
  valid: boolean;
  invalidReason: string | null;
}

/** The organizer's private monthly money page. Never sent to players. */
export interface MonthlyMoney {
  /** "2026-11" */
  month: string;
  /** "November 2026" */
  label: string;
  /** What the other players paid and the group kept, for finalized games this month. The organizer's own payment to the venue is never in here. */
  collectedCents: number;
  /** The full court cost of every session played. */
  courtCostCents: number;
  /** Credit still owed to players from this month's games (money that came back as credit and is not yet used or refunded). */
  creditsOwedCents: number;
  /** Paid by other players for games not finalized yet. Not in Collected until finalized. */
  heldCents: number;
  /** Collected minus court costs. Credit owed is money that was never collected, so it is not taken off. */
  netCents: number;
  /** Players paid more than the courts cost: the amount toward the membership. */
  surplusCents: number;
  /** Players paid less than the courts cost: what the organizer covered. */
  coveredCents: number;
  membershipCents: number;
  /** "Surplus: $14 toward the $30 membership" or "You covered $8 of the court costs" */
  bottomLine: string;
  sessions: {
    id: string;
    startsAt: string;
    endsAt: string;
    /**
     * played: finalized and counted. not_finalized: over, money still held. canceled / upcoming / not_played:
     * shown but not counted (a canceled game the venue charged for still counts its court cost).
     */
    state: 'played' | 'not_finalized' | 'canceled' | 'upcoming' | 'not_played';
    /** A canceled game the venue still charged for. */
    charged: boolean;
    collectedCents: number;
    courtCostCents: number;
    /** No cost entered on the session, so the typical cost was used. */
    typicalCost: boolean;
    /** Once finalized: how many played and the final price each. */
    playedCount: number | null;
    priceCents: number | null;
  }[];
  /**
   * "Money page rework" only (server/money.ts): the two cards on the Totals tab. "So far" counts a game only once it is finalized, plus
   * canceled games the venue charged (`courtSessions` is that many courts); "projected" adds the booked games still coming up (and played games
   * not finalized yet) and assumes 3 players pay the usual price for EVERY court (finalized or not). Your cost is what is left after the
   * players' share, never below $0, split into the court part and the membership part.
   */
  rework?: {
    courtSessions: number;
    courtCostCents: number;
    membershipCents: number;
    owedToVenueCents: number;
    collectedCents: number;
    yourCostCents: number;
    yourCostCourtCents: number;
    yourCostMembershipCents: number;
    projected: {
      courtCount: number;
      addedCourts: number;
      courtCostCents: number;
      membershipCents: number;
      totalCents: number;
      playersPayCents: number;
      yourCostCents: number;
      yourCostCourtCents: number;
      yourCostMembershipCents: number;
    };
  };
}
