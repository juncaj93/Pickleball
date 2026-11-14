// Zip 42 "Guest spot" (shared/guestSpot.ts, server/guestActions.ts): the organizer adds a guest (a plus one) to a player's sign-up.
// The guest takes a real spot, the host owes $28 for both, and every money move lands on the host. With the switch off nobody can add
// a guest. Players: Alex (organizer), Blair (the host in most cases), Casey, Devon, Emery, Frankie, Gale, Harper, Indy, Jules, Kit.
import { describe, expect, it } from 'vitest';
import { cleanGuestName, GUEST_SPOT, guestSpotAllowed, headCount, hostDropText, pairName, removeGuestText, seatUnits } from '../shared/guestSpot';
import { formatPrice } from '../shared/money';
import { LATE_FEES_HEADER } from '../shared/lateFees';
import type { GroupView } from '../shared/api';
import { activityText } from '../shared/activity';
import { type Client, DAY, HOUR, PIN, setupGroup, TestApp } from './harness';

const ORG = 'Alex';
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit'];

async function world(opts: { on?: 'settings' | 'header' | 'off'; maxPlayers?: number; lateFees?: boolean; env?: Record<string, string> } = {}) {
  const app = new TestApp();
  Object.assign(app.env, opts.env ?? {});
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: ORG };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  for (const [i, n] of EXTRA.entries()) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-03${String(i).padStart(2, '0')}` });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  const on = opts.on ?? 'settings';
  if (on === 'settings') {
    const r = await ctx.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true });
    expect(r.status, r.text).toBe(200);
  }
  if (opts.lateFees) expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  const headers: Record<string, string> = on === 'header' ? { [GUEST_SPOT.header]: 'on' } : {};
  if (opts.lateFees) headers[LATE_FEES_HEADER] = 'on';
  return { ...ctx, headers, phones: new Map<string, Client>() };
}
type W = Awaited<ReturnType<typeof world>>;

async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
async function phone(w: W, name: string): Promise<Client> {
  let c = w.phones.get(name);
  if (!c) {
    c = w.app.client();
    c.groupKey = w.groupKey;
    const res = await c.call('POST', '/api/me', { playerId: w.byName[name] });
    if (res.status !== 200) throw new Error(`pick name failed: ${res.text}`);
    w.phones.set(name, c);
  }
  return c;
}
const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body, w.headers);
const admin = (w: W, method: string, path: string, body?: unknown) => w.organizer.call(method, path, body, w.headers);
async function view(w: W, name: string): Promise<GroupView> {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
async function game(w: W, nth = 0) {
  const d = await dash(w);
  const s = d.sessions.filter((x: any) => Date.parse(x.startsAt) > w.app.now && !x.state.flags.canceled)[nth];
  return { id: s.id as string, start: Date.parse(s.startsAt) };
}
async function join(w: W, sid: string, names: string[]) {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
}
const addGuest = (w: W, sid: string, host: string, name = 'Sam') => admin(w, 'POST', `/api/admin/sessions/${sid}/guest`, { playerId: w.byName[host], name });
async function adminGame(w: W, sid: string) {
  return (await dash(w)).sessions.find((s: any) => s.id === sid);
}
async function mineOn(w: W, name: string, sid: string) {
  return (await view(w, name)).sessions.find((s) => s.id === sid)!;
}
async function credit(w: W, name: string): Promise<number> {
  const d = await dash(w);
  return d.creditLedger?.find((c: any) => c.playerId === w.byName[name])?.balanceCents ?? 0;
}
const markPaid = (w: W, sid: string, name: string) => admin(w, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: true });

describe('rules (pure)', () => {
  it('names, units, head count, cleaned first names, wording', () => {
    expect(pairName('Rowan', 'Sam')).toBe('Rowan + Sam (guest)');
    expect(seatUnits({ status: 'confirmed', guest_name: 'Sam', guest_status: 'confirmed' })).toBe(2);
    expect(seatUnits({ status: 'confirmed', guest_name: 'Sam', guest_status: 'waitlisted' })).toBe(1);
    expect(seatUnits({ status: 'confirmed' })).toBe(1);
    expect(seatUnits({ status: 'withdrawn', guest_name: 'Sam', guest_status: 'late', late_drop_at: 'x', late_drop_done_at: null })).toBe(2);
    expect(seatUnits({ status: 'withdrawn', guest_name: 'Sam', guest_status: 'late', late_drop_at: 'x', late_drop_done_at: 'y' })).toBe(1);
    expect(headCount([{ status: 'confirmed', guest_name: 'Sam', guest_status: 'confirmed' }, { status: 'confirmed' }, { status: 'waitlisted' }])).toBe(3);
    expect(cleanGuestName('  sam  ')).toBe('Sam');
    expect(cleanGuestName("mary-jo o'neil")).toBe("Mary-jo o'neil");
    expect(cleanGuestName('')).toBeNull();
    expect(cleanGuestName('<b>')).toBeNull();
    expect(cleanGuestName('Sam2')).toBeNull();
    expect(cleanGuestName('a'.repeat(21))).toBeNull();
    expect(hostDropText('Sam', null, formatPrice)).toBe('Your guest Sam drops out too. Both spots open up for someone else.');
    expect(hostDropText('Sam', { cancelBy: '9:30 AM', owesCents: 2800 }, formatPrice)).toBe(
      "It's past the 9:30 AM cancel-by. Your guest Sam drops out too. If no one takes your 2 spots, you still owe $28.",
    );
    expect(removeGuestText('Sam', 1400, true, formatPrice)).toBe("Sam comes off your tab. Sam's $14 goes to your credit.");
  });
  it('kill switch: allowed unless "off"', () => {
    expect(guestSpotAllowed(undefined)).toBe(true);
    expect(guestSpotAllowed(' OFF ')).toBe(false);
    expect(GUEST_SPOT).toMatchObject({ task: 'guest_spot_on', link: 'guestspot', name: 'Guest spot' });
  });
});

describe('the switch', () => {
  it('OFF: nobody can add a guest, the answers carry no guest flag', async () => {
    const w = await world({ on: 'off' });
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    const r = await addGuest(w, g.id, 'Blair');
    expect(r.status).toBe(403);
    const d = await dash(w);
    expect(d.guestSpot).toBeUndefined();
    expect(d.guestSpotForAll).toBeUndefined();
    expect((await view(w, 'Blair')).guestSpot).toBeUndefined();
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(403);
  });
  it('private link (header) works for that phone only; the kill switch beats it', async () => {
    const w = await world({ on: 'header' });
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/guest`, { playerId: w.byName.Casey, name: 'Lee' })).status).toBe(403);
    const k = await world({ on: 'header', env: { GUEST_SPOT: 'off' } });
    const kg = await game(k);
    await join(k, kg.id, ['Blair']);
    expect((await addGuest(k, kg.id, 'Blair')).status).toBe(403);
  });
  it('Settings row: on for everyone, with a History line', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.guestSpot).toBe(true);
    expect(d.guestSpotForAll).toBe(true);
    expect((await view(w, 'Blair')).guestSpot).toBe(true);
  });
});

