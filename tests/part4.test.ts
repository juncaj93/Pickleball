import { describe, expect, it } from 'vitest';
import { cardWindows } from '../shared/cards';
import {
  confirmationMessage,
  courtWaitlistPollMessage,
  dayBeforeMessage,
  lastCallMessage,
  paymentMessage,
  pollMessage,
  promotionMessage,
  replacementMessage,
} from '../shared/messages';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const NAMES = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function adminSession(ctx: Ctx, id: string) {
  return (await dash(ctx)).sessions.find((x: any) => x.id === id);
}
async function join(ctx: Ctx, name: string, id: string) {
  return (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/join`, {})).data;
}
async function asPlayer(ctx: Ctx, name: string) {
  return (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
}
async function withGale(ctx: Ctx) {
  ctx.byName.Gale = (await ctx.organizer.call('POST', '/api/admin/players', { name: 'Gale' })).data.id;
  return ctx;
}

describe('"I booked it"', () => {
  it('marks the session booked in one tap, with the venue and a 12-hour deadline', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.db.raw.prepare('UPDATE sessions SET cancellation_deadline_at = NULL, venue_name = NULL WHERE id = ?').run(s.id);
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    expect(res.data).toMatchObject({ ok: true });
    const x = await adminSession(ctx, s.id);
    expect(x).toMatchObject({ bookingStatus: 'booked', status: 'booked', venueName: 'Northville Pickleball Club', courtCostCents: null });
    expect(Date.parse(x.startsAt) - Date.parse(x.cancellationDeadlineAt)).toBe(12 * HOUR);
    const p = (await asPlayer(ctx, 'Alex')).sessions.find((v: any) => v.id === s.id);
    expect(p).toMatchObject({ bookingStatus: 'booked' });
    expect((await dash(ctx)).audit[0]).toMatchObject({ action: 'court_booked' });
  });

  it('keeps a saved reservation number and court cost; both stay optional extras', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, {
      bookingStatus: 'needs_booking',
      reservationReference: 'R-9',
      courtCostCents: 4800,
      cancellationDeadlineAt: s.cancellationDeadlineAt,
    });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    expect(await adminSession(ctx, s.id)).toMatchObject({ bookingStatus: 'booked', reservationReference: 'R-9', courtCostCents: 4800 });
  });

  it('never shows or asks for a court number; saved ones stay in the database untouched', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.db.raw.prepare("UPDATE sessions SET court_number = '7' WHERE id = ?").run(s.id);
    // Old screens might still send one: it's ignored, not an error.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, { courtNumber: '9' })).status).toBe(200);
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, { bookingStatus: 'booked', courtNumber: '9', cancellationDeadlineAt: s.cancellationDeadlineAt });
    const row = ctx.app.db.raw.prepare('SELECT court_number AS n FROM sessions WHERE id = ?').get(s.id) as { n: string };
    expect(row.n).toBe('7');
    const admin = (await ctx.organizer.call('GET', '/api/admin/dashboard')).text;
    const player = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).text;
    for (const text of [admin, player]) expect(text).not.toMatch(/courtNumber|court_number|Court #/);
  });
});

describe('court waitlist', () => {
  async function waiting(ctx: Ctx) {
    const s = await firstSession(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'waitlist' })).status).toBe(200);
    return s;
  }

  it('players can only go on standby, in order, owing nothing', async () => {
    const ctx = await setupGroup();
    const s = await waiting(ctx);
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'standby', position: 1 });
    expect(await join(ctx, 'Blair', s.id)).toEqual({ result: 'standby', position: 2 });
    const x = await adminSession(ctx, s.id);
    expect(x).toMatchObject({ courtState: 'waitlist', confirmedCount: 0, waitlistCount: 2 });
    expect(x.state).toMatchObject({ label: 'court_waitlist', text: 'Waiting on the court' });
    expect(x.state.flags.needsBooking).toBe(false);
    expect(x.state.flags.shortOnPlayers).toBe(false);
    const alex = await asPlayer(ctx, 'Alex');
    const row = alex.sessions.find((v: any) => v.id === s.id);
    expect(row).toMatchObject({ courtState: 'waitlist', mine: { status: 'waitlisted', waitlistPosition: 1, oweCents: 0 } });
    expect(alex.owed).toEqual([]);
    // Leaving standby doesn't move anyone in.
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(0);
  });

  it('"Court opened" confirms standby players in order by the 4-or-6 rules, with texts to send and money owed', async () => {
    const ctx = await withGale(await setupGroup());
    const s = await waiting(ctx);
    for (const n of [...NAMES, 'Gale']) await join(ctx, n, s.id);
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    expect(res.data).toEqual({ ok: true, promoted: 6 });
    const x = await adminSession(ctx, s.id);
    expect(x).toMatchObject({ courtState: 'opened', bookingStatus: 'booked', confirmedCount: 6, waitlistCount: 1 });
    expect(x.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.name)).toEqual(NAMES);
    expect(x.roster.find((r: any) => r.status === 'waitlisted').name).toBe('Gale');
    // Every one of them has a text waiting for the organizer.
    expect(x.roster.filter((r: any) => r.promotedAt && !r.promotionNotifiedAt)).toHaveLength(6);
    expect((await dash(ctx)).audit[0]).toMatchObject({ action: 'court_opened', details: { promoted: 6 } });
    const alex = await asPlayer(ctx, 'Alex');
    expect(alex.owed.find((o: any) => o.sessionId === s.id)).toMatchObject({ amountCents: 1400 });
    expect((await asPlayer(ctx, 'Frankie')).owed.find((o: any) => o.sessionId === s.id)).toMatchObject({ amountCents: 900, discount: true });
    // New joiners now follow the normal rules again.
    expect(await join(ctx, 'Gale', s.id)).toMatchObject({ result: 'waitlisted' });
  });

  it('with 5 on standby, the first 4 get in and the 5th waits', async () => {
    const ctx = await setupGroup();
    const s = await waiting(ctx);
    for (const n of NAMES.slice(0, 5)) await join(ctx, n, s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const x = await adminSession(ctx, s.id);
    expect(x.confirmedCount).toBe(4);
    expect(x.roster.find((r: any) => r.status === 'waitlisted').name).toBe('Emery');
  });

  it('"Didn\'t open" marks the session off; standby players see it and owe nothing', async () => {
    const ctx = await setupGroup();
    const s = await waiting(ctx);
    await join(ctx, 'Casey', s.id);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'not_opened' })).status).toBe(200);
    const x = await adminSession(ctx, s.id);
    expect(x).toMatchObject({ courtState: 'not_opened', status: 'canceled', canceledBy: 'court_not_opened' });
    expect(x.state).toMatchObject({ label: 'court_not_opened', text: "Court didn't open" });
    const casey = await asPlayer(ctx, 'Casey');
    expect(casey.sessions.find((v: any) => v.id === s.id)).toMatchObject({ canceled: true, courtState: 'not_opened' });
    expect(casey.owed).toEqual([]);
    expect((await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(409);
  });

  it('"Show this session" brings back one hidden by the first session date', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, firstSessionDate: '2026-11-03' });
    let d = await dash(ctx);
    const thu = d.hiddenSessions.find((h: any) => h.startsAt === '2026-10-30T00:00:00.000Z'); // Thu Oct 29, 8 PM
    expect(thu).toBeTruthy();
    expect(d.sessions.some((x: any) => x.id === thu.id)).toBe(false);
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/show`, { shown: true });
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/court`, { action: 'waitlist' });
    d = await dash(ctx);
    expect(d.sessions[0]).toMatchObject({ id: thu.id, shownEarly: true, courtState: 'waitlist' });
    expect(d.hiddenSessions.some((h: any) => h.id === thu.id)).toBe(false);
    const alex = await asPlayer(ctx, 'Alex');
    expect(alex.sessions[0]).toMatchObject({ id: thu.id, courtState: 'waitlist' });
    // Tue Oct 27 stays hidden.
    expect(alex.sessions.some((x: any) => x.startsAt === '2026-10-28T00:00:00.000Z')).toBe(false);
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/show`, { shown: false });
    expect((await dash(ctx)).sessions.some((x: any) => x.id === thu.id)).toBe(false);
  });

  it('poll text for a court-waitlist session', () => {
    const s = { startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2026-10-30T02:00:00.000Z' };
    expect(courtWaitlistPollMessage(s, TZ, 'https://club.example/g/abc')).toBe(
      "Pickleball Thu, Oct 29, 8:00 to 10:00 PM. I'm on the court waitlist. Want to be ready if it opens? Tap here: https://club.example/g/abc",
    );
    expect(promotionMessage('Ryan', s, TZ, 'court_opened', 1400)).toBe(
      "Good news, Ryan! The court opened up, so you're in for pickleball Thursday, Oct 29, 8:00 to 10:00 PM. You owe $14.",
    );
  });
});

