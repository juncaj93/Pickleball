import { describe, expect, it } from 'vitest';
import { backupToSql } from '../scripts/backup-sql.mjs';
import { keptRemaining, potBalance, type CreditRow } from '../shared/credit';
import { createNodeD1 } from '../dev/nodeD1';
import { balanceOf, buildTodo, heldCents, refundRows } from '../src/pages/admin/todo';
import { DAY, HOUR, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const MITCH = 'Casey'; // plays the part of Mitchell
const ME = 'Alex'; // the organizer when a test names them

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const join = async (ctx: Ctx, id: string, names: string[]) => {
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
};
const out = async (ctx: Ctx, id: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/withdraw`, {});
const pay = async (ctx: Ctx, id: string, names: string[]) => {
  for (const n of names) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
};
const unmark = (ctx: Ctx, id: string, n: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: false });
const cancel = (ctx: Ctx, id: string, extra: Record<string, unknown> = {}) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, ...extra });
const reopen = (ctx: Ctx, id: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'reopen' });
const keep = (ctx: Ctx, id: string, n: string, keepIt = true) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/credit`, { playerId: ctx.byName[n], keep: keepIt });
const refund = (ctx: Ctx, id: string, n: string, refunded: boolean) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/refund`, { playerId: ctx.byName[n], refunded });
const useCredit = async (ctx: Ctx, id: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/use-credit`, {});
const refundBalance = (ctx: Ctx, n: string, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[n]}/credit-refund`, body);
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mineOn = async (ctx: Ctx, n: string, id: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === id)?.mine;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const pot = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n])?.balanceCents ?? 0;
/** Four players in, and these ones have paid. */
async function game(ctx: Ctx, date: string, paid: string[], inGame = [MITCH, 'Blair', 'Devon', 'Emery']) {
  const s = await on(ctx, date);
  await join(ctx, s.id, inGame);
  await pay(ctx, s.id, paid);
  return s;
}

describe("Mitchell's case: paid ahead for two games, the first is canceled", () => {
  it('keep as credit, cancel the second too, then spend it on a later game', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]); // plays Thu Oct 29
    const tue = await game(ctx, '2026-11-03', [MITCH]); // plays Tue Nov 3
    let d = await dash(ctx);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(2800);
    expect((await money(ctx, '2026-10')).heldCents).toBe(1400);
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);

    // Cancel Thu Oct 29. Nothing changes by itself: still held, waiting for a choice.
    await cancel(ctx, thu.id);
    d = await dash(ctx);
    expect(buildTodo(d).filter((i) => i.kind === 'refund')).toHaveLength(1);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(2800);
    expect(await pot(ctx, MITCH)).toBe(0);

    // Keep as credit.
    expect((await keep(ctx, thu.id, MITCH)).data).toMatchObject({ ok: true, changed: true });
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(d.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH]).refundCents).toBe(1400);
    // Tue Nov 3 is untouched: still Paid, $14, held, not refunded.
    expect(seat(d, tue.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null, keptAsCreditAt: null });
    // Held dropped by $14, Credits owed rose by $14, Left did not move.
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    const oct = await money(ctx, '2026-10');
    expect(oct).toMatchObject({ heldCents: 0, creditsOwedCents: 1400, keptCreditCents: 1400, collectedCents: 0, courtCostCents: 0, netCents: 0 });
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);
    // The refund card for Thu is settled.
    expect(buildTodo(d).some((i) => i.kind === 'refund')).toBe(false);
    expect(seat(d, thu.id, MITCH)).toMatchObject({ keptAsCreditAt: expect.any(String), keptAsCreditCents: 1400 });

    // Also cancel Tue Nov 3: Keep as credit again, he has $28.
    await cancel(ctx, tue.id);
    expect((await keep(ctx, tue.id, MITCH)).status).toBe(200);
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(2800);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 1400, keptCreditCents: 1400 });
    expect(balanceOf(d, ctx.byName[MITCH]).creditCents).toBe(2800);
    // His own screen says $28; nobody else's does.
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(2800);
    expect((await view(ctx, 'Blair')).creditBalanceCents).toBe(0);

    // He signs up for a later $14 game and taps Use credit: Paid with credit, credit drops by $14.
    const later = await on(ctx, '2026-11-10');
    await join(ctx, later.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    let mine = await mineOn(ctx, MITCH, later.id);
    expect(mine).toMatchObject({ oweCents: 1400, useCreditCents: 1400, paymentStatus: 'unpaid', paidWithCredit: false });
    const res = await useCredit(ctx, later.id, MITCH);
    expect(res.data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    mine = await mineOn(ctx, MITCH, later.id);
    expect(mine).toMatchObject({ paymentStatus: 'paid', oweCents: 0, useCreditCents: 0, paidWithCredit: true });
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(1400);
    d = await dash(ctx);
    expect(seat(d, later.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, potCreditCents: 1400, creditCents: 1400 });
    // Held again for the game ahead (it is paid, not played).
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);

    // Once that game is played, the credit used counts as collected that month; the older credit is owed from the oldest first.
    ctx.app.now = Date.parse(later.endsAt) + 60_000;
    const nov = await money(ctx, '2026-11');
    expect(nov).toMatchObject({ collectedCents: 1400, heldCents: 0 });
    // $28 kept (Oct 29 + Nov 3), $14 spent: the oldest is gone, the Nov 3 credit is what is still owed.
    expect(nov.keptCreditCents).toBe(1400);
    expect((await money(ctx, '2026-10')).keptCreditCents).toBe(0);
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(0);
  });

  it('Refund instead of Keep as credit works through the refund records, no credit created', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]);
    await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, thu.id);
    expect((await refund(ctx, thu.id, MITCH, true)).data.changed).toBe(true);
    const d = await dash(ctx);
    expect(seat(d, thu.id, MITCH)).toMatchObject({ refundedAt: expect.any(String), keptAsCreditAt: null });
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    expect(await money(ctx, '2026-10')).toMatchObject({ heldCents: 0, creditsOwedCents: 0, keptCreditCents: 0 });
    // A payment already paid back cannot also be kept.
    expect((await keep(ctx, thu.id, MITCH)).status).toBe(409);
    // Undo the refund, then keep it instead.
    await refund(ctx, thu.id, MITCH, false);
    expect((await keep(ctx, thu.id, MITCH)).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(1400);
  });

  it('a game canceled before there was any credit feature can still be kept as credit', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, thu.id);
    // No credit rows exist yet: the table is simply empty.
    expect((await ctx.app.db.prepare('SELECT COUNT(*) AS n FROM credit_ledger').first<{ n: number }>())!.n).toBe(0);
    ctx.app.now += 3 * DAY; // days later
    expect((await keep(ctx, thu.id, MITCH)).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(1400);
  });

  it('after the deploy nothing changes until a cancel and a choice: existing records read the same', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]);
    const tue = await game(ctx, '2026-11-03', [MITCH]);
    const before = (await dash(ctx)).sessions.map((s: any) => s.roster);
    expect((await dash(ctx)).creditLedger).toEqual([]);
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(0);
    expect(await mineOn(ctx, MITCH, tue.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: false, useCreditCents: 0 });
    expect(await mineOn(ctx, MITCH, thu.id)).toMatchObject({ paymentStatus: 'paid' });
    expect((await dash(ctx)).sessions.map((s: any) => s.roster)).toEqual(before);
  });
});

describe('a paid player leaves a game', () => {
  it('early drop: the refund card offers the choice, Keep as credit makes credit, Held drops', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    expect((await out(ctx, s.id, MITCH)).status).toBe(200);
    let d = await dash(ctx);
    expect(refundRows(d.sessions.find((x: any) => x.id === s.id))).toHaveLength(1);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    expect((await keep(ctx, s.id, MITCH)).status).toBe(200);
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    // Back in: they owe again and can use that credit.
    await join(ctx, s.id, [MITCH]);
    expect(await mineOn(ctx, MITCH, s.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400 });
    expect((await useCredit(ctx, s.id, MITCH)).data).toMatchObject({ paid: true });
    expect(await pot(ctx, MITCH)).toBe(0);
  });

  it('late drop: the Late drop tag stays, and the same choice works', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR; // past the 12-hour deadline
    expect((await out(ctx, s.id, MITCH)).status).toBe(200);
    let d = await dash(ctx);
    expect(seat(d, s.id, MITCH)).toMatchObject({ status: 'withdrawn', lateDropAt: expect.any(String) });
    expect((await keep(ctx, s.id, MITCH)).status).toBe(200);
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(seat(d, s.id, MITCH).lateDropAt).toEqual(expect.any(String)); // the tag stays
    expect(d.players.find((p: any) => p.name === MITCH).lateDrops).toBe(1);
  });

  it('only a payment that is canceled or left can be kept, and only once', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    expect((await keep(ctx, s.id, MITCH)).status).toBe(409); // still playing
    expect((await keep(ctx, s.id, 'Blair')).status).toBe(409); // never paid
    await cancel(ctx, s.id);
    const [a, b] = await Promise.all([keep(ctx, s.id, MITCH), keep(ctx, s.id, MITCH)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await pot(ctx, MITCH)).toBe(1400); // not $28
  });

  it('keep can be undone while all of it is still there, not after some was spent', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    expect((await keep(ctx, a.id, MITCH, false)).data.changed).toBe(true);
    let d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(seat(d, a.id, MITCH)).toMatchObject({ refundedAt: null, keptAsCreditAt: null });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    // Keep again, spend it, now it can not be undone.
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    expect((await keep(ctx, a.id, MITCH, false)).status).toBe(409);
    expect((await refund(ctx, a.id, MITCH, false)).status).toBe(409); // the old Undo button is guarded the same way
    d = await dash(ctx);
    expect(seat(d, a.id, MITCH).keptAsCreditCents).toBe(1400);
    expect(await pot(ctx, MITCH)).toBe(0);
  });

  it('reopening a canceled game whose payment was kept: they owe again and keep their credit', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    expect((await reopen(ctx, a.id)).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(seat(await dash(ctx), a.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', refundedAt: null });
    expect(await mineOn(ctx, MITCH, a.id)).toMatchObject({ oweCents: 1400, useCreditCents: 1400 });
  });
});

describe('Use credit', () => {
  it('credit that covers only part: use the smaller of the two, then pay the rest as usual', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', []);
    // $5 of credit in the pot (a small payment kept).
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 500, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ oweCents: 1400, useCreditCents: 500 });
    const res = await useCredit(ctx, b.id, MITCH);
    expect(res.data).toMatchObject({ usedCents: 500, paid: false });
    // Still owes the rest, shown after the credit; Pay is for the remaining amount.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 900, creditCents: 500, useCreditCents: 0, paidWithCredit: false });
    const g = await view(ctx, MITCH);
    expect(g.owed.find((o: any) => o.sessionId === b.id)).toMatchObject({ amountCents: 900, creditCents: 500 });
    let d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', potCreditCents: 500, creditCents: 500 });
    expect(balanceOf(d, ctx.byName[MITCH]).owedCents).toBe(0); // before the check-in window it is not "owed" yet
    expect(await pot(ctx, MITCH)).toBe(0);
    // A second tap does nothing more (no credit left).
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    // The player pays the rest: "I paid", the organizer confirms. The payment counts the whole $14 as collected.
    const phone = await playerPhone(ctx, MITCH);
    expect((await phone.call('POST', `/api/sessions/${b.id}/paid`, { paid: true })).status).toBe(200);
    await pay(ctx, b.id, [MITCH]);
    d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, potCreditCents: 500 });
    ctx.app.now = Date.parse(b.endsAt) + 60_000;
    expect((await money(ctx, '2026-11')).collectedCents).toBe(1400);
  });

  it('with the $5 credit rule: the $5 comes off first, the pot covers the rest', async () => {
    const ctx = await setupGroup();
    // Six play on Oct 27 so the first four earn $5 credit.
    const a = await on(ctx, '2026-10-27');
    await join(ctx, a.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    ctx.app.now = Date.parse(a.endsAt) + HOUR;
    expect((await dash(ctx)).credits.find((c: any) => c.playerId === ctx.byName[MITCH]).balanceCents).toBe(500);
    // $20 in the pot, from canceled games.
    const c = await on(ctx, '2026-10-29');
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 2000, '${c.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    const b = await on(ctx, '2026-11-05');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Owes $9 after the $5 credit; the pot covers it and the $5 credit is used on this game.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ oweCents: 900, creditCents: 500, useCreditCents: 900 });
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(2000); // the $5 is already counted on the game
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ usedCents: 900, paid: true });
    const d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, potCreditCents: 900, creditCents: 1400 });
    expect(await pot(ctx, MITCH)).toBe(1100);
    expect(d.credits.find((x: any) => x.playerId === ctx.byName[MITCH])).toBeUndefined(); // the $5 credit was used up
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(1100);
  });

  it('paying part with credit and the $5 rule: the pot covers only what is left after the $5', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-10-27');
    await join(ctx, a.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    ctx.app.now = Date.parse(a.endsAt) + HOUR;
    const c = await on(ctx, '2026-10-29');
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 300, '${c.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    const b = await on(ctx, '2026-11-05');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ usedCents: 300, paid: false });
    // 14 - 5 (older credit) - 3 (pot) = 6 left to pay.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 600, creditCents: 800 });
    await pay(ctx, b.id, [MITCH]);
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, potCreditCents: 300 });
  });

  it('is never automatic, never for someone else, a canceled game, a game they are not in, or with no credit', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    // Not in the game: nothing happens by itself, and the tap is refused.
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(1400);
    // In the game: still nothing happens until the tap.
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'unpaid' });
    // Blair has no credit.
    expect((await useCredit(ctx, b.id, 'Blair')).status).toBe(409);
    expect(await mineOn(ctx, 'Blair', b.id)).toMatchObject({ useCreditCents: 0, paymentStatus: 'unpaid' });
    // A canceled game.
    await cancel(ctx, b.id);
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    // Two taps at once spend once.
    const c = await on(ctx, '2026-11-05');
    await join(ctx, c.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    const both = await Promise.all([useCredit(ctx, c.id, MITCH), useCredit(ctx, c.id, MITCH)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await pot(ctx, MITCH)).toBe(0);
  });

  it('the organizer (who pays the court) has no credit to use', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await game(ctx, '2026-11-03', [], [ME, MITCH, 'Blair', 'Devon']);
    await cancel(ctx, a.id);
    expect((await keep(ctx, a.id, ME)).status).toBe(409);
    expect((await useCredit(ctx, (await on(ctx, '2026-11-05')).id, ME)).status).toBe(409);
  });
});

describe('credit goes back to the player', () => {
  it('dropping out of a game paid with credit restores the credit, no refund card', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await out(ctx, b.id, MITCH)).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(1400);
    const d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ status: 'withdrawn', paymentStatus: 'not_applicable', paymentAmountCents: null });
    expect(refundRows(d.sessions.find((x: any) => x.id === b.id))).toEqual([]);
    expect(buildTodo(d).some((i) => i.kind === 'refund')).toBe(false);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
  });

  it('dropping after paying part with credit and part in cash: credit goes back, the cash is the refund', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', []);
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 500, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    await pay(ctx, b.id, [MITCH]);
    expect(seat(await dash(ctx), b.id, MITCH).paymentAmountCents).toBe(1400);
    ctx.app.now = Date.parse(b.startsAt) - 20 * HOUR; // early
    await out(ctx, b.id, MITCH);
    const d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(500);
    expect(seat(d, b.id, MITCH)).toMatchObject({ status: 'withdrawn', paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(refundRows(d.sessions.find((x: any) => x.id === b.id)).map((r: any) => r.paymentAmountCents)).toEqual([900]);
    // Keep the $9 as credit too: $14 in the pot.
    expect((await keep(ctx, b.id, MITCH)).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(1400);
  });

  it('a game canceled after credit was used on it gives the credit back', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    await cancel(ctx, b.id);
    expect(await pot(ctx, MITCH)).toBe(1400);
    const d = await dash(ctx);
    expect(refundRows(d.sessions.find((x: any) => x.id === b.id))).toEqual([]); // nothing was paid in cash
    expect(seat(d, b.id, MITCH).paymentStatus).toBe('unpaid');
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
  });

  it('the organizer can Unmark a credit use; the player cannot undo it themselves', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    const phone = await playerPhone(ctx, MITCH);
    expect((await phone.call('POST', `/api/sessions/${b.id}/paid`, { paid: false })).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await unmark(ctx, b.id, MITCH)).data.changed).toBe(true);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', paymentAmountCents: null, potCreditCents: 0 });
    // And they can use it again.
    expect((await useCredit(ctx, b.id, MITCH)).data.paid).toBe(true);
  });
});

describe('Refund credit balance', () => {
  it('Mark refunded drops the balance to $0, undo brings it back; a changed balance is refused', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    await cancel(ctx, b.id);
    await keep(ctx, b.id, MITCH);
    expect(await pot(ctx, MITCH)).toBe(2800);
    // Opening Venmo marks nothing: only the explicit call does. A stale amount is refused.
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 1400 })).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(2800);
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 2800 })).data.changed).toBe(true);
    let d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(d.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH]).refundCents).toBe(0);
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(0);
    expect(balanceOf(d, ctx.byName[MITCH]).creditCents).toBe(0);
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(0);
    expect((await money(ctx, '2026-11')).creditsOwedCents).toBe(0);
    expect(d.audit.map((x: any) => x.action)).toContain('credit_refund_marked');
    // Nothing to pay back now.
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 0 })).status).toBe(409);
    // Undo.
    expect((await refundBalance(ctx, MITCH, { refunded: false })).data.changed).toBe(true);
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(2800);
    expect((await money(ctx, '2026-10')).keptCreditCents).toBe(1400);
    expect(d.audit.map((x: any) => x.action)).toContain('credit_refund_undone');
  });

  it('pays back the older $5 credit that is part of the balance, and undo restores it', async () => {
    const ctx = await setupGroup();
    const six = await on(ctx, '2026-10-27');
    await join(ctx, six.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    ctx.app.now = Date.parse(six.endsAt) + HOUR;
    const a = await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const d0 = await dash(ctx);
    // He paid $9 plus his $5 credit. Keeping the payment gives the $9 to the pot and the $5 credit back: one balance of $14.
    expect(d0.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH])).toMatchObject({ balanceCents: 900, refundCents: 1400 });
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(1400);
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 1400 })).status).toBe(200);
    const d1 = await dash(ctx);
    expect(d1.credits.find((c: any) => c.playerId === ctx.byName[MITCH])).toBeUndefined();
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(0);
    await refundBalance(ctx, MITCH, { refunded: false });
    const d2 = await dash(ctx);
    expect(d2.credits.find((c: any) => c.playerId === ctx.byName[MITCH]).balanceCents).toBe(500);
    expect((await view(ctx, MITCH)).creditBalanceCents).toBe(1400);
  });

  it('a player with only the older $5 credit can be paid back too', async () => {
    const ctx = await setupGroup();
    const six = await on(ctx, '2026-10-27');
    await join(ctx, six.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    ctx.app.now = Date.parse(six.endsAt) + HOUR;
    expect((await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH])).toMatchObject({ balanceCents: 0, refundCents: 500 });
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 500 })).status).toBe(200);
    expect((await dash(ctx)).credits.find((c: any) => c.playerId === ctx.byName[MITCH])).toBeUndefined();
  });
});

describe('credit is private and the numbers agree', () => {
  it('nobody sees anyone else’s credit, and players never see phone numbers or money details', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, b.id, MITCH);
    for (const n of PLAYER_NAMES.filter((x) => x !== MITCH)) {
      const text = (await (await playerPhone(ctx, n)).call('GET', '/api/group')).text;
      expect(text, n).not.toMatch(/creditLedger|keptAsCredit|potCredit|kept_credit|credit_ledger|555-01/i);
      expect((await view(ctx, n)).creditBalanceCents).toBe(0);
      // The only way to learn about his credit is his own screen: another player cannot spend or see it.
      expect((await useCredit(ctx, b.id, n)).status).toBe(409);
      expect((await (await playerPhone(ctx, n)).call('GET', '/api/admin/dashboard')).status).toBe(401);
    }
    expect((await ctx.app.client().call('GET', '/api/status')).text).not.toMatch(/credit/i);
    // His own screen shows only his own, with no money of other people.
    const mine = JSON.stringify(await view(ctx, MITCH));
    expect(mine).not.toMatch(/creditLedger|keptAsCredit|potCredit|555-01|courtCost|membership/i);
    // Organizer sees it.
    expect(JSON.stringify(await dash(ctx))).toContain('creditLedger');
    // View as shows the same as the player does, not more.
    const as = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair })).data;
    expect(as.creditBalanceCents).toBe(0);
  });

  it('Money, Players and each game agree on held, credit and collected', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await game(ctx, '2026-11-03', [MITCH, 'Blair']);
    const b = await game(ctx, '2026-11-05', [MITCH, 'Blair', 'Devon']);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH); // $14 credit
    await refund(ctx, a.id, 'Blair', true); // $14 back by hand
    const c = await on(ctx, '2026-11-10');
    await join(ctx, c.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, c.id, MITCH); // $14 into game c
    let d = await dash(ctx);
    let m = await money(ctx, '2026-11');
    // Held = b (3 paid) + c (credit used) = $56; credit owed = the $14 kept (the pot is $0 now, so it was spent).
    expect(heldCents(d)).toBe(5600);
    expect(m.heldCents).toBe(5600);
    expect(d.players.reduce((sum: number, p: any) => sum + heldCents(d, p.id), 0)).toBe(5600);
    const potTotal = d.creditLedger.reduce((sum: number, p: any) => sum + p.balanceCents, 0);
    expect(potTotal).toBe(0);
    expect(m.keptCreditCents).toBe(potTotal + 0); // everything kept so far is spent
    // Play everything: collected = what is paid, per game and in total.
    ctx.app.now = Date.parse(c.endsAt) + HOUR;
    d = await dash(ctx);
    m = await money(ctx, '2026-11');
    const perGame = m.sessions.reduce((sum: number, s: any) => sum + s.collectedCents, 0);
    expect(m.collectedCents).toBe(perGame);
    expect(m.collectedCents).toBe(4200 + 1400); // b: 3 x 14, c: the credit used counts as collected
    expect(m.heldCents).toBe(0);
    expect(heldCents(d)).toBe(0);
    void b;
  });

  it('credit kept in October and used in November follows the right months', async () => {
    const ctx = await setupGroup();
    const oct = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, oct.id);
    await keep(ctx, oct.id, MITCH);
    expect(await money(ctx, '2026-10')).toMatchObject({ creditsOwedCents: 1400, keptCreditCents: 1400 });
    expect(await money(ctx, '2026-11')).toMatchObject({ creditsOwedCents: 0 });
    const nov = await on(ctx, '2026-11-03');
    await join(ctx, nov.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await useCredit(ctx, nov.id, MITCH);
    // Spent: October no longer owes it. November has it as held until played, then collected.
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(0);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 1400, collectedCents: 0 });
    ctx.app.now = Date.parse(nov.endsAt) + HOUR;
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, collectedCents: 1400, courtCostCents: 4800 });
  });
});

describe('"Were you charged for this court?"', () => {
  it('within 12 hours a Yes counts as the canceled game’s court cost; No or no answer is $0', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    ctx.app.now = Date.parse(s.startsAt) - 11 * HOUR;
    expect((await cancel(ctx, s.id, { chargedCents: 4800 })).status).toBe(200);
    let d = await dash(ctx);
    expect(d.sessions.find((x: any) => x.id === s.id).chargedCents).toBe(4800);
    let m = await money(ctx, '2026-11');
    expect(m.courtCostCents).toBe(4800);
    expect(m.sessions.find((x: any) => x.id === s.id)).toMatchObject({ state: 'canceled', charged: true, courtCostCents: 4800, collectedCents: 0 });
    expect(m.netCents).toBe(-4800);
    expect(m.bottomLine).toBe('Nothing played yet'); // no game was played; the charge is still the court cost
    // Reopen and cancel again with No: back to $0.
    ctx.app.now = Date.parse(s.startsAt) - 10 * HOUR;
    await reopen(ctx, s.id);
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).chargedCents).toBeNull();
    await cancel(ctx, s.id, { chargedCents: 0 });
    m = await money(ctx, '2026-11');
    expect(m.courtCostCents).toBe(0);
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).chargedCents).toBeNull();
  });

  it('is asked at 11 hours before and not at 13 hours before (an amount sent anyway is ignored)', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    ctx.app.now = Date.parse(a.startsAt) - 13 * HOUR;
    await cancel(ctx, a.id, { chargedCents: 4800 });
    expect((await dash(ctx)).sessions.find((x: any) => x.id === a.id).chargedCents).toBeNull();
    ctx.app.now = Date.parse(b.startsAt) - 11 * HOUR;
    await cancel(ctx, b.id, { chargedCents: 3500 });
    expect((await dash(ctx)).sessions.find((x: any) => x.id === b.id).chargedCents).toBe(3500);
    expect((await money(ctx, '2026-11')).courtCostCents).toBe(3500);
    // The boundary is exactly 12 hours.
    const c = await on(ctx, '2026-11-10');
    ctx.app.now = Date.parse(c.startsAt) - 12 * HOUR;
    await cancel(ctx, c.id, { chargedCents: 100 });
    expect((await dash(ctx)).sessions.find((x: any) => x.id === c.id).chargedCents).toBe(100);
  });

  it('rejects a bad amount and never reaches a player', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    expect((await cancel(ctx, s.id, { chargedCents: -5 })).status).toBe(400);
    expect((await cancel(ctx, s.id, { chargedCents: 'lots' })).status).toBe(400);
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).state.flags.canceled).toBe(false);
    await cancel(ctx, s.id, { chargedCents: 4800 });
    expect((await view(ctx, MITCH)).sessions.find((x: any) => x.id === s.id)).toMatchObject({ canceled: true });
    expect(JSON.stringify(await view(ctx, 'Blair'))).not.toMatch(/4800|chargedCents/);
    expect(JSON.stringify(await view(ctx, MITCH))).not.toMatch(/4800|chargedCents/);
  });
});

describe('backup and restore carry the credit', () => {
  it('the backup file has the credit table, a restore brings it back, and an older backup without it restores empty', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const file = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    expect(file.tables.credit_ledger).toHaveLength(1);
    const fresh = createNodeD1(':memory:');
    (fresh as any).raw.exec(backupToSql(file));
    const row = (fresh as any).raw.prepare('SELECT kind, amount_cents FROM credit_ledger').get();
    expect(row).toMatchObject({ kind: 'kept', amount_cents: 1400 });
    const old = JSON.parse(JSON.stringify(file));
    delete old.tables.credit_ledger;
    const fresh2 = createNodeD1(':memory:');
    (fresh2 as any).raw.exec(backupToSql(old));
    expect((fresh2 as any).raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get().n).toBe(0);
  });

  it('a player with credit history is hidden, not deleted', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    await keep(ctx, a.id, MITCH);
    const res = await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName[MITCH]}`);
    expect(res.data.result).toBe('hidden');
    expect(await pot(ctx, MITCH)).toBe(1400);
  });
});

