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

// The second shape the fuzz found once the first was fixed (seeds 11036 and 15002, both on the old code too): Unmark on a payment with no new
// cash on top (credit plus cash held from an earlier Finalize) gave the credit back and left the seat unpaid, even when the cash still held on it
// covered the final price: "unpaid" with nothing owed, and that cash could never come back. Now the seat is paid with what stays on it, and
// anything above the final price comes back as credit, the same as an Unmark with new cash on top always did.
describe('Zip 52: Unmark never leaves a seat unpaid when the cash still on it covers the price', () => {
  const TEN = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
  const seatLedger = (w: W, sid: string, name: string) =>
    ((w.app.db as any).raw
      .prepare('SELECT kind, reason, amount_cents AS c FROM credit_ledger WHERE ended_at IS NULL AND session_id = ? AND player_id = ? ORDER BY created_at, rowid')
      .all(sid, w.byName[name]) as { kind: string; reason: string; c: number }[]).map((x) => `${x.kind}/${x.reason}/${x.c}`);
  const reopen = async (w: W, sid: string) => expect((await admin(w, 'POST', `/api/admin/sessions/${sid}/reopen`, {})).status).toBe(200);
  const fin = async (w: W, sid: string, names: string[]) => {
    later(w, 1);
    const r = await finalize(w, sid, names);
    expect(r.status, r.text).toBe(200);
  };

  it("seed 15002's shape: $6 cash marked after a 9-played Finalize, Reopen, 6 played, Reopen, 9 played, Unmark: Harper stays Paid $6", async () => {
    const w = await world({ lateFees: false });
    const g = await game(w);
    await join(w, g.id, TEN);
    w.app.now = g.end + HOUR;
    const nine = TEN.filter((n) => n !== 'Kit');
    await fin(w, g.id, nine);
    later(w, 1);
    await markPaid(w, g.id, 'Harper');
    expect(await rowOf(w, g.id, 'Harper')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 600 });
    later(w, 1);
    await reopen(w, g.id);
    await fin(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Harper']);
    // $9 now: her $6 is held on the seat and she owes $3.
    expect(await rowOf(w, g.id, 'Harper')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 300 });
    later(w, 1);
    await reopen(w, g.id);
    await fin(w, g.id, nine);
    expect(await rowOf(w, g.id, 'Harper')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 600 });
    later(w, 1);
    const u = await unmark(w, g.id, 'Harper');
    expect(u.status, u.text).toBe(200);
    // Before Zip 52: unpaid, "owes" $0, $6 held on the seat for good. Now the $6 still on the seat pays it (it is the cash she paid earlier,
    // which an Unmark never takes off: only the latest cash).
    expect(await rowOf(w, g.id, 'Harper')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 600 });
    expect(seatLedger(w, g.id, 'Harper')).toEqual(['kept/cash/600', 'used/cash/600']);
    expect(await credit(w, 'Harper')).toBe(0);
    expect(health(w)).toEqual({});
  });

  it("seed 11036's shape: $3 credit + $8 cash after a 5-played Finalize, Reopen holds the $8, 8 played at $7, Unmark: $3 credit back, the $8 pays the seat, $1 back", async () => {
    const w = await world({ lateFees: false });
    const g = await game(w);
    const raw = (w.app.db as any).raw;
    // $3 of real credit, as from a canceled game (filed on this game's id; it shows first in this seat's rows below).
    raw.exec(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
      SELECT 'z52-pot', group_id, '${w.byName.Indy}', 'kept', 300, '${g.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM sessions WHERE id = '${g.id}'`);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Indy', 'Frankie', 'Gale', 'Harper']);
    expect(await credit(w, 'Indy')).toBe(0);
    w.app.now = g.end + HOUR;
    await fin(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Indy']);
    later(w, 1);
    await markPaid(w, g.id, 'Indy');
    expect(await rowOf(w, g.id, 'Indy')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100 });
    later(w, 1);
    await reopen(w, g.id);
    // Back at the flat $14: the $8 cash is held on the seat with the $3 credit, she owes $3.
    expect(await rowOf(w, g.id, 'Indy')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 300 });
    await fin(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Indy', 'Frankie', 'Gale', 'Harper']);
    expect(await rowOf(w, g.id, 'Indy')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100 });
    expect(await credit(w, 'Indy')).toBe(400);
    later(w, 1);
    const u = await unmark(w, g.id, 'Indy');
    expect(u.status, u.text).toBe(200);
    // Before Zip 52: the $4 and the $3 went back to how they were before, and the seat sat unpaid with $8 held against a $7 price.
    expect(await rowOf(w, g.id, 'Indy')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 800 });
    expect(await credit(w, 'Indy')).toBe(400);
    expect(seatLedger(w, g.id, 'Indy')).toEqual(['kept/canceled/300', 'kept/cash/800', 'used/cash/800', 'kept/finalized/100']);
    expect(health(w)).toEqual({});
  });
});

