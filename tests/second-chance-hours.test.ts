// Zip 35 Part A (audit A-11): Second Chance must never offer a time that runs past the venue's closing time, and a reopen that cannot
// get its new time must leave the game exactly as it was (still canceled, nothing moved, no money touched).
import { describe, expect, it } from 'vitest';
import { playerPhone, sentText, setupGroup, TestApp } from './harness';
import { pickTimes, SECOND_CHANCE } from '../shared/secondChance';
import { BOOKING_HOURS } from '../shared/bookingHours';

const TZ = 'America/Detroit';
const SC_ON = { [SECOND_CHANCE.header]: 'on' };
const HOURS_ON = { ...SC_ON, [BOOKING_HOURS.header]: 'on' };

async function world() {
  const app = new TestApp();
  Object.assign(app.env, {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: '12345',
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      sentText(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  });
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  await w.organizer.call('PUT', '/api/admin/second-chance-switch', { on: true });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = SC_ON) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const game = async (w: W, id: string) => (await dash(w, {})).sessions.find((x: any) => x.id === id);
const act = (w: W, id: string, body: Record<string, unknown>, headers: Record<string, string> = SC_ON) => w.organizer.call('POST', `/api/admin/sessions/${id}/second-chance`, body, headers);
const pot = async (w: W, name: string) => ((await dash(w, {})).creditLedger.find((p: any) => p.playerId === w.byName[name])?.balanceCents ?? 0) as number;
const seats = (w: W, id: string) => w.app.db.raw.prepare('SELECT player_id, status, payment_status, payment_amount_cents, refunded_at FROM session_players WHERE session_id = ? ORDER BY player_id').all(id);
const ledger = (w: W) => w.app.db.raw.prepare('SELECT player_id, kind, amount_cents, session_id FROM credit_ledger ORDER BY id').all();

/** Tue Oct 27, 8:00 PM to 10:00 PM: Alex, Blair, Casey in; Blair paid $14; canceled Monday 9:00 PM (the night before). Now: Tuesday noon. */
async function canceledWithThree(w: W) {
  const s = (await dash(w, {})).sessions.find((x: any) => x.startsAt === '2026-10-28T00:00:00.000Z');
  await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
  for (const n of ['Blair', 'Casey']) {
    await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    await w.app.settle();
  }
  await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName.Blair, paid: true });
  await w.app.settle();
  w.app.now = Date.parse('2026-10-27T01:00:00Z'); // Mon Oct 26, 9:00 PM Eastern
  expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
  w.app.now = Date.parse('2026-10-27T16:00:00Z'); // Tue Oct 27, 12:00 PM Eastern
  return s;
}

const H = (h: number, m = 0) => h * 60 + m;

describe('the times Second Chance offers (shared/secondChance.ts pickTimes)', () => {
  const tueStart = '2026-12-02T01:00:00.000Z'; // Tue Dec 1, 8:00 PM EST, a 2 hour game
  const sunStart = '2026-12-07T00:00:00.000Z'; // Sun Dec 6, 7:00 PM EST
  const noon = Date.parse('2026-12-01T17:00:00.000Z');
  it('hours not known: exactly the old list (every half hour 4:00 to 9:30 PM, plus the game time)', () => {
    expect(pickTimes(tueStart, TZ, noon)).toEqual(Array.from({ length: 12 }, (_, i) => H(16) + i * 30));
  });
  it('hours known, a 2 hour game Mon to Sat: nothing after 8:00 PM (it must END by 10:00 PM)', () => {
    const t = pickTimes(tueStart, TZ, noon, { lengthMs: 2 * 3600_000 });
    expect(t.at(-1)).toBe(H(20));
    expect(t[0]).toBe(H(16));
    expect(t).not.toContain(H(20, 30));
    expect(t).not.toContain(H(21));
  });
  it('hours known, a 1.5 hour game: the last start is 8:30 PM', () => {
    expect(pickTimes(tueStart, TZ, noon, { lengthMs: 90 * 60_000 }).at(-1)).toBe(H(20, 30));
  });
  it('hours known, a Sunday (closes 7:00 PM): a 2 hour game starts by 5:00 PM at the latest', () => {
    const sunNoon = Date.parse('2026-12-06T17:00:00.000Z');
    const t = pickTimes('2026-12-06T22:00:00.000Z', TZ, sunNoon, { lengthMs: 2 * 3600_000 }); // game 5:00 PM
    expect(t.at(-1)).toBe(H(17));
    expect(pickTimes(sunStart, TZ, sunNoon, { lengthMs: 2 * 3600_000 })).not.toContain(H(19)); // its own 7:00 PM start does not fit either
  });
  it('hours known and a game too long for any slot: nothing to offer', () => {
    expect(pickTimes(tueStart, TZ, noon, { lengthMs: 7 * 3600_000 })).toEqual([]);
  });
});

