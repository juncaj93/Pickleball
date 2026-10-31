// Alex's money decisions (Sat Oct 31, 2026, after the audit):
//  2. An "I paid" the organizer never confirmed does NOT become credit when the player drops or the game is
//     canceled. The seat is a claim: nothing on it moves; Home shows "Ryan tapped I paid ($14), not confirmed";
//     Paid makes it credit, Didn't pay clears it.
//  3. Unmark undoes only the latest payment and keeps credit and cash paid earlier toward the seat.
//  Plus: the organizer's Mark paid / Unmark carry what the screen showed (a changed seat is refused), and the
//  Players-tab Undo of a refund names the refund.
import { describe, expect, it } from 'vitest';
import { potEffect } from '../shared/credit';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function group() {
  const ctx = await setupGroup(new TestApp());
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' })).status).toBe(200);
  return ctx;
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const raw = (ctx: Ctx) => ctx.app.db.raw;
function givePot(ctx: Ctx, name: string, cents: number, oldId: string) {
  raw(ctx).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${oldId}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
function potOf(ctx: Ctx, name: string) {
  const rows = raw(ctx).prepare('SELECT * FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(ctx.byName[name]) as any[];
  return rows.reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
}
const rowOf = async (ctx: Ctx, sid: string, name: string) => (await dash(ctx)).sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === name);
const month = async (ctx: Ctx, m: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data;

/** Tue Nov 3, court booked; Blair joins and taps I paid for what her screen shows. */
async function claimed(ctx: Ctx, opts: { credit?: number } = {}) {
  const old = await on(ctx, '2026-10-29');
  if (opts.credit) givePot(ctx, 'Blair', opts.credit, old.id);
  const g = await on(ctx, '2026-11-03');
  await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
  const blair = await playerPhone(ctx, 'Blair');
  await blair.call('POST', `/api/sessions/${g.id}/join`, {});
  const owe = (await blair.call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === g.id).amountCents;
  expect((await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: owe })).status).toBe(200);
  return { g, blair, owe };
}

describe('2. an unconfirmed I paid stays a claim', () => {
  it('drop: no credit, Home shows the claim, the drop banner says it waits for Alex; Paid makes it credit', async () => {
    const ctx = await group();
    const { g, blair } = await claimed(ctx);
    const mine = (await blair.call('GET', '/api/group')).data.sessions.find((s: any) => s.id === g.id).mine;
    expect([mine.dropCreditCents, mine.dropCashCents, mine.dropClaimCents]).toEqual([0, 0, 1400]);
    expect((await blair.call('POST', `/api/sessions/${g.id}/withdraw`, {})).data).toMatchObject({ creditBackCents: 0, creditReturnedCents: 0 });
    expect(potOf(ctx, 'Blair')).toBe(0);
    const d = await dash(ctx);
    expect(d.paymentClaims).toEqual([expect.objectContaining({ sessionId: g.id, name: 'Blair', cents: 1400, why: 'dropped' })]);
    // Held on Money and the Players tab until Alex decides; never Collected.
    expect((await month(ctx, '2026-11')).heldCents).toBe(1400);
    // Paid: now it is her credit.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: true })).data).toMatchObject({ changed: true });
    expect(potOf(ctx, 'Blair')).toBe(1400);
    expect((await dash(ctx)).paymentClaims).toEqual([]);
    expect((await month(ctx, '2026-11')).heldCents).toBe(0);
    // A second tap changes nothing.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: true })).data).toMatchObject({ changed: false });
    expect(potOf(ctx, 'Blair')).toBe(1400);
  });

  it("cancel: no credit; Didn't pay clears it", async () => {
    const ctx = await group();
    const { g } = await claimed(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect((await dash(ctx)).paymentClaims).toEqual([expect.objectContaining({ name: 'Blair', cents: 1400, why: 'canceled' })]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: false })).data).toMatchObject({ changed: true });
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect((await dash(ctx)).paymentClaims).toEqual([]);
    expect((await month(ctx, '2026-11')).heldCents).toBe(0);
  });

  it("part credit + I paid: the seat is frozen as it was; a rejoin gets it back whole; Didn't pay returns the credit", async () => {
    const ctx = await group();
    const { g, blair, owe } = await claimed(ctx, { credit: 300 });
    expect(owe).toBe(1100);
    await blair.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    expect(potOf(ctx, 'Blair')).toBe(0); // the $3 stays on the frozen seat
    expect((await dash(ctx)).paymentClaims).toEqual([expect.objectContaining({ name: 'Blair', cents: 1100 })]);
    // Back in before Alex answers: exactly as before the drop (paid $14: $3 credit + her $11 I paid).
    await blair.call('POST', `/api/sessions/${g.id}/join`, {});
    expect(await rowOf(ctx, g.id, 'Blair')).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paymentAmountCents: 1400, selfPaid: true, creditCents: 300 });
    await blair.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: false })).data).toMatchObject({ changed: true });
    expect(potOf(ctx, 'Blair')).toBe(300);
  });

  it("the player's own Didn't pay? on a frozen seat gives the credit on it back", async () => {
    const ctx = await group();
    const { g, blair } = await claimed(ctx, { credit: 300 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: false })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(300);
    expect((await dash(ctx)).paymentClaims).toEqual([]);
  });

  it('finalize leaves a claim on a seat that left alone; a confirmed payment that did not play comes back as before', async () => {
    const ctx = await group();
    const { g, blair } = await claimed(ctx);
    for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
    await blair.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect((await dash(ctx)).paymentClaims).toEqual([expect.objectContaining({ name: 'Blair' })]);
    const m = await month(ctx, '2026-11');
    expect(m.sessions.find((s: any) => s.id === g.id).collectedCents).toBe(0); // the claim is not collected
    expect(m.heldCents).toBe(1400);
  });
});