describe('adding a guest', () => {
  it('host sees the guest on the card, $28 due; everyone sees the pair; one guest per player', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    const r = await addGuest(w, g.id, 'Blair', ' sam ');
    expect(r.status, r.text).toBe(200);
    expect(r.data.guest).toEqual({ name: 'Sam', status: 'confirmed' });
    const s = await mineOn(w, 'Blair', g.id);
    expect(s.confirmed.map((c) => c.name)).toEqual(['Blair', 'Sam', 'Casey', 'Devon']);
    expect(s.confirmed[1].guestOf).toBe('Blair');
    expect(s.mine?.guest).toEqual({ name: 'Sam', status: 'confirmed', shareCents: 1400 });
    expect(s.mine?.shareCents).toBe(2800);
    expect(s.mine?.oweCents).toBe(2800);
    expect(s.countText).toBe('4 in');
    const other = await mineOn(w, 'Casey', g.id);
    expect(other.confirmed.map((c) => c.name)).toEqual(['Blair', 'Sam', 'Casey', 'Devon']);
    expect(other.mine?.guest).toBeUndefined();
    expect(other.mine?.oweCents).toBe(1400);
    const a = await adminGame(w, g.id);
    expect(a.confirmedCount).toBe(4);
    const host = a.roster.find((x: any) => x.name === 'Blair');
    expect(host.guest).toMatchObject({ name: 'Sam', status: 'confirmed', shareCents: 1400, paid: false, hostPaid: false });
    expect(host.owesCents).toBe(2800);
    // Round 2 (Alex): "x of y paid" counts people: Blair and Sam each count.
    expect(a.payableCount).toBe(4);
    // One guest per player per game.
    const again = await addGuest(w, g.id, 'Blair', 'Lee');
    expect(again.status).toBe(409);
    expect(again.data.error ?? again.text).toMatch(/has_guest|already/);
  });
  it('refuses: not in the game, a bad name, an unconfirmed I paid', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey']);
    expect((await addGuest(w, g.id, 'Devon')).status).toBe(409);
    expect((await addGuest(w, g.id, 'Blair', 'S@m')).status).toBe(400);
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    expect((await addGuest(w, g.id, 'Casey')).status).toBe(409);
  });
  it('a host who already paid $14 owes the guest\'s $14 (held, never lost)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await markPaid(w, g.id, 'Blair')).status).toBe(200);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
    const s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.paymentStatus).toBe('unpaid');
    expect(s.mine?.oweCents).toBe(1400);
    expect(s.mine?.paidEarlierCents).toBe(1400);
    // Pay the rest: paid $28.
    expect((await markPaid(w, g.id, 'Blair')).status).toBe(200);
    const s2 = await mineOn(w, 'Blair', g.id);
    expect(s2.mine?.paymentStatus).toBe('paid');
    expect(s2.mine?.oweCents).toBe(0);
  });
});

