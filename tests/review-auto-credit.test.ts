import { describe, expect, it, vi } from 'vitest';
import { potEffect } from '../shared/credit';
import { balanceOf, heldCents } from '../src/pages/admin/todo';
import { HOUR, playerPhone, setupGroup, TestApp, withoutIds } from './harness';

// Independent review of "credit is used automatically at I'm in".
// Every probe tries to break it: races (Promise.all with a sweep of start
// offsets, so every interleaving of the awaits is tried), Undo, cancel and
// reopen, untouched old records, privacy, the books, and the Telegram line.
// Telegram is always a fake (TELEGRAM_FETCH): nothing real is ever sent.

// The race sweeps run each pair at ~27 offsets in both orders, on a fresh group each time.
vi.setConfig({ testTimeout: 120_000 });

const TZ = 'America/Detroit';
const PRICE = 1400;
type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TOKEN = '123456:FAKE-test-token-never-real';

/** A group with Alex as the organizer, the given games' courts booked (all future ones by default), and a fake Telegram. */
async function group(opts: { maxPlayers?: number; noCourt?: boolean; book?: string[] } = {}) {
  const app = new TestApp();
  const sent: { text: string; body: any }[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: '9988776655',
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ text: body.text, body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  if (!opts.noCourt) {
    for (const s of (await dash(ctx)).sessions.filter((x: any) => Date.parse(x.startsAt) > app.now)) {
      if (opts.book && !opts.book.includes(dayOf(s.startsAt))) continue;
      await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    }
  }
  const texts = async () => (await app.settle(), sent.splice(0).map((s) => s.text));
  const bodies = async () => (await app.settle(), sent.splice(0).map((s) => s.body));
  return { ...ctx, texts, bodies };
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mine = async (ctx: Ctx, n: string, sid: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === sid).mine;
const join = async (ctx: Ctx, sid: string, n: string) => {
  const res = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/join`, {});
  expect(res.status, res.text).toBe(200);
  return res.data;
};
const joinAll = async (ctx: Ctx, sid: string, names: string[]) => {
  for (const n of names) await join(ctx, sid, n);
};
const drop = async (ctx: Ctx, sid: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/withdraw`, {});
const pot = async (ctx: Ctx, n: string) => (await view(ctx, n)).credit.balanceCents;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const raw = (ctx: Ctx) => ctx.app.db.raw;
const liveUsed = (ctx: Ctx, sid: string, n: string) =>
  (raw(ctx).prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(sid, ctx.byName[n]) as any).c as number;
const usedRows = (ctx: Ctx, sid: string, n: string) =>
  raw(ctx).prepare("SELECT amount_cents, ended_reason FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? ORDER BY created_at, rowid").all(sid, ctx.byName[n]) as any[];
const markPaid = (ctx: Ctx, sid: string, n: string, paid = true) => ctx.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: ctx.byName[n], paid });
const useIt = async (ctx: Ctx, sid: string, n: string, cents: number) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/use-cash-out`, { cents });

async function givePot(ctx: Ctx, name: string, cents: number) {
  const old = await on(ctx, '2026-10-29');
  raw(ctx).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
const askCashOut = async (ctx: Ctx, n: string, cents: number) => {
  const res = await (await playerPhone(ctx, n)).call('POST', '/api/me/refund-request', { cents });
  expect(res.status, res.text).toBe(200);
  return res.data.request.id as string;
};
const request = (ctx: Ctx, n: string) => raw(ctx).prepare('SELECT * FROM refund_requests WHERE player_id = ? ORDER BY created_at DESC, rowid DESC').get(ctx.byName[n]) as any;

// ---------- invariants, straight from the database ----------

function potOf(ctx: Ctx, id: string) {
  const rows = raw(ctx).prepare('SELECT * FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(id) as any[];
  return rows.reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
}
function reservedOf(ctx: Ctx, id: string) {
  return (raw(ctx).prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refund_requests WHERE player_id = ? AND status = 'pending'").get(id) as any).c as number;
}

/**
 * What a player is worth to the system: their pot, plus what each seat in a
 * game that is not finalized holds for them (a live payment, else the credit
 * on it), plus what was paid back to them on Venmo. Credit only ever moves,
 * so this stays what they put in (credit given plus cash paid).
 */
function worth(ctx: Ctx, n: string) {
  const id = ctx.byName[n];
  const seats = raw(ctx)
    .prepare(
      `SELECT sp.*, s.finalized_at,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger l WHERE l.kind = 'used' AND l.session_id = sp.session_id AND l.player_id = sp.player_id AND l.ended_at IS NULL AND (l.reason IS NULL OR l.reason <> 'cash')) AS used
       FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE sp.player_id = ?`,
    )
    .all(id) as any[];
  let held = 0;
  for (const s of seats) held += s.payment_status === 'paid' && !s.refunded_at ? (s.payment_amount_cents ?? 0) : s.used;
  const out = (raw(ctx).prepare("SELECT COALESCE(SUM(amount_cents - five_cents), 0) AS c FROM credit_ledger WHERE player_id = ? AND kind = 'refunded' AND ended_at IS NULL").get(id) as any).c as number;
  return potOf(ctx, id) + held + out;
}

/** Hard rules on the raw tables: no negative pot, the pending request is covered, no seat over-credited, no free seat. */
function inv(ctx: Ctx, label = '') {
  const players = raw(ctx).prepare('SELECT id, display_name FROM players').all() as any[];
  const organizerId = ctx.byName.Alex;
  for (const p of players) {
    const potc = potOf(ctx, p.id);
    expect(potc, `${label} ${p.display_name} pot never below $0`).toBeGreaterThanOrEqual(0);
    expect(potc - reservedOf(ctx, p.id), `${label} ${p.display_name}: the pot still covers the pending cash out`).toBeGreaterThanOrEqual(0);
  }
  const seats = raw(ctx)
    .prepare(
      `SELECT sp.*, s.finalized_at, s.status AS sstatus, p.display_name,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger l WHERE l.kind = 'used' AND l.session_id = sp.session_id AND l.player_id = sp.player_id AND l.ended_at IS NULL) AS used,
         (SELECT COUNT(*) FROM credit_ledger l WHERE l.kind = 'used' AND l.reason = 'auto' AND l.session_id = sp.session_id AND l.player_id = sp.player_id AND l.ended_at IS NULL) AS autos
       FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN players p ON p.id = sp.player_id`,
    )
    .all() as any[];
  for (const s of seats) {
    const who = `${label} ${s.display_name} on ${s.session_id.slice(0, 6)}`;
    if (s.player_id === organizerId) expect(s.used, `${who}: organizer never uses credit`).toBe(0);
    expect(s.used, `${who}: credit on the seat at most the price`).toBeLessThanOrEqual(PRICE);
    if (s.payment_status === 'paid' && !s.refunded_at) expect(s.payment_amount_cents ?? 0, `${who}: paid at most the price`).toBeLessThanOrEqual(PRICE);
    if (s.status === 'withdrawn' || s.status === 'declined') expect(s.used, `${who}: a seat they left holds no credit`).toBe(0);
    if (!s.finalized_at && s.sstatus !== 'canceled' && s.status === 'confirmed' && s.player_id !== organizerId) {
      // A confirmed seat that still counts as paid must still hold that payment (not settled back as credit).
      if (s.payment_status === 'paid') expect(s.refunded_at, `${who}: paid seat whose payment already came back as credit (free seat)`).toBeNull();
    }
  }
}

/** The screens agree (the same check as tests/auto-credit.test.ts `books`). */
async function books(ctx: Ctx) {
  inv(ctx, 'books');
  const d = await dash(ctx);
  const rows = raw(ctx).prepare('SELECT * FROM credit_ledger').all() as any[];
  for (const p of d.players) {
    const sum = rows.filter((r) => r.player_id === p.id && !r.ended_at).reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(d.creditLedger.find((l: any) => l.playerId === p.id)?.balanceCents ?? 0, `${p.name}'s balance on Players`).toBe(sum);
    expect(balanceOf(d, p.id).creditCents).toBe(sum);
    if (p.name !== 'Alex' && p.isActive) {
      const v = await view(ctx, p.name);
      expect(v.credit.balanceCents, `${p.name}'s own balance`).toBe(sum);
      expect(v.credit.usableCents).toBe(Math.max(0, sum - reservedOf(ctx, p.id)));
    }
  }
  for (const s of d.sessions) {
    const price = s.finalized ? s.finalized.priceCents : PRICE;
    for (const r of s.roster) {
      const used = rows.filter((x) => x.kind === 'used' && x.session_id === s.id && x.player_id === r.playerId && !x.ended_at).reduce((n, x) => n + x.amount_cents, 0);
      if (r.isOrganizer) {
        expect(used).toBe(0);
        continue;
      }
      expect(used, `credit on ${r.name}'s seat`).toBeLessThanOrEqual(Math.max(price, r.paymentAmountCents ?? 0));
    }
  }
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  const months = [(await ctx.organizer.call('GET', '/api/admin/money?month=2026-10')).data, (await ctx.organizer.call('GET', '/api/admin/money?month=2026-11')).data];
  expect(months.reduce((n, m) => n + m.creditsOwedCents, 0)).toBe(potTotal);
  for (const m of months) expect(m.sessions.reduce((n: number, s: any) => n + s.collectedCents, 0)).toBe(m.collectedCents);
  expect(months.reduce((n, m) => n + m.heldCents, 0)).toBe(heldCents(d));
  return d;
}


