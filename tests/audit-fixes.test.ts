import { describe, expect, it } from 'vitest';
import { HOUR, SETUP_TOKEN, firstSession, playerPhone, setupGroup } from './harness';

// Fixes from the pre-launch audit (docs/AUDIT.md).

describe('audit fixes', () => {
  it('a broken %-escape in an address is "Not found", not a server error', async () => {
    const ctx = await setupGroup();
    const res = await ctx.app.client().call('GET', '/api/sessions/%E0/calendar.ics');
    expect(res.status).toBe(404);
  });

  it('once set up, setup answers the same whatever code is typed, and says it is off', async () => {
    const ctx = await setupGroup();
    const c = ctx.app.client();
    const wrong = await c.call('POST', '/api/setup', { setupToken: 'x'.repeat(30) });
    const right = await c.call('POST', '/api/setup', { setupToken: SETUP_TOKEN });
    expect(wrong.status).toBe(409);
    expect(right.status).toBe(409);
    expect((await c.call('GET', '/api/status')).data.setupEnabled).toBe(false);
  });

  it('3 new names per phone per hour holds even when many arrive at the same moment', async () => {
    const ctx = await setupGroup();
    const names = ['Zed One', 'Quin Two', 'Rory Three', 'Sage Four', 'Toby Five', 'Uma Six', 'Vic Seven', 'Wren Eight'];
    const res = await Promise.all(
      names.map((name) => ctx.app.client().call('POST', '/api/players/self', { name, confirmNew: true }, { 'X-Group-Key': ctx.groupKey })),
    );
    expect(res.filter((r) => r.status === 200).length).toBeLessThanOrEqual(3);
    // A refused burst doesn't use up the hour: one at a time still gets 3.
    let ok = res.filter((r) => r.status === 200).length;
    for (const name of ['Ann Nine', 'Bo Ten', 'Cy Eleven', 'Di Twelve']) {
      const r = await ctx.app.client().call('POST', '/api/players/self', { name, confirmNew: true }, { 'X-Group-Key': ctx.groupKey });
      if (r.status === 200) ok++;
    }
    expect(ok).toBe(3);
  });

  it('a name with a duplicate is refused without using up a slot', async () => {
    const ctx = await setupGroup();
    const add = (name: string) => ctx.app.client().call('POST', '/api/players/self', { name, confirmNew: true }, { 'X-Group-Key': ctx.groupKey });
    expect((await add('Blair')).status).toBe(409);
    expect((await add('Blair')).status).toBe(409);
    for (const n of ['New One', 'New Two', 'New Three']) expect((await add(n)).status).toBe(200);
  });

  it('refuses invisible characters that flip or hide text in a name, but keeps emoji and accents', async () => {
    const ctx = await setupGroup();
    let ip = 0;
    const add = (name: string) =>
      ctx.app.client().call('POST', '/api/players/self', { name, confirmNew: true }, { 'X-Group-Key': ctx.groupKey, 'CF-Connecting-IP': `10.0.0.${ip++}` });
    for (const bad of ['\u202eRyan', 'Ry\u200ban', '\u2066Alex\u2069', 'B\ufeffo']) expect((await add(bad)).status).toBe(400);
    for (const good of ['Zo\u00eb O\u2019Brien', '\u{1F3D3} Sam', 'Pat \u{1F468}\u200d\u{1F469}\u200d\u{1F467}']) expect((await add(good)).status).toBe(200);
  });

  it('a credit used on a payment comes back when that payment is refunded, and goes again if the refund is undone', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = {};
    for (const n of names) {
      phones[n] = await playerPhone(ctx, n);
      await phones[n].call('POST', `/api/sessions/${s.id}/join`, {});
    }
    ctx.app.advance(Date.parse(s.endsAt) - ctx.app.now + HOUR);
    const credit = async () => {
      const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
      return d.credits.find((c: { name: string }) => c.name === 'Alex')?.balanceCents ?? 0;
    };
    expect(await credit()).toBe(500);
    const next = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: { startsAt: string }) => Date.parse(x.startsAt) > ctx.app.now);
    await phones.Alex.call('POST', `/api/sessions/${next.id}/join`, {});
    await phones.Alex.call('POST', `/api/sessions/${next.id}/paid`, { paid: true });
    expect(await credit()).toBe(0);
    await phones.Alex.call('POST', `/api/sessions/${next.id}/withdraw`, {});
    const refund = (refunded: boolean) => ctx.organizer.call('POST', `/api/admin/sessions/${next.id}/refund`, { playerId: ctx.byName.Alex, refunded });
    expect((await refund(true)).status).toBe(200);
    expect(await credit()).toBe(500);
    expect((await refund(false)).status).toBe(200);
    expect(await credit()).toBe(0);
    expect((await refund(true)).status).toBe(200);
    expect(await credit()).toBe(500);
  });

  it('rejoining after a refund owes again instead of showing as paid', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/refund`, { playerId: ctx.byName.Blair, refunded: true });
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const mine = (await blair.call('GET', '/api/group')).data.sessions.find((x: { id: string }) => x.id === s.id).mine;
    expect(mine.paymentStatus).toBe('unpaid');
    expect(mine.oweCents).toBe(1400);
    // Without a refund, a payment still survives I'm out then I'm in.
    const casey = await playerPhone(ctx, 'Casey');
    await casey.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true });
    await casey.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await casey.call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await casey.call('GET', '/api/group')).data.sessions.find((x: { id: string }) => x.id === s.id).mine.paymentStatus).toBe('paid');
  });
});
