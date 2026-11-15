// Zip 47 audit probe (security): the organizer PIN lockout (5 wrong per phone, 20 overall, in 15 minutes), the read-only PIN sharing it,
// and the places a PIN is checked WITHOUT the lockout. In-memory database only.
import { describe, expect, it } from 'vitest';
import { PIN, setupGroup } from '../../harness';

const RO_PIN = '58302917';
const MIN = 60_000;

describe('Zip 47 probe: PIN lockout', () => {
  it('5 wrong from one phone: the 6th try is refused even with the right PIN; another phone still gets in', async () => {
    const w = await setupGroup();
    const a = w.app.client();
    for (let i = 0; i < 5; i++) expect((await a.call('POST', '/api/admin/login', { pin: '111111' }, { 'CF-Connecting-IP': '10.0.0.1' })).status).toBe(401);
    expect((await a.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.1' })).status).toBe(429);
    const b = w.app.client();
    expect((await b.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.2' })).status).toBe(200);
    // 15 minutes later the first phone may try again.
    w.app.advance(15 * MIN + 1000);
    expect((await a.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.1' })).status).toBe(200);
  });

  it('20 wrong overall (from 20 phones) locks everyone, the real organizer included, for 15 minutes', async () => {
    const w = await setupGroup();
    for (let i = 0; i < 20; i++) {
      const c = w.app.client();
      expect((await c.call('POST', '/api/admin/login', { pin: '111111' }, { 'CF-Connecting-IP': `10.1.0.${i}` })).status).toBe(401);
    }
    const alex = w.app.client();
    expect((await alex.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.9.9.9' })).status).toBe(429);
    w.app.advance(15 * MIN + 1000);
    expect((await alex.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.9.9.9' })).status).toBe(200);
  });

  it('a stranger can keep the organizer locked out for good with 20 guesses every 15 minutes (design trade-off, noted)', async () => {
    const w = await setupGroup();
    const alex = w.app.client();
    let refused = 0;
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 21; i++) await w.app.client().call('POST', '/api/admin/login', { pin: '111111' }, { 'CF-Connecting-IP': `10.2.${round}.${i}` });
      if ((await alex.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.9.9.9' })).status === 429) refused++;
      w.app.advance(15 * MIN + 1000);
    }
    expect(refused).toBe(4);
  });

  it('read-only PIN guesses count against the same limits, and a locked phone cannot use the read-only PIN either', async () => {
    const w = await setupGroup();
    w.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
    const a = w.app.client();
    for (let i = 0; i < 5; i++) expect((await a.call('POST', '/api/admin/login', { pin: '222222' }, { 'CF-Connecting-IP': '10.3.0.1' })).status).toBe(401);
    expect((await a.call('POST', '/api/admin/login', { pin: RO_PIN }, { 'CF-Connecting-IP': '10.3.0.1' })).status).toBe(429);
  });

  it('Change PIN checks the current PIN with NO lockout: 30 wrong current PINs in a row, then the right one works', async () => {
    const w = await setupGroup();
    let wrong = 0;
    for (let i = 0; i < 30; i++) {
      const r = await w.organizer.call('POST', '/api/admin/pin', { currentPin: String(100000 + i), newPin: '135791' }, { 'CF-Connecting-IP': '10.4.0.1' });
      if (r.status === 401) wrong++;
    }
    expect(wrong).toBe(30);
    const ok = await w.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: '135791' }, { 'CF-Connecting-IP': '10.4.0.1' });
    expect(ok.status).toBe(200);
    // Nothing was counted in the lockout table for those 30 guesses.
    const rows = w.app.db.raw.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE succeeded = 0').get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('the setup code cannot be guessed once the group exists (same answer whatever is typed)', async () => {
    const w = await setupGroup();
    const c = w.app.client();
    const r = await c.call('POST', '/api/setup', { setupToken: 'nope', groupName: 'x', pin: '123456', players: [{ name: 'x' }] });
    expect(r.status).toBe(409);
  });

  it('group word: 10 wrong per phone, but no overall cap (many phones can keep guessing)', async () => {
    const w = await setupGroup();
    expect((await w.organizer.call('PUT', '/api/admin/group', { openAccess: true, groupWord: 'dinks' })).status).toBe(200);
    const a = w.app.client();
    for (let i = 0; i < 10; i++) expect((await a.call('POST', '/api/access', { word: `no${i}` }, { 'CF-Connecting-IP': '10.5.0.1' })).status).toBe(401);
    expect((await a.call('POST', '/api/access', { word: 'dinks' }, { 'CF-Connecting-IP': '10.5.0.1' })).status).toBe(429);
    let fromOthers = 0;
    for (let i = 0; i < 40; i++) {
      const r = await w.app.client().call('POST', '/api/access', { word: `x${i}` }, { 'CF-Connecting-IP': `10.6.0.${i}` });
      if (r.status === 401) fromOthers++;
    }
    expect(fromOthers).toBe(40);
  });
});
