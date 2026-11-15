// Zip 47 probes: double taps and two phones at once (Promise.all; the fake clock gives both the same millisecond).
import { describe, expect, it } from 'vitest';
import { addGuest, admin, adminGame, adminRemoveGuest, call, credit, drop, game, HOUR, join, ledger, markPaid, mineOn, raw, removeOwn, rowOf, world } from './w';

const sumPot = (rows: any[]) => rows.filter((r) => r.ended_at === null).reduce((s, r) => s + (r.kind === 'kept' ? r.amount_cents : r.kind === 'used' ? -r.amount_cents : 0), 0);

describe('G-C races', () => {
  it('C1 host Remove guest and organizer Remove guest at once on a paid $28 seat: $14 back once', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const [a, b] = await Promise.all([removeOwn(w, g.id, 'Blair'), adminRemoveGuest(w, g.id, 'Blair')]);
    console.log('C1', a.status, JSON.stringify(a.data), b.status, JSON.stringify(b.data));
    const r = await rowOf(w, g.id, 'Blair');
    console.log('C1 row', JSON.stringify({ ps: r.paymentStatus, amt: r.paymentAmountCents, share: r.shareCents, owes: r.owesCents }), JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(r.paymentAmountCents).toBe(1400);
  });
  it('C1b same, two host phones (double tap)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const [a, b] = await Promise.all([removeOwn(w, g.id, 'Blair'), removeOwn(w, g.id, 'Blair')]);
    console.log('C1b', a.status, b.status);
    expect(await credit(w, 'Blair')).toBe(1400);
  });
  it('C2 two Add a guest at once for the same host', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await markPaid(w, g.id, 'Blair');
    const [a, b] = await Promise.all([addGuest(w, g.id, 'Blair', 'Sam'), addGuest(w, g.id, 'Blair', 'Lee')]);
    console.log('C2', a.status, b.status, a.text.slice(0, 100), b.text.slice(0, 100));
    const r = await rowOf(w, g.id, 'Blair');
    console.log('C2 row', JSON.stringify({ g: r.guest, ps: r.paymentStatus, owes: r.owesCents, earlier: r.paidEarlierCents }), JSON.stringify(ledger(w, 'Blair')));
    expect(r.owesCents).toBe(1400);
    expect(sumPot(ledger(w, 'Blair'))).toBe(0);
  });
  it('C3 double tap Drop out, late, short by one, paid $28: $14 back once', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const [a, b] = await Promise.all([drop(w, g.id, 'Blair'), drop(w, g.id, 'Blair')]);
    console.log('C3', JSON.stringify(a.data), JSON.stringify(b.data));
    console.log('C3 ledger', JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(1400);
  });
  it('C4 Add a guest and a player I\'m in at once for the last spot (max 5)', async () => {
    const w = await world({ maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    const [a, b] = await Promise.all([addGuest(w, g.id, 'Blair'), call(w, 'Frankie', 'POST', `/api/sessions/${g.id}/join`, {})]);
    console.log('C4', a.status, JSON.stringify(a.data), b.status, JSON.stringify(b.data));
    const ag = await adminGame(w, g.id);
    console.log('C4 count', ag.confirmedCount, ag.waitlistCount);
    expect(ag.confirmedCount).toBeLessThanOrEqual(5);
  });
  it('C5 organizer removes the host while the host removes the guest (paid $28): all $28 back once', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const [a, b] = await Promise.all([admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'withdraw' }), removeOwn(w, g.id, 'Blair')]);
    console.log('C5', a.status, b.status, b.text.slice(0, 120));
    console.log('C5 ledger', JSON.stringify(ledger(w, 'Blair')));
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it('C6 Mark guest share paid and Mark paid (host row) at once: never more than $28', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    const [a, b] = await Promise.all([
      admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/share`, { playerId: w.byName.Blair, who: 'guest', paid: true }),
      admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/share`, { playerId: w.byName.Blair, who: 'host', paid: true }),
    ]);
    console.log('C6', a.status, a.text.slice(0, 100), b.status, b.text.slice(0, 100));
    const r = await rowOf(w, g.id, 'Blair');
    console.log('C6 row', JSON.stringify({ ps: r.paymentStatus, amt: r.paymentAmountCents, owes: r.owesCents, earlier: r.paidEarlierCents, g: r.guest }), JSON.stringify(ledger(w, 'Blair')));
    const covered = r.paymentStatus === 'paid' ? r.paymentAmountCents : r.paidEarlierCents;
    expect(covered + r.owesCents).toBe(2800);
  });
  it('C7 double tap Mark guest share paid', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    const share = () => admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/share`, { playerId: w.byName.Blair, who: 'guest', paid: true });
    const [a, b] = await Promise.all([share(), share()]);
    console.log('C7', a.status, a.text.slice(0, 80), b.status, b.text.slice(0, 80));
    const r = await rowOf(w, g.id, 'Blair');
    console.log('C7 row', JSON.stringify({ ps: r.paymentStatus, amt: r.paymentAmountCents, owes: r.owesCents, earlier: r.paidEarlierCents }), JSON.stringify(ledger(w, 'Blair')));
    expect(r.owesCents).toBe(1400);
  });
  it('C8 two subs at the same moment after a late pair drop short by 2 (paid $28)', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    const [a, b] = await Promise.all([call(w, 'Emery', 'POST', `/api/sessions/${g.id}/join`, {}), call(w, 'Frankie', 'POST', `/api/sessions/${g.id}/join`, {})]);
    console.log('C8', a.status, b.status, await credit(w, 'Blair'), JSON.stringify(ledger(w, 'Blair')));
    const s = await mineOn(w, 'Blair', g.id);
    console.log('C8 Blair still owes', JSON.stringify(s.mine?.lateFee));
    // One clear per moment is main's rule: at least the books must agree (credit + kept on game = 2800).
    const r = await rowOf(w, g.id, 'Blair');
    console.log('C8 row', JSON.stringify({ st: r.status, ps: r.paymentStatus, amt: r.paymentAmountCents, lateFee: r.lateFee }));
    // A third sub a minute later clears the rest.
    w.app.advance(60_000);
    await join(w, g.id, ['Gale']);
    console.log('C8 after third', await credit(w, 'Blair'));
    expect(await credit(w, 'Blair')).toBe(2800);
  });
});
