// What the organizer's Text menu offers for a game right now, and who each
// text goes to. No React here, so tests can use it. The site only opens
// Messages with the words ready; it never sends anything.
import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import {
  canceledFeeKeptMessage,
  canceledMessage,
  canceledTodayMessage,
  courtCanceledMessage,
  courtStillBookedMessage,
  checkInMessage,
  finalMessage,
  movedMessage,
  needPlayersMessage,
  paymentMessage,
  promotedMessage,
  remindAllMessage,
  shareMessage,
  siteAddress,
} from '../../../shared/messages';
import {
  canceledCreditTextR2,
  canceledFeeKeptTextR2,
  checkInTextR2,
  courtCanceledTextR2,
  courtStillBookedTextR2,
  finalTextR2,
  movedTextR2,
  needPlayersTextR2,
  paymentTextR2,
  promotedTextR2,
  remindAllTextR2,
  shareTextR2,
} from '../../../shared/textsR2';
import { checkInTextLastCall, needPlayersTextLastCall } from '../../../shared/lastCall';
import { viewFlat } from '../../../shared/gameLength';

export interface TextItem {
  id: 'share' | 'need' | 'checkin' | 'promoted' | 'canceled' | 'moved' | 'final';
  /** Menu name. */
  label: string;
  body: string;
  /** Group chat (no numbers, you pick the chat) or saved numbers. */
  chat: boolean;
  /** Numbers to open a group text to (empty for a group chat). */
  phones: string[];
  /** Names with no number saved. */
  missing: string[];
  /** The small gray line: who it goes to. */
  who: string;
}

/** Numbers and missing names for some roster rows (the organizer is never texted). */
export function reach(rows: AdminRosterEntry[], meId: string | null) {
  const people = rows.filter((r) => r.playerId !== meId);
  return { phones: people.filter((r) => r.phone).map((r) => r.phone!), missing: people.filter((r) => !r.phone).map((r) => r.name), count: people.length };
}

function toNumbers(label: string, rows: AdminRosterEntry[], meId: string | null): Pick<TextItem, 'chat' | 'phones' | 'missing' | 'who'> {
  const r = reach(rows, meId);
  return { chat: false, phones: r.phones, missing: r.missing, who: `${label} · ${r.count}` };
}

const GROUP = { chat: true, phones: [] as string[], missing: [] as string[], who: 'Group chat, you pick' };

/** The Text menu for one game: only the texts that fit it right now. */
export function sessionTexts(d: AdminDashboard, s: AdminSessionView, nowMs: number): TextItem[] {
  const tz = d.group.timezone;
  const link = siteAddress(d.group.playerLink);
  const me = d.me?.id ?? null;
  const items: TextItem[] = [];
  const signed = s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted');
  // TEXTS_R2 on: the new wording (shared/textsR2.ts). Off: every word below is exactly as it was.
  const r2 = d.textsR2 === true;
  // After the game: once finalized, the one post-game note for the group chat.
  if (Date.parse(s.startsAt) <= nowMs) {
    if (s.finalized && !s.state.flags.canceled) {
      const body = r2
        ? finalTextR2(s, tz, nowMs, s.finalized.playedCount, s.finalized.priceCents, s.finalized.flatCents, link)
        : finalMessage(s, tz, s.finalized.playedCount, s.finalized.priceCents, s.finalized.flatCents, link);
      items.push({ id: 'final', label: 'Final price', body, ...GROUP });
    }
    return items;
  }

  if (s.state.flags.canceled) {
    // Late fees on and canceled inside 12 hours: the text follows the venue answer (fee kept: confirmed players only).
    const late = lateCancelText(d, s, '');
    if (late) items.push({ id: 'canceled', label: 'Canceled', body: late.body, chat: false, phones: late.reach.phones, missing: late.reach.missing, who: `${late.to} · ${late.reach.count}` });
    else items.push({ id: 'canceled', label: 'Canceled', body: r2 ? canceledCreditTextR2(s, tz, nowMs, link, s.cancelReason) : canceledMessage(s, tz, nowMs, link), ...toNumbers('Everyone signed up and waiting', signed, me) });
    return items;
  }
  const n = s.confirmedCount;
  const confirmed = s.roster.filter((r) => r.status === 'confirmed');

  if (s.moved && s.plannedStartsAt) {
    const body = r2 ? movedTextR2(s, s.plannedStartsAt, tz, nowMs, link) : movedMessage(s, s.plannedStartsAt, tz, nowMs, link);
    items.push({ id: 'moved', label: 'Moved', body, ...toNumbers('Everyone signed up and waiting', signed, me) });
  }
  items.push({ id: 'share', label: 'Share the game', body: r2 ? shareTextR2(s, tz, nowMs, link) : shareMessage(s, tz, nowMs, link), ...GROUP });
  // "Last call texts" (Zip 8, shared/lastCall.ts) on top of round 2: Alex's last call words for Need players and Check-in. Off: as before.
  const lastCall = r2 && d.lastCallTexts === true;
  if (n < 4) items.push({ id: 'need', label: 'Need players', body: lastCall ? needPlayersTextLastCall(s, tz, nowMs, n, 4 - n, link) : r2 ? needPlayersTextR2(s, tz, nowMs, n, 4 - n, link) : needPlayersMessage(s, tz, nowMs, 4 - n, link), ...GROUP });
  // 4 or more in: the Check-in goes to everyone signed up, the waitlist too. TEXTS_R2: it opens with NO recipients everywhere (you pick the group chat).
  if (n >= 4) {
    if (r2) items.push({ id: 'checkin', label: 'Check-in', body: lastCall ? checkInTextLastCall(s, tz, nowMs, n, link) : checkInTextR2(s, tz, nowMs, n, link), ...GROUP });
    else items.push({ id: 'checkin', label: 'Check-in', body: checkInMessage(s, tz, nowMs, link), ...toNumbers('Everyone signed up', signed, me), who: 'Everyone signed up' });
  }
  // A waitlisted player who moved in after a drop (above the max, someone left).
  for (const r of confirmed.filter((x) => x.promotionReason === 'spot_opened' && x.promotedAt && !x.promotionNotifiedAt && x.playerId !== me)) {
    items.push({ id: 'promoted', label: `Spot opened: ${r.name}`, body: r2 ? promotedTextR2(s, tz, nowMs, link) : promotedMessage(s, tz, nowMs, link), ...toNumbers(r.name, [r], me) });
  }
  return items;
}

