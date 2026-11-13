import { readOnlyPin, viewOnlyCookie } from './viewOnly';
import { lastCallFor, lastCallForAll, setLastCallForAll } from './lastCall';
import { backupObject } from './backupData';
import { alertsView } from './alerts';
import type { ActionLinkDraft, ActivityPage, AdminDashboard, AuditEntry } from '../shared/api';
import { formatCents, formatPrice } from '../shared/money';
import { usableFor } from './creditActions';
import { DEFAULT_VENUE_NAME, normalizeSettings, zelleNumberOf } from '../shared/settings';
import { openSpots } from '../shared/spots';
import { MONEY_STATE, reopenBlockers, reopenBlockersRead, sqlText } from './finalize';
import { directLoadForAll, fewerDb, fewerQueriesForAll, lastScreenAdminFlags, lastScreenForAll, setDirectLoadForAll, setFewerQueriesForAll, setLastScreenAdminForAll, setLastScreenForAll } from './speed';
import { pendingRequestViews } from './creditActions';
import { formatDateTime, formatShortDate, formatTimeRange, localParts, zonedTimeToUtc } from '../shared/time';
import { adminLogin, adminLogout, hashGroupWord, requireAdmin, revokeAdminSessions, startAdminSession } from './auth';
import { ADMIN_COOKIE, clearCookie, type Ctx } from './context';
import { hashPin, newId, randomToken, verifyPin } from './crypto';
import { motionAdminFor, motionForAll, motionSettingRead, setMotionForAll } from './motion';
import { adjustCreditFor, adjustCreditForAll, setAdjustCreditForAll } from './adjustCredit';
import { homeCollapseForAll, setHomeCollapseForAll } from './homeCollapse';
import { colorCleanupFor, colorCleanupForAll, playerCardsFor, playerCardsForAll, setColorCleanupForAll, setPlayerCardsForAll, setTonightGlowForAll, tonightGlowFor, tonightGlowForAll } from './zip7';
import { setVenmoRequestForAll, venmoRequestFor, venmoRequestForAll } from './venmoRequest';
import { adjustReasonColumn, cleanReason, planAdjust, signedPrice } from '../shared/adjustCredit';
import { setTimeShiftForAll, timeShiftFor, timeShiftForAll } from './timeShift';
import { setPayAlwaysForAll, payAlwaysForAll } from './payAlways';
import { adminV2For, adminV2ForAll, setAdminV2ForAll } from './adminV2';
import { adminHiddenPlayerIds, adminR2For, adminR2ForAll, setAdminHiddenPlayer, setAdminR2ForAll } from './adminR2';
import { adminR2Allowed } from '../shared/adminR2';
import { adminR3For, adminR3ForAll, setAdminR3ForAll, spentByPlayer } from './adminR3';
import { payNoteForAll, setPayNoteForAll } from './payNote';
import { playerFix1ForAll, setPlayerFix1ForAll } from './playerFix1';
import { setTextsR2ForAll, textsR2For, textsR2ForAll } from './textsR2';
import { paySheetForAll, setPaySheetForAll } from './paySheet';
import { finishLateDropClear, lateFeesFor, lateFeesForAll, OPEN_FEE, OPEN_LATE_DROP, setLateFeesForAll } from './lateFees';
import { FEE_KEPT, feeSplitOf, feeSplitPrice, lateFeeKind, lateFeePriceCents, type LateFeeClearWhy } from '../shared/lateFees';
import { lateFeeSplitFor, lateFeeSplitForAll, lateFeeSplitSwitch, setLateFeeSplitForAll } from './lateFeeSplit';
import { hiddenGameIds, hiddenGameIdsRead, setHiddenFromPlayers } from './hideGame';
import { instantTapsFor, instantTapsForAll, setInstantTapsForAll } from './instantTaps';
import { adminHiddenGameIds, moneyReworkFor, moneyReworkForAll, sessionHasMoney, setAdminHiddenGame, setMoneyReworkForAll } from './moneyRework';
import { HAS_MONEY_MESSAGE } from '../shared/moneyRework';
import { HttpError } from './http';
import type { D1PreparedStatement } from './db';
import {
  audit,
  confirmedOf,
  courtCostOf,
  defaultDeadline,
  ensureSessions,
  getPlayers,
  getSession,
  type GroupRow,
  loadRoster,
  rosterRead,
  organizerIdRead,
  playersRead,
  type ReadSpec,
  sessionStartsRead,
  loadRosters,
  loadSessions,
  type RosterRow,
  type SessionRow,
  settingsOf,
  sharesFor,
  loadCancelCharges,
  loadHiddenSessions,
  organizerIdOf,
  visibleFrom,
} from './repo';
import { type CreditEntryView } from '../shared/api';
import { balanceAfterEntry, CHARGE_ASK_HOURS, isPaymentClaim, moneySeen, potBalance, seatCredit, usableCredit, visibleEntries } from '../shared/credit';
import { adjustCreditEntry, holdShortCashStatements, creditBackLeft, loadLedger, creditBackStatements, repriceStatements, splitSeatStatements, type SplitSeat, unsplitStatements, creditReturnedAt, hasPendingRequest, moneyBackAt, moneyPicture, returnSeatCredit, returnSeatCreditStatements, seatMoneyBackStatements, undoFinalizedBackStatements, moneyPictureFirstReads, pendingRequestsRead } from './credit';
import { auditLateFeeOwed, clearLateDrop, confirmAttendance, joinSession, moveToWaitlist, recordLateDrop, setCourtPaid, settle, withdraw } from './roster';
import { invalidateSessionTokens, issueToken } from './tokens';
import { adminPlayerView, adminSessionView, eligibleSubstitutes } from './views';
import * as v from './validate';
import { loadMarks, recordCourtBooked, resetTasksForNewDay } from './tasks';
import { adminChangeStamp } from './stamp';
import { courtSwitchOf, isCourtWaitlist } from '../shared/court';
import { everyoneSettingsOf, flatOf, lockFinalizedGames, PRICE_LOCK_TASK, priceLockCol, priceOf, specialFlatOf } from './repo';
import { cardTimeFor, cardTimeForAll, setCardTimeForAll, setShortGamesForAll, shortGamesForAll } from './zip9';
import { zip9Allowed } from '../shared/zip9';
import { gameMinutes, isShortGame, LONG_MINUTES } from '../shared/gameLength';
import { bookingHoursAllowed } from '../shared/bookingHours';
import { cardCleanupForAll, cardCleanupLook, setCardCleanupForAll } from './zip10';
import { alertCardsFor, alertCardsForAll, setAlertCardsForAll } from './zip11';
import { seatDotsFor, seatDotsForAll, setSeatDotsForAll } from './seatDots';
import { gameDayCardFlags, gameDayCardFor, setGameDayCardForAll } from './gameDay';
import { setUnpaidNudgeForAll, unpaidNudgeForAll } from './unpaidNudge';
import { extRideOn } from './player';
import { adminExtensionPayment, markSharesWithSeat, undoSharesWithSeat, extendedTimeFor, extendedTimeForAll, extRowsOf, followSeat, hasViaShares, setExtendedTimeForAll, unmarkBlockedBy } from './extension';
import { errorAlertsForAll, switchErrorAlerts } from './errorAlerts';
import { afterGameCardForAll, setAfterGameCardForAll } from './afterGame';
import { homeScreenTipForAll, setHomeScreenTipForAll } from './homeScreenTip';
import { christmasSkinForAll, setChristmasSkinForAll } from './christmasSkin';
import { gameDayTextForAll, setGameDayTextForAll } from './gameDayText';
import { setTotalsRefreshForAll, totalsRefreshFlags } from './totalsRefresh';
import { setSpentTotalsForAll, spentTotalsFlags } from './spentTotals';
import { cheaperFixFlags, cheaperFixFor, setCheaperFixForAll } from './cheaperFix';
import { actingOthersFlags, actingOthersPicture, setActingOthersForAll } from './actingForOthers';
import { playersSheetRedoFlags, setPlayersSheetRedoForAll } from './playersSheetRedo';
import { checkInPayFlags, setCheckInPayForAll } from './checkInPay';
import { setTapGuardFixForAll, tapGuardFixFlags } from './tapGuardFix';
import { phoneTagOf } from './phoneTag';
import { fromNote } from '../shared/actingForOthers';
import { bookingHoursFlags, bookingHoursForAll, enforceBookingHours, enforceUsualTime, setBookingHoursForAll } from './bookingHours';
import { previewCalmFor, secondChanceAction, secondChanceFlags, secondChanceView, setSecondChanceForAll } from './secondChance';
import { courtOrNull } from '../shared/gameDay';
import { setZip13ForAll, zip13Flags } from './zip13';
import { monthPlayedCounts } from './playersRedo';
import type { Zip13Switch } from '../shared/zip13';
import { DB_LIMIT_MESSAGE, zip10Allowed } from '../shared/zip10';
import { capOf } from '../shared/settings';

export async function login(ctx: Ctx, body: Record<string, unknown>) {
  if (typeof body.pin !== 'string' || body.pin.length > 20) throw new HttpError(401, 'wrong_pin', 'That PIN is not right.');
  await adminLogin(ctx, body.pin);
  return { ok: true };
}

export async function logout(ctx: Ctx) {
  await adminLogout(ctx);
  clearCookie(ctx, ADMIN_COOKIE);
  return { ok: true };
}

