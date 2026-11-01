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

describe('auditA pass 5', () => {
  it('Q6: confirm (reads $5 back) while the player taps Didn\'t pay? and the organizer records $9 cash on another device: no $5 made', async () => {
    const ctx = await group();
    const { g, blair } = await game(ctx); // I paid $14, unconfirmed
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200); // $9, $5 withheld
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE session_players SET self_paid_at = NULL, payment_updated_at/, async () => {
      ctx.app.advance(1000);
      const d = await blair.call('POST', `/api/sessions/${g.id}/paid`, { paid: false });
      const r2 = await rowOf(ctx, g.id, 'Blair');
      const m = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r2.moneySeen, cents: r2.owesCents });
      if (process.env.AUDIT_DEBUG) console.log('Q6 inside didnt-pay', d.status, 'mark $', r2.owesCents, m.status, 'seat', seat(ctx, g.id, 'Blair').payment_amount_cents, 'pot', potOf(ctx, 'Blair'));
    });
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    if (process.env.AUDIT_DEBUG) console.log('Q6 stale confirm', res.status, JSON.stringify(res.data), 'pot', potOf(ctx, 'Blair'), 'seat', seat(ctx, g.id, 'Blair').payment_amount_cents);
    expect(potOf(ctx, 'Blair'), 'paid $9 cash for a $9 game: nothing back').toBe(0);
  });
});
