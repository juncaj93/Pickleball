import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

async function fullSession() {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
    await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {});
  }
  return { ...ctx, s };
}

const tokenOf = (url: string) => url.split('/t/')[1];

describe('confirmation links', () => {
  it('creates one link per confirmed player who has not confirmed yet', async () => {
    const ctx = await fullSession();
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${ctx.s.id}/confirm`, {});
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'attendance' });
    expect(res.data.drafts.map((d: any) => d.name)).toEqual(['Blair', 'Casey', 'Devon']);
    expect(res.data.drafts[0].phone).toBe('(313) 555-0101');
    expect(new Set(res.data.drafts.map((d: any) => d.url)).size).toBe(3);
  });

  it('confirms and withdraws only the link owner', async () => {
    const ctx = await fullSession();
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'attendance' });
    const blair = tokenOf(res.data.drafts.find((d: any) => d.name === 'Blair').url);
    const anon = ctx.app.client();

    const look = await anon.call('POST', '/api/link', { token: blair });
    expect(look.data).toMatchObject({ scope: 'attendance', playerName: 'Blair', valid: true, myStatus: 'confirmed' });
    expect(JSON.stringify(look.data)).not.toMatch(/555|phone|venmo|payment/i);

    expect((await anon.call('POST', '/api/link/act', { token: blair, action: 'confirm' })).data.outcome).toBe('confirmed_attendance');
    expect((await anon.call('POST', '/api/link/act', { token: blair, action: 'withdraw' })).data.outcome).toBe('withdrawn');

    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s = dash.data.sessions.find((x: any) => x.id === ctx.s.id);
    expect(s.roster.find((r: any) => r.name === 'Blair').status).toBe('withdrawn');
    expect(s.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.name)).toEqual(['Alex', 'Casey', 'Devon']);
    expect(s.state.flags.openSpots).toBe(1);

    // Used links stop working.
    expect((await anon.call('POST', '/api/link/act', { token: blair, action: 'withdraw' })).status).toBe(410);
  });

  it('rejects expired, wrong-scope, and made-up links', async () => {
    const ctx = await fullSession();
    const att = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'attendance' });
    const alex = tokenOf(att.data.drafts[0].url);
    const anon = ctx.app.client();
    expect((await anon.call('POST', '/api/link/act', { token: alex, action: 'claim' })).status).toBe(403);
    expect((await anon.call('POST', '/api/link/act', { token: 'x'.repeat(43), action: 'confirm' })).status).toBe(404);
    expect((await anon.call('POST', '/api/link', { token: '../../etc' })).status).toBe(404);
    ctx.app.now = Date.parse(ctx.s.startsAt) + 1;
    const expired = await anon.call('POST', '/api/link/act', { token: alex, action: 'confirm' });
    expect(expired.status).toBe(410);
    expect(expired.data.message).toMatch(/expired/);
  });

  it('stops working when the session is canceled', async () => {
    const ctx = await fullSession();
    const att = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'attendance' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/decision`, { decision: 'cancel', confirm: true });
    const res = await ctx.app.client().call('POST', '/api/link/act', { token: tokenOf(att.data.drafts[0].url), action: 'confirm' });
    expect(res.status).toBe(410);
  });
});

