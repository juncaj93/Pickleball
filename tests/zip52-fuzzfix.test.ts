// Zip 52 (🎾52.fuzz): the audit fuzz's "$5 short" (tests/audit-r4.test.ts, random sequences). Unmark (and the player's own "Didn't pay?")
// takes back the credit that came back from a payment, two kinds: the money back from Finalize (paid above the final price) and a trim (a
// guest's share given back from a seat that is still paid). Each kind used to check the player's credit on its own, so one could be taken back
// while the other (and so the whole Unmark) was refused: the seat stayed paid and the credit taken was simply gone. Now both go together with
// the "unpaid" step, or nothing moves (server/credit.ts undoSeatBackStatements). Exact numbers, Eastern time, fake clock.
import { describe, expect, it } from 'vitest';
import { admin, call, credit, dash, finalize, game, health, HOUR, join, markPaid, rowOf, type W, world } from './zip49-world';

const MIN = 60_000;
const later = (w: W, minutes = 5) => (w.app.now += minutes * MIN);
const unmark = (w: W, sid: string, name: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: false });
/** Every credit entry, as the database holds it (live or ended), for "nothing moved". */
const ledger = (w: W) => JSON.stringify((w.app.db as any).raw.prepare('SELECT id, kind, amount_cents, reason, ended_at FROM credit_ledger ORDER BY id').all());
const liveBack = (w: W, sid: string, name: string, reason: string) =>
  ((w.app.db as any).raw
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'kept' AND ended_at IS NULL AND session_id = ? AND player_id = ? AND reason = ?")
    .get(sid, w.byName[name], reason) as { c: number }).c;

describe('Zip 52: Unmark takes back both kinds of money back together, or nothing', () => {
  // Blair pays $28 for herself and her guest Sam, then Remove guest gives Sam's $14 back (the trim). Six play at $9: $5 more back. Blair spends
  // $14 of her $19 on the next game. Alex taps Unmark on the first game: the $5 and the $14 must both come back, and only $5 is there.
  async function guestTrimThenFinalize() {
    const w = await world({ guests: true });
    const g = await game(w);
    const g2 = await game(w, 1);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
    later(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest`, { playerId: w.byName.Blair, name: 'Sam' })).status).toBe(200);
    later(w);
    await markPaid(w, g.id, 'Blair');
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 2800 });
    later(w);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'])).status).toBe(200);
    expect(liveBack(w, g.id, 'Blair', 'finalized')).toBe(500);
    expect(liveBack(w, g.id, 'Blair', 'dropped')).toBe(1400);
    expect(await credit(w, 'Blair')).toBe(1900);
    later(w);
    await join(w, g2.id, ['Blair']);
    expect(await credit(w, 'Blair')).toBe(500);
    return { w, g };
  }

  it('real clock, Guest spot on (as live): the credit covers only the $5, so Unmark is refused and Blair keeps her $5', async () => {
    const { w, g } = await guestTrimThenFinalize();
    const before = ledger(w);
    later(w);
    const u = await unmark(w, g.id, 'Blair');
    // Before Zip 52: the $5 was taken back, the $14 was not, the Unmark said "already used": Blair's credit read $0 and her seat still kept $14.
    expect(u.status).toBe(409);
    expect(u.data.error).toBe('credit_spent');
    expect(await credit(w, 'Blair')).toBe(500);
    expect(liveBack(w, g.id, 'Blair', 'finalized')).toBe(500);
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid' });
    expect(ledger(w)).toBe(before);
    expect(health(w)).toEqual({});
  });

  it('the same once the credit is back in the pot: one Unmark takes back both ($5 and $14) and the seat owes again', async () => {
    const { w, g } = await guestTrimThenFinalize();
    const g2 = await game(w, 0);
    // Blair drops the next game (more than 12 hours out): her $14 credit comes back, $19 in all.
    later(w);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g2.id}/withdraw`, {})).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1900);
    later(w);
    const u = await unmark(w, g.id, 'Blair');
    expect(u.status, u.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(0);
    expect(liveBack(w, g.id, 'Blair', 'finalized')).toBe(0);
    expect(liveBack(w, g.id, 'Blair', 'dropped')).toBe(0);
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'unpaid' });
    expect(health(w)).toEqual({});
  });

  // The fuzz's own shape (seed 4020 and the others): Emery's $14 is marked paid, she drops ($14 credit), comes back in the same instant (the
  // test clock does not move between taps, so the $14 from the drop reads as a trim of the new payment), 6 play at $9, $5 back, Alex Unmarks.
  async function fuzzShape(rejoin: 'self' | 'organizer', played: number) {
    const w = await world({ lateFees: false });
    const g = await game(w);
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'].slice(0, played);
    await join(w, g.id, names);
    await markPaid(w, g.id, 'Emery');
    expect((await call(w, 'Emery', 'POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    expect(await credit(w, 'Emery')).toBe(1400);
    if (rejoin === 'self') await join(w, g.id, ['Emery']);
    else expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Emery, action: 'confirm' })).status).toBe(200);
    expect(await credit(w, 'Emery')).toBe(0);
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, names)).status).toBe(200);
    return { w, g };
  }

  for (const rejoin of ['self', 'organizer'] as const)
    for (const [played, price] of [
      [5, 1100],
      [6, 900],
      [8, 700],
      [10, 500],
    ] as const)
      it(`the fuzz shape (back in by ${rejoin === 'self' ? "her own I'm in" : "Alex's Add"}, ${played} played at $${price / 100}): Unmark never loses her $${(1400 - price) / 100}`, async () => {
        const { w, g } = await fuzzShape(rejoin, played);
        const back = 1400 - price;
        expect(await credit(w, 'Emery')).toBe(back);
        const before = ledger(w);
        const u = await unmark(w, g.id, 'Emery');
        // Before Zip 52: 409 and her credit went to $0 while the seat kept all $14 (the "$5 short" at 6 played).
        expect(u.status).toBe(409);
        expect(await credit(w, 'Emery')).toBe(back);
        expect(liveBack(w, g.id, 'Emery', 'finalized')).toBe(back);
        expect(await rowOf(w, g.id, 'Emery')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
        expect(ledger(w)).toBe(before);
        // Reopen and Finalize again still work and give the same $back once.
        expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
        expect(await credit(w, 'Emery')).toBe(0);
        expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
        expect(await credit(w, 'Emery')).toBe(back);
        expect(health(w)).toEqual({});
      });

  it('a plain Unmark after Finalize (no trim) is unchanged: the $5 comes back off her credit and the seat owes $9', async () => {
    const w = await world({ lateFees: false });
    const g = await game(w);
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'];
    await join(w, g.id, names);
    later(w);
    await markPaid(w, g.id, 'Emery');
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, names)).status).toBe(200);
    expect(await credit(w, 'Emery')).toBe(500);
    later(w);
    const u = await unmark(w, g.id, 'Emery');
    expect(u.status, u.text).toBe(200);
    expect(await credit(w, 'Emery')).toBe(0);
    expect(await rowOf(w, g.id, 'Emery')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 900 });
    expect((await dash(w)).sessions.find((s: any) => s.id === g.id).finalPriceCents ?? 900).toBe(900);
    expect(health(w)).toEqual({});
  });
});
