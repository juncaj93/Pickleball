import { describe, expect, it } from 'vitest';
import { courtStatus, playerSlots } from '../shared/court';
import { buildTodo, homeBadgeCount } from '../src/pages/admin/todo';
import { suggestions } from '../src/pages/admin/suggestions';
import { bookingOpensMs, formatDateTime, formatShortDate } from '../shared/time';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const base = { canceled: false, started: false, past: false, bookingStatus: 'needs_booking' as const, courtState: null };

describe('court status words', () => {
  it('gives each look its own words, for the organizer and for players', () => {
    expect(courtStatus({ ...base, bookingStatus: 'booked' })).toEqual({ kind: 'booked', text: 'Court booked', playerText: 'Court booked' });
    expect(courtStatus(base)).toEqual({ kind: 'needs', text: 'Court not booked', playerText: 'Court not booked yet' });
    expect(courtStatus({ ...base, courtState: 'waitlist' })).toEqual({
      kind: 'waitlist',
      text: 'Court waitlist',
      playerText: 'Waiting on the court',
    });
  });

  it('is gray with the reason when canceled or unavailable', () => {
    expect(courtStatus({ ...base, canceled: true })).toMatchObject({ kind: 'off', text: 'Canceled' });
    expect(courtStatus({ ...base, canceled: true, courtState: 'not_opened' })).toMatchObject({ kind: 'off', text: "Court didn't open" });
    expect(courtStatus({ ...base, bookingStatus: 'unavailable' })).toMatchObject({ kind: 'off', text: 'No court available' });
    expect(courtStatus({ ...base, bookingOpen: false, bookingOpensAt: '2026-11-17T12:00:00Z' })).toMatchObject({ kind: 'later', text: 'Booking opens Tue, Nov 17' });
    // A booked or waitlisted session keeps its own look even before the window opens.
    expect(courtStatus({ ...base, bookingStatus: 'booked', bookingOpen: false, bookingOpensAt: '2026-11-17T12:00:00Z' }).kind).toBe('booked');
    expect(courtStatus({ ...base, courtState: 'waitlist', bookingOpen: false, bookingOpensAt: '2026-11-17T12:00:00Z' }).kind).toBe('waitlist');
    expect(courtStatus({ ...base, bookingStatus: 'booked', canceled: true })).toMatchObject({ kind: 'off', text: 'Canceled' });
    expect(courtStatus({ ...base, bookingStatus: 'booked', started: true, past: true })).toMatchObject({ kind: 'off', text: 'Played' });
  });

  it('counts players toward 4, or toward 6 once more than 4 are in', () => {
    expect([0, 3, 4, 5, 6].map(playerSlots)).toEqual([4, 4, 4, 6, 6]);
  });
});

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}

async function upcoming(ctx: Ctx) {
  const d = await dash(ctx);
  return d.sessions.filter((s: any) => Date.parse(s.endsAt) > Date.parse(d.now));
}