/** GET /api/admin/version: the tiny "did anything change?" answer an open organizer screen asks every few seconds. */
export async function adminVersion(ctx: Ctx): Promise<Response> {
  const group = await requireAdmin(ctx);
  return new Response(JSON.stringify({ v: await adminChangeStamp(ctx, group) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const recentAuditRead = (groupId: string): ReadSpec => ({ sql: 'SELECT * FROM admin_audit_log WHERE group_id = ? ORDER BY created_at DESC LIMIT 60', values: [groupId] });
const lateDropsRead = (groupId: string): ReadSpec => ({
  sql: `SELECT sp.player_id AS id, COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND sp.late_drop_at IS NOT NULL GROUP BY sp.player_id`,
  values: [groupId],
});
const playedCountRead = (groupId: string, nowIso: string): ReadSpec => ({
  sql: `SELECT sp.player_id AS id, COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE s.group_id = ? AND sp.status = 'confirmed' AND s.status <> 'canceled' AND s.ends_at <= ? AND (sp.played IS NULL OR sp.played = 1) GROUP BY sp.player_id`,
  values: [groupId, nowIso],
});

export async function dashboard(ctx: Ctx): Promise<AdminDashboard> {
  const group = await requireAdmin(ctx);
  // Taken before the data is read, so a change in between shows up as a newer stamp on the next check.
  const version = await adminChangeStamp(ctx, group);
  await ensureSessions(ctx.db, group, ctx.nowMs);
  // SPEED_FEWER_QUERIES (server/speed.ts): the reads below that do not depend on each other, in ONE trip (nothing when it is off).
  await fewerDb(ctx)?.prefetch([
    { kind: 'all', ...playersRead(group.id) },
    ...moneyPictureFirstReads(group, ctx.nowMs),
    ...(group.organizer_player_id ? [{ kind: 'first' as const, ...organizerIdRead(group) }] : []),
    { kind: 'all', ...hiddenGameIdsRead(group.id) },
    { kind: 'all', ...sessionStartsRead(group.id) },
    { kind: 'all', ...recentAuditRead(group.id) },
    { kind: 'all', ...lateDropsRead(group.id) },
    { kind: 'all', ...playedCountRead(group.id, ctx.nowIso) },
    // Asked again further down: the cash out requests, and the motion rows (organizer once, player twice).
    { kind: 'all', ...pendingRequestsRead(group.id) },
    { kind: 'first', ...motionSettingRead(group.id, 'admin') },
    { kind: 'first', ...motionSettingRead(group.id, 'player') },
    { kind: 'first', ...motionSettingRead(group.id, 'player') },
  ]);
  const settings = settingsOf(group);
  const players = await getPlayers(ctx.db, group.id);
  const { sessions, rosters, ledger, reserved } = await moneyPictureOf(ctx, group);
  const organizerId = await organizerIdOf(ctx.db, group);
  const timeShift = await timeShiftFor(ctx, group.id);
  // "Admin screens, round 2": on for this screen, and the names the organizer hid from the Players list and pickers (only read when on).
  const adminR2 = await adminR2For(ctx, group.id);
  const hiddenByOrganizer = adminR2 ? await adminHiddenPlayerIds(ctx.db, group.id) : new Set<string>();
  // "Admin screens, round 3": on for this screen. Only then is each player's "spent" worked out (read only, for the Players page).
  const adminR3 = await adminR3For(ctx, group.id);
  // Zip 27 "Spent matches Totals" (server/spentTotals.ts): Players "Spent" counted the way Totals counts, only while on (off: this answer is exactly main's).
  const spentMatch = await spentTotalsFlags(ctx, group.id);
  // Zip 39 "Made cheaper after paying" (server/cheaperFix.ts): only its Settings row shows here (off: this answer is exactly main's).
  const cheaper = await cheaperFixFlags(ctx, group.id);
  const spent = adminR3 ? await spentByPlayer(ctx.db, group.id, organizerId, undefined, spentMatch.on).catch(() => new Map<string, number>()) : new Map<string, number>();
  // Each seat's part of the credit pot: credit used on it, cash paid toward it earlier, and what came back from it.
  const potFor = (sessionId: string) => (r: RosterRow) =>
    seatCredit(ledger, sessionId, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
  const charges = await loadCancelCharges(ctx.db, group.id);
  const hiddenIds = await hiddenGameIds(ctx.db, group.id);
  // "Money page rework": on for this screen, and the games the organizer hid from their own lists (only read when on).
  const moneyRework = await moneyReworkFor(ctx, group.id);
  // Money is never hidden: a game marked hidden that has money in it (before or since) stays in the lists and Totals.
  const creditSessionIds = new Set(ledger.map((e) => e.sessionId).filter((x): x is string => !!x));
  const markedHidden = moneyRework ? await adminHiddenGameIds(ctx.db, group.id) : new Set<string>();
  const listHidden = new Set(
    [...markedHidden].filter((id) => {
      const row = sessions.find((s) => s.id === id);
      return row ? !sessionHasMoney(row, rosters.get(id) ?? [], creditSessionIds, charges) : true;
    }),
  );
  const starts = sessionStartsRead(group.id);
  const startsOf = new Map((await ctx.db.prepare(starts.sql).bind(...starts.values).all<{ id: string; starts_at: string }>()).results.map((r) => [r.id, r.starts_at]));
  const creditLedger = [...new Set(ledger.map((e) => e.playerId))]
    .map((playerId) => {
      const balanceCents = potBalance(ledger, playerId);
      const reservedCents = reserved.get(playerId) ?? 0;
      return {
        playerId,
        balanceCents,
        reservedCents,
        refundCents: usableCredit(balanceCents, reservedCents),
        entries: visibleEntries(ledger)
          .filter((e) => e.playerId === playerId)
          .map(
            (e): CreditEntryView => ({
              id: e.id,
              kind: e.kind,
              cents: e.cents,
              sessionId: e.sessionId,
              sessionStartsAt: e.sessionId ? (startsOf.get(e.sessionId) ?? null) : e.extSessionId ? (startsOf.get(e.extSessionId) ?? null) : null,
              at: e.createdAt,
              endedAt: e.endedAt,
              endedReason: e.endedReason as CreditEntryView['endedReason'],
              reason: e.reason ?? null,
              playedCount: e.playedCount ?? null,
              ...(e.reason === 'adjusted' ? { note: e.note ?? '', balanceAfterCents: balanceAfterEntry(ledger, e.id) } : {}),
            }),
          ),
      };
    })
    .filter((p) => p.playerId !== organizerId);
  const blockers = new Map<string, { spent: string[]; requested: string[] }>();
  // SPEED_FEWER_QUERIES (server/speed.ts): one trip for every finalized game's check instead of one each (nothing when it is off).
  await fewerDb(ctx)?.prefetch(sessions.filter((s) => s.finalized_at).map((s) => ({ kind: 'all' as const, ...reopenBlockersRead(s.id) })));
  for (const s of sessions) if (s.finalized_at) blockers.set(s.id, await reopenBlockers(ctx, s.id));
  const recent = recentAuditRead(group.id);
  const { results: auditRows } = await ctx.db
    .prepare(recent.sql)
    .bind(...recent.values)
    .all<{ id: string; session_id: string | null; actor_label: string; action: string; details_json: string; created_at: string }>();
  const auditEntries: AuditEntry[] = auditRows.map((a) => ({
    id: a.id,
    sessionId: a.session_id,
    actorLabel: a.actor_label,
    action: a.action,
    details: safeParse(a.details_json),
    createdAt: a.created_at,
  }));
  // Late drops per person, ever. Organizer only.
  const late = lateDropsRead(group.id);
  const lateRows = await ctx.db
    .prepare(late.sql)
    .bind(...late.values)
    .all<{ id: string; n: number }>();
  const lateDrops = new Map(lateRows.results.map((r) => [r.id, Number(r.n)]));
  // Sessions each person has played, ever: in, not canceled, over, and not marked "did not play" at finalize.
  const playedQ = playedCountRead(group.id, ctx.nowIso);
  const playedRows = await ctx.db
    .prepare(playedQ.sql)
    .bind(...playedQ.values)
    .all<{ id: string; n: number }>();
  const played = new Map(playedRows.results.map((r) => [r.id, Number(r.n)]));
  // Zip 13 (server/zip13.ts): each flag only while on, so with all three off this answer is exactly main's.
  const redo = await zip13Flags(ctx, group.id, 'playersRedo');
  // Zip 23 "Totals refresh" (server/totalsRefresh.ts): the new Totals look, only while on (off: this answer is exactly main's).
  const totals = await totalsRefreshFlags(ctx, group.id);
  // Zip 32 "Players sheet redo" (server/playersSheetRedo.ts): the new Players sheet look, only while on (off: this answer is exactly main's).
  const playersSheet = await playersSheetRedoFlags(ctx, group.id);
  // Zip 34 "Check-in pay line" (server/checkInPay.ts): a pay line in the Check-in text, only while on (off: this answer is exactly main's).
  const checkInPay = await checkInPayFlags(ctx, group.id);
  // Zip 35 "Tap guard fix" (server/tapGuardFix.ts): which fast tap the page ignores, only while on (off: this answer is exactly main's).
  const tapGuard = await tapGuardFixFlags(ctx, group.id);
  // Zip 30 "Acting for others" (server/actingForOthers.ts): the Home card's rows, only while on (off: this answer is exactly main's and the
  // phone-code read never runs). Organizer only; the organizer's own player name is never flagged.
  const acting = await actingOthersFlags(ctx, group.id);
  const actingRows = acting.on
    ? (await actingOthersPicture(ctx.db, group.id, ctx.nowMs, [group.organizer_name, players.find((p) => p.id === organizerId)?.display_name])).rows
    : null;
  // Zip 24 "Booking hours" (server/bookingHours.ts): the tap-to-pick times and the hours rule, only while on (off: this answer is exactly main's).
  const hours = await bookingHoursFlags(ctx, group.id);
  const swap = await zip13Flags(ctx, group.id, 'swapButton');
  const undo = await zip13Flags(ctx, group.id, 'adminUndo');
  // Zip 14 (server/gameDay.ts): the Court row and each game's court, only while on (off: this answer is exactly main's).
  const gameDay = await gameDayCardFlags(ctx, group.id);
  const month = redo.on ? await monthPlayedCounts(ctx, group) : null;
  const sessionViews = sessions.map((s) => ({
    ...adminSessionView(s, rosters.get(s.id) ?? [], players, ctx.nowMs, settings, group.timezone, organizerId, potFor(s.id), s.status === 'canceled' ? (charges.get(s.id) ?? null) : null, blockers.get(s.id) ?? { spent: [], requested: [] }, timeShift),
    hiddenFromPlayers: hiddenIds.has(s.id),
    ...(moneyRework && listHidden.has(s.id) ? { hiddenFromList: true } : {}),
    ...(gameDay.on && courtOrNull(s.court) !== null ? { courtNum: courtOrNull(s.court)! } : {}),
  }));
  // Zip 15 (server/secondChance.ts): the Home cards, only while on (off: this answer is exactly main's).
  const secondChance = await secondChanceFlags(ctx, group.id);
  // Zip 31 "Extended time": while on, the game each player's extra time rides on (the same rule as their own screen, server/player.ts
  // extRideOn), so the organizer's row for that game shows "$17 (incl. $3 extension)" and its Mark paid takes both. From the rows loaded above.
  const extOnSeats = (await extendedTimeFor(ctx, group.id)) ? extRideOnSeats(sessions, rosters, ledger, reserved, settings, group.timezone, ctx.nowMs, timeShift, await lateFeesFor(ctx, group.id)) : null;
  return {
    // Signed in with the read-only PIN (server/viewOnly.ts): the screens show "View only". Absent for the real PIN, so its answer is unchanged.
    ...(viewOnlyCookie(ctx) ? { viewOnly: true as const } : {}),
    group: {
      name: group.name,
      timezone: group.timezone,
      venmoUrl: group.venmo_url,
      organizerName: group.organizer_name,
      venueName: group.venue_name,
      venueAddress: group.venue_address,
      zelleNumber: zelleNumberOf(group.settings_json),
      firstSessionDate: group.first_session_date,
      settings,
      playerLink: playerLinkFor(ctx, group),
      privateLink: `${ctx.url.origin}/g/${group.group_key}`,
      openAccess: !!group.open_access,
      hasGroupWord: !!group.group_word_hash,
    },
    players: players.map((p) => ({ ...adminPlayerView(p), lateDrops: lateDrops.get(p.id) ?? 0, played: played.get(p.id) ?? 0, ...(adminR3 ? { spentCents: spent.get(p.id) ?? 0 } : {}), ...(adminR2 && hiddenByOrganizer.has(p.id) ? { adminHidden: true } : {}), ...(month ? { monthPlayed: month.counts.get(p.id) ?? 0 } : {}) })),
    sessions: extOnSeats ? withExtOnSeats(sessionViews, extOnSeats) : sessionViews,
    audit: auditEntries,
    hiddenSessions: (await loadHiddenSessions(ctx.db, group, ctx.nowMs)).map((h) => ({ id: h.id, startsAt: h.starts_at, endsAt: h.ends_at })),
    creditLedger,
    refundRequests: await pendingRequestViews(ctx, group),
    paymentClaims: sessions.flatMap((s) =>
      (rosters.get(s.id) ?? [])
        .filter((r) =>
          isPaymentClaim(
            {
              status: r.status,
              paymentStatus: r.payment_status,
              selfPaid: !!r.self_paid_at,
              refundedAt: r.refunded_at,
              isOrganizer: r.player_id === organizerId,
              played: s.finalized_at && r.played === 0 ? false : null,
            },
            s.status === 'canceled',
          ) && !lateFeeKind(r, s),
        )
        .map((r) => {
          // What they said they sent: the payment minus credit (and cash held) already on the seat.
          const seat = seatCredit(ledger, s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
          const cents = Math.max(0, (r.payment_amount_cents ?? 0) - seat.usedCents - seat.cashCents);
          const why = s.status === 'canceled' ? ('canceled' as const) : r.status === 'confirmed' ? ('not_played' as const) : ('dropped' as const);
          return { sessionId: s.id, startsAt: s.starts_at, playerId: r.player_id, name: r.display_name, cents, why };
        }),
    ),
    me: await organizerPlayer(ctx, group, false),
    ...(await loadMarks(ctx.db, group.id, ctx.nowMs).then((m) => ({ taskMarks: m.marks, courtBookedAt: m.courtBookedAt }))),
    alerts: await alertsView(ctx, group.id),
    now: ctx.nowIso,
    version,
    timeShift,
    timeShiftForAll: await timeShiftForAll(ctx.db, group.id),
    motion: await motionAdminFor(ctx, group.id),
    motionPlayersForAll: await motionForAll(ctx, group.id, 'player'),
    motionAdminForAll: await motionForAll(ctx, group.id, 'admin'),
    payAlwaysForAll: await payAlwaysForAll(ctx.db, group.id),
    adminV2: await adminV2For(ctx, group.id),
    payNoteForAll: await payNoteForAll(ctx.db, group.id),
    playerFix1ForAll: await playerFix1ForAll(ctx.db, group.id),
    paySheetForAll: await paySheetForAll(ctx.db, group.id),
    adminV2ForAll: await adminV2ForAll(ctx.db, group.id),
    adminR2,
    adminR2ForAll: await adminR2ForAll(ctx.db, group.id),
    adminR3,
    adminR3ForAll: await adminR3ForAll(ctx.db, group.id),
    lateFees: await lateFeesFor(ctx, group.id),
    lateFeesForAll: await lateFeesForAll(ctx.db, group.id),
    textsR2: await textsR2For(ctx, group.id),
    textsR2ForAll: await textsR2ForAll(ctx.db, group.id),
    lateFeeSplit: await lateFeeSplitSwitch(ctx, group.id),
    lateFeeSplitForAll: await lateFeeSplitForAll(ctx.db, group.id),
    moneyRework,
    moneyReworkForAll: await moneyReworkForAll(ctx.db, group.id),
    ...((await instantTapsFor(ctx, group.id)) ? { instantTaps: true } : {}),
    instantTapsForAll: await instantTapsForAll(ctx.db, group.id),
    ...((await adjustCreditFor(ctx, group.id)) ? { adjustCredit: true } : {}),
    adjustCreditForAll: await adjustCreditForAll(ctx.db, group.id),
    ...((await venmoRequestFor(ctx, group.id)) ? { venmoRequest: true } : {}),
    venmoRequestForAll: await venmoRequestForAll(ctx.db, group.id),
    homeCollapseForAll: await homeCollapseForAll(ctx.db, group.id),
    ...((await tonightGlowFor(ctx, group.id)) ? { tonightGlow: true } : {}),
    tonightGlowForAll: await tonightGlowForAll(ctx.db, group.id),
    ...((await colorCleanupFor(ctx, group.id)) ? { colorCleanup: true } : {}),
    colorCleanupForAll: await colorCleanupForAll(ctx.db, group.id),
    ...((await playerCardsFor(ctx, group.id)) ? { playerCardsSimple: true } : {}),
    playerCardsSimpleForAll: await playerCardsForAll(ctx.db, group.id),
    ...((await lastCallFor(ctx, group.id)) ? { lastCallTexts: true } : {}),
    lastCallTextsForAll: await lastCallForAll(ctx.db, group.id),
    // Zip 9. "Short games" for this screen is what requireAdmin put on the group (the same answer every price on it used).
    ...(group.short_games === true ? { shortGames: true } : {}),
    // Zip 24: the 2.5 and 3 hour rows are priced (Booking hours on for everyone). The picker's price under each length reads it.
    ...(group.long_games === true ? { longGames: true } : {}),
    shortGamesForAll: await shortGamesForAll(ctx.db, group.id),
    ...((await cardTimeFor(ctx, group.id)) ? { cardTimeButtons: true } : {}),
    cardTimeButtonsForAll: await cardTimeForAll(ctx.db, group.id),
    // Zip 10. "Card cleanup" for this screen is what requireAdmin put on the group (the same answer every join on it used).
    // The look: the Settings row, or this phone's private link (look only; seats follow the row alone).
    ...(group.card_cleanup === true || (await cardCleanupLook(ctx, group.id)) ? { cardCleanup: true } : {}),
    cardCleanupForAll: await cardCleanupForAll(ctx.db, group.id),
    // Zip 11. "Alert cards": the one action-card look for every alert (display only).
    ...((await alertCardsFor(ctx, group.id)) ? { alertCards: true } : {}),
    alertCardsForAll: await alertCardsForAll(ctx.db, group.id),
    // Zip 12 (server/speed.ts): the three speed rows.
    // Only while on, so with all three off this answer is exactly main's (Settings reads a missing one as off).
    ...((await fewerQueriesForAll(ctx.db, group.id)) ? { speedFewerQueriesForAll: true } : {}),
    ...((await directLoadForAll(ctx.db, group.id)) ? { speedDirectLoadForAll: true } : {}),
    ...((await lastScreenForAll(ctx.db, group.id)) ? { speedLastScreenForAll: true } : {}),
    // Zip 12 step C, Instant admin: only while on (off: the answer is exactly as before).
    // One read of the row for both flags.
    ...(await lastScreenAdminFlags(ctx, group.id)),
    // "Seat dots": every empty seat a dashed ring (display only).
    ...((await seatDotsFor(ctx, group.id)) ? { seatDots: true } : {}),
    seatDotsForAll: await seatDotsForAll(ctx.db, group.id),
    ...(redo.on ? { playersRedo: true as const, playersRedoMonth: month!.label } : {}),
    ...(redo.forAll ? { playersRedoForAll: true as const } : {}),
    ...(swap.on ? { swapButton: true as const } : {}),
    ...(swap.forAll ? { swapButtonForAll: true as const } : {}),
    ...(undo.on ? { adminUndo: true as const } : {}),
    ...(undo.forAll ? { adminUndoForAll: true as const } : {}),
    ...(totals.on ? { totalsRefresh: true as const } : {}),
    ...(totals.forAll ? { totalsRefreshForAll: true as const } : {}),
    ...(spentMatch.on ? { spentTotals: true as const } : {}),
    ...(spentMatch.forAll ? { spentTotalsForAll: true as const } : {}),
    ...(cheaper.forAll ? { cheaperFixForAll: true as const } : {}),
    ...(checkInPay.on ? { checkInPay: true as const } : {}),
    ...(checkInPay.forAll ? { checkInPayForAll: true as const } : {}),
    ...(tapGuard.on ? { tapGuardFix: true as const } : {}),
    ...(tapGuard.forAll ? { tapGuardFixForAll: true as const } : {}),
    ...(playersSheet.on ? { playersSheetRedo: true as const } : {}),
    ...(playersSheet.forAll ? { playersSheetRedoForAll: true as const } : {}),
    ...(actingRows ? { actingOthers: actingRows } : {}),
    ...(acting.forAll ? { actingOthersForAll: true as const } : {}),
    ...(hours.on ? { bookingHours: true as const } : {}),
    ...(hours.forAll ? { bookingHoursForAll: true as const } : {}),
    ...(gameDay.on ? { gameDayCard: true as const } : {}),
    ...(gameDay.forAll ? { gameDayCardForAll: true as const } : {}),
    // Zip 16 "After-game cards" (server/afterGame.ts): its Settings row, only while on.
    ...((await afterGameCardForAll(ctx.db, group.id)) ? { afterGameCardForAll: true as const } : {}),
    // Zip 38 (server/christmasSkin.ts): its Settings row, only while on.
    ...((await christmasSkinForAll(ctx.db, group.id)) ? { christmasSkinForAll: true as const } : {}),
    // Zip 37 (server/homeScreenTip.ts, server/gameDayText.ts): the two Settings rows only, only while on (the admin screens do not change).
    ...((await homeScreenTipForAll(ctx.db, group.id)) ? { homeScreenTipForAll: true as const } : {}),
    ...((await gameDayTextForAll(ctx.db, group.id)) ? { gameDayTextForAll: true as const } : {}),
    ...(secondChance.on ? { secondChance: await secondChanceView(ctx, group, sessions, rosters, organizerId, sessionViews, playerLinkFor(ctx, group)) } : {}),
    ...(secondChance.forAll ? { secondChanceForAll: true as const } : {}),
    // Zip 21 (server/errorAlerts.ts): the Settings row only (no screen changes; the alerts go to Telegram).
    ...((await errorAlertsForAll(ctx.db, group.id)) ? { errorAlertsForAll: true as const } : {}),
    // Zip 17 (server/unpaidNudge.ts): the Settings row only (admin screens do not change).
    ...((await unpaidNudgeForAll(ctx.db, group.id)) ? { unpaidNudgeForAll: true as const } : {}),
    // Zip 31 "Extended time" (server/extension.ts): the Settings row, and while on for this phone the flag and every share still owed or
    // waiting for a confirm (from the rows loaded above, no extra read). Off: not there, so this answer is exactly main's.
    ...((await extendedTimeForAll(ctx.db, group.id)) ? { extendedTimeForAll: true as const } : {}),
    ...((await extendedTimeFor(ctx, group.id)) ? { extendedTime: true as const } : {}),
    // The shares still owed or waiting for a confirm: while on, and also after it is turned off while some are still open (a debt or an
    // I paid made while it was on can always be settled). With no extra time ever used: not there, so the answer is exactly main's.
    ...(() => {
      const open = extRowsOf(sessions, rosters).filter((x) => x.owedCents > 0 || x.claimCents > 0);
      return open.length > 0 ? { extensionOwed: open.map((x) => ({ sessionId: x.sessionId, startsAt: x.startsAt, minutes: x.minutes, playerId: x.playerId, name: x.name, shareCents: x.shareCents, owedCents: x.owedCents, claimCents: x.claimCents })) } : {};
    })(),
    // Preview only (shared/previewCalm.ts): never on live.
    ...(previewCalmFor(ctx) ? { previewCalm: true as const } : {}),
    ...(moneyRework ? { hiddenGames: await hiddenGamesView(ctx, group.id, markedHidden, creditSessionIds, charges), gameMonthCounts: await gameMonthCounts(ctx, group, listHidden) } : {}),
  };
}

/**
 * The link to send players: the plain site address when it's open to
 * anyone, otherwise the long private link.
 */
export function playerLinkFor(ctx: Ctx, group: GroupRow): string {
  if (!group.open_access) return `${ctx.url.origin}/g/${group.group_key}`;
  return (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');
}

/** Visible sessions from the last 90 days on, their rosters, and the credit pot. */
const moneyPictureOf = (ctx: Ctx, group: GroupRow) => moneyPicture(ctx.db, group, ctx.nowMs);

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function adminSession(ctx: Ctx): Promise<{ group: GroupRow; session: SessionRow }> {
  const group = await requireAdmin(ctx);
  const session = await getSession(ctx.db, group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return { group, session };
}

export async function updateBooking(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const next = {
    booking_status: v.oneOf(body.bookingStatus, 'bookingStatus', ['needs_booking', 'booked', 'unavailable'] as const),
    venue_name: v.optionalText(body.venueName, 'venueName', 80),
    venue_booking_url: v.optionalUrl(body.venueBookingUrl, 'venueBookingUrl'),
    reservation_reference: v.optionalText(body.reservationReference, 'reservationReference', 80),
    court_cost_cents: v.cents(body.courtCostCents, 'courtCostCents'),
    cancellation_deadline_at: v.isoTime(body.cancellationDeadlineAt, 'cancellationDeadlineAt'),
  };
  if (next.cancellation_deadline_at && next.cancellation_deadline_at > session.starts_at) {
    throw new HttpError(400, 'invalid_cancellationDeadlineAt', 'The cancellation deadline must be before the session starts.');
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, val] of Object.entries(next)) {
    const before = session[k as keyof SessionRow];
    if (before !== val) changes[k] = { from: before, to: val };
  }
  if (Object.keys(changes).length === 0) return { ok: true, changed: false };
  const status = session.status === 'canceled' ? 'canceled' : next.booking_status === 'booked' ? 'booked' : 'planned';
  const upd = await ctx.db
    .prepare(
      `UPDATE sessions SET booking_status = ?, venue_name = ?, venue_booking_url = ?, reservation_reference = ?,
         court_cost_cents = ?, cancellation_deadline_at = ?, status = ?, updated_at = ?
       WHERE id = ? AND (status = 'canceled') = (? = 'canceled')`,
    )
    .bind(
      next.booking_status,
      next.venue_name,
      next.venue_booking_url,
      next.reservation_reference,
      next.court_cost_cents,
      next.cancellation_deadline_at,
      status,
      ctx.nowIso,
      session.id,
      session.status,
    )
    .run();
  // A cancel landed in between: never bring a canceled game back from here.
  if (upd.meta.changes !== 1) throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  await audit(ctx.db, group.id, session.id, 'booking_updated', changes, ctx.nowIso);
  if (changes.booking_status) await recordCourtBooked(ctx.db, group.id, session.id, next.booking_status === 'booked', ctx.nowIso);
  return { ok: true, changed: true };
}

export async function decide(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const decision = v.oneOf(body.decision, 'decision', ['try_fill', 'keep', 'cancel', 'reopen'] as const);
  if (decision === 'cancel') {
    if (body.confirm !== true) throw new HttpError(400, 'confirm_required', 'Confirm the cancellation first.');
    // Already canceled (a double tap or a retry): money still on it, if a cut-off request left any, goes back now.
    if (session.status === 'canceled') {
      await cancelWithMoney(ctx, group, session, null);
      return { ok: true, changed: false };
    }
    if (session.finalized_at) throw new HttpError(409, 'finalized', 'This game is finalized. Reopen it on the Money tab first.');
    // "Were you charged for this court?" is only asked within 12 hours of the start.
    // A Yes counts as that canceled game's court cost; it is kept with the cancel in the Activity log.
    const askedCharge = ctx.nowMs >= Date.parse(session.starts_at) - CHARGE_ASK_HOURS * 3600_000 && ctx.nowMs < Date.parse(session.starts_at);
    const reason = v.cancelReason(body.reason);
    // Late fees (shared/lateFees.ts rule 5): inside the 12 hours the question is "Did the venue waive the fee?" (no default).
    // Yes = the cancel below, exactly as before (everyone gets money back as credit). No = no money moves and everyone
    // signed up still owes their $14 (late droppers keep owing too).
    const lateFees = askedCharge && (await lateFeesFor(ctx, group.id));
    if (lateFees) {
      if (typeof body.venueWaived !== 'boolean') throw new HttpError(400, 'answer_needed', 'Did the venue waive the fee or give you credit toward the next booking? Pick Yes or No.');
      if (body.venueWaived === false) return cancelFeeKept(ctx, group, session, reason, await lateFeeSplitFor(ctx, group.id));
    }
    // "Money page rework": the sheet asks "Were you charged?" at any time before the game, so an amount is taken outside the 12 hours too.
    const chargeAnswerable = (askedCharge || (ctx.nowMs < Date.parse(session.starts_at) && (await moneyReworkFor(ctx, group.id)))) && !lateFees;
    const chargedCents = chargeAnswerable ? (v.cents(body.chargedCents, 'chargedCents') ?? 0) : 0;
    const { changed, returned, back } = await cancelWithMoney(
      ctx,
      group,
      session,
      ctx.db.prepare("UPDATE sessions SET status = 'canceled', canceled_at = ?, canceled_by = 'organizer', cancel_reason = ?, updated_at = ? WHERE id = ? AND status <> 'canceled' AND finalized_at IS NULL").bind(ctx.nowIso, reason, ctx.nowIso, session.id),
    );
    if (!changed) {
      // A second tap that lost the race to the first: already canceled, nothing more to do.
      if ((await getSession(ctx.db, group.id, session.id))?.status === 'canceled') return { ok: true, changed: false };
      throw new HttpError(409, 'changed', 'This game just changed. Look again.');
    }
    await invalidateSessionTokens(ctx.db, session.id, ctx.nowIso);
    await audit(ctx.db, group.id, session.id, 'session_canceled', { startsAt: session.starts_at, chargedCents, creditReturnedCents: returned, creditBackCents: back, ...(reason ? { reason } : {}), ...(lateFees ? { venueWaived: true } : {}) }, ctx.nowIso);
    return { ok: true, changed: true };
  }
  if (decision === 'reopen') {
    if (session.status !== 'canceled') return { ok: true, changed: false };
    if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
    // One batch: the game opens again, and a payment that became credit is credit now, so they owe for the
    // reopened game again (and can use that credit).
    // A game canceled with the fee split (LATE_FEE_SPLIT) is a normal game at the flat price again: the split price goes
    // (a canceled game is never finalized, so final_price_cents / final_played_count only ever hold the split), and a
    // seat left paid at the split price owes the difference again (unsplitStatements). Other cancels: as before.
    const wasSplit = !!feeSplitOf(session);
    // An I paid nobody confirmed, at the split price (below $14): Reopen would leave it as a $9 claim on a $14 game, so the
    // organizer confirms it (Mark paid) or clears it (Unmark) first, the same rule as Reopen after Finalize.
    // A reopened game is a live game again: it follows today's price rules, not the lock its cancel may have got (Zip 27, A-01; the lock
    // goes in the batch below).
    const live = { ...session, price_lock: null };
    const flatCents = flatOf(live, settingsOf(group));
    const unconfirmedShort = `SELECT 1 FROM session_players u WHERE u.session_id = ${sqlText(session.id)} AND u.status = 'confirmed' AND u.payment_status = 'paid'
      AND u.refunded_at IS NULL AND u.self_paid_at IS NOT NULL AND COALESCE(u.payment_amount_cents, 0) < ${Math.trunc(flatCents)}`;
    if (wasSplit) {
      const { results: waiting } = await ctx.db
        .prepare(`SELECT p.display_name AS name FROM session_players u JOIN players p ON p.id = u.player_id WHERE ${unconfirmedShort.replace(/^SELECT 1 FROM session_players u WHERE /, '')} ORDER BY p.display_name`)
        .all<{ name: string }>();
      if (waiting.length) throw new HttpError(409, 'unconfirmed_paid', `Can't reopen: ${waiting.map((u) => u.name).join(' and ')} tapped I paid, not confirmed yet. Confirm it (Mark paid) or clear it (Unmark) first.`);
    }
    const reopened = `(SELECT canceled_at FROM sessions WHERE id = ${sqlText(session.id)}) IS NULL AND (SELECT updated_at FROM sessions WHERE id = ${sqlText(session.id)}) = ${sqlText(ctx.nowIso)}`;
    const [opened] = await ctx.db.batch([
      ctx.db
        .prepare(
          `UPDATE sessions SET status = CASE WHEN booking_status = 'booked' THEN 'booked' ELSE 'planned' END,
             canceled_at = NULL, canceled_by = NULL, cancel_reason = NULL, admin_decision = NULL, decision_at = NULL,
             ${wasSplit ? 'final_price_cents = NULL, final_played_count = NULL, ' : ''}updated_at = ?
           WHERE id = ? AND status = 'canceled'${wasSplit ? ` AND NOT EXISTS (${unconfirmedShort})` : ''}`,
        )
        .bind(ctx.nowIso, session.id),
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
             paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, refunded_at = NULL, updated_at = ?1
           WHERE session_id = ?2 AND payment_status = 'paid' AND refunded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'kept' AND l.session_id = session_players.session_id AND l.player_id = session_players.player_id AND l.ended_at IS NULL)${wasSplit ? `
             AND ${reopened}` : ''}`,
        )
        .bind(ctx.nowIso, session.id),
      ...(wasSplit ? unsplitStatements(ctx.db, session.id, flatOf(live, settingsOf(group)), ctx.nowIso, reopened) : []),
      ctx.db
        .prepare(`DELETE FROM task_log WHERE session_id = ?1 AND task = '${PRICE_LOCK_TASK}' AND kind = 'mark' AND (SELECT canceled_at FROM sessions WHERE id = ?1) IS NULL`)
        .bind(session.id),
    ]);
    // A split game whose reopen was stopped by an I paid landing at that moment: nothing moved (every statement above checks it).
    if (wasSplit && opened.meta.changes !== 1) {
      // A second Reopen tap that lost the race to the first: already open, nothing more to do.
      if ((await getSession(ctx.db, group.id, session.id))?.status !== 'canceled') return { ok: true, changed: false };
      throw new HttpError(409, 'changed', 'This game just changed. Look again.');
    }
    // A reopened game is a normal game again: it shows to players (a hide only ever applies to a canceled game).
    await setHiddenFromPlayers(ctx.db, group.id, session.id, false, ctx.nowIso);
    await audit(ctx.db, group.id, session.id, 'session_reopened', {}, ctx.nowIso);
    return { ok: true, changed: true };
  }
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  await ctx.db
    .prepare('UPDATE sessions SET admin_decision = ?, decision_at = ?, updated_at = ? WHERE id = ?')
    .bind(decision, ctx.nowIso, ctx.nowIso, session.id)
    .run();
  await audit(ctx.db, group.id, session.id, `decision_${decision}`, {}, ctx.nowIso);
  return { ok: true, changed: true };
}

/**
 * Cancel a game and give everyone's money back as credit, in ONE batch:
 * credit they used goes back to their pot, and what each other player paid
 * in cash becomes a new credit entry (never the organizer's court payment).
 * `cancel` is the statement that cancels the game (null when it already is:
 * then only money a cut-off request left on it moves). Logs each player's
 * money back in the Activity log.
 */
async function cancelWithMoney(ctx: Ctx, group: GroupRow, session: SessionRow, cancel: D1PreparedStatement | null): Promise<{ changed: boolean; returned: number; back: number }> {
  const money = seatMoneyBackStatements(ctx.db, {
    groupId: group.id,
    sessionId: session.id,
    playerId: null,
    organizerId: await organizerIdOf(ctx.db, group),
    reason: 'canceled',
    nowIso: ctx.nowIso,
    when: (sp) => `(SELECT status FROM sessions WHERE id = ${sp}.session_id) = 'canceled'`,
  });
  // Open late-drop debts (shared/lateFees.ts) come back with everything else: the game is off, nobody owes. Never on a
  // game canceled with the fee kept ("Did the venue waive the fee?" No): there, a second tap moves nothing.
  const lateDrops = ctx.db
    .prepare(
      `UPDATE session_players SET late_drop_done_at = ?1, updated_at = ?1
       WHERE session_id = ?2 AND ${OPEN_LATE_DROP('session_players')}
         AND (SELECT status FROM sessions WHERE id = ?2) = 'canceled' AND COALESCE((SELECT canceled_by FROM sessions WHERE id = ?2), '') <> '${FEE_KEPT}'`,
    )
    .bind(ctx.nowIso, session.id);
  const statements = [lateDrops, ...money, finishLateDropClear(ctx.db, session.id, ctx.nowIso, null)];
  const out = await ctx.db.batch(cancel ? [cancel, ...statements] : statements);
  const changed = !!cancel && out[0].meta.changes === 1;
  const cleared = (
    await ctx.db
      .prepare("SELECT p.display_name AS name, sp.player_id AS id FROM session_players sp JOIN players p ON p.id = sp.player_id WHERE sp.session_id = ? AND sp.status = 'withdrawn' AND sp.late_drop_done_at = ? AND sp.played IS NULL AND sp.late_drop_at IS NOT NULL")
      .bind(session.id, ctx.nowIso)
      .all<{ name: string; id: string }>()
  ).results;
  for (const c of cleared) {
    const back = (await moneyBackAt(ctx.db, session.id, c.id, 'canceled', ctx.nowIso))[0];
    await audit(ctx.db, group.id, session.id, 'late_fee_cleared', { player: c.name, playerId: c.id, why: 'canceled', amountCents: (back?.cashCents ?? 0) + (back?.creditCents ?? 0) }, ctx.nowIso);
  }
  const moved = await moneyBackAt(ctx.db, session.id, null, 'canceled', ctx.nowIso);
  const names = new Map((await loadRoster(ctx.db, session.id)).map((r) => [r.player_id, r.display_name]));
  for (const m of moved) {
    if (m.cashCents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: names.get(m.playerId) ?? 'A player', playerId: m.playerId, amountCents: m.cashCents, reason: 'canceled' }, ctx.nowIso);
  }
  return { changed, returned: moved.reduce((s, m) => s + m.creditCents, 0), back: moved.reduce((s, m) => s + m.cashCents, 0) };
}

/**
 * Cancel inside the 12 hours with "Did the venue waive the fee?" answered No (LATE_FEES): the game is canceled,
 * canceled_by 'organizer_fee_kept', and NO money moves. Everyone who was in still owes their $14 (cash stays paid,
 * credit stays spent, unpaid stays owed), and so do open late drops. Reopen makes it a normal game again. The court
 * cost counts as charged in Money (the venue charged it), kept with the cancel in the Activity log like before.
 */
async function cancelFeeKept(ctx: Ctx, group: GroupRow, session: SessionRow, reason: string | null, split = false) {
  const organizerId = await organizerIdOf(ctx.db, group);
  // The late-cancel split (LATE_FEE_SPLIT, shared/lateFees.ts): N = everyone confirmed right now (the organizer too when
  // they are in, as Finalize counts them). With 5 or more, every seat in owes the price a played game would have, stored
  // on the game (final_price_cents, final_played_count; it is never finalized), and whatever a seat holds above that
  // comes back as credit in this same batch. The whole batch only goes ahead if no seat or credit on the game changed
  // since it was read (the same check Finalize makes), so the amounts below are exactly right or nothing happens.
  const plan = split ? await splitPlan(ctx, group, session, organizerId) : null;
  const claimed = plan
    ? `EXISTS (SELECT 1 FROM sessions WHERE id = ${sqlText(session.id)} AND canceled_at = ${sqlText(ctx.nowIso)} AND canceled_by = '${FEE_KEPT}' AND final_price_cents = ${plan.priceCents} AND finalized_at IS NULL)`
    : '';
  const seatMoves = plan ? plan.seats.map((seat) => splitSeatStatements(ctx.db, { groupId: group.id, sessionId: session.id, seat, priceCents: plan.priceCents, nowIso: ctx.nowIso, guard: claimed })) : [];
  // Zip 39 ("Made cheaper after paying", server/cheaperFix.ts): no split, and a seat holds MORE than the fee (the game was made cheaper after
  // they paid). Each such seat keeps exactly the fee and the rest comes back as credit, with the split's own moves. Then, like the split, the
  // cancel only goes ahead if no seat or credit on the game changed since it was read. No such seat (every normal game), or the switch off:
  // nothing here, and the cancel is exactly main's.
  const trim = !plan && (await cheaperFixFor(ctx, group.id, true)) ? await cheaperCancelPlan(ctx, group, session, organizerId) : null;
  const trimmed = `EXISTS (SELECT 1 FROM sessions WHERE id = ${sqlText(session.id)} AND canceled_at = ${sqlText(ctx.nowIso)} AND canceled_by = '${FEE_KEPT}' AND finalized_at IS NULL)`;
  const trimMoves = trim ? trim.seats.map((seat) => splitSeatStatements(ctx.db, { groupId: group.id, sessionId: session.id, seat, priceCents: trim.feeCents, nowIso: ctx.nowIso, guard: trimmed })) : [];
  const [cancel] = await ctx.db.batch([
    plan
      ? ctx.db
          .prepare(
            `UPDATE sessions SET status = 'canceled', canceled_at = ?1, canceled_by = '${FEE_KEPT}', cancel_reason = ?2, final_price_cents = ?4, final_played_count = ?5, updated_at = ?1
             WHERE id = ?3 AND status <> 'canceled' AND finalized_at IS NULL AND ${SPLIT_STATE(session.id)} = ?6`,
          )
          .bind(ctx.nowIso, reason, session.id, plan.priceCents, plan.count, plan.state)
      : trim
        ? ctx.db
            .prepare(
              `UPDATE sessions SET status = 'canceled', canceled_at = ?1, canceled_by = '${FEE_KEPT}', cancel_reason = ?2, updated_at = ?1
               WHERE id = ?3 AND status <> 'canceled' AND finalized_at IS NULL AND ${SPLIT_STATE(session.id)} = ?4`,
            )
            .bind(ctx.nowIso, reason, session.id, trim.state)
        : ctx.db
            .prepare(
              `UPDATE sessions SET status = 'canceled', canceled_at = ?1, canceled_by = '${FEE_KEPT}', cancel_reason = ?2, updated_at = ?1
             WHERE id = ?3 AND status <> 'canceled' AND finalized_at IS NULL`,
            )
            .bind(ctx.nowIso, reason, session.id),
    ...seatMoves.flatMap((m) => m.statements),
    ...trimMoves.flatMap((m) => m.statements),
    // Zip 27 (A-02): a seat that paid less than the fee it now owes (the game was made longer after they paid) owes the rest: its cash is
    // held against it, the way Finalize does it. Only seats this cancel made owe; the split's own moves above already ran.
    ...holdShortCashStatements(ctx.db, {
      sessionId: session.id,
      feeCents: plan ? plan.priceCents : flatOf(session, settingsOf(group)),
      nowIso: ctx.nowIso,
      organizerId,
      seatWhere: (sp) =>
        `${sp}.status = 'confirmed' AND ${
          plan ? claimed : `(SELECT canceled_at FROM sessions WHERE id = ?2) = ?1 AND (SELECT canceled_by FROM sessions WHERE id = ?2) = '${FEE_KEPT}' AND (SELECT finalized_at FROM sessions WHERE id = ?2) IS NULL`
        }`,
    }),
    // A fresh debt on every seat that is in (an old cleared mark from an earlier cancel and reopen does not carry over).
    ctx.db
      .prepare(
        `UPDATE session_players SET late_drop_done_at = NULL, updated_at = ?1
         WHERE session_id = ?2 AND status = 'confirmed' AND late_drop_done_at IS NOT NULL
           AND (SELECT canceled_at FROM sessions WHERE id = ?2) = ?1 AND (SELECT canceled_by FROM sessions WHERE id = ?2) = '${FEE_KEPT}'`,
      )
      .bind(ctx.nowIso, session.id),
    // The organizer never owes on a cancel: their own open late drop ends here (their seat's court payment is untouched).
    ctx.db
      .prepare(
        `UPDATE session_players SET late_drop_done_at = ?1, updated_at = ?1
         WHERE session_id = ?2 AND player_id = ?3 AND ${OPEN_LATE_DROP('session_players')}
           AND (SELECT canceled_at FROM sessions WHERE id = ?2) = ?1 AND (SELECT canceled_by FROM sessions WHERE id = ?2) = '${FEE_KEPT}'`,
      )
      .bind(ctx.nowIso, session.id, organizerId ?? ''),
    finishLateDropClear(ctx.db, session.id, ctx.nowIso, organizerId ?? ''),
    // Anyone NOT in (a paid waitlist seat, a seat that left with money still on it) gets it back as credit, exactly as
    // on any cancel. Seats that owe (everyone in, open late drops) are open late fees, which these statements skip.
    ...seatMoneyBackStatements(ctx.db, {
      groupId: group.id,
      sessionId: session.id,
      playerId: null,
      organizerId,
      reason: 'canceled',
      nowIso: ctx.nowIso,
      when: (sp) => `(SELECT status FROM sessions WHERE id = ${sp}.session_id) = 'canceled'`,
    }),
  ]);
  if (cancel.meta.changes !== 1) {
    if ((await getSession(ctx.db, group.id, session.id))?.status === 'canceled') return { ok: true, changed: false };
    throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  }
  await invalidateSessionTokens(ctx.db, session.id, ctx.nowIso);
  const names = new Map((await loadRoster(ctx.db, session.id)).map((r) => [r.player_id, r.display_name]));
  for (const m of await moneyBackAt(ctx.db, session.id, null, 'canceled', ctx.nowIso)) {
    const splitSeat = !!plan?.seats.some((x) => x.playerId === m.playerId);
    if (m.cashCents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: names.get(m.playerId) ?? 'A player', playerId: m.playerId, amountCents: m.cashCents, reason: 'canceled', ...(splitSeat ? { split: true } : {}) }, ctx.nowIso);
  }
  const chargedCents = courtCostOf(session, settingsOf(group));
  const splitBack = seatMoves.reduce((sum, m) => sum + m.cashBackCents + m.creditBackCents, 0);
  await audit(
    ctx.db,
    group.id,
    session.id,
    'session_canceled',
    {
      startsAt: session.starts_at,
      chargedCents,
      venueWaived: false,
      feeKept: true,
      ...(plan ? { split: { count: plan.count, priceCents: plan.priceCents, creditBackCents: splitBack } } : {}),
      ...(reason ? { reason } : {}),
    },
    ctx.nowIso,
  );
  // Zip 39: credit (not cash) that went back to the pot from a seat paid above the fee: one line each, like the split's below.
  if (trim) {
    for (let i = 0; i < trim.seats.length; i++) {
      const cents = trimMoves[i].creditBackCents;
      if (cents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: names.get(trim.seats[i].playerId) ?? 'A player', playerId: trim.seats[i].playerId, amountCents: cents, reason: 'canceled' }, ctx.nowIso);
    }
  }
  // Credit that went back to the pot from a seat (it was paid with more credit than the split price): one line each,
  // like the cash part above.
  if (plan) {
    for (let i = 0; i < plan.seats.length; i++) {
      const cents = seatMoves[i].creditBackCents;
      if (cents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: names.get(plan.seats[i].playerId) ?? 'A player', playerId: plan.seats[i].playerId, amountCents: cents, reason: 'canceled', split: true }, ctx.nowIso);
    }
  }
  const fresh = (await getSession(ctx.db, group.id, session.id))!;
  const orgRow = organizerId ? (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === organizerId) : undefined;
  if (orgRow && orgRow.status === 'withdrawn' && orgRow.late_drop_done_at === ctx.nowIso && orgRow.late_drop_at) {
    await audit(ctx.db, group.id, session.id, 'late_fee_cleared', { player: orgRow.display_name, playerId: orgRow.player_id, why: 'canceled', amountCents: 0 }, ctx.nowIso);
  }
  for (const r of await loadRoster(ctx.db, session.id)) {
    if (r.status === 'confirmed' && lateFeeKind(r, fresh, r.player_id === organizerId))
      await auditLateFeeOwed(ctx.db, group.id, session.id, r.player_id, 'canceled_late', ctx.nowIso, 'organizer', plan ? lateFeePriceCents('canceled_late', fresh, flatOf(session, settingsOf(group))) : specialFlatOf(session, settingsOf(group)));
  }
  return { ok: true, changed: true, feeKept: true, ...(plan ? { split: { count: plan.count, priceCents: plan.priceCents } } : {}) };
}

/**
 * What the late-cancel split will do (null: nothing, 4 or fewer in). Read before the batch; MONEY_STATE `state` makes the
 * batch refuse if anything changed since. Seats: every confirmed seat but the organizer's, except an unconfirmed I paid
 * (that waits for Mark paid, which applies the split to it then).
 */
async function splitPlan(ctx: Ctx, group: GroupRow, session: SessionRow, organizerId: string | null) {
  // The money state is read FIRST: anything that changes after it (a payment, a join, a drop, credit used or undone) makes
  // the batch refuse, so the seats read below are never older than the check.
  const state = (await ctx.db.prepare(`SELECT ${SPLIT_STATE(session.id)} AS s`).first<{ s: string }>())?.s ?? '';
  const roster = await loadRoster(ctx.db, session.id);
  const confirmed = roster.filter((r) => r.status === 'confirmed');
  const priceCents = feeSplitPrice(priceOf(session, settingsOf(group)), confirmed.length);
  if (priceCents === null) return null;
  const seats: SplitSeat[] = [];
  for (const r of confirmed) {
    if (r.player_id === organizerId) continue;
    if (r.payment_status === 'paid' && !r.refunded_at && r.self_paid_at) continue;
    seats.push(await splitSeatOf(ctx, session.id, r));
  }
  return { priceCents, count: confirmed.length, state, seats };
}

/**
 * Zip 39 ("Made cheaper after paying"): the seats a late cancel with the fee kept (no split) trims to the fee: in, not the organizer, not an
 * unconfirmed I paid (a claim waits for Alex), holding more than the fee. Null when there are none (then the cancel is exactly main's).
 * The money state is read FIRST, as in splitPlan, so the seats read below are never older than the cancel's check.
 */
async function cheaperCancelPlan(ctx: Ctx, group: GroupRow, session: SessionRow, organizerId: string | null) {
  const state = (await ctx.db.prepare(`SELECT ${SPLIT_STATE(session.id)} AS s`).first<{ s: string }>())?.s ?? '';
  const feeCents = flatOf(session, settingsOf(group));
  const seats: SplitSeat[] = [];
  for (const r of await loadRoster(ctx.db, session.id)) {
    if (r.status !== 'confirmed' || r.player_id === organizerId) continue;
    if (r.payment_status === 'paid' && !r.refunded_at && r.self_paid_at) continue;
    const seat = await splitSeatOf(ctx, session.id, r);
    const holds = seat.paid ? seat.paymentCents : seat.used.reduce((s, u) => s + u.cents, 0) + seat.heldCashCents;
    if (holds > feeCents) seats.push(seat);
  }
  return seats.length ? { state, feeCents, seats } : null;
}

/**
 * The split's "nothing changed" check: Finalize's MONEY_STATE (every seat's status and payment, the count and sum of live
 * credit on the game) plus the ids of those live credit rows, so an undo and a re-use of the same amount is a change too.
 */
const SPLIT_STATE = (sessionId: string) =>
  `(${MONEY_STATE(sessionId)} || '#' || (SELECT COALESCE(group_concat(id, ','), '') FROM (SELECT id FROM credit_ledger WHERE session_id = ${sqlText(sessionId)} AND ended_at IS NULL ORDER BY id)))`;

/** One seat's money as the split reads it. */
async function splitSeatOf(ctx: Ctx, sessionId: string, r: RosterRow): Promise<SplitSeat> {
  const { results } = await ctx.db
    .prepare("SELECT id, amount_cents, reason FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL ORDER BY created_at, rowid")
    .bind(sessionId, r.player_id)
    .all<{ id: string; amount_cents: number; reason: string | null }>();
  const paid = r.payment_status === 'paid' && !r.refunded_at;
  return {
    playerId: r.player_id,
    paid,
    paymentCents: paid ? (r.payment_amount_cents ?? 0) : 0,
    used: results.filter((x) => x.reason !== 'cash').map((x) => ({ id: x.id, cents: x.amount_cents })),
    heldCashCents: results.filter((x) => x.reason === 'cash').reduce((sum, x) => sum + x.amount_cents, 0),
  };
}

/**
 * POST /api/admin/sessions/:id/late-fee { playerId, why }: Clear an open late fee (shared/lateFees.ts). why: 'sub'
 * (Sub found), 'venue' (Venue waived) or 'choice' (My choice). The debt ends for good and the money on the seat comes
 * back to them as credit, the same way a drop, a cancel or "did not play" gives it back. One batch: the seat is
 * marked first and every money statement only touches a seat this batch marked, so a double tap or a second phone
 * clears once. On a late drop that owes nothing, Clear is the old Done (the card goes away).
 */
export async function clearLateFee(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const why = v.oneOf(body.why, 'why', ['sub', 'venue', 'choice'] as const) as LateFeeClearWhy;
  const organizerId = await organizerIdOf(ctx.db, group);
  const roster = await loadRoster(ctx.db, session.id);
  const row = roster.find((r) => r.player_id === playerId);
  if (!row) throw new HttpError(404, 'not_in_session', 'That player is not in this session.');
  const kind = lateFeeKind(row, session, playerId === organizerId);
  if (!kind) {
    if (row.status === 'withdrawn' && row.late_drop_at && !row.late_drop_done_at) {
      await ctx.db.prepare('UPDATE session_players SET late_drop_done_at = ? WHERE id = ? AND late_drop_done_at IS NULL').bind(ctx.nowIso, row.id).run();
      await audit(ctx.db, group.id, session.id, 'late_drop_done', { player: row.display_name }, ctx.nowIso);
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }
  const now = ctx.nowIso;
  const tagged = `EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND late_drop_done_at = ${sqlText(now)})`;
  const statements: D1PreparedStatement[] = [
    ctx.db
      // A late drop is tagged by its marks alone (the organizer's own has no owed payment on it); the others as open fees.
      .prepare(`UPDATE session_players SET late_drop_done_at = ?1, updated_at = ?1 WHERE session_id = ?2 AND player_id = ?3 AND ${kind === 'late_drop' ? OPEN_LATE_DROP('session_players') : OPEN_FEE('session_players')}`)
      .bind(now, session.id, playerId),
  ];
  const base = { groupId: group.id, sessionId: session.id, playerId, organizerId, nowIso: now };
  let reason: 'dropped' | 'canceled' | 'not_played' = 'dropped';
  if (kind === 'late_drop') {
    statements.push(...seatMoneyBackStatements(ctx.db, { ...base, reason: 'dropped', when: (sp) => `${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_done_at = ?1` }));
    statements.push(finishLateDropClear(ctx.db, session.id, now, playerId));
  } else if (kind === 'canceled_late') {
    reason = 'canceled';
    statements.push(
      ...seatMoneyBackStatements(ctx.db, { ...base, reason: 'canceled', when: (sp) => `(SELECT status FROM sessions WHERE id = ${sp}.session_id) = 'canceled' AND ${sp}.late_drop_done_at = ?1` }),
    );
  } else {
    // Did not play: what Finalize gives anyone who did not play when 4 or more did (all of it back as credit). An I paid
    // nobody confirmed stays a claim (the Home card answers it, as for any no-show).
    reason = 'not_played';
    const paid = row.payment_status === 'paid' && !row.refunded_at ? (row.payment_amount_cents ?? 0) : 0;
    const used = (
      await ctx.db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
        .bind(session.id, playerId)
        .first<{ c: number }>()
    )?.c ?? 0;
    if (paid > 0 && !row.self_paid_at) {
      // Zip 39: a no-show paid above the fee already got the part above it back at Finalize ('finalized', with "Made cheaper after paying"
      // on): only the rest comes back now. Every other seat has none, so this is exactly main's.
      const already = await creditBackLeft(ctx.db, session.id, playerId);
      statements.push(...creditBackStatements(ctx.db, { groupId: group.id, sessionId: session.id, playerId, cents: paid - already, reason: 'not_played', nowIso: now, settle: true, guard: tagged }));
    } else if (paid === 0 && used > 0) {
      statements.push(
        ctx.db
          .prepare(
            `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ?2, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
             WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'unpaid' AND late_drop_done_at = ?1`,
          )
          .bind(now, used, session.id, playerId),
        ...creditBackStatements(ctx.db, { groupId: group.id, sessionId: session.id, playerId, cents: used, reason: 'not_played', nowIso: now, settle: true, guard: tagged }),
      );
    }
  }
  const [tag] = await ctx.db.batch(statements);
  if (tag.meta.changes !== 1) return { ok: true, changed: false };
  const back = (await moneyBackAt(ctx.db, session.id, playerId, reason, now))[0];
  const amountCents = (back?.cashCents ?? 0) + (back?.creditCents ?? 0);
  await audit(ctx.db, group.id, session.id, 'late_fee_cleared', { player: row.display_name, playerId, why, kind, amountCents }, now);
  if (back && back.cashCents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: row.display_name, playerId, amountCents: back.cashCents, reason }, now);
  return { ok: true, changed: true, creditBackCents: amountCents };
}

/**
 * "I booked it" (or "Court opened" when on the venue's waitlist): one tap
 * that marks the session booked. Venue defaults to the club, the deadline to
 * the default hours before play; reservation number and court cost are
 * optional and kept when left out. Standby players then move in, up to the
 * max. Court numbers are no longer used; any saved ones are left
 * alone in the database and never shown.
 */
export async function markBooked(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.ends_at)) throw new HttpError(409, 'session_over', 'This session is over.');
  const reference = body.reservationReference === undefined ? session.reservation_reference : v.optionalText(body.reservationReference, 'reservationReference', 80);
  const cost = body.courtCostCents === undefined ? session.court_cost_cents : v.cents(body.courtCostCents, 'courtCostCents');
  // Standby players move in when a court opens, whichever way the game was on the venue's waitlist.
  const wasWaiting = isCourtWaitlist({ bookingStatus: session.booking_status, courtState: session.court_state });
  const booked = await ctx.db
    .prepare(
      `UPDATE sessions SET booking_status = 'booked', status = 'booked',
         venue_name = COALESCE(venue_name, ?), reservation_reference = ?, court_cost_cents = ?,
         cancellation_deadline_at = COALESCE(cancellation_deadline_at, ?),
         court_state = CASE WHEN court_state = 'waitlist' THEN 'opened' ELSE court_state END,
         updated_at = ?
       WHERE id = ? AND status <> 'canceled'`,
    )
    .bind(group.venue_name || DEFAULT_VENUE_NAME, reference, cost, defaultDeadline(session.starts_at, settingsOf(group)), ctx.nowIso, session.id)
    .run();
  // A cancel landed in between: a canceled game stays canceled (everyone's money is already credit).
  if (booked.meta.changes !== 1) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  // Nobody's seat changes when the court does: people signed up while it was on Waitlist already have real seats.
  await audit(ctx.db, group.id, session.id, wasWaiting ? 'court_opened' : 'court_booked', { promoted: 0 }, ctx.nowIso);
  await recordCourtBooked(ctx.db, group.id, session.id, true, ctx.nowIso);
  return { ok: true, promoted: 0 };
}

/**
 * After moving a game: "Is the court booked for the new time?" Yes marks it
 * booked (same as "I booked it"); No marks it not booked, so its "no court
 * yet" card and the morning-of court check come back for it.
 */
export async function courtAnswer(ctx: Ctx, body: Record<string, unknown>) {
  const booked = v.bool(body.booked, 'booked');
  if (booked) return markBooked(ctx, {});
  const { group, session } = await adminSession(ctx);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.ends_at)) throw new HttpError(409, 'session_over', 'This session is over.');
  const r = await ctx.db
    .prepare("UPDATE sessions SET booking_status = 'needs_booking', status = 'planned', court_state = CASE WHEN court_state IN ('waitlist', 'opened') THEN NULL ELSE court_state END, updated_at = ? WHERE id = ? AND status <> 'canceled'")
    .bind(ctx.nowIso, session.id)
    .run();
  // A cancel that landed in between: say so, log nothing.
  if (r.meta.changes !== 1) throw new HttpError(409, 'changed', 'This game just changed. Look again.');
  // Nobody's seat changes when the court does (a court on Waitlist gives normal seats).
  await audit(ctx.db, group.id, session.id, 'court_not_booked', {}, ctx.nowIso);
  await recordCourtBooked(ctx.db, group.id, session.id, false, ctx.nowIso);
  return { ok: true };
}

/**
 * The Not booked | Waitlist | Booked switch: one tap, one write, so a game can
 * never end up half-way between two states. Waitlist keeps the old third
 * booking value ("unavailable", once labeled Not available) AND the venue
 * waitlist flag, so everything that already understands the court waitlist
 * (the "did the court open?" card) keeps working. Waitlist is only a note for the organizer: sign-ups,
 * seats and credit behave exactly as on Not booked. Booked is the same as
 * "I booked it"; Not booked is the same as answering No after a move.
 * Nothing here touches money.
 */
export async function setCourtStatus(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const to = v.oneOf(body.status, 'status', ['not_booked', 'waitlist', 'booked'] as const);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.ends_at)) throw new HttpError(409, 'session_over', 'This session is over.');
  const from = courtSwitchOf({ bookingStatus: session.booking_status, courtState: session.court_state });
  if (from === to) return { ok: true, changed: false, status: to };
  if (to === 'booked') {
    await markBooked(ctx, {});
    return { ok: true, changed: true, status: to };
  }
  // A cancel that lands between the read and the write leaves the game alone: say so instead of "changed".
  const gone = () => new HttpError(409, 'changed', 'This game just changed. Look again.');
  if (to === 'waitlist') {
    const r = await ctx.db
      .prepare("UPDATE sessions SET booking_status = 'unavailable', court_state = 'waitlist', status = 'planned', updated_at = ? WHERE id = ? AND status <> 'canceled'")
      .bind(ctx.nowIso, session.id)
      .run();
    if (r.meta.changes !== 1) throw gone();
    await audit(ctx.db, group.id, session.id, 'court_waitlist', {}, ctx.nowIso);
  } else {
    const r = await ctx.db
      .prepare(
        `UPDATE sessions SET booking_status = 'needs_booking', status = 'planned',
           court_state = CASE WHEN court_state IN ('waitlist', 'opened') THEN NULL ELSE court_state END, updated_at = ?
         WHERE id = ? AND status <> 'canceled'`,
      )
      .bind(ctx.nowIso, session.id)
      .run();
    if (r.meta.changes !== 1) throw gone();
    await audit(ctx.db, group.id, session.id, 'court_not_booked', {}, ctx.nowIso);
  }
  await recordCourtBooked(ctx.db, group.id, session.id, false, ctx.nowIso);
  return { ok: true, changed: true, status: to };
}

/** The venue's court waitlist: start waiting, give up ("Didn't open"), or go back to not booked. */
export async function courtWaitlist(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const action = v.oneOf(body.action, 'action', ['waitlist', 'not_opened', 'clear'] as const);
  if (action === 'waitlist') {
    if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    const moved = await ctx.db
      // Guarded in the database too: a cancel landing between the check above and this write must not bring the game back.
      .prepare("UPDATE sessions SET court_state = 'waitlist', booking_status = 'needs_booking', status = 'planned', updated_at = ? WHERE id = ? AND status <> 'canceled' AND finalized_at IS NULL")
      .bind(ctx.nowIso, session.id)
      .run();
    if (!moved.meta.changes) {
      if ((await getSession(ctx.db, group.id, session.id))?.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
      throw new HttpError(409, 'session_finalized', 'This session is already finalized.');
    }
    await recordCourtBooked(ctx.db, group.id, session.id, false, ctx.nowIso);
  } else if (action === 'clear') {
    await ctx.db.prepare('UPDATE sessions SET court_state = NULL, updated_at = ? WHERE id = ? AND court_state = \'waitlist\'').bind(ctx.nowIso, session.id).run();
  } else {
    if (!isCourtWaitlist({ bookingStatus: session.booking_status, courtState: session.court_state })) throw new HttpError(409, 'not_waiting', 'This session is not on the court waitlist.');
    await cancelWithMoney(
      ctx,
      group,
      session,
      ctx.db
        .prepare(
          `UPDATE sessions SET court_state = 'not_opened', status = 'canceled', canceled_at = ?, canceled_by = 'court_not_opened', updated_at = ?
           WHERE id = ? AND status <> 'canceled' AND finalized_at IS NULL`,
        )
        .bind(ctx.nowIso, ctx.nowIso, session.id),
    );
    await invalidateSessionTokens(ctx.db, session.id, ctx.nowIso);
  }
  await audit(ctx.db, group.id, session.id, `court_${action}`, {}, ctx.nowIso);
  return { ok: true };
}

/** "Show this session" for one that falls before the first session date (or hide it again). */
export async function showSession(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const shown = v.bool(body.shown, 'shown');
  await ctx.db.prepare('UPDATE sessions SET shown_early = ?, updated_at = ? WHERE id = ?').bind(shown ? 1 : 0, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, shown ? 'session_shown_early' : 'session_hidden_again', {}, ctx.nowIso);
  return { ok: true };
}

/** "Venue is open normal hours" on a holiday, or undo it. */
export async function holidayHours(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const ok = v.bool(body.ok, 'ok');
  await ctx.db.prepare('UPDATE sessions SET holiday_hours_ok_at = ?, updated_at = ? WHERE id = ?').bind(ok ? ctx.nowIso : null, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, ok ? 'holiday_hours_confirmed' : 'holiday_hours_unconfirmed', {}, ctx.nowIso);
  return { ok: true };
}

/** "Done" on the day-before or last-call card. */
export async function cardDone(ctx: Ctx, body: Record<string, unknown>) {
  const { session } = await adminSession(ctx);
  const card = v.oneOf(body.card, 'card', ['day_before', 'last_call'] as const);
  const column = card === 'day_before' ? 'day_before_done_at' : 'last_call_done_at';
  await ctx.db.prepare(`UPDATE sessions SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(ctx.nowIso, ctx.nowIso, session.id).run();
  return { ok: true };
}

/**
 * Move a session to a new date or time. Its deadline resets to the default for the new time.
 * `whileCanceled` is only for Second Chance (Zip 35, server/secondChance.ts): it moves a canceled game BEFORE reopening it, so a refused
 * time leaves the game canceled and untouched. `restoring` (also only Second Chance) puts the game's ORIGINAL time back after a failed reopen, so the
 * hours rule is not applied to a time the game already had. The route (PUT .../time) passes neither.
 */
export async function reschedule(ctx: Ctx, body: Record<string, unknown>, whileCanceled = false, restoring = false) {
  const { group, session } = await adminSession(ctx);
  if (session.status === 'canceled' && !whileCanceled) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
  const startsAt = v.isoTime(body.startsAt, 'startsAt');
  const endsAt = v.isoTime(body.endsAt, 'endsAt');
  if (!startsAt || !endsAt) throw new HttpError(400, 'invalid_time', 'Pick a date, start time, and end time.');
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) throw new HttpError(400, 'invalid_time', 'The end time must be after the start time.');
  if (length > 6 * 3600_000) throw new HttpError(400, 'invalid_time', 'A session can be at most 6 hours long.');
  if (Date.parse(startsAt) <= ctx.nowMs) throw new HttpError(400, 'invalid_time', 'Pick a time in the future.');
  if (startsAt === session.starts_at && endsAt === session.ends_at) return { ok: true, changed: false };
  // Zip 24 "Booking hours": only a CHANGED start or end is looked at (an existing game outside the hours is never blocked for other edits).
  if (!restoring) await enforceBookingHours(ctx, group.id, group.timezone, startsAt, endsAt);
  const deadline = defaultDeadline(startsAt, settingsOf(group));
  const move = ctx.db
    .prepare(
      `UPDATE sessions SET starts_at = ?, ends_at = ?, cancellation_deadline_at = ?, admin_decision = NULL, decision_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(startsAt, endsAt, deadline, ctx.nowIso, session.id);
  // "Short games" on (shared/gameLength.ts): a new length can change the flat price (2 hours $14 <-> 1.5 hours $11). The seats are
  // then repriced in the same batch as the move, the way Reopen does it: a seat paid with credit that is now short owes the rest, an
  // unpaid seat whose credit now covers it is paid, and anything paid above the new price comes back as credit at Finalize.
  // Off (or the same price): nothing is added, exactly as before.
  const newFlat = flatOf({ starts_at: startsAt, ends_at: endsAt }, settingsOf(group));
  const reprice = newFlat !== flatOf(session, settingsOf(group)) ? repriceStatements(ctx.db, session.id, newFlat, ctx.nowIso) : [];
  try {
    if (startsAt !== session.starts_at) {
      // "Time may shift": everyone in (or on the real waitlist) who had agreed to the old start time, by joining at
      // it, keeps that as the time they agreed to, in the same step as the move. Anyone who already said Still in
      // to some time keeps that answer: a change back to it asks them nothing. Never touches money or a seat.
      await ctx.db.batch([
        ctx.db
          .prepare("UPDATE session_players SET time_confirmed = ? WHERE session_id = ? AND time_confirmed IS NULL AND status IN ('confirmed', 'waitlisted')")
          .bind(session.starts_at, session.id),
        move,
        ...reprice,
      ]);
    } else if (reprice.length) {
      await ctx.db.batch([move, ...reprice]);
    } else {
      await move.run();
    }
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'time_taken', "There's already a session at that time.");
    throw err;
  }
  await audit(ctx.db, group.id, session.id, 'session_rescheduled', { from: session.starts_at, to: startsAt }, ctx.nowIso);
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: group.timezone });
  if (dayOf(startsAt) !== dayOf(session.starts_at)) await resetTasksForNewDay(ctx.db, session.id);
  return { ok: true, changed: true };
}

/** Organizer fixes to the roster. Still goes through the same max-players rules. */
export async function editRoster(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const action = v.oneOf(body.action, 'action', ['confirm', 'waitlist', 'withdraw', 'confirm_attendance'] as const);
  const player = await ctx.db
    .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ?')
    .bind(playerId, group.id)
    .first<{ id: string; display_name: string }>();
  if (!player) throw new HttpError(404, 'player_not_found', 'Player not found.');
  let result: string;
  if (action === 'confirm') {
    const r = await joinSession(ctx.db, session, playerId, ctx.nowMs, 'organizer', settingsOf(group));
    // "Card cleanup" (Zip 10): no cap, only the database's 12; never the word "full".
    if (r.result === 'spot_taken') throw settingsOf(group).noCap === true ? new HttpError(409, 'game_limit', DB_LIMIT_MESSAGE) : new HttpError(409, 'session_full', `The game is full (${settingsOf(group).maxPlayers} in).`);
    result = r.result;
  } else if (action === 'waitlist') {
    // "Card cleanup" (Zip 10): there is no waitlist to move anyone to.
    if (settingsOf(group).noCap === true) throw new HttpError(409, 'no_waitlist', 'There is no waitlist anymore. Use Out instead.');
    await moveToWaitlist(ctx.db, session, playerId, ctx.nowMs);
    result = 'waitlisted';
  } else if (action === 'withdraw') {
    const r = await withdraw(ctx.db, group, session, playerId, ctx.nowMs);
    result = r.changed ? 'withdrawn' : 'not_in_session';
    if (r.creditBackCents > 0) await audit(ctx.db, group.id, session.id, 'credit_back', { player: player.display_name, playerId, amountCents: r.creditBackCents, reason: 'dropped' }, ctx.nowIso);
  } else {
    await confirmAttendance(ctx.db, session, playerId, ctx.nowMs);
    result = 'confirmed_attendance';
  }
  await audit(ctx.db, group.id, session.id, `roster_${action}`, { player: player.display_name, result }, ctx.nowIso);
  return { result };
}

/** Done on a late-drop card: hides it. The late drop still counts on the Players screen. */
export async function lateDropDone(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const res = await ctx.db
    // Never on an open late fee: marking it done would leave its money on the game, neither owed nor credit. Clear does that.
    .prepare(`UPDATE session_players SET late_drop_done_at = ? WHERE session_id = ? AND player_id = ? AND late_drop_at IS NOT NULL AND NOT ${OPEN_FEE('session_players')}`)
    .bind(ctx.nowIso, session.id, playerId)
    .run();
  if (res.meta.changes === 0 && lateFeeKind((await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId) ?? { status: '', played: null, late_drop_at: null, late_drop_done_at: null, payment_status: '', refunded_at: null }, session)) {
    throw new HttpError(409, 'late_fee_open', 'They still owe their $14. Use Clear (or Mark paid on the Money tab).');
  }
  // The Money page rework names who it was in the log; with it off the entry is exactly what it always was.
  const dropper = (await moneyReworkFor(ctx, group.id)) ? await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>() : null;
  await audit(ctx.db, group.id, session.id, 'late_drop_done', dropper ? { player: dropper.display_name, playerId } : {}, ctx.nowIso);
  return { ok: true };
}

/**
 * POST /api/admin/sessions/:id/claim { playerId, paid }: the organizer answers an unconfirmed "I paid" on a
 * seat that left the game or a canceled game. paid: they did pay, so it becomes their credit now (one batch:
 * confirmed, then handed back like any drop or cancel). Not paid: the claim is cleared, nothing is owed.
 */
export async function answerClaim(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const paid = v.bool(body.paid, 'paid');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'That is your court payment.');
  // An I paid on an open late fee is a payment on that game (it stays there): Mark paid / Unmark answer it.
  const row = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
  const via = await hasViaShares(ctx.db, session.id, playerId);
  const out = row && lateFeeKind(row, session) ? await applyPayment(ctx, group, session, playerId, paid, null) : await answerClaimOn(ctx, group, session, playerId, paid);
  // Zip 31: extra time paid together with this seat ("$17 due") follows the answer (Paid confirms it, Didn't pay clears it).
  if (via) await followSeat(ctx, group.id, session.id, playerId, paid, true, true);
  return out;
}

/**
 * The answer to a claim (also what Unmark or the player's "Didn't pay?" does on one). A claim is an unconfirmed
 * I paid on a seat that left the game, in a canceled game, or marked "did not play" at Finalize.
 *  - Left or canceled: confirmed, everything on the seat goes back as on any drop or cancel; cleared, the
 *    payment is gone and the credit on the seat goes back.
 *  - Did not play: confirmed, the whole payment comes back as "did not play" credit, as Finalize does for a
 *    confirmed payment; cleared, only the credit on the seat comes back.
 * One batch each; every statement guarded, so a repeat or a second device changes nothing.
 */
async function answerClaimOn(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, paid: boolean) {
  const organizerId = await organizerIdOf(ctx.db, group);
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  const canceled = session.status === 'canceled';
  // The claim as it is now: still self-marked, not settled, on a seat that left, in a canceled game, or not played.
  const claim = `session_id = ?2 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NOT NULL
    AND (status <> 'confirmed' OR (SELECT status FROM sessions WHERE id = ?2) = 'canceled'
         OR (played = 0 AND (SELECT finalized_at FROM sessions WHERE id = ?2) IS NOT NULL))`;
  const before = await ctx.db
    .prepare(`SELECT payment_amount_cents AS c, status, played FROM session_players WHERE ?1 IS NOT NULL AND ${claim}`)
    .bind(ctx.nowIso, session.id, playerId)
    .first<{ c: number; status: string; played: number | null }>();
  if (!before) return { ok: true, changed: false };
  const notPlayed = !canceled && before.status === 'confirmed' && before.played === 0;
  let statements: D1PreparedStatement[];
  let reason: string;
  if (notPlayed) {
    reason = 'not_played';
    const used = (
      await ctx.db
        .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
        .bind(session.id, playerId)
        .first<{ c: number }>()
    )?.c ?? 0;
    // After the answer the seat is no longer a claim; the credit-back statements only run if the answer went in.
    const answered = `NOT EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND self_paid_at IS NOT NULL)`;
    const back = paid ? (before.c ?? 0) : used;
    statements = [
      paid
        ? ctx.db.prepare(`UPDATE session_players SET self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1 WHERE ${claim}`).bind(ctx.nowIso, session.id, playerId)
        : // Not paid: the payment is only the credit on the seat (as Finalize records a credit-only seat), or nothing.
          ctx.db
            .prepare(
              `UPDATE session_players SET payment_status = CASE WHEN ?4 > 0 THEN 'paid' ELSE 'unpaid' END, payment_amount_cents = CASE WHEN ?4 > 0 THEN ?4 ELSE NULL END,
                 paid_at = CASE WHEN ?4 > 0 THEN paid_at ELSE NULL END, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1 WHERE ${claim}`,
            )
            .bind(ctx.nowIso, session.id, playerId, used),
      ...creditBackStatements(ctx.db, { groupId: group.id, sessionId: session.id, playerId, cents: back, reason: 'not_played', nowIso: ctx.nowIso, settle: true, guard: answered }),
    ];
  } else {
    reason = canceled ? 'canceled' : 'dropped';
    statements = [
      paid
        ? ctx.db.prepare(`UPDATE session_players SET self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1 WHERE ${claim}`).bind(ctx.nowIso, session.id, playerId)
        : ctx.db
            .prepare(
              `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
                 paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1 WHERE ${claim}`,
            )
            .bind(ctx.nowIso, session.id, playerId),
      ...seatMoneyBackStatements(ctx.db, {
        groupId: group.id,
        sessionId: session.id,
        playerId,
        organizerId,
        reason: canceled ? 'canceled' : 'dropped',
        nowIso: ctx.nowIso,
        entryId: newId(),
        when: (sp) => `(${sp}.status <> 'confirmed' OR (SELECT status FROM sessions WHERE id = ${sp}.session_id) = 'canceled')`,
      }),
    ];
  }
  const [answered] = await ctx.db.batch(statements);
  if (answered.meta.changes !== 1) return { ok: true, changed: false };
  await audit(ctx.db, group.id, session.id, paid ? 'payment_claim_confirmed' : 'payment_claim_cleared', { player: p.display_name, playerId, amountCents: before.c, reason }, ctx.nowIso);
  return { ok: true, changed: true };
}

export async function setPayment(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const paid = v.bool(body.paid, 'paid');
  const seen = body.seen === undefined ? null : v.optionalText(body.seen, 'seen', 200);
  // Zip 31 "Extended time": only a seat that extra time was paid with ("$17 due") does anything more (one small read first). Its Unmark is
  // refused when that extra time was handed back as credit since and the player no longer has it.
  const via = playerId !== group.organizer_player_id && (await hasViaShares(ctx.db, session.id, playerId));
  if (via && !paid) {
    const blocked = await unmarkBlockedBy(ctx.db, session.id, playerId);
    if (blocked) throw new HttpError(409, 'extension_handed_back', blocked);
  }
  // The row showed "$17 (incl. $3 extension)": Mark paid takes both in one tap. The shares go first (only if they still owe exactly what the
  // row showed), then the seat as always; a seat payment that is refused puts the shares back. Unmark later reverses both (they follow it).
  const extCents = paid && body.extCents !== undefined && body.extCents !== null ? (v.cents(body.extCents, 'extCents') ?? 0) : 0;
  if (extCents > 0 && playerId !== group.organizer_player_id) {
    if (!(await extendedTimeFor(ctx, group.id))) throw new HttpError(409, 'changed', 'This just changed. Look again.');
    await markSharesWithSeat(ctx, session.id, playerId, extCents);
    try {
      const out = await applyPayment(ctx, group, session, playerId, paid, null, undefined, body.cents === undefined ? null : v.cents(body.cents, 'cents'), seen);
      await audit(ctx.db, group.id, session.id, 'extension_marked_paid', { player: (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId)?.display_name, playerId, amountCents: extCents, withGame: true }, ctx.nowIso);
      return out;
    } catch (err) {
      await undoSharesWithSeat(ctx, session.id, playerId).catch(() => {});
      throw err;
    }
  }
  const out = await applyPayment(ctx, group, session, playerId, paid, null, undefined, body.cents === undefined ? null : v.cents(body.cents, 'cents'), seen);
  // Extra time paid together with this seat ("$17 due") follows the seat's Mark paid / Unmark: one write, no read; also with the switch
  // off, so a payment made while it was on can always be settled. Only when the seat itself changed (a stale tap moves nothing).
  if (via && (out as { changed?: boolean }).changed !== false) await followSeat(ctx, group.id, session.id, playerId, paid);
  return out;
}

/** POST /api/admin/sessions/:id/extension-payment { playerId, paid, cents? }: Zip 31, one share's Mark paid / Unmark (server/extension.ts). */
export async function setExtensionPayment(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  return adminExtensionPayment(ctx, group, session, body);
}

/** PUT /api/admin/extended-time-switch { on }: Settings > Feature switches > "Extended time" (Zip 31). Moves money only when used at Finalize. */
export async function setExtendedTimeSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setExtendedTimeForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'extended_time_on' : 'extended_time_off', {}, ctx.nowIso);
  return { ok: true };
}

/**
 * Mark one seat paid or unpaid. `self` is the player's name when they did it
 * themselves ("I paid" / "Didn't pay?"), or null for the organizer. A paid
 * seat uses up any credit planned for it; unmarking gives the credit back.
 * The organizer marking a self-marked seat paid confirms it (the tag goes).
 */
export async function applyPayment(
  ctx: Ctx,
  group: GroupRow,
  session: SessionRow,
  playerId: string,
  paid: boolean,
  self: string | null,
  actor?: string,
  /** The amount the screen showed as owed when the tap was made (optional): refused if it is not what is owed now. */
  shownCents: number | null = null,
  /** The seat's money as the organizer's screen showed it (shared/credit.ts moneySeen; optional): refused if it changed. */
  seen: string | null = null,
) {
  const roster = await loadRoster(ctx.db, session.id);
  // The organizer pays the venue, not the other players. Their Mark paid / Unmark mean "Court paid" / "Court due".
  if (playerId === (await organizerIdOf(ctx.db, group))) {
    if (self) throw new HttpError(409, 'organizer_pays_court', 'There is nothing for you to pay here.');
    return applyCourtPayment(ctx, group, session, playerId, paid);
  }
  const row = roster.find((r) => r.player_id === playerId);
  if (!row) throw new HttpError(404, 'not_in_session', 'That player is not in this session.');
  if (seen !== null) {
    const now = seatCredit((await moneyPictureOf(ctx, group)).ledger, session.id, playerId, { paymentStatus: row.payment_status, paidAt: row.paid_at, refundedAt: row.refunded_at });
    const summary = (selfPaid: boolean) =>
      moneySeen({
        paymentStatus: row.payment_status,
        paymentAmountCents: row.payment_amount_cents,
        refunded: !!row.refunded_at,
        selfPaid,
        creditCents: now.usedCents,
        cashCents: now.cashCents,
        priceCents: sharesFor(session, roster, settingsOf(group)).get(playerId) ?? null,
        finalizedAt: session.finalized_at ?? null,
      });
    if (summary(!!row.self_paid_at) !== seen) {
      // A second device (or a retry) already did exactly this, confirming an I paid: the only difference from what
      // the screen showed is the confirm itself. Nothing to change, not an error. Anything else: look again.
      const onlyConfirmed = paid && !row.self_paid_at && row.status === 'confirmed' && row.payment_status === 'paid' && !row.refunded_at && summary(true) === seen;
      if (onlyConfirmed) return { ok: true, changed: false };
      throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
    }
  }

  // A claim (an unconfirmed I paid on a seat that left, a canceled game, or "did not play"): Mark paid and Unmark
  // answer it the way the Home card does (the player's own "Didn't pay?" clears it too).
  // An open late fee (shared/lateFees.ts) is paid like a seat that is in, also on a seat that left or a game canceled late.
  const fee = lateFeeKind(row, session);
  const isClaim =
    !fee &&
    isPaymentClaim(
      { status: row.status, paymentStatus: row.payment_status, selfPaid: !!row.self_paid_at, refundedAt: row.refunded_at, played: session.finalized_at && row.played === 0 ? false : null },
      session.status === 'canceled',
    );
  // The statements below are exactly as before for a seat that is in; for a seat read as an open late fee they check it
  // still is one instead (a change since the read means "look again").
  if (isClaim && (paid ? !self : true)) return answerClaimOn(ctx, group, session, playerId, paid);

  if (paid) {
    if (session.status === 'canceled' && !fee) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    if (row.status !== 'confirmed' && !fee) throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe a share.');
    const price = sharesFor(session, roster, settingsOf(group)).get(playerId);
    if (price === undefined) throw new HttpError(409, 'not_confirmed', 'Only confirmed players owe money.');
    if (row.payment_status === 'paid') {
      if (self || !row.self_paid_at) return { ok: true, changed: false };
      // Only while the seat is still in, paid and self-marked in a game that is on: a cancel or a drop at the same
      // moment made it a claim, which the claim card answers (confirming it here would leave the money nowhere).
      // Finalized and played above the final price: the money back was held until this payment was confirmed
      // (only confirmed money becomes credit); it comes back now, in the same batch.
      const finalCents = session.finalized_at && row.played === 1 ? session.final_price_cents : null;
      const back = finalCents !== null && finalCents !== undefined ? Math.max(0, (row.payment_amount_cents ?? 0) - finalCents) : 0;
      const confirmedNow = `NOT EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND self_paid_at IS NOT NULL)`;
      // Only while the game is the one read (not finalized, reopened or redone since): the money back worked out
      // above belongs to that finalize. A Finalize or Reopen at the same moment: look again.
      const asRead = `${session.finalized_at ?? ''}:${session.final_price_cents ?? -1}`;
      const [res] = await ctx.db.batch([
        ctx.db
          .prepare(
            `UPDATE session_players SET self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
             WHERE session_id = ?2 AND player_id = ?3 AND ${fee ? OPEN_FEE('session_players') : "status = 'confirmed'"} AND payment_status = 'paid' AND refunded_at IS NULL AND self_paid_at IS NOT NULL
               ${fee ? '' : "AND (SELECT status FROM sessions WHERE id = ?2) <> 'canceled'"}
               AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ?2) = ?4`,
          )
          .bind(ctx.nowIso, session.id, playerId, asRead),
        ...creditBackStatements(ctx.db, {
          groupId: group.id,
          sessionId: session.id,
          playerId,
          cents: back,
          reason: 'finalized',
          playedCount: session.final_played_count ?? null,
          nowIso: ctx.nowIso,
          settle: false,
          // Only with the finalize it was worked out for (a Reopen or redo since gives nothing here), and only if this
          // batch's own confirm went in on the payment it read (a "Didn't pay?" and a new Mark paid in between: nothing).
          guard: `${confirmedNow} AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ${sqlText(session.id)}) = '${asRead.replace(/'/g, '')}'
            AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND self_paid_at IS NULL
              AND payment_updated_at = ${sqlText(ctx.nowIso)} AND payment_amount_cents = ${Number(row.payment_amount_cents ?? 0)})`,
        }),
        // A game canceled late with the fee split (LATE_FEE_SPLIT): an I paid left waiting at the cancel is brought to
        // the split price now that it is real money, the rest back as credit (the cancel skipped it, as Finalize does).
        ...(fee === 'canceled_late' && feeSplitOf(session)
          ? splitSeatStatements(ctx.db, {
              groupId: group.id,
              sessionId: session.id,
              seat: { ...(await splitSeatOf(ctx, session.id, row)), paid: true, paymentCents: row.payment_amount_cents ?? 0 },
              priceCents: feeSplitOf(session)!.priceCents,
              nowIso: ctx.nowIso,
              guard: `${confirmedNow} AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND payment_updated_at = ${sqlText(ctx.nowIso)})
                AND (SELECT COALESCE(final_price_cents, -1) FROM sessions WHERE id = ${sqlText(session.id)}) = ${feeSplitOf(session)!.priceCents}`,
            }).statements
          : []),
      ]);
      if (res.meta.changes !== 1) {
        // A second device confirmed it first: already as wanted.
        const now = await ctx.db
          .prepare('SELECT status, payment_status, refunded_at, self_paid_at FROM session_players WHERE session_id = ? AND player_id = ?')
          .bind(session.id, playerId)
          .first<{ status: string; payment_status: string; refunded_at: string | null; self_paid_at: string | null }>();
        if ((now?.status === 'confirmed' || fee) && now?.payment_status === 'paid' && !now.refunded_at && !now.self_paid_at) return { ok: true, changed: false };
        throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
      }
      await audit(ctx.db, group.id, session.id, 'marked_paid', { player: row.display_name, confirmed: true }, ctx.nowIso);
      return { ok: true, changed: true };
    }
    // The payment is the whole price: cash now, plus credit and cash already on this seat.
    const seat = seatCredit((await moneyPictureOf(ctx, group)).ledger, session.id, playerId, { paymentStatus: row.payment_status, paidAt: row.paid_at, refundedAt: row.refunded_at });
    const used = seat.usedCents + seat.cashCents;
    // The screen said one amount and the price has changed since (a Finalize or Reopen at that moment, or an old
    // screen): recording the new price would not match what they sent.
    if (shownCents !== null && shownCents !== price - used) {
      throw new HttpError(409, 'amount_changed', `The amount changed to ${formatCents(price - used).replace('.00', '')}. Look again.`);
    }
    // Only while the seat is still in and unpaid with exactly that credit on it: a drop, a double tap or a
    // Use credit at the same moment can't record a payment on a seat that left or changed.
    const res = await ctx.db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ?2, self_paid_at = ?3,
           payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?4 AND player_id = ?5 AND ${fee ? OPEN_FEE('session_players') : "status = 'confirmed'"} AND payment_status = 'unpaid'
           AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ?4) = ?7
           AND (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?4 AND player_id = ?5 AND ended_at IS NULL) = ?6
           ${fee ? '' : "AND (SELECT status FROM sessions WHERE id = ?4) <> 'canceled'"}`,
      )
      // The finalize as read (when and at what price): a Reopen or a redo since, even at the same price, means look again.
      .bind(ctx.nowIso, price, self ? ctx.nowIso : null, session.id, playerId, used, `${session.finalized_at ?? ''}:${session.final_price_cents ?? -1}`)
      .run();
    if (res.meta.changes !== 1) {
      const now = (await loadRoster(ctx.db, session.id)).find((r) => r.player_id === playerId);
      if (now?.payment_status === 'paid') return { ok: true, changed: false };
      throw new HttpError(409, 'changed', 'This game just changed. Look again.');
    }
    await audit(
      ctx.db,
      group.id,
      session.id,
      self ? 'player_self_paid' : 'marked_paid',
      { player: row.display_name, amountCents: price, cashCents: price - used, creditCents: used },
      ctx.nowIso,
      actor ?? (self ? self : 'organizer'),
      self ? phoneTagOf(ctx) : null,
    );
  } else {
    if (row.payment_status !== 'paid') {
      // "Credit $3" on a seat that still owes: the organizer's Unmark puts that credit back in the player's pot.
      if (self || (row.status !== 'confirmed' && !fee)) return { ok: true, changed: false };
      // Only while the game is the one this tap read (a Finalize at the same moment may have paid the seat with it).
      const back = await returnSeatCredit(ctx.db, session.id, playerId, ctx.nowIso, 'unmarked', { creditOnly: true, finalizedAsRead: session.finalized_at ?? null });
      if (back <= 0) return { ok: true, changed: false };
      await audit(ctx.db, group.id, session.id, 'marked_unpaid', { player: row.display_name, creditReturnedCents: back }, ctx.nowIso, actor ?? 'organizer');
      return { ok: true, changed: true };
    }
    if (self && !row.self_paid_at) throw new HttpError(409, 'organizer_marked', 'The organizer marked this paid. Ask them to change it.');
    if (row.refunded_at) throw new HttpError(409, 'already_settled', 'That payment already came back to them as credit.');
    // One batch: credit that came back from this payment (paid above the final price) is taken back first, only
    // if all of it is still there; the seat is unpaid only once it is; the organizer unmarking takes the credit
    // from the pot back too (a player's own "Didn't pay?" only undoes their cash).
    // Unmark undoes only the latest payment (Alex, Oct 31): when cash was paid on top of the credit (and of cash
    // paid earlier toward the seat), only that cash goes; the credit and the earlier cash stay on the seat, and a
    // second Unmark on "Credit $3" puts the credit back. A payment that was all credit gives the credit back.
    const onSeat = seatCredit((await moneyPictureOf(ctx, group)).ledger, session.id, playerId, { paymentStatus: row.payment_status, paidAt: row.paid_at, refundedAt: row.refunded_at });
    const latestCash = (row.payment_amount_cents ?? 0) - onSeat.usedCents - onSeat.cashCents;
    const before = await creditReturnedAt(ctx.db, session.id, playerId, 'unmarked', ctx.nowIso);
    // Everything below was worked out for the game as read: a Finalize or Reopen landing first means look again.
    const finalizeAsRead = `${session.finalized_at ?? ''}:${session.final_price_cents ?? -1}`;
    const [, unpaid] = await ctx.db.batch([
      ...undoFinalizedBackStatements(ctx.db, session.id, playerId, ctx.nowIso, finalizeAsRead),
      ctx.db
        .prepare(
          `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed'${fee ? ` OR ${OPEN_FEE('session_players')}` : ''} THEN 'unpaid' ELSE 'not_applicable' END,
             paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
           WHERE session_id = ?2 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE kind = 'kept' AND session_id = ?2 AND player_id = ?3 AND ended_at IS NULL AND reason = 'finalized')
             AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ?2) = ?4`,
        )
        .bind(ctx.nowIso, session.id, playerId, finalizeAsRead),
      // Only its ledger statement: that one moves credit only once the seat is unpaid, so a blocked Unmark moves nothing.
      ...(self || latestCash > 0
        ? []
        : returnSeatCreditStatements(ctx.db, session.id, playerId, ctx.nowIso, 'unmarked', { creditOnly: true, finalizedAsRead: session.finalized_at ?? null }).slice(1)),
      // A seat that left the game, or a canceled game (an unconfirmed I paid kept it frozen): once the claim is
      // gone, whatever it still holds goes back to the player, as on any drop or cancel.
      ...seatMoneyBackStatements(ctx.db, {
        groupId: group.id,
        sessionId: session.id,
        playerId,
        organizerId: await organizerIdOf(ctx.db, group),
        reason: session.status === 'canceled' ? 'canceled' : 'dropped',
        nowIso: ctx.nowIso,
        // Any seat that is not in (withdrawn, waitlisted, declined) or a canceled game: the same seats as a claim.
        when: (sp) => `(${sp}.status <> 'confirmed' OR (SELECT status FROM sessions WHERE id = ${sp}.session_id) = 'canceled')`,
      }),
      // Only the latest cash went: the credit (and cash held) left on the seat may cover its price on its own. Then
      // the seat is paid with it, and on a finalized game that played, what is above the final price comes back as
      // credit, as Finalize does (never left unused on a seat that owes nothing).
      ...(latestCash > 0 ? repriceStatements(ctx.db, session.id, flatOf(session, settingsOf(group)), ctx.nowIso) : []),
      ...(latestCash > 0 && session.finalized_at && row.played === 1 && session.final_price_cents !== null && session.final_price_cents !== undefined
        ? creditBackStatements(ctx.db, {
            groupId: group.id,
            sessionId: session.id,
            playerId,
            cents: onSeat.usedCents + onSeat.cashCents - session.final_price_cents,
            reason: 'finalized',
            playedCount: session.final_played_count ?? null,
            nowIso: ctx.nowIso,
            settle: false,
            // Only once the reprice paid the seat with exactly that credit, in the finalize this Unmark read.
            guard: `EXISTS (SELECT 1 FROM session_players WHERE session_id = ${sqlText(session.id)} AND player_id = ${sqlText(playerId)} AND payment_status = 'paid' AND self_paid_at IS NULL AND payment_amount_cents = ${onSeat.usedCents + onSeat.cashCents})
              AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ${sqlText(session.id)}) = '${finalizeAsRead.replace(/'/g, '')}'`,
          })
        : []),
    ]);
    if (unpaid.meta.changes !== 1) {
      const fresh = await getSession(ctx.db, group.id, session.id);
      if (`${fresh?.finalized_at ?? ''}:${fresh?.final_price_cents ?? -1}` !== finalizeAsRead) throw new HttpError(409, 'changed', `${row.display_name}'s payment just changed. Look again.`);
      if ((await creditBackLeft(ctx.db, session.id, playerId)) > 0) {
        if (await hasPendingRequest(ctx.db, playerId))
          throw new HttpError(409, 'refund_requested', `${row.display_name} asked for this credit back, so this payment can't be unmarked. Answer the refund request on Home first.`);
        throw new HttpError(409, 'credit_spent', `${row.display_name} already used the credit from this game, so this payment can't be unmarked.`);
      }
      return { ok: true, changed: false };
    }
    const creditBack = self ? 0 : (await creditReturnedAt(ctx.db, session.id, playerId, 'unmarked', ctx.nowIso)) - before;
    await audit(
      ctx.db,
      group.id,
      session.id,
      self ? 'player_self_unpaid' : 'marked_unpaid',
      { player: row.display_name, previousAmountCents: row.payment_amount_cents, previousPaidAt: row.paid_at, ...(creditBack > 0 ? { creditReturnedCents: creditBack } : {}) },
      ctx.nowIso,
      actor ?? (self ? self : 'organizer'),
      self ? phoneTagOf(ctx) : null,
    );
  }
  return { ok: true, changed: true };
}

