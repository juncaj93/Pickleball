import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { cashOutUsedMessage } from '../shared/alerts';
import { potEffect } from '../shared/credit';
import { courtDisplay } from '../src/courtDisplay';
import { balanceOf, heldCents } from '../src/pages/admin/todo';
import { DAY, HOUR, playerPhone, setupGroup, TestApp, withoutIds } from './harness';

// Credit is used automatically the moment a player gets a seat: tapping I'm in,
// a claim link, the organizer adding them, or moving in from a waitlist. It
// takes the smaller of their usable credit (the pot minus a pending cash out)
// and the $14 owed. Full cover is "Paid with credit"; part cover leaves the
// rest owed. Drop, Remove player, cancel and the organizer's Unmark put it
// back. The organizer never uses credit. Nothing that existed before changes.
//
// After every scenario the books are checked (`books`): every balance is the
// sum of its history, none is below $0, no seat is paid or credited above what
// it costs, and Money, Players, per-session and monthly numbers agree.
// Telegram is always a fake here: nothing real is ever sent.

const TZ = 'America/Detroit';
const PRICE = 1400;
type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const TOKEN = '123456:FAKE-test-token-never-real';

/** A group with Alex as the organizer, every future game's court booked, and a fake Telegram that records what it would send. */
async function group(opts: { maxPlayers?: number; noCourt?: boolean } = {}) {
  const app = new TestApp();
  const sent: string[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: '9988776655',
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  if (!opts.noCourt) for (const s of (await dash(ctx)).sessions.filter((x: any) => Date.parse(x.startsAt) > app.now)) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  const texts = async () => (await app.settle(), sent.splice(0));
  return { ...ctx, texts };
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
const joinAll = async (ctx: Ctx, sid: string, names: string[]) => {
  for (const n of names) await join(ctx, sid, n);
};
const drop = async (ctx: Ctx, sid: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/withdraw`, {});
const pot = async (ctx: Ctx, n: string) => (await view(ctx, n)).credit.balanceCents;
const usable = async (ctx: Ctx, n: string) => (await view(ctx, n)).credit.usableCents;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const ledger = (ctx: Ctx, n: string) =>
  ctx.app.db.raw.prepare('SELECT * FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid').all(ctx.byName[n]) as any[];
const liveUsed = (ctx: Ctx, sid: string, n: string) =>
  (ctx.app.db.raw.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(sid, ctx.byName[n]) as any).c as number;
const usedRows = (ctx: Ctx, sid: string, n: string) =>
  ctx.app.db.raw.prepare("SELECT * FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ?").all(sid, ctx.byName[n]) as any[];

/** Put `cents` of credit in a player's pot, as if a canceled October game's payment came back (a real entry). */
async function givePot(ctx: Ctx, name: string, cents: number) {
  const old = await on(ctx, '2026-10-29');
  ctx.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
const askCashOut = async (ctx: Ctx, n: string, cents: number) => {
  const res = await (await playerPhone(ctx, n)).call('POST', '/api/me/refund-request', { cents });
  expect(res.status, res.text).toBe(200);
  return res.data.request.id as string;
};
const request = (ctx: Ctx, n: string) =>
  ctx.app.db.raw.prepare('SELECT * FROM refund_requests WHERE player_id = ? ORDER BY created_at DESC, rowid DESC').get(ctx.byName[n]) as any;

/**
 * The books, checked after every scenario. For every player: the balance on
 * every screen is the sum of their live history, never below $0, and the
 * usable part never above it. No seat has more credit on it than it costs and
 * no paid seat is paid above the price. Money, Players, per-session and
 * monthly numbers agree.
 */
async function books(ctx: Ctx) {
  const d = await dash(ctx);
  const rows = ctx.app.db.raw.prepare('SELECT * FROM credit_ledger').all() as any[];
  for (const p of d.players) {
    const sum = rows.filter((r) => r.player_id === p.id && !r.ended_at).reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
    expect(sum, `${p.name}'s history`).toBeGreaterThanOrEqual(0);
    const shown = d.creditLedger.find((l: any) => l.playerId === p.id)?.balanceCents ?? 0;
    expect(shown, `${p.name}'s balance on Players`).toBe(sum);
    expect(balanceOf(d, p.id).creditCents).toBe(sum);
    if (p.name !== 'Alex' && p.isActive) {
      const v = await view(ctx, p.name);
      expect(v.credit.balanceCents, `${p.name}'s own balance`).toBe(sum);
      expect(v.credit.usableCents).toBeLessThanOrEqual(sum);
      expect(v.credit.usableCents).toBeGreaterThanOrEqual(0);
    }
  }
  for (const s of d.sessions) {
    const price = s.finalized ? s.finalized.priceCents : PRICE;
    for (const r of s.roster) {
      const used = rows.filter((x) => x.kind === 'used' && x.session_id === s.id && x.player_id === r.playerId && !x.ended_at).reduce((n, x) => n + x.amount_cents, 0);
      if (r.isOrganizer) {
        expect(used, 'the organizer never uses credit').toBe(0);
        continue;
      }
      expect(used, `credit on ${r.name}'s seat`).toBeLessThanOrEqual(Math.max(price, r.paymentAmountCents ?? 0));
      if (r.paymentStatus === 'paid' && !r.refundedAt) expect(r.paymentAmountCents ?? 0, `${r.name} paid`).toBeLessThanOrEqual(PRICE);
    }
  }
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  const months = [(await ctx.organizer.call('GET', '/api/admin/money?month=2026-10')).data, (await ctx.organizer.call('GET', '/api/admin/money?month=2026-11')).data];
  expect(months.reduce((n, m) => n + m.creditsOwedCents, 0)).toBe(potTotal);
  for (const m of months) expect(m.sessions.reduce((n: number, s: any) => n + s.collectedCents, 0)).toBe(m.collectedCents);
  expect(months.reduce((n, m) => n + m.heldCents, 0)).toBe(heldCents(d));
  return d;
}

describe('credit is used at I\'m in', () => {
  it('full cover: $14 of credit pays the game at once, "Paid with credit", nothing left', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    expect(await join(ctx, g.id, 'Casey')).toEqual({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0, useCreditCents: 0, creditCents: 0 });
    expect(await pot(ctx, 'Casey')).toBe(0);
    const d = await books(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    // History by game on the Players tab: one use for Nov 3.
    expect(d.creditLedger.find((l: any) => l.playerId === ctx.byName.Casey).entries.map((e: any) => [e.kind, e.cents, e.endedAt])).toEqual([
      ['kept', 1400, null],
      ['used', 1400, null],
    ]);
    // Activity says it happened by itself.
    const lines = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => activityText(e, TZ, 'Alex'));
    expect(lines).toContain('Casey used $14 credit for Tue, Nov 3 (automatic at sign-up)');
  });

  it('part cover: $3 of credit is used, $11 is owed, Pay shows only once the court is booked', async () => {
    const ctx = await group({ noCourt: true });
    await givePot(ctx, 'Casey', 300);
    const g = await on(ctx, '2026-11-03');
    expect(await join(ctx, g.id, 'Casey')).toEqual({ result: 'confirmed', creditCents: 300, paidWithCredit: false });
    // No court yet: "Credit $3 used" shows, the $11 and Pay wait for the court.
    let v = await view(ctx, 'Casey');
    let card = courtDisplay(v).sessions.find((s: any) => s.id === g.id)!.mine;
    expect(card).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, oweCents: 0, useCreditCents: 0 });
    expect(courtDisplay(v).owed).toEqual([]);
    expect(v.credit).toMatchObject({ balanceCents: 0, usableCents: 0 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    v = await view(ctx, 'Casey');
    card = courtDisplay(v).sessions.find((s: any) => s.id === g.id)!.mine;
    expect(card).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, oweCents: 1100, useCreditCents: 0 });
    const d = await books(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, owesCents: 1100 });
    // Paying the rest makes the payment the whole $14 (credit plus cash).
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Casey, paid: true })).status).toBe(200);
    expect(seat(await books(ctx), g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 300 });
  });

  it('no credit: nothing happens; exactly $14: paid; more than $14: only $14 is used', async () => {
    const ctx = await group();
    const g = await on(ctx, '2026-11-03');
    expect(await join(ctx, g.id, 'Blair')).toEqual({ result: 'confirmed' });
    expect(ledger(ctx, 'Blair')).toEqual([]);
    expect(await mine(ctx, 'Blair', g.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, creditCents: 0 });
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 2000);
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await join(ctx, g.id, 'Devon')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await pot(ctx, 'Casey')).toBe(0);
    expect(await pot(ctx, 'Devon')).toBe(600);
    expect(usedRows(ctx, g.id, 'Devon').map((r) => r.amount_cents)).toEqual([1400]);
    await books(ctx);
  });

  it('a game with no court: credit is used at the tap, the court is booked later, then the game is canceled: all of it comes back', async () => {
    const ctx = await group({ noCourt: true });
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 500);
    const g = await on(ctx, '2026-11-05');
    await join(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Devon');
    let v = await view(ctx, 'Casey');
    // Paid with credit shows straight away, even with no court.
    expect(courtDisplay(v).sessions.find((s: any) => s.id === g.id)!.mine).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    await books(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    v = await view(ctx, 'Devon');
    expect(courtDisplay(v).sessions.find((s: any) => s.id === g.id)!.mine).toMatchObject({ creditCents: 500, oweCents: 900 });
    await books(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await pot(ctx, 'Devon')).toBe(500);
    // Back as the same credit (the use ends, "canceled"); no second entry, nothing to choose.
    expect(usedRows(ctx, g.id, 'Casey').map((r) => [r.amount_cents, r.ended_reason])).toEqual([[1400, 'canceled']]);
    expect(ledger(ctx, 'Casey').filter((r) => r.kind === 'kept')).toHaveLength(1);
    expect((await dash(ctx)).refundRequests).toEqual([]);
    await books(ctx);
  });

  it('the organizer never uses credit, even with some in the pot', async () => {
    const ctx = await group();
    await givePot(ctx, 'Alex', 1400);
    const g = await on(ctx, '2026-11-03');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/me`, { in: true })).data).toEqual({ result: 'confirmed' });
    expect(usedRows(ctx, g.id, 'Alex')).toEqual([]);
    expect(seat(await dash(ctx), g.id, 'Alex').paymentStatus).toBe('unpaid');
  });

  it('the organizer adding a player counts as their sign-up', async () => {
    const ctx = await group();
    await givePot(ctx, 'Emery', 1400);
    const g = await on(ctx, '2026-11-03');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Emery, action: 'confirm' })).status).toBe(200);
    expect(seat(await books(ctx), g.id, 'Emery')).toMatchObject({ paymentStatus: 'paid', creditCents: 1400 });
    // Adding them again changes nothing.
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Emery, action: 'confirm' });
    expect(usedRows(ctx, g.id, 'Emery')).toHaveLength(1);
  });
});

describe('dropping out, Undo, Remove player', () => {
  it('drop early and drop late: the credit used goes back at once; rejoin uses it again, once', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 300);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    // Early drop (days before).
    expect((await drop(ctx, g.id, 'Casey')).data).toMatchObject({ result: 'withdrawn' });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    await books(ctx);
    // Back in: the same $14 is used again, once.
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(usedRows(ctx, g.id, 'Casey').map((r) => [r.amount_cents, r.ended_reason])).toEqual([
      [1400, 'dropped'],
      [1400, null],
    ]);
    await books(ctx);
    // Late drop (after the cancellation deadline, before the start).
    ctx.app.now = Date.parse(g.startsAt) - 2 * HOUR;
    expect((await drop(ctx, g.id, 'Devon')).status).toBe(200);
    expect(await pot(ctx, 'Devon')).toBe(300);
    expect(seat(await dash(ctx), g.id, 'Devon').lateDropAt).toBeTruthy();
    expect((await drop(ctx, g.id, 'Casey')).status).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    await books(ctx);
  });

  it('a part-paid seat (credit plus cash) that drops: the credit and the cash both come back as credit, once', async () => {
    const ctx = await group();
    await givePot(ctx, 'Devon', 300);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Devon');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Devon, paid: true });
    await drop(ctx, g.id, 'Devon');
    expect(await pot(ctx, 'Devon')).toBe(1400);
    await books(ctx);
    // A second drop call (a retry) changes nothing.
    await drop(ctx, g.id, 'Devon');
    expect(await pot(ctx, 'Devon')).toBe(1400);
    await books(ctx);
  });

  it('Undo within 5 seconds sends nothing: the credit use is exactly as it was (no refund, no second use)', async () => {
    // The Drop out is held on the phone for 5 seconds (src/hold.ts); Undo throws it away, so the server never hears of it.
    const { startHold, undoHold } = await import('../src/hold');
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    const before = JSON.stringify(ledger(ctx, 'Casey'));
    let sent = 0;
    startHold(g.id, { send: async () => void sent++, settled: async () => {}, undone: () => {} });
    expect(undoHold(g.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toBe(0);
    expect(JSON.stringify(ledger(ctx, 'Casey'))).toBe(before);
    // Tapping I'm in again (what the card does while the hold waits) is already-in: nothing new is used.
    expect(await join(ctx, g.id, 'Casey')).toEqual({ result: 'already_confirmed' });
    expect(JSON.stringify(ledger(ctx, 'Casey'))).toBe(before);
    await books(ctx);
  });

  it('Remove player (the organizer) puts the credit back the same way', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1000);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    expect(await pot(ctx, 'Casey')).toBe(0);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'withdraw' })).status).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(1000);
    expect(usedRows(ctx, g.id, 'Casey').map((r) => r.ended_reason)).toEqual(['dropped']);
    await books(ctx);
  });

  it('the organizer moving someone to the waitlist puts part credit back (a waitlist spot owes nothing)', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 500);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'waitlist' });
    expect(await pot(ctx, 'Casey')).toBe(500);
    await books(ctx);
  });
});

describe('two games, double taps, two phones', () => {
  it('two games back to back: the credit goes to the first; the second gets only what is left', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 2000);
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    expect(await join(ctx, a.id, 'Casey')).toMatchObject({ creditCents: 1400 });
    expect(await join(ctx, b.id, 'Casey')).toEqual({ result: 'confirmed' });
    expect(await mine(ctx, 'Casey', b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, creditCents: 0, useCreditCents: 0 });
    expect(await join(ctx, a.id, 'Devon')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await join(ctx, b.id, 'Devon')).toMatchObject({ creditCents: 600, paidWithCredit: false });
    expect(await pot(ctx, 'Devon')).toBe(0);
    await books(ctx);
  });

  it('two games tapped at the same moment never spend the same credit twice', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    const phone = await playerPhone(ctx, 'Casey');
    const [ra, rb] = await Promise.all([phone.call('POST', `/api/sessions/${a.id}/join`, {}), phone.call('POST', `/api/sessions/${b.id}/join`, {})]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect((ra.data.creditCents ?? 0) + (rb.data.creditCents ?? 0)).toBe(1400);
    expect(liveUsed(ctx, a.id, 'Casey') + liveUsed(ctx, b.id, 'Casey')).toBe(1400);
    expect(await pot(ctx, 'Casey')).toBe(0);
    await books(ctx);
  });

  it('a double tap, a retry and two phones on the same game: one seat, one credit entry', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 2800);
    const g = await on(ctx, '2026-11-03');
    const phone1 = await playerPhone(ctx, 'Casey');
    const phone2 = await playerPhone(ctx, 'Casey');
    const answers = await Promise.all([
      phone1.call('POST', `/api/sessions/${g.id}/join`, {}),
      phone1.call('POST', `/api/sessions/${g.id}/join`, {}),
      phone2.call('POST', `/api/sessions/${g.id}/join`, {}),
    ]);
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    // A retry after a lost answer.
    expect((await phone2.call('POST', `/api/sessions/${g.id}/join`, {})).data).toEqual({ result: 'already_confirmed' });
    expect(usedRows(ctx, g.id, 'Casey').map((r) => r.amount_cents)).toEqual([1400]);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(answers.filter((r) => r.data.creditCents === 1400)).toHaveLength(1);
    await books(ctx);
  });

  it('a failed sign-up uses nothing: a canceled game, a started game', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(409);
    const h = await on(ctx, '2026-11-05');
    ctx.app.now = Date.parse(h.startsAt) + 60_000;
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${h.id}/join`, {})).status).toBe(409);
    expect(ledger(ctx, 'Casey').filter((r) => r.kind === 'used')).toEqual([]);
    await books(ctx);
  });
});

