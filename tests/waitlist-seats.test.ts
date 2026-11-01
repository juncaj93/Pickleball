import { describe, expect, it } from 'vitest';
import { potEffect } from '../shared/credit';
import { courtDisplay } from '../src/courtDisplay';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

// A court set to Waitlist behaves exactly like Not booked for sign-ups: normal seats while there is room,
// credit goes on at I'm in, and a real waitlist exists only when the game is full beyond Max players.
// Moving the switch (Not booked, Waitlist, Booked, any direction) never changes anybody's seat, payment or credit.

type Ctx = Awaited<ReturnType<typeof group>>;
const TZ = 'America/Detroit';

async function group(opts: { maxPlayers?: number } = {}) {
  const ctx = await setupGroup(new TestApp());
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  return ctx;
}
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mine = async (ctx: Ctx, n: string, sid: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === sid).mine;
const join = async (ctx: Ctx, sid: string, n: string) => {
  const res = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/join`, {});
  expect(res.status, res.text).toBe(200);
  return res.data;
};
const drop = async (ctx: Ctx, sid: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/withdraw`, {});
const pot = async (ctx: Ctx, n: string) => (await view(ctx, n)).credit.balanceCents;
const setCourt = (ctx: Ctx, sid: string, status: string) => ctx.organizer.call('POST', `/api/admin/sessions/${sid}/court-status`, { status });
const rows = (ctx: Ctx, sql: string, ...args: string[]) => ctx.app.db.raw.prepare(sql).all(...args) as any[];

async function givePot(ctx: Ctx, name: string, cents: number) {
  const old = await on(ctx, '2026-10-29');
  ctx.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}

/** Seats, payments and credit as stored: the thing moving the switch must never touch. */
const seatsAndMoney = (ctx: Ctx) =>
  JSON.stringify([
    rows(ctx, 'SELECT session_id, player_id, status, claim_seq, confirm_seq, payment_status, paid_at, payment_amount_cents, refunded_at, promoted_at, late_drop_at FROM session_players ORDER BY session_id, player_id'),
    rows(ctx, 'SELECT * FROM credit_ledger ORDER BY id'),
    rows(ctx, 'SELECT * FROM refund_requests ORDER BY id'),
  ]);

/** Rules that must hold after any step. */
async function inv(ctx: Ctx, label = '') {
  const d = await dash(ctx);
  const maxP = d.group.settings.maxPlayers;
  const ledger = rows(ctx, 'SELECT * FROM credit_ledger');
  for (const p of d.players) {
    const sum = ledger.filter((r) => r.player_id === p.id && !r.ended_at).reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
    expect(sum, `${label} ${p.name}'s pot is never below $0`).toBeGreaterThanOrEqual(0);
    // (The organizer's own pot is not listed: they never use credit.)
    if (p.name !== 'Alex') expect(d.creditLedger.find((l: any) => l.playerId === p.id)?.balanceCents ?? 0, `${label} ${p.name}'s balance`).toBe(sum);
  }
  for (const s of d.sessions) {
    const confirmed = s.roster.filter((r: any) => r.status === 'confirmed').length;
    const waiting = s.roster.filter((r: any) => r.status === 'waitlisted').length;
    if (s.state.flags.canceled) continue;
    expect(confirmed, `${label} never above the max`).toBeLessThanOrEqual(maxP);
    // The one rule of this change: a real waitlist exists only when the game is full.
    if (waiting > 0) expect(confirmed, `${label} ${s.startsAt}: someone is waiting but the game is not full`).toBe(maxP);
    for (const r of s.roster) {
      const used = ledger.filter((x) => x.kind === 'used' && x.session_id === s.id && x.player_id === r.playerId && !x.ended_at).reduce((n, x) => n + x.amount_cents, 0);
      expect(used, `${label} credit on ${r.name}'s seat`).toBeLessThanOrEqual(1400);
      if (r.isOrganizer) expect(used, 'the organizer never uses credit').toBe(0);
      if (r.status !== 'confirmed') expect(used, `${label} ${r.name} is not in, so no credit is on the seat`).toBe(0);
    }
  }
}