describe('the credit helpers', () => {
  const row = (id: string, kind: CreditRow['kind'], cents: number, at: string, extra: Partial<CreditRow> = {}): CreditRow => ({
    id, playerId: 'p', kind, cents, fiveCents: 0, sessionId: null, createdAt: at, endedAt: null, ...extra,
  });
  it('the pot is kept minus used minus paid back, and an ended row does not count', () => {
    const rows = [row('a', 'kept', 1400, '1'), row('b', 'kept', 1400, '2'), row('c', 'used', 1400, '3'), row('d', 'refunded', 500, '4', { fiveCents: 200 }), row('e', 'used', 700, '5', { endedAt: 'x' })];
    expect(potBalance(rows, 'p')).toBe(2800 - 1400 - 300);
    expect(potBalance(rows, 'nobody')).toBe(0);
  });
  it('what is spent comes off the oldest credit first', () => {
    const rows = [row('a', 'kept', 1400, '1'), row('b', 'kept', 1400, '2'), row('c', 'used', 1400, '3')];
    expect([...keptRemaining(rows)]).toEqual([['a', 0], ['b', 1400]]);
    const more = [...rows, row('d', 'used', 700, '4')];
    expect([...keptRemaining(more)]).toEqual([['a', 0], ['b', 700]]);
  });
});
