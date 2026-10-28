// What the organizer's Home counts and lists. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { localParts } from '../../../shared/time';

export type TodoItem =
  | { kind: 'five' | 'sixdrop' | 'checkin' | 'refund' | 'latedrop'; session: AdminSessionView }
  | { kind: 'owed'; rows: OwedRow[] }
  | { kind: 'tonight'; rows: OwedRow[] };

export interface OwedRow {
  session: AdminSessionView;
  playerId: string;
  name: string;
  cents: number;
}

const upcoming = (s: AdminSessionView) => !s.state.flags.canceled && !s.state.flags.started;

/** Late drops the organizer hasn't tapped Done on. */
export const lateDrops = (s: AdminSessionView) => s.roster.filter((r) => r.status === 'withdrawn' && r.lateDropAt && !r.lateDropDoneAt);

/** Every late drop on a session, handled or not (the card tag and History). */
export const lateDropsAll = (s: AdminSessionView) => s.roster.filter((r) => r.status === 'withdrawn' && r.lateDropAt);

/** Who to pay back: everyone who paid for a canceled session, or anyone who paid and then dropped. */
export const refundRows = (s: AdminSessionView) =>
  s.roster.filter((r) => !r.isOrganizer && r.paymentStatus === 'paid' && (s.state.flags.canceled || r.status === 'withdrawn'));

/** Played: not canceled, and over. Money in for a game that is not played yet is "held". */
export const isPlayed = (s: AdminSessionView, nowMs: number) => !s.state.flags.canceled && Date.parse(s.endsAt) <= nowMs;

/** What a player paid that is still held: paid, not refunded, for a game not played yet (or canceled). The organizer's court row is never held money. */
export function heldCents(d: AdminDashboard, playerId?: string): number {
  const nowMs = Date.parse(d.now);
  let total = 0;
  for (const s of d.sessions) {
    if (isPlayed(s, nowMs)) continue;
    for (const r of s.roster) {
      if (r.isOrganizer || r.paymentStatus !== 'paid' || r.refundedAt || (playerId && r.playerId !== playerId)) continue;
      total += r.paymentAmountCents ?? 0;
    }
  }
  return total;
}

/**
 * The organizer's short list: things that aren't one session card's court or
 * players, most urgent first. Court actions and "short on players" live only
 * on the session card, so nothing shows twice.
 */
