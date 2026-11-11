// Zip 35 Part B: the fast-tap guard's rule (shared/tapGuard.ts), with the switch OFF (today) and ON.
import { describe, expect, it } from 'vitest';
import { dropThisTap, tapGuardFixAllowed, TAP_GUARD_FIX, type TapFacts } from '../shared/tapGuard';

const base: TapFacts = { fix: false, hasPrev: true, same: false, close: true, prevGoneOrMoved: false, textField: false };
const off = (o: Partial<TapFacts> = {}) => dropThisTap({ ...base, ...o });
const on = (o: Partial<TapFacts> = {}) => dropThisTap({ ...base, fix: true, ...o });

describe('switch OFF: exactly today\'s rule (drop a close tap on ANOTHER button, never on the same one)', () => {
  it('every combination, against the old line `prev && !same && now - prev.at < 400 && distance < 24`', () => {
    for (const hasPrev of [false, true])
      for (const same of [false, true])
        for (const close of [false, true])
          for (const prevGoneOrMoved of [false, true])
            for (const textField of [false, true]) {
              const old = hasPrev && !same && close;
              expect(off({ hasPrev, same, close, prevGoneOrMoved, textField })).toBe(old);
            }
  });
});

describe('switch ON', () => {
  it('the same button twice, fast: the second is dropped', () => {
    expect(on({ same: true })).toBe(true);
  });
  it('two buttons side by side, both still in place: both work (Hide from list, then Hide it)', () => {
    expect(on({ same: false, prevGoneOrMoved: false })).toBe(false);
  });
  it('another button after the first one was replaced or slid away (a double tap on I paid or Mark paid): dropped', () => {
    expect(on({ same: false, prevGoneOrMoved: true })).toBe(true);
  });
  it('a tap after the window (slow, or far away) is never dropped', () => {
    expect(on({ same: true, close: false })).toBe(false);
    expect(on({ same: false, close: false, prevGoneOrMoved: true })).toBe(false);
  });
  it('the first tap is never dropped', () => {
    expect(on({ hasPrev: false, same: true })).toBe(false);
  });
  it('a text box is never a tap to drop (double-clicking a word)', () => {
    expect(on({ same: true, textField: true })).toBe(false);
  });
});

describe('the switch', () => {
  it('kill switch: allowed unless "off"', () => {
    expect(tapGuardFixAllowed(undefined)).toBe(true);
    expect(tapGuardFixAllowed('on')).toBe(true);
    expect(tapGuardFixAllowed(' OFF ')).toBe(false);
  });
  it('names', () => {
    expect(TAP_GUARD_FIX).toMatchObject({ task: 'tap_guard_fix_on', link: 'tapguard', name: 'Tap guard fix' });
  });
});

// ---------- the switch on the server (answers on both screens) ----------
import { playerPhone, setupGroup, TestApp } from './harness';

describe('Tap guard fix: the switch', () => {
  const stripped = (data: any) => JSON.stringify(data, (k, v) => (k === 'tapGuardFix' || k === 'tapGuardFixForAll' ? undefined : v));
  const player = async (w: Awaited<ReturnType<typeof setupGroup>>, headers: Record<string, string> = {}) => {
    const p = await playerPhone(w, 'Blair');
    return (await p.call('GET', '/api/group', undefined, headers)).data;
  };
  const dash = async (w: Awaited<ReturnType<typeof setupGroup>>, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;

  it('ships OFF: no flag on the player screen or the organizer screen', async () => {
    const w = await setupGroup(new TestApp());
    expect((await player(w)).tapGuardFix).toBeUndefined();
    const d = await dash(w);
    expect(d.tapGuardFix).toBeUndefined();
    expect(d.tapGuardFixForAll).toBeUndefined();
  });
  it('the Settings row turns it on for every phone, writes one History line, and off again', async () => {
    const w = await setupGroup(new TestApp());
    expect((await w.organizer.call('PUT', '/api/admin/tap-guard-switch', { on: true })).status).toBe(200);
    expect((await player(w)).tapGuardFix).toBe(true);
    const d = await dash(w);
    expect(d.tapGuardFix).toBe(true);
    expect(d.tapGuardFixForAll).toBe(true);
    const log = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'tap_guard_fix_on');
    expect(log).toBeTruthy();
    expect((await w.organizer.call('PUT', '/api/admin/tap-guard-switch', { on: false })).status).toBe(200);
    expect((await player(w)).tapGuardFix).toBeUndefined();
    expect((await dash(w)).tapGuardFixForAll).toBeUndefined();
  });
  it('the private link (header) turns it on for one phone only; the Settings row stays off', async () => {
    const w = await setupGroup(new TestApp());
    const h = { [TAP_GUARD_FIX.header]: 'on' };
    expect((await player(w, h)).tapGuardFix).toBe(true);
    expect((await dash(w, h)).tapGuardFix).toBe(true);
    expect((await dash(w, h)).tapGuardFixForAll).toBeUndefined();
    expect((await player(w)).tapGuardFix).toBeUndefined();
  });
  it('the kill switch (TAP_GUARD_FIX = off) beats both the row and the link', async () => {
    const w = await setupGroup(new TestApp());
    await w.organizer.call('PUT', '/api/admin/tap-guard-switch', { on: true });
    (w.app.env as unknown as Record<string, unknown>).TAP_GUARD_FIX = 'off';
    expect((await player(w, { [TAP_GUARD_FIX.header]: 'on' })).tapGuardFix).toBeUndefined();
    expect((await dash(w)).tapGuardFix).toBeUndefined();
    expect((await dash(w)).tapGuardFixForAll).toBe(true); // the row itself still shows, so it can be turned off
  });
  it('only an organizer can flip it', async () => {
    const w = await setupGroup(new TestApp());
    const p = await playerPhone(w, 'Blair');
    expect((await p.call('PUT', '/api/admin/tap-guard-switch', { on: true })).status).toBe(401);
  });
  it('on or off, every other part of both answers is the same', async () => {
    const w = await setupGroup(new TestApp());
    const offP = stripped(await player(w));
    const offD = stripped(await dash(w));
    await w.organizer.call('PUT', '/api/admin/tap-guard-switch', { on: true });
    expect(stripped(await player(w))).toBe(offP);
    // The dashboard carries the activity list (one more line), so compare the parts that do not.
    const onD = JSON.parse(stripped(await dash(w)));
    const offDo = JSON.parse(offD);
    for (const k of Object.keys(offDo)) if (!['activity', 'recentActivity', 'updatedAt', 'stamp', 'audit', 'version'].includes(k)) expect(onD[k], k).toEqual(offDo[k]);
  });
});
