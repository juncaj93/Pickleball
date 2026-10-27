// What the organizer's Home counts and lists. No React here, so tests can use it.
import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { courtStatus, type CourtKind } from '../../../shared/court';

export type TodoItem =
  | { kind: 'five' | 'tell' | 'sixdrop' | 'checkin' | 'daybefore' | 'lastcall'; session: AdminSessionView }
  | { kind: 'owed'; rows: OwedRow[] };

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
  // Who owes you: from the day-before check-in on, and after play.
  const owed: OwedRow[] = [];
  for (const x of s) {
    if (x.state.flags.canceled || nowMs < Date.parse(x.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
    for (const r of x.roster) {
      if (r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null) {
        owed.push({ session: x, playerId: r.playerId, name: r.name, cents: r.shareCents - r.creditCents });
      }
    }
  }
  if (owed.length) items.push({ kind: 'owed', rows: owed });
  return items;
}

export const courtOf = (s: AdminSessionView) =>
  courtStatus({ ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past }).kind;

/** Upcoming sessions by court status, for the summary line and the Home badge. */
export function courtCounts(sessions: AdminSessionView[], nowMs: number): Record<CourtKind, number> {
  const n: Record<CourtKind, number> = { booked: 0, needs: 0, waitlist: 0, off: 0 };
  for (const s of sessions) if (Date.parse(s.endsAt) > nowMs) n[courtOf(s)]++;
  return n;
}

