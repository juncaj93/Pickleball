// Instant taps on the Money page (MONEY_REWORK): what a tap looks like the moment it is made, that dropping it gives back exactly the data
// underneath (a failed save), and that drawing a tap twice changes nothing more. Pure logic; the real timing is checked in the browser test.
import { describe, expect, it } from 'vitest';
import type { AdminDashboard, AdminSessionView } from '../shared/api';
import { applyOps, opKey, type ReworkOp } from '../src/pages/admin/reworkOptimistic';
import { fullyPaid } from '../src/pages/admin/moneyRework';
import { owedCentsOf } from '../src/pages/admin/moneyList';

const NOW = '2026-11-04T23:00:00.000Z';
function seat(id: string, over: Record<string, unknown> = {}) {
  return { playerId: id, name: id, status: 'confirmed', paymentStatus: 'unpaid', owesCents: 1400, shareCents: 1400, creditCents: 0, paymentAmountCents: null, paidAt: null, selfPaid: false, isOrganizer: false, lateFee: null, ...over };
}
function dash(roster: any[], over: Record<string, unknown> = {}): AdminDashboard {
  const payers = roster.filter((r) => !r.isOrganizer && r.status === 'confirmed');
  const s = { id: 'g1', startsAt: '2026-11-05T00:00:00.000Z', endsAt: '2026-11-05T02:00:00.000Z', roster, payableCount: payers.length, paidCount: payers.filter((r) => r.paymentStatus === 'paid').length, confirmedCount: payers.length, finalized: null, needsFinalize: false, state: { flags: { canceled: false } }, chargedCents: null, ...over } as unknown as AdminSessionView;
  return { now: NOW, sessions: [s, { ...s, id: 'g2' }] } as unknown as AdminDashboard;
}
const g1 = (d: AdminDashboard) => d.sessions.find((s) => s.id === 'g1')!;
const row = (d: AdminDashboard, id: string) => g1(d).roster.find((r) => r.playerId === id)!;
const paid = (id: string): ReworkOp => ({ kind: 'paid', sessionId: 'g1', playerId: id });

describe('instant taps: what the screen shows the moment of the tap', () => {
  it('O1 Mark paid: the row is paid, nothing owed on it, dots and counts move, the game total owed drops', () => {
    const d = dash([seat('a'), seat('b'), seat('c')]);
    const after = applyOps(d, [paid('a')]);
    expect(row(after, 'a')).toMatchObject({ paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400, selfPaid: false });
    expect(g1(after)).toMatchObject({ paidCount: 1, payableCount: 3 });
    expect(owedCentsOf(g1(after))).toBe(2800);
    // Nothing else moved: the other game and the other rows are the same objects.
    expect(after.sessions[1]).toBe(d.sessions[1]);
    expect(row(after, 'b')).toBe(row(d, 'b'));
  });
  it('O2 the last Mark paid makes the game fully paid at once (it moves to Previous games)', () => {
    const d = dash([seat('a', { paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400 }), seat('b')]);
    expect(fullyPaid(g1(d))).toBe(false);
    expect(fullyPaid(g1(applyOps(d, [paid('b')])))).toBe(true);
  });
  it('O3 Undo of a cash payment: owes again and the dots go back; Undo of a credit payment returns the credit', () => {
    const d = dash([seat('a', { paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400 }), seat('b', { paymentStatus: 'paid', owesCents: 0, creditCents: 1400, paymentAmountCents: 1400 })]);
    const after = applyOps(d, [{ kind: 'unpaid', sessionId: 'g1', playerId: 'a' }, { kind: 'unpaid', sessionId: 'g1', playerId: 'b' }]);
    expect(row(after, 'a')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400, paymentAmountCents: null });
    expect(row(after, 'b')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400, creditCents: 0 });
    expect(g1(after).paidCount).toBe(0);
  });
  it('O4 Undo of credit put on a seat that still owes puts the credit back', () => {
    const d = dash([seat('a', { creditCents: 300, owesCents: 1100 })]);
    expect(row(applyOps(d, [{ kind: 'creditUndo', sessionId: 'g1', playerId: 'a' }]), 'a')).toMatchObject({ creditCents: 0, owesCents: 1400 });
  });
  it('O5 confirming an "I paid" only clears the self-marked tag, and Clear removes a late fee row and its dot', () => {
    const claim = dash([seat('a', { paymentStatus: 'paid', owesCents: 0, selfPaid: true, paymentAmountCents: 1400 })]);
    expect(row(applyOps(claim, [paid('a')]), 'a')).toMatchObject({ paymentStatus: 'paid', selfPaid: false });
    expect(g1(applyOps(claim, [paid('a')])).paidCount).toBe(1);
    const fee = dash([seat('a', { lateFee: { kind: 'late_drop', paid: false, oweCents: 1400 } }), seat('b')]);
    const cleared = applyOps(fee, [{ kind: 'clear', sessionId: 'g1', playerId: 'a' }]);
    expect(row(cleared, 'a').lateFee).toBeNull();
    expect(g1(cleared).payableCount).toBe(1);
  });
  it('O6 Reopen, Hide and Edit charge draw at once', () => {
    const fin = dash([seat('a')], { finalized: { priceCents: 1400 }, endsAt: '2026-11-04T01:00:00.000Z' });
    expect(g1(applyOps(fin, [{ kind: 'reopen', sessionId: 'g1' }])).finalized).toBeNull();
    expect(g1(applyOps(dash([]), [{ kind: 'hide', sessionId: 'g1' }])).hiddenFromList).toBe(true);
    expect(g1(applyOps(dash([], { chargedCents: 4800 }), [{ kind: 'charge', sessionId: 'g1', cents: 0 }])).chargedCents).toBeNull();
    expect(g1(applyOps(dash([]), [{ kind: 'charge', sessionId: 'g1', cents: 4800 }])).chargedCents).toBe(4800);
  });
});

describe('instant taps: a failed save and double taps', () => {
  it('O7 a failed save: dropping the tap gives back exactly the data underneath (same object, nothing left over)', () => {
    const d = dash([seat('a'), seat('b')]);
    const before = JSON.stringify(d);
    const drawn = applyOps(d, [paid('a')]);
    expect(drawn).not.toBe(d);
    const rolledBack = applyOps(d, []);
    expect(rolledBack).toBe(d);
    expect(JSON.stringify(rolledBack)).toBe(before);
    expect(JSON.stringify(d)).toBe(before); // drawing never edits the real data
  });
  it('O8 drawing the same tap twice (a double tap) is the same screen as once', () => {
    const d = dash([seat('a'), seat('b')]);
    expect(JSON.stringify(applyOps(d, [paid('a'), paid('a')]))).toBe(JSON.stringify(applyOps(d, [paid('a')])));
  });
  it('O9 one key per row, so a second tap on the same row while its save runs is ignored; other rows and games are independent', () => {
    expect(opKey(paid('a'))).toBe(opKey({ kind: 'unpaid', sessionId: 'g1', playerId: 'a' }));
    expect(opKey(paid('a'))).not.toBe(opKey(paid('b')));
    expect(opKey({ kind: 'hide', sessionId: 'g1' })).not.toBe(opKey({ kind: 'hide', sessionId: 'g2' }));
  });
  it('O10 once the real data arrives (the row is paid for real), the same tap on top changes nothing', () => {
    const real = dash([seat('a', { paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400 })]);
    expect(applyOps(real, [paid('a')])).toBe(real);
  });
});
