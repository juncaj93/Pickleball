import { describe, expect, it } from 'vitest';
import { potEffect } from '../shared/credit';
import type { D1Database } from '../server/db';
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
const seat = (ctx: Ctx, sid: string, name: string) => raw(ctx).prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, ctx.byName[name]) as any;

function pauseOn(ctx: Ctx, re: RegExp, during: () => Promise<unknown>) {
  const real = ctx.app.db as D1Database;
  let fired = false;
  const gate = async (sql: string) => {
    if (fired || !re.test(sql)) return;
    fired = true;
    await during();
  };
  const wrap = (st: any, sql: string): any => ({
    __inner: st,
    __sql: sql,
    bind: (...v: unknown[]) => wrap(st.bind(...v), sql),
    first: async () => (await gate(sql), st.first()),
    all: async () => (await gate(sql), st.all()),
    run: async () => (await gate(sql), st.run()),
  });
  ctx.app.env = {
    ...ctx.app.env,
    DB: {
      ...real,
      prepare: (sql: string) => wrap(real.prepare(sql), sql),
      batch: async (sts: any[]) => {
        for (const st of sts) await gate(st.__sql);
        return real.batch(sts.map((st) => st.__inner));
      },
    } as any,
  };
  return { fired: () => fired, restore: () => void (ctx.app.env = { ...ctx.app.env, DB: real }) };
}

/** Tue Nov 3, court booked, 6 in (Alex is organizer). Blair taps I paid for what she owes. */
async function game(ctx: Ctx, opts: { credit?: number; blairPays?: boolean } = {}) {
  const old = await on(ctx, '2026-10-29');
  if (opts.credit) givePot(ctx, 'Blair', opts.credit, old.id);
  const g = await on(ctx, '2026-11-03');
  await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Alex']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${g.id}/join`, {});
  const blair = await playerPhone(ctx, 'Blair');
  if (opts.blairPays !== false) {
    const owe = (await blair.call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === g.id).amountCents;
    expect((await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: owe })).status).toBe(200);
  }
  ctx.app.now = Date.parse(g.endsAt) + HOUR;
  return { g, blair };
}

