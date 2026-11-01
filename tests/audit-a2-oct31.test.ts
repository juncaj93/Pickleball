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

const others = (ctx: Ctx) => ['Casey', 'Devon', 'Emery', 'Frankie', 'Alex'].map((n) => ctx.byName[n]);
describe('auditA pass 2', () => {
  it('R1: Blair taps I paid while Reopen is running: the unconfirmed $6 is held as cash, then becomes credit', async () => {
    const ctx = await group();
    const { g, blair } = await game(ctx, { credit: 300, blairPays: false });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200); // $9, owes $6
    const owe = (await blair.call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === g.id)?.amountCents;
    expect(owe).toBe(600);
    // Reopen has passed its unconfirmed check; Blair's I paid lands before its batch.
    const pause = pauseOn(ctx, /ended_reason = 'undone' WHERE credit_ledger.kind/, async () => {
      const r = await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: owe });
      if (process.env.AUDIT_DEBUG) console.log('R1 I paid during reopen', r.status);
    });
    const re = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    if (process.env.AUDIT_DEBUG) console.log('R1 reopen', re.status, JSON.stringify(re.data), 'seat', JSON.stringify({ ps: seat(ctx, g.id, 'Blair').payment_status, self: seat(ctx, g.id, 'Blair').self_paid_at }),
      JSON.stringify(raw(ctx).prepare('SELECT kind, amount_cents, reason FROM credit_ledger WHERE player_id = ? AND session_id = ? AND ended_at IS NULL').all(ctx.byName.Blair, g.id)));
    // Since the fix the check is inside Reopen's batch: refused, the game stays finalized, nothing became money.
    expect(re.status).toBe(409);
    expect(re.data.error).toBe('unconfirmed_paid');
    expect(potOf(ctx, 'Blair')).toBe(0);
    // The organizer clears the unconfirmed $6 (Unmark), Reopen goes ahead, the redo says she did not play.
    const r = await rowOf(ctx, g.id, 'Blair');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: others(ctx) })).status).toBe(200);
    expect(potOf(ctx, 'Blair'), 'only the $3 credit is confirmed money').toBe(300);
  });

  it('R2: confirm reads finalized ($5 back); Reopen then a second-device confirm land first: $5 "finalized" credit on an unfinalized game', async () => {
    const ctx = await group();
    const { g } = await game(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE session_players SET self_paid_at = NULL/, async () => {
      const re = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
      const r2 = await rowOf(ctx, g.id, 'Blair');
      const c2 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r2.moneySeen });
      if (process.env.AUDIT_DEBUG) console.log('R2 inner reopen', re.status, 'confirm2', c2.status, JSON.stringify(c2.data));
    });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    const s = raw(ctx).prepare('SELECT finalized_at FROM sessions WHERE id = ?').get(g.id) as any;
    if (process.env.AUDIT_DEBUG) console.log('R2 outer confirm', res.status, JSON.stringify(res.data), 'finalized?', s.finalized_at, 'pot', potOf(ctx, 'Blair'));
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: others(ctx) });
    if (process.env.AUDIT_DEBUG) console.log('R2 redo', fin.status, 'pot', potOf(ctx, 'Blair'));
    expect(potOf(ctx, 'Blair'), 'paid $14, did not play: $14').toBe(1400);
  });

  it('R3: normal flows still work: confirm then reopen; unmark then reopen; stale confirm-only answers ok', async () => {
    const ctx = await group();
    const { g, blair } = await game(ctx, { credit: 300, blairPays: false });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: 600 });
    const re1 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    expect(re1.status).toBe(409);
    const r = await rowOf(ctx, g.id, 'Blair');
    const c1 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    const c2 = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    if (process.env.AUDIT_DEBUG) console.log('R3 confirm', c1.status, JSON.stringify(c1.data), 'repeat', c2.status, JSON.stringify(c2.data));
    expect(c2.data).toMatchObject({ changed: false });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect(await rowOf(ctx, g.id, 'Blair')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 500 });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect(await rowOf(ctx, g.id, 'Blair')).toMatchObject({ owesCents: 0 });
  });
});
