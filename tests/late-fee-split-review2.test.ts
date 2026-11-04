// Second independent review pass of the late-cancel fee split fixes (d9acbce): held cash over several rounds, the Reopen guard.
// Re-review of the fixes in d9acbce (held cash in splitSeatStatements, Reopen guard, SPLIT_STATE).
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
function health(w: W) {
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const r = raw(w).prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(r).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const liveUsedOnSeat = (w: W, name: string) =>
  (raw(w).prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND session_id = ? AND player_id = ?").get(w.sid, w.byName[name]) as any).c;

// ---------------------------------------------------------------------------------------------------------------------

const pair = (w: W, name: string) => {
  const r = raw(w).prepare("SELECT kind, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason = 'cash' AND ended_at IS NULL AND session_id = ? AND player_id = ? GROUP BY kind").all(w.sid, w.byName[name]) as any[];
  const k = r.find((x) => x.kind === 'kept')?.c ?? 0;
  const u = r.find((x) => x.kind === 'used')?.c ?? 0;
  expect(k).toBe(u); // a pair always nets to nothing
  return u;
};
const finalizeAll = async (w: W) => {
  const s = await sess(w);
  w.app.now = Date.parse(s.endsAt) + HOUR;
  const r = await admin(w, 'POST', `/api/admin/sessions/${w.sid}/finalize`, { everyone: true });
  expect(r.status, r.text).toBe(200);
};
async function sixIn(w: W) {
  await alexIn(w);
  await join(w, OTHERS);
  await markPaid(w, 'Casey'); // $14 cash
  late(w, 8);
  expect((await cancel(w)).status).toBe(200);
}

describe('held cash path', () => {
  it('three rounds, $9 -> $7 -> $6, with $5 cash paid after the first Reopen: every cent accounted, Clear returns the rest', async () => {
    const w = await world();
    await sixIn(w);
    expect((await reopen(w)).status).toBe(200);
    expect(pair(w, 'Casey')).toBe(900);
    await markPaid(w, 'Casey'); // $5 cash on top of the $9 held
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    await join(w, ['Gale', 'Harper']);
    late(w, 6);
    expect((await cancel(w)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 8, priceCents: 700 });
    expect(await pot(w, 'Casey')).toBe(1200); // 19 in, 7 on the seat
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    expect(pair(w, 'Casey')).toBe(700);
    expect(health(w)).toEqual({});
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Casey')).toBe(700);
    await join(w, ['Indy']);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 9, priceCents: 600 });
    expect(await pot(w, 'Casey')).toBe(1300);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 600 });
    expect(pair(w, 'Casey')).toBe(600);
    expect(health(w)).toEqual({});
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(1900);
    expect(pair(w, 'Casey')).toBe(0);
    expect(health(w)).toEqual({});
  });

  it('held cash plus credit (Use credit after Reopen), $9 -> $7: held cash comes back first, Clear gives back the rest', async () => {
    const w = await world();
    await sixIn(w);
    expect((await reopen(w)).status).toBe(200);
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${w.sid}/use-credit`, {})).data).toMatchObject({ usedCents: 500, paid: true });
    await join(w, ['Gale', 'Harper']);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(700);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    expect(pair(w, 'Casey')).toBe(200);
    expect(liveUsedOnSeat(w, 'Casey')).toBe(700); // $5 credit + $2 held
    expect(health(w)).toEqual({});
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'sub' })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('an I paid on a held-cash seat, confirmed after a $7 split: $12 back in all, pair shrinks to $7', async () => {
    const w = await world();
    await sixIn(w);
    expect((await reopen(w)).status).toBe(200);
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200); // $5 cash claimed
    await join(w, ['Gale', 'Harper']);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(500); // the claim waits
    await markPaid(w, 'Casey');
    expect(await pot(w, 'Casey')).toBe(1200);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    expect(pair(w, 'Casey')).toBe(700);
    await markPaid(w, 'Casey');
    expect(await pot(w, 'Casey')).toBe(1200);
    expect(health(w)).toEqual({});
  });

  it('Unmark on a $7 seat that is all held cash, then Mark paid: no money created or lost', async () => {
    const w = await world();
    await sixIn(w);
    expect((await reopen(w)).status).toBe(200);
    await join(w, ['Gale', 'Harper']);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(700);
    expect(pair(w, 'Casey')).toBe(700);
    await markPaid(w, 'Casey', false);
    expect(await pot(w, 'Casey')).toBe(700);
    expect(await owes(w, 'Casey')).toBe(0); // the $7 held still covers it
    expect(pair(w, 'Casey')).toBe(700);
    await markPaid(w, 'Casey');
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    expect(await pot(w, 'Casey')).toBe(700);
    expect(health(w)).toEqual({});
  });

  it('after a $7 split, Reopen and Finalize with 8 played: seat paid $7 by the held cash, nothing extra back', async () => {
    const w = await world();
    await sixIn(w);
    expect((await reopen(w)).status).toBe(200);
    await join(w, ['Gale', 'Harper']);
    late(w, 4);
    expect((await cancel(w)).status).toBe(200);
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Casey')).toBe(700);
    await finalizeAll(w);
    expect(await pot(w, 'Casey')).toBe(700);
    expect(await owes(w, 'Casey')).toBe(0);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 700 });
    expect(health(w)).toEqual({});
  });
});

describe('Reopen guard', () => {
  it('an I paid landing between the pre-check and the batch: 409 and nothing half done (settled seat stays settled)', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    await markPaid(w, 'Casey');
    await markPaid(w, 'Devon');
    late(w);
    expect((await cancel(w)).status).toBe(200);
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Devon, why: 'choice' })).status).toBe(200);
    const seatRaw = () => raw(w).prepare('SELECT payment_status, payment_amount_cents, refunded_at FROM session_players WHERE session_id = ? AND player_id = ?').get(w.sid, w.byName.Devon);
    const devonBefore = seatRaw();
    expect((devonBefore as any).refunded_at).not.toBeNull();
    const db = w.app.db as any;
    const realBatch = db.batch.bind(db);
    let once = false;
    db.batch = async (stmts: any[]) => {
      if (!once) {
        once = true;
        raw(w)
          .prepare("UPDATE session_players SET payment_status = 'paid', payment_amount_cents = 900, paid_at = ?, self_paid_at = ?, payment_updated_at = ? WHERE session_id = ? AND player_id = ?")
          .run('2026-10-26T15:00:00.000Z', '2026-10-26T15:00:00.000Z', '2026-10-26T15:00:00.000Z', w.sid, w.byName.Blair);
      }
      return realBatch(stmts);
    };
    const r = await reopen(w);
    db.batch = realBatch;
    expect(r.status).toBe(409);
    const s = await sess(w);
    expect(s.state.flags.canceled).toBe(true);
    expect(s.feeSplit).toEqual({ count: 6, priceCents: 900 });
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(pair(w, 'Casey')).toBe(0);
    expect(seatRaw()).toEqual(devonBefore);
    expect(await pot(w, 'Devon')).toBe(1400);
    // Answer it and reopen: works, Devon (cleared) owes $14 with his $14 credit to use, Blair owes $5.
    await markPaid(w, 'Blair');
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(500);
    expect(await owes(w, 'Devon')).toBe(1400);
    expect(await pot(w, 'Devon')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('two Reopen taps at the same moment: one pair, Casey owes $5 once', async () => {
    const w = await world();
    await sixIn(w);
    const [a, b] = await Promise.all([reopen(w), reopen(w)]);
    // In this harness the second tap reads the game already reopened (200, changed: false). If both read it canceled, the
    // loser's first UPDATE changes nothing: it now answers 409 "changed", and its guarded statements find nothing to do.
    expect(a.status).toBe(200);
    expect([200, 409]).toContain(b.status);
    expect(pair(w, 'Casey')).toBe(900);
    expect(await owes(w, 'Casey')).toBe(500);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(health(w)).toEqual({});
  });

  it('non-split cancel then Reopen: settled seats reset exactly as before (no guard added)', async () => {
    const w = await world({ split: false });
    await sixIn(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'choice' })).status).toBe(200);
    expect((await reopen(w)).status).toBe(200);
    expect(await owes(w, 'Casey')).toBe(1400);
    expect(await pot(w, 'Casey')).toBe(1400);
  });
});
