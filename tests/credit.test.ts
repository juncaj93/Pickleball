import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backupToSql } from '../scripts/backup-sql.mjs';
import { creditEntryText, keptRemaining, potBalance, type CreditRow } from '../shared/credit';
import { createNodeD1 } from '../dev/nodeD1';
import { balanceOf, buildTodo, heldCents } from '../src/pages/admin/todo';
import { DAY, HOUR, playerPhone, PLAYER_NAMES, setupGroup, withoutIds } from './harness';

// Credit under the "any number from 4 to 10 plays" model: money that comes
// back to a player (a cancel, a drop, paid more than the final price) becomes
// credit by itself, the player spends it with Use credit or asks for a refund,
// and Money, Players and each game agree.

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
const useCredit = async (ctx: Ctx, id: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/use-credit`, {});
const requestRefund = async (ctx: Ctx, n: string, cents: number) => (await playerPhone(ctx, n)).call('POST', '/api/me/refund-request', { cents });
const resolveRequest = (ctx: Ctx, id: string, action: 'refunded' | 'not_now' | 'undo') => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action });
const refundBalance = (ctx: Ctx, n: string, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[n]}/credit-refund`, body);
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mineOn = async (ctx: Ctx, n: string, id: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === id)?.mine;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const pot = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n])?.balanceCents ?? 0;
const ledgerOf = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n]);
const liveEntries = async (ctx: Ctx, n: string) => ((await ledgerOf(ctx, n))?.entries ?? []).filter((e: any) => !e.endedAt);
/** Four players in, and these ones have paid. */
async function game(ctx: Ctx, date: string, paid: string[], inGame = [MITCH, 'Blair', 'Devon', 'Emery']) {
  const s = await on(ctx, date);
  await join(ctx, s.id, inGame);
  await pay(ctx, s.id, paid);
  return s;
}
/** The game is over and the organizer finalizes it (everyone played unless told otherwise). */
async function endAndFinalize(ctx: Ctx, s: any, body: Record<string, unknown> = { everyone: true }) {
  ctx.app.now = Date.parse(s.endsAt) + HOUR;
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, body);
  expect(res.status, res.text).toBe(200);
  return res;
}
/** Six play and pay on this date, finalized at $9: the first name gets $5 credit from it. */
async function sixPlayed(ctx: Ctx, date: string) {
  const s = await on(ctx, date);
  await join(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
  await pay(ctx, s.id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
  await endAndFinalize(ctx, s);
  return s;
}

describe("Mitchell's case: paid ahead for two games, the first is canceled", () => {
  it('the cancel makes credit by itself, cancel the second too, then spend it on a later game', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]); // plays Thu Oct 29
    const tue = await game(ctx, '2026-11-03', [MITCH]); // plays Tue Nov 3
    let d = await dash(ctx);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(2800);
    expect((await money(ctx, '2026-10')).heldCents).toBe(1400);
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);

    // Cancel Thu Oct 29: his $14 is credit right away. Nothing to decide, no card.
    expect((await cancel(ctx, thu.id)).status).toBe(200);
    d = await dash(ctx);
    expect(buildTodo(d).some((i) => i.kind === 'refund_request')).toBe(false);
    expect(d.refundRequests).toEqual([]);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(d.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH]).refundCents).toBe(1400);
    expect(seat(d, thu.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'canceled' });
    // Tue Nov 3 is untouched: still Paid, $14, held.
    expect(seat(d, tue.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: null, creditBackCents: 0 });
    // Held dropped by $14, Credits owed rose by $14, Left did not move.
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    const oct = await money(ctx, '2026-10');
    expect(oct).toMatchObject({ heldCents: 0, creditsOwedCents: 1400, collectedCents: 0, courtCostCents: 0, netCents: 0 });
    expect((await money(ctx, '2026-11')).heldCents).toBe(1400);
    expect(await liveEntries(ctx, MITCH)).toEqual([expect.objectContaining({ kind: 'kept', cents: 1400, reason: 'canceled', sessionId: thu.id })]);

    // Also cancel Tue Nov 3: credit again, he has $28.
    await cancel(ctx, tue.id);
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(2800);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 1400 });
    expect(balanceOf(d, ctx.byName[MITCH]).creditCents).toBe(2800);
    // His own screen says $28; nobody else's does.
    expect((await view(ctx, MITCH)).credit).toMatchObject({ balanceCents: 2800, usableCents: 2800, pending: null });
    expect((await view(ctx, 'Blair')).credit.balanceCents).toBe(0);

    // He signs up for a later $14 game: his credit is used as he joins. Paid with credit, credit drops by $14.
    const later = await on(ctx, '2026-11-10');
    const res = await (await playerPhone(ctx, MITCH)).call('POST', `/api/sessions/${later.id}/join`, {});
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    await join(ctx, later.id, ['Blair', 'Devon', 'Emery']);
    const mine = await mineOn(ctx, MITCH, later.id);
    expect(mine).toMatchObject({ paymentStatus: 'paid', oweCents: 0, useCreditCents: 0, paidWithCredit: true, creditCents: 0 });
    // Nothing is left to tap: Use credit on the same game spends nothing more.
    expect((await useCredit(ctx, later.id, MITCH)).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(1400);
    d = await dash(ctx);
    expect(seat(d, later.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    // Held again for the game ahead (it is paid, not finalized).
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);

    // The game is over but not finalized: still held. Finalized (4 played, $14): the credit used counts as collected that month.
    ctx.app.now = Date.parse(later.endsAt) + 60_000;
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 1400, collectedCents: 0 });
    expect((await money(ctx, '2026-11')).sessions.find((x: any) => x.id === later.id).state).toBe('not_finalized');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${later.id}/finalize`, { everyone: true })).status).toBe(200);
    const nov = await money(ctx, '2026-11');
    expect(nov).toMatchObject({ collectedCents: 1400, heldCents: 0 });
    expect(nov.sessions.find((x: any) => x.id === later.id)).toMatchObject({ state: 'played', playedCount: 4, priceCents: 1400, collectedCents: 1400 });
    // $28 came back (Oct 29 + Nov 3), $14 spent: the oldest is gone, the Nov 3 credit is what is still owed.
    expect(nov.creditsOwedCents).toBe(1400);
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(0);
  });

  it('a refund instead: he asks for the credit back, Mark refunded settles it, undo brings it back', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]);
    await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, thu.id);
    expect(await pot(ctx, MITCH)).toBe(1400);
    // The request reserves the amount: nothing to spend until the organizer answers.
    const req = await requestRefund(ctx, MITCH, 1400);
    expect(req.status, req.text).toBe(200);
    expect(req.data.request).toMatchObject({ cents: 1400 });
    expect((await view(ctx, MITCH)).credit).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: expect.objectContaining({ cents: 1400 }) });
    expect((await requestRefund(ctx, MITCH, 1400)).status).toBe(409); // one open request at a time
    let d = await dash(ctx);
    expect(d.refundRequests).toEqual([expect.objectContaining({ playerId: ctx.byName[MITCH], name: MITCH, cents: 1400 })]);
    expect(buildTodo(d)[0].kind).toBe('refund_request');
    expect(d.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH])).toMatchObject({ balanceCents: 1400, reservedCents: 1400, refundCents: 0 });
    const b = await on(ctx, '2026-11-05');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect((await mineOn(ctx, MITCH, b.id)).useCreditCents).toBe(0);
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    // Mark refunded: the credit is gone, no credit owed; the other game is still held.
    const id = d.refundRequests[0].id;
    expect((await resolveRequest(ctx, id, 'refunded')).data).toMatchObject({ ok: true, changed: true });
    d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(d.refundRequests).toEqual([]);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
    expect(await money(ctx, '2026-10')).toMatchObject({ heldCents: 0, creditsOwedCents: 0 });
    expect((await view(ctx, MITCH)).credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null });
    expect((await resolveRequest(ctx, id, 'refunded')).status).toBe(409); // already answered
    // Undo: the credit is back and the request waits again; Not now closes it and frees the credit.
    expect((await resolveRequest(ctx, id, 'undo')).data.changed).toBe(true);
    expect(await pot(ctx, MITCH)).toBe(1400);
    d = await dash(ctx);
    expect(d.refundRequests).toHaveLength(1);
    expect((await resolveRequest(ctx, id, 'not_now')).status).toBe(200);
    d = await dash(ctx);
    expect(d.refundRequests).toEqual([]);
    expect((await view(ctx, MITCH)).credit).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ paid: true, usedCents: 1400 });
    const log = d.audit.map((x: any) => x.action);
    for (const a of ['refund_requested', 'credit_refund_marked', 'credit_refund_undone', 'refund_request_declined']) expect(log).toContain(a);
  });

  it('money still held from a game canceled before this model went live becomes credit on migration, once', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const thu = await game(ctx, '2026-10-29', [MITCH], [ME, MITCH, 'Blair', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/payment`, { playerId: ctx.byName[ME], paid: true }); // the court, $48
    const tue = await game(ctx, '2026-11-03', ['Blair']);
    await cancel(ctx, thu.id);
    await out(ctx, tue.id, 'Blair');
    // As it was before: the payments sit there, no credit rows, waiting for a choice that no longer exists.
    ctx.app.db.raw.exec('DELETE FROM credit_ledger; UPDATE session_players SET refunded_at = NULL');
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(await pot(ctx, 'Blair')).toBe(0);
    ctx.app.now += 3 * DAY; // days later, the deploy
    const sql = readFileSync('migrations/0013_any_number_plays.sql', 'utf8');
    const convert = sql.slice(sql.indexOf('-- One-time conversion'));
    ctx.app.db.raw.exec(convert);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(await pot(ctx, 'Blair')).toBe(1400);
    const d = await dash(ctx);
    expect(seat(d, thu.id, MITCH)).toMatchObject({ refundedAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'migrated' });
    expect(seat(d, tue.id, 'Blair')).toMatchObject({ status: 'withdrawn', refundedAt: expect.any(String), creditBackCents: 1400 });
    // The organizer's own court payment is never credit.
    expect(d.creditLedger.some((p: any) => p.playerId === ctx.byName[ME])).toBe(false);
    expect(seat(d, thu.id, ME)).toMatchObject({ paymentStatus: 'paid', creditBackCents: 0 });
    // A clear history line, and running it again changes nothing.
    const entry = (await liveEntries(ctx, MITCH))[0];
    expect(creditEntryText(entry, TZ)).toBe('+$14 kept from Thu, Oct 29');
    ctx.app.db.raw.exec(convert);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(await liveEntries(ctx, MITCH)).toHaveLength(1);
  });

  it('existing paid records read the same: no credit and nothing owed until something comes back', async () => {
    const ctx = await setupGroup();
    const thu = await game(ctx, '2026-10-29', [MITCH]);
    const tue = await game(ctx, '2026-11-03', [MITCH]);
    const before = (await dash(ctx)).sessions.map((s: any) => s.roster);
    expect((await dash(ctx)).creditLedger).toEqual([]);
    expect((await view(ctx, MITCH)).credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    expect(await mineOn(ctx, MITCH, tue.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: false, useCreditCents: 0, creditBackCents: 0 });
    expect(await mineOn(ctx, MITCH, thu.id)).toMatchObject({ paymentStatus: 'paid', creditBackCents: 0 });
    expect((await dash(ctx)).sessions.map((s: any) => s.roster)).toEqual(before);
  });
});

