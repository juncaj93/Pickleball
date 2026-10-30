// Independent audit of the money and privacy rules in NEW_RULES.md (sections
// 3 to 8, 14 and 16). These tests try to break the model: every N with and
// without the organizer, no-shows, partial credit, unpaid players, drops,
// cancels, the waitlist, refund requests, reopen, racing taps, the clock
// change, and the numbers agreeing on Money, Players and each game.
//
// Tests marked `// BUG:` fail on purpose: the rules say one thing and the
// code does another.
import { describe, expect, it } from 'vitest';
import { creditBack, finalPrice } from '../shared/pricing';
import { paymentMessage } from '../shared/messages';
import { venmoPayUrl, venmoRefundUrl } from '../shared/money';
import { DAY, HOUR, PLAYER_NAMES, playerPhone, setupGroup, TestApp } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
type Phone = Awaited<ReturnType<typeof playerPhone>>;

const TZ = 'America/Detroit';
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
const ALL = [...PLAYER_NAMES, ...MORE];
const B = 1400;

/** A group of 12 players, the organizer named Robin (not in any game until they tap In). */
async function group(opts: { maxPlayers?: number; app?: TestApp } = {}) {
  const ctx = await setupGroup(opts.app ?? new TestApp());
  for (const [i, name] of MORE.entries()) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` });
  const body: Record<string, unknown> = { organizerName: 'Robin' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  const put = await ctx.organizer.call('PUT', '/api/admin/group', body);
  expect(put.status, put.text).toBe(200);
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.players = dash.data.players;
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  return ctx;
}

const dashboard = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;

/** Reload the player list (the organizer's own player row appears on their first In tap). */
async function refresh(ctx: Ctx) {
  const d = await dashboard(ctx);
  ctx.players = d.players;
  ctx.byName = Object.fromEntries(d.players.map((p: { name: string; id: string }) => [p.name, p.id]));
}

/** The game on a local calendar date. */
async function on(ctx: Ctx, date: string) {
  const d = await dashboard(ctx);
  const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}

/** The next upcoming (not canceled) game, skipping ids given. */
async function nextSession(ctx: Ctx, skip: string[] = []) {
  const d = await dashboard(ctx);
  const s = d.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now && x.status !== 'canceled' && !skip.includes(x.id));
  if (!s) throw new Error('no upcoming session');
  return s;
}

async function joinAll(ctx: Ctx, sessionId: string, names: string[]) {
  const phones: Record<string, Phone> = {};
  for (const name of names) {
    phones[name] = await playerPhone(ctx, name);
    const res = await phones[name].call('POST', `/api/sessions/${sessionId}/join`, {});
    expect(res.status, res.text).toBe(200);
  }
  return phones;
}

const pay = async (ctx: Ctx, sessionId: string, name: string, paid = true) => {
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/payment`, { playerId: ctx.byName[name], paid });
  return res;
};
const payAll = async (ctx: Ctx, sessionId: string, names: string[]) => {
  for (const n of names) expect((await pay(ctx, sessionId, n)).status).toBe(200);
};
const finalize = (ctx: Ctx, sessionId: string, body: Record<string, unknown> = { everyone: true }) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/finalize`, body);
const reopen = (ctx: Ctx, sessionId: string) => ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/reopen`, {});
const cancel = (ctx: Ctx, sessionId: string, extra: Record<string, unknown> = {}) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/decision`, { decision: 'cancel', confirm: true, ...extra });
const organizerIn = (ctx: Ctx, sessionId: string, inGame = true) => ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/me`, { in: inGame });
const withdraw = (phone: Phone, sessionId: string) => phone.call('POST', `/api/sessions/${sessionId}/withdraw`, {});
const useCredit = (phone: Phone, sessionId: string) => phone.call('POST', `/api/sessions/${sessionId}/use-credit`, {});
const requestRefund = (phone: Phone, cents: unknown) => phone.call('POST', '/api/me/refund-request', { cents });
const cancelRequest = (phone: Phone) => phone.call('POST', '/api/me/refund-request/cancel', {});
const resolveRequest = (ctx: Ctx, id: string, action: 'refunded' | 'not_now' | 'undo') => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action });
const refundBalance = (ctx: Ctx, name: string, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-refund`, body);
const groupOf = async (phone: Phone) => (await phone.call('GET', '/api/group')).data;

async function adminSession(ctx: Ctx, id: string) {
  const d = await dashboard(ctx);
  return d.sessions.find((s: any) => s.id === id);
}
const row = (s: any, name: string) => s.roster.find((r: any) => r.name === name);

const endGame = (ctx: Ctx, s: any) => {
  ctx.app.now = Date.parse(s.endsAt) + 5 * 60_000;
};

const monthOf = (s: any) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
const money = async (ctx: Ctx, month: string) => {
  const res = await ctx.organizer.call('GET', `/api/admin/money?month=${month}`);
  expect(res.status, res.text).toBe(200);
  return res.data;
};
const monthFor = (ctx: Ctx, s: any) => money(ctx, monthOf(s));

async function creditOf(ctx: Ctx, name: string) {
  const d = await dashboard(ctx);
  return d.creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
}
async function ledgerOf(ctx: Ctx, name: string) {
  const d = await dashboard(ctx);
  return d.creditLedger.find((l: any) => l.playerId === ctx.byName[name]) ?? { balanceCents: 0, reservedCents: 0, refundCents: 0, entries: [] };
}

/** Give a player credit: they pay for the next game and drop out. Returns the session used. */
async function giveCredit(ctx: Ctx, name: string, skip: string[] = []) {
  const s = await nextSession(ctx, skip);
  const phone = await playerPhone(ctx, name);
  expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  expect((await pay(ctx, s.id, name)).status).toBe(200);
  const out = await withdraw(phone, s.id);
  expect(out.data).toMatchObject({ result: 'withdrawn', creditBackCents: B });
  return { session: s, phone };
}

/**
 * The one-story check: the sum of every pot equals Credits owed summed over
 * every month; Held summed over months equals what paid, unsettled seats hold
 * on games not finalized; each finalized game's Collected equals what its
 * roster paid minus what came back; the court row matches.
 */
async function agree(ctx: Ctx) {
  const d = await dashboard(ctx);
  const months = ['2026-10', '2026-11', '2026-12'];
  const ms = await Promise.all(months.map((m) => money(ctx, m)));
  const pots = d.creditLedger.reduce((sum: number, l: any) => sum + l.balanceCents, 0);
  const owed = ms.reduce((sum, m) => sum + m.creditsOwedCents, 0);
  expect(owed, 'sum of pots = credits owed across months').toBe(pots);
  let held = 0;
  let collected = 0;
  for (const s of d.sessions) {
    const over = ctx.app.now >= Date.parse(s.endsAt);
    const others = s.roster.filter((r: any) => !r.isOrganizer);
    // What the group holds from each seat: a live payment minus what came back, or cash held against an unpaid seat whose price went up.
    const kept = others.reduce(
      (sum: number, r: any) => sum + (r.paymentStatus === 'paid' && !r.refundedAt ? Math.max(0, r.paymentAmountCents - r.creditBackCents) : (r.paidEarlierCents ?? 0)),
      0,
    );
    const unpaidOwes = others.reduce((sum: number, r: any) => sum + r.owesCents, 0);
    const row = ms.flatMap((m) => m.sessions).find((x: any) => x.id === s.id);
    if (s.status === 'canceled') {
      expect(row?.collectedCents ?? 0).toBe(0);
      continue;
    }
    if (s.finalized) {
      expect(row, `money row for ${s.startsAt}`).toBeDefined();
      expect(row.state).toBe('played');
      expect(row.collectedCents, `collected for ${s.startsAt}`).toBe(kept);
      expect(row.playedCount).toBe(s.finalized.playedCount);
      expect(row.priceCents).toBe(s.finalized.priceCents);
      expect(s.finalized.creditBackCents).toBe(others.reduce((sum: number, r: any) => sum + r.creditBackCents, 0));
      collected += kept;
    } else {
      if (row) expect(row.collectedCents).toBe(0);
      if (row) expect(row.state).toBe(over ? (s.roster.some((r: any) => r.status === 'confirmed') || s.bookingStatus === 'booked' ? 'not_finalized' : 'not_played') : 'upcoming');
      held += kept;
    }
    if (s.court) {
      expect(s.court.playersCoverCents, `court row for ${s.startsAt}`).toBe(kept + unpaidOwes);
      expect(s.court.yourShareCents).toBe(Math.max(0, s.court.costCents - kept - unpaidOwes));
    }
  }
  expect(ms.reduce((sum, m) => sum + m.heldCents, 0), 'held across months').toBe(held);
  expect(ms.reduce((sum, m) => sum + m.collectedCents, 0), 'collected across months').toBe(collected);
  for (const m of ms) expect(m.netCents).toBe(m.collectedCents - m.courtCostCents);
  return { dash: d, months: ms };
}

// ---------------------------------------------------------------------------

describe('every N from 4 to 10, everyone paid and played', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    const p = finalPrice(B, n);
    const back = creditBack(B, n);

    it(`${n} play without the organizer: $${p / 100} each, $${back / 100} back each, collected ${n} x $${p / 100}`, async () => {
      const ctx = await group();
      const s = await nextSession(ctx);
      const names = ALL.slice(0, n);
      await joinAll(ctx, s.id, names);
      await payAll(ctx, s.id, names);
      await endGame(ctx, s);
      const fin = await finalize(ctx, s.id);
      expect(fin.status, fin.text).toBe(200);
      expect(fin.data).toMatchObject({ played: n, priceCents: p });
      const view = await adminSession(ctx, s.id);
      expect(view.finalized).toMatchObject({ playedCount: n, priceCents: p, creditBackCents: back * n });
      for (const name of names) {
        expect(row(view, name)).toMatchObject({ played: true, paymentAmountCents: B, creditBackCents: back, owesCents: 0, shareCents: p });
        expect(await creditOf(ctx, name)).toBe(back);
      }
      const m = await monthFor(ctx, s);
      expect(m.collectedCents).toBe(p * n);
      expect(m.creditsOwedCents).toBe(back * n);
      expect(m.heldCents).toBe(0);
      expect(view.court).toMatchObject({ costCents: 4800, playersCoverCents: p * n, yourShareCents: Math.max(0, 4800 - p * n) });
      await agree(ctx);
    });

    it(`${n} play with the organizer: they count in N, never pay, never get credit; collected ${n - 1} x $${p / 100}`, async () => {
      const ctx = await group();
      const s = await nextSession(ctx);
      const names = ALL.slice(0, n - 1);
      await joinAll(ctx, s.id, names);
      expect((await organizerIn(ctx, s.id)).status).toBe(200);
      await payAll(ctx, s.id, names);
      await endGame(ctx, s);
      let view = await adminSession(ctx, s.id);
      expect(view.confirmedCount).toBe(n);
      const fin = await finalize(ctx, s.id);
      expect(fin.status, fin.text).toBe(200);
      expect(fin.data).toMatchObject({ played: n, priceCents: p });
      view = await adminSession(ctx, s.id);
      expect(view.finalized).toMatchObject({ playedCount: n, priceCents: p, creditBackCents: back * (n - 1) });
      const me = view.roster.find((r: any) => r.isOrganizer);
      expect(me).toMatchObject({ played: true, creditBackCents: 0, owesCents: 0, shareCents: null, creditCents: 0 });
      for (const name of names) expect(row(view, name)).toMatchObject({ creditBackCents: back, owesCents: 0 });
      const m = await monthFor(ctx, s);
      expect(m.collectedCents).toBe(p * (n - 1));
      expect(m.creditsOwedCents).toBe(back * (n - 1));
      expect(view.court).toMatchObject({ playersCoverCents: p * (n - 1), yourShareCents: Math.max(0, 4800 - p * (n - 1)) });
      const d = await dashboard(ctx);
      expect(d.creditLedger.some((l: any) => l.playerId === d.me.id)).toBe(false);
      // The organizer's own player screen carries no money.
      await refresh(ctx);
      const mine = await playerPhone(ctx, 'Robin');
      const g = await groupOf(mine);
      expect(g.credit).toMatchObject({ balanceCents: 0, usableCents: 0 });
      expect(g.owed).toEqual([]);
      await agree(ctx);
    });
  }

  it('the organizer in the game but marked as not played: N excludes them, and they still never pay', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const names = ALL.slice(0, 5);
    await joinAll(ctx, s.id, names);
    await organizerIn(ctx, s.id);
    await payAll(ctx, s.id, names);
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id, { played: names.map((x) => ctx.byName[x]) })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    expect(view.roster.find((r: any) => r.isOrganizer)).toMatchObject({ played: false, creditBackCents: 0, owesCents: 0 });
    for (const name of names) expect(row(view, name).creditBackCents).toBe(300);
    expect((await monthFor(ctx, s)).collectedCents).toBe(5500);
    await agree(ctx);
  });

  it('the organizer marked "Court paid" is never credited, collected or held, even when they played', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const names = ALL.slice(0, 4);
    await joinAll(ctx, s.id, names);
    await organizerIn(ctx, s.id);
    await refresh(ctx);
    await payAll(ctx, s.id, names);
    // Mark paid on the organizer's own row means "Court paid".
    expect((await pay(ctx, s.id, 'Robin')).status).toBe(200);
    let m = await monthFor(ctx, s);
    expect(m.heldCents).toBe(4 * B);
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100, creditBackCents: 1200 });
    expect(view.court.paid).toBe(true);
    m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(4400);
    expect(m.creditsOwedCents).toBe(1200);
    expect((await dashboard(ctx)).creditLedger.some((l: any) => l.playerId === ctx.byName.Robin)).toBe(false);
    await agree(ctx);
  });
});

describe('no-shows', () => {
  it('cash no-show: all $14 back as credit, the seat is settled, the others pay the price for the rest', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 7));
    await payAll(ctx, s.id, ALL.slice(0, 7));
    await endGame(ctx, s);
    const played = ALL.slice(0, 6).map((n) => ctx.byName[n]);
    expect((await finalize(ctx, s.id, { played })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 6, priceCents: 900, creditBackCents: 6 * 500 + 1400 });
    expect(row(view, 'Gale')).toMatchObject({ played: false, creditBackCents: 1400, creditBackReason: 'not_played', owesCents: 0, shareCents: null });
    expect(row(view, 'Gale').refundedAt).not.toBeNull();
    expect(await creditOf(ctx, 'Gale')).toBe(1400);
    const m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(6 * 900);
    expect(m.creditsOwedCents).toBe(6 * 500 + 1400);
    // The no-show reads it on their own screen.
    const g = await groupOf(await playerPhone(ctx, 'Gale'));
    expect(g.credit.balanceCents).toBe(1400);
    expect(g.credit.history[0]).toMatchObject({ kind: 'kept', cents: 1400, reason: 'not_played' });
    expect(g.owed).toEqual([]);
    await agree(ctx);
  });

  it('credit no-show: the credit comes back; credit + cash no-show: both come back; unpaid no-show owes nothing', async () => {
    const ctx = await group();
    const { session: s0 } = await giveCredit(ctx, 'Alex');
    const { phone: blair } = await giveCredit(ctx, 'Blair', []);
    // Blair's $14 credit, then they will pay $5 credit + $9 cash on the next game.
    const s = await nextSession(ctx, [s0.id]);
    const phones = await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect((await useCredit(phones.Alex, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    // Blair: request $9 back first so only $5 is usable, use it, then pay the $9 cash.
    expect((await requestRefund(blair, 900)).status).toBe(200);
    expect((await useCredit(phones.Blair, s.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    expect((await pay(ctx, s.id, 'Blair')).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 500 });
    await payAll(ctx, s.id, ['Casey', 'Devon', 'Emery']);
    await endGame(ctx, s);
    const played = ['Casey', 'Devon', 'Emery', 'Frankie'].map((n) => ctx.byName[n]);
    expect((await finalize(ctx, s.id, { played })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 4, priceCents: 1400 });
    expect(row(view, 'Alex')).toMatchObject({ played: false, creditBackCents: 1400, owesCents: 0 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    // Blair: $14 back (the $5 credit and the $9 cash), on top of the $9 still reserved for the refund request.
    expect(row(view, 'Blair')).toMatchObject({ played: false, creditBackCents: 1400, owesCents: 0 });
    expect(await ledgerOf(ctx, 'Blair')).toMatchObject({ balanceCents: 2300, reservedCents: 900, refundCents: 1400 });
    // Frankie played but never paid: owes $14. Nobody who did not play owes.
    expect(row(view, 'Frankie')).toMatchObject({ played: true, owesCents: 1400, paymentStatus: 'unpaid' });
    const m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(3 * 1400);
    await agree(ctx);
  });

  it('a paid player the organizer moved to the waitlist is a no-show at finalize: money back, nothing owed', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 5));
    await payAll(ctx, s.id, ALL.slice(0, 5));
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Emery, action: 'waitlist' })).status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(row(view, 'Emery')).toMatchObject({ status: 'waitlisted', paymentStatus: 'paid', owesCents: 0, shareCents: null });
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 4, priceCents: 1400 });
    expect(row(view, 'Emery')).toMatchObject({ creditBackCents: 1400, owesCents: 0 });
    expect(await creditOf(ctx, 'Emery')).toBe(1400);
    expect((await monthFor(ctx, s)).collectedCents).toBe(4 * 1400);
    await agree(ctx);
  });
});

describe('credit at finalize', () => {
  it('partial credit then a lower price: used $5 on $14, 7 play ($8): owes $3, Venmo is for $3, reminder says $3', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 900)).status).toBe(200);
    const d = await dashboard(ctx);
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(500);
    const s = await nextSession(ctx, [s0.id]);
    const names = ALL.slice(0, 7);
    await joinAll(ctx, s.id, names);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    await payAll(ctx, s.id, names.slice(1));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized.priceCents).toBe(800);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 300, creditCents: 500, shareCents: 800, creditBackCents: 0 });
    const g = await groupOf(alex);
    expect(g.owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 300, creditCents: 500, finalized: true })]);
    expect(g.sessions.find((x: any) => x.id === s.id)).toBeUndefined(); // over: not on the list
    // The Pay button and the reminder use exactly the remainder.
    const venmo = venmoPayUrl(g.group.venmoUrl, g.owed[0].amountCents, 'Pickleball');
    expect(venmo.url).toContain('amount=3&');
    expect(paymentMessage('Alex', row(view, 'Alex').owesCents, [{ startsAt: s.startsAt, endsAt: s.endsAt }], TZ, 'link')).toContain('you owe $3 ');
    // Paying the $3: the payment is the whole $8, nothing back.
    expect((await pay(ctx, s.id, 'Alex')).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 800, owesCents: 0, creditBackCents: 0 });
    expect((await monthFor(ctx, s)).collectedCents).toBe(7 * 800);
    await agree(ctx);
  });

  it('used more credit than the final price: $9 credit on $14, 10 play ($5): paid, $4 back; 6 play ($9): paid, nothing back', async () => {
    for (const [n, back] of [
      [10, 400],
      [6, 0],
    ] as const) {
      const ctx = await group();
      const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
      expect((await requestRefund(alex, 500)).status).toBe(200);
      const d = await dashboard(ctx);
      expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
      expect(await creditOf(ctx, 'Alex')).toBe(900);
      const s = await nextSession(ctx, [s0.id]);
      const names = ALL.slice(0, n);
      await joinAll(ctx, s.id, names);
      expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: false, usedCents: 900 });
      await payAll(ctx, s.id, names.slice(1));
      await endGame(ctx, s);
      expect((await finalize(ctx, s.id)).status).toBe(200);
      const view = await adminSession(ctx, s.id);
      const p = finalPrice(B, n);
      expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, creditCents: 900, creditBackCents: back, owesCents: 0 });
      expect(await creditOf(ctx, 'Alex')).toBe(back);
      expect((await groupOf(alex)).owed).toEqual([]);
      expect((await monthFor(ctx, s)).collectedCents).toBe(p * n);
      await agree(ctx);
    }
  });

  it('unpaid at finalize: owes P not $14, Venmo for exactly P, the Home "who owes" amount is P, reminder says P', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const names = ALL.slice(0, 8);
    const phones = await joinAll(ctx, s.id, names);
    await payAll(ctx, s.id, names.slice(1));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized.priceCents).toBe(700);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 700, shareCents: 700, creditBackCents: 0 });
    const g = await groupOf(phones.Alex);
    expect(g.owed).toEqual([expect.objectContaining({ amountCents: 700, creditCents: 0, finalized: true })]);
    expect(g.payDue).toHaveLength(1);
    expect(venmoPayUrl(g.group.venmoUrl, g.payDue[0].amountCents, 'Pickleball').url).toContain('amount=7&');
    expect(paymentMessage('Alex', row(view, 'Alex').owesCents, [{ startsAt: s.startsAt, endsAt: s.endsAt }], TZ, 'link')).toMatch(/you owe \$7 for/);
    expect(view.court.playersCoverCents).toBe(7 * 700 + 700);
    let m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(7 * 700);
    expect(m.heldCents).toBe(0);
    // Alex uses credit from elsewhere for exactly P.
    await giveCredit(ctx, 'Alex', [s.id]);
    expect((await useCredit(phones.Alex, s.id)).data).toMatchObject({ paid: true, usedCents: 700 });
    expect(await creditOf(ctx, 'Alex')).toBe(700);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700, creditCents: 700, owesCents: 0 });
    m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(8 * 700);
    await agree(ctx);
  });

  it('paid, used nothing, then "I paid" with partial credit: payment is cash plus credit and the credit back is the same $3', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 900)).status).toBe(200);
    const d = await dashboard(ctx);
    await resolveRequest(ctx, d.refundRequests[0].id, 'refunded');
    const s = await nextSession(ctx, [s0.id]);
    const names = ALL.slice(0, 5);
    await joinAll(ctx, s.id, names);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    // The player marks the $9 cash paid themselves.
    expect((await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: true })).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 500, selfPaid: true });
    await payAll(ctx, s.id, names.slice(1));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(row(view, 'Alex')).toMatchObject({ creditBackCents: 300, owesCents: 0 });
    expect(await creditOf(ctx, 'Alex')).toBe(300);
    expect((await monthFor(ctx, s)).collectedCents).toBe(5 * 1100);
    await agree(ctx);
  });
});

describe('drops before the game', () => {
  it('cash, credit and unpaid drops, early and late: money becomes credit at once, held drops, nothing is created for unpaid', async () => {
    const app = new TestApp();
    const sent: string[] = [];
    app.env = {
      ...app.env,
      TELEGRAM_BOT_TOKEN: '123456:FAKE-token',
      TELEGRAM_CHAT_ID: '12345',
      TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)).text);
        return new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch,
    };
    const ctx = await group({ app });
    for (const name of ALL) {
      const p = ctx.players.find((x: any) => x.name === name)!;
      await ctx.organizer.call('PUT', `/api/admin/players/${p.id}`, { name, phone: `(313) 555-09${String(ALL.indexOf(name)).padStart(2, '0')}`, venmo: `@${name}VenmoSecret` });
    }
    const { session: s0, phone: casey } = await giveCredit(ctx, 'Casey');
    const s = await nextSession(ctx, [s0.id]);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ['Alex', 'Blair']);
    expect((await useCredit(casey, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    expect((await monthFor(ctx, s)).heldCents).toBe(3 * B);
    // Early (3 days before): Alex paid cash.
    ctx.app.now = Date.parse(s.startsAt) - 3 * DAY;
    expect((await withdraw(phones.Alex, s.id)).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ status: 'withdrawn', creditBackCents: 1400, creditBackReason: 'dropped', lateDropAt: null });
    expect((await monthFor(ctx, s)).heldCents).toBe(2 * B);
    // Late (2 hours before, after the 12-hour deadline): Blair paid cash, Casey paid with credit, Devon paid nothing.
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    expect((await withdraw(phones.Blair, s.id)).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect((await withdraw(casey, s.id)).data).toMatchObject({ result: 'withdrawn', creditBackCents: 0 });
    expect((await withdraw(phones.Devon, s.id)).data).toMatchObject({ result: 'withdrawn', creditBackCents: 0 });
    const view = await adminSession(ctx, s.id);
    expect(row(view, 'Blair').lateDropAt).not.toBeNull();
    expect(row(view, 'Blair')).toMatchObject({ creditBackCents: 1400, creditBackReason: 'dropped' });
    // Casey paid with credit: that credit went back, and the card says "Your $14 is now credit".
    expect(row(view, 'Casey')).toMatchObject({ paymentStatus: 'not_applicable', creditCents: 0, creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(row(view, 'Devon')).toMatchObject({ paymentStatus: 'not_applicable', creditBackCents: 0 });
    expect(await creditOf(ctx, 'Blair')).toBe(1400);
    expect(await creditOf(ctx, 'Casey')).toBe(1400);
    expect(await creditOf(ctx, 'Devon')).toBe(0);
    expect((await ledgerOf(ctx, 'Casey')).entries.filter((e: any) => !e.endedAt)).toEqual([expect.objectContaining({ kind: 'kept', cents: 1400, reason: 'dropped' })]);
    expect((await dashboard(ctx)).creditLedger.some((l: any) => l.playerId === ctx.byName.Devon)).toBe(false);
    expect((await monthFor(ctx, s)).heldCents).toBe(0);
    // The player reads "Your $14 is now credit" on that card.
    const g = await groupOf(phones.Blair);
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ status: 'withdrawn', creditBackCents: 1400 });
    expect(g.credit.balanceCents).toBe(1400);
    // Telegram: the late drops alert, with nothing private in them.
    await app.settle();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.some((t) => t.startsWith('Late drop: Blair dropped out of'))).toBe(true);
    for (const t of sent) {
      expect(t).not.toMatch(/555|VenmoSecret|@|\$/);
    }
    await agree(ctx);
  });

  it('the organizer dropping a paid player from the roster gives credit too', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ['Alex']);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Alex, action: 'withdraw' })).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect((await monthFor(ctx, s)).heldCents).toBe(0);
    await agree(ctx);
  });

  // BUG: paying again for a seat whose first payment already came back as credit. After Alex pays cash, drops
  // (the $14 is credit), rejoins and pays cash AGAIN: (1) the Money tab shows Held $0 for that paid seat, because
  // the seat's payment minus the still-live 'dropped' credit is $0, although the organizer holds a fresh $14 and
  // the ledger still owes Alex $14; the court row is short the same $14; (2) dropping again gives no credit for
  // the second $14, because creditBack() refuses a second 'dropped' entry for the same seat while the first is live,
  // so the pot stays $14 instead of $28 and the seat stays "paid" and unsettled for someone who is out.
  it('paid, out, in, paid cash again, out again: both payments are credit ($28), nothing held', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 5));
    await payAll(ctx, s.id, ['Alex']);
    expect((await withdraw(phones.Alex, s.id)).data.creditBackCents).toBe(1400);
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('confirmed');
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400 });
    // Alex pays cash again (did not use the credit).
    expect((await pay(ctx, s.id, 'Alex')).status).toBe(200);
    expect((await monthFor(ctx, s)).heldCents).toBe(1400);
    const out = await withdraw(phones.Alex, s.id);
    expect(out.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(2800);
    expect((await monthFor(ctx, s)).heldCents).toBe(0);
    await agree(ctx);
  });
});

describe('organizer cancels', () => {
  it('several paid players (cash, credit, credit + cash): credit appears, credit used returns first, no refund card', async () => {
    const ctx = await group();
    const { session: s0, phone: casey } = await giveCredit(ctx, 'Casey');
    const { phone: devon } = await giveCredit(ctx, 'Devon', []);
    const s = await nextSession(ctx, [s0.id]);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 5));
    await payAll(ctx, s.id, ['Alex', 'Blair']);
    expect((await useCredit(casey, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    // Devon: $9 reserved for a refund request, $5 credit used, $9 cash.
    expect((await requestRefund(devon, 900)).status).toBe(200);
    expect((await useCredit(devon, s.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    expect((await pay(ctx, s.id, 'Devon')).status).toBe(200);
    expect((await monthFor(ctx, s)).heldCents).toBe(4 * B);
    ctx.app.now = Date.parse(s.startsAt) - 13 * HOUR;
    expect((await cancel(ctx, s.id, { chargedCents: 4800 })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.chargedCents).toBeNull(); // not asked at 13 hours
    expect(row(view, 'Alex')).toMatchObject({ creditBackCents: 1400, creditBackReason: 'canceled', owesCents: 0, shareCents: null });
    expect(row(view, 'Blair').creditBackCents).toBe(1400);
    expect(row(view, 'Casey')).toMatchObject({ creditBackCents: 1400, creditBackReason: 'canceled', creditCents: 0, paymentStatus: 'unpaid' });
    expect(row(view, 'Devon')).toMatchObject({ creditBackCents: 1400, creditCents: 0 });
    expect(row(view, 'Emery').creditBackCents).toBe(0);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(await creditOf(ctx, 'Blair')).toBe(1400);
    expect(await creditOf(ctx, 'Casey')).toBe(1400);
    expect(await ledgerOf(ctx, 'Devon')).toMatchObject({ balanceCents: 2300, reservedCents: 900, refundCents: 1400 });
    expect(await creditOf(ctx, 'Emery')).toBe(0);
    expect((await ledgerOf(ctx, 'Casey')).entries.filter((e: any) => !e.endedAt)).toHaveLength(1);
    const d = await dashboard(ctx);
    expect(d.refundRequests).toHaveLength(1); // only Devon's own request, no cancel refund cards
    expect(d.refundRequests[0]).toMatchObject({ name: 'Devon', cents: 900 });
    const m = await monthFor(ctx, s);
    expect(m.heldCents).toBe(0);
    expect(m.collectedCents).toBe(0);
    expect(m.sessions.find((x: any) => x.id === s.id)).toMatchObject({ state: 'canceled', charged: false, courtCostCents: 0 });
    // Everyone reads their own credit; nobody owes for a canceled game.
    for (const name of ALL.slice(0, 5)) expect((await groupOf(phones[name])).owed).toEqual([]);
    expect((await groupOf(phones.Alex)).sessions.find((x: any) => x.id === s.id).mine.creditBackCents).toBe(1400);
    // Use credit and Pay are refused on a canceled game.
    expect((await useCredit(phones.Emery, s.id)).status).toBe(409);
    expect((await pay(ctx, s.id, 'Emery')).status).toBe(409);
    await agree(ctx);
  });

  it('"Were you charged" counts at 11 hours and not at 13; a charged cancel counts its court cost only', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ['Alex']);
    ctx.app.now = Date.parse(s.startsAt) - 11 * HOUR;
    expect((await cancel(ctx, s.id, { chargedCents: 4800 })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.chargedCents).toBe(4800);
    expect(row(view, 'Alex').creditBackCents).toBe(1400);
    const m = await monthFor(ctx, s);
    expect(m.sessions.find((x: any) => x.id === s.id)).toMatchObject({ state: 'canceled', charged: true, courtCostCents: 4800, collectedCents: 0 });
    expect(m.courtCostCents).toBe(4800);
    expect(m.netCents).toBe(-4800);
    expect(m.creditsOwedCents).toBe(1400);
    await agree(ctx);
  });

  it('a canceled game reopened: paid players owe again, can use the credit, and a second cancel works', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ['Alex', 'Blair']);
    expect((await cancel(ctx, s.id)).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400, creditBackCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect((await useCredit(phones.Alex, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    // Blair pays cash again instead of using the credit.
    expect((await pay(ctx, s.id, 'Blair')).status).toBe(200);
    expect(await creditOf(ctx, 'Blair')).toBe(1400);
    // BUG: same root cause as the drop case above. Blair's seat was paid $14, canceled (credit), reopened and
    // paid $14 again: the Money tab shows Held $0 for Blair's seat (payment minus the live 'canceled' credit), and
    // a second cancel can't record a second 'canceled' credit for the same seat while the first is live, so Blair's
    // pot is $14 instead of $28 while the seat stays "paid" and unsettled on a canceled game. Alex (paid with credit) is fine.
    expect((await monthFor(ctx, s)).heldCents).toBe(2 * B);
    expect((await cancel(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(await creditOf(ctx, 'Blair')).toBe(2800);
    expect((await monthFor(ctx, s)).heldCents).toBe(0);
    await agree(ctx);
  });
});

describe('the waitlist at the max', () => {
  it('the 11th waits owing nothing; a drop moves them in owing $14 with the Spot opened text; a paid drop still gets credit', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const names = ALL.slice(0, 10);
    const phones = await joinAll(ctx, s.id, names);
    await payAll(ctx, s.id, names);
    const kit = await playerPhone(ctx, 'Kit');
    const lee = await playerPhone(ctx, 'Lee');
    expect((await kit.call('POST', `/api/sessions/${s.id}/join`, {})).data).toMatchObject({ result: 'waitlisted', position: 1 });
    expect((await lee.call('POST', `/api/sessions/${s.id}/join`, {})).data).toMatchObject({ result: 'waitlisted', position: 2 });
    let g = await groupOf(kit);
    let sv = g.sessions.find((x: any) => x.id === s.id);
    expect(sv).toMatchObject({ countText: '10 in, full', full: true, openSpots: 0 });
    expect(sv.mine).toMatchObject({ status: 'waitlisted', waitlistPosition: 1, oweCents: 0, shareCents: null, useCreditCents: 0 });
    expect(g.owed).toEqual([]);
    // Using credit while waitlisted is refused; nothing is owed.
    expect((await useCredit(kit, s.id)).status).toBe(409);
    expect((await pay(ctx, s.id, 'Kit')).status).toBe(409);
    expect((await monthFor(ctx, s)).heldCents).toBe(10 * B);
    // Alex (paid) drops: credit for Alex, Kit moves in owing $14, Lee is first in line.
    expect((await withdraw(phones.Alex, s.id)).data.creditBackCents).toBe(1400);
    g = await groupOf(kit);
    sv = g.sessions.find((x: any) => x.id === s.id);
    expect(sv.mine).toMatchObject({ status: 'confirmed', promotion: 'spot_opened', oweCents: 1400, shareCents: 1400, paymentStatus: 'unpaid' });
    expect(g.owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 1400 })]);
    expect((await groupOf(lee)).sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    const view = await adminSession(ctx, s.id);
    expect(view.confirmedCount).toBe(10);
    expect(view.waitlistCount).toBe(1);
    expect(row(view, 'Kit')).toMatchObject({ promotionReason: 'spot_opened', owesCents: 1400, promotionNotifiedAt: null });
    expect((await monthFor(ctx, s)).heldCents).toBe(9 * B);
    // Kit pays, everyone plays: 10 played at $5, Alex's $14 is credit from the drop (not from the game).
    await pay(ctx, s.id, 'Kit');
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const fin = await adminSession(ctx, s.id);
    // The game's credit-back total also counts Alex's $14 from the drop (it is this game's seat).
    expect(fin.finalized).toMatchObject({ playedCount: 10, priceCents: 500, creditBackCents: 10 * 900 + 1400 });
    expect(row(fin, 'Alex')).toMatchObject({ status: 'withdrawn', played: null, creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(row(fin, 'Lee')).toMatchObject({ status: 'waitlisted', played: null, creditBackCents: 0, owesCents: 0 });
    expect((await monthFor(ctx, s)).collectedCents).toBe(10 * 500);
    await agree(ctx);
  });

  it('a 12th cannot get in by racing taps at max 10', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 9));
    const [kit, lee, jules] = await Promise.all([playerPhone(ctx, 'Kit'), playerPhone(ctx, 'Lee'), playerPhone(ctx, 'Jules')]);
    const results = await Promise.all([kit, lee, jules].map((p) => p.call('POST', `/api/sessions/${s.id}/join`, {})));
    const confirmed = results.filter((r) => r.data.result === 'confirmed').length;
    expect(confirmed).toBe(1);
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(10);
  });
});

describe('refund requests', () => {
  it('create: reserved, blocks Use credit and the Players-tab refund; cancel frees it; a second request is refused', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 1450)).status).toBe(400);
    expect((await requestRefund(alex, 0)).status).toBe(400);
    expect((await requestRefund(alex, 1500)).status).toBe(409);
    const req = await requestRefund(alex, 1400);
    expect(req.status, req.text).toBe(200);
    let g = await groupOf(alex);
    expect(g.credit).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: expect.objectContaining({ cents: 1400 }) });
    const s = await nextSession(ctx, [s0.id]);
    await joinAll(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    g = await groupOf(alex);
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ oweCents: 1400, useCreditCents: 0 });
    expect((await useCredit(alex, s.id)).status).toBe(409);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 1400, reservedCents: 1400, refundCents: 0 });
    expect((await refundBalance(ctx, 'Alex', { refunded: true, cents: 1400 })).status).toBe(409);
    expect((await requestRefund(alex, 500)).status).toBe(409);
    expect((await requestRefund(alex, 500)).data.code ?? (await requestRefund(alex, 500)).data.error).toBeDefined();
    const d = await dashboard(ctx);
    expect(d.refundRequests).toEqual([expect.objectContaining({ playerId: ctx.byName.Alex, name: 'Alex', cents: 1400 })]);
    // Cancel: usable again, the card goes.
    expect((await cancelRequest(alex)).data.changed).toBe(true);
    expect((await cancelRequest(alex)).data.changed).toBe(false);
    g = await groupOf(alex);
    expect(g.credit).toMatchObject({ usableCents: 1400, pending: null });
    expect((await dashboard(ctx)).refundRequests).toEqual([]);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    await agree(ctx);
  });

  it('Not now returns the reserved amount; Mark refunded takes it off; undo puts it back and the card returns', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    const p = ctx.players.find((x: any) => x.name === 'Alex')!;
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${p.id}`, { name: 'Alex', phone: '(313) 555-0100', venmo: '@AlexVenmoSecret' })).status).toBe(200);
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    let d = await dashboard(ctx);
    expect(d.refundRequests[0]).toMatchObject({ venmo: 'AlexVenmoSecret', cents: 1400 });
    // The Venmo link the Refund button opens: exact amount, the note, addressed to Alex, %20 encoding.
    const link = venmoRefundUrl(d.refundRequests[0].venmo, d.refundRequests[0].cents, 'Pickleball credit refund');
    expect(link.appUrl).toBe('venmo://paycharge?txn=pay&recipients=AlexVenmoSecret&amount=14&note=Pickleball%20credit%20refund');
    expect(link.url).toBe('https://venmo.com/?txn=pay&recipients=AlexVenmoSecret&amount=14&note=Pickleball%20credit%20refund');
    expect(venmoRefundUrl(null, 500, 'Pickleball credit refund')).toMatchObject({ addressed: false, appUrl: 'venmo://paycharge?txn=pay&amount=5&note=Pickleball%20credit%20refund' });
    // Not now.
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'not_now')).status).toBe(200);
    expect((await dashboard(ctx)).refundRequests).toEqual([]);
    expect((await groupOf(alex)).credit).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'not_now')).status).toBe(409);
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(409);
    // A new request for less than the balance, marked refunded.
    expect((await requestRefund(alex, 500)).status).toBe(200);
    d = await dashboard(ctx);
    const id = d.refundRequests[0].id;
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 1400, reservedCents: 500, refundCents: 900 });
    expect((await resolveRequest(ctx, id, 'refunded')).status).toBe(200);
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 900, reservedCents: 0, refundCents: 900 });
    expect((await groupOf(alex)).credit).toMatchObject({ balanceCents: 900, usableCents: 900, pending: null });
    expect((await groupOf(alex)).credit.history[0]).toMatchObject({ kind: 'refunded', cents: 500 });
    expect((await dashboard(ctx)).refundRequests).toEqual([]);
    expect((await resolveRequest(ctx, id, 'refunded')).status).toBe(409);
    // Undo: the $5 is back, the request is pending again (reserved), the card is back.
    expect((await resolveRequest(ctx, id, 'undo')).data.changed).toBe(true);
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 1400, reservedCents: 500, refundCents: 900 });
    expect((await dashboard(ctx)).refundRequests).toEqual([expect.objectContaining({ id, cents: 500 })]);
    expect((await groupOf(alex)).credit.pending).toMatchObject({ id, cents: 500 });
    expect((await resolveRequest(ctx, id, 'undo')).data.changed).toBe(false);
    // Marked refunded again: $9 left.
    expect((await resolveRequest(ctx, id, 'refunded')).status).toBe(200);
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 900, reservedCents: 0, refundCents: 900 });
    await agree(ctx);
  });

  // BUG: the Players-tab "Refund credit balance" (POST /api/admin/players/:id/credit-refund { refunded: true, cents })
  // answers 500 every time: refundCredit() binds 7 values to a statement with 6 placeholders when there is no request
  // ("column index out of range"). The organizer cannot refund a balance without a player request.
  it('Players-tab "Refund credit balance" takes the whole usable balance off and can be undone', async () => {
    const ctx = await group();
    await giveCredit(ctx, 'Alex');
    expect((await refundBalance(ctx, 'Alex', { refunded: true, cents: 500 })).status).toBe(409); // not the balance
    const res = await refundBalance(ctx, 'Alex', { refunded: true, cents: 1400 });
    expect(res.status, res.text).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await refundBalance(ctx, 'Alex', { refunded: true, cents: 1400 })).status).toBe(409);
    expect((await refundBalance(ctx, 'Alex', { refunded: false })).data.changed).toBe(true);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    await agree(ctx);
  });

  it('request while credit is also used on a game: the usable part pays the game, the rest is refunded, a cancel returns the used part', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 900)).status).toBe(200);
    const s = await nextSession(ctx, [s0.id]);
    await joinAll(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    let g = await groupOf(alex);
    expect(g.sessions.find((x: any) => x.id === s.id).mine.useCreditCents).toBe(500);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: false, usedCents: 500, potBeforeCents: 500, owedBeforeCents: 1400 });
    g = await groupOf(alex);
    expect(g.credit).toMatchObject({ balanceCents: 900, usableCents: 0 });
    expect(g.owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 900, creditCents: 500 })]);
    const d = await dashboard(ctx);
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await cancel(ctx, s.id)).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(500);
    expect((await groupOf(alex)).credit).toMatchObject({ balanceCents: 500, usableCents: 500 });
    await agree(ctx);
  });

  // BUG: same 500 as above (refundCredit binds 7 values to 6 placeholders without a request).
  it('Players-tab refund respects a reserved amount, and the organizer cannot be refunded', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 400)).status).toBe(200);
    expect((await refundBalance(ctx, 'Alex', { refunded: true, cents: 1400 })).status).toBe(409);
    const res = await refundBalance(ctx, 'Alex', { refunded: true, cents: 1000 });
    expect(res.status, res.text).toBe(200);
    expect(await ledgerOf(ctx, 'Alex')).toMatchObject({ balanceCents: 400, reservedCents: 400, refundCents: 0 });
    expect((await useCredit(alex, (await nextSession(ctx)).id)).status).toBe(409);
    await refresh(ctx);
    await organizerIn(ctx, (await nextSession(ctx)).id);
    await refresh(ctx);
    expect((await refundBalance(ctx, 'Robin', { refunded: true, cents: 100 })).status).toBe(409);
    await agree(ctx);
  });

  // BUG: "undo" on a request undoes the player's LAST refund entry, whichever request it answered. With two
  // requests marked refunded in turn, undo on the FIRST takes back the second's money, leaves the first closed as
  // refunded, and reopens the second request. The undo should take back the refund of the request it was tapped on.
  it('undo on a request takes back that request, not a later one', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    const first = (await dashboard(ctx)).refundRequests[0].id;
    expect((await resolveRequest(ctx, first, 'refunded')).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    // New credit, a second request for $5, marked refunded.
    await giveCredit(ctx, 'Alex', [s0.id]);
    expect((await requestRefund(alex, 500)).status).toBe(200);
    const second = (await dashboard(ctx)).refundRequests[0].id;
    expect(second).not.toBe(first);
    expect((await resolveRequest(ctx, second, 'refunded')).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(900);
    // Undo the first request's refund: its $14 is back (pot $23) and the first request is pending again.
    expect((await resolveRequest(ctx, first, 'undo')).data.changed).toBe(true);
    expect(await creditOf(ctx, 'Alex')).toBe(2300);
    expect((await dashboard(ctx)).refundRequests).toEqual([expect.objectContaining({ id: first, cents: 1400 })]);
    expect((await groupOf(alex)).credit.pending).toMatchObject({ id: first, cents: 1400 });
    const refunds = (await ledgerOf(ctx, 'Alex')).entries.filter((e: any) => e.kind === 'refunded');
    expect(refunds.map((e: any) => [e.cents, e.endedAt === null])).toEqual([
      [1400, false],
      [500, true],
    ]);
  });
});