/** The organizer paid the venue (or took that back). No share, no credit, nothing counted as collected. */
async function applyCourtPayment(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string, paid: boolean) {
  if (paid && session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  const amountCents = courtCostOf(session, settingsOf(group));
  // The organizer is found by name until their id is saved. A court payment ties money to that person, so their
  // id is saved now: a later rename can never turn this row into a player's.
  if (paid && !group.organizer_player_id) {
    await ctx.db.prepare('UPDATE groups SET organizer_player_id = ? WHERE id = ? AND organizer_player_id IS NULL').bind(playerId, group.id).run();
  }
  const changed = await setCourtPaid(ctx.db, session, playerId, paid, amountCents, ctx.nowIso);
  if (changed) await audit(ctx.db, group.id, session.id, paid ? 'court_paid' : 'court_unpaid', paid ? { amountCents } : {}, ctx.nowIso);
  return { ok: true, changed };
}

/**
 * Remove a name. Someone with no history (never signed up, never paid) is
 * deleted completely. Anyone with history is hidden instead, so old
 * sessions and payments stay intact.
 */
export async function removePlayer(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(id, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  // Zip 27 (A-04): someone still in (or waiting for) a game that has not ended is not removed: hidden, they would stay in "N in" and owe
  // their share, and their phone could no longer drop them out. The organizer takes them out of those games first (gear > Players), then
  // removes the name. Nothing is changed by the refusal.
  const { results: upcoming } = await ctx.db
    .prepare(
      `SELECT s.starts_at FROM session_players sp JOIN sessions s ON s.id = sp.session_id
       WHERE sp.player_id = ? AND s.group_id = ? AND sp.status IN ('confirmed', 'waitlisted') AND s.status <> 'canceled' AND s.ends_at > ?
       ORDER BY s.starts_at`,
    )
    .bind(id, group.id, ctx.nowIso)
    .all<{ starts_at: string }>();
  if (upcoming.length > 0) {
    const days = upcoming.map((u) => formatShortDate(u.starts_at, group.timezone));
    const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    const list = days.length <= 3 ? and(days) : `${days.slice(0, 3).join(', ')} and ${days.length - 3} more`;
    throw new HttpError(
      409,
      'player_in_games',
      `${p.display_name} is still in ${upcoming.length === 1 ? 'a game' : `${upcoming.length} games`} (${list}). Take ${p.display_name} out of ${upcoming.length === 1 ? 'it' : 'them'} first (gear > Players), then remove the name.`,
    );
  }
  const history = await ctx.db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM session_players WHERE player_id = ?1 AND (status <> 'declined' OR payment_status = 'paid')) +
         (SELECT COUNT(*) FROM credit_ledger WHERE player_id = ?1) +
         (SELECT COUNT(*) FROM refund_requests WHERE player_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if ((history?.n ?? 0) > 0) {
    await ctx.db.prepare('UPDATE players SET is_active = 0, is_new = 0 WHERE id = ?').bind(id).run();
    await audit(ctx.db, group.id, null, 'player_hidden', { name: p.display_name }, ctx.nowIso);
    return { result: 'hidden' };
  }
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM player_devices WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM session_action_tokens WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM session_players WHERE player_id = ?').bind(id),
    ctx.db.prepare('DELETE FROM players WHERE id = ? AND group_id = ?').bind(id, group.id),
  ]);
  await audit(ctx.db, group.id, null, 'player_deleted', { name: p.display_name }, ctx.nowIso);
  return { result: 'deleted' };
}

