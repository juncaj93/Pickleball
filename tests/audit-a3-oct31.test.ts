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
const mark = async (ctx: Ctx, sid: string, paid: boolean) => {
  const r = await rowOf(ctx, sid, 'Blair');
  return ctx.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: ctx.byName.Blair, paid, seen: r.moneySeen, ...(paid && r.owesCents > 0 ? { cents: r.owesCents } : {}) });
};
/** Blair: $10 credit on the seat, $4 cash confirmed by the organizer. */
async function tenFour(ctx: Ctx) {
  const { g } = await game(ctx, { credit: 1000, blairPays: false });
  expect((await mark(ctx, g.id, true)).status).toBe(200);
  expect(seat(ctx, g.id, 'Blair')).toMatchObject({ payment_status: 'paid', payment_amount_cents: 1400, self_paid_at: null });
  return g;
}
// Fresh code audit A, third pass (Oct 31 night): Q2 fixed (Unmark tied to the finalize it read).
describe('auditA pass 3', () => {
  it('Q1: Unmark / Mark paid / Unmark loops after Finalize: money conserved, never back twice', async () => {
    const ctx = await group();
    const g = await tenFour(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(500); // 14-9
    const u1 = await mark(ctx, g.id, false);
    if (process.env.AUDIT_DEBUG) console.log('Q1 unmark1', u1.status, JSON.stringify(u1.data), 'pot', potOf(ctx, 'Blair'), JSON.stringify(await rowOf(ctx, g.id, 'Blair')).slice(0, 400));
    expect(potOf(ctx, 'Blair')).toBe(100); // $10 credit paid a $9 game
    const m = await mark(ctx, g.id, true);
    if (process.env.AUDIT_DEBUG) console.log('Q1 mark', m.status, JSON.stringify(m.data), 'pot', potOf(ctx, 'Blair'));
    expect(potOf(ctx, 'Blair')).toBe(100);
    const u2 = await mark(ctx, g.id, false);
    if (process.env.AUDIT_DEBUG) console.log('Q1 unmark2', u2.status, JSON.stringify(u2.data), 'pot', potOf(ctx, 'Blair'), JSON.stringify(await rowOf(ctx, g.id, 'Blair')).slice(0, 400));
    expect(potOf(ctx, 'Blair')).toBe(1000);
    const m2 = await mark(ctx, g.id, true); // owes $9 cash now
    if (process.env.AUDIT_DEBUG) console.log('Q1 mark2', m2.status, 'pot', potOf(ctx, 'Blair'), JSON.stringify(seat(ctx, g.id, 'Blair').payment_amount_cents));
    expect(potOf(ctx, 'Blair')).toBe(1000);
    const u3 = await mark(ctx, g.id, false);
    if (process.env.AUDIT_DEBUG) console.log('Q1 unmark3', u3.status, 'pot', potOf(ctx, 'Blair'));
    expect(potOf(ctx, 'Blair')).toBe(1000);
    // Reopen and redo: still conserved.
    const re = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    if (process.env.AUDIT_DEBUG) console.log('Q1 reopen', re.status, 'redo', fin.status, 'pot', potOf(ctx, 'Blair'), JSON.stringify(await rowOf(ctx, g.id, 'Blair')).slice(0, 300));
  });

  it('Q2: Unmark (read: not finalized) while Finalize lands: $10 credit on a $9 game must give $1 back', async () => {
    const ctx = await group();
    const g = await tenFour(ctx);
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = 'undone'\s+WHERE kind = 'kept'/, async () => {
      const f = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
      if (process.env.AUDIT_DEBUG) console.log('Q2 finalize inside', f.status, 'pot', potOf(ctx, 'Blair'));
    });
    const u = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen });
    pause.restore();
    expect(pause.fired()).toBe(true);
    if (process.env.AUDIT_DEBUG) console.log('Q2 unmark', u.status, JSON.stringify(u.data), 'pot', potOf(ctx, 'Blair'), JSON.stringify(seat(ctx, g.id, 'Blair')));
    if (u.status === 200) expect(potOf(ctx, 'Blair'), '$10 credit paid a $9 game: $1 back').toBe(100);
  });

  it('Q3: Unmark (read: finalized) while Reopen lands: conserved', async () => {
    const ctx = await group();
    const g = await tenFour(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    const firstBack = potOf(ctx, 'Blair');
    const r = await rowOf(ctx, g.id, 'Blair');
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = 'undone'\s+WHERE kind = 'kept' AND session_id = \?2 AND player_id/, async () => {
      const f = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
      if (process.env.AUDIT_DEBUG) console.log('Q3 reopen inside', f.status);
    });
    const u = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: false, seen: r.moneySeen });
    pause.restore();
    if (process.env.AUDIT_DEBUG) console.log('Q3 fired', pause.fired(), 'unmark', u.status, JSON.stringify(u.data), 'pot', potOf(ctx, 'Blair'), JSON.stringify(seat(ctx, g.id, 'Blair')));
    // Since the Q2 fix the Unmark read a finalize that is gone: refused ("look again"), the seat stays as it was.
    expect(u.status).toBe(409);
    expect(potOf(ctx, 'Blair')).toBe(0);
    const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    if (process.env.AUDIT_DEBUG) console.log('Q3 redo', fin.status, 'pot', potOf(ctx, 'Blair'));
    // Conserved: the redo gives exactly what the first finalize gave.
    expect(potOf(ctx, 'Blair')).toBe(firstBack);
  });

  it('Q4: self-marked full $14 seat survives Reopen and redo unchanged; withheld still works', async () => {
    const ctx = await group();
    const { g } = await game(ctx, { credit: 300 }); // $3 credit + I paid $11 (self)
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(0);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect(seat(ctx, g.id, 'Blair')).toMatchObject({ payment_status: 'paid', payment_amount_cents: 1400 });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect((await mark(ctx, g.id, true)).status).toBe(200);
    expect(potOf(ctx, 'Blair')).toBe(500);
  });
});