describe('sign-up on a court set to Waitlist', () => {
  it('I\'m in is a normal seat: counts toward "x of 4 in", and the card shows "Court not booked" with no waiting words', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    for (const n of ['Brandon' in ctx.byName ? 'Brandon' : 'Blair', 'Casey', 'Devon']) expect(await join(ctx, g.id, n)).toEqual({ result: 'confirmed' });
    const shown = courtDisplay(await view(ctx, 'Emery')).sessions.find((s: any) => s.id === g.id)!;
    expect(shown).toMatchObject({ countText: '3 of 4 in', joinAs: 'in', waitlist: [] });
    expect(shown.confirmed).toHaveLength(3);
    expect(JSON.stringify(shown)).not.toMatch(/standby/i);
    expect((await dash(ctx)).sessions.find((s: any) => s.id === g.id)).toMatchObject({ confirmedCount: 3, waitlistCount: 0, courtState: 'waitlist' });
    await inv(ctx);
  });

  it('credit goes on at I\'m in: full cover is "Paid with credit"; part cover leaves the rest; the organizer never uses credit', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 300);
    await givePot(ctx, 'Alex', 1400);
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    expect(await join(ctx, g.id, 'Devon')).toMatchObject({ result: 'confirmed', creditCents: 300 });
    expect(await join(ctx, g.id, 'Alex')).toEqual({ result: 'confirmed' });
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidWithCredit: true, oweCents: 0 });
    expect(await mine(ctx, 'Devon', g.id)).toMatchObject({ status: 'confirmed', creditCents: 300, oweCents: 1100 });
    expect(await pot(ctx, 'Casey')).toBe(0);
    expect(await pot(ctx, 'Devon')).toBe(0);
    expect(rows(ctx, "SELECT 1 FROM credit_ledger WHERE kind = 'used' AND player_id = ?", ctx.byName.Alex)).toEqual([]);
    // On screen: Casey reads "paid", Devon's owed amount stays hidden until the court is booked.
    const casey = courtDisplay(await view(ctx, 'Casey')).sessions.find((s: any) => s.id === g.id)!;
    expect(casey.mine).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
    const devon = courtDisplay(await view(ctx, 'Devon'));
    expect(devon.sessions.find((s: any) => s.id === g.id)!.mine).toMatchObject({ oweCents: 0 });
    expect(devon.payDue.some((o: any) => o.sessionId === g.id)).toBe(false);
    await inv(ctx);
  });

  it('drop and rejoin: the credit goes back, then goes on again once; a held Drop out that is Undone changes nothing', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    await givePot(ctx, 'Casey', 1400);
    await join(ctx, g.id, 'Casey');
    expect(await pot(ctx, 'Casey')).toBe(0);
    expect((await drop(ctx, g.id, 'Casey')).data).toMatchObject({ result: 'withdrawn' });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ result: 'confirmed', creditCents: 1400 });
    expect(await pot(ctx, 'Casey')).toBe(0);
    expect(rows(ctx, "SELECT amount_cents, ended_reason FROM credit_ledger WHERE kind = 'used' AND player_id = ? ORDER BY rowid", ctx.byName.Casey).map((r) => [r.amount_cents, r.ended_reason])).toEqual([
      [1400, 'dropped'],
      [1400, null],
    ]);
    // The phone holds a Drop out for 5 seconds; Undo throws it away and the server never hears of it.
    const { startHold, undoHold } = await import('../src/hold');
    const before = seatsAndMoney(ctx);
    let sent = 0;
    startHold(g.id, { send: async () => void sent++, settled: async () => {}, undone: () => {} });
    expect(undoHold(g.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toBe(0);
    expect(seatsAndMoney(ctx)).toBe(before);
    await inv(ctx);
  });

  it('"Undo" under "Paid with credit" gives the credit back and the seat stays; Use credit puts it on again', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    await givePot(ctx, 'Casey', 1400);
    await join(ctx, g.id, 'Casey');
    const phone = await playerPhone(ctx, 'Casey');
    const undone = await phone.call('POST', `/api/sessions/${g.id}/undo-credit`, {});
    expect(undone.status, undone.text).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid' });
    const used = await phone.call('POST', `/api/sessions/${g.id}/use-credit`, {});
    expect(used.status, used.text).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(0);
    await inv(ctx);
  });
});

describe('a game that is really full has a real waitlist, whatever the court says', () => {
  it('beyond the max a person waits; a drop promotes the first waiter and puts their credit on', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) expect(await join(ctx, g.id, n)).toEqual({ result: 'confirmed' });
    await givePot(ctx, 'Frankie', 1400);
    expect(await join(ctx, g.id, 'Frankie')).toEqual({ result: 'waitlisted', position: 1 });
    expect(await pot(ctx, 'Frankie')).toBe(1400);
    expect((await dash(ctx)).sessions.find((s: any) => s.id === g.id)).toMatchObject({ confirmedCount: 4, waitlistCount: 1 });
    await inv(ctx);
    expect((await drop(ctx, g.id, 'Blair')).status).toBe(200);
    expect(await mine(ctx, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidWithCredit: true });
    expect(await pot(ctx, 'Frankie')).toBe(0);
    expect((await dash(ctx)).sessions.find((s: any) => s.id === g.id)).toMatchObject({ confirmedCount: 4, waitlistCount: 0 });
    await inv(ctx);
  });

  it('the same full game shows the waitlist wording to players (the waiting words are for a full game only)', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, g.id, n);
    await join(ctx, g.id, 'Frankie');
    const frankie = courtDisplay(await view(ctx, 'Frankie')).sessions.find((s: any) => s.id === g.id)!;
    expect(frankie.mine).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect(frankie.waitlist.map((w: any) => w.name)).toEqual(['Frankie']);
    expect(frankie.joinAs).toBe('waitlist');
  });
});