describe('reopen', () => {
  it('reverses everything including seats settled by "did not play" and credit-paid repricing, then a redo with a different set', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    const names = ALL.slice(0, 6);
    const phones = await joinAll(ctx, s.id, names);
    // Alex pays with $14 credit; Frankie pays cash and will be a no-show; Emery never pays.
    expect((await useCredit(alex, s.id)).data.paid).toBe(true);
    await payAll(ctx, s.id, ['Blair', 'Casey', 'Devon', 'Frankie']);
    await endGame(ctx, s);
    const played1 = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'].map((n) => ctx.byName[n]);
    expect((await finalize(ctx, s.id, { played: played1 })).status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100, creditBackCents: 4 * 300 + 1400 });
    expect(row(view, 'Frankie')).toMatchObject({ played: false, creditBackCents: 1400 });
    expect(row(view, 'Frankie').refundedAt).not.toBeNull();
    expect(row(view, 'Emery')).toMatchObject({ played: true, owesCents: 1100 });
    expect(await creditOf(ctx, 'Alex')).toBe(300);
    expect(await creditOf(ctx, 'Frankie')).toBe(1400);
    let m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(4 * 1100);
    expect(m.creditsOwedCents).toBe(4 * 300 + 1400);
    await agree(ctx);
    // Reopen.
    expect(view.reopenBlockedBy).toEqual([]);
    expect((await reopen(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toBeNull();
    expect(view.needsFinalize).toBe(true);
    for (const name of names) expect(row(view, name)).toMatchObject({ played: null, creditBackCents: 0 });
    expect(row(view, 'Frankie')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null });
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    expect(row(view, 'Emery')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect(await creditOf(ctx, 'Frankie')).toBe(0);
    m = await monthFor(ctx, s);
    expect(m.collectedCents).toBe(0);
    expect(m.heldCents).toBe(5 * B);
    expect(m.creditsOwedCents).toBe(0);
    expect(m.sessions.find((x: any) => x.id === s.id).state).toBe('not_finalized');
    expect((await reopen(ctx, s.id)).status).toBe(409);
    await agree(ctx);
    // Redo: everyone played, 6 at $9.
    expect((await finalize(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 6, priceCents: 900, creditBackCents: 5 * 500 });
    expect(row(view, 'Frankie')).toMatchObject({ played: true, creditBackCents: 500, refundedAt: null });
    expect(row(view, 'Emery')).toMatchObject({ played: true, owesCents: 900 });
    expect(await creditOf(ctx, 'Frankie')).toBe(500);
    expect((await ledgerOf(ctx, 'Frankie')).entries.filter((e: any) => !e.endedAt)).toEqual([expect.objectContaining({ kind: 'kept', cents: 500, reason: 'finalized', playedCount: 6 })]);
    expect((await monthFor(ctx, s)).collectedCents).toBe(5 * 900);
    expect((await groupOf(phones.Emery)).owed).toEqual([expect.objectContaining({ amountCents: 900, finalized: true })]);
    await agree(ctx);
  });

  it('is blocked when credit from it was used or refunded by request', async () => {
    for (const how of ['used', 'request'] as const) {
      const ctx = await group();
      const s = await nextSession(ctx);
      const phones = await joinAll(ctx, s.id, ALL.slice(0, 6));
      await payAll(ctx, s.id, ALL.slice(0, 6));
      await endGame(ctx, s);
      expect((await finalize(ctx, s.id)).status).toBe(200);
      expect(await creditOf(ctx, 'Alex')).toBe(500);
      if (how === 'used') {
        const s2 = await nextSession(ctx, [s.id]);
        await phones.Alex.call('POST', `/api/sessions/${s2.id}/join`, {});
        expect((await useCredit(phones.Alex, s2.id)).data).toMatchObject({ paid: false, usedCents: 500 });
      } else if (how === 'request') {
        expect((await requestRefund(phones.Alex, 200)).status).toBe(200);
        // A pending request alone does not block (nothing left yet).
        expect((await adminSession(ctx, s.id)).reopenBlockedBy).toEqual([]);
        const d = await dashboard(ctx);
        expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
      }
      const view = await adminSession(ctx, s.id);
      expect(view.reopenBlockedBy, how).toEqual(['Alex']);
      const blocked = await reopen(ctx, s.id);
      expect(blocked.status, how).toBe(409);
      expect(blocked.data.message).toMatch(/Alex/);
      expect((await adminSession(ctx, s.id)).finalized).not.toBeNull();
      // Nothing moved for anyone else.
      for (const name of ALL.slice(1, 6)) expect(await creditOf(ctx, name)).toBe(500);
      await agree(ctx);
    }
  });

  // BUG: depends on the Players-tab refund, which answers 500 (see the refund requests block).
  it('is blocked when credit from it was refunded from the Players tab', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ALL.slice(0, 6));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const res = await refundBalance(ctx, 'Alex', { refunded: true, cents: 500 });
    expect(res.status, res.text).toBe(200);
    expect((await adminSession(ctx, s.id)).reopenBlockedBy).toEqual(['Alex']);
    expect((await reopen(ctx, s.id)).status).toBe(409);
    await agree(ctx);
  });

  it('a no-show who spent the credit they got back blocks the reopen too', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 5));
    await payAll(ctx, s.id, ALL.slice(0, 5));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id, { played: ALL.slice(0, 4).map((n) => ctx.byName[n]) })).status).toBe(200);
    expect(await creditOf(ctx, 'Emery')).toBe(1400);
    const s2 = await nextSession(ctx, [s.id]);
    await phones.Emery.call('POST', `/api/sessions/${s2.id}/join`, {});
    expect((await useCredit(phones.Emery, s2.id)).data.paid).toBe(true);
    expect((await adminSession(ctx, s.id)).reopenBlockedBy).toEqual(['Emery']);
    expect((await reopen(ctx, s.id)).status).toBe(409);
    await agree(ctx);
  });

  // BUG (rule 5: "paid = cash paid + credit used for this game ... If paid < due they now owe the remainder"):
  // after a reopen and a redo with fewer players, someone who paid the earlier (lower) final price is shown as
  // paid in full, owes nothing, and Collected is short. Expected: Alex owes $2 (paid $9, due $11).
  it('finalize at 6, an unpaid player pays $9, reopen, redo at 5 ($11): they owe the $2 remainder', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ALL.slice(1, 6));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    expect((await pay(ctx, s.id, 'Alex')).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentAmountCents: 900, owesCents: 0 });
    expect((await reopen(ctx, s.id)).status).toBe(200);
    expect((await finalize(ctx, s.id, { played: ALL.slice(0, 5).map((n) => ctx.byName[n]) })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    expect(row(view, 'Frankie')).toMatchObject({ played: false, creditBackCents: 1400 });
    for (const name of ALL.slice(1, 5)) expect(row(view, name)).toMatchObject({ creditBackCents: 300, owesCents: 0 });
    expect(row(view, 'Alex')).toMatchObject({ played: true, owesCents: 200, creditBackCents: 0 });
    expect((await groupOf(phones.Alex)).owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 200 })]);
    expect((await monthFor(ctx, s)).collectedCents).toBe(4 * 1100 + 900);
  });
});

