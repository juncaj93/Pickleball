// What the organizer's Home counts and lists. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView, RefundRequestView } from '../../../shared/api';
import { localParts } from '../../../shared/time';

export type TodoItem =
  | { kind: 'finalize' | 'latedrop'; session: AdminSessionView }
  | { kind: 'refund_request'; request: RefundRequestView }
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

/** Finalized: the organizer said who played, so its money is counted. */
export const isPlayed = (s: AdminSessionView) => !s.state.flags.canceled && !!s.finalized;

/**
 * What a player paid that is still held: paid, not settled, for a game not
 * finalized yet. The organizer's court row is never held money.
 */
export function heldCents(d: AdminDashboard, playerId?: string): number {
  let total = 0;
  for (const s of d.sessions) {
    if (isPlayed(s) || s.state.flags.canceled) continue;
    for (const r of s.roster) {
      if (r.isOrganizer || r.paymentStatus !== 'paid' || r.refundedAt || (playerId && r.playerId !== playerId)) continue;
      total += r.paymentAmountCents ?? 0;
    }
  }
  return total;
}

/**
 * The organizer's short list: refund requests first, then games to finalize,
 * then late drops and who owes. Court actions and "short on players" live
 * only on the session card, so nothing shows twice.
 */
export function buildTodo(d: AdminDashboard): TodoItem[] {
  const items: TodoItem[] = [];
  const nowMs = Date.parse(d.now);
  const s = d.sessions;
  for (const r of d.refundRequests) items.push({ kind: 'refund_request', request: r });
  for (const x of s) if (x.needsFinalize) items.push({ kind: 'finalize', session: x });
  // Late drops not yet looked at, while the session is still ahead.
  for (const x of s) if (upcoming(x) && lateDrops(x).length) items.push({ kind: 'latedrop', session: x });
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
      if (!r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null && r.owesCents > 0) {
        (isToday(x.startsAt) ? tonight : owed).push({ session: x, playerId: r.playerId, name: r.name, cents: r.owesCents });
      }
    }
  }
  if (tonight.length) items.push({ kind: 'tonight', rows: tonight });
  if (owed.length) items.push({ kind: 'owed', rows: owed });
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

/** Under 4: the day-before card leads with "need more players". */
export const shortOfPlayers = (s: AdminSessionView) => s.confirmedCount < 4;

/**
 * One person's money right now: what they owe (sessions from the day-before
 * check-in on, unpaid, after credit used on them) and their credit pot.
 * Same rules as "Who owes" and the player's own screen.
 */
export function balanceOf(d: AdminDashboard, playerId: string): { owedCents: number; creditCents: number } {
  // The organizer pays the venue, so there is never a player balance for them.
  if (d.me?.id === playerId) return { owedCents: 0, creditCents: 0 };
  const nowMs = Date.parse(d.now);
  let owed = 0;
  for (const s of d.sessions) {
    if (s.state.flags.canceled) continue;
    for (const r of s.roster) {
      if (r.isOrganizer || r.playerId !== playerId || r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null) continue;
      if (nowMs < Date.parse(s.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
      owed += r.owesCents;
    }
  }
  const pot = (d.creditLedger ?? []).find((c) => c.playerId === playerId)?.balanceCents ?? 0;
  return { owedCents: Math.max(0, owed), creditCents: pot };
}