describe('player schedule data', () => {
  it('lists only people who are in (and waiting separately), never everyone', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, n, s.id);
    const row = (await asPlayer(ctx, 'Frankie')).sessions.find((v: any) => v.id === s.id);
    expect(row.confirmed.map((c: any) => c.name)).toEqual(['Alex', 'Blair', 'Casey', 'Devon']);
    expect(row.waitlist.map((c: any) => c.name)).toEqual(['Emery']);
    expect(JSON.stringify(row)).not.toContain('Frankie');
  });

  it('puts money in the session itself: owed, paid, and credit', async () => {
    const ctx = await setupGroup();
    const [s, next] = (await dash(ctx)).sessions;
    for (const n of NAMES) await join(ctx, n, s.id);
    await join(ctx, 'Alex', next.id);
    let alex = await asPlayer(ctx, 'Alex');
    expect(alex.sessions.find((v: any) => v.id === s.id).mine).toMatchObject({ oweCents: 1400, creditCents: 0, paymentStatus: 'unpaid' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    alex = await asPlayer(ctx, 'Alex');
    expect(alex.sessions.find((v: any) => v.id === s.id).mine).toMatchObject({ oweCents: 0, paymentStatus: 'paid' });
    // After 6 played, the credit shows on the next session's row.
    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    alex = await asPlayer(ctx, 'Alex');
    expect(alex.sessions.find((v: any) => v.id === next.id).mine).toMatchObject({ oweCents: 900, creditCents: 500 });
  });

  it('a played session leaves the list; what is still owed moves to the payment card', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Devon', s.id);
    ctx.app.now = Date.parse(s.endsAt) + 30 * HOUR;
    const devon = await asPlayer(ctx, 'Devon');
    expect(devon.sessions.some((v: any) => v.id === s.id)).toBe(false);
    expect(devon.payDue[0]).toMatchObject({ sessionId: s.id, amountCents: 1400, reminder: true });
    expect((await asPlayer(ctx, 'Alex')).payDue).toEqual([]);
  });
});