// Fresh code audit A (Oct 31 evening): 5 findings, fixed. The racing taps are now refused ("look again") and
// Reopen waits while an unconfirmed short I paid is on a seat; these tests check that and finish each story.
describe('auditA', () => {
  it('F1: stale Mark paid (screen showed "owes $5") after Finalize paid the seat with credit: must be refused, not "ok"', async () => {
    const ctx = await group();
    const { g } = await game(ctx, { credit: 900, blairPays: false });
    const before = await rowOf(ctx, g.id, 'Blair');
    expect(before).toMatchObject({ paymentStatus: 'unpaid', creditCents: 900 });
    // Organizer's screen is open; Blair sent $5 by Venmo. Meanwhile Finalize (6 played, $9) pays her seat with the $9 credit.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(seat(ctx, g.id, 'Blair').payment_status).toBe('paid');
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: before.moneySeen, cents: before.owesCents });
    console.log('F1 stale mark paid ->', res.status, JSON.stringify(res.data), 'owesCents shown', before.owesCents, 'pot', potOf(ctx, 'Blair'));
    expect(res.status, 'stale Mark paid answered OK; the organizer toasts "Blair marked paid" but the $5 is recorded nowhere').toBe(409);
  });

  it('F2a: organizer confirms an I paid while Finalize is running (Finalize read self_paid set): $5 back lost', async () => {
    const ctx = await group();
    const { g } = await game(ctx);
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE sessions SET finalized_at = \?1/, () =>
      ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen }),
    );
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    pause.restore();
    expect(pause.fired()).toBe(true);
    console.log('F2a finalize', fin.status, 'seat', JSON.stringify({ self: seat(ctx, g.id, 'Blair').self_paid_at, pay: seat(ctx, g.id, 'Blair').payment_amount_cents }), 'pot', potOf(ctx, 'Blair'));
    // Now any further Mark paid changes nothing.
    const r2 = await rowOf(ctx, g.id, 'Blair');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r2.moneySeen });
    console.log('F2a after re-tap pot', potOf(ctx, 'Blair'), JSON.stringify(r2));
    if (fin.status === 200) expect(potOf(ctx, 'Blair'), 'confirmed $14, played at $9: $5 should be credit').toBe(500);
  });

  it('F2b: Finalize lands while Mark paid (confirm, read not finalized) is in flight: $5 back lost', async () => {
    const ctx = await group();
    const { g } = await game(ctx);
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE session_players SET self_paid_at = NULL/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true }));
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    const s = raw(ctx).prepare('SELECT finalized_at, final_price_cents FROM sessions WHERE id = ?').get(g.id) as any;
    if (process.env.AUDIT_DEBUG) console.log('F2b mark', res.status, 'final', s.final_price_cents, 'self', seat(ctx, g.id, 'Blair').self_paid_at, 'pot', potOf(ctx, 'Blair'));
    expect(s.final_price_cents).toBe(900);
    // The confirm read a game that was not finalized yet: refused, look again; from the fresh screen it goes in.
    expect(res.status).toBe(409);
    const again = await rowOf(ctx, g.id, 'Blair');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: again.moneySeen })).status).toBe(200);
    expect(seat(ctx, g.id, 'Blair').self_paid_at).toBeNull();
    expect(potOf(ctx, 'Blair'), 'confirmed $14, played at $9: $5 should be credit').toBe(500);
  });

  it('F3: Reopen lands while Mark paid (confirm, read finalized) is in flight: $5 "finalized" credit on an unfinalized game; redo as did-not-play gives $19', async () => {
    const ctx = await group();
    const { g } = await game(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE session_players SET self_paid_at = NULL/, () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {}));
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    const s = raw(ctx).prepare('SELECT finalized_at FROM sessions WHERE id = ?').get(g.id) as any;
    if (process.env.AUDIT_DEBUG) console.log('F3 mark', res.status, 'finalized?', s.finalized_at, 'pot', potOf(ctx, 'Blair'));
    // Redo: Blair did not play.
    const others = ['Casey', 'Devon', 'Emery', 'Frankie', 'Alex'].map((n) => ctx.byName[n]);
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: others });
    expect(res.status).toBe(409); // the confirm read the old finalize: refused, nothing given
    expect(fin.status).toBe(200);
    // Still unconfirmed, and she did not play: a claim on Home, no credit until the organizer answers it.
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect((await dash(ctx)).paymentClaims).toEqual([expect.objectContaining({ name: 'Blair', why: 'not_played' })]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: ctx.byName.Blair, paid: true })).status).toBe(200);
    expect(potOf(ctx, 'Blair'), 'paid $14, did not play: $14 credit, never more').toBe(1400);
  });

  it('F4: Reopen turns an unconfirmed I paid (part credit) into held cash; a redo as did-not-play makes it credit', async () => {
    const ctx = await group();
    // Blair has $3 credit (auto on at I'm in), owes $11 before finalize. Do not pay yet.
    const { g, blair } = await game(ctx, { credit: 300, blairPays: false });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200); // $9
    const owe = (await blair.call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === g.id)?.amountCents;
    if (process.env.AUDIT_DEBUG) console.log('F4 owes after finalize', owe);
    expect((await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: owe })).status).toBe(200); // I paid $6, never confirmed
    if (process.env.AUDIT_DEBUG) console.log('F4 seat after I paid', JSON.stringify(seat(ctx, g.id, 'Blair')));
    // Reopen waits: her unconfirmed $6 would come out short and be held as real money.
    const refused = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    expect(refused.status).toBe(409);
    expect(refused.data.error).toBe('unconfirmed_paid');
    // The organizer clears it (no Venmo came): Unmark. Then Reopen goes ahead.
    const r = await rowOf(ctx, g.id, 'Blair');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    const sp = seat(ctx, g.id, 'Blair');
    if (process.env.AUDIT_DEBUG) console.log('F4 seat after reopen', JSON.stringify(sp), 'ledger', JSON.stringify(raw(ctx).prepare('SELECT kind, amount_cents, reason, ended_at FROM credit_ledger WHERE player_id = ? AND session_id = ?').all(ctx.byName.Blair, g.id)));
    const others = ['Casey', 'Devon', 'Emery', 'Frankie', 'Alex'].map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: others })).status).toBe(200);
    if (process.env.AUDIT_DEBUG) console.log('F4 pot after redo (did not play)', potOf(ctx, 'Blair'), 'claims', JSON.stringify((await dash(ctx)).paymentClaims));
    // Only confirmed money becomes credit: she should get her $3 credit back; the unconfirmed $6 is a claim.
    expect(potOf(ctx, 'Blair'), 'the unconfirmed $6 became credit').toBe(300);
  });
});