/** The text for the card that asks you to fill a game: whichever of Need players, Check-in, or just Share fits. */
export function fillTexts(d: AdminDashboard, s: AdminSessionView, nowMs: number): TextItem[] {
  const all = sessionTexts(d, s, nowMs);
  const lead = all.filter((i) => i.id === 'need' || i.id === 'checkin');
  return lead.length ? lead : all.filter((i) => i.id === 'share');
}

// ---------- Payment reminders ----------

/**
 * A late-fee debt this seat really owes (LATE_FEES on only, shared/lateFees.ts): a late drop that left the game short, a
 * no-show, or a seat in a game canceled late with the fee kept. Unpaid with something left to pay, never the organizer's own.
 * A paid one (the money stays on the game) and a cleared one are not owed, so they get no reminder.
 */
export function owesLateFee(d: Pick<AdminDashboard, 'lateFees'>, r: AdminRosterEntry): boolean {
  return d.lateFees === true && !!r.lateFee && !r.isOrganizer && r.paymentStatus === 'unpaid' && r.shareCents !== null && r.owesCents > 0;
}

/**
 * Games a player owes for now: unpaid and confirmed, from the day-before check-in on (plus `extra`). With LATE_FEES on, a
 * late-fee debt counts too, at once and whatever the game's state (a seat that left, a game canceled late): it is owed now.
 * Several games add up to one total in the text.
 */
