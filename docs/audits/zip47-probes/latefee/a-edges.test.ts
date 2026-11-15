// Zip 47 audit (late fees): the "no fee while the game still has 4, organizer counted" rule at its edges, words vs money.
import { describe, expect, it } from 'vitest';
import { lateDropDialogText, lateDropToast } from '../../../shared/lateFees';
import { formatPrice } from '../../../shared/money';
import { admin, at, drop, finalize, game, health, HOUR, join, markPaid, mineOn, orgIn, owedOf, pot, PRICE, rowOf, roster, sessOf, view, world } from './w';

describe('A. edge moments', () => {
  it('A1 exactly at start minus 12h: the dialog says owes and the server keeps the fee; 1 ms before: neither', async () => {
    for (const offset of [0, -1]) {
      const w = await world();
      const g = await game(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
      w.app.now = g.start - 12 * HOUR + offset;
      const m = await mineOn(w, 'Blair', g.id);
      const r = await drop(w, 'Blair' === 'Blair' ? g.id : g.id, 'Blair');
      if (offset === 0) {
        expect(m.mine!.lateDrop).toMatchObject({ owes: true, feeCents: PRICE });
        expect(r.lateFee).toEqual({ cents: PRICE, paid: false });
      } else {
        expect(m.mine!.lateDrop).toBeUndefined();
        expect(r.lateFee).toBeUndefined();
        expect(await owedOf(w, 'Blair', g.id)).toBeNull();
      }
    }
  });

  it('A2 the organizer is the 4th: a player drop leaves 3, owes; dialog agrees', async () => {
    const w = await world();
    const g = await game(w);
    await orgIn(w, g.id);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 5);
    expect((await mineOn(w, 'Blair', g.id)).mine!.lateDrop).toMatchObject({ owes: true });
    const r = await drop(w, g.id, 'Blair');
    expect(r.lateFee).toEqual({ cents: PRICE, paid: false });
    expect(health(w)).toEqual({});
  });

  it('A3 the organizer plus 4 players (5 in): a player drop leaves 4 (organizer counted), nobody owes; dialog agrees', async () => {
    const w = await world();
    const g = await game(w);
    await orgIn(w, g.id);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    const m = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(m.lateDrop).toMatchObject({ owes: false });
    expect(lateDropDialogText('8:00 AM', m.lateDrop!.owes, formatPrice(m.lateDrop!.feeCents), m.dropCashCents > 0 ? `your ${formatPrice(m.dropCashCents)} comes back as credit` : null)).toContain('Enough players are still in');
    const r = await drop(w, g.id, 'Blair');
    expect(r.lateFee).toBeUndefined();
    expect(await pot(w, 'Blair')).toBe(PRICE);
  });

  it('A4 the organizer not playing, 4 players: a drop leaves 3, owes', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: false });
  });

  it('A5 4 in + 1 waitlisted (max 4): a late drop owes nothing, the waiter moves in, the dialog agrees', async () => {
    const w = await world({ maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 5);
    expect((await mineOn(w, 'Blair', g.id)).mine!.lateDrop).toMatchObject({ owes: false });
    const r = await drop(w, g.id, 'Blair');
    expect(r.lateFee).toBeUndefined();
    expect((await sessOf(w, g.id)).confirmedCount).toBe(4);
    expect((await rowOf(w, g.id, 'Frankie')).status).toBe('confirmed');
  });

  it('A6 the organizer is the 4th and drops late himself: owes (display), never a player debt; dialog warns', async () => {
    const w = await world();
    const g = await game(w);
    await orgIn(w, g.id);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 5);
    const r = await orgIn(w, g.id, false);
    expect(r.lateFee).toEqual({ cents: PRICE });
    // A sub (Emery) clears the organizer's own debt.
    await join(w, g.id, ['Emery']);
    expect((await rowOf(w, g.id, 'Alex')).lateFee ?? null).toBeNull();
  });

  it('A7 Remove by the organizer inside 12 hours: never a fee, money back as credit', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 2);
    expect((await roster(w, g.id, 'Blair', 'withdraw')).status).toBe(200);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect(health(w)).toEqual({});
  });

  it('A8 Finalize: organizer + 3 signed, organizer + 2 played (3): the no-show owes; organizer + 4 signed, 4 played (organizer counted): nobody owes', async () => {
    {
      const w = await world();
      const g = await game(w);
      await orgIn(w, g.id);
      await join(w, g.id, ['Blair', 'Casey', 'Devon']);
      for (const n of ['Blair', 'Casey', 'Devon']) await markPaid(w, g.id, n);
      w.app.now = g.end + HOUR;
      expect((await finalize(w, g.id, ['Alex', 'Blair', 'Casey'])).status).toBe(200);
      expect((await rowOf(w, g.id, 'Devon')).lateFee).toMatchObject({ kind: 'no_show' });
    }
    {
      const w = await world();
      const g = await game(w);
      await orgIn(w, g.id);
      await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
      w.app.now = g.end + HOUR;
      expect((await finalize(w, g.id, ['Alex', 'Blair', 'Casey', 'Devon'])).status).toBe(200);
      expect((await rowOf(w, g.id, 'Emery')).lateFee).toBeNull();
      expect(await pot(w, 'Emery')).toBe(PRICE);
    }
  });

  it('A9 an organizer late-drop debt is not a no-show at Finalize, and Finalize with 3 played leaves the late dropper owing exactly $14', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 3);
    await drop(w, g.id, 'Blair');
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon', 'Emery'])).status).toBe(200);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'late_drop', paid: true });
    expect(await pot(w, 'Blair')).toBe(0);
    expect(health(w)).toEqual({});
  });

  it('A10 a sub after two late drops clears the OLDEST first; Clear on the second; Reopen of a fee-kept cancel makes it a normal game', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 60_000;
    await drop(w, g.id, 'Casey');
    await join(w, g.id, ['Frankie']);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    expect((await rowOf(w, g.id, 'Casey')).lateFee).toMatchObject({ kind: 'late_drop' });
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Casey, why: 'choice' })).data.changed).toBe(true);
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
    // Cancel, fee kept: Devon, Emery, Frankie owe $14 each. Reopen: a normal game, they owe $14 as players again, no debts.
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(c.status, c.text).toBe(200);
    expect((await rowOf(w, g.id, 'Devon')).lateFee).toMatchObject({ kind: 'canceled_late' });
    const ro = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' });
    expect(ro.status, ro.text).toBe(200);
    expect((await rowOf(w, g.id, 'Devon')).lateFee).toBeNull();
    expect(health(w)).toEqual({});
  });

  it('A11 WORDS: an unpaid seat with part credit on it ($3) drops late: the toast says "Your $14 stays on this game", but $11 is still owed', async () => {
    const w = await world();
    // Earn $3 credit: 5 paid $14, all played -> $11 each, $3 back.
    const g0 = await game(w, 0);
    await join(w, g0.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await markPaid(w, g0.id, n);
    w.app.now = g0.end + HOUR;
    expect((await finalize(w, g0.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'])).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(300);
    const g = await game(w, 0);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    const m = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(m.oweCents).toBe(1100);
    // The dialog / held toast the screen shows (src/pages/PlayerHome.tsx dropOut): paid true, $14.
    expect(m.lateDrop).toMatchObject({ owes: true, paid: true, feeCents: PRICE });
    expect(lateDropToast(formatPrice(m.lateDrop!.feeCents), m.lateDrop!.paid)).toBe("You're out. Your $14 stays on this game unless someone takes your spot.");
    const r = await drop(w, g.id, 'Blair');
    // The server's answer says the same ...
    expect(r.lateFee).toEqual({ cents: PRICE, paid: true });
    // ... but the money: $11 is still owed (only $3 is on the game).
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1100, lateFee: 'late_drop' });
  });

  it('A12 the late-cancel sheet line and the server agree: 5 heads (4 seats + organizer) split to $11', async () => {
    const w = await world({ split: true });
    const g = await game(w);
    await orgIn(w, g.id);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 3);
    expect((await sessOf(w, g.id)).confirmedCount).toBe(5);
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(c.status, c.text).toBe(200);
    expect((await sessOf(w, g.id)).feeSplit).toEqual({ count: 5, priceCents: 1100 });
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1100 });
    expect((await rowOf(w, g.id, 'Alex')).lateFee ?? null).toBeNull();
    // Only 4 heads (the organizer is not in): flat $14, no split.
    const w2 = await world({ split: true });
    const g2 = await game(w2);
    await join(w2, g2.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w2, g2.start, 3);
    expect((await admin(w2, 'POST', `/api/admin/sessions/${g2.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    expect(await owedOf(w2, 'Blair', g2.id)).toMatchObject({ amountCents: PRICE });
    expect((await view(w2, 'Blair')).sessions.find((s) => s.id === g2.id)!.mine!.lateFee).toMatchObject({ kind: 'canceled_late', oweCents: PRICE });
  });
});
