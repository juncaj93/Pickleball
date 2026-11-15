// Zip 47 probes: the same one-share debts with "Made cheaper after paying" (CHEAPER_FIX) on.
import { describe, expect, it } from 'vitest';
import { addGuest, admin, call, credit, drop, finalize, game, HOUR, ids, join, lines, markPaid, rowOf, world } from './w';

describe('G-B with Made cheaper after paying on', () => {
  it('B1 I paid $28 unconfirmed, late drop short by one, confirm, Finalize', async () => {
    const w = await world({ lateFees: true });
    expect((await admin(w, 'PUT', '/api/admin/cheaper-fix-switch', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g.id, 'Blair');
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true });
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Casey', 'Devon', 'Emery']) });
    expect(f.status, f.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('B1', await credit(w, 'Blair'), JSON.stringify(b.lateFee), b.paymentAmountCents);
    expect(await credit(w, 'Blair')).toBe(1400);
  });
  it('B2 rejoin then late drop again, Finalize', async () => {
    const w = await world({ lateFees: true });
    expect((await admin(w, 'PUT', '/api/admin/cheaper-fix-switch', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/join`, {});
    w.app.advance(60_000);
    const d2 = await drop(w, g.id, 'Blair');
    console.log('B2 drop2', JSON.stringify(d2.data), await credit(w, 'Blair'));
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Casey', 'Devon']) });
    expect(f.status, f.text).toBe(200);
    console.log('B2', await credit(w, 'Blair'));
    console.log((await lines(w, g.start)).filter((l: string) => /Blair/.test(l)).join('\n'));
    expect(await credit(w, 'Blair')).toBe(1400);
  });
});
