import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, PIN, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

/** A phone that opened the plain site address: no private link key. */
function plainPhone(ctx: Ctx, ip = '203.0.113.7') {
  const c = ctx.app.client();
  const call = c.call.bind(c);
  c.call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    call(method, path, body, { 'CF-Connecting-IP': ip, ...headers });
  return c;
}

describe('the plain site address', () => {
  it('is open by default: "Who are you?", then remembered as "Welcome, [name]"', async () => {
    const ctx = await setupGroup();
    const phone = plainPhone(ctx);
    expect((await phone.call('GET', '/api/status')).data).toMatchObject({ setupComplete: true, openAccess: true, wordRequired: false });
    const first = await phone.call('GET', '/api/group');
    expect(first.status).toBe(200);
    expect(first.data.me).toBeNull();
    expect(first.data.players.map((p: any) => p.name)).toContain('Casey');
    await phone.call('POST', '/api/me', { playerId: ctx.byName.Casey });
    expect((await phone.call('GET', '/api/group')).data.me).toMatchObject({ name: 'Casey' });
    // And they can sign up.
    const s = await firstSession(ctx);
    expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
  });

  it('turned OFF goes back to link-only; the old long link keeps working either way', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', openAccess: false });
    const phone = plainPhone(ctx);
    expect((await phone.call('GET', '/api/status')).data).toMatchObject({ openAccess: false, wordRequired: false });
    expect((await phone.call('GET', '/api/group')).status).toBe(404);
    expect((await phone.call('POST', '/api/players/self', { name: 'Morgan' })).status).toBe(404);
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.openAccess).toBe(false);
    expect(d.group.playerLink).toMatch(/\/g\/[A-Za-z0-9_-]{24}$/); // the long link again
    const linked = await playerPhone(ctx, 'Alex');
    expect((await linked.call('GET', '/api/group')).status).toBe(200);
    // Back ON.
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', openAccess: true });
    expect((await phone.call('GET', '/api/group')).status).toBe(200);
    expect((await linked.call('GET', '/api/group')).status).toBe(200);
  });

  it('shows the site address as the player link, and uses it in texts', async () => {
    const ctx = await setupGroup();
    (ctx.app.env as any).SITE_URL = 'https://pickleball.juncaj.net/';
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.playerLink).toBe('https://pickleball.juncaj.net');
    expect(d.group.privateLink).toMatch(/^https:\/\/club\.example\/g\//);
  });
});

describe('group word', () => {
  async function withWord(ctx: Ctx, word: string | null) {
    const res = await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', groupWord: word });
    expect(res.status).toBe(200);
  }

  it('a new phone is asked once, then remembers it', async () => {
    const ctx = await setupGroup();
    await withWord(ctx, 'Dink');
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.hasGroupWord).toBe(true);
    const phone = plainPhone(ctx);
    expect((await phone.call('GET', '/api/status')).data.wordRequired).toBe(true);
    expect((await phone.call('GET', '/api/group')).status).toBe(403);
    expect((await phone.call('POST', '/api/access', { word: 'pickle' })).status).toBe(401);
    expect((await phone.call('POST', '/api/access', { word: '  dINK ' })).data).toEqual({ ok: true });
    expect((await phone.call('GET', '/api/status')).data.wordRequired).toBe(false);
    expect((await phone.call('GET', '/api/group')).status).toBe(200);
    // Later visits don't ask again.
    ctx.app.now += 30 * 24 * HOUR;
    expect((await phone.call('GET', '/api/group')).status).toBe(200);
  });

  it('is never stored as typed, and changing it asks again; removing it opens up', async () => {
    const ctx = await setupGroup();
    await withWord(ctx, 'dink');
    const stored = ctx.app.db.raw.prepare('SELECT group_word_hash AS h FROM groups').get() as { h: string };
    expect(stored.h).not.toContain('dink');
    expect(stored.h).toMatch(/^[A-Za-z0-9_-]{43}$/); // SHA-256, base64url
    const phone = plainPhone(ctx);
    await phone.call('POST', '/api/access', { word: 'dink' });
    await withWord(ctx, 'volley');
    expect((await phone.call('GET', '/api/group')).status).toBe(403);
    await withWord(ctx, null);
    expect((await phone.call('GET', '/api/group')).status).toBe(200);
    // Leaving the field out keeps the current word.
    await withWord(ctx, 'volley');
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks' });
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.hasGroupWord).toBe(true);
  });

  it('phones that already picked a name are not asked', async () => {
    const ctx = await setupGroup();
    const phone = plainPhone(ctx);
    await phone.call('POST', '/api/me', { playerId: ctx.byName.Devon });
    await withWord(ctx, 'dink');
    expect((await phone.call('GET', '/api/group')).status).toBe(200);
    expect((await phone.call('GET', '/api/status')).data.wordRequired).toBe(false);
    // "Not you?" forgets the name, so that phone then needs the word.
    await phone.call('DELETE', '/api/me');
    expect((await phone.call('GET', '/api/group')).status).toBe(403);
  });

  it('the long private link skips the word', async () => {
    const ctx = await setupGroup();
    await withWord(ctx, 'dink');
    expect((await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).status).toBe(200);
  });

  it('stops guessing after 10 wrong tries in 15 minutes, without touching the PIN lockout', async () => {
    const ctx = await setupGroup();
    await withWord(ctx, 'dink');
    const phone = plainPhone(ctx);
    for (let i = 0; i < 10; i++) expect((await phone.call('POST', '/api/access', { word: `guess${i}` })).status).toBe(401);
    expect((await phone.call('POST', '/api/access', { word: 'dink' })).status).toBe(429);
    // The organizer can still sign in.
    const admin = ctx.app.client();
    expect((await admin.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    ctx.app.now += 16 * 60_000;
    expect((await phone.call('POST', '/api/access', { word: 'dink' })).status).toBe(200);
  });
});

