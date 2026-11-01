import { describe, expect, it } from 'vitest';
import { courtCards, PLAYED_ASK_DAYS, visibleTasks } from '../src/pages/admin/doNow';
import { DISMISSIBLE, pruneDismissed, readDismissed, writeDismissed } from '../src/pages/admin/dismiss';
import { DAY, HOUR, PIN, playerPhone, setupGroup } from './harness';

// Admin audit (Sun Nov 1, 2026): the organizer screens. Requested changes 15 (the X on notice
// cards) and 16 (the court card for games never marked Booked), plus every fix the audit made.
// Scenario ids (C1, X3, ...) match docs/AUDIT_SCENARIOS_admin.md.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const ADMIN = 'https://club.example/admin';

/** The organizer's dashboard; signs in again when the fake clock outlived the sign-in. */
async function dash(ctx: Ctx) {
  let r = await ctx.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await ctx.organizer.call('GET', '/api/admin/dashboard');
  }
  return r.data;
}
const setCourt = (ctx: Ctx, id: string, status: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status });
const join = async (ctx: Ctx, name: string, id: string) => (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/join`, {})).data;
const pay = (ctx: Ctx, id: string, name: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[name], paid: true });
const cancel = (ctx: Ctx, id: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true });
const cards = async (ctx: Ctx) => courtCards(await dash(ctx), ctx.app.now, ADMIN).map((c) => `${c.kind}:${c.session.id}`);
const pot = (d: any, ctx: Ctx, name: string) => d.creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
/** Every seat's money, for "nothing moved" checks. */
const seats = (ctx: Ctx) =>
  ctx.app.db.raw.prepare('SELECT session_id, player_id, status, payment_status, payment_amount_cents, refunded_at, played FROM session_players ORDER BY session_id, player_id').all();
const ledger = (ctx: Ctx) => ctx.app.db.raw.prepare('SELECT id, player_id, kind, amount_cents, ended_at FROM credit_ledger ORDER BY id').all();

/** The next upcoming game, and the one after. */
async function games(ctx: Ctx) {
  const d = await dash(ctx);
  return d.sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now && !s.state.flags.canceled);
}

/** Move the clock to a moment relative to a game's start (Eastern days are checked by the code, not here). */
function at(ctx: Ctx, iso: string, offsetMs: number) {
  ctx.app.now = Date.parse(iso) + offsetMs;
}

describe('16: the court card for a game never marked Booked', () => {
  it('C1: a Waitlist game before it is over gets "Court still needs to be booked", one card, no court-open buttons', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'waitlist');
    // Exactly one card for this game (the next Not booked game may have its own).
    expect((await cards(ctx)).filter((c) => c.endsWith(g.id))).toEqual([`book:${g.id}`]);
    // No "no court yet" task card for it as well: one court card per game.
    const tasks = visibleTasks(await dash(ctx), ctx.app.now, ADMIN);
    expect(tasks.filter((t) => t.sessionId === g.id && ['book', 'nocourt', 'nocourt_later'].includes(t.kind))).toEqual([]);
    // Still there during the game, gone once it is over (and its date has not passed yet).
    at(ctx, g.startsAt, HOUR);
    expect(await cards(ctx)).toContain(`book:${g.id}`);
    at(ctx, g.endsAt, 5 * 60_000);
    expect(await cards(ctx)).not.toContain(`book:${g.id}`);
  });

  it('C2: a Not booked game gets the same card when the task list asks about its court (next 2 open to book)', async () => {
    const ctx = await setupGroup();
    const list = await games(ctx);
    const d = await dash(ctx);
    const got = courtCards(d, ctx.app.now, ADMIN);
    // The two soonest Not booked games inside the booking window, as "Court still needs to be booked".
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(2);
    expect(got.every((c) => c.kind === 'book')).toBe(true);
    expect(got[0].session.id).toBe(list[0].id);
    // The no-court task cards are not drawn as well.
    expect(visibleTasks(d, ctx.app.now, ADMIN).some((t) => ['book', 'nocourt', 'nocourt_later'].includes(t.kind))).toBe(false);
  });

  it('C13 / C14: a Booked game gets no court card, before or after; switching to Booked clears the card', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'waitlist');
    await join(ctx, 'Alex', g.id);
    expect(await cards(ctx)).toContain(`book:${g.id}`);
    await setCourt(ctx, g.id, 'booked');
    expect(await cards(ctx)).not.toContain(`book:${g.id}`);
    at(ctx, g.startsAt, 2 * DAY);
    expect((await cards(ctx)).filter((c) => c.endsWith(g.id))).toEqual([]);
  });

  it('C12 / C15 / C16: canceled, finalized or empty past games get no card', async () => {
    const ctx = await setupGroup();
    const [a, b, c] = await games(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) {
      await join(ctx, n, a.id);
      await join(ctx, n, b.id);
    }
    await cancel(ctx, a.id);
    at(ctx, b.endsAt, HOUR);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/finalize`, { everyone: true })).status).toBe(200);
    at(ctx, c.startsAt, 2 * DAY);
    const got = await cards(ctx);
    expect(got.filter((x) => x.endsWith(a.id) || x.endsWith(b.id) || x.endsWith(c.id))).toEqual([]);
  });

  it('C5 / C6 / C17: "Did you guys play?" starts the next Eastern calendar day, not right after the game', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await join(ctx, 'Alex', g.id);
    // 11:59 PM Eastern on the game's own date: still its day (the game's date has not passed).
    const tz = (await dash(ctx)).group.timezone;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(g.startsAt));
    const nextMidnight = (() => {
      // The first moment of the next Eastern day: walk forward from the end in 1-minute steps.
      let t = Date.parse(g.endsAt);
      const fmt = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
      while (fmt(t) === day) t += 60_000;
      return t;
    })();
    ctx.app.now = nextMidnight - 60_000;
    expect(await cards(ctx)).not.toContain(`played:${g.id}`);
    ctx.app.now = nextMidnight;
    expect(await cards(ctx)).toContain(`played:${g.id}`);
    // Not asked forever: after PLAYED_ASK_DAYS days it stops (the Finalize card is still there).
    ctx.app.now = nextMidnight + (PLAYED_ASK_DAYS + 1) * DAY;
    expect(await cards(ctx)).not.toContain(`played:${g.id}`);
  });

  it('C9 / C11: "Yes, we played" changes no money and clears the card on every phone; the Finalize card stays', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'booked');
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, n, g.id);
    await pay(ctx, g.id, 'Alex');
    await setCourt(ctx, g.id, 'not_booked');
    at(ctx, g.startsAt, 2 * DAY);
    expect(await cards(ctx)).toContain(`played:${g.id}`);
    expect(visibleTasks(await dash(ctx), ctx.app.now, ADMIN).some((t) => t.sessionId === g.id)).toBe(false);
    const before = { s: seats(ctx), l: ledger(ctx) };
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/task-mark`, { mark: 'played' })).status).toBe(200);
    expect({ s: seats(ctx), l: ledger(ctx) }).toEqual(before);
    expect(await cards(ctx)).not.toContain(`played:${g.id}`);
    // Now the "finalize who played" task shows (it waited for the answer: one card per game).
    expect(visibleTasks(await dash(ctx), ctx.app.now, ADMIN).some((t) => t.kind === 'finalize' && t.sessionId === g.id)).toBe(true);
    // A second organizer phone reads the same server mark.
    const other = ctx.app.client();
    await other.call('POST', '/api/admin/login', { pin: PIN });
    const d2 = (await other.call('GET', '/api/admin/dashboard')).data;
    expect(courtCards(d2, ctx.app.now, ADMIN).map((c) => c.session.id)).not.toContain(g.id);
    // The game still waits to be finalized.
    expect(d2.sessions.find((s: any) => s.id === g.id).needsFinalize).toBe(true);
    // A double tap is fine.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/task-mark`, { mark: 'played' })).status).toBe(200);
  });

  it('C7 / C8: "Cancel game" uses Cancel session: every paid player gets credit back exactly once, players see it canceled', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'booked');
    for (const n of ['Alex', 'Blair', 'Casey']) await join(ctx, n, g.id);
    await pay(ctx, g.id, 'Alex');
    await pay(ctx, g.id, 'Blair');
    await setCourt(ctx, g.id, 'waitlist');
    at(ctx, g.startsAt, 2 * DAY);
    expect(await cards(ctx)).toContain(`played:${g.id}`);
    // Two taps (double tap, a retry): one cancel, money back once.
    const [r1, r2] = await Promise.all([cancel(ctx, g.id), cancel(ctx, g.id)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    await cancel(ctx, g.id);
    const d = await dash(ctx);
    expect(pot(d, ctx, 'Alex')).toBe(1400);
    expect(pot(d, ctx, 'Blair')).toBe(1400);
    expect(pot(d, ctx, 'Casey')).toBe(0);
    expect(d.sessions.find((s: any) => s.id === g.id).state.flags.canceled).toBe(true);
    expect(courtCards(d, ctx.app.now, ADMIN).map((c) => c.session.id)).not.toContain(g.id);
    const me = await playerPhone(ctx, 'Alex');
    const card = (await me.call('GET', '/api/group')).data.sessions.find((s: any) => s.id === g.id);
    expect(card?.canceled ?? card?.state?.flags?.canceled ?? true).toBe(true);
  });

  it('C18: every one of the 6 switch moves leaves seats, payments and credit as they were', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'booked');
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, n, g.id);
    await pay(ctx, g.id, 'Alex');
    const before = { s: seats(ctx), l: ledger(ctx) };
    for (const [to] of [['waitlist'], ['not_booked'], ['booked'], ['not_booked'], ['waitlist'], ['booked']]) {
      expect((await setCourt(ctx, g.id, to)).status).toBe(200);
      expect({ s: seats(ctx), l: ledger(ctx) }).toEqual(before);
    }
  });

  it('only the new "played" mark was added; a bad mark is refused', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/task-mark`, { mark: 'opened' })).status).toBe(400);
    expect((await ctx.app.client().call('POST', `/api/admin/sessions/${g.id}/task-mark`, { mark: 'played' })).status).toBe(401);
  });
});

describe('15: the X on notice cards', () => {
  it('X8: money and decision cards never get an X; text notices do', () => {
    expect([...DISMISSIBLE].sort()).toEqual(['checkin', 'final', 'need', 'promoted']);
    expect(DISMISSIBLE.has('pay')).toBe(false);
  });

  it('X3 / X4 / X5: a dismissal is kept per card and situation, and a new situation brings the card back', () => {
    const store = new Map<string, string>();
    const get = (k: string) => store.get(k) ?? null;
    const set = (k: string, v: string) => void store.set(k, v);
    writeDismissed({ 'promoted:g1:Spot opened: Casey': 'Casey', 'need:g2': '3' }, set);
    const back = readDismissed(get);
    expect(back).toEqual({ 'promoted:g1:Spot opened: Casey': 'Casey', 'need:g2': '3' });
    // Same situations: kept. Count changed on g2: forgotten (so the card shows again).
    expect(
      pruneDismissed(
        [
          { key: 'promoted:g1:Spot opened: Casey', token: 'Casey' },
          { key: 'need:g2', token: '2' },
        ],
        back,
      ),
    ).toEqual({ 'promoted:g1:Spot opened: Casey': 'Casey' });
  });

  it('X7: storage that throws or holds junk never breaks the page', () => {
    expect(readDismissed(() => { throw new Error('blocked'); })).toEqual({});
    expect(readDismissed(() => '[1,2]')).toEqual({});
    expect(readDismissed(() => '{"a":1,"b":"x"}')).toEqual({ b: 'x' });
    expect(() => writeDismissed({ a: 'b' }, () => { throw new Error('full'); })).not.toThrow();
  });
});
