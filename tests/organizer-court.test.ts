import { describe, expect, it } from 'vitest';
import { courtSplit } from '../shared/pricing';
import { balanceOf, buildTodo, refundRows } from '../src/pages/admin/todo';
import { DAY, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

// The organizer (Alex here) pays the venue the full court cost. The other
// players' payments reimburse them. Nothing about the other players changes.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const ME = 'Alex';

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function on(ctx: Ctx, date: string) {
  const d = await dash(ctx);
  const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const session = async (ctx: Ctx, id: string) => (await dash(ctx)).sessions.find((x: any) => x.id === id);
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
}
async function pay(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
}
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const markCourt = (ctx: Ctx, id: string, paid: boolean) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[ME], paid });

/** A group where Alex is the organizer. */
async function organizerGroup() {
  const ctx = await setupGroup();
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME })).status).toBe(200);
  return ctx;
}

describe('court math', () => {
  it('players cover X, your share is the rest, never below $0', () => {
    expect(courtSplit(4800, [1400, 1400, 1400])).toEqual({ playersCoverCents: 4200, yourShareCents: 600, covered: false });
    expect(courtSplit(4800, [1400])).toEqual({ playersCoverCents: 1400, yourShareCents: 3400, covered: false });
    expect(courtSplit(4800, [])).toEqual({ playersCoverCents: 0, yourShareCents: 4800, covered: false });
    expect(courtSplit(4800, [1400, 1400, 1400, 1400])).toEqual({ playersCoverCents: 5600, yourShareCents: 0, covered: true });
    expect(courtSplit(4800, [1400, 1400, 1400, 900, 900])).toEqual({ playersCoverCents: 6000, yourShareCents: 0, covered: true });
    expect(courtSplit(4200, [1400, 1400, 1400])).toMatchObject({ yourShareCents: 0, covered: true });
  });
});

describe('4 playing: you and 3 others', () => {
  it('shows the court row: full cost $48, players cover $42, your share $6; counts are other players only', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    let x = await session(ctx, s.id);
    expect(x.confirmedCount).toBe(4);
    expect(x.court).toMatchObject({ costCents: 4800, typicalCost: true, playersCoverCents: 4200, yourShareCents: 600, covered: false, paid: false });
    expect(x.payableCount).toBe(3);
    expect(x.paidCount).toBe(0);
    const me = x.roster.find((r: any) => r.name === ME);
    expect(me).toMatchObject({ isOrganizer: true, shareCents: null, creditCents: 0, discount: false });
    expect(x.roster.filter((r: any) => !r.isOrganizer).every((r: any) => r.shareCents === 1400)).toBe(true);

    await pay(ctx, s.id, ['Blair']);
    x = await session(ctx, s.id);
    expect([x.paidCount, x.payableCount]).toEqual([1, 3]);
    expect(x.court.playersCoverCents).toBe(4200); // owed, paid or not
  });

  it('Mark paid / Unmark on your row mean "Court paid" / "Court due" and never count as collected', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    expect((await markCourt(ctx, s.id, true)).status).toBe(200);
    let x = await session(ctx, s.id);
    expect(x.court).toMatchObject({ paid: true, costCents: 4800 });
    expect(x.court.paidAt).toBeTruthy();
    // Still 3 of 3, never 4 of 4.
    expect([x.paidCount, x.payableCount]).toEqual([3, 3]);
    // It is a record of what you paid the venue, not a $14 payment.
    expect(x.roster.find((r: any) => r.name === ME)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 4800 });
    // Doing it twice changes nothing.
    expect((await markCourt(ctx, s.id, true)).data.changed).toBe(false);
    // Unmark takes it back.
    expect((await markCourt(ctx, s.id, false)).status).toBe(200);
    x = await session(ctx, s.id);
    expect(x.court.paid).toBe(false);
    expect(x.roster.find((r: any) => r.name === ME)).toMatchObject({ paymentStatus: 'unpaid', paymentAmountCents: null });
    expect((await markCourt(ctx, s.id, false)).data.changed).toBe(false);
    // Logged for the Activity list.
    const log = (await dash(ctx)).audit.map((a: any) => a.action);
    expect(log).toContain('court_paid');
    expect(log).toContain('court_unpaid');
  });

  it('an old unpaid mark simply reads Court due, and other players are untouched', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    const before = (await session(ctx, s.id)).roster.filter((r: any) => !r.isOrganizer);
    expect((await session(ctx, s.id)).roster.find((r: any) => r.name === ME)).toMatchObject({ paymentStatus: 'unpaid' });
    expect((await session(ctx, s.id)).court.paid).toBe(false);
    await markCourt(ctx, s.id, true);
    expect((await session(ctx, s.id)).roster.filter((r: any) => !r.isOrganizer)).toEqual(before);
  });

  it('the organizer is never in Who owes, Mark paid tonight, reminders or the Players tab balance', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 10 * 3600_000; // game day morning
    const d = await dash(ctx);
    const items = buildTodo(d);
    const tonight = items.find((i) => i.kind === 'tonight') as any;
    expect(tonight.rows.map((r: any) => r.name)).toEqual(['Blair', 'Casey', 'Devon']);
    expect(balanceOf(d, ctx.byName[ME])).toEqual({ owedCents: 0, creditCents: 0 });
    expect(balanceOf(d, ctx.byName.Blair)).toEqual({ owedCents: 1400, creditCents: 0 });
    // Marking the others paid empties the card even though the court is still due.
    await pay(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    expect(buildTodo(await dash(ctx)).find((i) => i.kind === 'tonight' || i.kind === 'owed')).toBeUndefined();
  });
});