describe('day-before and last-call cards', () => {
  const start = Date.parse('2026-11-04T01:00:00.000Z'); // Tue Nov 3, 8 PM
  const base = {
    startsAt: new Date(start).toISOString(),
    cancellationDeadlineAt: new Date(start - 12 * HOUR).toISOString(),
    canceled: false,
    dayBeforeDone: false,
    lastCallDone: false,
  };
  const at = (h: number, over = {}) => cardWindows({ ...base, ...over }, start - h * HOUR, DEFAULT_SETTINGS);

  it('opens at 24 hours (day before) and 13 hours (last call), and both close at the deadline', () => {
    expect(at(25)).toEqual({ dayBefore: false, lastCall: false });
    expect(at(24)).toEqual({ dayBefore: true, lastCall: false });
    expect(at(14)).toEqual({ dayBefore: true, lastCall: false });
    expect(at(13)).toEqual({ dayBefore: true, lastCall: true });
    expect(at(12.5)).toEqual({ dayBefore: true, lastCall: true });
    expect(at(12)).toEqual({ dayBefore: false, lastCall: false });
    expect(at(2)).toEqual({ dayBefore: false, lastCall: false });
  });

  it('never for canceled sessions, never after Done, and follows the settings', () => {
    expect(at(20, { canceled: true }).dayBefore).toBe(false);
    expect(at(20, { dayBeforeDone: true }).dayBefore).toBe(false);
    expect(at(13, { lastCallDone: true })).toEqual({ dayBefore: true, lastCall: false });
    const settings = { ...DEFAULT_SETTINGS, lastCallHours: 18 };
    expect(cardWindows(base, start - 17 * HOUR, settings).lastCall).toBe(true);
    // Uses the default deadline when none is saved.
    expect(at(12, { cancellationDeadlineAt: null }).dayBefore).toBe(false);
  });

  it('shows on the dashboard inside the window, and Done hides it on every device', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    expect((await adminSession(ctx, s.id)).cards).toEqual({ dayBefore: true, lastCall: false });
    ctx.app.now = Date.parse(s.startsAt) - 12.5 * HOUR;
    expect((await adminSession(ctx, s.id)).cards).toEqual({ dayBefore: true, lastCall: true });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/card-done`, { card: 'day_before' });
    expect((await adminSession(ctx, s.id)).cards).toEqual({ dayBefore: false, lastCall: true });
    ctx.app.now = Date.parse(s.startsAt) - 11 * HOUR;
    expect((await adminSession(ctx, s.id)).cards).toEqual({ dayBefore: false, lastCall: false });
  });

  it('words the day-before text for how many are in', () => {
    const s = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' };
    const link = 'https://club.example/g/abc';
    const head = 'Pickleball tomorrow, Tue, Nov 3, 8:00 to 10:00 PM.';
    expect(dayBeforeMessage(s, TZ, 3, link)).toBe(`${head} We have 3 in and need 1 more to fill. Sign up here: ${link}`);
    expect(dayBeforeMessage(s, TZ, 1, link)).toBe(`${head} We have 1 in and need 3 more to fill. Sign up here: ${link}`);
    expect(dayBeforeMessage(s, TZ, 4, link)).toBe(`${head} We're set with 4 in. See you there.`);
    expect(dayBeforeMessage(s, TZ, 6, link)).toBe(`${head} We're set with 6 in. See you there.`);
    expect(dayBeforeMessage(s, TZ, 5, link)).toBe(`${head} We have 5, and we need either one more or one fewer. Sign up or drop here: ${link}`);
    expect(lastCallMessage(s, TZ, 4)).toBe("Last call for pickleball tonight, 8:00 to 10:00 PM. We have 4 in. If you can't make it, tell me now.");
  });

  it('no text ever says it was sent, or carries the court cost', () => {
    const s = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' };
    const all = [
      dayBeforeMessage(s, TZ, 3, 'L'),
      dayBeforeMessage(s, TZ, 5, 'L'),
      dayBeforeMessage(s, TZ, 6, 'L'),
      lastCallMessage(s, TZ, 4),
      pollMessage(s, TZ, 'Northville Pickleball Club', 1400),
      courtWaitlistPollMessage(s, TZ, 'L'),
      promotionMessage('A', s, TZ, 'made_six', 900),
      confirmationMessage('A', s, TZ, 'L'),
      paymentMessage('A', 1400, s, TZ, null),
      replacementMessage(s, TZ, 'L'),
    ];
    for (const m of all) {
      expect(m).not.toMatch(/\bsent\b/i);
      expect(m).not.toMatch(/EDT|EST/);
    }
  });
});

