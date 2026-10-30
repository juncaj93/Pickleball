import { describe, expect, it } from 'vitest';
import { planSessions } from '../shared/schedule';
import { DEFAULT_SETTINGS, hhmmToMinutes, minutesLabel, minutesToHHMM, normalizeSettings } from '../shared/settings';
import { HOUR, playerPhone, setupGroup } from './harness';

// The usual game time (Settings > Schedule) and changing one game's time.
// Games at 8:00, 7:00 and 7:30 PM, across the Sun Nov 1 clock change.
const TZ = 'America/Detroit';
const local = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

describe('the usual time setting', () => {
  it('defaults to 8:00 to 10:00 PM, and keeps a sane pair', () => {
    expect(DEFAULT_SETTINGS.defaultStartMinutes).toBe(20 * 60);
    expect(DEFAULT_SETTINGS.defaultEndMinutes).toBe(22 * 60);
    expect(normalizeSettings({ defaultStartMinutes: 19 * 60, defaultEndMinutes: 21 * 60 })).toMatchObject({ defaultStartMinutes: 1140, defaultEndMinutes: 1260 });
    // An end before the start falls back to two hours long.
    expect(normalizeSettings({ defaultStartMinutes: 19 * 60, defaultEndMinutes: 18 * 60 })).toMatchObject({ defaultEndMinutes: 21 * 60 });
    // Never a zero-length game: the latest start is 10:59 PM.
    expect(normalizeSettings({ defaultStartMinutes: 23 * 60 + 59, defaultEndMinutes: 23 * 60 + 59 })).toMatchObject({ defaultStartMinutes: 22 * 60 + 59, defaultEndMinutes: 23 * 60 + 59 });
    expect(minutesToHHMM(19 * 60 + 30)).toBe('19:30');
    expect(hhmmToMinutes('19:30')).toBe(1170);
    expect(hhmmToMinutes('25:00')).toBeNull();
    expect(minutesLabel(19 * 60)).toBe('7:00 PM');
    expect(minutesLabel(0)).toBe('12:00 AM');
  });

  it('plans Tue and Thu games at the usual time, on both sides of the clock change', () => {
    const plan = planSessions(Date.parse('2026-10-26T16:00:00Z'), TZ, 2, 19 * 60, 21 * 60);
    expect(plan.slice(0, 3).map((p) => local(p.startsAt))).toEqual(['Tue, Oct 27, 7:00 PM', 'Thu, Oct 29, 7:00 PM', 'Tue, Nov 3, 7:00 PM']);
    expect(plan[0].startsAt).toBe('2026-10-27T23:00:00.000Z'); // EDT
    expect(plan[2].startsAt).toBe('2026-11-04T00:00:00.000Z'); // EST
    expect(local(plan[2].endsAt)).toBe('Tue, Nov 3, 9:00 PM');
  });

  it('a new usual time shapes only games made from then on; existing games keep their times and no second game appears', async () => {
    const ctx = await setupGroup();
    const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const before = (await dash()).sessions.filter((s: any) => !s.extra);
    expect(before.length).toBeGreaterThan(8);
    expect(before.every((s: any) => /8:00 PM$/.test(local(s.startsAt)))).toBe(true);
    const r = await ctx.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: 19 * 60, defaultEndMinutes: 21 * 60 } });
    expect(r.status).toBe(200);
    const same = (await dash()).sessions.filter((s: any) => !s.extra);
    expect(same.map((s: any) => s.startsAt)).toEqual(before.map((s: any) => s.startsAt));
    // Weeks later, the horizon reaches new dates: those come at 7:00 PM, the old ones stay at 8:00 PM, one game a day.
    ctx.app.advance(21 * 24 * HOUR);
    const later = (await dash()).sessions.filter((s: any) => !s.extra);
    const days = later.map((s: any) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }));
    expect(new Set(days).size).toBe(days.length);
    const kept = later.filter((s: any) => before.some((b: any) => b.id === s.id));
    const made = later.filter((s: any) => !before.some((b: any) => b.id === s.id));
    expect(kept.length).toBeGreaterThan(0);
    expect(made.length).toBeGreaterThan(0);
    expect(kept.every((s: any) => /8:00 PM$/.test(local(s.startsAt)))).toBe(true);
    expect(made.every((s: any) => /7:00 PM$/.test(local(s.startsAt)) && /9:00 PM$/.test(local(s.endsAt)))).toBe(true);
    // Each new game's deadline is 12 hours before its own start (7:00 AM).
    expect(made.every((s: any) => /7:00 AM$/.test(local(s.cancellationDeadlineAt)))).toBe(true);
  });
});

describe("changing one game's time", () => {
  async function game() {
    const ctx = await setupGroup();
    const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = (await dash()).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const phone = await playerPhone(ctx, 'Blair');
    await phone.call('POST', `/api/sessions/${s.id}/join`, {});
    return { ctx, s, dash, phone };
  }

  it('moving to 7:30 PM updates the game, its deadline, the player card, the calendar file and the Moved tag', async () => {
    const { ctx, s, dash, phone } = await game();
    const r = await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: '2026-11-04T00:30:00.000Z', endsAt: '2026-11-04T02:30:00.000Z' });
    expect(r.status).toBe(200);
    const moved = (await dash()).sessions.find((x: any) => x.id === s.id);
    expect(local(moved.startsAt)).toBe('Tue, Nov 3, 7:30 PM');
    expect(local(moved.endsAt)).toBe('Tue, Nov 3, 9:30 PM');
    expect(local(moved.cancellationDeadlineAt)).toBe('Tue, Nov 3, 7:30 AM');
    expect(moved.moved).toBe(true);
    const mine = (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(mine.startsAt).toBe('2026-11-04T00:30:00.000Z');
    const ics = await phone.call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(ics.text).toContain('DTSTART;TZID=America/Detroit:20261103T193000');
    expect(ics.text).toContain('DTEND;TZID=America/Detroit:20261103T213000');
  });

  it('"Is the court booked for the new time?" Yes marks it booked, No marks it not booked', async () => {
    const { ctx, s, dash } = await game();
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: '2026-11-04T00:00:00.000Z', endsAt: '2026-11-04T02:00:00.000Z' });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked: false })).status).toBe(200);
    expect((await dash()).sessions.find((x: any) => x.id === s.id).bookingStatus).toBe('needs_booking');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked: true })).status).toBe(200);
    expect((await dash()).sessions.find((x: any) => x.id === s.id).bookingStatus).toBe('booked');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked: 'yes' })).status).toBe(400);
    // Not for a game that is already over.
    ctx.app.now = Date.parse('2026-11-04T04:00:00Z');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked: false })).status).toBe(409);
    const player = await playerPhone(ctx, 'Casey');
    expect((await player.call('POST', `/api/admin/sessions/${s.id}/court-answer`, { booked: true })).status).toBe(401);
  });
});