/**
 * Deterministic interleaving: the first time any statement whose SQL matches
 * `re` is about to run (alone or in a batch), `during` runs to the end first.
 * So "A has read, B runs completely, A writes" is tried exactly.
 */
function pauseOn(ctx: Ctx, re: RegExp, during: () => Promise<unknown>) {
  const real = ctx.app.db;
  let fired = false;
  let result: unknown;
  const gate = async (sql: string) => {
    if (fired || !re.test(sql)) return;
    fired = true;
    result = await during();
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
  return {
    fired: () => fired,
    result: () => result as any,
    restore: () => void (ctx.app.env = { ...ctx.app.env, DB: real }),
  };
}

// ---------- racing ----------

/** Let `k` microtasks pass, then start. Sweeping k tries every interleaving of two handlers' awaits. */
const after = async <T,>(k: number, f: () => Promise<T>) => {
  for (let i = 0; i < k; i++) await Promise.resolve();
  return f();
};
const OFFSETS = [0, 1, 2, 3, 4, 6, 8, 11, 14, 18, 22, 27, 33, 40, 48, 57, 67, 78, 90, 105, 120, 140, 165, 190, 220, 260, 300];
/** Run `a` and `b` together at every offset, in both orders, each on a fresh group; `check` sees both answers. */
async function sweep<S>(setup: () => Promise<S>, a: (s: S) => Promise<any>, b: (s: S) => Promise<any>, check: (s: S, ra: any, rb: any, label: string) => Promise<void> | void) {
  for (const k of OFFSETS) {
    for (const flip of [false, true]) {
      const s = await setup();
      const [ra, rb] = flip ? await Promise.all([after(k, () => a(s)), b(s)]) : await Promise.all([a(s), after(k, () => b(s))]);
      await check(s, ra, rb, `[k=${k}${flip ? ' flipped' : ''}]`);
    }
  }
}

describe('1. no double spend or negative balance under races', () => {
  it('join racing a cash-out request: the pending request is never left bigger than the pot', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        await givePot(ctx, 'Casey', 1400);
        return { ctx, g: await on(ctx, '2026-11-03'), phone: await playerPhone(ctx, 'Casey') };
      },
      ({ phone, g }) => phone.call('POST', `/api/sessions/${g.id}/join`, {}),
      ({ phone }) => phone.call('POST', '/api/me/refund-request', { cents: 1400 }),
      ({ ctx, g }, ra, rb, label) => {
        expect(ra.status, label).toBe(200);
        inv(ctx, label);
        expect(worth(ctx, 'Casey'), label).toBe(1400);
        // Whatever won, exactly one of them has the $14.
        expect(liveUsed(ctx, g.id, 'Casey') + reservedOf(ctx, ctx.byName.Casey), label).toBe(1400);
        void rb;
      },
    );
  });

  it('three games tapped at once with $20: $14 + $6 + $0, never more', async () => {
    const ctx = await group({ book: ['2026-11-03', '2026-11-05', '2026-11-10'] });
    await givePot(ctx, 'Devon', 2000);
    const ids = [(await on(ctx, '2026-11-03')).id, (await on(ctx, '2026-11-05')).id, (await on(ctx, '2026-11-10')).id];
    const phones = [await playerPhone(ctx, 'Devon'), await playerPhone(ctx, 'Devon'), await playerPhone(ctx, 'Devon')];
    const res = await Promise.all(ids.map((id, i) => after(i * 3, () => phones[i].call('POST', `/api/sessions/${id}/join`, {}))));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(ids.reduce((n, id) => n + liveUsed(ctx, id, 'Devon'), 0)).toBe(2000);
    expect(res.reduce((n, r) => n + (r.data.creditCents ?? 0), 0)).toBe(2000);
    expect(await pot(ctx, 'Devon')).toBe(0);
    await books(ctx);
  });

  it('drop racing I\'m in from a second phone (credit-paid seat): credit used at most once, never a free seat', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        await givePot(ctx, 'Casey', 1400);
        const g = await on(ctx, '2026-11-03');
        await join(ctx, g.id, 'Casey');
        return { ctx, g, p1: await playerPhone(ctx, 'Casey'), p2: await playerPhone(ctx, 'Casey') };
      },
      ({ p1, g }) => p1.call('POST', `/api/sessions/${g.id}/withdraw`, {}),
      ({ p2, g }) => p2.call('POST', `/api/sessions/${g.id}/join`, {}),
      ({ ctx }, _a, _b, label) => {
        inv(ctx, label);
        expect(worth(ctx, 'Casey'), label).toBe(1400);
      },
    );
  });

  it('drop racing I\'m in from a second phone (cash-paid seat): the $14 is never both credit and a paid seat', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        const g = await on(ctx, '2026-11-03');
        await join(ctx, g.id, 'Blair');
        expect((await markPaid(ctx, g.id, 'Blair')).status).toBe(200);
        return { ctx, g, p1: await playerPhone(ctx, 'Blair'), p2: await playerPhone(ctx, 'Blair') };
      },
      ({ p1, g }) => p1.call('POST', `/api/sessions/${g.id}/withdraw`, {}),
      ({ p2, g }) => p2.call('POST', `/api/sessions/${g.id}/join`, {}),
      ({ ctx }, _a, _b, label) => {
        inv(ctx, label);
        expect(worth(ctx, 'Blair'), label).toBe(1400);
      },
    );
  });

  it('drop racing I\'m in (part credit $3 + cash $11): everything comes back exactly once', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        await givePot(ctx, 'Devon', 300);
        const g = await on(ctx, '2026-11-03');
        await join(ctx, g.id, 'Devon');
        expect((await markPaid(ctx, g.id, 'Devon')).status).toBe(200);
        return { ctx, g, p1: await playerPhone(ctx, 'Devon'), p2: await playerPhone(ctx, 'Devon') };
      },
      ({ p1, g }) => p1.call('POST', `/api/sessions/${g.id}/withdraw`, {}),
      ({ p2, g }) => p2.call('POST', `/api/sessions/${g.id}/join`, {}),
      ({ ctx }, _a, _b, label) => {
        inv(ctx, label);
        expect(worth(ctx, 'Devon'), label).toBe(1400);
      },
    );
  });

  it('I\'m in on game B racing manual Use credit on game A: never more than the pot', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03', '2026-11-05'] });
        const a = await on(ctx, '2026-11-03');
        const b = await on(ctx, '2026-11-05');
        await join(ctx, a.id, 'Casey');
        await givePot(ctx, 'Casey', 1400); // arrives after the sign-up: manual Use credit is theirs
        return { ctx, a, b, p1: await playerPhone(ctx, 'Casey'), p2: await playerPhone(ctx, 'Casey') };
      },
      ({ p1, a }) => p1.call('POST', `/api/sessions/${a.id}/use-credit`, {}),
      ({ p2, b }) => p2.call('POST', `/api/sessions/${b.id}/join`, {}),
      ({ ctx, a, b }, _ra, rb, label) => {
        expect(rb.status, label).toBe(200);
        inv(ctx, label);
        expect(liveUsed(ctx, a.id, 'Casey') + liveUsed(ctx, b.id, 'Casey'), label).toBe(1400);
        expect(worth(ctx, 'Casey'), label).toBe(1400);
      },
    );
  });

  it('I\'m in on game B racing Use it on game A: the $3 of usable credit goes to one game only', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03', '2026-11-05'] });
        const a = await on(ctx, '2026-11-03');
        const b = await on(ctx, '2026-11-05');
        await givePot(ctx, 'Casey', 1000);
        await askCashOut(ctx, 'Casey', 1000);
        expect((await join(ctx, a.id, 'Casey')).cashOutOffer).toEqual({ cents: 1000, requestCents: 1000 });
        await givePot(ctx, 'Casey', 300); // more credit arrives while the prompt is open
        await ctx.texts();
        return { ctx, a, b, p1: await playerPhone(ctx, 'Casey'), p2: await playerPhone(ctx, 'Casey') };
      },
      ({ p1, a }) => p1.call('POST', `/api/sessions/${a.id}/use-cash-out`, { cents: 1000 }),
      ({ p2, b }) => p2.call('POST', `/api/sessions/${b.id}/join`, {}),
      async ({ ctx }, ra, rb, label) => {
        expect(rb.status, label).toBe(200);
        inv(ctx, label);
        expect(worth(ctx, 'Casey'), label).toBe(1300);
        expect((await ctx.texts()).length, label).toBe(ra.status === 200 ? 1 : 0);
      },
    );
  });

  it('Use it racing Mark refunded: one wins, the money is used or paid out once, one Telegram line only if Use it won', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-05'] });
        const g = await on(ctx, '2026-11-05');
        await givePot(ctx, 'Casey', 1000);
        const id = await askCashOut(ctx, 'Casey', 1000);
        await join(ctx, g.id, 'Casey');
        await ctx.texts();
        return { ctx, g, id, phone: await playerPhone(ctx, 'Casey') };
      },
      ({ phone, g }) => phone.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 }),
      ({ ctx, id }) => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents: 1000 }),
      async ({ ctx, g }, ra, rb, label) => {
        expect([ra.status, rb.status].filter((s) => s === 200), label).toHaveLength(1);
        inv(ctx, label);
        expect(worth(ctx, 'Casey'), label).toBe(1000);
        expect(liveUsed(ctx, g.id, 'Casey'), label).toBe(ra.status === 200 ? 1000 : 0);
        expect((await ctx.texts()).filter((t) => t.includes('withdrew')).length, label).toBe(ra.status === 200 ? 1 : 0);
      },
    );
  });

  it('Use it racing Not now and racing Cancel request: the books hold, Telegram only for a Use it that went through', async () => {
    for (const other of ['not_now', 'cancel'] as const) {
      await sweep(
        async () => {
          const ctx = await group({ book: ['2026-11-05'] });
          const g = await on(ctx, '2026-11-05');
          await givePot(ctx, 'Casey', 1500);
          const id = await askCashOut(ctx, 'Casey', 1000);
          const j = await join(ctx, g.id, 'Casey');
          expect(j).toMatchObject({ creditCents: 500, cashOutOffer: { cents: 900, requestCents: 1000 } });
          await ctx.texts();
          return { ctx, g, id, phone: await playerPhone(ctx, 'Casey') };
        },
        ({ phone, g }) => phone.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 900 }),
        ({ ctx, id, phone }) =>
          other === 'not_now' ? ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'not_now' }) : phone.call('POST', '/api/me/refund-request/cancel', {}),
        async ({ ctx, g }, ra, _rb, label) => {
          inv(ctx, `${other} ${label}`);
          expect(worth(ctx, 'Casey'), label).toBe(1500);
          expect(liveUsed(ctx, g.id, 'Casey'), label).toBe(ra.status === 200 ? 1400 : 500);
          expect(reservedOf(ctx, ctx.byName.Casey), label).toBe(0);
          expect((await ctx.texts()).length, label).toBe(ra.status === 200 ? 1 : 0);
        },
      );
    }
  });

  it('Use it double tap from two phones: one goes through, one Telegram line', async () => {
    const ctx = await group({ book: ['2026-11-05'] });
    const g = await on(ctx, '2026-11-05');
    await givePot(ctx, 'Casey', 1000);
    await askCashOut(ctx, 'Casey', 1000);
    await join(ctx, g.id, 'Casey');
    await ctx.texts();
    const [p1, p2] = [await playerPhone(ctx, 'Casey'), await playerPhone(ctx, 'Casey')];
    const res = await Promise.all([
      p1.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 }),
      p2.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 }),
      p1.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(liveUsed(ctx, g.id, 'Casey')).toBe(1000);
    expect(await ctx.texts()).toHaveLength(1);
    await books(ctx);
  });

  it('join racing the organizer canceling the game: whatever wins, the credit is back in the pot', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        await givePot(ctx, 'Casey', 1400);
        return { ctx, g: await on(ctx, '2026-11-03'), phone: await playerPhone(ctx, 'Casey') };
      },
      ({ phone, g }) => phone.call('POST', `/api/sessions/${g.id}/join`, {}),
      ({ ctx, g }) => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true }),
      ({ ctx, g }, _a, _b, label) => {
        inv(ctx, label);
        expect(liveUsed(ctx, g.id, 'Casey'), label).toBe(0);
        expect(potOf(ctx, ctx.byName.Casey), label).toBe(1400);
      },
    );
  });

  it('a double tap on I\'m in writes one "used credit" line in Activity, not two', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    const [p1, p2] = [await playerPhone(ctx, 'Casey'), await playerPhone(ctx, 'Casey')];
    const res = await Promise.all([p1.call('POST', `/api/sessions/${g.id}/join`, {}), after(40, () => p2.call('POST', `/api/sessions/${g.id}/join`, {}))]);
    expect(usedRows(ctx, g.id, 'Casey')).toHaveLength(1);
    const lines = (raw(ctx).prepare("SELECT * FROM admin_audit_log WHERE action = 'credit_used'").all() as any[]).length;
    expect(res.filter((r) => r.data.creditCents === 1400), 'answers claiming the credit').toHaveLength(1);
    expect(lines, 'Activity lines for one credit use').toBe(1);
  });
});


