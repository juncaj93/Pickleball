// Zip 50 (Audit C F-10, Audit A-09): a stranger sending wrong PINs could keep the organizer's NEW sign-ins refused for as long as they
// kept going (the overall cap: 20 wrong PINs in 15 minutes from everyone). Now a phone that signed in with the real PIN before carries a
// "known organizer phone" mark and skips that overall cap. Everything else about sign-in is unchanged.
import { describe, expect, it } from 'vitest';
import { KNOWN_ORGANIZER_COOKIE } from '../server/auth';
import { PIN, setupGroup } from './harness';

const MIN = 60_000;
const RO = '97531086'; // a throwaway read-only PIN for this test only
const ip = (n: string) => ({ 'CF-Connecting-IP': n });
type Client = { call: (m: string, p: string, b?: unknown, h?: Record<string, string>) => Promise<{ status: number; text: string; headers: Headers }> };
const login = (c: Client, pin: string, from: string) => c.call('POST', '/api/admin/login', { pin }, ip(from));
async function flood(ctx: Awaited<ReturnType<typeof setupGroup>>, n = 21, tag = 'a') {
  for (let i = 0; i < n; i++) await login(ctx.app.client(), '111111', `10.7.${tag.charCodeAt(0)}.${i}`);
}

describe('Zip 50: a stranger cannot keep the organizer\'s own phone from signing in', () => {
  it('a phone that signed in before signs in again during a flood of wrong PINs, round after round', async () => {
    const ctx = await setupGroup();
    const alex = ctx.app.client();
    expect((await login(alex, PIN, '10.9.9.9')).status).toBe(200);
    expect((await alex.call('POST', '/api/admin/logout', {}, ip('10.9.9.9'))).status).toBe(200);
    for (let round = 0; round < 4; round++) {
      await flood(ctx, 21, String.fromCharCode(97 + round));
      expect((await login(alex, PIN, '10.9.9.9')).status, `round ${round}`).toBe(200);
      ctx.app.advance(15 * MIN + 1000);
    }
  });

  it('a NEW phone (never signed in) is still held by the overall cap during the flood, as before', async () => {
    const ctx = await setupGroup();
    await flood(ctx);
    const r = await login(ctx.app.client(), PIN, '10.9.9.8');
    expect(r.status).toBe(429);
    ctx.app.advance(15 * MIN + 1000);
    expect((await login(ctx.app.client(), PIN, '10.9.9.8')).status).toBe(200);
  });

  it('the known phone still has its own cap of 5 wrong PINs, and never skips the PIN itself', async () => {
    const ctx = await setupGroup();
    const alex = ctx.app.client();
    expect((await login(alex, PIN, '10.9.9.7')).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await login(alex, '222222', '10.9.9.7')).status).toBe(401);
    expect((await login(alex, PIN, '10.9.9.7')).status).toBe(429);
    await flood(ctx);
    expect((await login(alex, '333333', '10.9.9.6')).status).toBe(401);
  });

  it('the mark cannot be made up: a forged or copied-and-changed mark counts for nothing', async () => {
    const ctx = await setupGroup();
    await flood(ctx);
    const fake = ctx.app.client();
    for (const value of ['x', 'abc.def', `${'a'.repeat(24)}.${'b'.repeat(43)}`, '.', 'a.']) {
      const r = await fake.call('POST', '/api/admin/login', { pin: PIN }, { ...ip('10.9.9.5'), Cookie: `${KNOWN_ORGANIZER_COOKIE}=${value}` });
      expect(r.status, value).toBe(429);
    }
  });

  it('a real mark with its random part changed counts for nothing', async () => {
    const ctx = await setupGroup();
    const r = await login(ctx.app.client(), PIN, '10.9.8.1');
    const value = r.headers.getSetCookie().find((x) => x.startsWith(`${KNOWN_ORGANIZER_COOKIE}=`))!.split(';')[0].split('=').slice(1).join('=');
    const [nonce, mark] = value.split('.');
    await flood(ctx);
    const changed = `${nonce.slice(0, -1)}${nonce.endsWith('A') ? 'B' : 'A'}.${mark}`;
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: PIN }, { ...ip('10.9.8.2'), Cookie: `${KNOWN_ORGANIZER_COOKIE}=${changed}` })).status).toBe(429);
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: PIN }, { ...ip('10.9.8.3'), Cookie: `${KNOWN_ORGANIZER_COOKIE}=${value}` })).status).toBe(200);
  });

  it('an address header made to look like a Change PIN key still meets both sign-in caps', async () => {
    const ctx = await setupGroup();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await login(ctx.app.client(), '111111', 'pin-change:x')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('the read-only PIN never makes a phone known', async () => {
    const ctx = await setupGroup();
    ctx.app.env.ORGANIZER_READONLY_PIN = RO;
    const helper = ctx.app.client();
    const r = await login(helper, RO, '10.9.9.4');
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().some((c) => c.startsWith(`${KNOWN_ORGANIZER_COOKIE}=`))).toBe(false);
    await helper.call('POST', '/api/admin/logout', {}, ip('10.9.9.4'));
    await flood(ctx);
    expect((await login(helper, RO, '10.9.9.4')).status).toBe(429);
  });

  it('a PIN change ends every old mark; the phone that changed it gets a new one', async () => {
    const ctx = await setupGroup();
    const other = ctx.app.client();
    expect((await login(other, PIN, '10.9.9.3')).status).toBe(200);
    expect((await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: '135790' })).status).toBe(200);
    await ctx.organizer.call('POST', '/api/admin/logout', {});
    await flood(ctx);
    // The other phone's mark was made with the old PIN: held like a new phone.
    expect((await login(other, '135790', '10.9.9.3')).status).toBe(429);
    // The phone that changed the PIN: known with the new one.
    expect((await login(ctx.organizer, '135790', '10.9.9.2')).status).toBe(200);
  });

  it('the mark is a long-lived, http-only, same-site cookie and holds no PIN', async () => {
    const ctx = await setupGroup();
    const r = await login(ctx.app.client(), PIN, '10.9.9.1');
    const c = r.headers.getSetCookie().find((x) => x.startsWith(`${KNOWN_ORGANIZER_COOKIE}=`))!;
    expect(c).toBeTruthy();
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).not.toContain(PIN);
    expect(Number(/Max-Age=(\d+)/i.exec(c)![1])).toBeGreaterThan(300 * 86_400);
  });
});
