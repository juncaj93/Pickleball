// Zip 50 (Audit C F-5): Change PIN has its own wrong-guess limit on a phone that is already signed in: 5 wrong current PINs, then a
// 15-minute wait. It must NEVER lock the organizer out of signing in or out of the organizer screens.
import { describe, expect, it } from 'vitest';
import { PIN, setupGroup } from './harness';

const MIN = 60_000;
const WRONG = '111111';
const NEW_PIN = '135790';
const change = (c: { call: (m: string, p: string, b?: unknown) => Promise<{ status: number; data: any; text: string }> }, currentPin: string, newPin = NEW_PIN) =>
  c.call('POST', '/api/admin/pin', { currentPin, newPin });

describe('Zip 50: Change PIN wrong-guess limit', () => {
  it('guesses 1 to 5 are checked (wrong = 401); the 6th is refused with a wait (429) even with the RIGHT PIN, and the PIN stays the same', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 5; i++) {
      const r = await change(ctx.organizer, WRONG);
      expect(r.status, `guess ${i}`).toBe(401);
      expect(r.data.error?.message ?? r.text).toContain('Current PIN is not right');
    }
    const sixth = await change(ctx.organizer, PIN);
    expect(sixth.status).toBe(429);
    expect(sixth.text).toContain('Wait 15 minutes');
    // Nothing changed: the old PIN still signs in, the new one does not.
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: NEW_PIN })).status).toBe(401);
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  });

  it('a right PIN on guess 5 still works (only 4 were wrong)', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 4; i++) expect((await change(ctx.organizer, WRONG)).status).toBe(401);
    expect((await change(ctx.organizer, PIN)).status).toBe(200);
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: NEW_PIN })).status).toBe(200);
  });

  it('while waiting, tries do not make the wait longer, and the wait ends after 15 minutes', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 5; i++) expect((await change(ctx.organizer, WRONG)).status).toBe(401);
    ctx.app.advance(5 * MIN);
    expect((await change(ctx.organizer, WRONG)).status).toBe(429);
    ctx.app.advance(9 * MIN);
    expect((await change(ctx.organizer, PIN)).status).toBe(429); // 14 minutes: still waiting
    ctx.app.advance(MIN + 1000);
    // 15 minutes after the 5th wrong guess: the wait is over and the right PIN works.
    const ok = await change(ctx.organizer, PIN);
    expect(ok.status, ok.text).toBe(200);
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: NEW_PIN })).status).toBe(200);
  });

  it('after the wait, the count starts over: 5 more wrong guesses are checked before the next wait', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 5; i++) await change(ctx.organizer, WRONG);
    expect((await change(ctx.organizer, WRONG)).status).toBe(429);
    ctx.app.advance(16 * MIN);
    for (let i = 1; i <= 5; i++) expect((await change(ctx.organizer, WRONG)).status, `guess ${i}`).toBe(401);
    expect((await change(ctx.organizer, WRONG)).status).toBe(429);
  });

  it('a right PIN clears the count', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 4; i++) await change(ctx.organizer, WRONG);
    expect((await change(ctx.organizer, PIN, NEW_PIN)).status).toBe(200);
    for (let i = 1; i <= 5; i++) expect((await change(ctx.organizer, WRONG, PIN)).status, `guess ${i}`).toBe(401);
  });

  it('NEVER locks the organizer out: while Change PIN waits, the organizer screens work and signing in works on this and other phones', async () => {
    const ctx = await setupGroup();
    for (let i = 1; i <= 5; i++) await change(ctx.organizer, WRONG);
    expect((await change(ctx.organizer, WRONG)).status).toBe(429);
    // The same phone: every organizer screen still answers.
    for (const path of ['/api/admin/dashboard', '/api/admin/money?month=2026-10', '/api/admin/activity', '/api/admin/backup'])
      expect((await ctx.organizer.call('GET', path)).status, path).toBe(200);
    // Signing in again on this phone, and on a new phone, with the PIN: fine.
    expect((await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const other = ctx.app.client();
    expect((await other.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    // Another signed-in phone has its own count: its Change PIN still works.
    expect((await change(other, PIN)).status).toBe(200);
  });

  it('wrong Change PIN guesses never count toward the sign-in limits (5 per phone, 20 overall)', async () => {
    const ctx = await setupGroup();
    // 5 signed-in phones each use up their Change PIN guesses: 25 wrong PINs from the same address, more than both sign-in limits.
    const phones = [ctx.organizer];
    for (let i = 0; i < 4; i++) {
      const p = ctx.app.client();
      expect((await p.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
      phones.push(p);
    }
    for (const p of phones) for (let i = 1; i <= 5; i++) expect((await change(p, WRONG)).status).toBe(401);
    // Sign-in still checks the PIN normally: a wrong one is 401 (not "too many"), the right one works.
    const fresh = ctx.app.client();
    expect((await fresh.call('POST', '/api/admin/login', { pin: WRONG })).status).toBe(401);
    expect((await fresh.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  });

  it('a burst of guesses at the same moment still gets at most 5 checks', async () => {
    const ctx = await setupGroup();
    const results = await Promise.all(Array.from({ length: 12 }, () => change(ctx.organizer, WRONG)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    expect((await change(ctx.organizer, PIN)).status).toBe(429);
  });

  it('signed out, Change PIN is refused before any guess is counted (and counts nothing)', async () => {
    const ctx = await setupGroup();
    const stranger = ctx.app.client();
    for (let i = 0; i < 8; i++) expect((await change(stranger, WRONG)).status).toBe(401);
    const n = (ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE client_key LIKE 'pin-change:%'").get() as { n: number }).n;
    expect(n).toBe(0);
    expect((await change(ctx.organizer, PIN)).status).toBe(200);
  });
});