describe('2 playing: you and 1 other', () => {
  it('players cover $14, your share $34', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair']);
    const x = await session(ctx, s.id);
    expect(x.court).toMatchObject({ costCents: 4800, playersCoverCents: 1400, yourShareCents: 3400, covered: false });
    expect([x.paidCount, x.payableCount]).toEqual([0, 1]);
  });
});

describe('6 playing', () => {
  it('players cover the court (you are among the first four): $60 from 5 others', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-12');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const x = await session(ctx, s.id);
    // Blair, Casey, Devon pay $14; Emery and Frankie pay $9.
    expect(x.court).toMatchObject({ costCents: 4800, playersCoverCents: 6000, yourShareCents: 0, covered: true });
    expect([x.paidCount, x.payableCount]).toEqual([0, 5]);
  });

  it('you in the last two: the others pay 4 x $14 + $9 = $65', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-12');
    await join(ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ME]);
    const x = await session(ctx, s.id);
    expect(x.court).toMatchObject({ playersCoverCents: 6500, yourShareCents: 0, covered: true });
  });

  it('surplus toward the membership only exists when players paid more than the courts; you earn no credit', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-12');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await pay(ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await markCourt(ctx, s.id, true);
    ctx.app.now = Date.parse(s.endsAt) + DAY;
    let d = await dash(ctx);
    // Credits go to the first four *other* players only: Blair, Casey, Devon.
    expect(d.credits.map((c: any) => c.name).sort()).toEqual(['Blair', 'Casey', 'Devon']);
    let m = await money(ctx, '2026-11');
    expect(m.collectedCents).toBe(6000); // not 7400: your own $14 / $9 are never collected
    expect(m.courtCostCents).toBe(4800);
    expect(m.creditsOwedCents).toBe(1500); // not 2000
    expect(m.netCents).toBe(-300);
    expect(m).toMatchObject({ surplusCents: 0, coveredCents: 300, bottomLine: 'You covered $3 of the court costs' });
    // Once the credits are settled by hand, the players really did pay more than the court.
    for (const n of ['Blair', 'Casey', 'Devon']) await ctx.organizer.call('POST', `/api/admin/credits/${ctx.byName[n]}/clear`, {});
    d = await dash(ctx);
    expect(d.credits).toEqual([]);
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ collectedCents: 6000, courtCostCents: 4800, creditsOwedCents: 0, netCents: 1200, surplusCents: 1200, coveredCents: 0 });
    expect(m.bottomLine).toBe('Surplus: $12 toward the $30 membership');
    expect(m.membershipCents).toBe(3000); // your separate $30, untouched
  });

  it('a custom court cost lets 3 other players cover it: surplus, and your share is $0', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, { courtCostCents: 4000 });
    await pay(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    expect((await session(ctx, s.id)).court).toMatchObject({ costCents: 4000, typicalCost: false, playersCoverCents: 4200, yourShareCents: 0, covered: true });
    ctx.app.now = Date.parse(s.endsAt) + DAY;
    const m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ collectedCents: 4200, courtCostCents: 4000, surplusCents: 200, coveredCents: 0 });
    expect(m.bottomLine).toBe('Surplus: $2 toward the $30 membership');
  });
});