/** The organizer sent the "Good news, you're in" text to someone moved off the waitlist. */
export async function markTold(ctx: Ctx, body: Record<string, unknown>) {
  const { session } = await adminSession(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  await ctx.db
    .prepare(
      `UPDATE session_players SET promotion_notified_at = ?, updated_at = ?
       WHERE session_id = ? AND player_id = ? AND promoted_at IS NOT NULL AND promotion_notified_at IS NULL`,
    )
    .bind(ctx.nowIso, ctx.nowIso, session.id, playerId)
    .run();
  return { ok: true };
}

/**
 * Create personal links for text messages. The server picks who is
 * eligible; the browser only gets to narrow that list down.
 */
export async function prepareLinks(ctx: Ctx, body: Record<string, unknown>): Promise<{ drafts: ActionLinkDraft[] }> {
  const { group, session } = await adminSession(ctx);
  const kind = v.oneOf(body.kind, 'kind', ['attendance', 'claim'] as const);
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
  const wanted = Array.isArray(body.playerIds) ? new Set(body.playerIds.map((x) => v.id(x, 'playerIds'))) : null;
  const roster = await loadRoster(ctx.db, session.id);

  let recipients: { playerId: string; name: string; phone: string | null }[];
  if (kind === 'attendance') {
    recipients = confirmedOf(roster)
      .filter((r) => !r.attendance_confirmed_at)
      .map((r) => ({ playerId: r.player_id, name: r.display_name, phone: r.phone_number }));
  } else {
    if (openSpots(confirmedOf(roster).length, capOf(settingsOf(group))) === 0) {
      throw new HttpError(409, 'session_full', 'No spots are open right now.');
    }
    recipients = eligibleSubstitutes(roster, await getPlayers(ctx.db, group.id));
  }
  if (wanted) recipients = recipients.filter((r) => wanted.has(r.playerId));

  const drafts: ActionLinkDraft[] = [];
  for (const r of recipients) {
    const token = await issueToken(ctx.db, session, r.playerId, kind, ctx.nowIso);
    drafts.push({ ...r, url: `${ctx.url.origin}/t/${token}` });
  }
  return { drafts };
}

export async function generateSessions(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const created = await ensureSessions(ctx.db, group, ctx.nowMs);
  return { created };
}

function playerFields(body: Record<string, unknown>) {
  return {
    name: v.playerName(body.name),
    phone: v.optionalPhone(body.phone),
    isRegular: v.optionalBool(body.isRegular, 'isRegular', true),
    isActive: v.optionalBool(body.isActive, 'isActive', true),
    canReceiveSubstituteInvites: v.optionalBool(body.canReceiveSubstituteInvites, 'canReceiveSubstituteInvites', true),
    usualDays: v.usualDays(body.usualDays),
    venmo: v.venmoHandle(body.venmo),
  };
}

function uniqueNameError(err: unknown): never {
  if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'duplicate_name', 'Another player already has that name.');
  throw err;
}

