import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, playerPhone, setupGroup, withoutIds } from './harness';

// GET /api/group/version: the tiny "did anything change?" answer behind live updates.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const version = async (c: Awaited<ReturnType<typeof playerPhone>>) => {
  const r = await c.call('GET', '/api/group/version');
  expect(r.status).toBe(200);
  return r.data.v as string;
};

describe('live updates: the change stamp', () => {
  it('is tiny, opaque and not cached', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    const r = await alex.call('GET', '/api/group/version');
    expect(Object.keys(r.data)).toEqual(['v']);
    expect(r.data.v).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.text.length).toBeLessThan(40);
  });

  it('stays the same when nothing changed, and matches the full data', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    const a = await version(alex);
    expect(await version(alex)).toBe(a);
    const full = await alex.call('GET', '/api/group');
    expect(full.data.version).toBe(a);
  });

  it('changes for everyone when someone joins or drops', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const blair = await playerPhone(ctx, 'Blair');
    const before = await version(alex);
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const joined = await version(alex);
    expect(joined).not.toBe(before);
    expect(await version(blair)).not.toBe(before);
    await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    expect(await version(alex)).not.toBe(joined);
  });

  it('does not move when another player only pays or when the organizer marks them paid', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const before = await version(alex);
    await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    expect(await version(alex)).toBe(before);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    expect(await version(alex)).toBe(before);
    // But the payer's own screen does change.
    expect(await version(blair)).not.toBe(before);
  });

  it('changes for the player whose own payment changed', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const before = await version(blair);
    await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    expect(await version(blair)).not.toBe(before);
  });

  it('changes when the clock moves on (10-minute buckets) so "tonight" and game day show up', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    const a = await version(alex);
    ctx.app.advance(2 * HOUR);
    expect(await version(alex)).not.toBe(a);
  });

  it('needs the group link, like the full data', async () => {
    const ctx = await setupGroup();
    const stranger = ctx.app.client();
    stranger.groupKey = 'x'.repeat(30);
    expect((await stranger.call('GET', '/api/group/version')).status).toBe(404);
  });

  it('never contains names, money, phones or the link key', async () => {
    const ctx: Ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    const text = withoutIds((await alex.call('GET', '/api/group/version')).text);
    for (const bad of ['Alex', 'Blair', '555', 'venmo', ctx.groupKey, '$']) expect(text).not.toContain(bad);
  });
});
