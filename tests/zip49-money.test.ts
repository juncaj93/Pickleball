// Zip 49 (🎾49.moneyfix): the money fixes from Audit C (docs/audits/AUDIT_C_2026-11.md), each with its exact numbers.
// Rule for every late drop (Alex): it owes only the spots the game is short of 4 (organizer counted), and the amount charged, the amount shown
// and the amount kept always agree. Fake world, fake clock, Eastern time; Late fees and Guest spot ON (as on live).
import { describe, expect, it } from 'vitest';
import { cleanGuestName, GUEST_NAME_MAX, whoPlayedNotes } from '../shared/guestSpot';
import { feeClearedNotice, lateDropToast } from '../shared/lateFees';
import { formatPrice } from '../shared/money';
import { formatShortDate } from '../shared/time';
import { gamePriceCents, groupRemindText } from '../src/pages/admin/moneyRework';
import { reminderText } from '../src/pages/admin/textMenu';
import { dueAlerts } from '../shared/venueAlert';
import {
  addGuest,
  admin,
  at,
  call,
  credit,
  dash,
  drop,
  finalize,
  game,
  health,
  HOUR,
  join,
  lines,
  markPaid,
  mineOn,
  owedOf,
  PRICE,
  rowOf,
  roster,
  selfPaid,
  sessOf,
  view,
  type W,
  world,
} from './zip49-world';

const DAY = 24 * HOUR;
const guests = () => world({ guests: true });
const linesOf = async (w: W, start: number, re: RegExp) => (await lines(w, start)).filter((l) => re.test(l));
async function notices(w: W, name: string) {
  const v = await view(w, name);
  return (v.feeNotices ?? []).map((n) =>
    feeClearedNotice(n.why, formatShortDate(n.startsAt, v.group.timezone), formatPrice(n.feeCents ?? v.group.priceCents), n.creditCents > 0 ? formatPrice(n.creditCents) : null, n.guest ?? null),
  );
}
const clear = (w: W, sid: string, name: string, why = 'choice') => admin(w, 'POST', `/api/admin/sessions/${sid}/late-fee`, { playerId: w.byName[name], why });
const keptOn = async (w: W, sid: string, name: string) => {
  const r = await rowOf(w, sid, name);
  return r.paymentStatus === 'paid' ? r.paymentAmountCents : 0;
};

