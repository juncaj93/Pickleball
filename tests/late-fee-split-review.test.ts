// Independent review of the late-cancel fee split (LATE_FEE_SPLIT, b87f932), written by a reviewer who did not write the
// code. The "review fix" tests are its three findings, now asserting the right numbers after the fixes; the rest are
// checks that held from the start.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';
import type { GroupView } from '../shared/api';

const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

async function world(opts: { split?: boolean } = {}) {
  const app = new TestApp();
  const ctx = await setupGroup(app);
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' })).status).toBe(200);
  for (const n of ['Gale', 'Harper', 'Indy']) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-02${n.length}${n.charCodeAt(0) % 10}` });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  if (opts.split !== false) expect((await ctx.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const games = d.sessions.filter((x: any) => Date.parse(x.startsAt) > app.now);
  return { ...ctx, phones: new Map<string, Client>(), sid: games[0].id as string, start: Date.parse(games[0].startsAt), otherSid: games[1].id as string };
}
type W = Awaited<ReturnType<typeof world>>;

async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard');
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
async function phone(w: W, name: string): Promise<Client> {
  let c = w.phones.get(name);
  if (!c) {
    c = w.app.client();
    c.groupKey = w.groupKey;
    const res = await c.call('POST', '/api/me', { playerId: w.byName[name] });
    if (res.status !== 200) throw new Error(`pick name failed: ${res.text}`);
    w.phones.set(name, c);
  }
  return c;
}
const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body);
const admin = (w: W, method: string, path: string, body?: unknown) => w.organizer.call(method, path, body);
async function view(w: W, name: string): Promise<GroupView> {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const join = async (w: W, names: string[]) => {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${w.sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
};
const alexIn = async (w: W) => expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/me`, { in: true })).status).toBe(200);
const markPaid = async (w: W, name: string, paid = true) => {
  const r = await admin(w, 'POST', `/api/admin/sessions/${w.sid}/payment`, { playerId: w.byName[name], paid });
  expect(r.status, r.text).toBe(200);
};
const late = (w: W, h = 4) => {
  w.app.now = w.start - h * HOUR;
};
const cancel = (w: W, venueWaived = false) => admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'cancel', confirm: true, venueWaived });
const reopen = (w: W) => admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'reopen' });
const sess = async (w: W) => (await dash(w)).sessions.find((s: any) => s.id === w.sid);
const row = async (w: W, name: string) => (await sess(w)).roster.find((r: any) => r.name === name);
const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
const owes = async (w: W, name: string) => (await view(w, name)).owed.find((o) => o.sessionId === w.sid)?.amountCents ?? 0;
const raw = (w: W) => (w.app.db as any).raw;
function givePot(w: W, name: string, cents: number) {
  raw(w).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${w.byName[name]}', 'kept', ${cents}, '${w.otherSid}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
function health(w: W) {
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const r = raw(w).prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(r).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const liveUsedOnSeat = (w: W, name: string) =>
  (raw(w).prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND session_id = ? AND player_id = ?").get(w.sid, w.byName[name]) as any).c;

// ---------------------------------------------------------------------------------------------------------------------

describe('review fix 1: held cash from a split Reopen comes back on a second split cancel at a lower price', () => {
  it('6 in ($9), Reopen, 2 more join (8 in, $7), fee-kept cancel again: Casey has $7 back and a seat paid $7', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    await markPaid(w, 'Casey'); // $14 cash
    late(w, 6);
    expect((await cancel(w)).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    // Reopen: unsplitStatements holds Casey's $9 cash as a 'cash' pair, seat unpaid, owes $5.
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Casey')).toBe(500);
    await join(w, ['Gale', 'Harper']); // 8 in now
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 8, priceCents: 700 });
    // Casey put $14 cash in. At $7 he should have $7 credit and a seat paid $7.
    // Today: credit $5, seat recorded as paid $9: $2 over-collected (splitSeatStatements: an unpaid seat's held cash
    // counts in `holds` but `fromCash` is 0 for an unpaid seat and `fromCredit` is capped at the credit used, 0).
    expect(await pot(w, 'Casey')).toBe(700);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    // The Money page counts that $9 as collected from Casey.
    const m = (await admin(w, 'GET', `/api/admin/money?month=${new Date(w.start).toISOString().slice(0, 7)}`)).data;
    expect(m.sessions.find((x: any) => x.id === w.sid).collectedCents).toBe(700); // only Casey paid
    expect(health(w)).toEqual({});
    // Clear gives back the $7 left: $14 in all, what he put in.
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(health(w)).toEqual({});
  });
});

describe('review fix 2: an I paid at the split price, still unconfirmed, stops Reopen until it is answered', () => {
  it('Blair owed $9, taps I paid ($9): Reopen is refused; Mark paid, then Reopen: Blair owes $5 on the $14 game', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    await markPaid(w, 'Casey');
    late(w, 6);
    expect((await cancel(w)).status).toBe(200);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, selfPaid: true });
    const refused = await reopen(w);
    expect(refused.status).toBe(409);
    expect(refused.text).toContain('Blair tapped I paid, not confirmed yet');
    expect((await sess(w)).state.flags.canceled).toBe(true);
    await markPaid(w, 'Blair'); // the organizer confirms the $9 the player really sent
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, selfPaid: false });
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Casey')).toBe(500);
    expect(await owes(w, 'Blair')).toBe(500);
    // Two late drops (6 -> 4, both free), then a fee-kept cancel with 4 in: flat $14, no split, nothing reprices.
    late(w, 3);
    for (const n of ['Emery', 'Frankie']) expect((await call(w, n, 'POST', `/api/sessions/${w.sid}/withdraw`, {})).status).toBe(200);
    expect((await cancel(w)).status).toBe(200);
    expect((await sess(w)).feeSplit).toBeNull();
    expect(await owes(w, 'Devon')).toBe(1400);
    expect(await owes(w, 'Blair')).toBe(500);
    expect(health(w)).toEqual({});
  });

  it('(Finalize heals it: with 4 played at $14, the short $9 cash seat is held and owes $5)', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    late(w, 6);
    expect((await cancel(w)).status).toBe(200);
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    await markPaid(w, 'Blair');
    expect((await reopen(w)).status).toBe(200);
    const s = await sess(w);
    w.app.now = Date.parse(s.endsAt) + HOUR;
    const played = ['Alex', 'Blair', 'Casey', 'Devon'].map((n) => w.byName[n]);
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/finalize`, { played })).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(500);
  });
});

describe('review fix 3: changes between the read and the cancel', () => {
  it('3a. a Mark paid landing just before the money check is read: the split sees it ($9 seat, $5 back)', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    late(w);
    const db = w.app.db as any;
    const realPrepare = db.prepare;
    let fired = false;
    db.prepare = (sql: string) => {
      const st = realPrepare(sql);
      if (!fired && /group_concat\(x, '\|'\)/.test(sql) && /AS s\s*$/.test(sql)) {
        // The moneyState read inside splitPlan: the other request's Mark paid commits just before it.
        const wrap = (s: any): any => ({
          bind: (...v: unknown[]) => wrap(s.bind(...v)),
          first: async () => {
            fired = true;
            raw(w)
              .prepare("UPDATE session_players SET payment_status = 'paid', payment_amount_cents = 1400, paid_at = ?, payment_updated_at = ? WHERE session_id = ? AND player_id = ?")
              .run(new Date(w.app.now).toISOString(), new Date(w.app.now).toISOString(), w.sid, w.byName.Blair);
            return s.first();
          },
        });
        return wrap(st);
      }
      return st;
    };
    const r = await cancel(w);
    db.prepare = realPrepare;
    expect(fired).toBe(true);
    expect(r.status, r.text).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 6, priceCents: 900 });
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(await pot(w, 'Blair')).toBe(500);
    expect(health(w)).toEqual({});
  });

  it('3b. a seat\'s credit entry swapped for an equal one (undo + Use credit) between the read and the batch: the cancel refuses, nothing moves', async () => {
    const w = await world();
    givePot(w, 'Blair', 1400);
    await alexIn(w);
    await join(w, OTHERS);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    late(w);
    const db = w.app.db as any;
    const realBatch = db.batch.bind(db);
    let once = false;
    db.batch = async (stmts: any[]) => {
      if (!once && stmts.length > 5) {
        once = true;
        // Undo credit then Use credit again: same seat row, same live count and sum, a new entry id.
        const old = raw(w).prepare("SELECT * FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(w.sid, w.byName.Blair) as any;
        raw(w).prepare("UPDATE credit_ledger SET ended_at = ?, ended_reason = 'undone' WHERE id = ?").run('2026-10-26T15:00:00.000Z', old.id);
        raw(w)
          .prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) VALUES ('swapped-used', ?, ?, 'used', 1400, ?, ?)")
          .run(old.group_id, old.player_id, old.session_id, '2026-10-26T15:00:01.000Z');
      }
      return realBatch(stmts);
    };
    const r = await cancel(w);
    db.batch = realBatch;
    expect(r.status, r.text).toBe(409);
    expect((await sess(w)).state.flags.canceled).toBe(false);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect(liveUsedOnSeat(w, 'Blair')).toBe(1400);
    expect(await pot(w, 'Blair')).toBe(0);
    expect(health(w)).toEqual({});
  });
});

describe('note: Unmark after a split keeps the split credit (Finalize takes its credit back on Unmark)', () => {
  it('a mistaken Mark paid ($14) before the cancel: after Unmark Casey owes $9 and still holds the $5', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    await markPaid(w, 'Casey');
    late(w);
    expect((await cancel(w)).status).toBe(200);
    await markPaid(w, 'Casey', false);
    expect(await owes(w, 'Casey')).toBe(900);
    expect(await pot(w, 'Casey')).toBe(500); // he can now pay $4 cash + $5 credit for a $9 share he never paid $14 toward
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('checked and fine', () => {
  it('Reopen, same N, cancel again: totals stay exact, and Clear gives back exactly what is left', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    await markPaid(w, 'Casey');
    late(w, 6);
    expect((await cancel(w)).status).toBe(200);
    expect((await reopen(w)).status).toBe(200);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'sub' })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('switch turned off after the split: stored price still used for Mark paid, Use credit and Clear', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    expect((await call(w, 'Devon', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    late(w);
    expect((await cancel(w)).status).toBe(200);
    expect((await admin(w, 'PUT', '/api/admin/late-fee-split', { on: false })).status).toBe(200);
    expect((await admin(w, 'PUT', '/api/admin/late-fees', { on: false })).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(900);
    await markPaid(w, 'Devon');
    expect(await pot(w, 'Devon')).toBe(500);
    givePot(w, 'Emery', 2000);
    expect((await call(w, 'Emery', 'POST', `/api/sessions/${w.sid}/use-credit`, {})).data).toMatchObject({ usedCents: 900, paid: true });
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Emery, why: 'choice' })).status).toBe(200);
    expect(await pot(w, 'Emery')).toBe(2000);
    expect(health(w)).toEqual({});
  });

  it('waitlist seat with credit and the organizer\'s court payment: waitlist gets all back, court payment untouched', async () => {
    const w = await world();
    expect((await admin(w, 'PUT', '/api/admin/group', { settings: { maxPlayers: 6 } })).status).toBe(200);
    await alexIn(w);
    await join(w, OTHERS);
    givePot(w, 'Gale', 1400);
    await join(w, ['Gale']);
    expect((await row(w, 'Gale')).status).toBe('waitlisted');
    await markPaid(w, 'Alex'); // court paid
    const before = await row(w, 'Alex');
    late(w);
    expect((await cancel(w)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 6, priceCents: 900 });
    expect(await pot(w, 'Gale')).toBe(1400);
    expect(await row(w, 'Alex')).toMatchObject({ paymentStatus: before.paymentStatus, paymentAmountCents: before.paymentAmountCents });
    expect(health(w)).toEqual({});
  });

  it('a pending cash-out request before the cancel: the split only adds credit, the reserve still fits the pot', async () => {
    const w = await world();
    givePot(w, 'Blair', 2800);
    await alexIn(w);
    await join(w, OTHERS); // Blair's seat paid with $14 of credit, $14 left
    const rr = await call(w, 'Blair', 'POST', '/api/me/refund-request', { cents: 1400 });
    expect(rr.status, rr.text).toBe(200);
    late(w);
    expect((await cancel(w)).status).toBe(200);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(liveUsedOnSeat(w, 'Blair')).toBe(900);
    expect(await pot(w, 'Blair')).toBe(1900);
    expect(health(w)).toEqual({});
  });

  it('switch off: a 6-in fee-kept cancel writes no final_price and moves no money (as before)', async () => {
    const w = await world({ split: false });
    await alexIn(w);
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w);
    expect((await cancel(w)).status).toBe(200);
    for (const p of OTHERS) expect(await pot(w, p)).toBe(0);
    expect(raw(w).prepare('SELECT final_price_cents AS p FROM sessions WHERE id = ?').get(w.sid)).toEqual({ p: null });
    expect((await reopen(w)).status).toBe(200);
    for (const p of OTHERS) expect(await row(w, p)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
  });
});
