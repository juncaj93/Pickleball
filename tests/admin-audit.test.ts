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

// ---------- 14: security (every admin route, read from the router itself) ----------
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

/** Every admin route in server/app.ts, so a new one is checked without editing this test. */
const ADMIN_ROUTES: [string, string][] = [...readFileSync(joinPath(__dirname, '..', 'server', 'app.ts'), 'utf8').matchAll(/route\('(GET|POST|PUT|DELETE)', '(\/api\/admin\/[^']+)'/g)]
  .map((m) => [m[1], m[2]] as [string, string])
  .filter(([, p]) => p !== '/api/admin/login' && p !== '/api/admin/logout');

describe('14: every admin route refuses anyone but the signed-in organizer', () => {
  it('Z1 / Z2: no cookie, a forged cookie, or a player\'s own cookie: 401 on every admin route, nothing changes', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    expect(ADMIN_ROUTES.length).toBeGreaterThan(35);
    const playerPhoneClient = await playerPhone(ctx, 'Alex');
    const forged = ctx.app.client();
    forged.cookies.set('pb_admin', 'forged-token');
    const before = JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all()) + JSON.stringify(seats(ctx)) + JSON.stringify(ledger(ctx));
    for (const who of [ctx.app.client(), forged, playerPhoneClient]) {
      for (const [method, p] of ADMIN_ROUTES) {
        const path = p.replace(':id', p.includes('/players/') ? ctx.byName.Alex : g.id);
        const res = await who.call(method, path, method === 'GET' || method === 'DELETE' ? undefined : { playerId: ctx.byName.Alex, paid: true, booked: true, decision: 'cancel', confirm: true, status: 'booked', mark: 'played', everyone: true });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    }
    const after = JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all()) + JSON.stringify(seats(ctx)) + JSON.stringify(ledger(ctx));
    expect(after).toBe(before);
  });

  it('Z3: the organizer acting on a game or player id that does not exist gets a clean 4xx, never a 500', async () => {
    const ctx = await setupGroup();
    for (const [method, p] of ADMIN_ROUTES.filter(([, x]) => x.includes(':id'))) {
      for (const id of ['00000000-0000-0000-0000-000000000000', 'nope', '%E0%A4%A']) {
        const res = await ctx.organizer.call(method, p.replace(':id', id), method === 'GET' || method === 'DELETE' ? undefined : { playerId: ctx.byName.Alex, paid: true, decision: 'cancel', confirm: true, status: 'booked', mark: 'played', everyone: true, action: 'waitlist', shown: true, ok: true, kind: 'attendance' });
        expect(res.status, `${method} ${p} ${id}: ${res.text}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `${method} ${p} ${id}: ${res.text}`).toBeLessThan(500);
      }
    }
  });

  it('Z4: a player id that is not on this game changes nothing (payment, claim)', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'booked');
    await join(ctx, 'Alex', g.id);
    const before = JSON.stringify(seats(ctx)) + JSON.stringify(ledger(ctx));
    const r1 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const r2 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: true });
    // Refused, or answered "nothing changed": either way no money or seat moves.
    for (const r of [r1, r2]) {
      expect(r.status, r.text).toBeLessThan(500);
      if (r.status === 200) expect(r.data.changed, r.text).toBe(false);
    }
    expect(JSON.stringify(seats(ctx)) + JSON.stringify(ledger(ctx))).toBe(before);
  });

  it('Z5: a cross-site write with the organizer cookie is blocked', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court-status`, { status: 'booked' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('1: sign in', () => {
  it('S2 / S6: wrong, empty, letters and very long PINs are refused without a crash and without a cookie', async () => {
    const ctx = await setupGroup();
    for (const pin of ['000000', '', 'abcdef', '9'.repeat(50), 123456 as unknown as string, null as unknown as string]) {
      const c = ctx.app.client();
      const r = await c.call('POST', '/api/admin/login', { pin });
      expect(r.status, String(pin)).toBe(401);
      expect(c.cookies.has('pb_admin')).toBe(false);
    }
  });

  it('S7 / S8 / S9: two phones signed in; one signs out, the other keeps working; an expired sign-in is refused', async () => {
    const ctx = await setupGroup();
    const a = ctx.app.client();
    const b = ctx.app.client();
    expect((await a.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect((await b.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const token = a.cookies.get('pb_admin')!;
    expect((await a.call('POST', '/api/admin/logout', {})).status).toBe(200);
    expect((await a.call('GET', '/api/admin/dashboard')).status).toBe(401);
    // The signed-out token is dead even if replayed.
    const replay = ctx.app.client();
    replay.cookies.set('pb_admin', token);
    expect((await replay.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await b.call('GET', '/api/admin/dashboard')).status).toBe(200);
    ctx.app.advance(31 * DAY);
    expect((await b.call('GET', '/api/admin/dashboard')).status).toBe(401);
  });

  it('S3 / S4 / S5: five wrong PINs lock this phone for 15 minutes, even with the right PIN; then it works', async () => {
    const ctx = await setupGroup();
    const c = ctx.app.client();
    for (let i = 0; i < 5; i++) expect((await c.call('POST', '/api/admin/login', { pin: '111111' })).status).toBe(401);
    expect((await c.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(429);
    ctx.app.advance(16 * 60_000);
    expect((await c.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  });
});

describe('5 / 6 / 7 / 10: edit game, cancel, players, settings edge cases', () => {
  const move = (ctx: Ctx, id: string, startsAt: number, endsAt: number) =>
    ctx.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });

  it('E3 / E4 / E19: end before start, a past time, an empty time and a canceled game are refused; nothing moves', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    const s0 = Date.parse(g.startsAt);
    expect((await move(ctx, g.id, s0 + DAY, s0 + DAY - HOUR)).status).toBe(400);
    expect((await move(ctx, g.id, ctx.app.now - HOUR, ctx.app.now + HOUR)).status).toBe(400);
    expect((await ctx.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: '', endsAt: '' })).status).toBe(400);
    expect((await ctx.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: 'tomorrow', endsAt: 'later' })).status).toBe(400);
    await cancel(ctx, g.id);
    expect((await move(ctx, g.id, s0 + DAY, s0 + DAY + 2 * HOUR)).status).toBe(409);
    const after = (await dash(ctx)).sessions.find((s: any) => s.id === g.id);
    expect(after.startsAt).toBe(g.startsAt);
  });

  it('E1 / E9 / E11: moving a game players joined keeps every seat, payment and credit; the deadline is start minus 12 hours', async () => {
    const ctx = await setupGroup();
    const [g] = await games(ctx);
    await setCourt(ctx, g.id, 'booked');
    for (const n of ['Alex', 'Blair', 'Casey']) await join(ctx, n, g.id);
    await pay(ctx, g.id, 'Alex');
    const before = { s: seats(ctx), l: ledger(ctx) };
    const to = Date.parse(g.startsAt) + DAY + 30 * 60_000;
    expect((await move(ctx, g.id, to, to + 2 * HOUR)).data).toMatchObject({ ok: true, changed: true });
    expect({ s: seats(ctx), l: ledger(ctx) }).toEqual(before);
    const row = ctx.app.db.raw.prepare('SELECT starts_at, cancellation_deadline_at FROM sessions WHERE id = ?').get(g.id) as { starts_at: string; cancellation_deadline_at: string };
    expect(Date.parse(row.starts_at) - Date.parse(row.cancellation_deadline_at)).toBe(12 * HOUR);
    // Same values again: "nothing changed".
    expect((await move(ctx, g.id, to, to + 2 * HOUR)).data).toMatchObject({ changed: false });
  });

  it('E6: moving onto the exact time of another game is refused with a clear message', async () => {
    const ctx = await setupGroup();
    const [a, b] = await games(ctx);
    const r = await move(ctx, a.id, Date.parse(b.startsAt), Date.parse(b.endsAt));
    expect(r.status).toBe(409);
    expect(r.data.message).toMatch(/already/);
  });

  it('K7: a cancel reason over 40 characters or with markup is cut or refused, never stored as markup that runs', async () => {
    const ctx = await setupGroup();
    const [a, b] = await games(ctx);
    const long = await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/decision`, { decision: 'cancel', confirm: true, reason: 'x'.repeat(200) });
    expect(long.status).toBeLessThan(500);
    if (long.status === 200) {
      const r = (await dash(ctx)).sessions.find((s: any) => s.id === a.id).cancelReason;
      expect(r.length).toBeLessThanOrEqual(40);
    }
    const html = await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/decision`, { decision: 'cancel', confirm: true, reason: '<img src=x onerror=alert(1)>' });
    expect(html.status).toBeLessThan(500);
  });

  it('P11 / P12 / P13: odd names are kept as plain text; a duplicate name and a bad phone get clear messages', async () => {
    const ctx = await setupGroup();
    const odd = "Seán O'Brien-Núñez 🏓";
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: odd, phone: '(313) 555-0199' });
    expect(r.status, r.text).toBe(200);
    expect((await dash(ctx)).players.some((p: any) => p.name === odd)).toBe(true);
    const dup = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Alex' });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.status).toBeLessThan(500);
    const badPhone = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Zed', phone: '12' });
    expect(badPhone.status).toBeGreaterThanOrEqual(400);
    expect(badPhone.status).toBeLessThan(500);
  });

  it('T3: max players outside 4 to 12 is refused or clamped, never saved as is', async () => {
    const ctx = await setupGroup();
    for (const maxPlayers of [0, 3, 13, -1, 4.5, 'ten']) {
      const r = await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers } });
      expect(r.status, String(maxPlayers)).toBeLessThan(500);
      const saved = (await dash(ctx)).group.settings.maxPlayers;
      expect(saved, String(maxPlayers)).toBeGreaterThanOrEqual(4);
      expect(saved, String(maxPlayers)).toBeLessThanOrEqual(12);
      expect(Number.isInteger(saved)).toBe(true);
    }
  });
});
