import { describe, expect, it } from 'vitest';
import { DAY, HOUR, firstSession, playerPhone, setupGroup } from './harness';

// "Pretend it's...": the organizer previews the site at another time.
// Organizer only, look-only, and nothing is ever written.

const P = (iso: string) => ({ 'X-Pretend-Now': iso });
const TABLES = ['groups', 'players', 'sessions', 'session_players', 'credit_ledger', 'refund_requests', 'session_action_tokens', 'player_devices', 'admin_audit_log', 'rate_events'];

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
function snapshot(ctx: Ctx) {
  return Object.fromEntries(TABLES.map((t) => [t, ctx.app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}
const sessionOf = (d: any, id: string) => d.sessions.find((x: any) => x.id === id);

/** A game on a date (Eastern), added as an extra game so tests can pick any day. */
async function gameAt(ctx: Ctx, startsAt: string, hours = 2) {
  const res = await ctx.organizer.call('POST', '/api/admin/sessions', {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + hours * HOUR).toISOString(),
  });
  if (res.status !== 200) throw new Error(res.text);
  return res.data.id as string;
}

describe('pretend time: who can use it', () => {
  it('only the signed-in organizer; players and strangers are refused', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('GET', '/api/group', undefined, P('2026-11-03T13:00:00Z'))).status).toBe(401);
    expect((await ctx.app.client().call('GET', '/api/status', undefined, P('2026-11-03T13:00:00Z'))).status).toBe(401);
    // Without the header players are unaffected.
    expect((await alex.call('GET', '/api/group')).data.now).toBe(new Date(ctx.app.now).toISOString());
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P('2026-11-03T13:00:00Z'))).data.now).toBe('2026-11-03T13:00:00.000Z');
  });

  it('refuses a time that is not a time', async () => {
    const ctx = await setupGroup();
    for (const bad of ['tomorrow', '2026-13-45T99:00', '1900-01-01T00:00:00Z']) {
      expect((await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(bad))).status, bad).toBe(400);
    }
  });

  it('works while signed in even when the pretend time is past the 30-day sign-in', async () => {
    const ctx = await setupGroup();
    const later = new Date(ctx.app.now + 40 * DAY).toISOString();
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(later))).status).toBe(200);
  });
});

describe('pretend time: look-only', () => {
  it('every change answers "Demo only" and nothing is written, not even by page loads', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const before = snapshot(ctx);
    // After the 6-player game and 8 weeks on: a normal load would make new games; the game waits to be finalized.
    const later = new Date(Date.parse(s.endsAt) + 8 * 7 * DAY).toISOString();
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(later))).data;
    expect(sessionOf(d, s.id)).toMatchObject({ needsFinalize: true, finalized: null }); // shown, not saved
    expect(d.creditLedger).toEqual([]);
    await ctx.organizer.call('GET', '/api/admin/money?month=2026-10', undefined, P(later));
    await ctx.organizer.call('GET', '/api/admin/activity', undefined, P(later));
    await ctx.organizer.call('GET', '/api/group', undefined, { ...P(later), 'X-View-As': ctx.byName.Alex });
    const changes: [string, string, unknown, Record<string, string>?][] = [
      ['POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true }],
      ['POST', `/api/admin/sessions/${s.id}/booked`, {}],
      ['PUT', '/api/admin/group', { name: 'Nope' }],
      ['POST', `/api/admin/sessions/${s.id}/me`, { in: true }],
      ['POST', `/api/sessions/${s.id}/withdraw`, {}, { 'X-View-As': ctx.byName.Alex }],
      ['POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true }],
      ['POST', `/api/admin/sessions/${s.id}/reopen`, {}],
      ['POST', '/api/me/refund-request', { cents: 500 }, { 'X-View-As': ctx.byName.Alex }],
      ['POST', `/api/admin/players/${ctx.byName.Alex}/credit-refund`, { refunded: true, cents: 500 }],
      ['POST', '/api/admin/pin', { currentPin: '246810', newPin: '135790' }],
    ];
    for (const [m, path, body, extra] of changes) {
      const r = await ctx.organizer.call(m, path, body, { ...P(later), ...(extra ?? {}) });
      expect(r.status, path).toBe(403);
      expect(r.data).toEqual({ error: 'demo_only', message: 'Demo only. Nothing was saved.' });
    }
    expect(snapshot(ctx)).toEqual(before);
    // Real time again: nothing happened.
    const real = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(real.audit.filter((a: any) => /paid|booked|settings|finalized|refund|withdraw/.test(a.action)).map((a: any) => a.action)).toEqual(before.admin_audit_log.filter((a: any) => /paid|booked|settings|finalized|refund|withdraw/.test(a.action)).map((a: any) => a.action));
    expect(sessionOf(real, s.id).finalized).toBeNull();
  });
});

