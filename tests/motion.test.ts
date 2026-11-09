// The MOTION switch: visual only. It decides whether the player screens animate; it never changes what is saved,
// charged or said. Off for everyone until the MOTION var says "on"; a phone with the private test header (and the
// organizer's in-browser demo) can still see it.

import { describe, expect, it } from 'vitest';
import { motionOnForAll, MOTION_HEADER } from '../shared/motion';
import { playerPhone, setupGroup, TestApp } from './harness';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const ctx = await setupGroup(app);
  const phone = await playerPhone(ctx, 'Blair');
  return { ctx, phone };
}

describe('MOTION switch', () => {
  it('reads the var: only "on" switches it on for everyone (any case, spaces ignored)', () => {
    expect(motionOnForAll('on')).toBe(true);
    expect(motionOnForAll(' ON ')).toBe(true);
    expect(motionOnForAll('off')).toBe(false);
    expect(motionOnForAll('')).toBe(false);
    expect(motionOnForAll(undefined)).toBe(false);
    expect(motionOnForAll(null)).toBe(false);
    expect(motionOnForAll('yes')).toBe(false);
  });

  it('is dark by default (no var, or "off"), for a player with no test header', async () => {
    const a = await world();
    expect((await a.phone.call('GET', '/api/group')).data.motion).toBe(false);
    const b = await world({ MOTION: 'off' });
    expect((await b.phone.call('GET', '/api/group')).data.motion).toBe(false);
    // The wrong value in the header does nothing.
    expect((await b.phone.call('GET', '/api/group', undefined, { [MOTION_HEADER]: 'off' })).data.motion).toBe(false);
    expect((await b.phone.call('GET', '/api/group', undefined, { [MOTION_HEADER]: 'yes' })).data.motion).toBe(false);
  });

  it('the private test header turns it on for that request only', async () => {
    const { phone } = await world({ MOTION: 'off' });
    expect((await phone.call('GET', '/api/group', undefined, { [MOTION_HEADER]: 'on' })).data.motion).toBe(true);
    expect((await phone.call('GET', '/api/group', undefined, { [MOTION_HEADER]: 'ON' })).data.motion).toBe(true);
    expect((await phone.call('GET', '/api/group')).data.motion).toBe(false);
  });

  it('MOTION=on switches it on for everyone', async () => {
    const { phone } = await world({ MOTION: 'on' });
    expect((await phone.call('GET', '/api/group')).data.motion).toBe(true);
  });

  it('the sandbox (the organizer\'s View as demo) follows the same rule as the live site (Zip 18: it no longer always has it)', async () => {
    const { phone, ctx } = await world();
    (ctx.app.env as any).SANDBOX = true;
    expect((await phone.call('GET', '/api/group')).data.motion).toBe(false);
    (ctx.app.env as any).MOTION = 'on';
    expect((await phone.call('GET', '/api/group')).data.motion).toBe(true);
  });

  it('changes nothing else in the answer: with it on or off the screen data is identical', async () => {
    const { phone } = await world({ MOTION: 'off' });
    const off = (await phone.call('GET', '/api/group')).data;
    const on = (await phone.call('GET', '/api/group', undefined, { [MOTION_HEADER]: 'on' })).data;
    const { motion: m1, ...restOff } = off;
    const { motion: m2, ...restOn } = on;
    expect([m1, m2]).toEqual([false, true]);
    expect(restOn).toEqual(restOff);
  });

  it('saves nothing: I\'m in with the switch on moves money and seats exactly as with it off', async () => {
    const results: string[] = [];
    for (const header of [{} as Record<string, string>, { [MOTION_HEADER]: 'on' }]) {
      const { ctx, phone } = await world({ MOTION: 'off' });
      const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
      const s = dash.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now);
      await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
      const joined = await phone.call('POST', `/api/sessions/${s.id}/join`, {}, header);
      const g = (await phone.call('GET', '/api/group', undefined, header)).data;
      const mine = g.sessions.find((x: any) => x.id === s.id).mine;
      results.push(JSON.stringify({ result: joined.data.result, owe: mine.oweCents, status: mine.status, credit: g.credit.balanceCents }));
    }
    expect(results[0]).toBe(results[1]);
  });
});