export async function createPlayer(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const f = playerFields(body);
  const count = await ctx.db.prepare('SELECT COUNT(*) AS n FROM players WHERE group_id = ?').bind(group.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) throw new HttpError(409, 'too_many_players', 'That is enough players for one group.');
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO players (id, group_id, display_name, phone_number, is_regular, is_active, can_receive_substitute_invites, sort_order, created_at, usual_days, venmo_handle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, group.id, f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, count?.n ?? 0, ctx.nowIso, f.usualDays ?? '', f.venmo ?? null)
      .run();
  } catch (err) {
    uniqueNameError(err);
  }
  await audit(ctx.db, group.id, null, 'player_added', { name: f.name }, ctx.nowIso);
  return { id };
}

export async function updatePlayer(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const f = playerFields(body);
  let res;
  try {
    res = await ctx.db
      .prepare(
        `UPDATE players SET display_name = ?, phone_number = ?, is_regular = ?, is_active = ?, can_receive_substitute_invites = ?,
           usual_days = COALESCE(?, usual_days), is_new = 0,
           venmo_handle = CASE WHEN ? = 1 THEN ? ELSE venmo_handle END
         WHERE id = ? AND group_id = ?`,
      )
      .bind(f.name, f.phone, +f.isRegular, +f.isActive, +f.canReceiveSubstituteInvites, f.usualDays, +(f.venmo !== undefined), f.venmo ?? null, id, group.id)
      .run();
  } catch (err) {
    uniqueNameError(err);
  }
  if (res.meta.changes !== 1) throw new HttpError(404, 'player_not_found', 'Player not found.');
  await audit(ctx.db, group.id, null, 'player_updated', { name: f.name, active: f.isActive }, ctx.nowIso);
  return { ok: true };
}