describe('fewer than 4, and the flat price setting', () => {
  it('3 in: Finalize anyway charges $14 each (unpaid owe $14), or cancel gives credit', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 3));
    await payAll(ctx, s.id, ['Alex']);
    await endGame(ctx, s);
    let view = await adminSession(ctx, s.id);
    expect(view.needsFinalize).toBe(true);
    expect(view.confirmedCount).toBe(3);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 3, priceCents: 1400, creditBackCents: 0 });
    expect(row(view, 'Alex')).toMatchObject({ creditBackCents: 0, owesCents: 0 });
    expect(row(view, 'Blair')).toMatchObject({ owesCents: 1400, shareCents: 1400 });
    expect((await monthFor(ctx, s)).collectedCents).toBe(1400);
    expect((await cancel(ctx, s.id)).status).toBe(409);
    await agree(ctx);
    // The other way: cancel after the end (nobody is asked about a charge after the start).
    const s2 = await nextSession(ctx, [s.id]);
    await joinAll(ctx, s2.id, ALL.slice(0, 2));
    await payAll(ctx, s2.id, ['Alex', 'Blair']);
    await endGame(ctx, s2);
    expect((await cancel(ctx, s2.id, { chargedCents: 4800 })).status).toBe(200);
    view = await adminSession(ctx, s2.id);
    expect(view.chargedCents).toBeNull();
    expect(row(view, 'Alex').creditBackCents).toBe(1400);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(await creditOf(ctx, 'Blair')).toBe(1400);
    await agree(ctx);
  });

  it('nothing can be finalized before the end, twice, with a stranger as played, or when canceled', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    expect((await finalize(ctx, s.id)).status).toBe(409);
    ctx.app.now = Date.parse(s.endsAt) - 1;
    expect((await finalize(ctx, s.id)).status).toBe(409);
    ctx.app.now = Date.parse(s.endsAt);
    expect((await finalize(ctx, s.id, { played: [ctx.byName.Alex, ctx.byName.Kit] })).status).toBe(400);
    expect((await finalize(ctx, s.id, { played: 'everyone' })).status).toBe(400);
    expect((await finalize(ctx, s.id, {})).status).toBe(400);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    expect((await finalize(ctx, s.id)).status).toBe(409);
    const s2 = await nextSession(ctx, [s.id]);
    await cancel(ctx, s2.id);
    ctx.app.now = Date.parse(s2.endsAt) + 1;
    expect((await finalize(ctx, s2.id)).status).toBe(409);
  });

  it('changing $14 after finalizing leaves old games alone; new games and unfinalized seats use the new price', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const names = ALL.slice(0, 5);
    const phones = await joinAll(ctx, s.id, names);
    await payAll(ctx, s.id, names.slice(1));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 2000 } })).status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    for (const name of names.slice(1)) expect(row(view, name)).toMatchObject({ creditBackCents: 300, shareCents: 1100 });
    expect(row(view, 'Alex')).toMatchObject({ owesCents: 1100, shareCents: 1100 });
    expect((await groupOf(phones.Alex)).owed).toEqual([expect.objectContaining({ amountCents: 1100 })]);
    expect((await monthFor(ctx, s))).toMatchObject({ collectedCents: 4 * 1100 });
    expect((await monthFor(ctx, s)).sessions.find((x: any) => x.id === s.id).priceCents).toBe(1100);
    // Reopen and redo at the new price: the formula uses $20 now.
    expect((await reopen(ctx, s.id)).status).toBe(200);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1600 });
    // The $14 payments are below the new $16: rule 5, "paid < due": the $14 stays against the seat and $2 is owed; Alex owes $16.
    for (const name of names.slice(1)) expect(row(view, name)).toMatchObject({ creditBackCents: 0, paymentStatus: 'unpaid', paidEarlierCents: 1400, owesCents: 200 });
    expect(row(view, 'Alex').owesCents).toBe(1600);
    // A new game: $20 each until finalized, 5 play at $16, $4 back.
    const s2 = await nextSession(ctx, [s.id]);
    const p2 = await joinAll(ctx, s2.id, names);
    expect((await groupOf(p2.Alex)).sessions.find((x: any) => x.id === s2.id).mine).toMatchObject({ oweCents: 2000, shareCents: 2000 });
    await payAll(ctx, s2.id, names);
    expect(row(await adminSession(ctx, s2.id), 'Alex').paymentAmountCents).toBe(2000);
    await endGame(ctx, s2);
    expect((await finalize(ctx, s2.id)).status).toBe(200);
    view = await adminSession(ctx, s2.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1600, creditBackCents: 5 * 400 });
    expect((await monthFor(ctx, s2)).sessions.find((x: any) => x.id === s2.id)).toMatchObject({ collectedCents: 5 * 1600, priceCents: 1600 });
    await agree(ctx);
  });

  // Rule 5, "if paid < due they now owe the remainder", applied to a price raised between paying and finalizing:
  // the $14 stays against the seat and the $6 is owed.
  it('paid $14, price raised to $20 before the game, 4 play: owes the $6 remainder', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ['Alex']);
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 2000 } });
    await endGame(ctx, s);
    await finalize(ctx, s.id);
    expect(row(await adminSession(ctx, s.id), 'Alex').owesCents).toBe(600);
  });
});