describe('a game you are not playing', () => {
  it('you still pay the venue: the court row is there, and Mark paid works without taking a spot', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    let x = await session(ctx, s.id);
    expect(x.roster.some((r: any) => r.name === ME)).toBe(false);
    expect(x.court).toMatchObject({ costCents: 4800, playersCoverCents: 4200, yourShareCents: 600, paid: false });
    expect([x.paidCount, x.payableCount]).toEqual([0, 3]);

    expect((await markCourt(ctx, s.id, true)).status).toBe(200);
    x = await session(ctx, s.id);
    expect(x.court.paid).toBe(true);
    // Not a player: no spot taken, nobody sees them in.
    expect(x.confirmedCount).toBe(3);
    expect(x.waitlistCount).toBe(0);
    const g = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data;
    const seen = g.sessions.find((y: any) => y.id === s.id);
    expect(seen.confirmed.map((c: any) => c.name)).toEqual(['Blair', 'Casey', 'Devon']);
    expect(seen.openSpots).toBe(1);

    // Joining later keeps "Court paid"; dropping again keeps it too (the court is still owed to the venue).
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true })).data.result).toBe('confirmed');
    x = await session(ctx, s.id);
    expect(x.court.paid).toBe(true);
    expect([x.paidCount, x.payableCount]).toEqual([0, 3]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: false });
    expect((await session(ctx, s.id)).court.paid).toBe(true);
    expect(refundRows(await session(ctx, s.id))).toEqual([]);

    expect((await markCourt(ctx, s.id, false)).status).toBe(200);
    expect((await session(ctx, s.id)).court.paid).toBe(false);
  });

  it('a booked court with nobody signed up still shows what you owe the venue', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    expect((await session(ctx, s.id)).court).toMatchObject({ costCents: 4800, playersCoverCents: 0, yourShareCents: 4800, covered: false });
    // An unbooked game with nobody in has no court to pay for.
    const t = await on(ctx, '2026-11-05');
    expect((await session(ctx, t.id)).court).toBeNull();
  });
});

describe('a canceled game', () => {
  it('has no court row, no court cost in the month, and your court mark cannot be added', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, ['Blair']);
    await markCourt(ctx, s.id, true);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    const x = await session(ctx, s.id);
    expect(x.court).toBeNull();
    expect([x.paidCount, x.payableCount]).toEqual([0, 0]);
    // Blair is owed a refund; you are not on the Pay back list.
    expect(refundRows(x).map((r: any) => r.name)).toEqual(['Blair']);
    expect((await markCourt(ctx, s.id, true)).status).toBe(409); // a canceled game has no court to pay
    const t = await on(ctx, '2026-11-05');
    await join(ctx, t.id, ['Blair', 'Casey']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${t.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await markCourt(ctx, t.id, true)).status).toBe(409);
    ctx.app.now = Date.parse(s.endsAt) + 2 * DAY;
    const m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ collectedCents: 0, courtCostCents: 0, netCents: 0 });
    expect(m.sessions.find((y: any) => y.id === s.id)).toMatchObject({ state: 'canceled', collectedCents: 0, courtCostCents: 0 });
  });
});