export async function updateGroup(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  // Fields left out of the request keep their saved values (Settings saves one row at a time).
  const name = body.name === undefined ? group.name : v.text(body.name, 'name', { max: 60 });
  const venmoUrl = body.venmoUrl === undefined ? group.venmo_url : v.optionalUrl(body.venmoUrl, 'venmoUrl');
  const organizerName = body.organizerName === undefined ? group.organizer_name : v.optionalText(body.organizerName, 'organizerName', 40);
  const venueName = body.venueName === undefined ? group.venue_name : v.optionalText(body.venueName, 'venueName', 80);
  const venueAddress = body.venueAddress === undefined ? group.venue_address : v.optionalText(body.venueAddress, 'venueAddress', 160);
  const firstSessionDate = body.firstSessionDate === undefined ? group.first_session_date : v.optionalDate(body.firstSessionDate, 'firstSessionDate');
  const openAccess = body.openAccess === undefined ? !!group.open_access : v.bool(body.openAccess, 'openAccess');
  // Group word: leave out to keep it, null or "" to remove it.
  let wordHash = group.group_word_hash;
  if (body.groupWord !== undefined) {
    const word = v.optionalText(body.groupWord, 'groupWord', 40);
    if (word !== null && word.length < 2) throw new HttpError(400, 'invalid_groupWord', 'The group word needs at least 2 letters.');
    wordHash = word === null ? null : await hashGroupWord(word);
  }
  const settings = normalizeSettings({ ...settingsOf(group), ...(body.settings as object) });
  // Zip 24 "Booking hours": a CHANGED usual game time (Settings > Schedule) must sit inside the venue hours. Any other save is untouched.
  {
    const before = settingsOf(group);
    if (settings.defaultStartMinutes !== before.defaultStartMinutes || settings.defaultEndMinutes !== before.defaultEndMinutes) {
      await enforceUsualTime(ctx, group.id, settings.defaultStartMinutes, settings.defaultEndMinutes);
    }
  }
  // The Apple Pay / Zelle number lives inside settings_json (normalizeSettings only keeps the numbers, so it is put back here).
  let zelleRaw: string | undefined = (() => {
    try {
      const z = (JSON.parse(group.settings_json || '{}') as { zelleNumber?: unknown }).zelleNumber;
      return typeof z === 'string' ? z : undefined;
    } catch {
      return undefined;
    }
  })();
  if (body.zelleNumber !== undefined) {
    const z = v.optionalText(body.zelleNumber, 'zelleNumber', 24);
    if (z !== null && !/^[0-9+().\s-]{7,24}$/.test(z)) throw new HttpError(400, 'invalid_zelleNumber', 'Enter a phone number, like 248-555-0123.');
    zelleRaw = z ?? '';
  }
  const storedSettings = zelleRaw === undefined ? settings : { ...settings, zelleNumber: zelleRaw };
  // Zip 27 (A-01): a new "Price per player" or "Typical court cost" never re-prices a finalized game. Its rules are written down first,
  // from what it shows right now (a failure here changes nothing). Any other save is untouched.
  {
    const before = settingsOf(group);
    if (settings.pricePerPlayerCents !== before.pricePerPlayerCents || settings.typicalCourtCostCents !== before.typicalCourtCostCents) {
      await lockFinalizedGames(ctx.db, group.id, await everyoneSettings(ctx, group), ctx.nowIso);
    }
  }
  // The room before this save, from the saved setting (a "Card cleanup" test link on this phone must not change that). With the switch on
  // for everyone nobody is waiting, so a move-in below finds nobody.
  const oldMax = settingsOf(group).maxPlayers;
  await ctx.db
    .prepare(
      `UPDATE groups SET name = ?, venmo_url = ?, settings_json = ?, organizer_name = ?, venue_name = ?, venue_address = ?, first_session_date = ?,
         open_access = ?, group_word_hash = ?
       WHERE id = ?`,
    )
    .bind(name, venmoUrl, JSON.stringify(storedSettings), organizerName, venueName, venueAddress, firstSessionDate, openAccess ? 1 : 0, wordHash, group.id)
    .run();
  await audit(
    ctx.db,
    group.id,
    null,
    'settings_updated',
    { name, venmoUrl, organizerName, venueName, venueAddress, firstSessionDate, openAccess, groupWordSet: !!wordHash, settings, ...(zelleRaw === undefined ? {} : { zelleNumber: zelleRaw }) },
    ctx.nowIso,
  );
  await ensureSessions(ctx.db, { ...group, settings_json: JSON.stringify(storedSettings), first_session_date: firstSessionDate }, ctx.nowMs);
  // Zip 39, Audit A item A-18 ("Made cheaper after paying", server/cheaperFix.ts; off: nothing here, exactly main's): a new "Price per player"
  // changes the flat price of every open game that follows it, so their seats are repriced now, the way the Short games and Booking hours
  // switches already do it: an unpaid seat whose credit now covers the price is paid with it, a seat paid with credit that is now short owes
  // the rest. Cash is never taken back (it is settled at Finalize). A finalized game keeps its lock (Zip 27) and is not open anyway; a 1.5,
  // 2.5 or 3 hour game priced by its own row does not change, so nothing is written for it.
  if (settings.pricePerPlayerCents !== settingsOf(group).pricePerPlayerCents && (await cheaperFixFor(ctx, group.id, true))) {
    // The rules for EVERYONE (the Settings rows), never this phone's private Short games link: the new price is everyone's.
    const everyone = await everyoneSettings(ctx, group);
    const flags = { ...(everyone.shortGames === true ? { shortGames: true as const } : {}), ...(everyone.longGames === true ? { longGames: true as const } : {}) };
    const before = { ...settingsOf(group), ...flags };
    const after = { ...settings, ...flags };
    const { results: open } = await ctx.db
      .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND status <> 'canceled' AND finalized_at IS NULL AND ends_at > ?`)
      .bind(group.id, new Date(ctx.nowMs - 30 * 86_400_000).toISOString())
      .all<SessionRow>();
    for (const s of open) {
      if (flatOf(s, after) !== flatOf(s, before)) await ctx.db.batch(repriceStatements(ctx.db, s.id, flatOf(s, after), ctx.nowIso));
    }
  }
  if (settings.maxPlayers > oldMax) {
    // More room: people already waiting move in, first in line first, exactly as after a drop (their credit goes on the
    // same way). Without this the next new I'm in would take the seat ahead of them.
    const { results: open } = await ctx.db
      .prepare("SELECT * FROM sessions WHERE group_id = ? AND status <> 'canceled' AND starts_at > ? ORDER BY starts_at")
      .bind(group.id, ctx.nowIso)
      .all<SessionRow>();
    // The saved settings plus this request's "Short games" answer (normalizeSettings drops it), so a move-in pays the game's own price.
    for (const s of open) await settle(ctx.db, s, ctx.nowIso, { ...settings, ...(group.short_games === true ? { shortGames: true as const } : {}), ...(group.long_games === true ? { longGames: true as const } : {}) });
  }
  return { ok: true };
}

export async function changePin(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (typeof body.currentPin !== 'string' || !(await verifyPin(body.currentPin, group.admin_pin_hash))) {
    throw new HttpError(401, 'wrong_pin', 'Current PIN is not right.');
  }
  const next = v.pin(body.newPin, 'newPin');
  // Never let the real PIN become the read-only one (that PIN is meant to be handed to helpers).
  if (next === readOnlyPin(ctx.env)) throw new HttpError(400, 'invalid', 'Pick a different PIN.');
  await ctx.db.prepare('UPDATE groups SET admin_pin_hash = ? WHERE id = ?').bind(await hashPin(next), group.id).run();
  await revokeAdminSessions(ctx, group.id);
  await startAdminSession(ctx, group.id);
  await audit(ctx.db, group.id, null, 'pin_changed', {}, ctx.nowIso);
  return { ok: true };
}

export async function rotateLink(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  const key = randomToken(18);
  await ctx.db.prepare('UPDATE groups SET group_key = ? WHERE id = ?').bind(key, group.id).run();
  await audit(ctx.db, group.id, null, 'player_link_rotated', {}, ctx.nowIso);
  return { playerLink: playerLinkFor(ctx, { ...group, group_key: key }) };
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Stop spreadsheet apps from treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportData(ctx: Ctx): Promise<Response> {
  const group = await requireAdmin(ctx);
  const tz = group.timezone;
  const sessions = await loadSessions(ctx.db, group.id, '0000');
  const rosters = await loadRosters(ctx.db, group.id, '0000');
  const organizerId = await organizerIdOf(ctx.db, group);
  const header = [
    'Date', 'Time', 'Session status', 'Court booking', 'Venue', 'Reservation',
    'Cancellation deadline', 'Player', 'Player status', 'Price', 'Payment', 'Paid at', 'Amount paid', 'Refunded at',
  ];
  const settings = settingsOf(group);
  const lines = [header.map(csvCell).join(',')];
  for (const s of sessions) {
    const roster = rosters.get(s.id) ?? [];
    const shares = sharesFor(s, roster, settings);
    const base = [
      formatShortDate(s.starts_at, tz),
      formatTimeRange(s.starts_at, s.ends_at, tz),
      s.status,
      s.booking_status,
      s.venue_name,
      s.reservation_reference,
      s.cancellation_deadline_at ? formatDateTime(s.cancellation_deadline_at, tz) : '',
    ];
    if (roster.length === 0) lines.push([...base, '', '', '', '', '', '', ''].map(csvCell).join(','));
    for (const r of roster) {
      // The organizer pays the venue: no player price, and their paid mark is the court.
      const isMe = r.player_id === organizerId;
      const share = isMe ? undefined : shares.get(r.player_id);
      lines.push(
        [
          ...base,
          r.display_name,
          r.status,
          share === undefined ? '' : formatCents(share),
          isMe && r.payment_status !== 'not_applicable' ? (r.payment_status === 'paid' ? 'court paid' : 'court due') : r.payment_status,
          r.paid_at ? formatDateTime(r.paid_at, tz) : '',
          r.payment_amount_cents === null ? '' : formatCents(r.payment_amount_cents),
          r.refunded_at ? formatDateTime(r.refunded_at, tz) : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pickleball-export.csv"',
      'Cache-Control': 'no-store',
    },
  });
}

// The backup's tables live in server/backupData.ts (shared with the weekly copy, worker/backup.ts).
export { BACKUP_TABLES } from './backupData';

/**
 * GET /api/admin/backup: everything needed to rebuild the site's data, as
 * one file. Restore it with scripts/restore-backup.mjs (docs/RESTORE.md).
 * Organizer only. It holds phone numbers and the PIN's hash, so it's private.
 */
export async function backupFile(ctx: Ctx): Promise<Response> {
  const group = await requireAdmin(ctx);
  const p = localParts(ctx.nowMs, group.timezone);
  const stamp = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const backup = await backupObject(ctx.db, group.name, ctx.nowIso);
  // Read-only PIN (server/viewOnly.ts): never hand out the real PIN's hash or the group word's hash (a short PIN can be guessed
  // from its hash offline). The file is otherwise the same, so View as still works; a restore needs the real PIN's own file.
  if (viewOnlyCookie(ctx)) backup.tables.groups = backup.tables.groups.map((g) => ({ ...g, admin_pin_hash: '', group_word_hash: null }));
  // Zip 30: nor the phone codes (History's device_tag): a helper with the read-only PIN gets the History lines without them.
  if (viewOnlyCookie(ctx) && backup.tables.admin_audit_log) backup.tables.admin_audit_log = backup.tables.admin_audit_log.map((r) => ('device_tag' in r ? { ...r, device_tag: null } : r));
  const body = JSON.stringify(backup, null, 1);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pickleball-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const ACTIVITY_PAGE = 80;

/** Zip 30: the organizer's own player name (only asked while "Acting for others" is on). */
async function organizerNameOf(ctx: Ctx, group: GroupRow): Promise<string | null> {
  const id = await organizerIdOf(ctx.db, group);
  if (!id) return null;
  const row = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(id).first<{ display_name: string }>();
  return row?.display_name ?? null;
}

/** GET /api/admin/activity?before=<iso>: History > Activity, newest first. */
export async function activity(ctx: Ctx): Promise<ActivityPage> {
  const group = await requireAdmin(ctx);
  const before = ctx.url.searchParams.get('before');
  const until = before && !Number.isNaN(Date.parse(before)) ? before : '9999';
  const { results } = await ctx.db
    .prepare(
      `SELECT a.*, s.starts_at AS session_starts_at FROM admin_audit_log a LEFT JOIN sessions s ON s.id = a.session_id
       WHERE a.group_id = ? AND a.created_at < ? ORDER BY a.created_at DESC LIMIT ?`,
    )
    .bind(group.id, until, ACTIVITY_PAGE + 1)
    .all<{ id: string; actor_label: string; action: string; details_json: string; created_at: string; session_starts_at: string | null }>();
  // Zip 30 "Acting for others" (server/actingForOthers.ts): a tap made for someone else gets "from Mitchel's phone", only while on (off: this
  // answer is exactly main's and the phone-code read never runs).
  const acting = await actingOthersFlags(ctx, group.id);
  const judged = acting.on
    ? (await actingOthersPicture(ctx.db, group.id, ctx.nowMs, [group.organizer_name, await organizerNameOf(ctx, group)])).judged
    : null;
  return {
    entries: results.slice(0, ACTIVITY_PAGE).map((a) => {
      const from = judged?.get(a.id);
      return {
        id: a.id,
        actorLabel: a.actor_label,
        action: a.action,
        details: safeParse(a.details_json),
        createdAt: a.created_at,
        sessionStartsAt: a.session_starts_at,
        ...(from ? { from: fromNote(from) } : {}),
      };
    }),
    more: results.length > ACTIVITY_PAGE,
  };
}

/**
 * POST /api/admin/sessions { startsAt, endsAt, note? }: a one-off game.
 * It works like any other session from then on. The same date and time as
 * an existing game is refused, so a double tap can't make two.
 */
export async function addGame(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const startsAt = v.isoTime(body.startsAt, 'startsAt');
  const endsAt = v.isoTime(body.endsAt, 'endsAt');
  if (!startsAt || !endsAt) throw new HttpError(400, 'invalid_time', 'Pick a date, start time, and end time.');
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  if (length <= 0) throw new HttpError(400, 'invalid_time', 'The end time must be after the start time.');
  if (length > 6 * 3600_000) throw new HttpError(400, 'invalid_time', 'A game can be at most 6 hours long.');
  if (Date.parse(startsAt) <= ctx.nowMs) throw new HttpError(400, 'invalid_time', 'Pick a time in the future.');
  // Zip 24 "Booking hours": a new game must sit inside the venue hours.
  await enforceBookingHours(ctx, group.id, group.timezone, startsAt, endsAt);
  const note = v.optionalText(body.note, 'note', 80);
  // Zip 14: the court from the Court row (only there while "Game day card" is on). Off: ignored, exactly as main ignores a field it does not know.
  const court = body.court !== undefined && body.court !== null && (await gameDayCardFor(ctx, group.id)) ? courtBody(body.court) : null;
  const tz = group.timezone;
  const clash = await ctx.db
    .prepare('SELECT id, status FROM sessions WHERE group_id = ? AND starts_at = ?')
    .bind(group.id, startsAt)
    .first<{ id: string; status: string }>();
  if (clash) {
    const when = formatDateTime(startsAt, tz);
    throw new HttpError(
      409,
      'game_exists',
      clash.status === 'canceled' ? `There's already a canceled game at ${when}. Reopen it instead.` : `There's already a game at ${when}.`,
    );
  }
  const settings = settingsOf(group);
  const id = newId();
  // Before the first session date, a game still shows (like "Show this session").
  const early = startsAt < visibleFrom(group) ? 1 : 0;
  try {
    await ctx.db
      .prepare(
        // One insert. The court column is named only when a court was picked, so a game added without one is exactly the old insert.
        `INSERT INTO sessions (id, group_id, starts_at, ends_at, cancellation_deadline_at, is_extra, note, shown_early, created_at, updated_at${court !== null ? ', court' : ''})
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?${court !== null ? ', ?' : ''})`,
      )
      .bind(id, group.id, startsAt, endsAt, defaultDeadline(startsAt, settings), note, early, ctx.nowIso, ctx.nowIso, ...(court !== null ? [court] : []))
      .run();
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) throw new HttpError(409, 'game_exists', `There's already a game at ${formatDateTime(startsAt, tz)}.`);
    throw err;
  }
  await audit(ctx.db, group.id, id, 'session_added', { startsAt, note, ...(court !== null ? { court } : {}) }, ctx.nowIso);
  return { id };
}

