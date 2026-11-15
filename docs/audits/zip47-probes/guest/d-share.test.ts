// Zip 47 probes: per-person paid shares, then money back.
import { describe, expect, it } from 'vitest';
import { addGuest, admin, adminRemoveGuest, credit, drop, finalize, game, HOUR, ids, join, ledger, markPaid, rowOf, world } from './w';

const share = (w: any, sid: string, host: string, who: 'host' | 'guest', paid: boolean) => admin(w, 'POST', `/api/admin/sessions/${sid}/guest/share`, { playerId: w.byName[host], who, paid });

describe('G-D shares', () => {
  for (const together of [false, true]) {
    it(`D1 guest share then host share (${together ? 'at once' : 'one after the other'}), then drop out early: exactly $28 back`, async () => {
      const w = await world();
      const g = await game(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon']);
      await addGuest(w, g.id, 'Blair');
      if (together) await Promise.all([share(w, g.id, 'Blair', 'guest', true), share(w, g.id, 'Blair', 'host', true)]);
      else {
        await share(w, g.id, 'Blair', 'guest', true);
        await share(w, g.id, 'Blair', 'host', true);
      }
      console.log('D1', together, JSON.stringify(ledger(w, 'Blair')));
      const r = await drop(w, g.id, 'Blair');
      expect(r.status, r.text).toBe(200);
      console.log('D1 after drop', together, await credit(w, 'Blair'), JSON.stringify(ledger(w, 'Blair')));
      expect(await credit(w, 'Blair')).toBe(2800);
    });
  }
  it('D2 guest share paid ($14 held), organizer removes the guest, then Finalize 4 played: host pays $14 and nothing else', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await share(w, g.id, 'Blair', 'guest', true);
    await adminRemoveGuest(w, g.id, 'Blair');
    const b = await rowOf(w, g.id, 'Blair');
    console.log('D2', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents }), JSON.stringify(ledger(w, 'Blair')));
    for (const n of ['Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { everyone: true });
    expect(f.status, f.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(0);
  });
  it('D3 guest marked out at Finalize after only the guest share was paid first: the host still owes their own share', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await share(w, g.id, 'Blair', 'guest', true);
    for (const n of ['Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await finalize(w, g.id, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Blair']) });
    expect(f.status, f.text).toBe(200);
    const b = await rowOf(w, g.id, 'Blair');
    const a = (await (await import('./w')).adminGame(w, g.id));
    console.log('D3', JSON.stringify({ ps: b.paymentStatus, amt: b.paymentAmountCents, owes: b.owesCents, share: b.shareCents, guest: b.guest }), a.paidCount, a.payableCount, await credit(w, 'Blair'));
    // The guest's $14 was really paid (by the host): with the guest out, the host's one $14 share is covered.
    expect(b.owesCents).toBe(0);
  });
});
