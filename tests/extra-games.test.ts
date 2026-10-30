import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { courtStatus } from '../shared/court';
import { bookingOpensMs, formatShortDate, zonedTimeToUtc } from '../shared/time';
import { recipients } from '../src/pages/admin/todo';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToUtc(y, m, d, h, min, TZ)).toISOString();
const activity = async (ctx: Ctx, who = 'Robin') =>
  (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => activityText(e, TZ, who));

describe('one-off games', () => {
  it('adds a game that shows for everyone in date order, tagged, with its note, and logs it', async () => {
    const ctx = await setupGroup();
    // Sat Oct 31, 10:00 AM to noon.
    const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 10, 31, 10), endsAt: at(2026, 10, 31, 12), note: 'Court 3' });
    expect(res.status).toBe(200);
    const d = await dash(ctx);
    const i = d.sessions.findIndex((s: any) => s.id === res.data.id);
    expect(d.sessions[i]).toMatchObject({ extra: true, note: 'Court 3', startsAt: at(2026, 10, 31, 10) });
    // Between Thu Oct 29 and Tue Nov 3.
    expect(d.sessions[i - 1].startsAt < d.sessions[i].startsAt && d.sessions[i].startsAt < d.sessions[i + 1].startsAt).toBe(true);
    expect(d.sessions.filter((s: any) => !s.extra).every((s: any) => s.note === null)).toBe(true);
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(g.sessions.find((s: any) => s.id === res.data.id)).toMatchObject({ extra: true, note: 'Court 3' });
    expect((await activity(ctx))[0]).toBe('Robin added a game for Sat, Oct 31');
  });

  it("won't make a duplicate at the same date and time", async () => {
    const ctx = await setupGroup();
    const body = { startsAt: at(2026, 11, 14, 20), endsAt: at(2026, 11, 14, 22) };
    expect((await ctx.organizer.call('POST', '/api/admin/sessions', body)).status).toBe(200);
    const again = await ctx.organizer.call('POST', '/api/admin/sessions', body);
    expect(again.status).toBe(409);
    expect(again.data.message).toBe("There's already a game at Sat, Nov 14, 8:00 PM.");
    // A regular Tue/Thu slot is taken too.
    const tue = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 3, 20), endsAt: at(2026, 11, 3, 22) });
    expect(tue.status).toBe(409);
    expect((await dash(ctx)).sessions.filter((s: any) => s.startsAt === body.startsAt)).toHaveLength(1);
  });

  it('refuses the past, backwards times, and players', async () => {
    const ctx = await setupGroup();
    expect((await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 10, 20, 20), endsAt: at(2026, 10, 20, 22) })).status).toBe(400);
    expect((await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 14, 22), endsAt: at(2026, 11, 14, 20) })).status).toBe(400);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 14, 20), endsAt: at(2026, 11, 14, 22) })).status).toBe(401);
  });

  it('works like any session: 4 to the max, waitlist, $14, deadline, and the same 14-day booking rule', async () => {
    const ctx = await setupGroup();
    // Sat Nov 14 is 19 days out: not bookable yet; opens Sat Oct 31 at 12:00 AM.
    const { id } = (await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 14, 20), endsAt: at(2026, 11, 14, 22) })).data;
    let s = (await dash(ctx)).sessions.find((x: any) => x.id === id);
    expect(s.bookingOpensAt).toBe(new Date(bookingOpensMs(s.startsAt, 14, TZ)).toISOString());
    expect(formatShortDate(s.bookingOpensAt, TZ)).toBe('Sat, Oct 31');
    expect(courtStatus({ ...s, canceled: false, started: false, past: false, bookingOpen: s.state.flags.bookingWindowOpen }, TZ).kind).toBe('later');
    expect(s.cancellationDeadlineAt).toBe(new Date(Date.parse(s.startsAt) - 12 * HOUR).toISOString());
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
    s = (await dash(ctx)).sessions.find((x: any) => x.id === id);
    expect(s.confirmedCount).toBe(5);
    expect(s.waitlistCount).toBe(0);
    expect(s.roster.filter((r: any) => r.status === 'confirmed').every((r: any) => r.shareCents === 1400)).toBe(true);
    // The max from Settings applies here too: at 5, the 6th waits.
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 5 } });
    expect((await (await playerPhone(ctx, 'Frankie')).call('POST', `/api/sessions/${id}/join`, {})).data).toEqual({ result: 'waitlisted', position: 1 });
    s = (await dash(ctx)).sessions.find((x: any) => x.id === id);
    expect([s.confirmedCount, s.waitlistCount]).toEqual([5, 1]);
    ctx.app.now = Date.parse('2026-10-31T04:00:00.000Z'); // Sat Oct 31, 12:00 AM
    s = (await dash(ctx)).sessions.find((x: any) => x.id === id);
    expect(s.state.flags.needsBooking).toBe(true);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/booked`, {})).status).toBe(200);
    expect((await ctx.app.client().call('GET', `/api/sessions/${id}/calendar.ics`)).text).toContain('DTSTART;TZID=America/Detroit:20261114T200000');
  });
});

describe('the organizer playing', () => {
  it('signs up under their Settings name, counts toward 4, has no player share (they pay the court), and can drop out', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
    const s = await firstSession(ctx);
    expect((await dash(ctx)).me).toBeNull();
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    expect(res.data.result).toBe('confirmed');
    const d = await dash(ctx);
    expect(d.me).toMatchObject({ name: 'Robin' });
    const mine = d.sessions.find((x: any) => x.id === s.id).roster.find((r: any) => r.playerId === d.me.id);
    expect(mine).toMatchObject({ name: 'Robin', status: 'confirmed', shareCents: null, isOrganizer: true });
    expect(d.players.some((p: any) => p.name === 'Robin')).toBe(true);
    const day = formatShortDate(s.startsAt, TZ);
    expect((await activity(ctx))[0]).toBe(`Robin said I'm in for ${day}`);
    // Players see the name in the roster.
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).confirmed.map((c: any) => c.name)).toContain('Robin');
    // A second tap doesn't double up; Out takes them off.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).confirmedCount).toBe(1);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: false })).data.result).toBe('withdrawn');
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).confirmedCount).toBe(0);
    expect((await activity(ctx))[0]).toBe(`Robin dropped out of ${day}`);
    // The same record every time.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    expect((await dash(ctx)).players.filter((p: any) => p.name === 'Robin')).toHaveLength(1);
  });

  it('uses an existing player with the same name, and asks for a name if none is saved', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: '' });
    const s = await firstSession(ctx);
    const none = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    expect(none.status).toBe(400);
    expect(none.data.message).toMatch(/Your name/);
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Casey' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    const d = await dash(ctx);
    expect(d.me.id).toBe(ctx.byName.Casey);
    expect(d.players.filter((p: any) => p.name === 'Casey')).toHaveLength(1);
  });

  it('players and strangers cannot use it', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect((await (await playerPhone(ctx, 'Alex')).call('POST', `/api/admin/sessions/${s.id}/me`, { in: true })).status).toBe(401);
  });
});

describe('who each text goes to', () => {
  it('everyone, the players in, or everyone not in; never the organizer; names without numbers listed', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    // Devon has no number.
    const devon = (await dash(ctx)).players.find((p: any) => p.name === 'Devon');
    await ctx.organizer.call('PUT', `/api/admin/players/${devon.id}`, { name: 'Devon', phone: null, isRegular: devon.isRegular, isActive: true, canReceiveSubstituteInvites: true });
    const d = await dash(ctx);
    const sess = d.sessions.find((x: any) => x.id === s.id);
    const inNow = recipients(d, sess, 'in');
    expect(inNow.count).toBe(2);
    expect(inNow.phones).toHaveLength(2);
    const everyone = recipients(d, sess, 'everyone');
    expect(everyone.count).toBe(6);
    expect(everyone.missing).toEqual(['Devon']);
    const notIn = recipients(d, sess, 'notIn');
    expect(notIn.count).toBe(4);
    expect(notIn.missing).toEqual(['Devon']);
    expect([...inNow.phones, ...everyone.phones, ...notIn.phones].some((p) => p === null)).toBe(false);
  });
});
