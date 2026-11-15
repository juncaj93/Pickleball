// Zip 47 probes: Extended time, Reopen and redo, counts and History with guests.
import { describe, expect, it } from 'vitest';
import { addGuest, admin, adminGame, credit, drop, finalize, game, HOUR, ids, join, lines, markPaid, money, raw, removeOwn, rowOf, world } from './w';

const ext = (w: any, sid: string, n: string) => (raw(w, 'SELECT ext_cents AS c FROM session_players WHERE session_id = ? AND player_id = ?', sid, w.byName[n])[0] as any).c;

describe('G-X extended time and redo', () => {
  it('X1 guest out + 60 min extra: payers 4 (no guest), Blair one ext share; Reopen, redo with the guest in: Blair two shares', async () => {
    const w = await world();
    expect((await admin(w, 'PUT', '/api/admin/extended-time-switch', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Blair']), extraMinutes: 60 });
    expect(f.status, f.text).toBe(200);
    console.log('X1', JSON.stringify(f.data.extension), ext(w, g.id, 'Blair'), ext(w, g.id, 'Casey'), await credit(w, 'Blair'));
    expect(f.data.extension.payers).toBe(4);
    expect(ext(w, g.id, 'Blair')).toBe(ext(w, g.id, 'Casey'));
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {});
    expect(r.status, r.text).toBe(200);
    const f2 = await finalize(w, g.id, { everyone: true, extraMinutes: 60 });
    expect(f2.status, f2.text).toBe(200);
    console.log('X1 redo', JSON.stringify(f2.data), ext(w, g.id, 'Blair'), ext(w, g.id, 'Casey'), await credit(w, 'Blair'));
    expect(ext(w, g.id, 'Blair')).toBe(2 * ext(w, g.id, 'Casey'));
  });
  it('X2 owed guest spot (removed late, no sub) + 60 min extra: Blair pays two court shares but one extra-time share', async () => {
    const w = await world({ lateFees: true });
    expect((await admin(w, 'PUT', '/api/admin/extended-time-switch', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await removeOwn(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Blair', 'Casey', 'Devon']), extraMinutes: 60 });
    expect(f.status, f.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    console.log('X2', JSON.stringify(f.data), b.owesCents, ext(w, g.id, 'Blair'), ext(w, g.id, 'Casey'));
    const a = await adminGame(w, g.id);
    console.log('X2 counts', a.paidCount, a.payableCount);
  });
});

describe('G-K counts and History', () => {
  it('K1 owed guest spot: "x of y paid" and the Players row', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await removeOwn(w, g.id, 'Blair');
    let a = await adminGame(w, g.id);
    console.log('K1 unpaid', a.paidCount, a.payableCount, a.roster.find((r: any) => r.name === 'Blair').owesCents);
    await markPaid(w, g.id, 'Blair');
    a = await adminGame(w, g.id);
    const b = a.roster.find((r: any) => r.name === 'Blair');
    console.log('K1 paid', a.paidCount, a.payableCount, b.paymentAmountCents, b.owesCents);
    expect(b.paymentAmountCents).toBe(2800);
  });
  it('K2 History: Remove guest with $28 paid says why the $14 came back', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    await removeOwn(w, g.id, 'Blair');
    const l = (await lines(w, g.start)).filter((x: string) => /Blair/.test(x));
    console.log('K2\n' + l.join('\n'));
    expect(l.some((x: string) => /\$14 back.*dropped out/.test(x))).toBe(true);
  });
  it('K3 History for an unpaid late pair drop short by two says $28 owed?', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const r = await drop(w, g.id, 'Blair');
    console.log('K3 drop', JSON.stringify(r.data));
    const l = (await lines(w, g.start)).filter((x: string) => /Blair/.test(x));
    console.log('K3\n' + l.join('\n'));
    expect(l.some((x: string) => /owes their \$14 \(late drop/.test(x))).toBe(true);
  });
  it('K4 Money page: guest out at Finalize; host paid $28; totals = what the group kept', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Blair']) });
    const m = await money(w);
    const s = m.sessions.find((x: any) => x.id === g.id);
    console.log('K4', JSON.stringify(f.data), JSON.stringify(s), m.creditsOwedCents ?? m.creditOwedCents);
    expect(s.collectedCents).toBe(4 * f.data.priceCents);
  });
});