describe('holiday hours confirmation', () => {
  it('drops "check venue hours" for that session only, keeps the pill, can be undone, and players never see it', async () => {
    const ctx = await setupGroup();
    const d = await dash(ctx);
    const nov3 = d.sessions.find((x: any) => x.holiday === 'Election Day');
    expect(nov3.holidayHoursOk).toBe(false);
    await ctx.organizer.call('POST', `/api/admin/sessions/${nov3.id}/holiday-hours`, { ok: true });
    let x = await adminSession(ctx, nov3.id);
    expect(x).toMatchObject({ holiday: 'Election Day', holidayHoursOk: true });
    // A second organizer device sees the same thing.
    const other = ctx.app.client();
    other.cookies = new Map(ctx.organizer.cookies);
    expect((await other.call('GET', '/api/admin/dashboard')).data.sessions.find((v: any) => v.id === nov3.id).holidayHoursOk).toBe(true);
    await ctx.organizer.call('POST', `/api/admin/sessions/${nov3.id}/holiday-hours`, { ok: false });
    x = await adminSession(ctx, nov3.id);
    expect(x.holidayHoursOk).toBe(false);
    const player = await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group');
    expect(player.data.sessions.find((v: any) => v.id === nov3.id).holiday).toBe('Election Day');
    expect(player.text).not.toMatch(/venue hours|holidayHours/i);
    expect((await (await playerPhone(ctx, 'Alex')).call('POST', `/api/admin/sessions/${nov3.id}/holiday-hours`, { ok: true })).status).toBe(401);
  });
});
