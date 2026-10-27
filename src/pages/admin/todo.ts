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

/** The red number on the Home tab: Needs attention items plus courts to book inside the booking window. */
export function homeBadgeCount(d: AdminDashboard): number {
  return buildTodo(d).length + d.sessions.filter((s) => s.state.flags.needsBooking).length;
}