describe('spots', () => {
  it('3 in plus a guest makes 4 (the 4 to 10 rule counts the guest)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await mineOn(w, 'Casey', g.id)).countText).toBe('3 of 4 in');
    await addGuest(w, g.id, 'Blair');
    const s = await mineOn(w, 'Casey', g.id);
    expect(s.countText).toBe('4 in');
    expect(s.confirmed).toHaveLength(4);
  });
  it('full game: the guest waits behind the host, moves in when a spot opens, and the host then owes $28', async () => {
    const w = await world({ maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const r = await addGuest(w, g.id, 'Blair');
    expect(r.data.guest.status).toBe('waitlisted');
    // A later player waits behind the guest.
    await join(w, g.id, ['Gale']);
    let s = await mineOn(w, 'Gale', g.id);
    expect(s.waitlist.map((x) => x.name)).toEqual(['Sam', 'Gale']);
    expect(s.mine?.waitlistPosition).toBe(2);
    const host = await mineOn(w, 'Blair', g.id);
    expect(host.mine?.oweCents).toBe(1400);
    expect(host.mine?.guest?.status).toBe('waitlisted');
    // Casey drops: the guest takes the spot, not Gale.
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    s = await mineOn(w, 'Gale', g.id);
    expect(s.confirmed.map((x) => x.name)).toEqual(['Blair', 'Sam', 'Devon', 'Emery', 'Frankie']);
    expect(s.waitlist.map((x) => x.name)).toEqual(['Gale']);
    expect((await mineOn(w, 'Blair', g.id)).mine?.oweCents).toBe(2800);
  });
  it('waitlist promotion when a guest is removed: the first waiter moves in', async () => {
    const w = await world({ maxPlayers: 5 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await join(w, g.id, ['Frankie']);
    expect((await mineOn(w, 'Frankie', g.id)).mine?.status).toBe('waitlisted');
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {});
    expect(r.status, r.text).toBe(200);
    expect((await mineOn(w, 'Frankie', g.id)).mine?.status).toBe('confirmed');
    expect((await mineOn(w, 'Blair', g.id)).mine?.oweCents).toBe(1400);
  });
  it('card cleanup on (no waitlist): a full game refuses a guest', async () => {
    const w = await world();
    expect((await admin(w, 'PUT', '/api/admin/zip10-switch', { on: true })).status).toBeLessThan(500);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey']);
    expect((await addGuest(w, g.id, 'Blair')).status).toBe(200);
  });
});

describe('money', () => {
  it('host pays $28 (Mark paid), removes the guest: $14 to credit', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    const m = await markPaid(w, g.id, 'Blair');
    expect(m.status, m.text).toBe(200);
    expect((await mineOn(w, 'Blair', g.id)).mine?.paymentStatus).toBe('paid');
    expect(await credit(w, 'Blair')).toBe(0);
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {});
    expect(r.status, r.text).toBe(200);
    expect(r.data.creditBackCents).toBe(1400);
    expect(await credit(w, 'Blair')).toBe(1400);
    const s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.paymentStatus).toBe('paid');
    expect(s.mine?.shareCents).toBe(1400);
    expect(s.confirmed.map((c) => c.name)).toEqual(['Blair', 'Casey', 'Devon', 'Emery']);
  });
  it('unpaid host removes the guest: owes $14 again, no credit made', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    await addGuest(w, g.id, 'Blair');
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {});
    expect(r.data.creditBackCents).toBe(0);
    expect((await mineOn(w, 'Blair', g.id)).mine?.oweCents).toBe(1400);
    expect(await credit(w, 'Blair')).toBe(0);
  });
  it('host with credit: Use credit covers the $28; remove guest gives the $14 back to the pot', async () => {
    const w = await world();
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    // Blair gets $28 credit: paid $14 twice on a game that is then canceled.
    await join(w, g0.id, ['Blair']);
    await markPaid(w, g0.id, 'Blair');
    await join(w, g0.id, ['Casey']);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g0.id}/withdraw`, {})).status).toBe(200);
    expect(await credit(w, 'Blair')).toBe(1400);
    await join(w, g1.id, ['Blair', 'Casey', 'Devon']);
    // Auto credit used $14 on joining: paid with credit.
    expect((await mineOn(w, 'Blair', g1.id)).mine?.paymentStatus).toBe('paid');
    await addGuest(w, g1.id, 'Blair');
    let s = await mineOn(w, 'Blair', g1.id);
    expect(s.mine?.paymentStatus).toBe('unpaid');
    expect(s.mine?.oweCents).toBe(1400);
    expect(s.mine?.creditCents).toBe(1400);
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g1.id}/remove-guest`, {});
    expect(r.status, r.text).toBe(200);
    s = await mineOn(w, 'Blair', g1.id);
    expect(s.mine?.paymentStatus).toBe('paid');
    expect(s.mine?.paidWithCredit).toBe(true);
    expect(await credit(w, 'Blair')).toBe(0);
  });
  it('final price uses the real head count: 4 seats + a guest = 5 played, $11 each, host pays $22', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) expect((await markPaid(w, g.id, n)).status).toBe(200);
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(5);
    expect(f.data.priceCents).toBe(1100);
    expect(await credit(w, 'Blair')).toBe(600);
    expect(await credit(w, 'Casey')).toBe(300);
  });
  it('drop out outside the 12 hours: both spots open, the whole $28 comes back as credit', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(r.status, r.text).toBe(200);
    expect(r.data.lateFee).toBeUndefined();
    expect(await credit(w, 'Blair')).toBe(2800);
    const s = await mineOn(w, 'Casey', g.id);
    expect(s.confirmed.map((c) => c.name)).toEqual(['Casey', 'Devon', 'Emery']);
  });
  it('drop out inside the 12 hours leaving the game short: the host owes $28; two subs clear it one spot at a time', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const pre = await mineOn(w, 'Blair', g.id);
    expect(pre.mine?.lateDrop).toMatchObject({ owes: true, feeCents: 2800 });
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(r.status, r.text).toBe(200);
    expect(r.data.lateFee).toEqual({ cents: 2800, paid: false });
    let s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.lateFee?.oweCents).toBe(2800);
    // First sub takes the guest's spot: Blair owes $14.
    await join(w, g.id, ['Emery']);
    s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.lateFee?.oweCents).toBe(1400);
    // Second sub takes Blair's own spot: nothing owed. (One clear per game per moment, so a minute later.)
    w.app.advance(60_000);
    await join(w, g.id, ['Frankie']);
    s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.lateFee ?? null).toBeNull();
  });
  it('a paid host drops late: $28 stays; a sub on the guest spot gives $14 back as credit', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(r.data.lateFee).toMatchObject({ paid: true });
    expect(await credit(w, 'Blair')).toBe(0);
    await join(w, g.id, ['Emery']);
    expect(await credit(w, 'Blair')).toBe(1400);
    w.app.advance(60_000);
    await join(w, g.id, ['Frankie']);
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it('organizer removes the host: the guest goes too and both shares come back', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'withdraw' });
    expect(r.status, r.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(2800);
    const a = await adminGame(w, g.id);
    expect(a.confirmedCount).toBe(3);
    expect(a.roster.find((x: any) => x.name === 'Blair').guest).toBeUndefined();
  });
  it('late cancel, fee kept, no split (4 in with the guest): the pair owes two flat shares', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(r.status, r.text).toBe(200);
    expect((await mineOn(w, 'Blair', g.id)).mine?.lateFee?.oweCents).toBe(2800);
    expect((await mineOn(w, 'Casey', g.id)).mine?.lateFee?.oweCents).toBe(1400);
  });
  it('cancel: everything on the seat ($28) comes back to the host', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect(r.status, r.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(2800);
  });
  it("I paid ($28) and Didn't pay? undo", async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    const p = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true });
    expect(p.status, p.text).toBe(200);
    let a = await adminGame(w, g.id);
    expect(a.roster.find((x: any) => x.name === 'Blair').paymentAmountCents).toBe(2800);
    const u = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: false });
    expect(u.status, u.text).toBe(200);
    a = await adminGame(w, g.id);
    expect(a.roster.find((x: any) => x.name === 'Blair').owesCents).toBe(2800);
    // An unconfirmed I paid blocks removing the guest (Mark paid would record the wrong amount afterwards).
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true });
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(409);
  });
});

