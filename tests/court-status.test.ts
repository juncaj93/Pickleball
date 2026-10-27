import { describe, expect, it } from 'vitest';
import { courtStatus, playerSlots } from '../shared/court';
import { buildTodo, courtCounts } from '../src/pages/admin/todo';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const base = { canceled: false, started: false, past: false, bookingStatus: 'needs_booking' as const, courtState: null };

describe('court status words', () => {
  it('gives each look its own words, for the organizer and for players', () => {
    expect(courtStatus({ ...base, bookingStatus: 'booked' })).toEqual({ kind: 'booked', text: 'Court booked', playerText: 'Court booked' });
    expect(courtStatus(base)).toEqual({ kind: 'needs', text: 'Court not booked', playerText: 'Court not booked yet' });
    expect(courtStatus({ ...base, courtState: 'waitlist' })).toEqual({
      kind: 'waitlist',
      text: 'On the court waitlist',
      playerText: 'Waiting on the court',
    });
  });

  it('is gray with the reason when canceled or unavailable', () => {
    expect(courtStatus({ ...base, canceled: true })).toMatchObject({ kind: 'off', text: 'Canceled' });
    expect(courtStatus({ ...base, canceled: true, courtState: 'not_opened' })).toMatchObject({ kind: 'off', text: "Court didn't open" });
    expect(courtStatus({ ...base, bookingStatus: 'unavailable' })).toMatchObject({ kind: 'off', text: 'No court available' });
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
  it('summary counts: booked, needs a court, on the waitlist', async () => {
    const ctx = await setupGroup();
    const [a, b, c] = await upcoming(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/booked`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/booked`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${c.id}/court`, { action: 'waitlist' });
    const d = await dash(ctx);
    const n = courtCounts(d.sessions, Date.parse(d.now));
    expect(n.booked).toBe(2);
    expect(n.waitlist).toBe(1);
    expect(n.needs).toBe(d.sessions.filter((s: any) => Date.parse(s.endsAt) > Date.parse(d.now)).length - 3);
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
    // Texts and money still show there.
    expect(kinds).toContain('daybefore');
  });

  it('keeps the 5-going warning and who owes in "Needs attention"', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await (await playerPhone(ctx, 'Frankie')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    const kinds = buildTodo(await dash(ctx)).map((i) => i.kind);
    expect(kinds).toContain('five');
    expect(kinds).toContain('owed');
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
