import { describe, expect, it } from 'vitest';
import { courtDisplay, isNoCourt } from '../src/courtDisplay';
import { courtStatus, courtSwitchOf } from '../shared/court';
import { cancelByCardLine, cancelByIso, cancelByShort, CANCEL_BY_HOURS, zonedTimeToUtc } from '../shared/time';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';

// The organizer cleanup (Nov 2026): the Not booked | Waitlist | Booked switch, automatic cancel-by,
// the paid pill's numbers, Edit game's move, and the organizer's "did anything change?" stamp.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const admin = async (ctx: Ctx, id: string) => (await dash(ctx)).sessions.find((x: any) => x.id === id);
const setCourt = (ctx: Ctx, id: string, status: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status });
const row = (ctx: Ctx, id: string) =>
  ctx.app.db.raw.prepare('SELECT booking_status AS b, court_state AS c, status AS s, cancellation_deadline_at AS d FROM sessions WHERE id = ?').get(id) as { b: string; c: string | null; s: string; d: string | null };
const join = async (ctx: Ctx, name: string, id: string) => (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/join`, {})).data;
const version = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/version')).data.v as string;

describe('the court switch', () => {
  it('changes the status in one tap and it survives a fresh load', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    expect(courtSwitchOf(s)).toBe('not_booked');

    expect((await setCourt(ctx, s.id, 'waitlist')).data).toMatchObject({ ok: true, changed: true, status: 'waitlist' });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('waitlist');

    expect((await setCourt(ctx, s.id, 'booked')).data).toMatchObject({ ok: true, changed: true, status: 'booked' });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('booked');
    expect(row(ctx, s.id)).toMatchObject({ b: 'booked', s: 'booked' });

    expect((await setCourt(ctx, s.id, 'not_booked')).data).toMatchObject({ ok: true, changed: true, status: 'not_booked' });
    expect(courtSwitchOf(await admin(ctx, s.id))).toBe('not_booked');
    expect(row(ctx, s.id)).toMatchObject({ b: 'needs_booking', c: null, s: 'planned' });
  });

  it('reuses the existing third value for Waitlist, and the venue waitlist flag with it, in one write', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await setCourt(ctx, s.id, 'waitlist');
    expect(row(ctx, s.id)).toMatchObject({ b: 'unavailable', c: 'waitlist', s: 'planned' });
    // Booked from Waitlist is "Court opened": the flag becomes 'opened'.
    await setCourt(ctx, s.id, 'booked');
    expect(row(ctx, s.id)).toMatchObject({ b: 'booked', c: 'opened' });
    // Booked back to Waitlist drops the booking, nothing half-way.
    await setCourt(ctx, s.id, 'waitlist');
    expect(row(ctx, s.id)).toMatchObject({ b: 'unavailable', c: 'waitlist', s: 'planned' });
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
    expect((await setCourt(ctx, t.id, 'waitlist')).status).toBe(409);
  });

  it('leaves standby players in order on Waitlist and moves them in when set back to Not booked', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await setCourt(ctx, s.id, 'waitlist');
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'standby', position: 1 });
    expect(await join(ctx, 'Blair', s.id)).toEqual({ result: 'standby', position: 2 });
    expect(await admin(ctx, s.id)).toMatchObject({ confirmedCount: 0, waitlistCount: 2 });
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
    for (const to of ['waitlist', 'not_booked', 'booked', 'waitlist', 'booked']) expect((await setCourt(ctx, s.id, to)).status).toBe(200);
    expect(snap()).toBe(before);
  });
});

describe('Waitlist reads as Not booked for players', () => {
  it('shows the organizer the word Waitlist and players "Court not booked", for both the old third value and the venue flag', () => {
    const base = { canceled: false, started: false, past: false };
    for (const input of [
      { bookingStatus: 'unavailable' as const, courtState: null },
      { bookingStatus: 'needs_booking' as const, courtState: 'waitlist' as const },
      { bookingStatus: 'unavailable' as const, courtState: 'waitlist' as const },
    ]) {
      expect(courtStatus({ ...base, ...input })).toEqual({ kind: 'waitlist', text: 'Waitlist', playerText: 'Court not booked' });
      expect(courtSwitchOf(input)).toBe('waitlist');
    }
  });

  it('old rows holding the old third value now read as Waitlist everywhere the organizer looks', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    ctx.app.db.raw.prepare("UPDATE sessions SET booking_status = 'unavailable', court_state = NULL WHERE id = ?").run(s.id);
    const x = await admin(ctx, s.id);
    expect(courtSwitchOf(x)).toBe('waitlist');
    expect(x.state).toMatchObject({ label: 'court_waitlist' });
    expect(x.state.flags).toMatchObject({ needsBooking: false, courtUnavailable: false });
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
    await setCourt(ctx, s.id, 'waitlist');
    const waitlisted = await shape();
    expect(waitlisted).toEqual(notBooked);
    expect(waitlisted).toMatchObject({ noCourt: true, joinAs: 'in', courtState: null, text: 'Court not booked' });
    // Old row (third value only): the same.
    await setCourt(ctx, s.id, 'not_booked');
    ctx.app.db.raw.prepare("UPDATE sessions SET booking_status = 'unavailable' WHERE id = ?").run(s.id);
    expect(await shape()).toEqual(notBooked);
    // People who tap I'm in during Waitlist are drawn as in, never as waiting.
    await setCourt(ctx, s.id, 'waitlist');
    await join(ctx, 'Blair', s.id);
    const g = courtDisplay((await alex.call('GET', '/api/group')).data);
    const p = g.sessions.find((v: any) => v.id === s.id)!;
    expect(p.waitlist).toEqual([]);
    expect(p.confirmed.map((c: any) => c.name)).toEqual(['Blair']);
    expect(JSON.stringify(p)).not.toMatch(/standby/i);
  });

  it('players get the same look (amber, not blue) for Waitlist as for Not booked, and old third-value rows join like any waitlisted game', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const alex = await playerPhone(ctx, 'Alex');
    const kind = async () => {
      const g = courtDisplay((await alex.call('GET', '/api/group')).data);
      const p = g.sessions.find((v: any) => v.id === s.id)!;
      return courtStatus({ ...p, bookingOpen: true }).kind;
    };
    const plain = await kind();
    await setCourt(ctx, s.id, 'waitlist');
    expect(await kind()).toBe(plain);
    await setCourt(ctx, s.id, 'not_booked');
    ctx.app.db.raw.prepare("UPDATE sessions SET booking_status = 'unavailable', court_state = NULL WHERE id = ?").run(s.id);
    expect(await kind()).toBe(plain);
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'standby', position: 1 });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'not_opened' })).status).toBe(200);
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
    await setCourt(ctx, s.id, 'waitlist');
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
    await step(() => setCourt(ctx, s.id, 'waitlist'));
    await step(() => setCourt(ctx, s.id, 'booked'));
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