describe('a paid player leaves a game', () => {
  it('early drop: the money is credit right away, Held drops, no card for the organizer', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    const res = await out(ctx, s.id, MITCH);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    let d = await dash(ctx);
    expect(buildTodo(d).some((i) => i.kind === 'refund_request')).toBe(false);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(seat(d, s.id, MITCH)).toMatchObject({ status: 'withdrawn', paymentStatus: 'paid', paymentAmountCents: 1400, refundedAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(await mineOn(ctx, MITCH, s.id)).toMatchObject({ status: 'withdrawn', creditBackCents: 1400 });
    expect((await view(ctx, MITCH)).credit).toMatchObject({ balanceCents: 1400, usableCents: 1400 });
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, creditsOwedCents: 1400 });
    // Back in: the seat is new and owes again, and that credit pays it as they join (credit at sign-up is automatic).
    const back = await (await playerPhone(ctx, MITCH)).call('POST', `/api/sessions/${s.id}/join`, {});
    expect(back.data).toMatchObject({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    expect(await mineOn(ctx, MITCH, s.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0, useCreditCents: 0, creditCents: 0 });
    expect((await useCredit(ctx, s.id, MITCH)).status).toBe(409); // nothing left to tap
    expect(await pot(ctx, MITCH)).toBe(0);
    d = await dash(ctx);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(1400);
  });

  it('late drop: the Late drop tag stays, and the money is credit the same way', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR; // past the 12-hour deadline
    expect((await out(ctx, s.id, MITCH)).data.creditBackCents).toBe(1400);
    const d = await dash(ctx);
    expect(seat(d, s.id, MITCH)).toMatchObject({ status: 'withdrawn', lateDropAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(d.players.find((p: any) => p.name === MITCH).lateDrops).toBe(1);
    const kinds = buildTodo(d).map((i) => i.kind);
    expect(kinds).toContain('latedrop');
    expect(kinds).not.toContain('refund_request');
  });

  it('money comes back once: an unpaid drop makes nothing, a second drop or a cancel of the same seat adds nothing', async () => {
    const ctx = await setupGroup();
    const s = await game(ctx, '2026-11-03', [MITCH]);
    expect((await out(ctx, s.id, 'Blair')).data.creditBackCents).toBe(0); // never paid
    expect(await ledgerOf(ctx, 'Blair')).toBeUndefined();
    expect((await out(ctx, s.id, MITCH)).data.creditBackCents).toBe(1400);
    await join(ctx, s.id, [MITCH]);
    expect((await out(ctx, s.id, MITCH)).data.creditBackCents).toBe(0); // the money is credit already
    expect(await pot(ctx, MITCH)).toBe(1400);
    await cancel(ctx, s.id);
    expect(await pot(ctx, MITCH)).toBe(1400); // not $28
    expect(await pot(ctx, 'Blair')).toBe(0);
    expect(await liveEntries(ctx, MITCH)).toHaveLength(1);
  });

  it('credit from a payment is taken back by unmarking it only while all of it is still there; a settled seat cannot be unmarked', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    await join(ctx, (await on(ctx, '2026-11-03')).id, [MITCH, 'Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    await cancel(ctx, a.id);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect((await unmark(ctx, a.id, MITCH)).status).toBe(409); // it is credit now
    expect(await pot(ctx, MITCH)).toBe(1400);
    // Six play Nov 3 at $9: $5 back each. Unmarking the payment takes that $5 back.
    const b = await sixPlayed(ctx, '2026-11-03');
    expect(await pot(ctx, MITCH)).toBe(1900);
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ creditBackCents: 500, creditBackReason: 'finalized' });
    expect((await unmark(ctx, b.id, MITCH)).data.changed).toBe(true);
    expect(await pot(ctx, MITCH)).toBe(1400);
    let d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', creditBackCents: 0, owesCents: 900 });
    // Marked paid again: the final price, nothing back.
    await pay(ctx, b.id, [MITCH]);
    d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, creditBackCents: 0 });
    expect(await pot(ctx, MITCH)).toBe(1400);
    // Blair spends her $5 from that game (used by itself as she joins the next one): her payment can no longer be unmarked.
    const c = await on(ctx, '2026-11-05');
    const joined = await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${c.id}/join`, {});
    expect(joined.data).toEqual({ result: 'confirmed', creditCents: 500, paidWithCredit: false });
    expect(await mineOn(ctx, 'Blair', c.id)).toMatchObject({ paymentStatus: 'unpaid', creditCents: 500, oweCents: 900, useCreditCents: 0 });
    expect(await pot(ctx, 'Blair')).toBe(0);
    await join(ctx, c.id, ['Devon', 'Emery', 'Frankie']);
    expect((await unmark(ctx, b.id, 'Blair')).status).toBe(409);
    expect(seat(await dash(ctx), b.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', creditBackCents: 500 });
  });

  it('reopening a canceled game whose payment became credit: they owe again and keep their credit', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, a.id);
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
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    // $5 of credit in the pot (a small payment that came back).
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 500, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ oweCents: 1400, useCreditCents: 500 });
    const res = await useCredit(ctx, b.id, MITCH);
    expect(res.data).toMatchObject({ usedCents: 500, paid: false });
    // Still owes the rest, shown after the credit; Pay is for the remaining amount.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 900, creditCents: 500, useCreditCents: 0, paidWithCredit: false });
    const g = await view(ctx, MITCH);
    expect(g.owed.find((o: any) => o.sessionId === b.id)).toMatchObject({ amountCents: 900, creditCents: 500, finalized: false });
    let d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', creditCents: 500, owesCents: 900 });
    expect(balanceOf(d, ctx.byName[MITCH]).owedCents).toBe(0); // before the check-in window it is not "owed" yet
    expect(await pot(ctx, MITCH)).toBe(0);
    // A second tap does nothing more (no credit left).
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    // The player pays the rest: "I paid", the organizer confirms. The payment is the whole $14.
    const phone = await playerPhone(ctx, MITCH);
    expect((await phone.call('POST', `/api/sessions/${b.id}/paid`, { paid: true })).status).toBe(200);
    await pay(ctx, b.id, [MITCH]);
    d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 500 });
    // Finalized with 4 played ($14): the whole $14 is collected, nothing back.
    await endAndFinalize(ctx, b);
    expect((await money(ctx, '2026-11')).collectedCents).toBe(1400);
    expect(seat(await dash(ctx), b.id, MITCH).creditBackCents).toBe(0);
  });

  it('credit from a finalized game ($5 back when 6 played) joins the pot and is spent like any other', async () => {
    const ctx = await setupGroup();
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    const b = await on(ctx, '2026-11-05');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Six play Oct 27 at $9 each: everyone who paid $14 gets $5 back.
    const a = await sixPlayed(ctx, '2026-10-27');
    expect(await liveEntries(ctx, MITCH)).toEqual([expect.objectContaining({ kind: 'kept', cents: 500, reason: 'finalized', playedCount: 6, sessionId: a.id })]);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(500);
    // $20 more in the pot, from a canceled game.
    const c = await on(ctx, '2026-10-29');
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 2000, '${c.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(2500);
    // Owes the flat $14; the pot covers it.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ oweCents: 1400, creditCents: 0, useCreditCents: 1400 });
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ usedCents: 1400, paid: true });
    const d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    expect(await pot(ctx, MITCH)).toBe(1100);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(1100);
  });

  it('part credit, part cash, then finalized at a lower price: the extra comes back as credit', async () => {
    const ctx = await setupGroup();
    const c = await on(ctx, '2026-10-29');
    const b = await on(ctx, '2026-11-05');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 300, '${c.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ usedCents: 300, paid: false });
    // 14 - 3 (pot) = 11 left to pay.
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1100, creditCents: 300 });
    await pay(ctx, b.id, [MITCH]);
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 300 });
    // Two more join and everyone pays: 6 play at $9, so $5 of his $14 comes back.
    await join(ctx, b.id, ['Frankie', 'Alex']);
    await pay(ctx, b.id, ['Blair', 'Devon', 'Emery', 'Frankie', 'Alex']);
    await endAndFinalize(ctx, b);
    const d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 300, creditBackCents: 500, creditBackReason: 'finalized', owesCents: 0 });
    expect(await pot(ctx, MITCH)).toBe(500);
    expect(seat(d, b.id, 'Blair').creditBackCents).toBe(500);
    expect((await money(ctx, '2026-11')).collectedCents).toBe(6 * 900);
  });

  it('is automatic and exact at sign-up, and never for someone else, a canceled game, a game they are not in, the organizer, or with no credit', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    const b = await on(ctx, '2026-11-03');
    // Not in the game: nothing happens by itself, and the tap is refused.
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(1400);
    // Blair (no credit) joins first: nothing is used, least of all his credit.
    const blair = await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${b.id}/join`, {});
    expect(blair.data).toEqual({ result: 'confirmed' });
    expect(await pot(ctx, MITCH)).toBe(1400);
    // He joins: his credit pays the seat in the same step, exactly $14, once.
    const joined = await (await playerPhone(ctx, MITCH)).call('POST', `/api/sessions/${b.id}/join`, {});
    expect(joined.data).toEqual({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(await mineOn(ctx, MITCH, b.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0, useCreditCents: 0, creditCents: 0 });
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    expect((await liveEntries(ctx, MITCH)).filter((e: any) => e.kind === 'used')).toEqual([expect.objectContaining({ cents: 1400, sessionId: b.id })]);
    await join(ctx, b.id, ['Devon', 'Emery']);
    // Blair has no credit.
    expect((await useCredit(ctx, b.id, 'Blair')).status).toBe(409);
    expect(await mineOn(ctx, 'Blair', b.id)).toMatchObject({ useCreditCents: 0, paymentStatus: 'unpaid' });
    expect(await ledgerOf(ctx, 'Blair')).toBeUndefined();
    // A canceled game: the credit used on it comes back, and it can't be used there again.
    await cancel(ctx, b.id);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect((await useCredit(ctx, b.id, MITCH)).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(1400);
    // The organizer never uses credit, even with some in the pot.
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'org1', id, '${ctx.byName[ME]}', 'kept', 1400, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    const c = await on(ctx, '2026-11-05');
    const org = await (await playerPhone(ctx, ME)).call('POST', `/api/sessions/${c.id}/join`, {});
    expect(org.data).toEqual({ result: 'confirmed' });
    const orgUsed = ctx.app.db.raw.prepare(`SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'used' AND player_id = ?`).get(ctx.byName[ME]) as { n: number };
    expect(orgUsed.n).toBe(0);
    expect(seat(await dash(ctx), c.id, ME)).toMatchObject({ isOrganizer: true, paymentStatus: 'unpaid', creditCents: 0 });
    // Two taps of I'm in at once spend once: one $14 entry, the pot is $0, never below.
    await join(ctx, c.id, ['Blair', 'Devon']);
    const taps = await Promise.all([1, 2].map(async () => (await playerPhone(ctx, MITCH)).call('POST', `/api/sessions/${c.id}/join`, {})));
    expect(taps.map((r) => r.status)).toEqual([200, 200]);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await liveEntries(ctx, MITCH)).filter((e: any) => e.kind === 'used')).toEqual([expect.objectContaining({ cents: 1400, sessionId: c.id })]);
    expect(seat(await dash(ctx), c.id, MITCH)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    // Two Use credit taps at once spend once: credit that arrives after he joined is his to tap.
    const d = await on(ctx, '2026-11-10');
    await join(ctx, d.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    expect(await mineOn(ctx, MITCH, d.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 0 });
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k2', id, '${ctx.byName[MITCH]}', 'kept', 1400, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    // Arriving later, it is not used by itself: the seat still owes until the tap.
    expect(await mineOn(ctx, MITCH, d.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400 });
    const both = await Promise.all([useCredit(ctx, d.id, MITCH), useCredit(ctx, d.id, MITCH)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await pot(ctx, MITCH)).toBe(0);
  });

  it('the organizer (who pays the court) never gets credit and has none to use or ask back', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await game(ctx, '2026-11-03', [MITCH], [ME, MITCH, 'Blair', 'Devon']);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/payment`, { playerId: ctx.byName[ME], paid: true })).status).toBe(200); // the court
    await cancel(ctx, a.id);
    const d = await dash(ctx);
    expect(seat(d, a.id, ME)).toMatchObject({ isOrganizer: true, creditBackCents: 0 });
    expect(seat(d, a.id, MITCH).creditBackCents).toBe(1400);
    expect(d.creditLedger.some((p: any) => p.playerId === ctx.byName[ME])).toBe(false);
    expect((await useCredit(ctx, (await on(ctx, '2026-11-05')).id, ME)).status).toBe(409);
    expect((await requestRefund(ctx, ME, 1400)).status).toBe(409);
  });
});

describe('credit goes back to the player', () => {
  it('dropping out of a game paid with credit restores the credit; nothing new is created', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    await cancel(ctx, a.id);
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    expect(await pot(ctx, MITCH)).toBe(0);
    const res = await out(ctx, b.id, MITCH);
    expect(res.status).toBe(200);
    expect(res.data.creditBackCents).toBe(0);
    expect(await pot(ctx, MITCH)).toBe(1400);
    const d = await dash(ctx);
    // The $14 of credit he paid with went back to him: the card says so ("Your $14 is now credit").
    expect(seat(d, b.id, MITCH)).toMatchObject({ status: 'withdrawn', paymentStatus: 'not_applicable', paymentAmountCents: null, creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(buildTodo(d).some((i) => i.kind === 'refund_request')).toBe(false);
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    const used = (await ledgerOf(ctx, MITCH)).entries.find((e: any) => e.kind === 'used');
    expect(used).toMatchObject({ cents: 1400, sessionId: b.id, endedAt: expect.any(String), endedReason: 'dropped' });
    expect(await liveEntries(ctx, MITCH)).toEqual([expect.objectContaining({ kind: 'kept', cents: 1400, reason: 'canceled' })]);
  });

  it('dropping after paying part with credit and part in cash: both come back, $14 in the pot', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', []);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    ctx.app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) SELECT 'k1', id, '${ctx.byName[MITCH]}', 'kept', 500, '${a.id}', '2026-10-26T12:00:00.000Z' FROM groups`,
    );
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 500, paid: false });
    await pay(ctx, b.id, [MITCH]);
    expect(seat(await dash(ctx), b.id, MITCH).paymentAmountCents).toBe(1400);
    ctx.app.now = Date.parse(b.startsAt) - 20 * HOUR; // early
    expect((await out(ctx, b.id, MITCH)).data.creditBackCents).toBe(900); // the cash part; the $5 credit simply goes back
    const d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(1400);
    // $9 of cash became a credit entry and the $5 of credit went back: $14 came back from the seat.
    expect(seat(d, b.id, MITCH)).toMatchObject({ status: 'withdrawn', paymentStatus: 'paid', paymentAmountCents: 900, refundedAt: expect.any(String), creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
  });

  it('a game canceled after credit was used on it gives the credit back', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    await cancel(ctx, a.id);
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    await cancel(ctx, b.id);
    expect(await pot(ctx, MITCH)).toBe(1400);
    const d = await dash(ctx);
    expect(seat(d, b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', creditBackCents: 1400, creditBackReason: 'canceled' }); // the credit he used came back
    expect(heldCents(d, ctx.byName[MITCH])).toBe(0);
    // The player's history (since the Oct 31 money audit) keeps the use too, ended by the cancel, so their credit
    // sheet can say "$14 returned from Nov 3 (canceled)"; the organizer's ledger shows the same.
    expect((await view(ctx, MITCH)).credit.history.map((e: any) => [e.kind, e.endedReason])).toEqual([
      ['used', 'canceled'],
      ['kept', null],
    ]);
    const used = (await ledgerOf(ctx, MITCH)).entries.find((e: any) => e.kind === 'used');
    expect(used).toMatchObject({ cents: 1400, endedAt: expect.any(String), endedReason: 'canceled' });
  });

  it('the organizer can Unmark a credit use; the player cannot undo it themselves', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    await cancel(ctx, a.id);
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    const phone = await playerPhone(ctx, MITCH);
    expect((await phone.call('POST', `/api/sessions/${b.id}/paid`, { paid: false })).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await unmark(ctx, b.id, MITCH)).data.changed).toBe(true);
    expect(await pot(ctx, MITCH)).toBe(1400);
    expect(seat(await dash(ctx), b.id, MITCH)).toMatchObject({ paymentStatus: 'unpaid', paymentAmountCents: null, creditCents: 0 });
    // And they can use it again.
    expect((await useCredit(ctx, b.id, MITCH)).data.paid).toBe(true);
  });
});