describe('waitlists', () => {
  it('a full booked game: nothing is used on the waitlist tap; credit is used when they move in', async () => {
    const ctx = await group({ maxPlayers: 4 });
    await givePot(ctx, 'Frankie', 1400);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect(await join(ctx, g.id, 'Frankie')).toEqual({ result: 'waitlisted', position: 1 });
    expect(ledger(ctx, 'Frankie').filter((r) => r.kind === 'used')).toEqual([]);
    expect(await pot(ctx, 'Frankie')).toBe(1400);
    await books(ctx);
    await drop(ctx, g.id, 'Emery');
    expect(await mine(ctx, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidWithCredit: true });
    expect(await pot(ctx, 'Frankie')).toBe(0);
    await books(ctx);
  });

  it('on the venue court waitlist (standby) nothing is used until Court opened moves them in', async () => {
    const ctx = await group({ noCourt: true });
    await givePot(ctx, 'Casey', 900);
    const g = await on(ctx, '2026-11-05');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' });
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ result: 'standby' });
    expect(await pot(ctx, 'Casey')).toBe(900);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ status: 'confirmed', creditCents: 900, oweCents: 500 });
    expect(await pot(ctx, 'Casey')).toBe(0);
    await books(ctx);
  });
});

describe('a pending cash out', () => {
  it('the reserved amount is never used by itself; the prompt offers it; Use it (all of it) withdraws the request', async () => {
    const ctx = await group();
    const who = 'Casey';
    await givePot(ctx, who, 1000);
    await askCashOut(ctx, who, 1000);
    await ctx.texts();
    const g = await on(ctx, '2026-11-05');
    const res = await join(ctx, g.id, who);
    expect(res).toEqual({ result: 'confirmed', cashOutOffer: { cents: 1000, requestCents: 1000 } });
    expect(ledger(ctx, who).filter((r) => r.kind === 'used')).toEqual([]);
    expect((await dash(ctx)).refundRequests.map((r: any) => r.cents)).toEqual([1000]);
    const phone = await playerPhone(ctx, who);
    // What the prompt showed must still be true.
    expect((await phone.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 900 })).status).toBe(409);
    const used = await phone.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 });
    expect(used.data).toEqual({ ok: true, usedCents: 1000, paid: false, requestLeftCents: 0 });
    expect(request(ctx, who)).toMatchObject({ status: 'canceled', amount_cents: 1000 });
    expect((await dash(ctx)).refundRequests).toEqual([]);
    expect(await mine(ctx, who, g.id)).toMatchObject({ creditCents: 1000, oweCents: 400 });
    expect(await view(ctx, who).then((v) => v.credit)).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null });
    // One short Telegram line: first name, amount, day.
    expect(await ctx.texts()).toEqual([`Casey withdrew the $10 cash out request (using it for Thu Nov 5)`]);
    // A second tap does nothing more.
    expect((await phone.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 })).status).toBe(409);
    expect(await ctx.texts()).toEqual([]);
    await books(ctx);
  });

  it('part of it: usable credit goes first at the tap, the prompt offers only what is still owed, the Home card shrinks', async () => {
    const ctx = await group();
    await givePot(ctx, 'Devon', 2000);
    await askCashOut(ctx, 'Devon', 1500);
    await ctx.texts();
    const g = await on(ctx, '2026-11-03');
    const res = await join(ctx, g.id, 'Devon');
    // $5 usable is used at once, $9 still owed, and $9 of the $15 request would cover it.
    expect(res).toEqual({ result: 'confirmed', creditCents: 500, paidWithCredit: false, cashOutOffer: { cents: 900, requestCents: 1500 } });
    const used = await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 900 });
    expect(used.data).toEqual({ ok: true, usedCents: 900, paid: true, requestLeftCents: 600 });
    expect(await mine(ctx, 'Devon', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect((await dash(ctx)).refundRequests.map((r: any) => [r.name, r.cents])).toEqual([['Devon', 600]]);
    expect(request(ctx, 'Devon')).toMatchObject({ status: 'pending', amount_cents: 600 });
    expect((await view(ctx, 'Devon')).credit).toMatchObject({ balanceCents: 600, usableCents: 0, pending: { cents: 600 } });
    expect(await ctx.texts()).toEqual(['Devon withdrew $9 of the $15 cash out request (using it for Tue Nov 3)']);
    // The organizer's card said $15 before: Mark refunded for the old amount is refused, the new one works.
    const req = request(ctx, 'Devon');
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded', cents: 1500 })).status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded', cents: 600 })).status).toBe(200);
    expect(await pot(ctx, 'Devon')).toBe(0);
    await books(ctx);
  });

  it('Keep cash out: they are in as normal, nothing more is used, the request stays', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1000);
    await askCashOut(ctx, 'Casey', 1000);
    const g = await on(ctx, '2026-11-03');
    expect((await join(ctx, g.id, 'Casey')).cashOutOffer).toEqual({ cents: 1000, requestCents: 1000 });
    // "No, keep cash out" only closes the prompt: nothing is sent.
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', oweCents: 1400, creditCents: 0 });
    expect((await dash(ctx)).refundRequests.map((r: any) => r.cents)).toEqual([1000]);
    expect(await usable(ctx, 'Casey')).toBe(0);
    await books(ctx);
  });

  it('the prompt shows only when it matters', async () => {
    const ctx = await group();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    // Plenty of usable credit beside the request: covered, no prompt.
    await givePot(ctx, 'Casey', 3000);
    await askCashOut(ctx, 'Casey', 1000);
    expect(await join(ctx, a.id, 'Casey')).toEqual({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    // No request: no prompt.
    await givePot(ctx, 'Devon', 500);
    expect(await join(ctx, a.id, 'Devon')).toEqual({ result: 'confirmed', creditCents: 500, paidWithCredit: false });
    // A request already marked refunded is gone: no prompt.
    await givePot(ctx, 'Emery', 1000);
    await askCashOut(ctx, 'Emery', 1000);
    const req = request(ctx, 'Emery');
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded', cents: 1000 })).status).toBe(200);
    expect(await join(ctx, b.id, 'Emery')).toEqual({ result: 'confirmed' });
    // The waitlist: no prompt (there is no seat yet).
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
    await joinAll(ctx, b.id, ['Blair', 'Frankie', 'Casey']);
    await givePot(ctx, 'Devon', 1000);
    expect(await join(ctx, b.id, 'Devon')).toEqual({ result: 'waitlisted', position: 1 });
    await books(ctx);
  });
});

