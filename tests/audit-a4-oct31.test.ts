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

const mark = async (ctx: Ctx, sid: string, paid: boolean) => {
  const r = await rowOf(ctx, sid, 'Blair');
  return ctx.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: ctx.byName.Blair, paid, seen: r.moneySeen, ...(paid && r.owesCents > 0 ? { cents: r.owesCents } : {}) });
};
describe('auditA pass 4', () => {
  it('Q5: stale Unmark (read finalized at $8) refused, but its credit-back still lands after Reopen + other-device Unmark + redo at $9', async () => {
    const ctx = await group();
    const add = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Gale', phone: '(313) 555-0199' });
    expect(add.status, add.text).toBe(200);
    ctx.byName.Gale = (await dash(ctx)).players.find((p: any) => p.name === 'Gale').id;
    const g0 = await on(ctx, '2026-11-03');
    const gj0 = await (await playerPhone(ctx, 'Gale')).call('POST', `/api/sessions/${g0.id}/join`, {}); expect(gj0.status).toBe(200);
    const { g } = await game(ctx, { credit: 900, blairPays: false });
    expect((await mark(ctx, g.id, true)).status).toBe(200); // $9 credit + $5 cash, confirmed
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200); // 7 played: $8
    if (process.env.AUDIT_DEBUG) console.log('Q5 after fin', potOf(ctx, 'Blair'), JSON.stringify(raw(ctx).prepare('SELECT final_price_cents, final_played_count FROM sessions WHERE id = ?').get(g.id)));
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = 'undone'\s+WHERE kind = 'kept' AND session_id = \?2 AND player_id/, async () => {
      const re = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
      const u2 = await mark(ctx, g.id, false);
      const played = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Alex'].map((n) => ctx.byName[n]);
      const f = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played });
      if (process.env.AUDIT_DEBUG) console.log('Q5 inside reopen', re.status, 'unmark2', u2.status, 'redo', f.status, 'pot', potOf(ctx, 'Blair'), JSON.stringify(seat(ctx, g.id, 'Blair').payment_amount_cents));
    });
    ctx.app.advance(1000);
    const u = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    if (process.env.AUDIT_DEBUG) console.log('Q5 stale unmark', u.status, JSON.stringify(u.data), 'pot', potOf(ctx, 'Blair'),
      JSON.stringify(raw(ctx).prepare('SELECT kind, amount_cents, reason FROM credit_ledger WHERE player_id = ? AND session_id = ? AND ended_at IS NULL').all(ctx.byName.Blair, g.id)));
    expect(potOf(ctx, 'Blair'), '$9 credit paid a $9 game; the $5 cash was unmarked: nothing back').toBe(0);
  });
});