describe('mark paid and unmark around finalize', () => {
  it('unmark after finalize with the credit untouched takes it back; refused once the credit was spent', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ALL.slice(0, 6));
    await endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    // Blair: untouched credit, unmark works and the $5 goes; marking paid again records $9 at the final price.
    expect((await pay(ctx, s.id, 'Blair', false)).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Blair')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 900, creditBackCents: 0 });
    expect(await creditOf(ctx, 'Blair')).toBe(0);
    expect((await groupOf(phones.Blair)).owed).toEqual([expect.objectContaining({ amountCents: 900, finalized: true })]);
    expect((await pay(ctx, s.id, 'Blair')).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Blair')).toMatchObject({ paymentAmountCents: 900, creditBackCents: 0, owesCents: 0 });
    // Alex spends the $5 credit elsewhere: unmarking Alex is refused with a plain reason, nothing changes.
    const s2 = await nextSession(ctx, [s.id]);
    await phones.Alex.call('POST', `/api/sessions/${s2.id}/join`, {});
    expect((await useCredit(phones.Alex, s2.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    const res = await pay(ctx, s.id, 'Alex', false);
    expect(res.status).toBe(409);
    expect(res.data.code ?? res.data.error).toBe('credit_spent');
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditBackCents: 500 });
    // Casey: a partial spend of the credit also blocks (the pot no longer holds the whole $5).
    expect((await requestRefund(phones.Casey, 200)).status).toBe(200);
    const d = await dashboard(ctx);
    await resolveRequest(ctx, d.refundRequests[0].id, 'refunded');
    expect((await pay(ctx, s.id, 'Casey', false)).status).toBe(409);
    // A settled no-show seat can't be unmarked either.
    const s3 = await nextSession(ctx, [s.id, s2.id]);
    await joinAll(ctx, s3.id, ALL.slice(0, 5));
    await payAll(ctx, s3.id, ALL.slice(0, 5));
    await endGame(ctx, s3);
    expect((await finalize(ctx, s3.id, { played: ALL.slice(0, 4).map((n) => ctx.byName[n]) })).status).toBe(200);
    expect((await pay(ctx, s3.id, 'Emery', false)).status).toBe(409);
    expect(await creditOf(ctx, 'Emery')).toBe(1400 + 500);
    await agree(ctx);
  });

  it('a player cannot "Didn\'t pay?" an organizer-marked payment, and the organizer\'s unmark of a credit+cash seat returns the credit', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    await requestRefund(alex, 900);
    await resolveRequest(ctx, (await dashboard(ctx)).refundRequests[0].id, 'refunded');
    const s = await nextSession(ctx, [s0.id]);
    await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    expect((await pay(ctx, s.id, 'Alex')).status).toBe(200);
    expect((await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: false })).status).toBe(409);
    expect((await pay(ctx, s.id, 'Alex', false)).status).toBe(200);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 0, owesCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(500);
    await agree(ctx);
  });
});

