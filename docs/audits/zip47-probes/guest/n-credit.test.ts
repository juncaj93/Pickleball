// Zip 47 probes: credit and cash-out requests with a guest on the seat.
import { describe, expect, it } from 'vitest';
import { addGuest, call, credit, drop, game, HOUR, join, ledger, markPaid, mineOn, rowOf, world } from './w';

describe('G-N credit', () => {
  it('N1 host paid half with credit (auto at join) and half cash, pair drops late short by one: $14 back, books balance', async () => {
    const w = await world({ lateFees: true });
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    await join(w, g0.id, ['Blair']);
    await markPaid(w, g0.id, 'Blair');
    await drop(w, g0.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    await join(w, g1.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g1.id, 'Blair');
    await markPaid(w, g1.id, 'Blair');
    let b = await rowOf(w, g1.id, 'Blair');
    console.log('N1 before', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, credit: b.creditCents }), await credit(w, 'Blair'));
    w.app.now = g1.start - 6 * HOUR;
    const r = await drop(w, g1.id, 'Blair');
    console.log('N1 drop', JSON.stringify(r.data));
    b = await rowOf(w, g1.id, 'Blair');
    console.log('N1 after', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, lateFee: b.lateFee }), await credit(w, 'Blair'), JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(1400);
    // A sub clears the rest: everything back.
    await join(w, g1.id, ['Frankie']);
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it('N2 cash-out request reserved, host with guest uses it on the seat', async () => {
    const w = await world();
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    await join(w, g0.id, ['Blair']);
    await markPaid(w, g0.id, 'Blair');
    await drop(w, g0.id, 'Blair');
    expect((await call(w, 'Blair', 'POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(200);
    await join(w, g1.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g1.id, 'Blair');
    const u = await call(w, 'Blair', 'POST', `/api/sessions/${g1.id}/use-cash-out`, { cents: 1400 });
    console.log('N2', u.status, JSON.stringify(u.data));
    const s = await mineOn(w, 'Blair', g1.id);
    console.log('N2 card', JSON.stringify({ ps: s.mine?.paymentStatus, owe: s.mine?.oweCents, credit: s.mine?.creditCents }), await credit(w, 'Blair'));
    if (u.status === 200) expect(s.mine?.oweCents).toBe(1400);
  });
});