/** The organizer's own player record: the saved one, else a player with their name. */
export async function organizerPlayer(ctx: Ctx, group: GroupRow, create: boolean): Promise<{ id: string; name: string } | null> {
  if (group.organizer_player_id) {
    const p = await ctx.db
      .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ?')
      .bind(group.organizer_player_id, group.id)
      .first<{ id: string; display_name: string }>();
    if (p) return { id: p.id, name: p.display_name };
  }
  const name = (group.organizer_name ?? '').trim();
  if (!name) return null;
  const all = await getPlayers(ctx.db, group.id);
  let p = all.find((x) => x.display_name.trim().toLowerCase() === name.toLowerCase());
  if (!p && !create) return null;
  let id = p?.id;
  if (!id) {
    id = newId();
    await ctx.db
      .prepare(
        `INSERT INTO players (id, group_id, display_name, is_regular, is_active, can_receive_substitute_invites, sort_order, created_at)
         VALUES (?, ?, ?, 1, 1, 0, ?, ?)`,
      )
      .bind(id, group.id, name, all.length, ctx.nowIso)
      .run();
  } else if (!p!.is_active) {
    await ctx.db.prepare('UPDATE players SET is_active = 1 WHERE id = ?').bind(id).run();
  }
  if (create) await ctx.db.prepare('UPDATE groups SET organizer_player_id = ? WHERE id = ?').bind(id, group.id).run();
  return { id, name: p?.display_name ?? name };
}

/**
 * POST /api/admin/sessions/:id/me { in }: the organizer signs up (or drops
 * out) like any player, under their name from Settings. Real, and logged.
 */
export async function organizerInOut(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const goingIn = v.bool(body.in, 'in');
  const me = await organizerPlayer(ctx, group, true);
  if (!me) throw new HttpError(400, 'name_needed', 'Add your name in Settings first (Group > Your name).');
  if (goingIn) {
    const res = await joinSession(ctx.db, session, me.id, ctx.nowMs, 'auto', settingsOf(group));
    await clearLateDrop(ctx.db, session.id, me.id);
    if (res.result !== 'already_confirmed') await audit(ctx.db, group.id, session.id, 'player_join', { player: me.name, result: res.result, organizer: true }, ctx.nowIso, me.name);
    return res;
  }
  // Late fees: the organizer's own late drop counts like any player's (it can leave them owing $14, cleared in one tap).
  const lateFees = await lateFeesFor(ctx, group.id);
  const res = await withdraw(ctx.db, group, session, me.id, ctx.nowMs, { lateFees });
  const late = res.freedSpot ? await recordLateDrop(ctx.db, session, me.id, ctx.nowMs, settingsOf(group), lateFees) : false;
  if (res.changed) await audit(ctx.db, group.id, session.id, 'player_withdraw', { player: me.name, result: 'withdrawn', late, organizer: true, ...(res.lateFee ? { owes: true } : {}) }, ctx.nowIso, me.name);
  if (res.lateFee) await auditLateFeeOwed(ctx.db, group.id, session.id, me.id, 'late_drop', ctx.nowIso, me.name, specialFlatOf(session, settingsOf(group)));
  return { result: res.changed ? 'withdrawn' : 'not_in_session', ...(res.lateFee ? { lateFee: { cents: flatOf(session, settingsOf(group)) } } : {}) };
}