describe('spam protection for new names', () => {
  it('allows 3 new names per phone per hour', async () => {
    const ctx = await setupGroup();
    const phone = plainPhone(ctx, '198.51.100.1');
    for (const name of ['Morgan', 'Quinn', 'Reese']) {
      expect((await phone.call('POST', '/api/players/self', { name })).data.result).toBe('added');
    }
    const blocked = await phone.call('POST', '/api/players/self', { name: 'Skyler' });
    expect(blocked.status).toBe(429);
    expect(blocked.data.message).toMatch(/Try again in an hour/);
    // Another phone isn't affected, and an hour later this one can add again.
    expect((await plainPhone(ctx, '198.51.100.2').call('POST', '/api/players/self', { name: 'Skyler' })).data.result).toBe('added');
    ctx.app.now += HOUR + 60_000;
    expect((await phone.call('POST', '/api/players/self', { name: 'Taylor' })).data.result).toBe('added');
    // Self-added names still get the New tag.
    const players = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players;
    expect(players.filter((p: any) => p.isNew).map((p: any) => p.name)).toEqual(['Morgan', 'Quinn', 'Reese', 'Skyler', 'Taylor']);
  });

  it('still asks "Is this you?" on the open address', async () => {
    const ctx = await setupGroup();
    expect((await plainPhone(ctx).call('POST', '/api/players/self', { name: 'casey' })).data).toMatchObject({ result: 'looks_like' });
  });
});

describe('privacy on the open address', () => {
  it('shows players nothing private', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', courtCostCents: 4837, cancellationDeadlineAt: s.cancellationDeadlineAt });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const phone = plainPhone(ctx);
    await phone.call('POST', '/api/me', { playerId: ctx.byName.Casey });
    const res = await phone.call('GET', '/api/group');
    const text = res.text;
    expect(text).not.toMatch(/555-01|\(313\)|3135550/); // phone numbers
    expect(text).not.toMatch(/(?<![A-Za-z0-9_-])4837(?![A-Za-z0-9_-])|48\.37|courtCost/i); // court cost
    expect(text).not.toMatch(/"paid"|paymentStatus":"paid/); // other people's money
    expect(text).not.toMatch(/admin_pin|pinHash|group_key|privateLink|audit/i);
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    // Organizer screens and actions still need the PIN.
    expect((await phone.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await phone.call('POST', `/api/admin/sessions/${s.id}/booked`, {})).status).toBe(401);
    expect((await phone.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Alex })).status).toBe(401);
  });
});