describe('substitute invitations', () => {
  it('lists waitlisted players first and skips people who opted out', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Frankie']) {
      await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {});
    }
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Emery}`, {
      name: 'Emery',
      phone: null,
      canReceiveSubstituteInvites: false,
    });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'claim' });
    expect(res.data.drafts.map((d: any) => d.name)).toEqual(['Frankie', 'Blair']);
  });

  it('refuses to prepare invitations for a full session', async () => {
    const ctx = await fullSession();
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'claim' });
    expect(res.status).toBe(409);
  });

  it('tells later claimers the spot is gone', async () => {
    const ctx = await fullSession();
    await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${ctx.s.id}/withdraw`, {});
    const links = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/links`, { kind: 'claim' });
    const emery = tokenOf(links.data.drafts.find((d: any) => d.name === 'Emery').url);
    const frankie = tokenOf(links.data.drafts.find((d: any) => d.name === 'Frankie').url);
    const anon = ctx.app.client();
    expect((await anon.call('POST', '/api/link/act', { token: frankie, action: 'claim' })).data.outcome).toBe('claimed');
    const late = await anon.call('POST', '/api/link/act', { token: emery, action: 'claim' });
    expect(late.data.outcome).toBe('spot_taken');
    expect(late.data.view.session.openSpots).toBe(0);
  });
});

describe('payments', () => {
  async function booked(costCents: number) {
    const ctx = await fullSession();
    const res = await ctx.organizer.call('PUT', `/api/admin/sessions/${ctx.s.id}/booking`, {
      bookingStatus: 'booked',
      venueName: 'Rec Center',
      courtCostCents: costCents,
      cancellationDeadlineAt: new Date(Date.parse(ctx.s.startsAt) - 12 * HOUR).toISOString(),
    });
    expect(res.status).toBe(200);
    return ctx;
  }

  const sessionIn = async (ctx: any) =>
    (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === ctx.s.id);

  it('splits the cost four ways and the shares add up', async () => {
    const ctx = await booked(4501);
    const s = await sessionIn(ctx);
    const shares = s.roster.map((r: any) => r.shareCents);
    expect(shares).toEqual([1126, 1125, 1125, 1125]);
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(4501);
    expect(s.paidCount).toBe(0);
    expect(s.payableCount).toBe(4);
  });

  it('marks paid and unpaid for the right player and session only', async () => {
    const ctx = await booked(4800);
    const other = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions[1];
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${other.id}/join`, {});
    await ctx.organizer.call('PUT', `/api/admin/sessions/${other.id}/booking`, { bookingStatus: 'booked', courtCostCents: 4000 });

    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    let s = await sessionIn(ctx);
    expect(s.roster.find((r: any) => r.name === 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1200 });
    expect(s.roster.filter((r: any) => r.paymentStatus === 'paid')).toHaveLength(1);
    const otherNow = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === other.id);
    expect(otherNow.roster.find((r: any) => r.name === 'Blair').paymentStatus).toBe('unpaid');

    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Blair, paid: false });
    s = await sessionIn(ctx);
    expect(s.roster.find((r: any) => r.name === 'Blair').paymentStatus).toBe('unpaid');
    const log = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.audit.map((a: any) => a.action);
    expect(log).toEqual(expect.arrayContaining(['marked_paid', 'marked_unpaid']));
  });

  it('flags cost changes after payment without rewriting what was paid', async () => {
    const ctx = await booked(4800);
    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    await ctx.organizer.call('PUT', `/api/admin/sessions/${ctx.s.id}/booking`, {
      bookingStatus: 'booked',
      venueName: 'Rec Center',
      courtCostCents: 5200,
    });
    const s = await sessionIn(ctx);
    const alex = s.roster.find((r: any) => r.name === 'Alex');
    expect(alex).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1200, shareCents: 1300, paymentDifferenceCents: -100 });
    const costLog = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.audit.find((a: any) => a.action === 'booking_updated');
    expect(costLog.details.court_cost_cents).toEqual({ from: 4800, to: 5200 });
  });

  it('shows a player only their own payment, and opening Venmo changes nothing', async () => {
    const ctx = await booked(4800);
    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const casey = await playerPhone(ctx, 'Casey');
    const view = await casey.call('GET', '/api/group');
    const s = view.data.sessions.find((x: any) => x.id === ctx.s.id);
    expect(s.mine).toMatchObject({ shareCents: 1200, paymentStatus: 'unpaid' });
    const body = JSON.stringify(view.data);
    expect(body).not.toMatch(/"paid"/); // nobody else's status leaks
    expect(body).not.toMatch(/555-01/); // no phone numbers
    expect(view.data.group.venmoUrl).toBe('https://venmo.com/u/organizer');
    // The Venmo button is a plain link; there is no endpoint that marks anything paid from a player.
    expect((await casey.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Casey, paid: true })).status).toBe(401);
  });

  it('lists what a player still owes after the session', async () => {
    const ctx = await booked(4800);
    ctx.app.now = Date.parse(ctx.s.endsAt) + HOUR;
    const view = await (await playerPhone(ctx, 'Devon')).call('GET', '/api/group');
    expect(view.data.owed).toEqual([expect.objectContaining({ sessionId: ctx.s.id, amountCents: 1200 })]);
  });

  it('stops payment workflows for canceled sessions', async () => {
    const ctx = await booked(4800);
    await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/decision`, { decision: 'cancel', confirm: true });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${ctx.s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    expect(res.status).toBe(409);
    const s = await sessionIn(ctx);
    expect(s.payableCount).toBe(0);
    expect(s.state.label).toBe('canceled');
  });
});