describe('double taps and racing taps never double-spend', () => {
  it('two Use credit at once: one $14 entry, one 409', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    await joinAll(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    const [a, b] = await Promise.all([useCredit(alex, s.id), useCredit(alex, s.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await ledgerOf(ctx, 'Alex')).entries.filter((e: any) => e.kind === 'used' && !e.endedAt)).toHaveLength(1);
    expect(row(await adminSession(ctx, s.id), 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    await agree(ctx);
  });

  it('two Use credit at once on two different games with $14 of credit: only one game gets it', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s1 = await nextSession(ctx, [s0.id]);
    const s2 = await nextSession(ctx, [s0.id, s1.id]);
    await alex.call('POST', `/api/sessions/${s1.id}/join`, {});
    await alex.call('POST', `/api/sessions/${s2.id}/join`, {});
    const [a, b] = await Promise.all([useCredit(alex, s1.id), useCredit(alex, s2.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await ledgerOf(ctx, 'Alex')).entries.filter((e: any) => e.kind === 'used' && !e.endedAt)).toHaveLength(1);
    await agree(ctx);
  });

  it('two finalize at once: one finalize, one set of credit entries', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ALL.slice(0, 6));
    await endGame(ctx, s);
    const [a, b] = await Promise.all([finalize(ctx, s.id), finalize(ctx, s.id, { played: ALL.slice(0, 5).map((n) => ctx.byName[n]) })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const view = await adminSession(ctx, s.id);
    const n = view.finalized.playedCount;
    expect([5, 6]).toContain(n);
    for (const name of ALL.slice(0, 5)) {
      expect(row(view, name).creditBackCents).toBe(creditBack(B, n));
      expect((await ledgerOf(ctx, name)).entries.filter((e: any) => !e.endedAt)).toHaveLength(1);
    }
    await agree(ctx);
  });

  it('two Mark refunded at once: one refund entry; a Mark refunded racing an undo never pays twice', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    const id = (await dashboard(ctx)).refundRequests[0].id;
    const [a, b] = await Promise.all([resolveRequest(ctx, id, 'refunded'), resolveRequest(ctx, id, 'refunded')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await ledgerOf(ctx, 'Alex')).entries.filter((e: any) => e.kind === 'refunded' && !e.endedAt)).toHaveLength(1);
    await agree(ctx);
  });

  // BUG: depends on the Players-tab refund, which answers 500 (see the refund requests block).
  it('two Players-tab refunds at once: one refund entry', async () => {
    const ctx = await group();
    await giveCredit(ctx, 'Blair');
    const [c, d] = await Promise.all([refundBalance(ctx, 'Blair', { refunded: true, cents: 1400 }), refundBalance(ctx, 'Blair', { refunded: true, cents: 1400 })]);
    expect([c.status, d.status].sort(), c.text).toEqual([200, 409]);
    expect(await creditOf(ctx, 'Blair')).toBe(0);
    expect((await ledgerOf(ctx, 'Blair')).entries.filter((e: any) => e.kind === 'refunded' && !e.endedAt)).toHaveLength(1);
    await agree(ctx);
  });

  it('two refund requests at once: one request', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    const [a, b] = await Promise.all([requestRefund(alex, 1400), requestRefund(alex, 1400)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await dashboard(ctx)).refundRequests).toHaveLength(1);
  });

  it('two I\'m out at once on a paid seat: one credit entry', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 5));
    await payAll(ctx, s.id, ['Alex']);
    const [a, b] = await Promise.all([withdraw(phones.Alex, s.id), withdraw(phones.Alex, s.id)]);
    expect([a.data.creditBackCents, b.data.creditBackCents].sort()).toEqual([0, 1400]);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect((await ledgerOf(ctx, 'Alex')).entries.filter((e: any) => !e.endedAt)).toHaveLength(1);
    await agree(ctx);
  });

  it('Use credit racing a refund request for the same $14: never both, and never a request above the pot', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    const [use, req] = await Promise.all([useCredit(alex, s.id), requestRefund(alex, 1400)]);
    const l = await ledgerOf(ctx, 'Alex');
    const g = await groupOf(alex);
    // Whatever won, the request can never be for more than the pot holds.
    expect(l.reservedCents).toBeLessThanOrEqual(l.balanceCents);
    expect(g.credit.pending === null || g.credit.pending.cents <= g.credit.balanceCents).toBe(true);
    expect(use.status === 200 && req.status === 200, `use ${use.status}, request ${req.status}`).toBe(false);
    // And Mark refunded can never pay out credit that is not there.
    const d = await dashboard(ctx);
    if (d.refundRequests.length) {
      const res = await resolveRequest(ctx, d.refundRequests[0].id, 'refunded');
      expect(res.status).toBe(200);
    }
    expect(await creditOf(ctx, 'Alex')).toBeGreaterThanOrEqual(0);
    await agree(ctx);
  });
});