describe('Item 1 (M-1): a late host and guest never keep more than the spots the game is short', () => {
  it('(a) I paid $28 before Alex confirmed, game one short: shown $14, charged $14 at the confirm, kept $14 at Finalize', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    // Shown: the dialog says one spot, $14.
    const card = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(card.lateDrop).toMatchObject({ owes: true, paid: true, feeCents: PRICE, guestSpots: 1 });
    const d = await drop(w, g.id, 'Blair');
    expect(d.lateFee).toEqual({ cents: PRICE, paid: true });
    expect(lateDropToast(formatPrice(d.lateFee.cents), d.lateFee.paid)).toBe("You're out. Your $14 stays on this game unless someone takes your spot.");
    // Charged: Alex confirms the I paid; the guest's $14 comes back at once.
    await markPaid(w, g.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'late_drop', paid: true, oweCents: 0 });
    expect(await linesOf(w, g.start, /Blair got \$14 back as credit/)).toHaveLength(1);
    // Kept: Finalize keeps $14 and gives nothing more back.
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon', 'Emery'])).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('(b) I paid $28, game two short, a sub takes the guest\'s spot, then Alex confirms: $14 back, $14 kept', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    const d = await drop(w, g.id, 'Blair');
    // Shown before the sub: the whole $28 stays (the game is two short).
    expect(d.lateFee).toEqual({ cents: 2 * PRICE, paid: true });
    w.app.advance(60_000);
    await join(w, g.id, ['Emery']);
    expect(await linesOf(w, g.start, /Emery took Blair's guest's spot: Sam's \$14 cleared/)).toHaveLength(1);
    expect(await notices(w, 'Blair')).toEqual([expect.stringMatching(/^Good news: someone took Sam's spot for .*\. You no longer owe \$14 for Sam\.$/)]);
    await markPaid(w, g.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon', 'Emery'])).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('(c) paid $28, the pair drops late (two short), the host rejoins alone: $14 back at once; drops late again: $14 kept', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: 2 * PRICE, paid: true });
    expect(await credit(w, 'Blair')).toBe(0);
    w.app.advance(60_000);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
    // Back in alone: one seat, $14. The guest's $14 comes back now (it used to wait for Finalize).
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    expect((await mineOn(w, 'Blair', g.id)).mine).toMatchObject({ paymentStatus: 'paid', shareCents: PRICE, oweCents: 0 });
    w.app.advance(60_000);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: true });
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon'])).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('(c2) same with an unconfirmed I paid: Alex confirms while the host is back in: $14 back; the late drop then keeps $14', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    await drop(w, g.id, 'Blair');
    w.app.advance(60_000);
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/join`, {});
    // A claim never moves by itself.
    expect(await credit(w, 'Blair')).toBe(0);
    await markPaid(w, g.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
    w.app.advance(60_000);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: true });
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon'])).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('unchanged: a pair two short keeps the whole $28 (shown "Your $28 stays"), and a $28 pair one short still gives $14 back at the drop', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    const d = await drop(w, g.id, 'Blair');
    expect(lateDropToast(formatPrice(d.lateFee.cents), d.lateFee.paid)).toBe("You're out. Your $28 stays on this game unless someone takes your spot.");
    expect(await keptOn(w, g.id, 'Blair')).toBe(2800);
    expect(await credit(w, 'Blair')).toBe(0);

    const v = await guests();
    const h = await game(v);
    await join(v, h.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(v, h.id, 'Blair');
    await markPaid(v, h.id, 'Blair');
    at(v, h.start, 6);
    expect((await drop(v, h.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: true });
    expect(await credit(v, 'Blair')).toBe(1400);
    expect(await keptOn(v, h.id, 'Blair')).toBe(1400);
  });

  it('a single player with no guest is untouched: paid $14, late drop one short keeps $14, confirm changes nothing', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: true });
    await markPaid(w, g.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(0);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
  });
});

describe('Item 2 (F-2): Text all asks each person for one share', () => {
  it('one unpaid player and an unpaid host with a guest: the group text says $14; the host\'s own reminder says $28', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Devon');
    await markPaid(w, g.id, 'Emery');
    const d = await dash(w);
    const s = await sessOf(w, g.id);
    expect(gamePriceCents(d, s)).toBe(1400);
    expect(groupRemindText(d, s)).toContain("If you haven't paid your $14 yet");
    expect(groupRemindText(d, s)).not.toContain('$28');
    expect(reminderText(d, w.byName.Blair, 'Blair', s)).toContain('you owe $28');
    expect(reminderText(d, w.byName.Casey, 'Casey', s)).toContain('you owe $14');
  });

  it('only the host owes: still $14 each, never $28', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Devon');
    expect(gamePriceCents(await dash(w), await sessOf(w, g.id))).toBe(1400);
  });
});

describe('Item 3 (F-3): words say the real amount', () => {
  it('a $28 pair debt: History "owes their $28", Clear "cleared Blair\'s $28", notice "You no longer owe $28"', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    at(w, g.start, 5);
    expect(await drop(w, g.id, 'Blair')).toMatchObject({ lateFee: { cents: 2 * PRICE, paid: false } });
    expect(await linesOf(w, g.start, /Blair owes their \$28 \(late drop, game short\)/)).toHaveLength(1);
    expect((await clear(w, g.id, 'Blair')).data.changed).toBe(true);
    expect(await linesOf(w, g.start, /Alex cleared Blair's \$28 \(my choice\)/)).toHaveLength(1);
    expect(await notices(w, 'Blair')).toEqual([expect.stringMatching(/^You no longer owe \$28 for /)]);
  });

  it('an $11 split debt cleared: "You no longer owe $11", History "cleared Blair\'s $11"', async () => {
    const w = await world({ split: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 3);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1100 });
    expect((await clear(w, g.id, 'Blair')).data.changed).toBe(true);
    expect(await notices(w, 'Blair')).toEqual([expect.stringMatching(/^You no longer owe \$11 for /)]);
    expect(await linesOf(w, g.start, /Alex cleared Blair's \$11 \(my choice\)/)).toHaveLength(1);
  });

  it('$3 credit on an unpaid seat: the dialog and the toast say "You owe $11", the same as what is owed', async () => {
    const w = await guests();
    const g0 = await game(w, 0);
    await join(w, g0.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await markPaid(w, g0.id, n);
    w.app.now = g0.end + HOUR;
    expect((await finalize(w, g0.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'])).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(300);
    const g = await game(w, 0);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    const m = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(m.oweCents).toBe(1100);
    expect(m.lateDrop).toMatchObject({ owes: true, paid: false, feeCents: 1100 });
    const d = await drop(w, g.id, 'Blair');
    expect(d.lateFee).toEqual({ cents: 1100, paid: false });
    expect(lateDropToast(formatPrice(d.lateFee.cents), d.lateFee.paid)).toBe("You're out. You owe $11 unless someone takes your spot.");
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1100, lateFee: 'late_drop' });
  });

  it('Remove guest with $28 paid: History says "(guest removed)", not "(dropped out)"', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(200);
    expect(await linesOf(w, g.start, /^Blair got \$14 back as credit for .* \(guest removed\)$/)).toHaveLength(1);
    expect(await linesOf(w, g.start, /dropped out/)).toHaveLength(0);
  });

  it('old History lines without the stored amount still read $14 (nothing rewritten)', async () => {
    const { activityText } = await import('../shared/activity');
    const line = activityText({ action: 'late_fee_cleared', actor: 'organizer', createdAt: '2026-11-03T12:00:00.000Z', details: { player: 'Blair', why: 'choice' } } as never, 'America/Detroit', 'Alex');
    expect(line).toBe("Alex cleared Blair's $14 (my choice)");
  });
});

describe('Item 4 (F-4): I paid $14, then the guest moves in', () => {
  it('before the confirm: "Paid $14 · $14 due", Sam unpaid; after: the seat owes $14 and nobody reads Paid for Sam', async () => {
    const w = await world({ guests: true, maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect((await addGuest(w, g.id, 'Blair')).data.guest.status).toBe('waitlisted');
    await selfPaid(w, g.id, 'Blair');
    await drop(w, g.id, 'Casey');
    const before = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(before).toMatchObject({ paymentStatus: 'paid', claimCents: 1400, oweCents: 1400, shareCents: 2800 });
    let b = await rowOf(w, g.id, 'Blair');
    expect(b.guest).toMatchObject({ status: 'confirmed', hostPaid: true, paid: false, hostOwesCents: 0, guestOwesCents: 1400 });
    expect((await sessOf(w, g.id)).paidCount).toBe(1);
    await markPaid(w, g.id, 'Blair');
    b = await rowOf(w, g.id, 'Blair');
    expect(b).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400, paidEarlierCents: 1400 });
    expect(b.guest).toMatchObject({ hostPaid: true, paid: false, guestOwesCents: 1400 });
    expect((await mineOn(w, 'Blair', g.id)).mine).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400 });
    // Paying the rest settles it: $28 on the seat.
    await markPaid(w, g.id, 'Blair');
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 2800, owesCents: 0 });
    expect(health(w)).toEqual({});
  });
});

describe('Item 5 (F-6): a guest is never left waiting while there is room', () => {
  it('To waitlist then Give spot on a host with a guest: both are back in', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    expect((await roster(w, g.id, 'Blair', 'waitlist')).status).toBe(200);
    expect((await roster(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    const s = await sessOf(w, g.id);
    expect(s.confirmedCount).toBe(5);
    expect((await rowOf(w, g.id, 'Blair')).guest).toMatchObject({ name: 'Sam', status: 'confirmed' });
    expect((await rowOf(w, g.id, 'Blair')).owesCents).toBe(2800);
  });

  it('a full game: Give spot leaves the guest waiting (no room), and nobody goes over the max', async () => {
    const w = await world({ guests: true, maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await roster(w, g.id, 'Blair', 'waitlist');
    await join(w, g.id, ['Frankie']);
    expect((await roster(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    expect((await sessOf(w, g.id)).confirmedCount).toBe(5);
    expect((await rowOf(w, g.id, 'Blair')).guest).toMatchObject({ status: 'waitlisted' });
  });
});

describe('Item 6 (F-21): odd guest names', () => {
  it('the name rule, case by case', () => {
    expect(cleanGuestName('Sam😀')).toBeNull();
    expect(cleanGuestName('<b>Sam</b>')).toBeNull();
    expect(cleanGuestName('a'.repeat(21))).toBeNull();
    expect(cleanGuestName('a'.repeat(20))).toBe('A' + 'a'.repeat(19));
    // "ß" capitalizes to "SS": kept as typed, so 20 letters stay 20.
    const sharp = cleanGuestName('ß' + 'a'.repeat(19));
    expect(sharp).toBe('ß' + 'a'.repeat(19));
    expect(sharp!.length).toBe(GUEST_NAME_MAX);
    // Stacked accent marks: two are fine, three are refused.
    expect(cleanGuestName('Zoe\u0301\u0308')).toBe('Zo\u00e9\u0308');
    expect(cleanGuestName('Zoe' + '\u0301'.repeat(4))).toBeNull();
    expect(cleanGuestName('a' + '́'.repeat(19))).toBeNull();
    // One spelling: an accent typed as a separate mark is the same name.
    expect(cleanGuestName('José')).toBe('José');
    expect(cleanGuestName("  o'neil  ")).toBe("O'neil");
    expect(cleanGuestName('محمد')).toBe('محمد');
    expect(cleanGuestName('Sam​X')).toBeNull();
  });

  it('a 20-letter guest name goes through the server and reads in full on every list', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    const long = 'Bartholomew-Alexandr';
    expect(long.length).toBe(20);
    expect((await addGuest(w, g.id, 'Blair', long)).status).toBe(200);
    expect((await addGuest(w, g.id, 'Casey', 'Sam😀')).status).toBe(400);
    expect((await rowOf(w, g.id, 'Blair')).guest.name).toBe(long);
    expect(JSON.stringify((await mineOn(w, 'Devon', g.id)).confirmed)).toContain(long);
  });
});

describe('Item 7 (Alex): host and guest both did not play owe only the spots the game is short', () => {
  async function pairNoShow(played: string[], paid = false) {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    if (paid) await markPaid(w, g.id, 'Blair');
    w.app.now = g.end + HOUR;
    const f = await finalize(w, g.id, played);
    expect(f.status, f.text).toBe(200);
    return { w, g, f };
  }
  it('0 short (4 played): Blair owes nothing', async () => {
    const { w, g, f } = await pairNoShow(['Casey', 'Devon', 'Emery', 'Frankie']);
    expect(f.data.played).toBe(4);
    expect((await rowOf(w, g.id, 'Blair')).lateFee ?? null).toBeNull();
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
  });
  it('1 short (3 played): Blair owes $14, History "owes their $14"; paid $28 gets $14 back', async () => {
    const { w, g } = await pairNoShow(['Casey', 'Devon', 'Emery']);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'no_show', paid: false, oweCents: 1400 });
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: 1400 });
    expect(await linesOf(w, g.start, /Blair owes their \$14 \(did not play, fewer than 4 played\)/)).toHaveLength(1);
    const p = await pairNoShow(['Casey', 'Devon', 'Emery'], true);
    expect(await credit(p.w, 'Blair')).toBe(1400);
    expect(await keptOn(p.w, p.g.id, 'Blair')).toBe(2800);
    expect((await rowOf(p.w, p.g.id, 'Blair')).lateFee).toMatchObject({ kind: 'no_show', paid: true });
    expect(health(p.w)).toEqual({});
  });
  it('2 short (2 played): Blair owes $28, History "owes their $28"', async () => {
    const { w, g } = await pairNoShow(['Casey', 'Devon']);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'no_show', oweCents: 2800 });
    expect(await linesOf(w, g.start, /Blair owes their \$28 \(did not play, fewer than 4 played\)/)).toHaveLength(1);
  });
  it('Reopen puts it back: redo with everyone played prices the pair at two shares', async () => {
    const { w, g } = await pairNoShow(['Casey', 'Devon', 'Emery']);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    const f = await finalize(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(6);
    expect((await rowOf(w, g.id, 'Blair')).shareCents).toBe(2 * 900);
    expect(health(w)).toEqual({});
  });
  it('the Who played note says it', () => {
    const fmt = formatPrice;
    const pair = [{ host: 'Blair', guest: 'Sam', hostPlayed: false, guestOut: false }];
    expect(whoPlayedNotes(pair, { played: 3, flatCents: 1400, fmt })).toEqual(["Blair didn't play, so Sam didn't either. Blair owes $14, for the 1 spot the game was short."]);
    expect(whoPlayedNotes(pair, { played: 2, flatCents: 1400, fmt })).toEqual(["Blair didn't play, so Sam didn't either. Blair owes $28, for the 2 spots the game was short."]);
    expect(whoPlayedNotes(pair, { played: 1, flatCents: 1400, fmt })).toEqual(["Blair didn't play, so Sam didn't either. Blair owes $28, for the 2 spots the game was short."]);
    expect(whoPlayedNotes(pair, { played: 4, flatCents: 1400, fmt })).toEqual(["Blair didn't play, so Sam didn't either."]);
    // Late fees off: exactly as before.
    expect(whoPlayedNotes(pair)).toEqual(["Blair didn't play, so Sam didn't either."]);
  });
});

describe('Item 8 (Alex): a game moved to another day clears the old day\'s late-drop debts', () => {
  const moveBy = (w: W, g: { id: string; start: number; end: number }, ms: number) =>
    admin(w, 'PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: new Date(g.start + ms).toISOString(), endsAt: new Date(g.end + ms).toISOString() });
  it('unpaid $14 debt: gone after the move, with a History line', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    expect((await drop(w, g.id, 'Blair')).lateFee).toEqual({ cents: PRICE, paid: false });
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect((await rowOf(w, g.id, 'Blair')).lateFee ?? null).toBeNull();
    expect(await linesOf(w, g.start + DAY, /^Blair's \$14 late drop cleared \(game moved to another day\)/)).toHaveLength(1);
    expect(health(w)).toEqual({});
  });
  it('paid $28 pair debt: all $28 back as credit', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(2800);
    expect(await linesOf(w, g.start + DAY, /Blair's \$28 late drop cleared \(game moved to another day\)/)).toHaveLength(1);
    expect(health(w)).toEqual({});
  });
  it('a guest spot owed after a late remove comes off too; paid $28 gives $14 back', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).data.lateOwesCents).toBe(1400);
    expect((await moveBy(w, g, DAY)).status).toBe(200);
    expect((await rowOf(w, g.id, 'Blair')).guest ?? null).toBeNull();
    expect(await credit(w, 'Blair')).toBe(1400);
    expect(await keptOn(w, g.id, 'Blair')).toBe(1400);
  });
  it('a time change on the same day keeps the debt', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect((await moveBy(w, g, HOUR)).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'late_drop' });
  });
});

describe('Item 9 (F-1): marking a newer court month paid never hides an older card', () => {
  const days = { courtDay: 0, membershipDay: 1 } as const;
  const games = [
    { startsAt: '2026-10-28T00:00:00.000Z', booked: true, canceled: false, costCents: 4800 },
    { startsAt: '2026-10-30T00:00:00.000Z', booked: true, canceled: false, costCents: 4800 },
    { startsAt: '2026-11-04T01:00:00.000Z', booked: true, canceled: false, costCents: 4800 },
  ];
  const base = { days, membershipCents: 0, games, nowMs: Date.UTC(2026, 11, 1, 17), tz: 'America/Detroit', onAtMs: Date.UTC(2026, 9, 26, 16) };
  it('October stays at $96 until its own Mark paid; then November alone', () => {
    const both = dueAlerts({ ...base, paid: new Set() });
    expect(both.map((a) => [a.keys[0], a.cents])).toEqual([
      ['court:2026-10', 9600],
      ['court:2026-11', 4800],
    ]);
    const novPaid = dueAlerts({ ...base, paid: new Set(['court:2026-11']), courtPaidThrough: '2026-11-30', courtPaidDates: ['2026-11-30'] });
    expect(novPaid.map((a) => [a.keys[0], a.cents])).toEqual([['court:2026-10', 9600]]);
    const octPaid = dueAlerts({ ...base, paid: new Set(['court:2026-10']), courtPaidThrough: '2026-10-31', courtPaidDates: ['2026-10-31'] });
    expect(octPaid.map((a) => [a.keys[0], a.cents])).toEqual([['court:2026-11', 4800]]);
  });
});

describe('Fresh review fixes', () => {
  it('R1 Text all after a one-share no-show pair asks for $14, not $7', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.end + HOUR;
    expect((await finalize(w, g.id, ['Casey', 'Devon', 'Emery'])).status).toBe(200);
    const s = await sessOf(w, g.id);
    expect((await rowOf(w, g.id, 'Blair')).guest?.units ?? 1).toBe(1);
    expect(gamePriceCents(await dash(w), s)).toBe(1400);
  });

  it('R2 Unmark after the confirm gave $14 back takes that $14 back too (no credit from nothing)', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g.id, 'Blair');
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    await drop(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    expect(await credit(w, 'Blair')).toBe(1400);
    const u = await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: false });
    expect(u.status, u.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(0);
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400 });
    expect(health(w)).toEqual({});
  });

  it('R2b the same after Remove guest ($28 paid, $14 back): Unmark takes the $14 back; spent credit refuses the Unmark', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    // The $14 is spent on the next game: the Unmark is refused (nothing moves).
    const g2 = await game(w, 1);
    await join(w, g2.id, ['Blair']);
    expect(await credit(w, 'Blair')).toBe(0);
    const u = await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: false });
    expect(u.status).toBe(409);
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect(health(w)).toEqual({});
  });

  it('R3 a single player (no guest) whose I paid is below the price reads exactly as before', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await selfPaid(w, g.id, 'Blair');
    const mine = (await mineOn(w, 'Blair', g.id)).mine!;
    expect(mine.claimCents).toBeUndefined();
    expect(mine.oweCents).toBe(0);
  });

  it('R6 a no-show pair, 2 short, with only the host\'s $14 paid: the seat still owes the guest\'s $14', async () => {
    const v = await guests();
    const h = await game(v);
    await join(v, h.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(v, h.id, 'Blair');
    await admin(v, 'POST', `/api/admin/sessions/${h.id}/guest/share`, { playerId: v.byName.Blair, who: 'host', paid: true });
    v.app.now = h.end + HOUR;
    expect((await finalize(v, h.id, ['Casey', 'Devon'])).status).toBe(200);
    expect((await rowOf(v, h.id, 'Blair')).lateFee).toMatchObject({ kind: 'no_show', oweCents: 1400 });
    expect(health(v)).toEqual({});
  });

  it('R6c the Who played note never says the organizer owes', () => {
    expect(whoPlayedNotes([{ host: 'Alex', guest: 'Sam', hostPlayed: false, guestOut: false, organizer: true }], { played: 3, flatCents: 1400, fmt: formatPrice })).toEqual([
      "Alex didn't play, so Sam didn't either.",
    ]);
  });
});

describe('Round 2 (Alex): the late-drop row on the Players sheet says the money', async () => {
  const { lateRowWords } = await import('../src/pages/admin/lateRow');
  const words = (r: any) => lateRowWords(r, 1400);
  it('host + guest, game 1 short, I paid $28 not confirmed: owes $14, $14 to give back; after the give-back: Paid $14, $14 back', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Blair']);
    await addGuest(w, g.id, 'Blair');
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    await drop(w, g.id, 'Blair');
    expect(words(await rowOf(w, g.id, 'Blair'))).toEqual({
      line: 'Late drop · owes $14',
      note: 'Paid $28 · $14 to give back',
      button: { label: 'Give back $14', giveBack: true },
      chip: null,
      request: false,
    });
    await markPaid(w, g.id, 'Blair');
    expect(words(await rowOf(w, g.id, 'Blair'))).toEqual({ line: 'Late drop · owes $14', note: '$14 back', button: null, chip: 'Paid $14', request: false });
  });
  it('host + guest, game 2 short, I paid $28: owes $28, Paid $28; a sub takes Sam\'s spot: owes $14, $14 to give back', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await selfPaid(w, g.id, 'Blair');
    at(w, g.start, 6);
    await drop(w, g.id, 'Blair');
    const r = await rowOf(w, g.id, 'Blair');
    expect(r.guest).toMatchObject({ name: 'Sam', status: 'late' });
    expect(words(r)).toEqual({ line: 'Late drop · owes $28', note: 'Marked paid by Blair', button: null, chip: 'Paid $28', request: false });
    w.app.advance(60_000);
    await join(w, g.id, ['Emery']);
    expect(words(await rowOf(w, g.id, 'Blair'))).toMatchObject({ line: 'Late drop · owes $14', note: 'Paid $28 · $14 to give back', button: { label: 'Give back $14' } });
  });
  it('a plain late drop: unpaid owes $14 with Mark paid and Request; paid $14: the Paid $14 chip', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 6);
    await drop(w, g.id, 'Blair');
    expect(words(await rowOf(w, g.id, 'Blair'))).toEqual({ line: 'Late drop · owes $14', note: null, button: { label: 'Mark paid', giveBack: false }, chip: null, request: true });
    await markPaid(w, g.id, 'Blair');
    expect(words(await rowOf(w, g.id, 'Blair'))).toEqual({ line: 'Late drop · owes $14', note: null, button: null, chip: 'Paid $14', request: false });
  });
  it('a no-show pair one short reads "Did not play · owes $14"', async () => {
    const w = await guests();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.end + HOUR;
    await finalize(w, g.id, ['Casey', 'Devon', 'Emery']);
    expect(words(await rowOf(w, g.id, 'Blair'))).toMatchObject({ line: 'Did not play · owes $14', button: { label: 'Mark paid' } });
  });
});
