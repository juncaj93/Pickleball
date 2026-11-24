import { describe, expect, it } from 'vitest';
import { courtDisplay, isNoCourt } from '../src/courtDisplay';
import { courtStatus, courtSwitchOf, shownCourt } from '../shared/court';
import { cancelByCardLine, cancelByIso, cancelByShort, CANCEL_BY_HOURS, zonedTimeToUtc } from '../shared/time';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

// The organizer cleanup (Nov 2026): the Not booked | Booked switch (Zip 86 round 2: no court Waitlist), automatic cancel-by,
// the paid pill's numbers, Edit game's move, and the organizer's "did anything change?" stamp.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const admin = async (ctx: Ctx, id: string) => (await dash(ctx)).sessions.find((x: any) => x.id === id);
const setCourt = (ctx: Ctx, id: string, status: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status });
const row = (ctx: Ctx, id: string) =>
  ctx.app.db.raw.prepare('SELECT booking_status AS b, court_state AS c, status AS s, cancellation_deadline_at AS d FROM sessions WHERE id = ?').get(id) as { b: string; c: string | null; s: string; d: string | null };
/** Zip 86 round 2: a game saved on the old court waitlist before it was removed (as the old Waitlist tap wrote it). */
const oldWaitlist = (ctx: Ctx, id: string, b = 'unavailable', c: string | null = 'waitlist') =>
  void ctx.app.db.raw.prepare('UPDATE sessions SET booking_status = ?, court_state = ? WHERE id = ?').run(b, c, id);