describe('Refund credit balance', () => {
  it('Mark refunded drops the balance to $0, undo brings it back; a changed balance or a reserved amount is refused', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await game(ctx, '2026-11-03', [MITCH]);
    await cancel(ctx, a.id);
    await cancel(ctx, b.id);
    expect(await pot(ctx, MITCH)).toBe(2800);
    // Opening Venmo marks nothing: only the explicit call does. A stale amount is refused.
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 1400 })).status).toBe(409);
    expect(await pot(ctx, MITCH)).toBe(2800);
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 2800 })).data.changed).toBe(true);
    let d = await dash(ctx);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect(d.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH]).refundCents).toBe(0);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(0);
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
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(1400);
    expect((await money(ctx, '2026-11')).creditsOwedCents).toBe(1400);
    expect(d.audit.map((x: any) => x.action)).toContain('credit_refund_undone');
    // A pending request holds $10 back: the Players-tab refund is for the other $18 only.
    expect((await requestRefund(ctx, MITCH, 1000)).status).toBe(200);
    expect((await ledgerOf(ctx, MITCH))).toMatchObject({ balanceCents: 2800, reservedCents: 1000, refundCents: 1800 });
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 2800 })).status).toBe(409);
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 1800 })).status).toBe(200);
    expect((await ledgerOf(ctx, MITCH))).toMatchObject({ balanceCents: 1000, reservedCents: 1000, refundCents: 0 });
  });

  it('pays back the credit from a finalized game together with the rest, and undo restores it', async () => {
    const ctx = await setupGroup();
    // He joined (and paid) Nov 3 before the $5 came back, so nothing of it went on that seat (credit at sign-up is automatic now).
    const a = await game(ctx, '2026-11-03', [MITCH]);
    await sixPlayed(ctx, '2026-10-27'); // $5 back
    await cancel(ctx, a.id); // $14 back
    const d0 = await dash(ctx);
    expect(d0.creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH])).toMatchObject({ balanceCents: 1900, refundCents: 1900 });
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(1900);
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 1900 })).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(0);
    await refundBalance(ctx, MITCH, { refunded: false });
    expect(await pot(ctx, MITCH)).toBe(1900);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(1900);
    const kinds = (await liveEntries(ctx, MITCH)).map((e: any) => [e.kind, e.cents, e.reason]);
    expect(kinds).toEqual([['kept', 500, 'finalized'], ['kept', 1400, 'canceled']]);
    expect((await ledgerOf(ctx, MITCH)).entries.find((e: any) => e.kind === 'refunded')).toMatchObject({ cents: 1900, endedAt: expect.any(String) });
  });

  it('a player with only the credit from a finalized game can be paid back too', async () => {
    const ctx = await setupGroup();
    await sixPlayed(ctx, '2026-10-27');
    expect((await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[MITCH])).toMatchObject({ balanceCents: 500, refundCents: 500 });
    expect((await refundBalance(ctx, MITCH, { refunded: true, cents: 500 })).status).toBe(200);
    expect(await pot(ctx, MITCH)).toBe(0);
    expect((await view(ctx, MITCH)).credit.balanceCents).toBe(0);
  });
});