describe('Second Chance reopen with Booking hours', () => {
  it('REPRODUCED ON MAIN: a time past closing is refused up front and the game stays canceled, untouched', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const before = { seats: seats(w, s.id), ledger: ledger(w), pot: await pot(w, 'Blair'), row: await game(w, s.id) };
    expect(before.row.status).toBe('canceled');
    const r = await act(w, s.id, { action: 'reopen', minutes: H(21) }, HOURS_ON); // 9:00 PM + 2 hours = 11:00 PM, closes 10:00 PM
    expect(r.status).toBe(400);
    expect(String(r.data.message ?? r.data.error ?? '')).toMatch(/venue is open|Pick one of the times/);
    const after = await game(w, s.id);
    expect(after.status).toBe('canceled'); // main: reopened (status planned) and then refused
    expect(after.startsAt).toBe(before.row.startsAt);
    expect(seats(w, s.id)).toEqual(before.seats);
    expect(ledger(w)).toEqual(before.ledger);
    expect(await pot(w, 'Blair')).toBe(before.pot);
    const marks = w.app.db.raw.prepare("SELECT task FROM task_log WHERE session_id = ? AND task = 'sc_reopened'").all(s.id);
    expect(marks).toEqual([]); // no "reopened" mark either: the card stays at step 1 or 2
  });
  it('the Home card offers only times that fit, and the dashboard says Booking hours is on', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const d = await dash(w, HOURS_ON);
    expect(d.bookingHours).toBe(true);
    const card = d.secondChance.cards.find((c: any) => c.sessionId === s.id);
    expect(pickTimes(card.startsAt, TZ, Date.parse(d.secondChance.now), { lengthMs: Date.parse(card.endsAt) - Date.parse(card.startsAt) }).at(-1)).toBe(H(20));
  });
  it('a time that fits still reopens, moves the game and keeps every seat', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    expect((await act(w, s.id, { action: 'reopen', minutes: H(19) }, HOURS_ON)).status).toBe(200); // 7:00 PM to 9:00 PM
    const after = await game(w, s.id);
    expect(after.status).not.toBe('canceled');
    expect(after.startsAt).toBe('2026-10-27T23:00:00.000Z');
    expect(after.confirmedCount).toBe(3);
  });
  it('the game own time, when it fits, reopens with no time change', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    expect((await act(w, s.id, { action: 'reopen' }, HOURS_ON)).status).toBe(200);
    expect((await game(w, s.id)).startsAt).toBe('2026-10-28T00:00:00.000Z');
  });
  it('no time fits: says so plainly and changes nothing', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    // A 7 hour game is longer than the venue day: nothing fits. (Made long on purpose; a game already outside the hours exists on live.)
    w.app.db.raw.prepare('UPDATE sessions SET ends_at = ? WHERE id = ?').run('2026-10-28T07:00:00.000Z', s.id);
    const before = { seats: seats(w, s.id), ledger: ledger(w), row: await game(w, s.id) };
    for (const body of [{ action: 'reopen' }, { action: 'reopen', minutes: H(16) }]) {
      const r = await act(w, s.id, body, HOURS_ON);
      expect([400, 409]).toContain(r.status);
      expect(String(r.data.message ?? '')).toMatch(/no time|venue is open|inside the venue/i);
    }
    const after = await game(w, s.id);
    expect(after.status).toBe('canceled');
    expect(after.startsAt).toBe(before.row.startsAt);
    expect(seats(w, s.id)).toEqual(before.seats);
    expect(ledger(w)).toEqual(before.ledger);
  });
  it('a time in the past (a preview pretending it is noon) is refused before anything is reopened', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    w.app.now = Date.parse('2026-10-27T21:00:00Z'); // really 5:00 PM; a 4:30 PM start is already gone
    const r = await act(w, s.id, { action: 'reopen', minutes: H(16, 30) }, HOURS_ON);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await game(w, s.id)).status).toBe('canceled');
  });
  it('the move failing after the reopen (another game takes the slot in that instant) puts the game back as it was', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const before = { seats: seats(w, s.id), ledger: ledger(w), pot: await pot(w, 'Blair'), row: await game(w, s.id) };
    // The check passes, the reopen goes through, then the move is refused by the database (a clash that appeared in between).
    w.app.db.raw.exec(`CREATE TRIGGER race_move BEFORE UPDATE OF starts_at ON sessions BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: sessions.group_id, sessions.starts_at'); END;`);
    const r = await act(w, s.id, { action: 'reopen', minutes: H(19) }, HOURS_ON);
    w.app.db.raw.exec('DROP TRIGGER race_move');
    expect(r.status).toBe(409);
    const after = await game(w, s.id);
    expect(after.status).toBe('canceled');
    expect(after.startsAt).toBe(before.row.startsAt);
    expect(await pot(w, 'Blair')).toBe(before.pot);
    expect(seats(w, s.id)).toEqual(before.seats);
    const stamp = w.app.db.raw.prepare('SELECT canceled_at, canceled_by FROM sessions WHERE id = ?').get(s.id) as any;
    expect(stamp.canceled_by).toBe('organizer');
    expect(stamp.canceled_at).toBe('2026-10-27T01:00:00.000Z'); // the original cancel time, so the card is still a Second Chance card
    expect((await dash(w)).secondChance.cards).toMatchObject([{ kind: 'chance' }]);
    expect(w.app.db.raw.prepare("SELECT task FROM task_log WHERE session_id = ? AND task = 'sc_reopened'").all(s.id)).toEqual([]);
  });
});