describe('the clock change on Sun Nov 1 2026', () => {
  it('a Sat Oct 31 game ending 10:00 PM EDT: the Finalize card appears at 10:00 PM, finalize works the morning after (EST), the game lands in October', async () => {
    const ctx = await group();
    // Thu Oct 29, 8-10 PM EDT: 4 in and paid, finalized the next morning.
    const thu = await on(ctx, '2026-10-29');
    expect(thu.startsAt).toBe('2026-10-30T00:00:00.000Z');
    await joinAll(ctx, thu.id, ALL.slice(0, 4));
    await payAll(ctx, thu.id, ALL.slice(0, 4));
    // Sat Oct 31, 8:00-10:00 PM EDT (the last evening before the clocks go back).
    const add = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-01T02:00:00.000Z' });
    expect(add.status, add.text).toBe(200);
    const sat = await adminSession(ctx, add.data.id);
    await joinAll(ctx, sat.id, ALL.slice(0, 5));
    await payAll(ctx, sat.id, ALL.slice(0, 5));
    ctx.app.now = Date.parse('2026-10-30T13:00:00.000Z'); // Fri 9:00 AM EDT
    expect((await adminSession(ctx, thu.id)).needsFinalize).toBe(true);
    expect((await adminSession(ctx, sat.id)).needsFinalize).toBe(false);
    expect((await finalize(ctx, thu.id)).status).toBe(200);
    // Sat 9:59 PM EDT: not over. 10:00 PM EDT (02:00Z): the Finalize card shows.
    ctx.app.now = Date.parse('2026-11-01T01:59:59.000Z');
    expect((await adminSession(ctx, sat.id)).needsFinalize).toBe(false);
    expect((await finalize(ctx, sat.id)).status).toBe(409);
    ctx.app.now = Date.parse('2026-11-01T02:00:00.000Z');
    expect((await adminSession(ctx, sat.id)).needsFinalize).toBe(true);
    expect((await monthFor(ctx, sat)).sessions.find((x: any) => x.id === sat.id).state).toBe('not_finalized');
    // Sun Nov 1, 9:00 AM EST (14:00Z): still waiting, the player sees "Pay" for the game that ended.
    ctx.app.now = Date.parse('2026-11-01T14:00:00.000Z');
    expect((await adminSession(ctx, sat.id)).needsFinalize).toBe(true);
    // Finalize after the change: the price is right and the game lands in October's money.
    expect((await finalize(ctx, sat.id)).status).toBe(200);
    const view = await adminSession(ctx, sat.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100, creditBackCents: 5 * 300 });
    const oct = await money(ctx, '2026-10');
    expect(oct.sessions.find((x: any) => x.id === sat.id)).toMatchObject({ state: 'played', collectedCents: 5 * 1100 });
    expect((await money(ctx, '2026-11')).sessions.some((x: any) => x.id === sat.id)).toBe(false);
    // Tue Nov 3 after the change starts 8:00 PM EST (01:00Z) and ends 10:00 PM EST.
    const tue = await on(ctx, '2026-11-03');
    expect(tue.startsAt).toBe('2026-11-04T01:00:00.000Z');
    expect(tue.endsAt).toBe('2026-11-04T03:00:00.000Z');
    await agree(ctx);
  });
});

