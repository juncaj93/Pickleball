import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';

// Instant taps on the reworked Money page (MONEY_REWORK). A tap is drawn at once by laying a small "what this will become" patch over the
// data the screen already has; the real save runs in the background. When the server confirms, the screen reloads the real data and the
// patch is dropped; if it fails, the patch is simply dropped and the screen is exactly as it was. Pure functions, no network.

export type ReworkOp =
  | { kind: 'paid'; sessionId: string; playerId: string }
  | { kind: 'unpaid'; sessionId: string; playerId: string }
  | { kind: 'creditUndo'; sessionId: string; playerId: string }
  | { kind: 'clear'; sessionId: string; playerId: string }
  | { kind: 'reopen'; sessionId: string }
  | { kind: 'hide'; sessionId: string }
  | { kind: 'charge'; sessionId: string; cents: number };

/** One key per thing a tap can change: a second tap on the same thing while its save runs is ignored. */
export const opKey = (op: ReworkOp): string => ('playerId' in op ? `row:${op.sessionId}:${op.playerId}` : `${op.kind}:${op.sessionId}`);

const counted = (r: AdminRosterEntry) => !!r.lateFee || (!r.isOrganizer && r.status === 'confirmed' && r.paymentStatus !== 'not_applicable');
const isPaid = (r: AdminRosterEntry) => (r.lateFee ? r.lateFee.paid : r.paymentStatus === 'paid');

function patchRow(s: AdminSessionView, playerId: string, f: (r: AdminRosterEntry) => AdminRosterEntry, now: string): AdminSessionView {
  const i = s.roster.findIndex((r) => r.playerId === playerId);
  if (i < 0) return s;
  const before = s.roster[i];
  const after = f(before);
  if (after === before) return s;
  const roster = s.roster.slice();
  roster[i] = after;
  let { paidCount, payableCount } = s;
  if (counted(before)) {
    if (!counted(after)) {
      payableCount -= 1;
      if (isPaid(before)) paidCount -= 1;
    } else if (isPaid(before) !== isPaid(after)) paidCount += isPaid(after) ? 1 : -1;
  }
  void now;
  return { ...s, roster, paidCount: Math.max(0, paidCount), payableCount: Math.max(0, payableCount) };
}

const share = (r: AdminRosterEntry) => r.shareCents ?? r.owesCents + r.creditCents;

function applyOne(s: AdminSessionView, op: ReworkOp, now: string): AdminSessionView {
  switch (op.kind) {
    case 'paid':
      return patchRow(
        s,
        op.playerId,
        (r) => {
          if (r.lateFee) return r.lateFee.paid ? r : { ...r, paymentStatus: 'paid', owesCents: 0, selfPaid: false, paidAt: now, lateFee: { ...r.lateFee, paid: true } };
          if (r.paymentStatus === 'paid') return r.selfPaid ? { ...r, selfPaid: false } : r; // confirming an "I paid"
          return { ...r, paymentStatus: 'paid', owesCents: 0, selfPaid: false, paidAt: now, paymentAmountCents: share(r) };
        },
        now,
      );
    case 'unpaid':
      return patchRow(
        s,
        op.playerId,
        (r) => {
          if (r.lateFee) return r.lateFee.paid ? { ...r, paymentStatus: 'unpaid', owesCents: r.lateFee.oweCents, selfPaid: false, paidAt: null, lateFee: { ...r.lateFee, paid: false } } : r;
          if (r.paymentStatus !== 'paid') return r;
          // Paid wholly with credit: the credit goes back to their pot. Cash: the credit used stays on the seat.
          const withCreditOnly = r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0);
          const credit = withCreditOnly ? 0 : r.creditCents;
          return { ...r, paymentStatus: 'unpaid', owesCents: Math.max(0, share(r) - credit), creditCents: credit, selfPaid: false, paidAt: null, paymentAmountCents: null };
        },
        now,
      );
    case 'creditUndo':
      return patchRow(s, op.playerId, (r) => (r.creditCents > 0 && r.paymentStatus !== 'paid' ? { ...r, creditCents: 0, owesCents: share(r) } : r), now);
    case 'clear':
      return patchRow(s, op.playerId, (r) => (r.lateFee ? { ...r, lateFee: null, owesCents: 0, paymentStatus: 'not_applicable' } : r), now);
    case 'reopen':
      return s.finalized ? { ...s, finalized: null, needsFinalize: Date.parse(s.endsAt) <= Date.parse(now) && s.confirmedCount > 0 } : s;
    case 'hide':
      return s.hiddenFromList ? s : { ...s, hiddenFromList: true };
    case 'charge':
      return { ...s, chargedCents: op.cents > 0 ? op.cents : null };
  }
}

/**
 * The dashboard with these taps already drawn. No taps: the very same object (so nothing redraws). Drawing the same tap twice gives the same
 * screen, and dropping a tap gives back exactly the data underneath.
 */
export function applyOps(d: AdminDashboard, ops: ReworkOp[]): AdminDashboard {
  if (ops.length === 0) return d;
  const by = new Map<string, ReworkOp[]>();
  for (const op of ops) by.set(op.sessionId, [...(by.get(op.sessionId) ?? []), op]);
  let changed = false;
  const sessions = d.sessions.map((s) => {
    const mine = by.get(s.id);
    if (!mine) return s;
    const next = mine.reduce((acc, op) => applyOne(acc, op, d.now), s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...d, sessions } : d;
}
