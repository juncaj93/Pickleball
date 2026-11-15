// Zip 47 probes: a host with a guest who drops late, money left on a one-share debt.
import { describe, expect, it } from 'vitest';
import { addGuest, adminGame, call, credit, drop, finalize, game, HOUR, ids, join, ledger, lines, markPaid, mineOn, money, rowOf, world } from './w';

describe('G-A late drops with a guest', () => {
  it('A1 host taps I paid $28 (unconfirmed), drops late leaving the game short by one, organizer confirms, Finalize: what does the host keep paying?', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g.id, 'Blair');
    const p = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true });
    expect(p.status, p.text).toBe(200);
    w.app.now = g.start - 6 * HOUR;
    const card = await mineOn(w, 'Blair', g.id);
    console.log('A1 card lateDrop', JSON.stringify(card.mine?.lateDrop));
    const r = await drop(w, g.id, 'Blair');
    console.log('A1 drop', r.status, JSON.stringify(r.data));
    let b = await rowOf(w, g.id, 'Blair');
    console.log('A1 after drop', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, lateFee: b.lateFee, self: b.selfPaid }));
    // Organizer confirms the I paid (Mark paid).
    const m = await markPaid(w, g.id, 'Blair');
    console.log('A1 confirm', m.status, m.text.slice(0, 200));
    b = await rowOf(w, g.id, 'Blair');
    console.log('A1 after confirm', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, lateFee: b.lateFee }));
    console.log('A1 credit after confirm', await credit(w, 'Blair'));
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Casey', 'Devon', 'Emery']) });
    expect(f.status, f.text).toBe(200);
    const cr = await credit(w, 'Blair');
    b = await rowOf(w, g.id, 'Blair');
    console.log('A1 after finalize credit', cr, JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, lateFee: b.lateFee }), JSON.stringify(ledger(w, 'Blair')));
    // The rule: short by one spot = owes $14. Paid $28, so $14 should come back.
    expect(cr).toBe(1400);
  });

  it('A2 host+guest drop late short by 2 with $28 paid, host rejoins alone, drops late again (short by one), Finalize with no sub', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const d1 = await drop(w, g.id, 'Blair');
    console.log('A2 drop1', JSON.stringify(d1.data));
    w.app.advance(60_000);
    const j = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/join`, {});
    console.log('A2 rejoin', j.status, JSON.stringify(j.data));
    let b = await rowOf(w, g.id, 'Blair');
    console.log('A2 after rejoin', JSON.stringify({ st: b.status, ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, guest: b.guest, lateFee: b.lateFee }));
    w.app.advance(60_000);
    const d2 = await drop(w, g.id, 'Blair');
    console.log('A2 drop2', JSON.stringify(d2.data));
    b = await rowOf(w, g.id, 'Blair');
    console.log('A2 after drop2', JSON.stringify({ st: b.status, ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, lateFee: b.lateFee }));
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Casey', 'Devon']) });
    expect(f.status, f.text).toBe(200);
    const cr = await credit(w, 'Blair');
    console.log('A2 credit after finalize', cr, JSON.stringify(ledger(w, 'Blair')));
    // A one-person late drop owes $14: of $28 paid, $14 should come back.
    expect(cr).toBe(1400);
  });

  it('A3 host+guest drop late short by 2, $28 paid, host rejoins alone, Finalize (played): $14 back (known, accepted: kept until Finalize)', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/join`, {});
    const s = await mineOn(w, 'Blair', g.id);
    console.log('A3 host card after rejoin', JSON.stringify({ ps: s.mine?.paymentStatus, share: s.mine?.shareCents, owe: s.mine?.oweCents, dropCash: s.mine?.dropCashCents }));
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { everyone: true });
    expect(f.status, f.text).toBe(200);
    console.log('A3 finalize', JSON.stringify(f.data));
    expect(await credit(w, 'Blair')).toBe(2800 - f.data.priceCents);
  });

  it('A4 books after a late pair drop short by 2, two subs: Activity and Money agree', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    await join(w, g.id, ['Emery']);
    w.app.advance(60_000);
    await join(w, g.id, ['Frankie']);
    const l = (await lines(w, g.start)).filter((x: string) => /Blair/.test(x));
    console.log('A4 lines\n' + l.join('\n'));
    expect(await credit(w, 'Blair')).toBe(2800);
    for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { everyone: true });
    expect(f.status, f.text).toBe(200);
    const m = await money(w, '2026-10');
    const s = m.sessions.find((x: any) => x.id === g.id);
    console.log('A4 money', JSON.stringify(s));
    expect(s.collectedCents).toBe(5600);
  });

  it('A5 I paid $28 unconfirmed, pair drops late short by 2, one sub takes the guest spot, organizer confirms, Finalize: $14 should come back', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    await join(w, g.id, ['Emery']);
    const l = (await lines(w, g.start)).filter((x: string) => /Blair|Sam/.test(x));
    console.log('A5 lines\n' + l.slice(0, 3).join('\n'));
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Casey', 'Devon', 'Emery']) });
    expect(f.status, f.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('A5', await credit(w, 'Blair'), JSON.stringify({ amt: b.paymentAmountCents, lateFee: b.lateFee }));
    expect(await credit(w, 'Blair')).toBe(1400);
  });
});