describe('1b. exact interleavings (a pause point inside one call while the other runs to the end)', () => {
  it('a cash-out request that read the credit, then I\'m in spends it, then the request is saved: the request must not exceed the pot', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    const phone = await playerPhone(ctx, 'Casey');
    const p2 = await playerPhone(ctx, 'Casey');
    const pause = pauseOn(ctx, /INSERT INTO refund_requests/, () => p2.call('POST', `/api/sessions/${g.id}/join`, {}));
    const req = await phone.call('POST', '/api/me/refund-request', { cents: 1400 });
    pause.restore();
    expect(pause.fired()).toBe(true);
    expect(pause.result().data).toMatchObject({ result: 'confirmed', creditCents: 1400 });
    // Either the request is refused, or it must not hold back $14 the pot no longer has.
    expect({ status: req.status, pot: potOf(ctx, ctx.byName.Casey), reserved: reservedOf(ctx, ctx.byName.Casey) }).toEqual({ status: 409, pot: 0, reserved: 0 });
    inv(ctx);
  });

  it('a drop that is between "out" and "your $14 is credit" while the second phone taps I\'m in (cash-paid seat): never a free seat plus $14 credit', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Blair');
    await markPaid(ctx, g.id, 'Blair');
    const [p1, p2] = [await playerPhone(ctx, 'Blair'), await playerPhone(ctx, 'Blair')];
    const pause = pauseOn(ctx, /SELECT payment_amount_cents FROM session_players/, () => p2.call('POST', `/api/sessions/${g.id}/join`, {}));
    await p1.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    const row = raw(ctx).prepare('SELECT status, payment_status, refunded_at FROM session_players WHERE session_id = ? AND player_id = ?').get(g.id, ctx.byName.Blair) as any;
    const potc = potOf(ctx, ctx.byName.Blair);
    // In and paid with the $14 still on the seat, or in and owing with $14 credit: never in, "paid", AND $14 credit.
    expect({ status: row.status, paid: row.payment_status === 'paid' && !row.refunded_at, pot: potc }).toEqual(
      row.payment_status === 'paid' ? { status: 'confirmed', paid: true, pot: 0 } : { status: row.status, paid: false, pot: 1400 },
    );
    inv(ctx);
  });

  it('a drop that read the credit on the seat while the second phone taps I\'m in (credit-paid seat): $14 in total, never more', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    const [p1, p2] = [await playerPhone(ctx, 'Casey'), await playerPhone(ctx, 'Casey')];
    const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = \?2 WHERE id IN/, () => p2.call('POST', `/api/sessions/${g.id}/join`, {}));
    await p1.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    inv(ctx);
    expect(worth(ctx, 'Casey')).toBe(1400);
    await books(ctx);
  });

  it('cancel and a drop on a part-credit, part-cash seat, each paused inside the other: $14 back, once', async () => {
    for (const first of ['drop', 'cancel'] as const) {
      const ctx = await group({ book: ['2026-11-03'] });
      await givePot(ctx, 'Devon', 300);
      const g = await on(ctx, '2026-11-03');
      await join(ctx, g.id, 'Devon');
      await markPaid(ctx, g.id, 'Devon');
      const phone = await playerPhone(ctx, 'Devon');
      const doDrop = () => phone.call('POST', `/api/sessions/${g.id}/withdraw`, {});
      const doCancel = () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
      const pause = pauseOn(ctx, /UPDATE credit_ledger SET ended_at = \?1, ended_reason = \?2 WHERE id IN/, first === 'drop' ? doCancel : doDrop);
      await (first === 'drop' ? doDrop() : doCancel());
      pause.restore();
      expect(pause.fired()).toBe(true);
      inv(ctx, first);
      expect(potOf(ctx, ctx.byName.Devon), first).toBe(1400);
    }
  });

  it('a double tap where the second tap lands while the first is saving: one Activity line, one answer that says credit was used', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    const [p1, p2] = [await playerPhone(ctx, 'Casey'), await playerPhone(ctx, 'Casey')];
    const pause = pauseOn(ctx, /INSERT INTO session_players/, () => p2.call('POST', `/api/sessions/${g.id}/join`, {}));
    const first = await p1.call('POST', `/api/sessions/${g.id}/join`, {});
    pause.restore();
    expect(pause.fired()).toBe(true);
    expect(usedRows(ctx, g.id, 'Casey')).toEqual([{ amount_cents: 1400, ended_reason: null }]);
    expect([first.data, pause.result().data].filter((d) => d.creditCents === 1400), 'answers claiming the credit').toHaveLength(1);
    expect((raw(ctx).prepare("SELECT * FROM admin_audit_log WHERE action = 'credit_used'").all() as any[]).length, 'Activity lines').toBe(1);
    await books(ctx);
  });

  it('Use it paused at its save while Mark refunded runs (and the other way round): one wins, books hold, Telegram only for a saved Use it', async () => {
    for (const first of ['use', 'refund'] as const) {
      const ctx = await group({ book: ['2026-11-05'] });
      const g = await on(ctx, '2026-11-05');
      await givePot(ctx, 'Casey', 1000);
      const id = await askCashOut(ctx, 'Casey', 1000);
      await join(ctx, g.id, 'Casey');
      await ctx.texts();
      const doUse = () => useIt(ctx, g.id, 'Casey', 1000);
      const doRefund = () => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents: 1000 });
      const pause = pauseOn(ctx, /INSERT INTO credit_ledger/, first === 'use' ? doRefund : doUse);
      const a = await (first === 'use' ? doUse() : doRefund());
      pause.restore();
      const b = pause.result();
      const useRes = first === 'use' ? a : b;
      expect([a.status, b.status].filter((s) => s === 200), first).toHaveLength(1);
      inv(ctx, first);
      expect(worth(ctx, 'Casey'), first).toBe(1000);
      expect((await ctx.texts()).length, first).toBe(useRes.status === 200 ? 1 : 0);
    }
  });
});

