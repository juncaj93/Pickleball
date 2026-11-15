// Zip 47 probes: organizer Clear, cancel after pair debts.
import { describe, expect, it } from 'vitest';
import { addGuest, admin, credit, drop, game, HOUR, join, lines, markPaid, mineOn, removeOwn, rowOf, world } from './w';

describe('G-L clears and cancels', () => {
  it('L1 pair debt short by 2 (paid $28), organizer Clear (my choice): $28 back', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'choice' });
    expect(c.status, c.text).toBe(200);
    console.log((await lines(w, g.start)).filter((l: string) => /Blair/.test(l)).slice(0, 3).join('\n'));
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it('L2 pair debt short by 2 unpaid, game canceled (venue waived): owes nothing', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: true });
    expect(r.status, r.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('L2', JSON.stringify({ owes: b.owesCents, lateFee: b.lateFee }));
    expect((await mineOn(w, 'Blair', g.id)).mine?.lateFee ?? null).toBeNull();
  });
  it('L3 owed spot (removed late, paid $28), game canceled with the fee kept, no split: Blair keeps how much on the game?', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    // Emery out late first (still 4 with Sam, no debt), then Blair removes Sam: owed.
    await drop(w, g.id, 'Emery');
    await removeOwn(w, g.id, 'Blair');
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(r.status, r.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('L3', JSON.stringify({ amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, lateFee: b.lateFee }), await credit(w, 'Blair'));
  });
});
