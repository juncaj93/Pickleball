// What the organizer's Home counts and lists. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { localParts } from '../../../shared/time';

export type TodoItem =
  | { kind: 'five' | 'tell' | 'sixdrop' | 'checkin' | 'daybefore' | 'lastcall' | 'refund'; session: AdminSessionView }
  | { kind: 'owed'; rows: OwedRow[] }
  | { kind: 'tonight'; rows: OwedRow[] };

export interface OwedRow {
  session: AdminSessionView;
  playerId: string;
  name: string;
  cents: number;
}

const upcoming = (s: AdminSessionView) => !s.state.flags.canceled && !s.state.flags.started;

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
  // Pay back anyone who paid for a session that was then canceled.
  for (const x of s) if (x.state.flags.canceled && x.roster.some((r) => r.paymentStatus === 'paid' && !r.refundedAt)) items.push({ kind: 'refund', session: x });
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

/** The red number on the Home tab: Needs attention items plus courts to book inside the booking window. */
export function homeBadgeCount(d: AdminDashboard): number {
  return buildTodo(d).length + d.sessions.filter((s) => s.state.flags.needsBooking).length;
}