describe('organizer Home', () => {
  it('amber only inside the 14-day booking window; further out is quiet gray "Booking opens [date]"', async () => {
    const ctx = await setupGroup();
    const d = await dash(ctx);
    const nowMs = Date.parse(d.now);
    const live = d.sessions.filter((s: any) => Date.parse(s.startsAt) > nowMs);
    const look = (s: any) =>
      courtStatus({ ...s, canceled: s.state.flags.canceled, started: s.state.flags.started, past: s.state.flags.past, bookingOpen: s.state.flags.bookingWindowOpen }, d.group.timezone);
    const inside = live.filter((s: any) => nowMs >= Date.parse(s.bookingOpensAt));
    const outside = live.filter((s: any) => nowMs < Date.parse(s.bookingOpensAt));
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    for (const s of inside) expect(look(s)).toMatchObject({ kind: 'needs', text: 'Court not booked' });
    for (const s of outside) {
      const c = look(s);
      expect(c.kind).toBe('later');
      expect(Date.parse(s.bookingOpensAt)).toBe(bookingOpensMs(s.startsAt, 14, d.group.timezone));
      expect(formatDateTime(s.bookingOpensAt, d.group.timezone)).toMatch(/12:00 AM$/);
      expect(c.text).toBe(`Booking opens ${formatShortDate(s.bookingOpensAt, d.group.timezone)}`);
      expect(c.text).toMatch(/^Booking opens (Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}$/);
    }
    // Players see the same quiet look for far-off sessions.
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    const far = g.sessions.find((x: any) => x.id === outside[0].id);
    expect(far.bookingOpen).toBe(false);
    expect(courtStatus(far, d.group.timezone)).toMatchObject({ kind: 'later', playerText: 'Court not booked yet' });
    const near = g.sessions.find((x: any) => x.id === inside[0].id);
    expect(courtStatus(near, d.group.timezone)).toMatchObject({ kind: 'needs', playerText: 'Court not booked yet' });
  });

  it('the Home badge counts only courts inside the booking window', async () => {
    const ctx = await setupGroup();
    const d = await dash(ctx);
    const inside = d.sessions.filter((s: any) => s.state.flags.bookingPromptDue);
    expect(homeBadgeCount(d)).toBe(buildTodo(d).length + inside.length);
    expect(homeBadgeCount(d)).toBeLessThan(d.sessions.length);
    // Booking one drops the count by one.
    await ctx.organizer.call('POST', `/api/admin/sessions/${inside[0].id}/booked`, {});
    const after = await dash(ctx);
    expect(homeBadgeCount(after)).toBe(buildTodo(after).length + inside.length - 1);
  });

  it('"Needs attention" is empty when there is nothing to do', async () => {
    const ctx = await setupGroup();
    expect(buildTodo(await dash(ctx))).toEqual([]);
  });

  it('"Needs attention" never repeats a session card: no court or short-on-players cards there', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const [, w] = await upcoming(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${w.id}/court`, { action: 'waitlist' });
    // Short on players inside the day-before window, with the court unbooked.
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/join`, {});
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    const d = await dash(ctx);
    const first = d.sessions.find((x: any) => x.id === s.id);
    expect(first.state.flags.shortOnPlayers).toBe(true);
    const kinds = buildTodo(d).map((i) => i.kind);
    expect(kinds).not.toContain('courts');
    expect(kinds).not.toContain('courtwait');
    expect(kinds).not.toContain('short');
    // The text to send is now a suggestion card at the top of Home (the old day-before card is gone, so nothing shows twice).
    expect(kinds).not.toContain('daybefore');
    expect(suggestions(d, Date.parse(d.now)).map((c) => c.kind)).toContain('need');
  });

  it('keeps the 5-going warning and who owes in "Needs attention"', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await (await playerPhone(ctx, 'Frankie')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    const kinds = buildTodo(await dash(ctx)).map((i) => i.kind);
    expect(kinds).toContain('five');
    // On game day the unpaid players show as "Mark paid tonight".
    expect(kinds.some((k) => k === 'owed' || k === 'tonight')).toBe(true);
  });
});

describe('player wording', () => {
  it('uses the same court words, with nothing to tap for the court', async () => {
    const ctx = await setupGroup();
    const [a, b] = await upcoming(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/booked`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/court`, { action: 'waitlist' });
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    const words = (id: string) => courtStatus(g.sessions.find((x: any) => x.id === id)).playerText;
    expect(words(a.id)).toBe('Court booked');
    expect(words(b.id)).toBe('Waiting on the court');
    const other = g.sessions.find((x: any) => x.id !== a.id && x.id !== b.id);
    expect(courtStatus(other).playerText).toBe('Court not booked yet');
  });
});

describe('week dividers', () => {
  it('labels weeks This week, Next week, then Week of Mon date; Tue and Thu share a week', async () => {
    const { weekLabel, weekStart } = await import('../shared/time');
    const tz = 'America/Detroit';
    const now = Date.parse('2026-10-27T15:00:00Z'); // Tue, Oct 27
    expect(weekStart('2026-10-27T23:00:00Z', tz)).toBe(weekStart('2026-10-30T00:00:00Z', tz)); // Tue and Thu evening
    expect(weekLabel('2026-10-29T23:00:00Z', now, tz)).toBe('This week');
    expect(weekLabel('2026-11-03T23:00:00Z', now, tz)).toBe('Next week');
    expect(weekLabel('2026-11-10T23:00:00Z', now, tz)).toBe('Week of Nov 9');
    expect(weekLabel('2026-10-20T23:00:00Z', now, tz)).toBe('Last week');
    // Late evening Eastern is already the next day in UTC; it still counts by the local date.
    expect(weekLabel('2026-11-02T03:30:00Z', now, tz)).toBe('This week'); // Sun, Nov 1, 10:30 PM
  });
});

describe('later weeks fade gently', () => {
  it('this week and next week are full strength, then each later week is a step lighter (up to 3)', async () => {
    const { weekFade } = await import('../shared/time');
    const tz = 'America/Detroit';
    const now = Date.parse('2026-10-27T15:00:00Z'); // Tue, Oct 27
    expect(weekFade('2026-10-20T23:00:00Z', now, tz)).toBe(0); // last week
    expect(weekFade('2026-10-29T23:00:00Z', now, tz)).toBe(0); // this week
    expect(weekFade('2026-11-05T23:00:00Z', now, tz)).toBe(0); // next week
    expect(weekFade('2026-11-10T23:00:00Z', now, tz)).toBe(1);
    expect(weekFade('2026-11-17T23:00:00Z', now, tz)).toBe(2);
    expect(weekFade('2026-11-24T23:00:00Z', now, tz)).toBe(3);
    expect(weekFade('2026-12-29T23:00:00Z', now, tz)).toBe(3);
  });
});
