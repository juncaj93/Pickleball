// Zip 47 probes: an unconfirmed I paid on the host when the waiting guest moves in.
import { describe, expect, it } from 'vitest';
import { addGuest, adminGame, call, credit, drop, finalize, game, HOUR, ids, join, markPaid, mineOn, rowOf, world } from './w';

describe('G-M I paid and a guest moving in', () => {
  it('M1 host taps I paid $14 while the guest waits; the guest moves in; organizer confirms: does the seat still owe the guest\'s $14?', async () => {
    const w = await world({ maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect((await addGuest(w, g.id, 'Blair')).data.guest.status).toBe('waitlisted');
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    await drop(w, g.id, 'Casey');
    let s = await mineOn(w, 'Blair', g.id);
    console.log('M1 host card after move-in', JSON.stringify({ guest: s.mine?.guest, ps: s.mine?.paymentStatus, share: s.mine?.shareCents, owe: s.mine?.oweCents, self: s.mine?.selfPaid }));
    await markPaid(w, g.id, 'Blair');
    const b = await rowOf(w, g.id, 'Blair');
    const a = await adminGame(w, g.id);
    console.log('M1 after confirm', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, share: b.shareCents, owes: b.owesCents, g: b.guest }), a.paidCount, a.payableCount);
    s = await mineOn(w, 'Blair', g.id);
    console.log('M1 host card after confirm', JSON.stringify({ ps: s.mine?.paymentStatus, share: s.mine?.shareCents, owe: s.mine?.oweCents }));
    w.app.now = g.start + 3 * HOUR;
    for (const n of ['Devon', 'Emery', 'Frankie']) await markPaid(w, g.id, n);
    const f = await finalize(w, g.id, { everyone: true });
    expect(f.status, f.text).toBe(200);
    const b2 = await rowOf(w, g.id, 'Blair');
    console.log('M1 after finalize', JSON.stringify(f.data), JSON.stringify({ ps: b2.paymentStatus, amt: b2.paymentAmountCents, owes: b2.owesCents }), await credit(w, 'Blair'));
    // Before Finalize the seat should read as owing $14 more.
    expect(b.owesCents).toBe(1400);
  });
});
