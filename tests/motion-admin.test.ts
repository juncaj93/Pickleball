// The MOTION_ADMIN switch: visual only. It decides whether the organizer screens animate; it never changes what is
// saved, charged or said. It is separate from MOTION (the player screens), which is already on for everyone, so the
// organizer motion stays dark until its own var says "on" (or a phone uses the private test header).

import { describe, expect, it } from 'vitest';
import { motionAdminOnForAll, MOTION_ADMIN_HEADER, MOTION_HEADER } from '../shared/motion';
import { setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  return setupGroup(app);
}

const motionOf = async (ctx: Awaited<ReturnType<typeof world>>, headers?: Record<string, string>) =>
  (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data.motion;

describe('MOTION_ADMIN switch', () => {
  it('reads the var: only "on" switches it on (any case, spaces ignored)', () => {
    expect(motionAdminOnForAll('on')).toBe(true);
    expect(motionAdminOnForAll(' ON ')).toBe(true);
    expect(motionAdminOnForAll('off')).toBe(false);
    expect(motionAdminOnForAll('')).toBe(false);
    expect(motionAdminOnForAll(undefined)).toBe(false);
    expect(motionAdminOnForAll('yes')).toBe(false);
  });

  it('is dark by default (no var, or "off") for the organizer', async () => {
    expect(await motionOf(await world())).toBe(false);
    const off = await world({ MOTION_ADMIN: 'off' });
    expect(await motionOf(off)).toBe(false);
    expect(await motionOf(off, { [MOTION_ADMIN_HEADER]: 'off' })).toBe(false);
    expect(await motionOf(off, { [MOTION_ADMIN_HEADER]: 'yes' })).toBe(false);
  });

  it('the player MOTION being on does not switch the organizer motion on (they are separate switches)', async () => {
    const both = await world({ MOTION: 'on', MOTION_ADMIN: 'off' });
    expect(await motionOf(both)).toBe(false);
    // And the player header alone does nothing here either.
    expect(await motionOf(both, { [MOTION_HEADER]: 'on' })).toBe(false);
  });

  it('the private test header turns it on for that request only', async () => {
    const ctx = await world({ MOTION_ADMIN: 'off' });
    expect(await motionOf(ctx, { [MOTION_ADMIN_HEADER]: 'on' })).toBe(true);
    expect(await motionOf(ctx, { [MOTION_ADMIN_HEADER]: 'ON' })).toBe(true);
    expect(await motionOf(ctx)).toBe(false);
  });

  it('MOTION_ADMIN=on switches it on for the organizer', async () => {
    expect(await motionOf(await world({ MOTION_ADMIN: 'on' }))).toBe(true);
  });

  it('changes nothing else in the answer: with it on or off the dashboard data is identical', async () => {
    const ctx = await world({ MOTION_ADMIN: 'off' });
    const off = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const on = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, { [MOTION_ADMIN_HEADER]: 'on' })).data;
    const { motion: m1, ...restOff } = off;
    const { motion: m2, ...restOn } = on;
    expect([m1, m2]).toEqual([false, true]);
    expect(restOn).toEqual(restOff);
  });

  it('saves nothing different: a court change with the switch on does exactly what it does with it off', async () => {
    const results: string[] = [];
    for (const header of [{} as Record<string, string>, { [MOTION_ADMIN_HEADER]: 'on' }]) {
      const ctx = await world({ MOTION_ADMIN: 'off' });
      const dash = await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, header);
      const s = dash.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now);
      const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' }, header);
      const after = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, header)).data.sessions.find((x: any) => x.id === s.id);
      results.push(JSON.stringify({ ok: res.status, court: after.courtState, booking: after.bookingStatus }));
    }
    expect(results[0]).toBe(results[1]);
  });
});
