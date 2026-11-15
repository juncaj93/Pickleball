// Zip 47 probes: Guest spot switched OFF while guests exist; organizer actions; credit use.
import { describe, expect, it } from 'vitest';
import { addGuest, admin, adminGame, adminRemoveGuest, call, credit, drop, finalize, game, HOUR, ids, join, ledger, lines, markPaid, mineOn, removeOwn, rowOf, world } from './w';

const off = (w: any) => admin(w, 'PUT', '/api/admin/guest-spot-switch', { on: false });

describe('G-E switch off with guests', () => {
  it('E1 guest in, paid $28, switch off: counts, host card, host cannot remove, organizer can, $14 back', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    expect((await off(w)).status).toBe(200);
    const s = await mineOn(w, 'Blair', g.id);
    console.log('E1 host card', JSON.stringify({ guest: s.mine?.guest, share: s.mine?.shareCents, count: s.countText, names: s.confirmed.map((c) => c.name) }));
    expect(s.countText).toBe('4 in');
    const a = await adminGame(w, g.id);
    console.log('E1 admin', a.confirmedCount, a.paidCount, a.payableCount, JSON.stringify(a.roster.find((r: any) => r.name === 'Blair').guest));
    expect(a.payableCount).toBe(4);
    const h = await removeOwn(w, g.id, 'Blair');
    console.log('E1 host remove', h.status, h.text);
    const r = await adminRemoveGuest(w, g.id, 'Blair');
    expect(r.status, r.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect((await addGuest(w, g.id, 'Blair', 'Lee')).status).toBe(403);
  });
  it('E2 switch off: Finalize with the guest out, mark guest share, Reopen, redo', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/share`, { playerId: w.byName.Blair, who: 'guest', paid: true })).status).toBe(200);
    await off(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/share`, { playerId: w.byName.Blair, who: 'host', paid: true })).status).toBe(200);
    for (const n of ['Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Blair']) });
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(4);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    const f2 = await finalize(w, g.id, { everyone: true });
    expect(f2.data.played).toBe(5);
    expect(await credit(w, 'Blair')).toBe(2800 - 2 * f2.data.priceCents);
  });
  it('E3 switch off with an owed spot (removed late): organizer clears it; host drop late still works', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    expect((await removeOwn(w, g.id, 'Blair')).data.lateOwesCents).toBe(1400);
    await off(w);
    const c = await adminRemoveGuest(w, g.id, 'Blair');
    expect(c.status, c.text).toBe(200);
    console.log('E3 clear', JSON.stringify(c.data));
    expect(await credit(w, 'Blair')).toBe(1400);
    console.log((await lines(w, g.start)).filter((l: string) => /Blair|Sam/.test(l)).join('\n'));
  });
  it('E4 waitlisted guest when switch goes off: still moves in on a drop, host then owes $28', async () => {
    const w = await world({ maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    await off(w);
    await drop(w, g.id, 'Casey');
    const s = await mineOn(w, 'Blair', g.id);
    console.log('E4', JSON.stringify(s.mine?.guest), s.mine?.oweCents, s.countText);
    expect(s.mine?.oweCents).toBe(2800);
  });
});

describe('G-F organizer actions and credit', () => {
  it('F1 organizer removes a host who owes a removed guest\'s spot (paid $28): all $28 back, no debt', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await removeOwn(w, g.id, 'Blair');
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'withdraw' });
    expect(r.status, r.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('F1', JSON.stringify({ st: b.status, lateFee: b.lateFee, guest: b.guest }), JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it('F2 Use credit on a seat that holds $14 cash (paid before the guest came): takes only the $14 owed', async () => {
    const w = await world();
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    await join(w, g1.id, ['Blair', 'Casey', 'Devon']);
    await markPaid(w, g1.id, 'Blair');
    await addGuest(w, g1.id, 'Blair');
    // $28 credit for Blair from another game.
    await join(w, g0.id, ['Blair']);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g0.id}/paid`, { paid: true })).status).toBe(200);
    await markPaid(w, g0.id, 'Blair');
    await drop(w, g0.id, 'Blair');
    const before = await credit(w, 'Blair');
    console.log('F2 credit before', before);
    const s0 = await mineOn(w, 'Blair', g1.id);
    console.log('F2 card', JSON.stringify({ owe: s0.mine?.oweCents, use: s0.mine?.useCreditCents, earlier: s0.mine?.paidEarlierCents }));
    const u = await call(w, 'Blair', 'POST', `/api/sessions/${g1.id}/use-credit`, {});
    console.log('F2 use', u.status, JSON.stringify(u.data));
    const b = await rowOf(w, g1.id, 'Blair');
    console.log('F2 row', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents }), JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(before - 1400);
  });
  it('F3 organizer moves a paid host with a guest in to the waitlist, then gives the spot back: no money lost or doubled', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const m = await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'waitlist' });
    console.log('F3 to waitlist', m.status, m.text.slice(0, 150));
    let b = await rowOf(w, g.id, 'Blair');
    console.log('F3 after', JSON.stringify({ st: b.status, ps: b.paymentStatus, amt: b.paymentAmountCents, guest: b.guest }), await credit(w, 'Blair'));
    const back = await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'confirm' });
    console.log('F3 back', back.status, back.text.slice(0, 150));
    b = await rowOf(w, g.id, 'Blair');
    const a = await adminGame(w, g.id);
    console.log('F3 end', JSON.stringify({ st: b.status, ps: b.paymentStatus, amt: b.paymentAmountCents, share: b.shareCents, owes: b.owesCents, guest: b.guest }), a.confirmedCount, a.waitlistCount);
    w.app.now = g.start + 3 * HOUR;
    for (const n of ['Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    const f = await finalize(w, g.id, { everyone: true });
    expect(f.status, f.text).toBe(200);
    console.log('F3 finalize', JSON.stringify(f.data), await credit(w, 'Blair'));
    // Whatever happened to Sam, Blair paid $28: what he keeps paying = price x people of his who played.
    const units = f.data.played === 5 ? 2 : 1;
    expect(await credit(w, 'Blair')).toBe(2800 - units * f.data.priceCents);
  });
  it('F4 host with credit: guest moves in from the waitlist; does the credit pot cover the new share like I\'m in would?', async () => {
    const w = await world({ maxPlayers: 5 });
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    await join(w, g0.id, ['Blair']);
    await markPaid(w, g0.id, 'Blair');
    await drop(w, g0.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    await join(w, g1.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g1.id, 'Blair');
    await drop(w, g1.id, 'Casey');
    const s = await mineOn(w, 'Blair', g1.id);
    console.log('F4', JSON.stringify({ ps: s.mine?.paymentStatus, owe: s.mine?.oweCents, use: s.mine?.useCreditCents }), await credit(w, 'Blair'));
    // Not money lost either way: the host can still tap Use credit for the guest's share.
    expect(s.mine?.oweCents).toBe(1400);
  });
});