describe('the organizer, existing sign-ups, finalize', () => {
  it('Who paid marks credit by itself and Unmark puts it back: "Paid with credit" and "Credit $3"', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 300);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Devon');
    let d = await books(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', creditCents: 1400, paymentAmountCents: 1400 });
    expect(seat(d, g.id, 'Devon')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, owesCents: 1100 });
    for (const n of ['Casey', 'Devon']) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName[n], paid: false })).data).toEqual({ ok: true, changed: true });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await pot(ctx, 'Devon')).toBe(300);
    d = await books(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 0, owesCents: 1400 });
    expect(seat(d, g.id, 'Devon')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 0, owesCents: 1400 });
    // History shows the use and the return.
    expect(d.creditLedger.find((l: any) => l.playerId === ctx.byName.Devon).entries.map((e: any) => [e.kind, e.cents, e.endedReason])).toEqual([
      ['kept', 300, null],
      ['used', 300, 'unmarked'],
    ]);
    // Unmark again: nothing there, nothing changes. A player can't do it for themselves.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Devon, paid: false })).data).toEqual({ ok: true, changed: false });
  });

  it('sign-ups from before credit existed are left alone; their manual Use credit still works', async () => {
    const ctx = await group();
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey']);
    const before = JSON.stringify(seat(await dash(ctx), g.id, 'Casey'));
    await givePot(ctx, 'Casey', 1400);
    // Anything that reads or touches the game afterwards does not use it by itself.
    await view(ctx, 'Casey');
    await join(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Devon');
    await drop(ctx, g.id, 'Devon');
    expect(JSON.stringify(seat(await dash(ctx), g.id, 'Casey'))).toBe(before);
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400 });
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/use-credit`, {})).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    await books(ctx);
  });

  it('a 5+ player game: the money back arrives as credit and is NOT used on games they already joined', async () => {
    const ctx = await group();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    await joinAll(ctx, a.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await joinAll(ctx, b.id, ['Blair', 'Casey']);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/payment`, { playerId: ctx.byName[n], paid: true });
    ctx.app.now = Date.parse(a.endsAt) + HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/finalize`, { everyone: true })).status).toBe(200);
    // 5 played: $11 each, $3 back.
    expect(await pot(ctx, 'Casey')).toBe(300);
    expect(await mine(ctx, 'Casey', b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, creditCents: 0, useCreditCents: 300 });
    expect(liveUsed(ctx, b.id, 'Casey')).toBe(0);
    // A game joined after that does use it.
    const c = await on(ctx, '2026-11-10');
    expect(await join(ctx, c.id, 'Devon')).toMatchObject({ creditCents: 300 });
    await books(ctx);
  });

  it('credit used counts as collected in the month the game is played', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    const nov = (await ctx.organizer.call('GET', '/api/admin/money?month=2026-11')).data;
    expect(nov.sessions.find((s: any) => s.id === g.id).collectedCents).toBe(1400);
    await books(ctx);
  });
});

describe('privacy', () => {
  it('a player never sees anyone else\'s credit, and the join answers carry only their own', async () => {
    const ctx = await group();
    await givePot(ctx, 'Casey', 1700);
    await givePot(ctx, 'Devon', 900);
    await askCashOut(ctx, 'Devon', 900);
    const g = await on(ctx, '2026-11-03');
    const answers = [await join(ctx, g.id, 'Casey'), await join(ctx, g.id, 'Devon'), await join(ctx, g.id, 'Blair')];
    expect(answers[2]).toEqual({ result: 'confirmed' });
    const blair = withoutIds(JSON.stringify(await view(ctx, 'Blair')));
    for (const secret of ['$17', '1700', '"300"', '900', 'cashOut']) expect(blair).not.toContain(secret);
    expect((await view(ctx, 'Blair')).credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    expect(JSON.stringify(answers[0])).not.toContain('900');
  });

  it('the Telegram line holds only a first name, the amounts and the day', () => {
    expect(cashOutUsedMessage('Mitchel K.', 1000, 1000, '2026-11-06T00:00:00.000Z', TZ)).toBe('Mitchel withdrew the $10 cash out request (using it for Thu Nov 5)');
    expect(cashOutUsedMessage('Ryan', 400, 1000, '2026-11-04T00:00:00.000Z', TZ)).toBe('Ryan withdrew $4 of the $10 cash out request (using it for Tue Nov 3)');
  });
});

describe('a longer week, books checked at every step', () => {
  it('signs up, drops, rejoins, cash out, cancel, finalize: balances always add up', async () => {
    const ctx = await group();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    const c = await on(ctx, '2026-11-10');
    await givePot(ctx, 'Blair', 2500);
    await givePot(ctx, 'Casey', 300);
    await givePot(ctx, 'Devon', 1400);
    await joinAll(ctx, a.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await books(ctx);
    await joinAll(ctx, b.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await books(ctx);
    await drop(ctx, a.id, 'Devon');
    await books(ctx);
    await askCashOut(ctx, 'Devon', 1400);
    const offer = await join(ctx, c.id, 'Devon');
    expect(offer.cashOutOffer).toEqual({ cents: 1400, requestCents: 1400 });
    await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${c.id}/use-cash-out`, { cents: 1400 });
    await books(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/decision`, { decision: 'cancel', confirm: true });
    await books(ctx);
    for (const n of ['Casey', 'Emery', 'Frankie']) await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/payment`, { playerId: ctx.byName[n], paid: true });
    ctx.app.now = Date.parse(a.endsAt) + HOUR;
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/finalize`, { everyone: true });
    await books(ctx);
    ctx.app.now += 2 * DAY;
    await books(ctx);
  });
});