describe('pretend time: the time rules', () => {
  it('game-day pay card from 8:00 AM, not 7:59 AM (player screen through View as)', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx); // Tue Oct 27, 8:00 PM EDT
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    const as = (iso: string) => ctx.organizer.call('GET', '/api/group', undefined, { ...P(iso), 'X-View-As': ctx.byName.Alex });
    expect((await as('2026-10-27T11:59:00Z')).data.payDue).toEqual([]); // 7:59 AM EDT
    expect((await as('2026-10-27T12:00:00Z')).data.payDue.map((o: any) => o.sessionId)).toEqual([s.id]); // 8:00 AM EDT
  });

  it('day-before card at 24 hours, last call at 13 hours, deadline passed at 12 hours', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const at = (ms: number) => ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(new Date(ms).toISOString())).then((r) => sessionOf(r.data, s.id));
    const start = Date.parse(s.startsAt);
    expect((await at(start - 24 * HOUR - 60_000)).cards.dayBefore).toBe(false);
    expect((await at(start - 24 * HOUR)).cards.dayBefore).toBe(true);
    expect((await at(start - 13 * HOUR - 60_000)).cards.lastCall).toBe(false);
    expect((await at(start - 13 * HOUR)).cards.lastCall).toBe(true);
    expect((await at(start - 12 * HOUR - 60_000)).state.flags.deadlinePassed).toBe(false);
    expect((await at(start - 12 * HOUR)).state.flags.deadlinePassed).toBe(true);
  });

  it('booking opens at 12:00 AM Eastern 14 days before: 11:59 PM closed, midnight open, 7:00 AM badge', async () => {
    const ctx = await setupGroup();
    const s = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.startsAt === '2026-11-11T01:00:00.000Z'); // Tue Nov 10, 8:00 PM EST
    const at = (iso: string) => ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(iso)).then((r) => sessionOf(r.data, s.id).state.flags);
    expect((await at('2026-10-27T03:59:00Z')).bookingWindowOpen).toBe(false); // Mon Oct 26, 11:59 PM EDT
    expect((await at('2026-10-27T04:00:00Z')).bookingWindowOpen).toBe(true); // Tue Oct 27, 12:00 AM EDT
    expect((await at('2026-10-27T10:59:00Z')).bookingPromptDue).toBe(false); // 6:59 AM
    expect((await at('2026-10-27T11:00:00Z')).bookingPromptDue).toBe(true); // 7:00 AM
  });

  it('Sun Nov 1 clock change: before and after the hour goes back', async () => {
    const ctx = await setupGroup();
    // A Sunday game two weeks after the change: booking opens Sun Nov 1, 12:00 AM (still EDT).
    const sunday = await gameAt(ctx, '2026-11-16T01:00:00.000Z'); // Sun Nov 15, 8:00 PM EST
    const flags = (iso: string) => ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(iso)).then((r) => sessionOf(r.data, sunday).state.flags);
    expect((await flags('2026-11-01T03:59:00Z')).bookingWindowOpen).toBe(false); // Sat Oct 31, 11:59 PM EDT
    expect((await flags('2026-11-01T04:00:00Z')).bookingWindowOpen).toBe(true); // Sun Nov 1, 12:00 AM EDT
    // 1:30 AM happens twice on Nov 1; both are the same calendar day for the site.
    const first = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P('2026-11-01T05:30:00Z'))).data; // 1:30 AM EDT
    const second = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P('2026-11-01T06:30:00Z'))).data; // 1:30 AM EST
    expect(first.now).toBe('2026-11-01T05:30:00.000Z');
    expect(second.now).toBe('2026-11-01T06:30:00.000Z');
    // A Monday game right after the change: the day-before card is 24 real hours before (Sun 8:00 PM EST).
    const monday = await gameAt(ctx, '2026-11-03T01:00:00.000Z'); // Mon Nov 2, 8:00 PM EST
    const cards = (iso: string) => ctx.organizer.call('GET', '/api/admin/dashboard', undefined, P(iso)).then((r) => sessionOf(r.data, monday).cards);
    expect((await cards('2026-11-02T00:59:00Z')).dayBefore).toBe(false); // Sun 7:59 PM EST
    expect((await cards('2026-11-02T01:00:00Z')).dayBefore).toBe(true); // Sun 8:00 PM EST
    // Game-day pay card at 8:00 AM EST on Mon Nov 2 (13:00 UTC, not 12:00).
    await ctx.organizer.call('POST', `/api/admin/sessions/${monday}/roster`, { playerId: ctx.byName.Alex, action: 'confirm' });
    const pay = (iso: string) => ctx.organizer.call('GET', '/api/group', undefined, { ...P(iso), 'X-View-As': ctx.byName.Alex }).then((r) => r.data.payDue.length);
    expect(await pay('2026-11-02T12:59:00Z')).toBe(0); // 7:59 AM EST
    expect(await pay('2026-11-02T13:00:00Z')).toBe(1); // 8:00 AM EST
  });

  it('"this week" follows the pretend time (the player screen groups by it)', async () => {
    const ctx = await setupGroup();
    const g = (await ctx.organizer.call('GET', '/api/group', undefined, { ...P('2026-11-09T17:00:00Z'), 'X-View-As': ctx.byName.Alex })).data;
    expect(g.now).toBe('2026-11-09T17:00:00.000Z');
    expect(g.sessions[0].startsAt).toBe('2026-11-11T01:00:00.000Z'); // Tue Nov 10 is the first game still ahead
  });
});
