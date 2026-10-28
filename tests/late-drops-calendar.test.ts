import { describe, expect, it } from 'vitest';
import { spotOpenMessage } from '../shared/messages';
import { buildTodo } from '../src/pages/admin/todo';
import { HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const phone = (ctx: Ctx, name: string) => playerPhone(ctx, name);
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) await (await phone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
}
async function out(ctx: Ctx, id: string, name: string) {
  return (await phone(ctx, name)).call('POST', `/api/sessions/${id}/withdraw`, {});
}
const entry = (d: any, sid: string, name: string) => d.sessions.find((x: any) => x.id === sid).roster.find((r: any) => r.name === name);

describe('late drops', () => {
  it('only counts a confirmed player dropping after the cancellation deadline (12 hours before by default)', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27'); // Tue 8:00 PM, deadline 8:00 AM
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // 20 hours before (inside the day-before window, before the deadline): not late.
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    await out(ctx, s.id, 'Devon');
    let d = await dash(ctx);
    expect(entry(d, s.id, 'Devon').lateDropAt).toBeNull();
    // One minute before the deadline: still not late.
    await join(ctx, s.id, ['Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 12 * HOUR - 60_000;
    await out(ctx, s.id, 'Devon');
    d = await dash(ctx);
    expect(entry(d, s.id, 'Devon').lateDropAt).toBeNull();
    // Back in, then out again after the deadline.
    await join(ctx, s.id, ['Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 3 * HOUR;
    await out(ctx, s.id, 'Devon');
    d = await dash(ctx);
    expect(entry(d, s.id, 'Devon').lateDropAt).toBe(new Date(ctx.app.now).toISOString());
    expect(buildTodo(d).map((i) => i.kind)).toContain('latedrop');
    expect(d.players.find((p: any) => p.name === 'Devon').lateDrops).toBe(1);
    // Done hides the card; the count stays.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/late-drop-done`, { playerId: ctx.byName.Devon });
    d = await dash(ctx);
    expect(buildTodo(d).map((i) => i.kind)).not.toContain('latedrop');
    expect(d.players.find((p: any) => p.name === 'Devon').lateDrops).toBe(1);
  });

  it("follows the booking's own cancellation deadline when it has one", async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // Deadline moved to 24 hours before play (Mon 8:00 PM).
    const deadline = new Date(Date.parse(s.startsAt) - 24 * HOUR).toISOString();
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', cancellationDeadlineAt: deadline });
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    await out(ctx, s.id, 'Devon');
    expect(entry(await dash(ctx), s.id, 'Devon').lateDropAt).toBe(new Date(ctx.app.now).toISOString());
  });

  it('organizer removals and waitlist drops are not late drops; coming back in clears it', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Emery waits
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    // Emery leaves the waitlist first (not a late drop), then the organizer removes Alex.
    await out(ctx, s.id, 'Emery');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Alex, action: 'withdraw' });
    let d = await dash(ctx);
    expect(entry(d, s.id, 'Alex').lateDropAt).toBeNull();
    expect(entry(d, s.id, 'Emery').lateDropAt).toBeNull();
    await out(ctx, s.id, 'Blair');
    await join(ctx, s.id, ['Blair']);
    d = await dash(ctx);
    expect(entry(d, s.id, 'Blair').lateDropAt).toBeNull();
    expect(buildTodo(d).map((i) => i.kind)).not.toContain('latedrop');
  });

  it('paid and dropped: the refund question shows, and clears once refunded', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true });
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR;
    await out(ctx, s.id, 'Casey');
    let d = await dash(ctx);
    const casey = entry(d, s.id, 'Casey');
    expect(casey).toMatchObject({ status: 'withdrawn', paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null });
    expect(casey.lateDropAt).not.toBeNull();
    // After Done on the late-drop card, the refund still waits as Pay back.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/late-drop-done`, { playerId: ctx.byName.Casey });
    d = await dash(ctx);
    expect(buildTodo(d).map((i) => i.kind)).toContain('refund');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/refund`, { playerId: ctx.byName.Casey, refunded: true });
    expect(buildTodo(await dash(ctx)).map((i) => i.kind)).not.toContain('refund');
  });

  it('the spot-open text', () => {
    const s = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' };
    const text = spotOpenMessage(s, TZ, 'https://pickleball.juncaj.net');
    expect(text).toBe('A spot opened for pickleball Tue Nov 3, 8:00 to 10:00 PM. First to grab it gets it: pickleball.juncaj.net');
    expect(text).not.toMatch(/\bsent\b/i);
  });

  it('late-drop counts never reach players', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    await out(ctx, s.id, 'Devon');
    const text = (await (await phone(ctx, 'Alex')).call('GET', '/api/group')).text;
    expect(text).not.toMatch(/lateDrop|late_drop|Late drop/i);
    expect((await (await phone(ctx, 'Alex')).call('GET', '/api/admin/dashboard')).status).toBe(401);
  });
});

describe('calendar subscription is gone; "Add to calendar" saves one session', () => {
  it('old feed links return a plain "Not found", even ones that used to work, and the data stays', async () => {
    const ctx = await setupGroup();
    const token = 'a'.repeat(43);
    await ctx.app.db.prepare('UPDATE players SET calendar_token = ? WHERE id = ?').bind(token, ctx.byName.Alex).run();
    await ctx.app.db.prepare('UPDATE groups SET calendar_token = ?').bind('b'.repeat(43)).run();
    for (const path of [`/api/cal/${token}.ics`, `/api/cal/${'b'.repeat(43)}.ics`, '/api/cal/nope.ics']) {
      const res = await ctx.app.client().call('GET', path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type')).toContain('text/plain');
      expect(res.text).toBe('Not found');
    }
    // The links that made feeds are gone too.
    expect((await (await phone(ctx, 'Alex')).call('GET', '/api/me/calendar')).status).toBe(404);
    expect((await ctx.organizer.call('GET', '/api/admin/calendar')).status).toBe(404);
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}/calendar`, { on: false })).status).toBe(404);
    // Nothing about it in what the screens load. The stored columns are left alone.
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).text;
    expect(d).not.toMatch(/calendarOn|calendarMade|webcal|calendar_token/);
    const row = await ctx.app.db.prepare('SELECT calendar_token FROM players WHERE id = ?').bind(ctx.byName.Alex).first<{ calendar_token: string }>();
    expect(row?.calendar_token).toBe(token);
  });

  it('one session as an event in Eastern time, 8:00 to 10:00 PM, at the club, with the site link', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    const nov10 = await on(ctx, '2026-11-10'); // after the clock change: still 8:00 PM local
    for (const s of [tue, nov10]) {
      const res = await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/calendar');
      const ics = res.text;
      const day = new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }).replace(/-/g, '');
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
      expect(ics).toContain(`DTSTART;TZID=America/Detroit:${day}T200000\r\n`);
      expect(ics).toContain(`DTEND;TZID=America/Detroit:${day}T220000\r\n`);
      expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Detroit');
      expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z|GMT|UTC/);
      expect(ics).toContain('LOCATION:Northville Pickleball Club');
      expect(ics).toContain(`URL:https://club.example/?s=${s.id}\r\n`);
    }
  });
});