describe('2. Undo restores the credit use exactly', () => {
  it('Undo in time sends nothing; Undo too late, then I\'m in again: the credit is used once, no double refund', async () => {
    const { startHold, undoHold } = await import('../src/hold');
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 2000);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    const before = JSON.stringify(raw(ctx).prepare('SELECT * FROM credit_ledger ORDER BY rowid').all());
    // In time: thrown away.
    startHold(g.id, { send: async () => void (await drop(ctx, g.id, 'Casey')), settled: () => {}, undone: () => {} }, 50);
    expect(undoHold(g.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(JSON.stringify(raw(ctx).prepare('SELECT * FROM credit_ledger ORDER BY rowid').all())).toBe(before);
    // Too late: the drop went.
    let settled = false;
    startHold(g.id, { send: async () => void (await drop(ctx, g.id, 'Casey')), settled: () => void (settled = true), undone: () => {} }, 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(true);
    expect(undoHold(g.id)).toBe(false);
    expect(await pot(ctx, 'Casey')).toBe(2000);
    // I'm in again (and a retry of it): used once.
    expect(await join(ctx, g.id, 'Casey')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await join(ctx, g.id, 'Casey')).toEqual({ result: 'already_confirmed' });
    expect(usedRows(ctx, g.id, 'Casey')).toEqual([
      { amount_cents: 1400, ended_reason: 'dropped' },
      { amount_cents: 1400, ended_reason: null },
    ]);
    expect(await pot(ctx, 'Casey')).toBe(600);
    // A retry of the old drop after the rejoin is a real drop (once).
    await drop(ctx, g.id, 'Casey');
    await drop(ctx, g.id, 'Casey');
    expect(await pot(ctx, 'Casey')).toBe(2000);
    await books(ctx);
  });

  it('drop, rejoin, drop: the organizer sees $14 back as credit for the game, not $28', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    await drop(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Casey');
    await drop(ctx, g.id, 'Casey');
    expect(await pot(ctx, 'Casey')).toBe(1400);
    const d = await books(ctx);
    expect(seat(d, g.id, 'Casey').creditBackCents, 'Who paid / Players tab "back as credit" for this game').toBe(1400);
  });
});

describe('3. cancel returns credit; reopen never double-credits', () => {
  it('organizer cancel, reopen, cancel again: back once each time, never twice', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 300);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(ctx, g.id, 'Devon');
    await markPaid(ctx, g.id, 'Blair');
    const cancel = () => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).data).toMatchObject({ changed: false });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await pot(ctx, 'Devon')).toBe(1400);
    expect(await pot(ctx, 'Blair')).toBe(1400);
    await books(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    // Reopened: they are in and owe again; nothing is used by itself, nothing comes back twice.
    for (const n of ['Casey', 'Devon', 'Blair']) {
      expect(await pot(ctx, n), n).toBe(1400);
      expect(liveUsed(ctx, g.id, n), n).toBe(0);
      expect(await mine(ctx, n, g.id), n).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', oweCents: 1400 });
    }
    await books(ctx);
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/use-credit`, {})).data).toMatchObject({ usedCents: 1400, paid: true });
    expect((await cancel()).status).toBe(200);
    for (const n of ['Casey', 'Devon', 'Blair']) expect(await pot(ctx, n), n).toBe(1400);
    await books(ctx);
  });

  it('court "Didn\'t open": every credit use on the game comes back, standby players never had any taken', async () => {
    const ctx = await group({ noCourt: true });
    await givePot(ctx, 'Casey', 1400);
    await givePot(ctx, 'Devon', 500);
    await givePot(ctx, 'Emery', 900);
    const g = await on(ctx, '2026-11-05');
    await join(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Devon');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' });
    expect(await join(ctx, g.id, 'Emery')).toMatchObject({ result: 'standby' });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'not_opened' })).status).toBe(200);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    expect(await pot(ctx, 'Devon')).toBe(500);
    expect(await pot(ctx, 'Emery')).toBe(900);
    await books(ctx);
  });

  it('cancel racing a drop on a part-credit, part-cash seat: $3 credit + $11 cash both come back, exactly once', async () => {
    await sweep(
      async () => {
        const ctx = await group({ book: ['2026-11-03'] });
        await givePot(ctx, 'Devon', 300);
        const g = await on(ctx, '2026-11-03');
        await join(ctx, g.id, 'Devon');
        expect((await markPaid(ctx, g.id, 'Devon')).status).toBe(200);
        return { ctx, g, phone: await playerPhone(ctx, 'Devon') };
      },
      ({ phone, g }) => phone.call('POST', `/api/sessions/${g.id}/withdraw`, {}),
      ({ ctx, g }) => ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true }),
      ({ ctx }, _a, _b, label) => {
        inv(ctx, label);
        expect(potOf(ctx, ctx.byName.Devon), label).toBe(1400);
      },
    );
  });

  it('drop, rejoin, then the game is canceled: "back as credit" for the game says $14, not $28', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    await drop(ctx, g.id, 'Casey');
    await join(ctx, g.id, 'Casey');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    const d = await books(ctx);
    expect(seat(d, g.id, 'Casey').creditBackCents).toBe(1400);
    expect((await mine(ctx, 'Casey', g.id)).creditBackCents).toBe(1400);
  });
});

describe('4. no existing record is touched', () => {
  it('seats and ledger rows from before stay byte-identical through views, other joins, drops, promotions and a finalize', async () => {
    const ctx = await group({ maxPlayers: 6, book: ['2026-11-03', '2026-11-05'] });
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    // "Before the deploy": Blair in unpaid, Casey in and paid cash, Devon in and unpaid with credit that arrived later,
    // Emery in with a manual partial Use credit (an old reason NULL entry).
    await joinAll(ctx, a.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(ctx, a.id, 'Casey');
    await givePot(ctx, 'Devon', 1400);
    await givePot(ctx, 'Emery', 500);
    expect((await (await playerPhone(ctx, 'Emery')).call('POST', `/api/sessions/${a.id}/use-credit`, {})).data).toMatchObject({ usedCents: 500 });
    await joinAll(ctx, b.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    const seatsBefore = raw(ctx).prepare('SELECT * FROM session_players ORDER BY id').all() as any[];
    const ledgerBefore = raw(ctx).prepare('SELECT * FROM credit_ledger ORDER BY id').all() as any[];
    const snap = () => {
      const seats = raw(ctx).prepare('SELECT * FROM session_players ORDER BY id').all() as any[];
      const led = raw(ctx).prepare('SELECT * FROM credit_ledger ORDER BY id').all() as any[];
      return {
        seats: JSON.stringify(seats.filter((s) => seatsBefore.some((x) => x.id === s.id))),
        ledger: JSON.stringify(led.filter((l) => ledgerBefore.some((x) => x.id === l.id))),
      };
    };
    const want = { seats: JSON.stringify(seatsBefore), ledger: JSON.stringify(ledgerBefore) };
    // After: everyone looks; Frankie joins both games with credit and drops one; the organizer looks at everything.
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await view(ctx, n);
    await dash(ctx);
    await ctx.organizer.call('GET', '/api/admin/money?month=2026-11');
    await givePot(ctx, 'Frankie', 2000);
    await join(ctx, a.id, 'Frankie');
    await join(ctx, b.id, 'Frankie');
    await drop(ctx, b.id, 'Frankie');
    // Re-tapping I'm in on games they are already in, and the organizer re-adding them, changes nothing.
    await join(ctx, a.id, 'Devon');
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/roster`, { playerId: ctx.byName.Devon, action: 'confirm' });
    expect(snap()).toEqual(want);
    // Game day for B passes and B is finalized: game A's old seats are still untouched.
    ctx.app.now = Date.parse(b.endsAt) + HOUR;
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await view(ctx, n);
    const before = snap();
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/finalize`, { everyone: true })).status).toBe(200);
    const after = snap();
    const aSeats = (s: string) => (JSON.parse(s) as any[]).filter((x) => x.session_id === a.id);
    expect(aSeats(after.seats)).toEqual(aSeats(before.seats));
    expect(JSON.parse(after.ledger).filter((l: any) => l.session_id !== b.id)).toEqual(JSON.parse(before.ledger).filter((l: any) => l.session_id !== b.id));
    expect(liveUsed(ctx, a.id, 'Devon')).toBe(0);
    await books(ctx);
  });
});

describe('5. players never see anyone else\'s credit or cash out', () => {
  it('every player-facing answer, including join, use-cash-out, version and View as, holds only their own', async () => {
    const ctx = await group({ book: ['2026-11-03', '2026-11-05'] });
    const g = await on(ctx, '2026-11-03');
    const h = await on(ctx, '2026-11-05');
    await givePot(ctx, 'Casey', 2300);
    await givePot(ctx, 'Devon', 1900);
    await askCashOut(ctx, 'Devon', 1900);
    await ctx.texts();
    const blair = await playerPhone(ctx, 'Blair');
    const seen: string[] = [];
    const keep = (r: any) => (seen.push(withoutIds(r.text)), r);
    keep(await blair.call('POST', `/api/sessions/${g.id}/join`, {}));
    keep(await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/join`, {}));
    const devJoin = await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${g.id}/join`, {});
    expect(devJoin.data.cashOutOffer).toEqual({ cents: 1400, requestCents: 1900 });
    expect(JSON.stringify(devJoin.data)).not.toContain('2300');
    keep(await blair.call('GET', '/api/group'));
    keep(await blair.call('GET', '/api/group/version'));
    keep(await blair.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 }));
    keep(await blair.call('POST', `/api/sessions/${g.id}/use-credit`, {}));
    keep(await blair.call('POST', `/api/sessions/${h.id}/join`, {}));
    keep(await blair.call('POST', `/api/sessions/${h.id}/withdraw`, {}));
    keep(await blair.call('GET', '/api/group'));
    // The organizer's View as Blair shows Blair's money only.
    keep(await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair, 'X-Group-Key': ctx.groupKey }));
    for (const text of seen) for (const secret of ['2300', '$23', '1900', '$19', '"cashOutOffer"', 'requestCents']) expect(text, secret).not.toContain(secret);
    // View as Devon cannot tap Use it for real: refused, nothing changes, no Telegram.
    const asDevon = await ctx.organizer.call('POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 }, { 'X-View-As': ctx.byName.Devon, 'X-Group-Key': ctx.groupKey });
    expect(asDevon.status).toBe(403);
    expect(request(ctx, 'Devon')).toMatchObject({ status: 'pending', amount_cents: 1900 });
    expect(await ctx.texts()).toEqual([]);
    await books(ctx);
  });
});

describe('6. the books after finalize and per-seat numbers', () => {
  it('a 5-player game with credit seats ($14, $13 part, $3 part): right money back, nobody overpays', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    const g = await on(ctx, '2026-11-03');
    await givePot(ctx, 'Blair', 1400);
    await givePot(ctx, 'Casey', 1300);
    await givePot(ctx, 'Devon', 300);
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await markPaid(ctx, g.id, 'Emery');
    await markPaid(ctx, g.id, 'Frankie');
    await books(ctx);
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    // $11 each: Blair $3 back, Casey ($13 credit) $2 back and paid, Devon owes $8, Emery and Frankie $3 back.
    expect(await pot(ctx, 'Blair')).toBe(300);
    expect(await pot(ctx, 'Casey')).toBe(200);
    expect(await pot(ctx, 'Devon')).toBe(0);
    expect(await pot(ctx, 'Emery')).toBe(300);
    const d = await books(ctx);
    expect(seat(d, g.id, 'Devon')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, owesCents: 800 });
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', owesCents: 0 });
    await markPaid(ctx, g.id, 'Devon');
    expect(seat(await books(ctx), g.id, 'Devon')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100 });
    const nov = (await ctx.organizer.call('GET', '/api/admin/money?month=2026-11')).data;
    expect(nov.sessions.find((s: any) => s.id === g.id).collectedCents).toBe(5 * 1100);
  });

  it('did not play, with $3 of credit used at sign-up on a seat that still owed: the $3 comes back', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    const g = await on(ctx, '2026-11-03');
    await givePot(ctx, 'Devon', 300);
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    for (const n of ['Blair', 'Casey', 'Emery', 'Frankie']) await markPaid(ctx, g.id, n);
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const played = ['Blair', 'Casey', 'Emery', 'Frankie'].map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played })).status).toBe(200);
    expect(seat(await dash(ctx), g.id, 'Devon')).toMatchObject({ owesCents: 0 });
    // Money back for "did not play" becomes credit; the credit he put on the seat is his again.
    expect(await pot(ctx, 'Devon')).toBe(300);
    // Recorded like a paid no-show: the seat is paid with that $3 and settled, and the $3 comes back as a "did not play" credit.
    expect(liveUsed(ctx, g.id, 'Devon')).toBe(300);
    const back = ctx.app.db.raw.prepare("SELECT amount_cents, reason FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ? AND ended_at IS NULL").all(g.id, ctx.byName.Devon) as any[];
    expect(back.map((r) => [r.amount_cents, r.reason])).toEqual([[300, 'not_played']]);
    expect(seat(await dash(ctx), g.id, 'Devon')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 300 });
    expect(seat(await dash(ctx), g.id, 'Devon').refundedAt).toBeTruthy();
    // Reopen takes it back to where it was: $3 of credit on a seat that owes the rest.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect(await pot(ctx, 'Devon')).toBe(0);
    expect(seat(await dash(ctx), g.id, 'Devon')).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, owesCents: 1100 });
    await books(ctx);
  });
});

describe('7. the Telegram line', () => {
  it('first name, amounts and day only; once per Use it; never from a refused call; respects the switch', async () => {
    const ctx = await group({ book: ['2026-11-05'] });
    const g = await on(ctx, '2026-11-05');
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Casey}`, { name: 'Casey Zebulon-Smith', phone: '(313) 555-0177', venmo: '@CaseyVenmoSecret' })).status).toBe(200);
    await givePot(ctx, 'Casey', 1000);
    await askCashOut(ctx, 'Casey', 1000);
    await ctx.texts();
    await join(ctx, g.id, 'Casey');
    // Refused calls send nothing.
    expect((await useIt(ctx, g.id, 'Casey', 900)).status).toBe(409);
    expect((await useIt(ctx, g.id, 'Casey', 0)).status).toBeGreaterThanOrEqual(400);
    expect((await useIt(ctx, g.id, 'Blair', 1000)).status).toBe(409);
    expect(await ctx.texts()).toEqual([]);
    expect((await useIt(ctx, g.id, 'Casey', 1000)).status).toBe(200);
    const bodies = await ctx.bodies();
    expect(bodies).toHaveLength(1);
    const all = JSON.stringify(bodies[0]);
    expect(bodies[0].text).toBe('Casey withdrew the $10 cash out request (using it for Thu Nov 5)');
    for (const bad of ['Zebulon', 'Smith', '555', '0177', 'Venmo', 'venmo', 'Secret']) expect(all, bad).not.toContain(bad);
    // With refund-request alerts off, nothing.
    const ctx2 = await group({ book: ['2026-11-05'] });
    const g2 = await on(ctx2, '2026-11-05');
    await givePot(ctx2, 'Devon', 1000);
    await askCashOut(ctx2, 'Devon', 1000);
    expect((await ctx2.organizer.call('PUT', '/api/admin/alerts', { refundRequests: false })).status).toBe(200);
    await ctx2.texts();
    await join(ctx2, g2.id, 'Devon');
    expect((await useIt(ctx2, g2.id, 'Devon', 1000)).status).toBe(200);
    expect(await ctx2.texts()).toEqual([]);
  });
});

