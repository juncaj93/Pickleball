// Zip 47 audit (late fees with guests, and Guest spot switched OFF with guests still on games): words, Telegram and money agree; nothing stranded.
import { describe, expect, it } from 'vitest';
import { hostDropText } from '../../../shared/guestSpot';
import { formatPrice } from '../../../shared/money';
import { addGuest, admin, at, call, dash, drop, finalize, game, health, HOUR, join, markPaid, mineOn, owedOf, pot, PRICE, rowOf, sessOf, type W, world } from './w';

function telegram(w: W) {
  const sent: string[] = [];
  Object.assign(w.app.env, {
    SITE_URL: 'https://club.example',
    TELEGRAM_BOT_TOKEN: '123:probe-token-not-real',
    TELEGRAM_CHAT_ID: '-100',
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  return {
    async take() {
      await w.app.settle();
      return sent.splice(0);
    },
  };
}
const switchGuests = async (w: W, on: boolean) => expect((await admin(w, 'PUT', '/api/admin/guest-spot-switch', { on })).status).toBe(200);
const textsR2 = async (w: W) => expect((await admin(w, 'PUT', '/api/admin/texts-r2', { on: true })).status).toBe(200);

describe('B. a late pair: dialog, Telegram and money agree (Guest spot on, then the same with it OFF)', () => {
  for (const guestSwitch of ['on', 'off'] as const) {
    for (const [others, spots] of [
      [['Casey', 'Devon'], 2],
      [['Casey', 'Devon', 'Emery'], 1],
      [['Casey', 'Devon', 'Emery', 'Frankie'], 0],
    ] as const) {
      it(`guest switch ${guestSwitch}: host + guest + ${others.length} others, both drop late -> short ${spots}`, async () => {
        const w = await world({ guests: true });
        const t = telegram(w);
        await textsR2(w);
        const g = await game(w);
        await join(w, g.id, ['Blair', ...others]);
        expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
        if (guestSwitch === 'off') await switchGuests(w, false);
        at(w, g.start, 5);
        await t.take();
        const m = (await mineOn(w, 'Blair', g.id)).mine!;
        expect(m.guest).toMatchObject({ name: 'Sam', status: 'confirmed' });
        expect(m.lateDrop).toMatchObject({ owes: spots > 0, guestSpots: spots, feeCents: PRICE * Math.max(1, spots) });
        const words = hostDropText('Sam', { cancelBy: '8:00 AM', spots: m.lateDrop!.owes ? m.lateDrop!.guestSpots! : 0, owesCents: m.lateDrop!.feeCents }, formatPrice);
        const r = await drop(w, g.id, 'Blair');
        const sent = await t.take();
        if (spots === 0) {
          expect(words).toContain("You don't owe anything");
          expect(r.lateFee).toBeUndefined();
          expect(await owedOf(w, 'Blair', g.id)).toBeNull();
          expect(sent.join(' ')).not.toMatch(/owes/);
        } else {
          expect(words).toContain(`you still owe ${formatPrice(PRICE * spots)}`);
          expect(r.lateFee).toEqual({ cents: PRICE * spots, paid: false });
          expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE * spots, lateFee: 'late_drop' });
          expect(sent.join(' ')).toContain(`Blair (and guest Sam) owes ${formatPrice(PRICE * spots)}.`);
        }
        expect(sent.join(' ')).toContain('Blair (and guest Sam) dropped out');
        expect(health(w)).toEqual({});
      });
    }
  }
});

describe('B. Guest spot OFF with a guest already on a game: nothing stranded', () => {
  it('B1 host cannot remove (switch off), the organizer can: paid $28 gives $14 back; the seat then owes/holds one share', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    await markPaid(w, g.id, 'Blair');
    await switchGuests(w, false);
    expect((await dash(w)).guestSpot).toBeUndefined();
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(403);
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/remove`, { playerId: w.byName.Blair });
    expect(r.status, r.text).toBe(200);
    expect(r.data.creditBackCents).toBe(PRICE);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect((await sessOf(w, g.id)).confirmedCount).toBe(3);
    expect(health(w)).toEqual({});
  });

  it('B2 Finalize with the switch off still counts the guest: 4 seats + guest = 5 played, host pays 2 x $11', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    await switchGuests(w, false);
    w.app.now = g.end + HOUR;
    const f = await finalize(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect(f.status, f.text).toBe(200);
    expect(f.data).toMatchObject({ played: 5, priceCents: 1100 });
    // Blair paid $28, owes 2 x $11 = $22: $6 back. The others $3 each.
    expect(await pot(w, 'Blair')).toBe(600);
    expect(await pot(w, 'Casey')).toBe(300);
    expect(health(w)).toEqual({});
  });

  it('B3 a cancel with the switch off gives the whole $28 back to the host', async () => {
    const w = await world({ guests: true, lateFees: false });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    await markPaid(w, g.id, 'Blair');
    await switchGuests(w, false);
    const c = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect(c.status, c.text).toBe(200);
    expect(await pot(w, 'Blair')).toBe(2 * PRICE);
    expect(health(w)).toEqual({});
  });

  it('B4 a waiting guest still moves in when a spot opens with the switch off, and the host then owes two shares', async () => {
    const w = await world({ guests: true, maxPlayers: 4, lateFees: false });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await addGuest(w, g.id, 'Blair')).data.guest.status).toBe('waitlisted');
    await switchGuests(w, false);
    await drop(w, g.id, 'Emery');
    expect((await rowOf(w, g.id, 'Blair')).guest).toMatchObject({ status: 'confirmed' });
    expect((await mineOn(w, 'Blair', g.id)).mine!.oweCents).toBe(2 * PRICE);
  });

  it('B5 an owed guest spot (late Remove guest) left when the switch goes off: Finalize charges it, the organizer can still clear it', async () => {
    for (const path of ['finalize', 'clear'] as const) {
      const w = await world({ guests: true });
      const g = await game(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon']);
      expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
      at(w, g.start, 4);
      const rm = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {});
      expect(rm.status, rm.text).toBe(200);
      expect(rm.data.lateOwesCents).toBe(PRICE);
      await switchGuests(w, false);
      if (path === 'finalize') {
        w.app.now = g.end + HOUR;
        expect((await finalize(w, g.id, ['Blair', 'Casey', 'Devon'])).status).toBe(200);
        expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 2 * PRICE });
      } else {
        const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/remove`, { playerId: w.byName.Blair });
        expect(r.status, r.text).toBe(200);
        expect((await mineOn(w, 'Blair', g.id)).mine!.oweCents).toBe(PRICE);
      }
      expect(health(w)).toEqual({});
    }
  });

  it('B6 the GUEST_SPOT kill switch (env "off") beats the Settings row: no Add, no host Remove; the organizer still removes', async () => {
    const w = await world({ guests: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    (w.app.env as any).GUEST_SPOT = 'off';
    expect((await dash(w)).guestSpot).toBeUndefined();
    expect((await addGuest(w, g.id, 'Casey', 'Ann')).status).toBe(403);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(403);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/remove`, { playerId: w.byName.Blair })).status).toBe(200);
  });
});