export function owedGames(d: AdminDashboard, playerId: string, extra?: AdminSessionView) {
  const nowMs = Date.parse(d.now);
  const games: { s: AdminSessionView; cents: number }[] = [];
  for (const s of d.sessions) {
    const r = s.roster.find((x) => x.playerId === playerId);
    if (r && owesLateFee(d, r)) {
      games.push({ s, cents: r.owesCents });
      continue;
    }
    if (s.state.flags.canceled) continue;
    if (!r || r.isOrganizer || r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null || r.owesCents <= 0) continue;
    if (s.id !== extra?.id && nowMs < Date.parse(s.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
    games.push({ s, cents: r.owesCents });
  }
  return games;
}

/** "Hey Ryan, you owe $14 for pickleball Tue Nov 3. Pay here: ..." (the total, if more than one game). */
export function reminderText(d: AdminDashboard, playerId: string, name: string, extra?: AdminSessionView): string {
  const games = owedGames(d, playerId, extra);
  const total = games.reduce((n, g) => n + g.cents, 0);
  if (d.textsR2 === true) return paymentTextR2(name, total, games.map((g) => g.s), d.group.timezone, Date.parse(d.now), siteAddress(d.group.playerLink));
  return paymentMessage(name, total, games.map((g) => g.s), d.group.timezone, siteAddress(d.group.playerLink));
}

/** Everyone who owes right now, with their number, for "Remind all unpaid". */
export function unpaidPeople(d: AdminDashboard) {
  const owing = d.players.filter((p) => owedGames(d, p.id).length > 0);
  return {
    phones: owing.filter((p) => p.phone).map((p) => p.phone!),
    missing: owing.filter((p) => !p.phone).map((p) => p.name),
    count: owing.length,
    body: remindAllText(d),
  };
}

/** "Remind all unpaid": the group reminder (TEXTS_R2 on: the new wording). */
export function remindAllText(d: Pick<AdminDashboard, 'group' | 'textsR2'>): string {
  const link = siteAddress(d.group.playerLink);
  return d.textsR2 === true ? remindAllTextR2(link) : remindAllMessage(link);
}

// ---------- "Text the players" (LATE_FEES on) ----------

/**
 * Who "Text the players" (and the "venue did not waive" cancel text) goes to: only the players confirmed in this game.
 * Never the organizer, never the waitlist, never the whole group. `withHidden` false also leaves out players hidden
 * from the Players list (Hide player).
 */
export function confirmedReach(d: AdminDashboard, s: AdminSessionView, withHidden: boolean) {
  const hidden = new Set(withHidden ? [] : d.players.filter((p) => p.adminHidden).map((p) => p.id));
  return reach(
    s.roster.filter((r) => r.status === 'confirmed' && !r.isOrganizer && !hidden.has(r.playerId)),
    d.me?.id ?? null,
  );
}

export interface BackOutText {
  id: 'court_canceled' | 'court_booked';
  label: string;
  body: string;
}

/** The two texts for backing out of today's game, main one first. */
export function backOutTexts(r2 = false): BackOutText[] {
  return [
    { id: 'court_canceled', label: 'Court canceled', body: r2 ? courtCanceledTextR2() : courtCanceledMessage() },
    { id: 'court_booked', label: 'Court still booked (backup)', body: r2 ? courtStillBookedTextR2() : courtStillBookedMessage() },
  ];
}

/** True when the game was canceled inside the 12 hours before its start (the venue question was asked). */
export function canceledLate(s: AdminSessionView): boolean {
  return !!s.canceledAt && Date.parse(s.canceledAt) >= Date.parse(s.startsAt) - 12 * 3_600_000 && Date.parse(s.canceledAt) < Date.parse(s.startsAt);
}

/**
 * The text after a cancel, with LATE_FEES on and the cancel inside 12 hours: venue did NOT waive the fee ->
 * "Heads up: today's game is canceled ..." to the confirmed players only; waived -> the usual credit text saying "today",
 * to everyone signed up and waiting. Null: not a late cancel with the switch on (the old text stays).
 */
export function lateCancelText(d: AdminDashboard, s: AdminSessionView, reason: string): { body: string; to: string; feeKept: boolean; reach: ReturnType<typeof reach> } | null {
  if (d.lateFees !== true || !canceledLate(s)) return null;
  const link = siteAddress(d.group.playerLink);
  const nowMs = Date.parse(d.now);
  const r2 = d.textsR2 === true;
  // TEXTS_R2: the reason typed on the cancel sheet goes into both versions (it was dropped from the late-cancel ones).
  const why = r2 ? reason || s.cancelReason || '' : reason;
  if (s.canceledBy === 'organizer_fee_kept') {
    // With the fee split (LATE_FEE_SPLIT) the share is the split price ("your $9 share"); the words are otherwise the same.
    const body = r2
      ? canceledFeeKeptTextR2(s, d.group.timezone, nowMs, s.feeSplit?.priceCents ?? viewFlat(s, d.group.settings.pricePerPlayerCents), link, why)
      : canceledFeeKeptMessage(s.feeSplit?.priceCents ?? viewFlat(s, d.group.settings.pricePerPlayerCents), link);
    return { body, to: 'The players who were in', feeKept: true, reach: confirmedReach(d, s, true) };
  }
  return {
    body: r2 ? canceledCreditTextR2(s, d.group.timezone, nowMs, link, why) : canceledTodayMessage(link, reason),
    to: 'Everyone signed up and waiting',
    feeKept: false,
    reach: reach(s.roster.filter((r) => r.status === 'confirmed' || r.status === 'waitlisted'), d.me?.id ?? null),
  };
}