describe('8. other rules from the spec', () => {
  it('the organizer moving in from a waitlist uses no credit', async () => {
    const ctx = await group({ maxPlayers: 4, book: ['2026-11-03'] });
    await givePot(ctx, 'Alex', 1400);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/me`, { in: true })).data).toMatchObject({ result: 'waitlisted' });
    await drop(ctx, g.id, 'Emery');
    expect(seat(await dash(ctx), g.id, 'Alex').status).toBe('confirmed');
    expect(liveUsed(ctx, g.id, 'Alex')).toBe(0);
    inv(ctx);
  });

  it('organizer moves a part-credit player to the waitlist, then a spot opens: credit back, then used once again', async () => {
    const ctx = await group({ maxPlayers: 4, book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 500);
    const g = await on(ctx, '2026-11-03');
    await joinAll(ctx, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'waitlist' });
    expect(await pot(ctx, 'Casey')).toBe(500);
    await books(ctx);
    await join(ctx, g.id, 'Frankie'); // takes the open spot
    await drop(ctx, g.id, 'Devon'); // Casey moves in
    expect(seat(await dash(ctx), g.id, 'Casey')).toMatchObject({ status: 'confirmed', creditCents: 500, owesCents: 900 });
    expect(usedRows(ctx, g.id, 'Casey').map((r) => r.ended_reason)).toEqual(['unmarked', null]);
    await books(ctx);
  });

  it('a full credit seat moved to the waitlist by the organizer, then removed: the $14 comes back once', async () => {
    const ctx = await group({ book: ['2026-11-03'] });
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, 'Casey');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'waitlist' });
    await books(ctx);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'withdraw' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ctx.byName.Casey, action: 'withdraw' });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    await books(ctx);
  });

  it('Use it is refused on a canceled game, on a finalized game, and for a waitlisted player', async () => {
    const ctx = await group({ maxPlayers: 4, book: ['2026-11-03', '2026-11-05'] });
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    await givePot(ctx, 'Casey', 1000);
    await askCashOut(ctx, 'Casey', 1000);
    await joinAll(ctx, a.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await joinAll(ctx, b.id, ['Blair', 'Devon', 'Emery', 'Frankie']);
    expect(await join(ctx, b.id, 'Casey')).toMatchObject({ result: 'waitlisted' });
    expect((await useIt(ctx, b.id, 'Casey', 1000)).status).toBe(409);
    ctx.app.now = Date.parse(a.endsAt) + HOUR;
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/finalize`, { everyone: true });
    expect((await useIt(ctx, a.id, 'Casey', 1000)).status).toBe(409);
    expect(request(ctx, 'Casey')).toMatchObject({ status: 'pending', amount_cents: 1000 });
    expect((await ctx.texts()).filter((t) => t.includes('withdrew'))).toEqual([]);
    await books(ctx);
  });

  it('the Mark refunded guard: an old card amount is refused, the shrunk one works, and the pot never goes below the request', async () => {
    const ctx = await group({ book: ['2026-11-05'] });
    const g = await on(ctx, '2026-11-05');
    await givePot(ctx, 'Devon', 1000);
    const id = await askCashOut(ctx, 'Devon', 1000);
    await givePot(ctx, 'Devon', 200);
    expect(await join(ctx, g.id, 'Devon')).toMatchObject({ creditCents: 200, cashOutOffer: { cents: 1000, requestCents: 1000 } });
    // The $2 went on at the tap; Use it takes the whole $10 request; then the card is gone.
    expect((await useIt(ctx, g.id, 'Devon', 1000)).data).toMatchObject({ usedCents: 1000, requestLeftCents: 0 });
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents: 1000 })).status).toBe(409);
    expect(await mine(ctx, 'Devon', g.id)).toMatchObject({ creditCents: 1200, oweCents: 200 });
    await books(ctx);
  });
});