describe('3. Unmark undoes only the latest payment', () => {
  it('cash on top of credit: Unmark takes the cash only; the credit stays until a second Unmark', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Blair', 500, old.id);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${g.id}/join`, {});
    let r = await rowOf(ctx, g.id, 'Blair');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen })).status).toBe(200);
    r = await rowOf(ctx, g.id, 'Blair');
    expect(r).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen })).status).toBe(200);
    const after = await rowOf(ctx, g.id, 'Blair');
    expect(after).toMatchObject({ paymentStatus: 'unpaid', creditCents: 500, owesCents: 900 });
    expect(potOf(ctx, 'Blair')).toBe(0);
    // The same tap again from the same (now old) screen is refused, never taking the credit too.
    const stale = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen });
    expect(stale.status).toBe(409);
    expect(potOf(ctx, 'Blair')).toBe(0);
    // From the fresh screen ("Credit $5"), Unmark puts the credit back.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: after.moneySeen })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(500);
  });

  it('cash paid earlier toward the seat (after a reopen and redo) stays when the latest payment is unmarked', async () => {
    const ctx = await group();
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const all = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: all })).status).toBe(200); // 5 at $11
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true }); // $11
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: all.slice(0, 4) })).status).toBe(200); // 4 at $14
    let r = await rowOf(ctx, g.id, 'Blair');
    expect(r).toMatchObject({ paymentStatus: 'unpaid', paidEarlierCents: 1100, owesCents: 300 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen }); // the $3
    r = await rowOf(ctx, g.id, 'Blair');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen });
    expect(await rowOf(ctx, g.id, 'Blair')).toMatchObject({ paymentStatus: 'unpaid', paidEarlierCents: 1100, owesCents: 300 });
  });
});

describe('organizer screens carry what they showed', () => {
  it('Mark paid from a screen that showed "Credit $5" after the player paid the rest is refused', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Blair', 500, old.id);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${g.id}/join`, {});
    const shown = await rowOf(ctx, g.id, 'Blair'); // "Credit $5", $9 due
    await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: 900 });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: shown.moneySeen });
    expect(res.status).toBe(409);
    expect(await rowOf(ctx, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 500 });
  });

  it('Players tab Undo of a refund names it: a repeat takes back nothing more', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Blair', 1400, old.id);
    const refund = (body: object) => ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Blair}/credit-refund`, body);
    await refund({ refunded: true, cents: 1400 });
    givePot(ctx, 'Blair', 1400, old.id);
    await refund({ refunded: true, cents: 1400 });
    const latest = (await dash(ctx)).creditLedger.find((l: any) => l.playerId === ctx.byName.Blair).entries.filter((e: any) => e.kind === 'refunded' && !e.endedAt).pop();
    await refund({ refunded: false, ledgerId: latest.id });
    await refund({ refunded: false, ledgerId: latest.id });
    expect(potOf(ctx, 'Blair')).toBe(1400);
  });
});