describe('the reopen itself failing after the time was moved', () => {
  it('the original time comes back, the game stays canceled, no mark, no money moved', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const before = { seats: seats(w, s.id), ledger: ledger(w), pot: await pot(w, 'Blair'), row: await game(w, s.id) };
    w.app.db.raw.exec(`CREATE TRIGGER no_reopen BEFORE UPDATE OF canceled_at ON sessions WHEN NEW.canceled_at IS NULL BEGIN SELECT RAISE(ABORT, 'disk said no'); END;`);
    const r = await act(w, s.id, { action: 'reopen', minutes: H(19) }, HOURS_ON);
    w.app.db.raw.exec('DROP TRIGGER no_reopen');
    expect(r.status).toBeGreaterThanOrEqual(400);
    const after = await game(w, s.id);
    expect(after.status).toBe('canceled');
    expect(after.startsAt).toBe(before.row.startsAt);
    expect(after.endsAt).toBe(before.row.endsAt);
    expect(seats(w, s.id)).toEqual(before.seats);
    expect(ledger(w)).toEqual(before.ledger);
    expect(await pot(w, 'Blair')).toBe(before.pot);
    expect(w.app.db.raw.prepare("SELECT task FROM task_log WHERE session_id = ? AND task = 'sc_reopened'").all(s.id)).toEqual([]);
    expect((await dash(w)).secondChance.cards).toMatchObject([{ kind: 'chance' }]);
  });
});

describe('Booking hours OFF: Second Chance behaves exactly as main', () => {
  it('every half hour to 9:30 PM is offered and 9:00 PM reopens and moves, as before', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const d = await dash(w, SC_ON);
    expect(d.bookingHours).toBeUndefined();
    expect(pickTimes('2026-10-28T00:00:00.000Z', TZ, Date.parse(d.secondChance.now)).at(-1)).toBe(H(21, 30));
    expect((await act(w, s.id, { action: 'reopen', minutes: H(21) })).status).toBe(200);
    expect((await game(w, s.id)).startsAt).toBe('2026-10-28T01:00:00.000Z');
  });
  it('a time not on the list is still refused (400) and a taken time still 409, nothing moved', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    expect((await act(w, s.id, { action: 'reopen', minutes: H(19, 7) })).status).toBe(400);
    expect((await game(w, s.id)).status).toBe('canceled');
  });
});
