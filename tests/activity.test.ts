import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import type { ActivityEntry } from '../shared/api';
import { formatDateTime } from '../shared/time';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function activity(ctx: Ctx, before?: string): Promise<{ entries: ActivityEntry[]; more: boolean }> {
  return (await ctx.organizer.call('GET', `/api/admin/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`)).data;
}
const lines = async (ctx: Ctx, organizer = 'Robin') => (await activity(ctx)).entries.map((e) => activityText(e, TZ, organizer));

describe('History > Activity', () => {
  it('records what players do, under their own names, newest first', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const day = new Date(s.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.advance(60_000);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.advance(60_000);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const got = await lines(ctx);
    expect(got[0]).toBe(`Blair dropped out of ${day}`);
    expect(got[1]).toBe(`Blair said I'm in for ${day}`);
    expect(got[2]).toBe(`Alex said I'm in for ${day}`);
    const top = (await activity(ctx)).entries[0];
    expect(top.actorLabel).toBe('Blair');
    expect(top.sessionStartsAt).toBe(s.startsAt);
  });

  it('marks a late drop, and logs the organizer by name', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const day = new Date(s.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
    const devon = await playerPhone(ctx, 'Devon');
    await devon.call('POST', `/api/sessions/${s.id}/join`, {});
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR;
    await devon.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const got = await lines(ctx);
    expect(got[0]).toBe(`Robin booked ${day}`);
    expect(got[1]).toBe(`Robin marked Alex paid for ${day}`);
    expect(got[2]).toBe(`Devon dropped out of ${day} (late drop)`);
    // With no organizer name saved, it says "Organizer".
    expect((await activity(ctx)).entries.map((e) => activityText(e, TZ, 'Organizer'))[0]).toBe(`Organizer booked ${day}`);
  });

  it('"View as" taps change nothing, so nothing is logged', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const before = await lines(ctx);
    expect((await ctx.organizer.call('POST', `/api/sessions/${s.id}/join`, {}, { 'X-View-As': ctx.byName.Casey })).status).toBe(403);
    expect(await lines(ctx)).toEqual(before);
  });

  it('shows the time in Eastern with AM/PM', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.now = Date.parse('2026-10-27T13:05:00.000Z'); // 9:05 AM EDT
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    const e = (await activity(ctx)).entries[0];
    expect(formatDateTime(e.createdAt, TZ)).toBe('Tue, Oct 27, 9:05 AM');
  });

  it('is organizer only and comes in pages', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('GET', '/api/admin/activity')).status).toBe(401);
    expect((await ctx.app.client().call('GET', '/api/admin/activity')).status).toBe(401);
    const s = await firstSession(ctx);
    for (let i = 0; i < 45; i++) {
      ctx.app.advance(1000);
      await alex.call('POST', `/api/sessions/${s.id}/${i % 2 ? 'withdraw' : 'join'}`, {});
    }
    for (let i = 0; i < 45; i++) {
      ctx.app.advance(1000);
      await alex.call('POST', `/api/sessions/${s.id}/${i % 2 ? 'withdraw' : 'join'}`, {});
    }
    const first = await activity(ctx);
    expect(first.entries).toHaveLength(80);
    expect(first.more).toBe(true);
    const next = await activity(ctx, first.entries[79].createdAt);
    expect(next.entries.length).toBeGreaterThan(0);
    expect(next.entries.every((e) => e.createdAt < first.entries[79].createdAt)).toBe(true);
  });

  it('never shows up for players', async () => {
    const ctx = await setupGroup();
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).text;
    expect(g).not.toMatch(/activity|audit|actorLabel/i);
  });
});
