import { describe, expect, it } from 'vitest';
import { firstSession, playerPhone, setupGroup } from './harness';

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
  it('invites regulars first and skips people who opted out', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey']) {
      await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {});
    }
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Emery}`, {
      name: 'Emery',
      phone: null,
      canReceiveSubstituteInvites: false,
    });
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Devon}`, { name: 'Devon', isRegular: false });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'claim' });
    expect(res.data.drafts.map((d: any) => d.name)).toEqual(['Blair', 'Frankie', 'Devon']);
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