describe('Money, Players and per-session numbers agree across months', () => {
  it('a long story across October and November: pots = credits owed summed over months, held and collected consistent', async () => {
    const ctx = await group();
    // Thu Oct 29: 7 in plus the organizer, Alex drops (paid), Frankie no-show (paid), Gale unpaid plays, 6 play at $9.
    const oct = await on(ctx, '2026-10-29');
    const phones = await joinAll(ctx, oct.id, ALL.slice(0, 7));
    await payAll(ctx, oct.id, ALL.slice(0, 6));
    await organizerIn(ctx, oct.id);
    await refresh(ctx);
    expect((await withdraw(phones.Alex, oct.id)).data.creditBackCents).toBe(1400);
    let a = await agree(ctx);
    expect(a.months[0].heldCents).toBe(5 * B);
    await endGame(ctx, oct);
    a = await agree(ctx);
    expect(a.months[0].heldCents).toBe(5 * B);
    const played = ['Blair', 'Casey', 'Devon', 'Emery', 'Gale', 'Robin'].map((n) => ctx.byName[n]);
    expect((await finalize(ctx, oct.id, { played })).status).toBe(200);
    // 6 played (5 others + the organizer): $9 each. Blair..Emery get $5 back, Frankie $14, Gale owes $9.
    let view = await adminSession(ctx, oct.id);
    // The game's credit-back total also counts Alex's $14 from the drop (it came from this game's seat).
    expect(view.finalized).toMatchObject({ playedCount: 6, priceCents: 900, creditBackCents: 4 * 500 + 1400 + 1400 });
    expect(row(view, 'Gale').owesCents).toBe(900);
    a = await agree(ctx);
    expect(a.months[0]).toMatchObject({ collectedCents: 4 * 900, heldCents: 0, creditsOwedCents: 4 * 500 + 1400 + 1400 });
    expect(view.court.playersCoverCents).toBe(4 * 900 + 900);
    // Tue Nov 3: Blair uses the $5 credit, Alex uses $14, Frankie requests $10 back and uses the other $4, Gale pays the $9 for October.
    const nov = await on(ctx, '2026-11-03');
    const novPhones = await joinAll(ctx, nov.id, ['Alex', 'Blair', 'Frankie', 'Harper', 'Indy']);
    expect((await useCredit(phones.Blair, nov.id)).data).toMatchObject({ paid: false, usedCents: 500 });
    expect((await useCredit(phones.Alex, nov.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    expect((await requestRefund(phones.Frankie, 1000)).status).toBe(200);
    expect((await useCredit(phones.Frankie, nov.id)).data).toMatchObject({ paid: false, usedCents: 400 });
    expect((await pay(ctx, oct.id, 'Gale')).status).toBe(200);
    await payAll(ctx, nov.id, ['Blair', 'Frankie', 'Harper', 'Indy']);
    a = await agree(ctx);
    // October's credit owed went down by what was used ($5 + $14 + $4); Frankie's $10 is still owed (reserved).
    expect(a.months[0].creditsOwedCents).toBe(3 * 500 + 1000);
    expect(a.months[0].collectedCents).toBe(5 * 900);
    expect(a.months[1].heldCents).toBe(5 * B);
    // Mark Frankie's $10 refunded.
    const d = await dashboard(ctx);
    expect((await resolveRequest(ctx, d.refundRequests[0].id, 'refunded')).status).toBe(200);
    a = await agree(ctx);
    expect(a.months[0].creditsOwedCents).toBe(3 * 500);
    // November: Harper drops late (credit), Indy promoted? No waitlist. Finalize 4 played at $14: nothing back.
    ctx.app.now = Date.parse(nov.startsAt) - 1 * HOUR;
    expect((await withdraw(novPhones.Harper, nov.id)).data.creditBackCents).toBe(1400);
    await endGame(ctx, nov);
    expect((await finalize(ctx, nov.id)).status).toBe(200);
    view = await adminSession(ctx, nov.id);
    expect(view.finalized).toMatchObject({ playedCount: 4, priceCents: 1400, creditBackCents: 1400 });
    a = await agree(ctx);
    expect(a.months[1]).toMatchObject({ collectedCents: 4 * 1400, heldCents: 0, creditsOwedCents: 1400 });
    expect(a.months[0].creditsOwedCents).toBe(3 * 500);
    const pots = a.dash.creditLedger.reduce((sum: number, l: any) => sum + l.balanceCents, 0);
    expect(pots).toBe(3 * 500 + 1400);
    // Each player's own screen agrees with the Players tab.
    for (const name of ALL.slice(0, 9)) {
      const g = await groupOf(await playerPhone(ctx, name));
      expect(g.credit.balanceCents, name).toBe(await creditOf(ctx, name));
      const owedHere = g.owed.reduce((sum: number, o: any) => sum + o.amountCents, 0);
      const owedThere = a.dash.sessions.reduce((sum: number, s: any) => sum + (s.roster.find((r: any) => r.name === name)?.owesCents ?? 0), 0);
      expect(owedHere, name).toBe(owedThere);
    }
  });
});

describe('privacy', () => {
  function keysOf(value: unknown, path = '', out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v, i) => keysOf(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out.push(`${path}.${k}`);
        keysOf(v, `${path}.${k}`, out);
      }
    }
    return out;
  }

  it('no player response, including View as, carries court cost, membership, anyone else\'s credit or payment, phone numbers or Venmo names', async () => {
    const app = new TestApp();
    const sent: string[] = [];
    app.env = {
      ...app.env,
      TELEGRAM_BOT_TOKEN: '123456:FAKE-token',
      TELEGRAM_CHAT_ID: '12345',
      TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)).text);
        return new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch,
    };
    const ctx = await group({ app });
    for (const name of ALL) {
      const p = ctx.players.find((x: any) => x.name === name)!;
      expect((await ctx.organizer.call('PUT', `/api/admin/players/${p.id}`, { name, phone: `(313) 555-07${String(ALL.indexOf(name)).padStart(2, '0')}`, venmo: `@${name}VenmoSecret` })).status).toBe(200);
    }
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { typicalCourtCostCents: 4321, monthlyMembershipCents: 3579 } });
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 6));
    await organizerIn(ctx, s.id);
    await refresh(ctx);
    await payAll(ctx, s.id, ['Blair', 'Casey']);
    expect((await useCredit(alex, s.id)).data.paid).toBe(true);
    expect((await requestRefund(phones.Blair, 0)).status).toBe(400);
    await giveCredit(ctx, 'Devon', [s.id]);
    expect((await requestRefund(phones.Devon, 1400)).status).toBe(200);
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    await withdraw(phones.Casey, s.id);
    // Finalize an earlier game too so finalized views are in play.
    await endGame(ctx, s);
    await finalize(ctx, s.id);
    await app.settle();

    const responses: { who: string; data: any; text: string }[] = [];
    for (const name of ALL.slice(0, 6)) {
      const r = await (await playerPhone(ctx, name)).call('GET', '/api/group');
      expect(r.status).toBe(200);
      responses.push({ who: name, data: r.data, text: r.text });
      // View as, from the organizer's signed-in client.
      const v = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[name] });
      expect(v.status, v.text).toBe(200);
      expect(v.data.viewingAs).toBe(true);
      responses.push({ who: `view-as ${name}`, data: v.data, text: v.text });
    }
    // A phone that has not picked a name yet.
    const stranger = app.client();
    stranger.groupKey = ctx.groupKey;
    const sr = await stranger.call('GET', '/api/group');
    responses.push({ who: 'stranger', data: sr.data, text: sr.text });
    const robin = await playerPhone(ctx, 'Robin');
    responses.push({ who: 'organizer as player', data: (await robin.call('GET', '/api/group')).data, text: '' });

    for (const { who, data, text } of responses) {
      const keys = keysOf(data);
      // courtState (the venue's waitlist) is not money; everything else about the court, phones and Venmo must be absent.
      const bad = keys.filter((k) => /phone|venmo|courtCost|cost|membership|charged/i.test(k) && k !== '.group.venmoUrl');
      expect(bad, `${who}: private keys`).toEqual([]);
      expect(text, `${who}: phone number`).not.toMatch(/555-0|\(313\)/);
      expect(text, `${who}: a Venmo name`).not.toMatch(/VenmoSecret/);
      expect(text, `${who}: court cost or membership`).not.toMatch(/:(4321|3579)[,}]/);
      // Only names on the roster lines.
      for (const sess of data.sessions) {
        for (const c of sess.confirmed) expect(Object.keys(c).sort()).toEqual(['attendanceConfirmed', 'name']);
        for (const w of sess.waitlist) expect(Object.keys(w)).toEqual(['name']);
      }
      // The credit shown is the viewer's own.
      const me = data.me?.name;
      if (me && me !== 'Robin') {
        const mine = await creditOf(ctx, me);
        expect(data.credit.balanceCents, `${who}: own credit`).toBe(mine);
        expect(data.credit.history.every((h: any) => h.cents > 0)).toBe(true);
      } else {
        expect(data.credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
        expect(data.owed).toEqual([]);
      }
      // Nobody else's money: the only payment and credit fields live under `mine` and `credit`.
      const moneyKeys = keys.filter((k) => /paid|credit|owe|share|payment/i.test(k));
      for (const k of moneyKeys) expect(k, `${who}: ${k}`).toMatch(/^\.(sessions\[\d+\]\.mine\.|credit\.|credit$|owed$|payDue$|owed\[\d+\]\.|payDue\[\d+\]\.|group\.priceCents)/);
    }
    // View as the organizer's own player shows no money.
    const asRobin = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Robin });
    expect(asRobin.data.credit.balanceCents).toBe(0);
    // Devon's pending request shows only to Devon.
    const devon = responses.find((r) => r.who === 'Devon')!.data;
    expect(devon.credit.pending).toMatchObject({ cents: 1400 });
    for (const r of responses.filter((x) => !/Devon/.test(x.who))) expect(r.data.credit.pending).toBeNull();
    // View as without the organizer's sign-in is refused.
    const nobody = app.client();
    nobody.groupKey = ctx.groupKey;
    expect((await nobody.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Alex })).status).toBe(401);
    // Telegram: the refund request names only the player and the amount; the drop alert names nobody's number.
    expect(sent).toContain('Refund requested: Devon wants $14 back.');
    for (const t of sent) {
      expect(t).not.toMatch(/555|VenmoSecret|@|\b(4321|3579)\b/);
      if (!t.startsWith('Refund requested')) expect(t).not.toMatch(/\$/);
    }
  });

  it('the calendar file and the status endpoint carry no money or numbers', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ['Alex']);
    const c = app(ctx).client();
    const ics = await c.call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(ics.status).toBe(200);
    expect(ics.text).not.toMatch(/555-|\$|paid|credit/i);
    const st = await c.call('GET', '/api/status');
    expect(st.text).not.toMatch(/555-|venmo|credit|cost/i);
  });
});

const app = (ctx: Ctx) => ctx.app;