describe('moving the switch never moves a seat, a payment or credit', () => {
  const states = ['not_booked', 'waitlist', 'booked'] as const;
  it('every direction, repeated, with seats paid by credit, paid in cash, unpaid and really waiting', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 300);
    for (const n of ['Casey', 'Devon', 'Blair', 'Emery']) await join(ctx, g.id, n);
    await join(ctx, g.id, 'Frankie'); // real waiter
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const before = seatsAndMoney(ctx);
    for (const from of states) {
      for (const to of states) {
        await setCourt(ctx, g.id, from);
        await setCourt(ctx, g.id, to);
        expect(seatsAndMoney(ctx), `${from} then ${to}`).toBe(before);
        await inv(ctx, `${from}->${to}`);
      }
    }
    // The old endpoints too.
    for (const action of ['waitlist', 'clear'] as const) await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action });
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court-answer`, { booked: false });
    expect(seatsAndMoney(ctx)).toBe(before);
  });

  it('"Court opened" and "Didn\'t open" still work: opened books it with seats unchanged; didn\'t open cancels and gives every credit back', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    const h = await on(ctx, '2026-11-10');
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 500);
    for (const id of [g.id, h.id]) {
      await setCourt(ctx, id, 'waitlist');
      await join(ctx, id, 'Casey');
    }
    await join(ctx, h.id, 'Devon');
    const before = seatsAndMoney(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {})).data).toMatchObject({ ok: true, promoted: 0 });
    expect(seatsAndMoney(ctx)).toBe(before);
    expect((await dash(ctx)).sessions.find((s: any) => s.id === g.id)).toMatchObject({ bookingStatus: 'booked', courtState: 'opened', confirmedCount: 1 });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${h.id}/court`, { action: 'not_opened' })).status).toBe(200);
    expect(await pot(ctx, 'Devon')).toBe(500);
    expect((await dash(ctx)).sessions.find((s: any) => s.id === h.id)).toMatchObject({ courtState: 'not_opened', status: 'canceled' });
    await inv(ctx);
  });
});

describe('random sequences with credit', () => {
  // A small seeded generator, so a failure can be replayed.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: sign-ups, drops, undo, credit, payments and every switch move, with the rules checked after each step`, async () => {
      const ctx = await group({ maxPlayers: 4 });
      const g = await on(ctx, '2026-11-05');
      const h = await on(ctx, '2026-11-10');
      const rand = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Alex'];
      await givePot(ctx, 'Casey', 1400);
      await givePot(ctx, 'Devon', 700);
      await givePot(ctx, 'Frankie', 2800);
      for (let step = 0; step < 40; step++) {
        const sid = pick([g.id, h.id]);
        const n = pick(names);
        const act = pick(['join', 'join', 'drop', 'switch', 'switch', 'pay', 'undo', 'use'] as const);
        const label = `seed ${seed} step ${step} ${act} ${n}`;
        if (act === 'join') await join(ctx, sid, n);
        else if (act === 'drop') await drop(ctx, sid, n);
        else if (act === 'pay') await ctx.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: ctx.byName[n], paid: rand() < 0.5 });
        else if (act === 'undo') await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/undo-credit`, {});
        else if (act === 'use') await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/use-credit`, {});
        else {
          const before = seatsAndMoney(ctx);
          const res = await setCourt(ctx, sid, pick(states2));
          expect([200, 409], label).toContain(res.status);
          expect(seatsAndMoney(ctx), `${label}: the switch changed a seat, payment or credit`).toBe(before);
        }
        await inv(ctx, label);
      }
      ctx.app.advance(HOUR);
    });
  }
});
const states2 = ['not_booked', 'waitlist', 'booked'] as const;

describe('leftover standby seats from before the rule', () => {
  it('the screen draws old standby people as in while there is room, renumbers the rest, and a game that is then full says waitlist', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const g = await on(ctx, '2026-11-05');
    await setCourt(ctx, g.id, 'waitlist');
    await join(ctx, g.id, 'Blair');
    await join(ctx, g.id, 'Casey');
    // Three people left on standby by the old rule, with room for two (the data as the server would send it).
    const raw = await view(ctx, 'Frankie');
    const row = raw.sessions.find((x: any) => x.id === g.id);
    row.waitlist = ['Devon', 'Emery', 'Frankie'].map((name) => ({ name }));
    row.mine = { ...row.mine, status: 'waitlisted', waitlistPosition: 3 };
    row.countText = '2 of 4 in';
    const frankie = courtDisplay(raw).sessions.find((x: any) => x.id === g.id)!;
    expect(frankie.mine).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect(frankie.waitlist.map((w: any) => w.name)).toEqual(['Frankie']);
    expect(frankie).toMatchObject({ full: true, joinAs: 'waitlist' });
    expect(frankie.confirmed.map((c: any) => c.name)).toEqual(['Blair', 'Casey', 'Devon', 'Emery']);
  });
});