describe('a game with no guest is exactly as before', () => {
  it('a full roster with no guest reads the same with the switch on and off', async () => {
    const answers: unknown[] = [];
    for (const on of ['off', 'settings'] as const) {
      const w = await world({ on });
      const g = await game(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
      await markPaid(w, g.id, 'Casey');
      const s = await mineOn(w, 'Blair', g.id);
      const a = await adminGame(w, g.id);
      answers.push({ s, roster: a.roster, c: a.confirmedCount, w: a.waitlistCount, p: [a.paidCount, a.payableCount] });
    }
    expect(JSON.stringify(answers[1]).replace(/[0-9a-f-]{36}/g, 'ID')).toBe(JSON.stringify(answers[0]).replace(/[0-9a-f-]{36}/g, 'ID'));
    expect(DAY).toBeGreaterThan(0);
  });
});

describe('alerts and texts', () => {
  async function withTelegram() {
    const bodies: any[] = [];
    const w = await world({
      env: {
        SITE_URL: 'https://pickleball.juncaj.net',
        TELEGRAM_BOT_TOKEN: '123:abc',
        TELEGRAM_CHAT_ID: '42',
      } as Record<string, string>,
    });
    (w.app.env as any).TELEGRAM_FETCH = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    return { w, bodies };
  }
  it('one combined alert when a host drops with a guest: "Blair (and guest Sam) dropped out", the count counts the guest', async () => {
    const { w, bodies } = await withTelegram();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 20 * HOUR;
    bodies.length = 0;
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    await w.app.settle();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].text).toMatch(/^Blair \(and guest Sam\) dropped out of /);
    expect(bodies[0].text).toMatch(/2 in now, under 4\./);
    expect(bodies[0].text).not.toMatch(/Sam dropped/);
  });
  it('the organizer gets one alert when the host removes the guest; nothing is ever sent to a guest', async () => {
    const { w, bodies } = await withTelegram();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    bodies.length = 0;
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {})).status).toBe(200);
    await w.app.settle();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].text).toMatch(/^Blair removed guest Sam from .+\. 4 in now\.$/);
    expect(bodies[0].chat_id).toBe('42');
    // The organizer's own Remove guest sends nothing (only player taps cause alerts).
    await addGuest(w, g.id, 'Blair');
    bodies.length = 0;
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/remove`, { playerId: w.byName.Blair })).status).toBe(200);
    await w.app.settle();
    expect(bodies).toHaveLength(0);
  });
  it('History lines name the guest by first name', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    await addGuest(w, g.id, 'Blair');
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/remove-guest`, {});
    const lines = (await dash(w)).audit.map((a: any) => activityText({ ...a, sessionStartsAt: new Date(g.start).toISOString() }, 'America/Detroit', ORG));
    expect(lines.some((l: string) => /^Alex added Sam as Blair's guest for /.test(l)), lines.join(' | ')).toBe(true);
    expect(lines.some((l: string) => /^Blair removed their guest Sam for /.test(l)), lines.join(' | ')).toBe(true);
  });
  it('texts: the guest has no row, so no prepared text ever has a guest recipient; the reminder amount is the host\'s $28', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    const a = await adminGame(w, g.id);
    // Rows are seats: Sam is never a row with a phone.
    expect(a.roster.map((r: any) => r.name).sort()).toEqual(['Blair', 'Casey', 'Devon']);
    expect(a.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(2800);
    // The count every text uses counts Sam.
    expect(a.confirmedCount).toBe(4);
  });
});