describe('every number agrees', () => {
  it('monthly summary, per-session lists, Who paid headers and the Players tab tell one story', async () => {
    const ctx = await organizerGroup();
    const a = await on(ctx, '2026-11-03'); // you + 3 others
    const b = await on(ctx, '2026-11-05'); // 2 others, you are out
    const c = await on(ctx, '2026-11-10'); // you + 1 other
    await join(ctx, a.id, [ME, 'Blair', 'Casey', 'Devon']);
    await join(ctx, b.id, ['Blair', 'Emery']);
    await join(ctx, c.id, [ME, 'Frankie']);
    for (const s of [a, b, c]) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${c.id}/booked`, { courtCostCents: 4000 });
    await pay(ctx, a.id, ['Blair', 'Casey']); // Devon still owes
    await pay(ctx, b.id, ['Blair', 'Emery']);
    await markCourt(ctx, a.id, true);
    await markCourt(ctx, b.id, true);
    await markCourt(ctx, c.id, true); // your "paid" mark must never turn into collected money

    ctx.app.now = Date.parse('2026-11-30T17:00:00.000Z');
    await ctx.organizer.call('POST', '/api/admin/login', { pin: (await import('./harness')).PIN });
    const d = await dash(ctx);
    const m = await money(ctx, '2026-11');

    const rows = d.sessions.filter((s: any) => [a.id, b.id, c.id].includes(s.id));
    const othersPaid = (s: any) => s.roster.filter((r: any) => !r.isOrganizer && r.paymentStatus === 'paid').reduce((n: number, r: any) => n + r.paymentAmountCents, 0);
    const collected = rows.reduce((n: number, s: any) => n + othersPaid(s), 0);
    const courts = rows.reduce((n: number, s: any) => n + s.court.costCents, 0);
    expect(collected).toBe(2800 + 2800); // A: Blair + Casey, B: Blair + Emery. Not C, not you.
    expect(m.collectedCents).toBe(collected);
    expect(m.courtCostCents).toBe(courts);
    expect(m.courtCostCents).toBe(4800 + 4800 + 4000);
    expect(m.netCents).toBe(collected - courts);
    expect(m).toMatchObject({ surplusCents: 0, coveredCents: courts - collected });
    for (const s of rows) {
      const line = m.sessions.find((y: any) => y.id === s.id);
      expect(line.collectedCents).toBe(othersPaid(s));
      expect(line.courtCostCents).toBe(s.court.costCents);
    }
    // Who paid headers: other players only.
    const a2 = rows.find((s: any) => s.id === a.id);
    const b2 = rows.find((s: any) => s.id === b.id);
    const c2 = rows.find((s: any) => s.id === c.id);
    expect([a2.paidCount, a2.payableCount]).toEqual([2, 3]);
    expect([b2.paidCount, b2.payableCount]).toEqual([2, 2]);
    expect([c2.paidCount, c2.payableCount]).toEqual([0, 1]);
    // Players tab: only real money owed by other players, and none for you.
    expect(balanceOf(d, ctx.byName[ME])).toEqual({ owedCents: 0, creditCents: 0 });
    const owedAll = d.players.reduce((n: number, p: any) => n + balanceOf(d, p.id).owedCents, 0);
    const unpaidOthers = rows.flatMap((s: any) => s.roster.filter((r: any) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid')).length * 1400;
    expect(owedAll).toBe(unpaidOthers);
    expect(unpaidOthers).toBe(2800); // Devon (A) and Frankie (C)
  });
});

describe('none of this reaches a player', () => {
  it('player screens, View as you, the calendar and texts never show court costs, shares or court words', async () => {
    const ctx = await organizerGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', {
      name: 'Dinks',
      organizerName: ME,
      settings: { ...(await dash(ctx)).group.settings, typicalCourtCostCents: 4321 },
    });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, { courtCostCents: 4567 });
    await markCourt(ctx, s.id, true);
    ctx.app.now = Date.parse(s.startsAt) - 10 * 3600_000; // game day: pay cards are up

    const phones = await Promise.all(PLAYER_NAMES.map((n) => playerPhone(ctx, n)));
    const bodies = [
      ...(await Promise.all(phones.map(async (p) => (await p.call('GET', '/api/group')).text))),
      (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[ME] })).text,
      (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair })).text,
      (await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`)).text,
      (await ctx.app.client().call('GET', '/api/status')).text,
    ];
    for (const t of bodies) {
      expect(t).not.toMatch(/4321|4567|43\.21|45\.67|4800|48\.00|courtCost|court cost|You pay|Court due|Court paid|Players cover|your share|yourShare|playersCover|isOrganizer|"court"/i);
    }
    // And the organizer-only screen does carry it (so the check above means something).
    expect(JSON.stringify(await session(ctx, s.id))).toMatch(/4567/);
  });

  it('your own player screen and View as you: no Pay, no pay card, no $14, no credit', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-12');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    ctx.app.now = Date.parse(s.startsAt) - 10 * 3600_000; // after 8 AM on game day
    const mine = await playerPhone(ctx, ME);
    for (const g of [(await mine.call('GET', '/api/group')).data, (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[ME] })).data]) {
      expect(g.owed).toEqual([]);
      expect(g.payDue).toEqual([]);
      expect(g.creditBalanceCents).toBe(0);
      const m = g.sessions.find((y: any) => y.id === s.id).mine;
      expect(m).toMatchObject({ status: 'confirmed', shareCents: null, oweCents: 0, creditCents: 0, creditComing: false, discount: false, paymentStatus: 'not_applicable', selfPaid: false });
    }
    // They cannot mark themselves paid either.
    const res = await mine.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    expect(res.status).toBe(409);
    expect((await session(ctx, s.id)).court.paid).toBe(false);
    // Everyone else sees exactly what they always did.
    const blair = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data;
    expect(blair.payDue).toHaveLength(1);
    expect(blair.payDue[0].amountCents).toBe(1400);
    expect(blair.sessions.find((y: any) => y.id === s.id).mine).toMatchObject({ shareCents: 1400, oweCents: 1400, creditComing: true });
    const frankie = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data;
    expect(frankie.payDue[0].amountCents).toBe(900);
  });

  it('other players can still pay, mark "I paid", and get credits exactly as before', async () => {
    const ctx = await organizerGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: true })).status).toBe(200);
    expect((await session(ctx, s.id)).roster.find((r: any) => r.name === 'Blair')).toMatchObject({ paymentStatus: 'paid', selfPaid: true, paymentAmountCents: 1400 });
    expect((await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: false })).status).toBe(200);
    expect((await session(ctx, s.id)).roster.find((r: any) => r.name === 'Blair')).toMatchObject({ paymentStatus: 'unpaid' });
  });
});