const join = async (ctx: Ctx, name: string, id: string) => (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/join`, {})).data;
const version = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/version')).data.v as string;

describe('the court switch', () => {
  it('changes the status in one tap and it survives a fresh load', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect(courtSwitchOf(s)).toBe('not_booked');

    // Zip 86 round 2 (Alex): no court Waitlist; it is refused and changes nothing.
    expect((await setCourt(ctx, s.id, 'waitlist')).status).toBe(400);
    expect(row(ctx, s.id)).toMatchObject({ b: 'needs_booking', c: null, s: 'planned' });

    expect((await setCourt(ctx, s.id, 'booked')).data).toMatchObject({ ok: true, changed: true, status: 'booked' });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('booked');
    expect(row(ctx, s.id)).toMatchObject({ b: 'booked', s: 'booked' });

    expect((await setCourt(ctx, s.id, 'not_booked')).data).toMatchObject({ ok: true, changed: true, status: 'not_booked' });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('not_booked');
    expect(row(ctx, s.id)).toMatchObject({ b: 'needs_booking', c: null, s: 'planned' });
  });

  // Zip 86 round 2 (Alex): no court Waitlist; the switch no longer writes the third value. An old row holding it acts as Not booked.
  it('an old row stored as Waitlist reads as Not booked; Booked clears the old values in one write and logs "court booked"', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    oldWaitlist(ctx, s.id);
    expect(await admin(ctx, s.id)).toMatchObject({ bookingStatus: 'needs_booking', courtState: null });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('not_booked');
    expect((await setCourt(ctx, s.id, 'booked')).data).toMatchObject({ ok: true, changed: true, status: 'booked' });
    expect(row(ctx, s.id)).toMatchObject({ b: 'booked', c: null, s: 'booked' });
    const actions = (ctx.app.db.raw.prepare("SELECT action FROM admin_audit_log WHERE session_id = ? AND action LIKE 'court_%'").all(s.id) as any[]).map((r) => r.action);
    expect(actions).toEqual(['court_booked']);
    // Not booked on an old waitlist row clears the old values too (it is not a no-op).
    oldWaitlist(ctx, s.id);
    expect((await setCourt(ctx, s.id, 'not_booked')).data).toMatchObject({ ok: true, changed: true, status: 'not_booked' });
    expect(row(ctx, s.id)).toMatchObject({ b: 'needs_booking', c: null, s: 'planned' });
  });

  it('does nothing when the chosen segment is already on, and refuses a bad value', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect((await setCourt(ctx, s.id, 'not_booked')).data).toMatchObject({ ok: true, changed: false });
    expect((await setCourt(ctx, s.id, 'unavailable')).status).toBe(400);
    expect((await setCourt(ctx, s.id, '')).status).toBe(400);
    expect(row(ctx, s.id)).toMatchObject({ b: 'needs_booking', c: null });
  });

  it('is refused on a canceled or finished game, and for anyone but the organizer', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const stranger = ctx.app.client();
    expect((await stranger.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' })).status).toBe(401);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect((await setCourt(ctx, s.id, 'booked')).status).toBe(409);
    const t = (await dash(ctx)).sessions.find((x: any) => x.id !== s.id && !x.state.flags.canceled);
    ctx.app.advance(Date.parse(t.endsAt) - ctx.app.now + HOUR);
    expect((await setCourt(ctx, t.id, 'not_booked')).status).toBe(409);
  });

  it('people who sign up on a game stored on the old court Waitlist have normal seats, and the switch never moves a seat', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    oldWaitlist(ctx, s.id);
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'confirmed' });
    expect(await join(ctx, 'Blair', s.id)).toEqual({ result: 'confirmed' });
    expect(await admin(ctx, s.id)).toMatchObject({ confirmedCount: 2, waitlistCount: 0 });
    await setCourt(ctx, s.id, 'not_booked');
    expect(await admin(ctx, s.id)).toMatchObject({ confirmedCount: 2, waitlistCount: 0 });
  });

  it('never touches money: payments and credit are identical before and after any switch', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await setCourt(ctx, s.id, 'booked');
    await join(ctx, 'Alex', s.id);
    await join(ctx, 'Blair', s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const snap = () =>
      JSON.stringify([
        ctx.app.db.raw.prepare('SELECT player_id, status, payment_status, paid_at, payment_amount_cents, refunded_at FROM session_players ORDER BY player_id').all(),
        ctx.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all(),
        ctx.app.db.raw.prepare('SELECT * FROM refund_requests ORDER BY id').all(),
      ]);
    const before = snap();
    // Zip 86 round 2 (Alex): no court Waitlist; two values, plus an old waitlist row switched both ways.
    for (const to of ['not_booked', 'booked', 'not_booked', 'booked']) expect((await setCourt(ctx, s.id, to)).status).toBe(200);
    expect(snap()).toBe(before);
    oldWaitlist(ctx, s.id);
    for (const to of ['not_booked', 'booked']) expect((await setCourt(ctx, s.id, to)).status).toBe(200);
    oldWaitlist(ctx, s.id);
    expect((await setCourt(ctx, s.id, 'booked')).status).toBe(200);
    expect(snap()).toBe(before);
  });
});

// Zip 86 round 2 (Alex): no court Waitlist; an old row holding either old value reads as Not booked for the organizer too.
describe('an old Waitlist row reads as Not booked, for everyone', () => {
  it('shows the organizer and players "Court not booked", for both the old third value and the venue flag', () => {
    const base = { canceled: false, started: false, past: false };
    for (const input of [
      { bookingStatus: 'unavailable' as const, courtState: null },
      { bookingStatus: 'needs_booking' as const, courtState: 'waitlist' as const },
      { bookingStatus: 'unavailable' as const, courtState: 'waitlist' as const },
    ]) {
      const shown = shownCourt(input.bookingStatus, input.courtState);
      expect(shown).toEqual({ bookingStatus: 'needs_booking', courtState: null });
      expect(courtStatus({ ...base, ...shown })).toEqual({ kind: 'needs', text: 'Court not booked', playerText: 'Court not booked' });
      expect(courtStatus({ ...base, bookingStatus: input.bookingStatus, courtState: null })).toEqual({ kind: 'needs', text: 'Court not booked', playerText: 'Court not booked' });
      expect(courtSwitchOf(input)).toBe('not_booked');
    }
  });

  it('old rows holding the old waitlist values now read as Not booked everywhere the organizer looks', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const plain = await admin(ctx, s.id);
    for (const [b, c] of [['unavailable', null], ['needs_booking', 'waitlist'], ['unavailable', 'waitlist']] as const) {
      oldWaitlist(ctx, s.id, b, c);
      const x = await admin(ctx, s.id);
      expect(courtSwitchOf(x)).toBe('not_booked');
      expect(x).toMatchObject({ bookingStatus: 'needs_booking', courtState: null });
      expect(x.state.label).not.toBe('court_waitlist');
      expect(x.state).toEqual(plain.state);
    }
    // The words "Not available" are gone from everything the organizer is sent.
    expect(JSON.stringify(await dash(ctx))).not.toMatch(/Not available|Court not available|No court available/);
  });

  it('the player screen treats a waitlisted game exactly like a game with no court', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const shape = async () => {
      const g = (await alex.call('GET', '/api/group')).data;
      const p = courtDisplay(g).sessions.find((v: any) => v.id === s.id)!;
      return { noCourt: isNoCourt(g.sessions.find((v: any) => v.id === s.id)), joinAs: p.joinAs, countText: p.countText, courtState: p.courtState, waitlist: p.waitlist.length, text: courtStatus({ ...p, bookingOpen: true }).playerText };
    };
    const notBooked = await shape();
    oldWaitlist(ctx, s.id);
    const waitlisted = await shape();
    expect(waitlisted).toEqual(notBooked);
    expect(waitlisted).toMatchObject({ noCourt: true, joinAs: 'in', courtState: null, text: 'Court not booked' });
    // Old row (third value only): the same.
    await setCourt(ctx, s.id, 'not_booked');
    ctx.app.db.raw.prepare("UPDATE sessions SET booking_status = 'unavailable' WHERE id = ?").run(s.id);
    expect(await shape()).toEqual(notBooked);
    // People who tap I'm in on an old waitlist game are drawn as in, never as waiting.
    oldWaitlist(ctx, s.id);
    await join(ctx, 'Blair', s.id);
    const g = courtDisplay((await alex.call('GET', '/api/group')).data);
    const p = g.sessions.find((v: any) => v.id === s.id)!;
    expect(p.waitlist).toEqual([]);
    expect(p.confirmed.map((c: any) => c.name)).toEqual(['Blair']);
    expect(JSON.stringify(p)).not.toMatch(/standby/i);
  });

  it('players get the same look (amber, not blue) for Waitlist as for Not booked, and old third-value rows join like any Not booked game', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const kind = async () => {
      const g = courtDisplay((await alex.call('GET', '/api/group')).data);
      const p = g.sessions.find((v: any) => v.id === s.id)!;
      return courtStatus({ ...p, bookingOpen: true }).kind;
    };
    const plain = await kind();
    oldWaitlist(ctx, s.id);
    expect(await kind()).toBe(plain);
    await setCourt(ctx, s.id, 'not_booked');
    ctx.app.db.raw.prepare("UPDATE sessions SET booking_status = 'unavailable', court_state = NULL WHERE id = ?").run(s.id);
    expect(await kind()).toBe(plain);
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'confirmed' });
    // Zip 86 round 2 (Alex): no court Waitlist; "Didn't open" (the /court route) was removed.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'not_opened' })).status).toBe(404);
    expect(row(ctx, s.id).s).not.toBe('canceled');
  });
});

describe('cancel-by is always 12 hours before the start', () => {
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(zonedTimeToUtc(y, mo, d, h, mi, TZ)).toISOString();

  it('is start minus 12 hours, and shows as a weekday and time', () => {
    expect(CANCEL_BY_HOURS).toBe(12);
    const start = at(2026, 11, 3, 20); // Tue Nov 3, 8:00 PM (Election Day)
    expect(Date.parse(start) - Date.parse(cancelByIso(start))).toBe(12 * HOUR);
    expect(cancelByShort(start, TZ)).toBe('Tue 8:00 AM');
    expect(cancelByShort(at(2026, 11, 5, 19, 30), TZ)).toBe('Thu 7:30 AM');
  });

  it('is exactly 12 real hours across the clock change, and a holiday changes nothing', () => {
    // Sun Nov 1, 2026 the clocks go back at 2:00 AM: 12 hours before 1:00 PM is 12 real hours, not 12 on the wall.
    const sunday = at(2026, 11, 1, 13);
    expect(Date.parse(sunday) - Date.parse(cancelByIso(sunday))).toBe(12 * HOUR);
    for (const start of [at(2026, 11, 26, 19), at(2026, 12, 25, 19), at(2026, 7, 4, 19)]) {
      expect(Date.parse(start) - Date.parse(cancelByIso(start))).toBe(12 * HOUR);
    }
  });

  it('the card line shows only in the last 24 hours before cancel-by, in words', () => {
    const start = at(2026, 11, 3, 20); // cancel-by Tue 8:00 AM
    const cancelBy = Date.parse(cancelByIso(start));
    expect(cancelByCardLine(start, cancelBy - 25 * HOUR, TZ)).toBeNull();
    expect(cancelByCardLine(start, cancelBy - 24 * HOUR - 1, TZ)).toBeNull();
    expect(cancelByCardLine(start, Date.parse(at(2026, 11, 2, 9)), TZ)).toBe('Cancel by 8:00 AM tomorrow');
    expect(cancelByCardLine(start, Date.parse(at(2026, 11, 3, 6)), TZ)).toBe('Cancel by 8:00 AM today');
    expect(cancelByCardLine(start, cancelBy, TZ)).toBeNull();
    expect(cancelByCardLine(start, cancelBy + HOUR, TZ)).toBeNull();
  });

  it('moving a game moves the cancel-by with it (the same server move the old Move session used)', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const startsAt = at(2026, 11, 10, 18, 30);
    const endsAt = at(2026, 11, 10, 20, 30);
    const res = await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt, endsAt });
    expect(res.data).toMatchObject({ ok: true, changed: true });
    const x = await admin(ctx, s.id);
    expect(x.startsAt).toBe(startsAt);
    expect(cancelByShort(x.startsAt, TZ)).toBe('Tue 6:30 AM');
    // The saved value (kept for the drop rules) moved too, and the card never reads it.
    expect(Date.parse(x.startsAt) - Date.parse(x.cancellationDeadlineAt)).toBe(12 * HOUR);
  });

  it('old stored deadlines stay in the database untouched when only the status changes', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.db.raw.prepare('UPDATE sessions SET cancellation_deadline_at = ? WHERE id = ?').run('2026-10-27T10:00:00.000Z', s.id);
    await setCourt(ctx, s.id, 'booked');
    await setCourt(ctx, s.id, 'not_booked');
    expect(row(ctx, s.id).d).toBe('2026-10-27T10:00:00.000Z');
    // The card still says start minus 12 hours, whatever is stored.
    expect(Date.parse(s.startsAt) - Date.parse(cancelByIso(s.startsAt))).toBe(12 * HOUR);
  });
});

describe('Edit game saves a move', () => {
  it('moves a future game, ignores a no-op, and turns down the past and a started game', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const put = (body: object) => ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, body);
    expect((await put({ startsAt: s.startsAt, endsAt: s.endsAt })).data).toMatchObject({ ok: true, changed: false });
    const later = new Date(Date.parse(s.startsAt) + 3 * 86_400_000).toISOString();
    const laterEnd = new Date(Date.parse(s.endsAt) + 3 * 86_400_000).toISOString();
    expect((await put({ startsAt: later, endsAt: laterEnd })).data).toMatchObject({ ok: true, changed: true });
    const past = new Date(ctx.app.now - HOUR).toISOString();
    expect((await put({ startsAt: past, endsAt: new Date(ctx.app.now + HOUR).toISOString() })).status).toBe(400);
    ctx.app.advance(Date.parse(later) - ctx.app.now + 60_000);
    expect((await put({ startsAt: later, endsAt: laterEnd })).status).toBe(409);
  });

  it('moves a holiday game like any other (Election Day to the next day) and the holiday note follows the date', async () => {
    const ctx = await setupGroup();
    const election = (await dash(ctx)).sessions.find((x: any) => x.holiday);
    if (!election) return; // the sample calendar always has one near Nov 3; guard anyway
    const to = new Date(Date.parse(election.startsAt) + 86_400_000).toISOString();
    const toEnd = new Date(Date.parse(election.endsAt) + 86_400_000).toISOString();
    expect((await ctx.organizer.call('PUT', `/api/admin/sessions/${election.id}/time`, { startsAt: to, endsAt: toEnd })).data).toMatchObject({ changed: true });
    const moved = await admin(ctx, election.id);
    expect(Date.parse(moved.startsAt) - Date.parse(cancelByIso(moved.startsAt))).toBe(12 * HOUR);
    expect(moved.holiday).toBeNull();
  });

  it('a move and a status change in one Save both stick (move first, then the switch)', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const to = new Date(Date.parse(s.startsAt) + 7 * 86_400_000).toISOString();
    const toEnd = new Date(Date.parse(s.endsAt) + 7 * 86_400_000).toISOString();
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: to, endsAt: toEnd });
    await setCourt(ctx, s.id, 'booked');
    expect(await admin(ctx, s.id)).toMatchObject({ startsAt: to, bookingStatus: 'booked' });
  });
});

describe('the paid pill numbers', () => {
  it('counts people paid of people in, leaves the organizer out, and is empty when nobody is in', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect(await admin(ctx, s.id)).toMatchObject({ payableCount: 0, paidCount: 0 });
    for (const n of ['Alex', 'Blair', 'Casey']) await join(ctx, n, s.id);
    expect(await admin(ctx, s.id)).toMatchObject({ payableCount: 3, paidCount: 0 });
    for (const n of ['Alex', 'Blair']) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true });
    expect(await admin(ctx, s.id)).toMatchObject({ payableCount: 3, paidCount: 2 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: false });
    expect(await admin(ctx, s.id)).toMatchObject({ payableCount: 3, paidCount: 1 });
  });
});

describe('the organizer change stamp', () => {
  it('is tiny, opaque, not cached, and organizer only', async () => {
    const ctx = await setupGroup();
    const r = await ctx.organizer.call('GET', '/api/admin/version');
    expect(Object.keys(r.data)).toEqual(['v']);
    expect(r.data.v).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect((await ctx.app.client().call('GET', '/api/admin/version')).status).toBe(401);
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('GET', '/api/admin/version')).status).toBe(401);
  });

  it('stays the same while nothing changes and matches the dashboard it was drawn from', async () => {
    const ctx = await setupGroup();
    const a = await version(ctx);
    expect(await version(ctx)).toBe(a);
    expect((await dash(ctx)).version).toBe(a);
  });

  it('changes for a court switch, a sign-up, a payment, a move and a cancel', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const seen = [await version(ctx)];
    const step = async (fn: () => Promise<unknown>) => {
      await fn();
      const v = await version(ctx);
      expect(seen).not.toContain(v);
      seen.push(v);
    };
    await step(() => setCourt(ctx, s.id, 'booked'));
    await step(() => setCourt(ctx, s.id, 'not_booked'));
    await step(() => join(ctx, 'Alex', s.id));
    await step(() => ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true }));
    await step(() =>
      ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, {
        startsAt: new Date(Date.parse(s.startsAt) + 86_400_000).toISOString(),
        endsAt: new Date(Date.parse(s.endsAt) + 86_400_000).toISOString(),
      }),
    );
    await step(() => ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true }));
  });

  it('holds no names, money or numbers (it is a hash)', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Alex', s.id);
    const text = (await ctx.organizer.call('GET', '/api/admin/version')).text;
    expect(text).not.toMatch(/Alex|555|venmo|\$/i);
  });
});

describe('Do this now: one court card per game', () => {
  // Rewritten for the Nov 1 admin audit (item 16): the "no court yet" task cards and the Waitlist question became one
  // court card per game (courtCards). Same sweep: every hour for two weeks, each switch position.
  // Zip 86 round 2 (Alex): no court Waitlist; the old waitlist row (raw SQL) gets the card exactly as Not booked.
  it('Not booked (and an old Waitlist row) get one court card, Booked none, at every hour for two weeks; no "no court yet" task card is drawn', async () => {
    const { visibleTasks, dashboardTasks, courtCards } = await import('../src/pages/admin/doNow');
    const ctx = await setupGroup();
    const first = await firstSession(ctx);
    const family = new Set(['book', 'nocourt', 'nocourt_later']);
    const start = ctx.app.now;
    const seen = { not_booked: 0, old_waitlist: 0, booked: 0 };
    for (const to of ['not_booked', 'old_waitlist', 'booked'] as const) {
      await setCourt(ctx, first.id, to === 'booked' ? 'booked' : 'not_booked');
      if (to === 'old_waitlist') oldWaitlist(ctx, first.id);
      const d = await dash(ctx);
      for (let h = 0; h < 14 * 24; h++) {
        const now = start + h * HOUR;
        const tasks = visibleTasks(d, now, 'https://x/admin');
        expect(tasks.filter((t: any) => family.has(t.kind))).toEqual([]);
        const cards = courtCards(d, now, 'https://x/admin');
        for (const s of d.sessions) expect(cards.filter((c) => c.session.id === s.id).length).toBeLessThanOrEqual(1);
        const mine = cards.filter((c) => c.session.id === first.id);
        // The next game, on an old Waitlist row, gets the card whenever a Not booked one would: before its start once booking opened.
        if (to !== 'booked' && now < Date.parse(first.startsAt) && now >= Date.parse(first.startsAt) - 13 * 24 * HOUR) expect(mine.map((c) => c.kind)).toEqual(['book']);
        seen[to] += mine.length;
        const kinds = tasks.map((t: any) => `${t.sessionId}:${t.kind}`);
        expect(new Set(kinds).size).toBe(kinds.length);
      }
      // The alerts keep coming from the full list, untouched.
      expect(dashboardTasks(d, start + 20 * HOUR, 'https://x/admin').length).toBeGreaterThanOrEqual(visibleTasks(d, start + 20 * HOUR, 'https://x/admin').length);
    }
    expect(seen.not_booked).toBeGreaterThan(0);
    expect(seen.old_waitlist).toBe(seen.not_booked);
    expect(seen.booked).toBe(0);
  });
});