/** PUT /api/admin/time-shift { on }: Settings > "Moved-game notice for everyone". Changes no money and no seat. */
export async function setTimeShift(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setTimeShiftForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'time_shift_on' : 'time_shift_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/pay-always { on }: Settings > "Ask for payment on every game". Display only: changes no money and no seat. */
export async function setPayAlways(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPayAlwaysForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'pay_always_on' : 'pay_always_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/pay-note { on }: Settings > Feature switches > "No Venmo? note". Display only: changes no money and no seat. */
export async function setPayNote(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPayNoteForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'pay_note_on' : 'pay_note_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/player-fix1 { on }: Settings > Feature switches > "Player screen fixes". Display only: changes no money and no seat. */
export async function setPlayerFix1(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPlayerFix1ForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'player_fix1_on' : 'player_fix1_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/texts-r2 { on }: Settings > Feature switches > "Texts and alerts, round 2". New wording for the prefilled texts and
 * the Telegram alerts, new alert timing, and the cancel sheet answering No by default. Changes no money, amount or game rule.
 */
export async function setTextsR2(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setTextsR2ForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'texts_r2_on' : 'texts_r2_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/late-fee-split { on }: Settings > Feature switches > "Late-cancel fee split". CHANGES MONEY for new fee-kept
 * cancels only (shared/lateFees.ts); games already canceled keep the price they were canceled with.
 */
export async function setLateFeeSplit(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setLateFeeSplitForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'late_fee_split_on' : 'late_fee_split_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/money-rework { on }: Settings > Feature switches > "Money page rework". Admin screens only: changes no money, seat or credit. */
export async function setMoneyRework(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setMoneyReworkForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'money_rework_on' : 'money_rework_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/instant-taps { on }: Settings > Feature switches > "Instant taps". Tap feedback only: changes no money, seat or credit. */
export async function setInstantTaps(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setInstantTapsForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'instant_taps_on' : 'instant_taps_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * How many games each month holds on the Money page (the month dropdown), for EVERY month back to the first game the site had, not just the
 * last 90 days the dashboard carries. A game counts when Money lists it: canceled, or a court booked, or somebody in; games before the first
 * session date and games hidden from the lists are left out.
 */
async function gameMonthCounts(ctx: Ctx, group: GroupRow, hidden: Set<string>): Promise<Record<string, number>> {
  const { results } = await ctx.db
    .prepare(
      `SELECT s.id, s.starts_at, s.status, s.booking_status, s.shown_early,
              (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = s.id AND sp.status = 'confirmed') AS n
       FROM sessions s WHERE s.group_id = ?`,
    )
    .bind(group.id)
    .all<{ id: string; starts_at: string; status: string; booking_status: string; shown_early: number; n: number }>();
  const from = visibleFrom(group);
  const out: Record<string, number> = {};
  for (const r of results) {
    if (hidden.has(r.id) || !(r.starts_at >= from || Number(r.shown_early) === 1)) continue;
    if (!(r.status === 'canceled' || r.booking_status === 'booked' || Number(r.n) > 0)) continue;
    const p = localParts(Date.parse(r.starts_at), group.timezone);
    const key = `${p.year}-${String(p.month).padStart(2, '0')}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * GET /api/admin/month-games?month=2026-03 (Money page rework): the games of ONE month, drawn exactly like the dashboard's games, for months older
 * than the dashboard's 90-day window, so every month in the month list can be opened. Read only. Games hidden from the lists (with no money) are marked.
 */
export async function monthGames(ctx: Ctx): Promise<{ month: string; sessions: AdminDashboard['sessions'] }> {
  const group = await requireAdmin(ctx);
  if (!(await moneyReworkFor(ctx, group.id))) throw new HttpError(409, 'not_available', 'This is not switched on.');
  const m = /^(\d{4})-(\d{2})$/.exec(ctx.url.searchParams.get('month') ?? '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new HttpError(400, 'invalid_month', 'Pick a month.');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const tz = group.timezone;
  const from = new Date(zonedTimeToUtc(year, month, 1, 0, 0, tz)).toISOString();
  const to = new Date(zonedTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, 0, 0, tz)).toISOString();
  const settings = settingsOf(group);
  const shownFrom = visibleFrom(group);
  const { results } = await ctx.db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`)
    .bind(group.id, from, to)
    .all<SessionRow>();
  const rows = results.filter((s) => s.starts_at >= shownFrom || Number(s.shown_early) === 1);
  const players = await getPlayers(ctx.db, group.id);
  const organizerId = await organizerIdOf(ctx.db, group);
  const timeShift = await timeShiftFor(ctx, group.id);
  const ledger = await loadLedger(ctx.db, group.id);
  const charges = await loadCancelCharges(ctx.db, group.id);
  const creditSessionIds = new Set(ledger.map((e) => e.sessionId).filter((x): x is string => !!x));
  const marked = await adminHiddenGameIds(ctx.db, group.id);
  const hiddenIds = await hiddenGameIds(ctx.db, group.id);
  const potFor = (sessionId: string) => (r: RosterRow) => seatCredit(ledger, sessionId, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
  const sessions: AdminDashboard['sessions'] = [];
  // SPEED_FEWER_QUERIES: every game's roster and finalized check in one trip (nothing when it is off).
  await fewerDb(ctx)?.prefetch(rows.flatMap((s) => [{ kind: 'all' as const, ...rosterRead(s.id) }, ...(s.finalized_at ? [{ kind: 'all' as const, ...reopenBlockersRead(s.id) }] : [])]));
  for (const s of rows) {
    const roster = await loadRoster(ctx.db, s.id);
    const blockers = s.finalized_at ? await reopenBlockers(ctx, s.id) : { spent: [], requested: [] };
    const hidden = marked.has(s.id) && !sessionHasMoney(s, roster, creditSessionIds, charges);
    sessions.push({
      ...adminSessionView(s, roster, players, ctx.nowMs, settings, tz, organizerId, potFor(s.id), s.status === 'canceled' ? (charges.get(s.id) ?? null) : null, blockers, timeShift),
      hiddenFromPlayers: hiddenIds.has(s.id),
      ...(hidden ? { hiddenFromList: true } : {}),
    });
  }
  return { month: `${year}-${String(month).padStart(2, '0')}`, sessions };
}

/**
 * The games the organizer hid from their own lists, for Settings > Advanced > Hidden games. Read from the games themselves (not the
 * 90-day dashboard window), so an old hidden game can always be restored. A short label says what the game was.
 */
async function hiddenGamesView(ctx: Ctx, groupId: string, hidden: Set<string>, creditSessionIds: Set<string>, charges: Map<string, number>): Promise<NonNullable<AdminDashboard['hiddenGames']>> {
  if (hidden.size === 0) return [];
  const { results } = await ctx.db
    .prepare('SELECT * FROM sessions WHERE group_id = ? ORDER BY starts_at DESC')
    .bind(groupId)
    .all<SessionRow>();
  const out: NonNullable<AdminDashboard['hiddenGames']> = [];
  for (const r of results) {
    if (!hidden.has(r.id)) continue;
    // A marked game that has money in it is not hidden (money is never hidden): it is back in the lists, so it is not listed here.
    if (sessionHasMoney(r, await loadRoster(ctx.db, r.id), creditSessionIds, charges)) continue;
    out.push({ id: r.id, startsAt: r.starts_at, label: r.status === 'canceled' ? (r.cancel_reason ? `Canceled - ${r.cancel_reason}` : 'Canceled') : (r.note ?? 'Game') });
  }
  return out;
}

/**
 * POST /api/admin/sessions/:id/hide-from-list { hidden }: take a game with NO money in it (a test game, a canceled game nobody paid for) off the
 * organizer's Home and Money lists, or put it back (Settings > Advanced > Hidden games > Restore). It only hides: seats, payments, credit and the Activity log are untouched and every
 * player screen is unchanged. One task_log row per hidden game (server/moneyRework.ts), no schema change. Needs MONEY_REWORK on.
 */
export async function hideFromList(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (!(await moneyReworkFor(ctx, group.id))) throw new HttpError(409, 'not_available', 'This is not switched on.');
  const hidden = v.bool(body.hidden, 'hidden');
  // Money is never hidden: a game with a payment, credit from it, somebody owing, a court to pay for, a late fee or a venue charge stays in Money.
  if (hidden) {
    const creditIds = new Set((await loadLedger(ctx.db, group.id)).map((e) => e.sessionId).filter((x): x is string => !!x));
    if (sessionHasMoney(session, await loadRoster(ctx.db, session.id), creditIds, await loadCancelCharges(ctx.db, group.id))) throw new HttpError(409, 'has_money', HAS_MONEY_MESSAGE);
  }
  const was = (await adminHiddenGameIds(ctx.db, group.id)).has(session.id);
  if (was === hidden) return { ok: true, changed: false, hidden };
  await setAdminHiddenGame(ctx.db, group.id, session.id, hidden, ctx.nowIso);
  await audit(ctx.db, group.id, session.id, hidden ? 'session_hidden_from_list' : 'session_shown_in_list', {}, ctx.nowIso);
  return { ok: true, changed: true, hidden };
}

/**
 * POST /api/admin/sessions/:id/charge { charged, cents? }: change, after the fact, whether the venue charged for a CANCELED game. Yes counts
 * the amount (the one you give, else what was charged before, else the court cost) as that game's court cost in Totals; No counts nothing.
 * Only Totals change: nobody's seat, payment or credit moves (anyone who owes still owes until you Clear it). Kept as one Activity entry
 * ('charge_edited') that Money's "venue charged" reads like the cancel's own entry (the latest one wins). Needs MONEY_REWORK on.
 */
export async function setSessionCharge(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (!(await moneyReworkFor(ctx, group.id))) throw new HttpError(409, 'not_available', 'This is not switched on.');
  if (session.status !== 'canceled') throw new HttpError(409, 'not_canceled', 'Only a canceled game has a venue charge to edit.');
  const charged = v.bool(body.charged, 'charged');
  const asked = v.cents(body.cents, 'cents');
  const before = (await loadCancelCharges(ctx.db, group.id)).get(session.id) ?? 0;
  const next = charged ? (asked && asked > 0 ? asked : before > 0 ? before : courtCostOf(session, settingsOf(group))) : 0;
  if (next === before) return { ok: true, changed: false, chargedCents: before };
  await audit(ctx.db, group.id, session.id, 'charge_edited', { startsAt: session.starts_at, chargedCents: next, wasCents: before }, ctx.nowIso);
  return { ok: true, changed: true, chargedCents: next };
}

/** PUT /api/admin/pay-sheet { on }: Settings > Feature switches > "Pay sheet". Display only: changes no money and no seat. */
export async function setPaySheet(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPaySheetForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'pay_sheet_on' : 'pay_sheet_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/admin-v2 { on }: Settings > Feature switches > "New admin layout". Display only: changes no money and no seat. */
export async function setAdminV2(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAdminV2ForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'admin_v2_on' : 'admin_v2_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/admin-r2 { on }: Settings > Feature switches > "Admin screens, round 2". Display only: changes no money and no seat. */
export async function setAdminR2(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAdminR2ForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'admin_r2_on' : 'admin_r2_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/admin-r3 { on }: Settings > Feature switches > "Admin screens, round 3". Display only: changes no money and no seat. */
export async function setAdminR3(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAdminR3ForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'admin_r3_on' : 'admin_r3_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/late-fees { on }: Settings > Feature switches > "Late drops owe $14". CHANGES MONEY: while on, a late drop
 * that leaves a game short, a no-show with fewer than 4 played, and a late cancel the venue did not waive leave the
 * person owing their $14. Off: new drops, Finalize and cancels work exactly as before (debts already made stay
 * until cleared or paid). One task_log row, no schema change.
 */
export async function setLateFees(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setLateFeesForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'late_fees_on' : 'late_fees_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * POST /api/admin/players/:id/admin-hide { hidden }: "Hide player" (and Unhide) in the round 2 admin screens.
 * Soft: only the organizer's own Players list and pickers stop showing the name. Every seat, payment, credit and
 * history row stays exactly as it is, and the player still works on their own screen. One task_log row, no schema change.
 * Never the organizer's own player (they would lose their own I'm in). Unhide always works, even if the switch went off.
 */
export async function hidePlayerFromAdmin(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const hidden = v.bool(body.hidden, 'hidden');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(id, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  if (hidden) {
    if (!adminR2Allowed(ctx.env.ADMIN_R2)) throw new HttpError(400, 'not_available', 'Hide player is not available right now.');
    if (id === (await organizerIdOf(ctx.db, group))) throw new HttpError(400, 'cannot_hide_self', "You can't hide yourself.");
  }
  await setAdminHiddenPlayer(ctx.db, group.id, id, hidden, ctx.nowIso);
  await audit(ctx.db, group.id, null, hidden ? 'player_admin_hidden' : 'player_admin_unhidden', { name: p.display_name }, ctx.nowIso);
  return { ok: true, hidden };
}

/**
 * PUT /api/admin/sessions/:id/note { note }: the game's short label ("Veteran's Day", "Court 3"), changed after the game exists.
 * Only the label changes: no seat, payment, credit or time. Empty clears it. At most 80 characters (same as when adding a game).
 */
export async function setSessionNote(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const note = v.optionalText(body.note, 'note', 80);
  if ((session.note ?? null) === note) return { ok: true, changed: false, note };
  await ctx.db.prepare('UPDATE sessions SET note = ?, updated_at = ? WHERE id = ?').bind(note, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, 'session_note_changed', { from: session.note ?? null, to: note }, ctx.nowIso);
  return { ok: true, changed: true, note };
}

/**
 * PUT /api/admin/sessions/:id/court-number { court }: Zip 14, which of the venue's courts (1 to 16) the game is on; null clears it.
 * Organizer only (adminSession: the organizer's sign-in; the read-only PIN is refused before this runs, app.ts), and only while
 * "Game day card" is on for this phone (off: the Court row does not exist, so neither does this). Players have no way to set it.
 * Touches only sessions.court (and updated_at, so every screen notices on its next 5-second check); the note is never read or changed.
 */
export async function setCourtNumber(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  if (!(await gameDayCardFor(ctx, group.id))) throw new HttpError(404, 'not_found', 'Not found.');
  const court = courtBody(body.court);
  const was = courtOrNull(session.court);
  if (was === court) return { ok: true, changed: false, court };
  await ctx.db.prepare('UPDATE sessions SET court = ?, updated_at = ? WHERE id = ?').bind(court, ctx.nowIso, session.id).run();
  await audit(ctx.db, group.id, session.id, 'session_court_changed', { from: was, to: court }, ctx.nowIso);
  return { ok: true, changed: true, court };
}

/** A court from a request: a whole number 1 to 16, or null / missing for "not set". Anything else is turned down. */
function courtBody(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const court = courtOrNull(value);
  if (court === null) throw new HttpError(400, 'invalid_court', 'Pick a court from 1 to 16.');
  return court;
}

/** PUT /api/admin/second-chance-switch { on }: Settings > Feature switches > "Second Chance" (Zip 15). */
export async function setSecondChanceSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setSecondChanceForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'second_chance_on' : 'second_chance_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** POST /api/admin/sessions/:id/second-chance { action, minutes? } (server/secondChance.ts): the card's taps, through decide and reschedule. */
export function secondChanceTap(ctx: Ctx, body: Record<string, unknown>) {
  return secondChanceAction(ctx, body, { decide, reschedule });
}

/** PUT /api/admin/game-day-card-switch { on }: Settings > Feature switches > "Game day card" (Zip 14). Display only; moves nothing. */
export async function setGameDayCardSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setGameDayCardForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'game_day_card_on' : 'game_day_card_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/error-alerts-switch { on }: Settings > Feature switches > "Error alerts" (Zip 21). Telegram to Alex only; no screen changes. */
export async function setErrorAlertsSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await switchErrorAlerts(ctx, group.id, on);
  await audit(ctx.db, group.id, null, on ? 'error_alerts_on' : 'error_alerts_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/unpaid-nudge-switch { on }: Settings > Feature switches > "Unpaid nudge" (Zip 17). Players only; admin screens do not change. */
export async function setUnpaidNudgeSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setUnpaidNudgeForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'unpaid_nudge_on' : 'unpaid_nudge_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/booking-hours-switch { on }: Settings > Feature switches > "Booking hours" (Zip 24). Only refuses a game outside the venue hours; moves no money. */
export async function setBookingHoursSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  // Zip 27 (A-01): every finalized game keeps the rules it shows right now (written down first, so a failure changes nothing).
  await lockFinalizedGames(ctx.db, group.id, await everyoneSettings(ctx, group), ctx.nowIso);
  await setBookingHoursForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'booking_hours_on' : 'booking_hours_off', {}, ctx.nowIso);
  // The 2.5 and 3 hour length rows turn on and off with this row (shared/gameLength.ts): the flat price of every OPEN game of those lengths just
  // changed ($14 <-> $18 and $21), so reprice their seats now, the way the Short games switch does (credit on a seat follows the new price; cash
  // is never taken back, it is settled at Finalize). A game of any other length is not touched. With none open, nothing happens.
  const everyone = bookingHoursAllowed(ctx.env.BOOKING_HOURS) && on;
  const after: ReturnType<typeof settingsOf> = everyone ? { ...settingsOf({ ...group, long_games: false }), longGames: true } : settingsOf({ ...group, long_games: false });
  const { results: open } = await ctx.db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND status <> 'canceled' AND finalized_at IS NULL AND ends_at > ?`)
    .bind(group.id, new Date(ctx.nowMs - 30 * 86_400_000).toISOString())
    .all<SessionRow>();
  for (const s of open) {
    if ((LONG_MINUTES as readonly number[]).includes(gameMinutes(s.starts_at, s.ends_at))) await ctx.db.batch(repriceStatements(ctx.db, s.id, flatOf(s, after), ctx.nowIso));
  }
  return { ok: true, on };
}

/** PUT /api/admin/totals-refresh-switch { on }: Settings > Feature switches > "Totals refresh" (Zip 23). Display only; moves no money. */
export async function setTotalsRefreshSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setTotalsRefreshForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'totals_refresh_on' : 'totals_refresh_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/christmas-skin-switch { on }: Settings > Feature switches > "Christmas skin" (Zip 38). Look only: the player screens' Christmas theme. */
export async function setChristmasSkinSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setChristmasSkinForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'christmas_skin_on' : 'christmas_skin_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/home-screen-tip-switch { on }: Settings > Feature switches > "Home Screen tip" (Zip 37). Look only: a card on the player's Home. */
export async function setHomeScreenTipSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setHomeScreenTipForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'home_screen_tip_on' : 'home_screen_tip_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/game-day-text-switch { on }: Settings > Feature switches > "Game day text" (Zip 37). Sends the organizer one Telegram an hour before a booked game; texts nobody. */
export async function setGameDayTextSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setGameDayTextForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'game_day_text_on' : 'game_day_text_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/players-sheet-redo-switch { on }: Settings > Feature switches > "Players sheet redo" (Zip 32). Display only; moves no money. */
export async function setPlayersSheetRedoSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPlayersSheetRedoForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'players_sheet_redo_on' : 'players_sheet_redo_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/tap-guard-switch { on }: Zip 35 "Tap guard fix" for every phone (player and organizer). Which fast tap the page ignores; no data changes. */
export async function setTapGuardFixSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setTapGuardFixForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'tap_guard_fix_on' : 'tap_guard_fix_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/checkin-pay-switch { on }: Zip 34 "Check-in pay line" for every organizer phone and the texted Telegram link. Words only; no data changes. */
export async function setCheckInPaySwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setCheckInPayForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'checkin_pay_line_on' : 'checkin_pay_line_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/acting-others-switch { on }: Zip 30 "Acting for others" for every organizer phone. Look only; no data changes. */
export async function setActingOthersSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setActingOthersForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'acting_others_on' : 'acting_others_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/spent-totals-switch { on }: Settings > Feature switches > "Spent matches Totals" (Zip 27, A-05). Display only; moves no money. */
export async function setSpentTotalsSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setSpentTotalsForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'spent_totals_on' : 'spent_totals_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/cheaper-fix-switch { on }: Settings > Feature switches > "Made cheaper after paying" (Zip 39, shared/cheaperFix.ts). Moves money,
 * but only from the next late fee or price change on: turning it on or off changes nothing that already happened.
 */
export async function setCheaperFixSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setCheaperFixForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'cheaper_fix_on' : 'cheaper_fix_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/after-game-card-switch { on }: Settings > Feature switches > "After-game cards" (Zip 16). Display only; moves no money. */
export async function setAfterGameCardSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAfterGameCardForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'after_game_card_on' : 'after_game_card_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * POST /api/admin/sessions/:id/hide { hidden }: take a CANCELED game off every player screen, or put it back.
 * Only hides: nothing about the game, its players, money or credit changes (see server/hideGame.ts). Only canceled games can be hidden.
 */
export async function hideFromPlayers(ctx: Ctx, body: Record<string, unknown>) {
  const { group, session } = await adminSession(ctx);
  const hidden = v.bool(body.hidden, 'hidden');
  if (hidden && session.status !== 'canceled') throw new HttpError(409, 'not_canceled', 'Only a canceled game can be removed from the player screen.');
  const was = (await hiddenGameIds(ctx.db, group.id)).has(session.id);
  if (was === hidden) return { ok: true, changed: false, hidden };
  await setHiddenFromPlayers(ctx.db, group.id, session.id, hidden, ctx.nowIso);
  await audit(ctx.db, group.id, session.id, hidden ? 'session_hidden_from_players' : 'session_shown_to_players', {}, ctx.nowIso);
  return { ok: true, changed: true, hidden };
}

/** PUT /api/admin/adjust-credit-switch { on }: Settings > Feature switches > "Adjust credit". Shows or hides the row on the Players sheet; moves no credit. */
export async function setAdjustCreditSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAdjustCreditForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'adjust_credit_on' : 'adjust_credit_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/venmo-request-switch { on }: Settings > Feature switches > "Venmo request". Shows or hides links; sends and charges nothing. */
export async function setVenmoRequestSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setVenmoRequestForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'venmo_request_on' : 'venmo_request_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/motion-switch { which: 'player' | 'admin', on }: Settings > Feature switches > the two animation rows. Visual only. */
export async function setMotionSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const which = v.oneOf(body.which, 'which', ['player', 'admin'] as const);
  const on = v.bool(body.on, 'on');
  await setMotionForAll(ctx, group.id, which, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, `${which === 'player' ? 'motion' : 'motion_admin'}_${on ? 'on' : 'off'}`, {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * POST /api/admin/players/:id/credit-adjust { direction, cents, reason, seen }: add or remove credit on one player's pot by hand
 * ("Adjust credit", ADJUST_CREDIT). Uses the existing credit ledger, whole dollars, a required reason, never below $0.
 * `seen` is the pot the organizer's sheet showed: the entry only goes in while the pot is still exactly that, so a double tap or a
 * stale screen adds nothing.
 */
export async function adjustPlayerCredit(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (!(await adjustCreditFor(ctx, group.id))) throw new HttpError(404, 'not_found', 'Adjust credit is not switched on.');
  const playerId = v.id(ctx.params.id, 'player');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ? AND group_id = ?').bind(playerId, group.id).first<{ display_name: string }>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  if (playerId === (await organizerIdOf(ctx.db, group))) throw new HttpError(409, 'organizer_pays_court', 'You pay the court, so you have no credit to adjust.');
  const direction = v.oneOf(body.direction, 'direction', ['add', 'remove'] as const);
  const cents = typeof body.cents === 'number' && Number.isInteger(body.cents) ? body.cents : null;
  const seen = typeof body.seen === 'number' && Number.isInteger(body.seen) && body.seen >= 0 ? body.seen : null;
  if (seen === null) throw new HttpError(400, 'bad_request', 'Look at their credit again, then try once more.');
  const { potCents, reservedCents } = await usableFor(ctx, group, playerId);
  if (potCents !== seen) throw new HttpError(409, 'credit_changed', 'Their credit just changed. Look again.');
  const plan = planAdjust({ direction, cents, reason: cleanReason(body.reason), potCents, reservedCents, name: p.display_name });
  if (!plan.ok) throw new HttpError(400, 'bad_adjustment', plan.error);
  const note = cleanReason(body.reason);
  const made = await adjustCreditEntry(ctx.db, {
    groupId: group.id,
    playerId,
    kind: direction === 'add' ? 'kept' : 'used',
    cents: cents as number,
    seenCents: seen,
    reasonColumn: adjustReasonColumn(note),
    nowIso: ctx.nowIso,
  });
  if (!made.done) throw new HttpError(409, 'credit_changed', 'Their credit just changed. Look again.');
  await audit(ctx.db, group.id, null, 'credit_adjusted', { player: p.display_name, playerId, deltaCents: plan.deltaCents, balanceAfterCents: plan.afterCents, reason: note, ledgerId: made.id }, ctx.nowIso);
  return { ok: true, balanceCents: plan.afterCents, deltaCents: plan.deltaCents, text: `${p.display_name}: credit ${signedPrice(plan.deltaCents)}, ${formatPrice(plan.afterCents)} now` };
}

/** PUT /api/admin/last-call-switch { on }: Settings > Feature switches > "Last call texts". The words of two prefilled texts only. */
export async function setLastCallSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setLastCallForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'last_call_texts_on' : 'last_call_texts_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/short-games-switch { on }: Settings > Feature switches > "Short games". CHANGES MONEY for 1.5 hour games (shared/gameLength.ts). */
export async function setShortGamesSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  // Zip 27 (A-01): every finalized game keeps the rules it shows right now (written down first, so a failure changes nothing).
  await lockFinalizedGames(ctx.db, group.id, await everyoneSettings(ctx, group), ctx.nowIso);
  await setShortGamesForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'short_games_on' : 'short_games_off', {}, ctx.nowIso);
  // The flat price of every open 1.5 hour game just changed for everyone ($14 <-> $11): reprice their seats now, the way a move does
  // (credit on a seat follows the new price; cash is never taken back, it is settled at Finalize). Nothing else is touched.
  const everyone = zip9Allowed(ctx.env.SHORT_GAMES) && on;
  const after: ReturnType<typeof settingsOf> = everyone ? { ...settingsOf({ ...group, short_games: false }), shortGames: true } : settingsOf({ ...group, short_games: false });
  const { results: open } = await ctx.db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND status <> 'canceled' AND finalized_at IS NULL AND ends_at > ?`)
    .bind(group.id, new Date(ctx.nowMs - 30 * 86_400_000).toISOString())
    .all<SessionRow>();
  for (const s of open) if (isShortGame(s.starts_at, s.ends_at)) await ctx.db.batch(repriceStatements(ctx.db, s.id, flatOf(s, after), ctx.nowIso));
  return { ok: true, on };
}

/**
 * Zip 27 (A-01): the price rules for EVERYONE right now: Settings > Money, the "Short games" row and the "Booking hours" row with their kill
 * switches. Never this phone's private test link (?shortgames=on), so a lock is what every screen shows, not what one test phone shows.
 */
async function everyoneSettings(ctx: Ctx, group: GroupRow): Promise<ReturnType<typeof settingsOf>> {
  return everyoneSettingsOf(group, { shortGames: await shortGamesForAll(ctx.db, group.id), bookingHours: await bookingHoursForAll(ctx.db, group.id) }, ctx.env);
}

/** PUT /api/admin/speed-fewer-queries-switch { on }: Settings > Feature switches > "Fewer database trips" (Zip 12). How the server reads, never what it answers. */
export async function setSpeedFewerQueriesSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setFewerQueriesForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'speed_fewer_queries_on' : 'speed_fewer_queries_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/speed-direct-load-switch { on }: "Load games at once" (Zip 12). The plain address asks for the games with its set-up check. */
export async function setSpeedDirectLoadSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setDirectLoadForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'speed_direct_load_on' : 'speed_direct_load_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/speed-last-screen-admin-switch { on }: "Instant admin" (Zip 12 step C). The organizer phone keeps a copy of its dashboard
 * (money in it, shown dimmed) and draws it at once with every action held. Alex: never switch it on for the first time on a game day.
 */
export async function setSpeedLastScreenAdminSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setLastScreenAdminForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'speed_last_screen_admin_on' : 'speed_last_screen_admin_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/speed-last-screen-switch { on }: "Show last screen at once" (Zip 12). Phones keep a copy of the player screen (no money). */
export async function setSpeedLastScreenSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setLastScreenForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'speed_last_screen_on' : 'speed_last_screen_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/**
 * PUT /api/admin/card-cleanup-switch { on }: Settings > Feature switches > "Card cleanup" (Zip 10). Switching it on for everyone also
 * ends the waitlist: anyone still waiting on an open game moves in at once, first in line first, as a normal player (their credit
 * goes on like at I'm in; no "spot opened" notice, text card or Telegram line). Off moves nobody back.
 */
export async function setCardCleanupSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setCardCleanupForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'card_cleanup_on' : 'card_cleanup_off', {}, ctx.nowIso);
  const movedIn = on && zip10Allowed(ctx.env.CARD_CLEANUP) ? await endWaitlists(ctx, group) : 0;
  return { ok: true, on, movedIn };
}

/** Everyone waiting on an open game moves in (no cap: up to the database's 12). Returns how many moved. */
async function endWaitlists(ctx: Ctx, group: GroupRow): Promise<number> {
  const settings = { ...settingsOf(group), noCap: true as const };
  const { results: open } = await ctx.db
    .prepare(
      `SELECT * FROM sessions s WHERE s.group_id = ? AND s.status <> 'canceled' AND s.starts_at > ?
         AND EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id AND sp.status = 'waitlisted') ORDER BY s.starts_at`,
    )
    .bind(group.id, ctx.nowIso)
    .all<SessionRow>();
  let moved = 0;
  for (const s of open) {
    moved += (await settle(ctx.db, s, ctx.nowIso, settings)).length;
    // Still waiting = the game already holds 12 (the database's limit). There is no waitlist anymore, so they come off it (their
    // money, if any, comes back the way a drop does); they can tap I'm in again if a spot opens.
    const { results: left } = await ctx.db.prepare("SELECT player_id FROM session_players WHERE session_id = ? AND status = 'waitlisted'").bind(s.id).all<{ player_id: string }>();
    for (const r of left) await withdraw(ctx.db, { ...group, card_cleanup: true }, s, r.player_id, ctx.nowMs);
  }
  return moved;
}

/** PUT /api/admin/players-redo-switch, /swap-button-switch, /admin-undo-switch { on }: the Zip 13 Settings rows. Nothing else moves. */
export function setZip13Switch(which: Zip13Switch) {
  const action = { playersRedo: 'players_redo', swapButton: 'swap_button', adminUndo: 'admin_undo' }[which];
  return async (ctx: Ctx, body: Record<string, unknown>) => {
    const group = await requireAdmin(ctx);
    const on = v.bool(body.on, 'on');
    await setZip13ForAll(ctx.db, group.id, which, on, ctx.nowIso);
    await audit(ctx.db, group.id, null, `${action}_${on ? 'on' : 'off'}`, {}, ctx.nowIso);
    return { ok: true, on };
  };
}

/** PUT /api/admin/seat-dots-switch { on }: Settings > Feature switches > "Seat dots". Display only; moves nothing. */
export async function setSeatDotsSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setSeatDotsForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'seat_dots_on' : 'seat_dots_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/alert-cards-switch { on }: Settings > Feature switches > "Alert cards" (Zip 11). Display only; moves nothing. */
export async function setAlertCardsSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setAlertCardsForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'alert_cards_on' : 'alert_cards_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/card-time-switch { on }: Settings > Feature switches > "Card time and buttons". Player cards only, display only. */
export async function setCardTimeSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setCardTimeForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'card_time_buttons_on' : 'card_time_buttons_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/home-collapse-switch { on }: Settings > Feature switches > "Home collapse". Player Home layout only; moves nothing. */
export async function setHomeCollapseSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setHomeCollapseForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'home_collapse_on' : 'home_collapse_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/tonight-glow-switch { on }: Settings > Feature switches > "Tonight glow". Date tile tags and glow only; moves nothing. */
export async function setTonightGlowSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setTonightGlowForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'tonight_glow_on' : 'tonight_glow_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/color-cleanup-switch { on }: Settings > Feature switches > "Color cleanup". Colors and two Cancel sheet lines only; moves nothing. */
export async function setColorCleanupSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setColorCleanupForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'color_cleanup_on' : 'color_cleanup_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** PUT /api/admin/player-cards-switch { on }: Settings > Feature switches > "Simpler player cards". Player card layout only; moves nothing. */
export async function setPlayerCardsSwitch(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const on = v.bool(body.on, 'on');
  await setPlayerCardsForAll(ctx.db, group.id, on, ctx.nowIso);
  await audit(ctx.db, group.id, null, on ? 'player_cards_on' : 'player_cards_off', {}, ctx.nowIso);
  return { ok: true, on };
}

/** Zip 31: for each player with extra time owed (no I paid waiting), the game it rides on and how much: "sessionId:playerId" -> cents. */
function extRideOnSeats(
  sessions: SessionRow[],
  rosters: Map<string, RosterRow[]>,
  ledger: Parameters<typeof extRideOn>[0]['ledger'],
  reserved: Map<string, number>,
  settings: ReturnType<typeof settingsOf>,
  tz: string,
  nowMs: number,
  timeShift: boolean,
  lateFees: boolean,
): Map<string, number> {
  const owed = new Map<string, number>();
  for (const x of extRowsOf(sessions, rosters)) if (x.owedCents > 0) owed.set(x.playerId, (owed.get(x.playerId) ?? 0) + x.owedCents);
  const out = new Map<string, number>();
  for (const [playerId, cents] of owed) {
    const on = extRideOn({ playerId, sessions, rosters, ledger, reserved, settings, tz, nowMs, timeShift, lateFees, hiddenIds: new Set() });
    if (on) out.set(`${on}:${playerId}`, cents);
  }
  return out;
}

function withExtOnSeats(views: AdminDashboard['sessions'], on: Map<string, number>): AdminDashboard['sessions'] {
  if (on.size === 0) return views;
  return views.map((s) => (s.roster.some((r) => on.has(`${s.id}:${r.playerId}`)) ? { ...s, roster: s.roster.map((r) => (on.has(`${s.id}:${r.playerId}`) ? { ...r, extCents: on.get(`${s.id}:${r.playerId}`)! } : r)) } : s));
}