describe('credit is private and the numbers agree', () => {
  it('nobody sees anyone else’s credit, and players never see phone numbers or money details', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    const b = await on(ctx, '2026-11-03');
    await join(ctx, b.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    await cancel(ctx, a.id);
    expect((await useCredit(ctx, b.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    for (const n of PLAYER_NAMES.filter((x) => x !== MITCH)) {
      const text = (await (await playerPhone(ctx, n)).call('GET', '/api/group')).text;
      expect(text, n).not.toMatch(/creditLedger|refundRequests|credit_ledger|555-01/i);
      expect((await view(ctx, n)).credit.balanceCents).toBe(0);
      // The only way to learn about his credit is his own screen: another player cannot spend or see it.
      expect((await useCredit(ctx, b.id, n)).status).toBe(409);
      expect((await (await playerPhone(ctx, n)).call('GET', '/api/admin/dashboard')).status).toBe(401);
    }
    expect((await ctx.app.client().call('GET', '/api/status')).text).not.toMatch(/credit/i);
    // His own screen shows only his own, with no money of other people.
    const mine = JSON.stringify(await view(ctx, MITCH));
    expect(mine).not.toMatch(/creditLedger|refundRequests|555-01|courtCost|membership/i);
    // Organizer sees it.
    expect(JSON.stringify(await dash(ctx))).toContain('creditLedger');
    // View as shows the same as the player does, not more.
    const as = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair })).data;
    expect(as.credit.balanceCents).toBe(0);
  });

  it('Money, Players and each game agree on held, credit and collected', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const a = await game(ctx, '2026-11-03', [MITCH, 'Blair']);
    const b = await game(ctx, '2026-11-05', [MITCH, 'Blair', 'Devon']);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    const c = await on(ctx, '2026-11-10');
    await join(ctx, c.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await cancel(ctx, a.id); // $14 credit each for Mitch and Blair
    // Blair asks for hers back and gets it: no credit, no held money.
    expect((await requestRefund(ctx, 'Blair', 1400)).status).toBe(200);
    const reqs = (await dash(ctx)).refundRequests;
    expect((await resolveRequest(ctx, reqs[0].id, 'refunded')).status).toBe(200);
    expect((await useCredit(ctx, c.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true }); // $14 into game c
    let d = await dash(ctx);
    let m = await money(ctx, '2026-11');
    // Held = b (3 paid) + c (credit used) = $56; no credit left anywhere (spent or refunded).
    expect(heldCents(d)).toBe(5600);
    expect(m.heldCents).toBe(5600);
    expect(d.players.reduce((sum: number, p: any) => sum + heldCents(d, p.id), 0)).toBe(5600);
    const potTotal = d.creditLedger.reduce((sum: number, p: any) => sum + p.balanceCents, 0);
    expect(potTotal).toBe(0);
    expect(m.creditsOwedCents).toBe(0);
    expect(m.collectedCents).toBe(0);
    // Play and finalize everything (4 played each, $14): collected = what is paid, per game and in total.
    ctx.app.now = Date.parse(c.endsAt) + HOUR;
    for (const s of [b, c]) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    d = await dash(ctx);
    m = await money(ctx, '2026-11');
    const perGame = m.sessions.reduce((sum: number, s: any) => sum + s.collectedCents, 0);
    expect(m.collectedCents).toBe(perGame);
    expect(m.collectedCents).toBe(4200 + 1400); // b: 3 x 14, c: the credit used counts as collected
    expect(m).toMatchObject({ heldCents: 0, creditsOwedCents: 0, courtCostCents: 9600, netCents: 5600 - 9600 });
    expect(heldCents(d)).toBe(0);
    expect(d.creditLedger.reduce((sum: number, p: any) => sum + p.balanceCents, 0)).toBe(0);
  });

  it('credit from a cancel in October and used in November follows the right months', async () => {
    const ctx = await setupGroup();
    const oct = await game(ctx, '2026-10-29', [MITCH]);
    // Credit arrives after they joined, so Use credit is still theirs to tap (credit at sign-up is automatic now).
    const nov = await on(ctx, '2026-11-03');
    await join(ctx, nov.id, [MITCH, 'Blair', 'Devon', 'Emery']);
    await cancel(ctx, oct.id);
    expect(await money(ctx, '2026-10')).toMatchObject({ creditsOwedCents: 1400, heldCents: 0 });
    expect(await money(ctx, '2026-11')).toMatchObject({ creditsOwedCents: 0 });
    expect((await useCredit(ctx, nov.id, MITCH)).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    // Spent: October no longer owes it. November has it as held until finalized, then collected.
    expect((await money(ctx, '2026-10')).creditsOwedCents).toBe(0);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 1400, collectedCents: 0 });
    await endAndFinalize(ctx, nov);
    expect(await money(ctx, '2026-11')).toMatchObject({ heldCents: 0, collectedCents: 1400, courtCostCents: 4800, creditsOwedCents: 0 });
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
    expect(withoutIds(JSON.stringify(await view(ctx, 'Blair')))).not.toMatch(/4800|chargedCents/);
    expect(withoutIds(JSON.stringify(await view(ctx, MITCH)))).not.toMatch(/4800|chargedCents/);
  });
});

describe('backup and restore carry the credit', () => {
  it('the backup file has the credit table, a restore brings it back, and an older backup without it restores empty', async () => {
    const ctx = await setupGroup();
    const a = await game(ctx, '2026-10-29', [MITCH]);
    await cancel(ctx, a.id);
    const file = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    expect(file.tables.credit_ledger).toHaveLength(1);
    const fresh = createNodeD1(':memory:');
    (fresh as any).raw.exec(backupToSql(file));
    const row = (fresh as any).raw.prepare('SELECT kind, amount_cents, reason FROM credit_ledger').get();
    expect(row).toMatchObject({ kind: 'kept', amount_cents: 1400, reason: 'canceled' });
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
