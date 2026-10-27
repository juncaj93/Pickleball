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
  it('only counts a confirmed player dropping once the day-before window opens (24 hours before)', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27'); // Tue 8:00 PM
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 25 * HOUR;
    await out(ctx, s.id, 'Devon');
    let d = await dash(ctx);
    expect(entry(d, s.id, 'Devon').lateDropAt).toBeNull();
    // Back in, then out again inside the window.
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
    expect(text).toBe('A spot just opened for pickleball Tue, Nov 3, 8:00 to 10:00 PM. First to claim it gets it: pickleball.juncaj.net');
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

describe('calendar subscription', () => {
  async function feed(ctx: Ctx, url: string) {
    const path = new URL(url).pathname;
    return ctx.app.client().call('GET', path);
  }

  it("lists only that person's sessions, in Eastern time, with canceled ones marked, and nothing private", async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    const thu = await on(ctx, '2026-10-29');
    const nov3 = await on(ctx, '2026-11-03');
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, thu.id, ['Alex', 'Blair']);
    await join(ctx, nov3.id, ['Blair']);
    await ctx.organizer.call('PUT', `/api/admin/sessions/${tue.id}/booking`, { bookingStatus: 'booked', courtCostCents: 4837, cancellationDeadlineAt: tue.cancellationDeadlineAt });
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venueAddress: '40100 Six Mile Rd, Northville, MI' });
    const alex = await phone(ctx, 'Alex');
    const link = (await alex.call('GET', '/api/me/calendar')).data;
    expect(link.webcal).toMatch(/^webcal:\/\/club\.example\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
    const res = await feed(ctx, link.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    const ics = res.text;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain(`UID:${tue.id}@pickleball-club`);
    expect(ics).toContain(`UID:${thu.id}@pickleball-club`);
    expect(ics).not.toContain(nov3.id); // Blair's, not Alex's
    expect(ics).toContain('DTSTART;TZID=America/Detroit:20261027T200000\r\n');
    expect(ics).toContain('DTEND;TZID=America/Detroit:20261027T220000\r\n');
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Detroit');
    expect(ics).toContain('SUMMARY:Canceled: Pickleball\r\nSTATUS:CANCELLED');
    expect(ics).toContain('SUMMARY:Pickleball\r\nSTATUS:CONFIRMED');
    expect(ics).toContain('LOCATION:Northville Pickleball Club\\, 40100 Six Mile Rd\\, Northville\\, MI');
    expect(ics).not.toMatch(/Alex|Blair|Casey|Devon|\$|4837|48\.37|1400|paid|owe/i);
    // Dropping out takes it off their calendar.
    await out(ctx, tue.id, 'Alex');
    expect((await feed(ctx, link.url)).text).not.toContain(tue.id);
  });

  it('the organizer can turn a link off (old link dies) and back on (new link)', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    await join(ctx, tue.id, ['Alex']);
    const alex = await phone(ctx, 'Alex');
    const first = (await alex.call('GET', '/api/me/calendar')).data;
    expect((await alex.call('GET', '/api/me/calendar')).data.url).toBe(first.url); // same link each time
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}/calendar`, { on: false })).status).toBe(200);
    expect((await feed(ctx, first.url)).status).toBe(404);
    expect((await alex.call('GET', '/api/me/calendar')).data).toEqual({ off: true });
    expect((await dash(ctx)).players.find((p: any) => p.name === 'Alex').calendarOn).toBe(false);
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}/calendar`, { on: true });
    const second = (await alex.call('GET', '/api/me/calendar')).data;
    expect(second.url).not.toBe(first.url);
    expect((await feed(ctx, second.url)).status).toBe(200);
    expect((await feed(ctx, first.url)).status).toBe(404);
    // Players can't switch links.
    expect((await alex.call('PUT', `/api/admin/players/${ctx.byName.Alex}/calendar`, { on: false })).status).toBe(401);
  });

  it("the organizer's calendar has every session; bad links are refused", async () => {
    const ctx = await setupGroup();
    const link = (await ctx.organizer.call('GET', '/api/admin/calendar')).data;
    const ics = (await feed(ctx, link.url)).text;
    const shown = (await dash(ctx)).sessions.length;
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(shown);
    expect((await ctx.app.client().call('GET', '/api/cal/nope.ics')).status).toBe(404);
    expect((await ctx.app.client().call('GET', `/api/cal/${'a'.repeat(43)}.ics`)).status).toBe(404);
    expect((await ctx.app.client().call('GET', '/api/admin/calendar')).status).toBe(401);
  });
});
