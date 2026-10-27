// What the organizer's Home counts and lists. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { localParts } from '../../../shared/time';

export type TodoItem =
  | { kind: 'five' | 'tell' | 'sixdrop' | 'checkin' | 'daybefore' | 'lastcall' | 'refund' | 'latedrop'; session: AdminSessionView }
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
  s.roster.filter((r) => r.paymentStatus === 'paid' && (s.state.flags.canceled || r.status === 'withdrawn'));

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
  for (const x of s)
    if (upcoming(x) && x.roster.some((r) => r.status === 'confirmed' && r.promotedAt && !r.promotionNotifiedAt))
      items.push({ kind: 'tell', session: x });
  for (const x of s) if (x.cards.lastCall) items.push({ kind: 'lastcall', session: x });
  for (const x of s) if (x.cards.dayBefore) items.push({ kind: 'daybefore', session: x });
  for (const x of s) if (x.state.flags.checkInsDue) items.push({ kind: 'checkin', session: x });
  for (const x of s) if (x.sixDropped) items.push({ kind: 'sixdrop', session: x });
  // Late drops not yet looked at, while the session is still ahead.
  for (const x of s) if (upcoming(x) && lateDrops(x).length) items.push({ kind: 'latedrop', session: x });
  // Pay back anyone who paid and then the session was canceled or they dropped
  // (a late drop's refund lives on its own card until that's done).
  for (const x of s) {
    const showing = upcoming(x) && lateDrops(x).length > 0;
    if (!showing && refundRows(x).some((r) => !r.refundedAt)) items.push({ kind: 'refund', session: x });
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
      if (r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null) {
        (isToday(x.startsAt) ? tonight : owed).push({ session: x, playerId: r.playerId, name: r.name, cents: r.shareCents - r.creditCents });
      }
    }
  }
  if (tonight.length) items.unshift({ kind: 'tonight', rows: tonight });
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

export type Audience = 'everyone' | 'in' | 'notIn' | 'wereIn';

/**
 * Who a text goes to, never including the organizer: everyone on the list,
 * the players who are in (or were, on a canceled game), or everyone not in.
 */
export function recipients(d: AdminDashboard, s: AdminSessionView, who: Audience) {
  const me = d.me?.id ?? null;
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
  if (who === 'everyone') return `Everyone (${count})`;
  if (who === 'in') return `${count} who ${count === 1 ? 'is' : 'are'} in`;
  if (who === 'wereIn') return `${count} who ${count === 1 ? 'was' : 'were'} in`;
  return `${count} not in yet`;
}

/** Short of 4 or 6: the day-before card leads with "need more players". */
export const shortOfPlayers = (s: AdminSessionView) => s.confirmedCount !== 4 && s.confirmedCount !== 6;
