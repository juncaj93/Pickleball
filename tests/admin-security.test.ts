import { describe, expect, it } from 'vitest';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup } from './harness';

describe('admin access', () => {
  it('blocks every admin route without the PIN', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const stranger = ctx.app.client();
    stranger.groupKey = ctx.groupKey;
    const attempts: [string, string, unknown?][] = [
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/export'],
      ['PUT', '/api/admin/group', { name: 'Hacked' }],
      ['POST', '/api/admin/players', { name: 'Mallory' }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', courtCostCents: 1 }],
      ['POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true }],
      ['POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true }],
      ['POST', `/api/admin/sessions/${s.id}/links`, { kind: 'attendance' }],
      ['POST', '/api/admin/rotate-link', {}],
      ['POST', '/api/admin/pin', { currentPin: PIN, newPin: '999999' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await stranger.call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    const fake = ctx.app.client();
    fake.cookies.set('pb_admin', 'forged-token');
    expect((await fake.call('GET', '/api/admin/dashboard')).status).toBe(401);
  });

  it('rejects a wrong PIN and locks out after five tries', async () => {
    const ctx = await setupGroup();
    const c = ctx.app.client();
    for (let i = 0; i < 5; i++) expect((await c.call('POST', '/api/admin/login', { pin: '000000' })).status).toBe(401);
    const locked = await c.call('POST', '/api/admin/login', { pin: PIN });
    expect(locked.status).toBe(429);
    ctx.app.advance(16 * 60_000);
    expect((await c.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect((await c.call('GET', '/api/admin/dashboard')).status).toBe(200);
  });

  it('never sends the PIN or its hash to the browser', async () => {
    const ctx = await setupGroup();
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const group = await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group');
    for (const text of [dash.text, group.text]) {
      expect(text).not.toContain(PIN);
      expect(text).not.toMatch(/pbkdf2|pin_hash|admin_pin/i);
    }
    const stored = ctx.app.db.raw.prepare('SELECT admin_pin_hash FROM groups').get() as { admin_pin_hash: string };
    expect(stored.admin_pin_hash).not.toContain(PIN);
    expect(stored.admin_pin_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
  });

  it('changes the PIN and signs out other organizer devices', async () => {
    const ctx = await setupGroup();
    const other = ctx.app.client();
    await other.call('POST', '/api/admin/login', { pin: PIN });
    expect((await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: '111111', newPin: '135790' })).status).toBe(401);
    expect((await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: '135790' })).status).toBe(200);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
    expect((await other.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await other.call('POST', '/api/admin/login', { pin: '135790' })).status).toBe(200);
  });

  it('blocks cross-site requests', async () => {
    const ctx = await setupGroup();
    const res = await ctx.organizer.call('POST', '/api/admin/logout', {}, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('player privacy', () => {
  it('needs the private link key', async () => {
    const ctx = await setupGroup();
    const c = ctx.app.client();
    expect((await c.call('GET', '/api/group')).status).toBe(404);
    c.groupKey = 'not-the-right-key-at-all-123';
    expect((await c.call('GET', '/api/group')).status).toBe(404);
  });

  it('acts as the picked name only, never a player id in the request', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    await alex.call('POST', `/api/sessions/${s.id}/join?playerId=${ctx.byName.Blair}`, { playerId: ctx.byName.Blair });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const roster = dash.data.sessions.find((x: any) => x.id === s.id).roster;
    expect(roster.map((r: any) => r.name)).toEqual(['Alex']);
  });

  it('requires picking a name before joining', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const c = ctx.app.client();
    c.groupKey = ctx.groupKey;
    expect((await c.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(401);
  });

  it('old player links stop working after the organizer rotates the link', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    const rotated = await ctx.organizer.call('POST', '/api/admin/rotate-link', {});
    expect((await alex.call('GET', '/api/group')).status).toBe(404);
    alex.groupKey = rotated.data.playerLink.split('/g/')[1];
    expect((await alex.call('GET', '/api/group')).status).toBe(200);
  });
});

describe('input validation', () => {
  it('rejects bad input with a clear message', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const bad: [string, string, unknown][] = [
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'maybe' }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', courtCostCents: -5 }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', courtCostCents: 12.5 }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', venueBookingUrl: 'javascript:alert(1)' }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', cancellationDeadlineAt: 'tomorrow' }],
      ['PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', cancellationDeadlineAt: s.endsAt }],
      ['POST', '/api/admin/players', { name: '' }],
      ['POST', '/api/admin/players', { name: 'Alex' }],
      ['POST', '/api/admin/players', { name: 'Zed', phone: 'call me' }],
      ['PUT', '/api/admin/group', { name: 'X', venmoUrl: 'javascript:alert(1)' }],
      ['POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel' }],
      ['POST', `/api/admin/sessions/not-a-uuid/payment`, { playerId: ctx.byName.Alex, paid: true }],
    ];
    for (const [method, path, body] of bad) {
      const res = await ctx.organizer.call(method, path, body);
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(typeof res.data.message).toBe('string');
    }
  });

  it('stores names as plain text (the UI escapes them)', async () => {
    const ctx = await setupGroup();
    const res = await ctx.organizer.call('POST', '/api/admin/players', { name: '<img src=x onerror=alert(1)>' });
    expect(res.status).toBe(200);
    const view = await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group');
    expect(view.headers.get('Content-Type')).toContain('application/json');
    expect(view.data.players.map((p: any) => p.name)).toContain('<img src=x onerror=alert(1)>');
  });

  it('requires JSON for writes', async () => {
    const ctx = await setupGroup();
    const res = await ctx.organizer.call('POST', '/api/admin/logout', undefined, { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });
});

describe('booking, deadlines, and decisions', () => {
  it('records booking details with an exact deadline and audits it', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const deadline = new Date(Date.parse(s.startsAt) - 24 * HOUR).toISOString();
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, {
      bookingStatus: 'booked',
      venueName: 'Rec Center',
      venueBookingUrl: 'https://rec.example/booking/42',
      reservationReference: 'R-42',
      courtCostCents: 4800,
      cancellationDeadlineAt: deadline,
    });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const after = dash.data.sessions.find((x: any) => x.id === s.id);
    expect(after).toMatchObject({ status: 'booked', bookingStatus: 'booked', cancellationDeadlineAt: deadline, reservationReference: 'R-42' });
    expect(dash.data.audit[0]).toMatchObject({ action: 'booking_updated', sessionId: s.id });
  });

  it('flags booking work only inside the 14-day window', async () => {
    const ctx = await setupGroup();
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const flagged = dash.data.sessions.filter((x: any) => x.state.flags.needsBooking);
    for (const x of flagged) expect(Date.parse(x.startsAt) - ctx.app.now).toBeLessThanOrEqual(14 * DAY);
    expect(flagged.length).toBe(4);
  });

  it('asks for a decision when underfilled near the stored deadline', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey']) {
      await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/join`, {});
    }
    const deadline = Date.parse(s.startsAt) - 12 * HOUR;
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, {
      bookingStatus: 'booked',
      courtCostCents: 4800,
      cancellationDeadlineAt: new Date(deadline).toISOString(),
    });
    const load = async () =>
      (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === s.id);

    ctx.app.now = deadline - 20 * HOUR;
    expect((await load()).state.label).toBe('needs_players');
    ctx.app.now = deadline - 10 * HOUR;
    expect((await load()).state.label).toBe('decision_needed');

    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'keep' });
    expect((await load()).state.label).toBe('deadline_approaching');
    ctx.app.now = deadline + HOUR;
    expect((await load()).state.label).toBe('deadline_passed');
  });

  it('requires confirmation to cancel, records who and when, and can reopen', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel' })).status).toBe(400);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    let after = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === s.id);
    expect(after).toMatchObject({ status: 'canceled', canceledBy: 'organizer', canceledAt: new Date(ctx.app.now).toISOString() });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' });
    after = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === s.id);
    expect(after.status).toBe('planned');
  });

  it('lets the organizer fix the roster without breaking the four-spot cap', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const path = `/api/admin/sessions/${s.id}/roster`;
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
      expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName[name], action: 'confirm' })).status).toBe(200);
    }
    expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName.Emery, action: 'confirm' })).status).toBe(409);
    await ctx.organizer.call('POST', path, { playerId: ctx.byName.Emery, action: 'waitlist' });
    await ctx.organizer.call('POST', path, { playerId: ctx.byName.Devon, action: 'waitlist' });
    const after = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === s.id);
    expect(after.roster.filter((r: any) => r.status === 'waitlisted').map((r: any) => r.name)).toEqual(['Emery', 'Devon']);
    expect(after.confirmedCount).toBe(3);
  });

  it('exports sessions and payments as CSV in Eastern time', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', '/api/admin/players', { name: '=SUM(A1)' });
    const res = await ctx.organizer.call('GET', '/api/admin/export');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('Date,Time,Session status');
    expect(res.text).toContain('Tue, Oct 27,8:00–10:00 PM EDT'.replace('Tue, Oct 27', '"Tue, Oct 27"'));
    expect(res.text).toContain('Alex,confirmed');
    expect(res.text).not.toMatch(/T\d\d:\d\d:\d\d\.\d{3}Z/);
  });
});
