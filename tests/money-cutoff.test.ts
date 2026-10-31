// Money audit (Oct 31, 2026): a request cut off halfway, then retried, must
// end exactly where a clean request ends. The free plan stops a request that
// runs too long, and a phone can lose signal mid-request, so any money action
// that saved in several steps could leave money half-moved: a player out of a
// game with their credit still on it, a canceled game still holding credit, a
// half-finalized game.
//
// For each money action this cuts the database off at every write in turn
// (the Nth write throws, nothing after it runs), retries the same tap, and
// compares the whole money state with a run that was never cut off.
import { describe, expect, it, vi } from 'vitest';
import { potEffect } from '../shared/credit';
import type { D1Database } from '../server/db';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

vi.setConfig({ testTimeout: 120_000 });

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
async function join(ctx: Ctx, sid: string, n: string) {
  const res = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/join`, {});
  expect(res.status, res.text).toBe(200);
}
async function markPaid(ctx: Ctx, sid: string, n: string, paid = true) {
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: ctx.byName[n], paid });
  expect(res.status, res.text).toBe(200);
}
/** Credit from an older canceled game, the way it arrives in real life. */
function givePot(ctx: Ctx, name: string, cents: number, oldId: string) {
  raw(ctx).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${oldId}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
function potOf(ctx: Ctx, id: string) {
  const rows = raw(ctx).prepare('SELECT * FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(id) as any[];
  return rows.reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
}

/** Everything about money, without ids or times: two runs that did the same thing read the same. */
function moneyState(ctx: Ctx) {
  const name = new Map(Object.entries(ctx.byName).map(([n, id]) => [id, n]));
  const pots = Object.fromEntries(Object.entries(ctx.byName).map(([n, id]) => [n, potOf(ctx, id)]));
  const seats = (raw(ctx).prepare('SELECT s.starts_at, sp.player_id, sp.status, sp.payment_status, sp.payment_amount_cents, sp.refunded_at IS NOT NULL AS settled, sp.played FROM session_players sp JOIN sessions s ON s.id = sp.session_id').all() as any[])
    .map((r) => `${dayOf(r.starts_at)} ${name.get(r.player_id)} ${r.status} ${r.payment_status} ${r.payment_amount_cents} settled=${r.settled} played=${r.played}`)
    .sort();
  const games = (raw(ctx).prepare('SELECT starts_at, status, finalized_at IS NOT NULL AS fin, final_price_cents, court_state FROM sessions').all() as any[])
    .map((r) => `${dayOf(r.starts_at)} ${r.status} fin=${r.fin} ${r.final_price_cents} ${r.court_state}`)
    .sort();
  const ledger = (raw(ctx).prepare('SELECT l.player_id, l.kind, l.amount_cents, l.reason, l.ended_reason, s.starts_at FROM credit_ledger l LEFT JOIN sessions s ON s.id = l.session_id').all() as any[])
    .map((r) => `${name.get(r.player_id)} ${r.kind} ${r.amount_cents} ${r.reason} ended=${r.ended_reason} ${r.starts_at ? dayOf(r.starts_at) : ''}`)
    .sort();
  const requests = (raw(ctx).prepare('SELECT player_id, amount_cents, status FROM refund_requests').all() as any[]).map((r) => `${name.get(r.player_id)} ${r.amount_cents} ${r.status}`).sort();
  return { pots, seats, games, ledger, requests };
}

/**
 * The database cut off at its `n`th write: that write and everything after it
 * in the request fails. Reads still work. Returns whether the cut happened.
 */
function cutAt(ctx: Ctx, n: number) {
  const real = ctx.app.db as D1Database;
  let writes = 0;
  let cut = false;
  const isWrite = (sql: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
  const hit = () => {
    writes++;
    if (writes >= n) {
      cut = true;
      throw new Error('cut off (test)');
    }
  };
  const wrap = (st: any, sql: string): any => ({
    __inner: st,
    __sql: sql,
    bind: (...v: unknown[]) => wrap(st.bind(...v), sql),
    first: () => st.first(),
    all: () => st.all(),
    run: async () => {
      if (isWrite(sql)) hit();
      return st.run();
    },
  });
  ctx.app.env = {
    ...ctx.app.env,
    DB: {
      ...real,
      prepare: (sql: string) => wrap(real.prepare(sql), sql),
      batch: async (sts: any[]) => {
        hit();
        return real.batch(sts.map((st) => st.__inner));
      },
    } as any,
  };
  return { cut: () => cut, restore: () => void (ctx.app.env = { ...ctx.app.env, DB: real }) };
}

interface Case {
  name: string;
  /** Builds the same starting point every time; returns what `act` needs. */
  setup: () => Promise<{ ctx: Ctx; act: () => Promise<unknown> }>;
}

/** Clean run vs. a run cut off at write 1, 2, 3, ... and then retried: the money must end the same every time. */
async function cutEverywhere(c: Case) {
  const clean = await c.setup();
  await clean.act();
  await clean.ctx.app.settle();
  const want = moneyState(clean.ctx);
  let cuts = 0;
  for (let n = 1; n < 200; n++) {
    const run = await c.setup();
    const cut = cutAt(run.ctx, n);
    await run.act().catch(() => undefined);
    await run.ctx.app.settle().catch(() => undefined);
    cut.restore();
    if (!cut.cut()) break;
    cuts++;
    // The same tap again (the phone retries, or the person taps again).
    await run.act().catch(() => undefined);
    await run.ctx.app.settle();
    expect(moneyState(run.ctx), `${c.name}: cut off at write ${n}, then retried`).toEqual(want);
  }
  expect(cuts, `${c.name}: the action writes at least once`).toBeGreaterThan(0);
}

/** Tue Nov 3: Blair paid $14 cash, Casey paid with $14 credit, Devon $3 credit + $11 cash, Emery in and unpaid. */
async function busyGame() {
  const ctx = await group();
  const old = await on(ctx, '2026-10-29');
  givePot(ctx, 'Casey', 1400, old.id);
  givePot(ctx, 'Devon', 300, old.id);
  const g = await on(ctx, '2026-11-03');
  await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, g.id, n);
  await markPaid(ctx, g.id, 'Blair');
  await markPaid(ctx, g.id, 'Devon');
  return { ctx, g };
}

describe('a money tap cut off halfway and retried ends exactly like a clean one', () => {
  it('Drop out on a seat paid part with credit, part with cash', async () => {
    await cutEverywhere({
      name: 'drop',
      setup: async () => {
        const { ctx, g } = await busyGame();
        const phone = await playerPhone(ctx, 'Devon');
        return { ctx, act: () => phone.call('POST', `/api/sessions/${g.id}/withdraw`, {}) };
      },
    });
  });

  it('Drop out on a seat paid all with credit', async () => {
    await cutEverywhere({
      name: 'drop credit',
      setup: async () => {
        const { ctx, g } = await busyGame();
        const phone = await playerPhone(ctx, 'Casey');
        return { ctx, act: () => phone.call('POST', `/api/sessions/${g.id}/withdraw`, {}) };
      },
    });
  });

  it('Remove player (organizer) on a cash-paid seat', async () => {
    await cutEverywhere({
      name: 'remove',
      setup: async () => {
        const { ctx, g } = await busyGame();
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Blair, action: 'withdraw' }) };
      },
    });
  });

  it('Cancel with a reason', async () => {
    await cutEverywhere({
      name: 'cancel',
      setup: async () => {
        const { ctx, g } = await busyGame();
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain' }) };
      },
    });
  });

  it('Court "Didn\'t open" (the game is canceled, money back)', async () => {
    await cutEverywhere({
      name: 'not opened',
      setup: async () => {
        const ctx = await group();
        const old = await on(ctx, '2026-10-29');
        givePot(ctx, 'Devon', 300, old.id);
        const g = await on(ctx, '2026-11-05');
        await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
        for (const n of ['Blair', 'Devon', 'Emery']) await join(ctx, g.id, n);
        await markPaid(ctx, g.id, 'Blair');
        await markPaid(ctx, g.id, 'Devon');
        await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' });
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'not_opened' }) };
      },
    });
  });

  it('Reopen a canceled game', async () => {
    await cutEverywhere({
      name: 'un-cancel',
      setup: async () => {
        const { ctx, g } = await busyGame();
        await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' }) };
      },
    });
  });

  it('Finalize with 5 who played and one who did not', async () => {
    await cutEverywhere({
      name: 'finalize',
      setup: async () => {
        const { ctx, g } = await busyGame();
        await join(ctx, g.id, 'Alex');
        ctx.app.now = Date.parse(g.endsAt) + HOUR;
        const played = ['Alex', 'Blair', 'Casey', 'Devon', 'Frankie'].map((n) => ctx.byName[n]);
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played }) };
      },
    });
  });

  it('Reopen a finalized game', async () => {
    await cutEverywhere({
      name: 'reopen finalize',
      setup: async () => {
        const { ctx, g } = await busyGame();
        await join(ctx, g.id, 'Alex');
        ctx.app.now = Date.parse(g.endsAt) + HOUR;
        const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
        expect(fin.status, fin.text).toBe(200);
        ctx.app.now += HOUR;
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {}) };
      },
    });
  });

  it('Unmark (organizer) a payment that got money back at finalize', async () => {
    await cutEverywhere({
      name: 'unmark',
      setup: async () => {
        const { ctx, g } = await busyGame();
        await join(ctx, g.id, 'Alex');
        ctx.app.now = Date.parse(g.endsAt) + HOUR;
        expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
        ctx.app.now += HOUR;
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Devon, paid: false }) };
      },
    });
  });

  it('Move to waitlist (organizer) a seat with part credit that still owes', async () => {
    await cutEverywhere({
      name: 'to waitlist',
      setup: async () => {
        const ctx = await group();
        const old = await on(ctx, '2026-10-29');
        givePot(ctx, 'Devon', 300, old.id);
        const g = await on(ctx, '2026-11-03');
        await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
        for (const n of ['Blair', 'Devon']) await join(ctx, g.id, n);
        return { ctx, act: () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Devon, action: 'waitlist' }) };
      },
    });
  });
});

/** Run `during` right before the first statement matching `re` runs (alone or in a batch): an exact interleaving. */
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

describe('races the audit found', () => {
  it('Mark paid while the player drops out: never a paid seat on someone who left', async () => {
    const ctx = await group();
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    await join(ctx, g.id, 'Blair');
    const phone = await playerPhone(ctx, 'Blair');
    // Mark paid has read the seat (in, unpaid); the drop lands before Mark paid writes.
    const pause = pauseOn(ctx, /SET payment_status = 'paid', paid_at = \?1?/, () => phone.call('POST', `/api/sessions/${g.id}/withdraw`, {}));
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    pause.restore();
    expect(pause.fired()).toBe(true);
    const seat = raw(ctx).prepare('SELECT status, payment_status, refunded_at FROM session_players WHERE session_id = ? AND player_id = ?').get(g.id, ctx.byName.Blair) as any;
    expect(seat.status).toBe('withdrawn');
    expect(seat.payment_status === 'paid' && !seat.refunded_at, 'out of the game but marked paid').toBe(false);
    expect(res.status).toBe(409);
  });

  it('Cancel at the same moment a part-credit, part-cash player drops: $14 back, never less', async () => {
    for (let k = 0; k < 60; k += 3) {
      const { ctx, g } = await busyGame();
      const phone = await playerPhone(ctx, 'Devon');
      const later = async <T,>(f: () => Promise<T>) => {
        for (let i = 0; i < k; i++) await Promise.resolve();
        return f();
      };
      await Promise.all([phone.call('POST', `/api/sessions/${g.id}/withdraw`, {}), later(() => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true }))]);
      expect(potOf(ctx, ctx.byName.Devon), `k=${k}`).toBe(1400);
    }
  });
});
