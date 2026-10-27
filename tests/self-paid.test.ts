import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { balanceOf } from '../src/pages/admin/todo';
import { formatShortDate } from '../shared/time';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const entry = (d: any, sid: string, name: string) => d.sessions.find((x: any) => x.id === sid).roster.find((r: any) => r.name === name);
const lines = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => activityText(e, TZ, 'Robin'));

describe('players mark themselves paid', () => {
  it('"I paid" marks paid with a self-marked flag; "Didn\'t pay?" undoes it; both are logged', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const day = formatShortDate(s.startsAt, TZ);
    const ryan = await playerPhone(ctx, 'Alex');
    await ryan.call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    expect((await ryan.call('POST', `/api/sessions/${s.id}/paid`, { paid: true })).status).toBe(200);
    let d = await dash(ctx);
    expect(entry(d, s.id, 'Alex')).toMatchObject({ paymentStatus: 'paid', selfPaid: true, paymentAmountCents: 1400 });
    const g = (await ryan.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ paymentStatus: 'paid', selfPaid: true });
    expect(g.payDue).toHaveLength(0); // the game-day card goes away
    expect((await lines(ctx))[0]).toBe(`Alex marked their payment paid for ${day}`);
    expect((await ryan.call('POST', `/api/sessions/${s.id}/paid`, { paid: false })).status).toBe(200);
    d = await dash(ctx);
    expect(entry(d, s.id, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', selfPaid: false });
    expect((await lines(ctx))[0]).toBe(`Alex unmarked their payment for ${day}`);
  });

  it("the organizer's own Mark paid has no tag, can confirm a self-marked one, and players can't undo it", async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const blair = await playerPhone(ctx, 'Blair');
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    expect(entry(await dash(ctx), s.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', selfPaid: false });
    const undo = await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: false });
    expect(undo.status).toBe(409);
    await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    expect(entry(await dash(ctx), s.id, 'Alex')).toMatchObject({ paymentStatus: 'paid', selfPaid: false });
    // The organizer can always unmark.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: false });
    expect(entry(await dash(ctx), s.id, 'Alex').paymentStatus).toBe('unpaid');
  });

  it('only for your own seat in a session you are in', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const casey = await playerPhone(ctx, 'Casey');
    expect((await casey.call('POST', `/api/sessions/${s.id}/paid`, { paid: true })).status).toBe(404);
    expect((await ctx.app.client().call('POST', `/api/sessions/${s.id}/paid`, { paid: true })).status).not.toBe(200);
  });
});

describe('Players tab numbers', () => {
  it('balance and played count for an owing player, a credit player, and a $0 player', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    // Six played: after it ends, the first four each have a $5 credit coming.
    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const d = await dash(ctx);
    const by = (n: string) => d.players.find((p: any) => p.name === n);
    expect(by('Alex').played).toBe(1);
    const alex = balanceOf(d, ctx.byName.Alex);
    expect(alex.owedCents).toBeGreaterThan(0);
    const blair = balanceOf(d, ctx.byName.Blair);
    expect(blair.owedCents).toBe(0);
    expect(blair.creditCents).toBe(500);
    // Someone who never played: $0, 0 played.
    const { id } = (await ctx.organizer.call('POST', '/api/admin/players', { name: 'Quinn' })).data;
    const d2 = await dash(ctx);
    expect(balanceOf(d2, id)).toEqual({ owedCents: 0, creditCents: 0 });
    expect(d2.players.find((p: any) => p.id === id).played).toBe(0);
  });
});