export function buildTodo(d: AdminDashboard): TodoItem[] {
  const items: TodoItem[] = [];
  const nowMs = Date.parse(d.now);
  const s = d.sessions;
  for (const x of s) if (x.state.flags.fiveGoing) items.push({ kind: 'five', session: x });
  for (const x of s) if (x.state.flags.checkInsDue) items.push({ kind: 'checkin', session: x });
  for (const x of s) if (x.sixDropped) items.push({ kind: 'sixdrop', session: x });
  // Late drops not yet looked at, while the session is still ahead.
  for (const x of s) if (upcoming(x) && lateDrops(x).length) items.push({ kind: 'latedrop', session: x });
  // Money to give back goes first: a canceled game, or a paid player who left.
  // (A late drop's refund lives on its own card until that's done.)
  const refunds: TodoItem[] = [];
  for (const x of s) {
    const showing = upcoming(x) && lateDrops(x).length > 0;
    if (!showing && refundRows(x).some((r) => !r.refundedAt)) refunds.push({ kind: 'refund', session: x });
  }
  // Who owes you: from the day-before check-in on, and after play. On game
  // day, that day's unpaid players get their own "Mark paid tonight" card at
  // the top, since most people pay at the court.
  const tz = d.group.timezone;
  const today = localParts(nowMs, tz);
  const isToday = (iso: string) => {
    const p = localParts(Date.parse(iso), tz);
    return p.year === today.year && p.month === today.month && p.day === today.day;
  };
  const tonight: OwedRow[] = [];
  const owed: OwedRow[] = [];
  for (const x of s) {
    if (x.state.flags.canceled || nowMs < Date.parse(x.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
    for (const r of x.roster) {
      if (!r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null) {
        (isToday(x.startsAt) ? tonight : owed).push({ session: x, playerId: r.playerId, name: r.name, cents: r.shareCents - r.creditCents });
      }
    }
  }
  if (tonight.length) items.unshift({ kind: 'tonight', rows: tonight });
  if (owed.length) items.push({ kind: 'owed', rows: owed });
  items.unshift(...refunds);
  return items;
}

/** The red number on the Home tab: Needs attention items plus courts to book, from 7:00 AM on the day booking opens. */
export function homeBadgeCount(d: AdminDashboard): number {
  return buildTodo(d).length + d.sessions.filter((s) => s.state.flags.bookingPromptDue).length;
}

/** The players who are in: their numbers, and the names with none saved. */
export function playersIn(s: AdminSessionView, meId?: string | null) {
  const inNow = s.roster.filter((r) => r.status === 'confirmed' && r.playerId !== meId);
  return {
    phones: inNow.filter((r) => r.phone).map((r) => r.phone!),
    missing: inNow.filter((r) => !r.phone).map((r) => r.name),
  };
}

/** 'chat': no numbers; Messages opens with just the words so the group chat can be picked. */
export type Audience = 'everyone' | 'in' | 'notIn' | 'wereIn' | 'chat';

/**
 * Who a text goes to, never including the organizer: everyone on the list,
 * the players who are in (or were, on a canceled game), or everyone not in.
 */
export function recipients(d: AdminDashboard, s: AdminSessionView, who: Audience) {
  const me = d.me?.id ?? null;
  if (who === 'chat') return { phones: [] as string[], missing: [] as string[], count: 0 };
  if (who === 'in' || who === 'wereIn') {
    const r = playersIn(s, me);
    return { ...r, count: r.phones.length + r.missing.length };
  }
  const inIds = new Set(s.roster.filter((r) => r.status === 'confirmed').map((r) => r.playerId));
  const people = d.players.filter((p) => p.isActive && p.id !== me && (who === 'everyone' || !inIds.has(p.id)));
  return {
    phones: people.filter((p) => p.phone).map((p) => p.phone!),
    missing: people.filter((p) => !p.phone).map((p) => p.name),
    count: people.length,
  };
}

/** "5 who are in", "Everyone (8)", "6 not in yet", "4 who were in". */
export function audienceLine(who: Audience, count: number): string {
  if (who === 'chat') return 'Pick the chat';
  if (who === 'everyone') return `Everyone (${count})`;
  if (who === 'in') return `${count} who ${count === 1 ? 'is' : 'are'} in`;
  if (who === 'wereIn') return `${count} who ${count === 1 ? 'was' : 'were'} in`;
  return `${count} not in yet`;
}

/** Short of 4 or 6: the day-before card leads with "need more players". */
export const shortOfPlayers = (s: AdminSessionView) => s.confirmedCount !== 4 && s.confirmedCount !== 6;

/**
 * One person's money right now: what they owe (sessions from the day-before
 * check-in on, unpaid, after any credit) and credit not yet counted there.
 * A credit coming off a game that's already owed shows once, inside "owes
 * $9", never again as "credit $5". Same rules as "Who owes" and the player's own screen.
 */
export function balanceOf(d: AdminDashboard, playerId: string): { owedCents: number; creditCents: number } {
  // The organizer pays the venue, so there is never a player balance for them.
  if (d.me?.id === playerId) return { owedCents: 0, creditCents: 0 };
  const nowMs = Date.parse(d.now);
  let owed = 0;
  let planned = 0;
  for (const s of d.sessions) {
    if (s.state.flags.canceled) continue;
    for (const r of s.roster) {
      if (r.isOrganizer || r.playerId !== playerId || r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null) continue;
      if (nowMs < Date.parse(s.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
      planned += r.creditCents;
      owed += r.shareCents - r.creditCents;
    }
  }
  const open = d.credits.find((c) => c.playerId === playerId)?.balanceCents ?? 0;
  // One pot per player: the credit they kept or were given back, plus the older $5 credit not already counted above.
  const pot = (d.creditLedger ?? []).find((c) => c.playerId === playerId)?.balanceCents ?? 0;
  return { owedCents: Math.max(0, owed), creditCents: Math.max(0, open - planned) + pot };
}