describe('more money and seats', () => {
  it.each([
    // [seats with no guest besides Blair, played count, price, Blair back, Casey back]
    [4, 6, 900, 1000, 500],
    [5, 7, 800, 1200, 600],
    [8, 10, 500, 1800, 900],
  ])('final price with a guest: Blair + Sam and %i others: %i played, $%i each', async (others, played, price, blairBack, caseyBack) => {
    const w = await world({ maxPlayers: 10 });
    const g = await game(w);
    const names = ['Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules'].slice(0, others);
    await join(w, g.id, ['Blair', ...names]);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Blair', ...names]) expect((await markPaid(w, g.id, n)).status).toBe(200);
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(played);
    expect(f.data.priceCents).toBe(price);
    expect(await credit(w, 'Blair')).toBe(blairBack);
    expect(await credit(w, 'Casey')).toBe(caseyBack);
  });
  it('the host did not play: nothing for either, all $28 back; reopen takes it back and the pair owes again', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const played = ['Casey', 'Devon', 'Emery', 'Frankie'].map((n) => w.byName[n]);
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played });
    expect(f.data.played).toBe(4);
    expect(await credit(w, 'Blair')).toBe(2800);
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {});
    expect(r.status, r.text).toBe(200);
    expect(await credit(w, 'Blair')).toBe(0);
    const again = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(again.data.played).toBe(6);
    expect(again.data.priceCents).toBe(900);
    expect(await credit(w, 'Blair')).toBe(1000);
  });
  it('late cancel, fee kept and split: the guest counts in N, the host keeps two shares', async () => {
    const w = await world({ lateFees: true });
    expect((await admin(w, 'PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    for (const n of ['Blair', 'Casey']) await markPaid(w, g.id, n);
    w.app.now = g.start - 6 * HOUR;
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(r.status, r.text).toBe(200);
    expect(r.data.split).toEqual({ count: 6, priceCents: 900 });
    // Blair paid $28 for two shares of $9: $10 back. Casey paid $14: $5 back. Devon owes $9.
    expect(await credit(w, 'Blair')).toBe(1000);
    expect(await credit(w, 'Casey')).toBe(500);
    expect((await mineOn(w, 'Devon', g.id)).mine?.lateFee?.oweCents).toBe(900);
    expect((await mineOn(w, 'Blair', g.id)).mine?.shareCents).toBe(1800);
  });
  it('a waitlisted host with a waitlisted guest: the host moves in first, then the guest, each on its own spot', async () => {
    const w = await world({ maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Casey', 'Devon', 'Emery', 'Frankie', 'Blair']);
    expect((await mineOn(w, 'Blair', g.id)).mine?.status).toBe('waitlisted');
    const r = await addGuest(w, g.id, 'Blair');
    expect(r.data.guest.status).toBe('waitlisted');
    expect((await mineOn(w, 'Casey', g.id)).waitlist.map((x) => x.name)).toEqual(['Blair', 'Sam']);
    await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    let s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.status).toBe('confirmed');
    expect(s.mine?.guest?.status).toBe('waitlisted');
    expect(s.mine?.oweCents).toBe(1400);
    await call(w, 'Devon', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.guest?.status).toBe('confirmed');
    expect(s.mine?.oweCents).toBe(2800);
    expect(s.countText).toBe('4 in, full');
  });
  it('under 4 with the guest gone: removing the guest from a 4-player game leaves 3 (the game is short again)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    expect((await mineOn(w, 'Casey', g.id)).countText).toBe('4 in');
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/guest/remove`, { playerId: w.byName.Blair });
    expect((await mineOn(w, 'Casey', g.id)).countText).toBe('3 of 4 in');
  });
  it('a sub replacing a late pair is never charged twice and the books balance (every cent the host paid comes back or stays once)', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    await join(w, g.id, ['Emery']);
    w.app.advance(60_000);
    await join(w, g.id, ['Frankie']);
    w.app.advance(60_000);
    // A third sub clears nothing more.
    await join(w, g.id, ['Gale']);
    expect(await credit(w, 'Blair')).toBe(2800);
    const s = await mineOn(w, 'Emery', g.id);
    expect(s.confirmed.map((c) => c.name)).toEqual(['Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
  });
});

describe('fresh review fixes', () => {
  it('the organizer brings a guest and drops late: a sub never turns the court payment into credit', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Casey', 'Devon']);
    expect((await addGuest(w, g.id, 'Alex')).status).toBe(200);
    // Court paid: the organizer's own row (Mark paid on Alex records the venue payment).
    expect((await markPaid(w, g.id, 'Alex')).status).toBe(200);
    const before = (await adminGame(w, g.id)).roster.find((r: any) => r.name === 'Alex');
    w.app.now = g.start - 6 * HOUR;
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false })).status).toBe(200);
    await join(w, g.id, ['Emery']);
    w.app.advance(60_000);
    await join(w, g.id, ['Frankie']);
    const after = (await adminGame(w, g.id)).roster.find((r: any) => r.name === 'Alex');
    expect(after.paymentAmountCents).toBe(before.paymentAmountCents);
    expect(await credit(w, 'Alex')).toBe(0);
    expect(before.paymentAmountCents).toBeGreaterThan(0);
  });
  it('a guest added to an open spot clears a late dropper\'s $14 like any sub', async () => {
    const w = await world({ lateFees: true });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Emery');
    w.app.now = g.start - 6 * HOUR;
    const d = await call(w, 'Emery', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(d.data.lateFee).toMatchObject({ paid: true });
    expect(await credit(w, 'Emery')).toBe(0);
    expect((await addGuest(w, g.id, 'Casey')).status).toBe(200);
    expect(await credit(w, 'Emery')).toBe(1400);
    expect((await mineOn(w, 'Emery', g.id)).mine?.lateFee ?? null).toBeNull();
  });
  it('a waiting guest moving in clears a late dropper\'s $14 too', async () => {
    const w = await world({ lateFees: true, maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await addGuest(w, g.id, 'Blair')).data.guest.status).toBe('waitlisted');
    w.app.now = g.start - 6 * HOUR;
    // Emery leaves 3 in plus Sam waiting: Sam moves in at once, so the game is not short and Emery owes nothing.
    const d = await call(w, 'Emery', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(d.data.lateFee).toBeUndefined();
    expect((await mineOn(w, 'Blair', g.id)).mine?.guest?.status).toBe('confirmed');
  });
  it("the card's late-drop warning agrees with the server when the host's own guest is waiting", async () => {
    const w = await world({ lateFees: true, maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start - 6 * HOUR;
    const card = await mineOn(w, 'Blair', g.id);
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(!!card.mine?.lateDrop?.owes).toBe(!!r.data.lateFee);
    expect(card.mine?.lateDrop?.owes).toBe(true);
  });
});

describe('round 2: each person played or not', () => {
  const ids = (w: W, names: string[]) => names.map((n) => w.byName[n]);
  it('4 players, the 4th brings a guest as the 5th, the guest backs out: 4 played at $14, the host keeps one share', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Emery');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Emery']) });
    expect(f.status, f.text).toBe(200);
    expect(f.data.played).toBe(4);
    expect(f.data.priceCents).toBe(1400);
    // Emery paid $28 for two; one share is gone: $14 back.
    expect(await credit(w, 'Emery')).toBe(1400);
    expect(await credit(w, 'Blair')).toBe(0);
    const a = await adminGame(w, g.id);
    expect(a.roster.find((r: any) => r.name === 'Emery').guest.played).toBe(false);
  });
  it('the guest played, the host is unpaid: the host owes two final shares', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']) });
    expect(f.data.played).toBe(5);
    expect((await adminGame(w, g.id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(2200);
  });
  it('guest marked did not play while the host owes: the host owes one share', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']), guestsOut: ids(w, ['Blair']) });
    expect(f.data.played).toBe(5);
    expect(f.data.priceCents).toBe(1100);
    expect((await adminGame(w, g.id)).roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1100);
  });
  it('the host did not play: the guest did not either (no share for either), even if the screen forgot to say so', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Casey', 'Devon', 'Emery', 'Frankie']) });
    expect(f.data.played).toBe(4);
    expect(await credit(w, 'Blair')).toBe(2800);
    const a = await adminGame(w, g.id);
    expect(a.roster.find((r: any) => r.name === 'Blair').guest.played).toBeUndefined();
  });
  it('reopen brings the guest back in the count; the redo can say again', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await addGuest(w, g.id, 'Emery');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Blair', 'Casey', 'Devon', 'Emery']), guestsOut: ids(w, ['Emery']) });
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect(await credit(w, 'Emery')).toBe(0);
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(f.data.played).toBe(5);
    expect(await credit(w, 'Emery')).toBe(600);
  });
  it('a guest who was not in cannot be marked', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = g.start + 3 * HOUR;
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true, guestsOut: ids(w, ['Blair']) });
    expect(f.status).toBe(400);
  });
  it('extended time counts the guest: the host pays two shares', async () => {
    const w = await world();
    expect((await admin(w, 'PUT', '/api/admin/extended-time-switch', { on: true })).status).toBe(200);
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    w.app.now = g.start + 3 * HOUR;
    // 4 played (Blair, Sam, Casey, Devon), +1 hr = $24: $6 each; Blair pays $12.
    const f = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ids(w, ['Blair', 'Casey', 'Devon']), extraMinutes: 60 });
    expect(f.status, f.text).toBe(200);
    expect(f.data.extension).toMatchObject({ shareCents: 600, payers: 4 });
    const ext = (n: string) => ((w.app.db as any).raw.prepare('SELECT ext_cents AS c FROM session_players WHERE session_id = ? AND player_id = ?').get(g.id, w.byName[n]) as { c: number }).c;
    expect(ext('Blair')).toBe(1200);
    expect(ext('Casey')).toBe(600);
  });
});

describe('round 2: each person paid or not (one money record on the host)', () => {
  const share = (w: W, sid: string, host: string, who: 'host' | 'guest', paid: boolean) => admin(w, 'POST', `/api/admin/sessions/${sid}/guest/share`, { playerId: w.byName[host], who, paid });
  const pairOf = async (w: W, sid: string, host: string) => {
    const a = await adminGame(w, sid);
    const r = a.roster.find((x: any) => x.name === host);
    return { host: r.guest.hostPaid, guest: r.guest.paid, owes: r.owesCents, paid: a.paidCount, of: a.payableCount };
  };
  it('mark the guest paid first: the guest is paid, the host still owes $14; "x of y paid" counts people', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: false, guest: false, owes: 2800, paid: 0, of: 4 });
    const r = await share(w, g.id, 'Blair', 'guest', true);
    expect(r.status, r.text).toBe(200);
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: false, guest: true, owes: 1400, paid: 1, of: 4 });
    expect(await credit(w, 'Blair')).toBe(0);
    // Then the host: paid in full.
    expect((await share(w, g.id, 'Blair', 'host', true)).status).toBe(200);
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: true, guest: true, owes: 0, paid: 2, of: 4 });
    const s = await mineOn(w, 'Blair', g.id);
    expect(s.mine?.paymentStatus).toBe('paid');
    expect(s.mine?.shareCents).toBe(2800);
  });
  it('undo per person: unmark the guest on a seat paid in full in cash leaves the host paid', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    expect((await share(w, g.id, 'Blair', 'guest', false)).status).toBe(200);
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: true, guest: false, owes: 1400, paid: 1, of: 4 });
    // Unmark the host too: nothing paid, nothing became credit.
    expect((await share(w, g.id, 'Blair', 'host', false)).status).toBe(200);
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: false, guest: false, owes: 2800, paid: 0, of: 4 });
    expect(await credit(w, 'Blair')).toBe(0);
  });
  it('a share paid with credit is not undone per person (Unmark on the host row instead)', async () => {
    const w = await world();
    const g0 = await game(w, 0);
    const g1 = await game(w, 1);
    await join(w, g0.id, ['Blair']);
    await markPaid(w, g0.id, 'Blair');
    await call(w, 'Blair', 'POST', `/api/sessions/${g0.id}/withdraw`, {});
    await join(w, g1.id, ['Blair', 'Casey', 'Devon']);
    await addGuest(w, g1.id, 'Blair');
    expect(await pairOf(w, g1.id, 'Blair')).toMatchObject({ host: true, guest: false });
    expect((await share(w, g1.id, 'Blair', 'host', false)).status).toBe(409);
  });
  it('the host paid $14 before the guest came: the host is paid, the guest owes (Parker and Billy in the picture)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await markPaid(w, g.id, 'Blair');
    await addGuest(w, g.id, 'Blair', 'Billy');
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: true, guest: false, owes: 1400, paid: 1, of: 4 });
    expect((await share(w, g.id, 'Blair', 'guest', true)).status).toBe(200);
    expect(await pairOf(w, g.id, 'Blair')).toEqual({ host: true, guest: true, owes: 0, paid: 2, of: 4 });
  });
  it('a game with no guest counts seats exactly as before', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await markPaid(w, g.id, 'Casey');
    const a = await adminGame(w, g.id);
    expect([a.paidCount, a.payableCount]).toEqual([1, 3]);
  });
});
