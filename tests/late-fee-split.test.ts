// "Late-cancel fee split" (LATE_FEE_SPLIT, Alex, Nov 4; shared/lateFees.ts). A cancel inside the 12 hours where the venue
// kept the fee, with 5 or more signed up, prices every seat with the same function as a played game (floor(4 x $14 / N) in
// whole dollars, never above $14). 4 or fewer, late drops, the waived answer, waitlist and subs: unchanged. Switch off: flat
// $14 exactly as before. Alex (the organizer) counts as one of the people, the way Finalize counts him.
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { feeSplitOf, feeSplitPrice, LATE_FEE_SPLIT_HEADER, LATE_FEES_HEADER, lateFeePriceCents, lateFeeSplitAllowed } from '../shared/lateFees';
import { finalPrice } from '../shared/pricing';
import { lateCancelText } from '../src/pages/admin/textMenu';
import type { GroupView } from '../shared/api';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';

const PRICE = 1400;
const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
type Mode = 'off' | 'settings' | 'header';

async function world(opts: { split?: Mode; lateFees?: boolean; maxPlayers?: number; env?: Record<string, string> } = {}) {
  const app = new TestApp();
  Object.assign(app.env, opts.env ?? {});
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  for (const n of ['Gale', 'Harper', 'Indy']) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-02${n.length}${n.charCodeAt(0) % 10}` });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  if (opts.lateFees !== false) expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  const split = opts.split ?? 'settings';
  if (split === 'settings') expect((await ctx.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
  const headers: Record<string, string> = split === 'header' ? { [LATE_FEE_SPLIT_HEADER]: 'on' } : {};
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const games = d.sessions.filter((x: any) => Date.parse(x.startsAt) > app.now);
  return { ...ctx, headers, phones: new Map<string, Client>(), sid: games[0].id as string, start: Date.parse(games[0].startsAt), otherSid: games[1].id as string };
}
type W = Awaited<ReturnType<typeof world>>;

async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, w.headers);
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
const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body, w.headers);
const admin = (w: W, method: string, path: string, body?: unknown) => w.organizer.call(method, path, body, w.headers);
async function view(w: W, name: string): Promise<GroupView> {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const join = async (w: W, names: string[], sid = w.sid) => {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
};
const alexIn = async (w: W) => expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/me`, { in: true })).status).toBe(200);
const drop = async (w: W, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${w.sid}/withdraw`, {});
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const markPaid = async (w: W, name: string, paid = true) => {
  const r = await admin(w, 'POST', `/api/admin/sessions/${w.sid}/payment`, { playerId: w.byName[name], paid });
  expect(r.status, r.text).toBe(200);
};
const late = (w: W, h = 4) => {
  w.app.now = w.start - h * HOUR;
};
const cancel = (w: W, venueWaived: boolean) => admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'cancel', confirm: true, venueWaived });
const sess = async (w: W) => (await dash(w)).sessions.find((s: any) => s.id === w.sid);
const row = async (w: W, name: string) => (await sess(w)).roster.find((r: any) => r.name === name);
const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
const owes = async (w: W, name: string) => (await view(w, name)).owed.find((o) => o.sessionId === w.sid)?.amountCents ?? 0;
const raw = (w: W) => (w.app.db as any).raw;
/** Credit from an earlier game (another session), so I'm in uses it at once. */
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
const audits = (w: W, action: string) =>
  (raw(w).prepare('SELECT details_json FROM admin_audit_log WHERE action = ? ORDER BY created_at, rowid').all(action) as { details_json: string }[]).map((r) => JSON.parse(r.details_json));
const month = async (w: W) => (await admin(w, 'GET', `/api/admin/money?month=${new Date(w.start).toISOString().slice(0, 7)}`)).data;
/** Every player's money, as the ledger sees it: pot plus what sits on this game's seat. */
const ledgerTotal = (w: W, name: string) => {
  const rows = raw(w).prepare('SELECT kind, amount_cents FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(w.byName[name]) as any[];
  return rows.reduce((n, r) => n + (r.kind === 'kept' ? r.amount_cents : -r.amount_cents), 0);
};

const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

// ---------- the price ----------

describe('the split price is the played-game price', () => {
  it('matches finalPrice for 5 to 10 and is null for 4 or fewer', () => {
    for (let n = 0; n <= 4; n++) expect(feeSplitPrice(PRICE, n)).toBeNull();
    const table: Record<number, number> = { 5: 1100, 6: 900, 7: 800, 8: 700, 9: 600, 10: 500 };
    for (let n = 5; n <= 10; n++) {
      expect(feeSplitPrice(PRICE, n)).toBe(table[n]);
      expect(feeSplitPrice(PRICE, n)).toBe(finalPrice(PRICE, n));
      // Never over-collects: N people x price never above 4 shares.
      expect(n * feeSplitPrice(PRICE, n)!).toBeLessThanOrEqual(4 * PRICE);
    }
  });
  it('only a fee-kept, not finalized game with a stored price is split; only canceled_late seats use it', () => {
    const g = { status: 'canceled', canceled_by: 'organizer_fee_kept', finalized_at: null, final_price_cents: 900, final_played_count: 6 };
    expect(feeSplitOf(g)).toEqual({ count: 6, priceCents: 900 });
    expect(feeSplitOf({ ...g, final_price_cents: null })).toBeNull();
    expect(feeSplitOf({ ...g, canceled_by: 'organizer' })).toBeNull();
    expect(feeSplitOf({ ...g, status: 'booked' })).toBeNull();
    expect(lateFeePriceCents('canceled_late', g, PRICE)).toBe(900);
    expect(lateFeePriceCents('late_drop', g, PRICE)).toBe(PRICE);
    expect(lateFeePriceCents('no_show', g, PRICE)).toBe(PRICE);
    expect(lateFeeSplitAllowed(undefined)).toBe(true);
    expect(lateFeeSplitAllowed('off')).toBe(false);
  });
});

// ---------- cases 1 to 5: late drops, unchanged ----------

describe('cases 1-5: late drops keep today\'s rule (split switch on)', () => {
  const scenario = async (inN: number, leave: number) => {
    const w = await world();
    await alexIn(w);
    const others = OTHERS.slice(0, inN - 1);
    await join(w, others);
    late(w);
    for (const n of others.slice(0, leave)) await drop(w, n);
    const out: Record<string, number> = {};
    for (const n of others) out[n] = await owes(w, n);
    expect(health(w)).toEqual({});
    return out;
  };
  it('1. 4 in, 1 leaves late: leaver owes $14, others owe $14', async () => {
    expect(await scenario(4, 1)).toEqual({ Blair: 1400, Casey: 1400, Devon: 1400 });
  });
  it('2. 4 in, 2 leave late: both leavers owe $14', async () => {
    expect(await scenario(4, 2)).toEqual({ Blair: 1400, Casey: 1400, Devon: 1400 });
  });
  it('3. 5 in, 1 leaves late: leaver owes nothing, game on at 4', async () => {
    expect(await scenario(5, 1)).toEqual({ Blair: 0, Casey: 1400, Devon: 1400, Emery: 1400 });
  });
  it('4. 5 in, 2 leave late: first free, second owes $14', async () => {
    expect(await scenario(5, 2)).toEqual({ Blair: 0, Casey: 1400, Devon: 1400, Emery: 1400 });
  });
  it('5. 6 in, 3 leave late: only the third leaver owes $14', async () => {
    expect(await scenario(6, 3)).toEqual({ Blair: 0, Casey: 0, Devon: 1400, Emery: 1400, Frankie: 1400 });
  });
});

// ---------- cases 6, 7, 9, 12: the split ----------

async function feeKept(n: number, opts: Parameters<typeof world>[0] = {}) {
  const w = await world(opts);
  await alexIn(w);
  const others = OTHERS.slice(0, n - 1);
  await join(w, others);
  // Blair has not paid; everyone else paid $14 cash.
  for (const p of others.slice(1)) await markPaid(w, p);
  late(w);
  const r = await cancel(w, false);
  expect(r.status, r.text).toBe(200);
  return { w, others };
}

describe('cases 6, 7, 9: fee kept with 5 or more in', () => {
  it('6. 5 in: each owes $11; paid players get $3 back as credit; the unpaid one owes $11', async () => {
    const { w, others } = await feeKept(5);
    expect(await owes(w, 'Blair')).toBe(1100);
    expect(await pot(w, 'Blair')).toBe(0);
    for (const p of others.slice(1)) {
      expect(await owes(w, p)).toBe(0);
      expect(await pot(w, p)).toBe(300);
      expect(await row(w, p)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100, lateFee: { kind: 'canceled_late', paid: true } });
    }
    const s = await sess(w);
    expect(s.feeSplit).toEqual({ count: 5, priceCents: 1100 });
    expect(s.court).toMatchObject({ costCents: 4800, playersCoverCents: 4400, yourShareCents: 400 });
    expect(health(w)).toEqual({});
  });

  it('7. 6 in: each owes $9; paid players get $5 credit; Alex covers $3', async () => {
    const { w, others } = await feeKept(6);
    expect(await owes(w, 'Blair')).toBe(900);
    for (const p of others.slice(1)) {
      expect(await pot(w, p)).toBe(500);
      expect(await owes(w, p)).toBe(0);
    }
    expect((await sess(w)).court).toMatchObject({ costCents: 4800, playersCoverCents: 4500, yourShareCents: 300 });
    // The player screen and their credit history.
    const v = await view(w, 'Casey');
    const g = v.sessions.find((x) => x.id === w.sid)!;
    expect(g.mine?.lateFee).toMatchObject({ kind: 'canceled_late', oweCents: 0, priceCents: 900 });
    expect(v.owed.find((o) => o.sessionId === w.sid)).toBeUndefined();
    const b = (await view(w, 'Blair')).owed.find((o) => o.sessionId === w.sid);
    expect(b).toMatchObject({ amountCents: 900, lateFee: 'canceled_late' });
    // History lines say the real amounts.
    const lines = (raw(w).prepare("SELECT action, details_json FROM admin_audit_log WHERE action IN ('session_canceled', 'credit_back', 'late_fee_owed') ORDER BY rowid").all() as any[]).map((r) =>
      activityText({ action: r.action, details: JSON.parse(r.details_json), at: new Date(w.app.now).toISOString(), actor: 'organizer' } as any, 'America/Detroit', 'Alex'),
    );
    expect(lines.some((l) => /6 were in, everyone in owes \$9/.test(l))).toBe(true);
    expect(lines.filter((l) => /got \$5 back as credit .*\(canceled late, fee split\)/.test(l))).toHaveLength(4);
    expect(lines.filter((l) => /owes their \$9 \(canceled late, fee not waived\)/.test(l))).toHaveLength(5);
    expect(health(w)).toEqual({});
  });

  it('9. a player who has not paid owes only the lower price, and pays it the usual ways', async () => {
    const { w } = await feeKept(6);
    expect(await owes(w, 'Blair')).toBe(900);
    // I paid records $9, Mark paid confirms it: no credit back (they paid exactly the split price).
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, selfPaid: true });
    await markPaid(w, 'Blair');
    expect(await pot(w, 'Blair')).toBe(0);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, selfPaid: false });
    expect(health(w)).toEqual({});
  });

  it('the organizer not signed up: N counts only who is in (5 others -> $11)', async () => {
    const w = await world();
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    for (const p of OTHERS) expect(await pot(w, p)).toBe(300);
    expect((await sess(w)).court).toMatchObject({ playersCoverCents: 5500, yourShareCents: 0 });
  });

  it('12. Money for that month: court $48 charged, collected at the new price, no negative "you cover", credits match', async () => {
    const { w, others } = await feeKept(6);
    await markPaid(w, 'Blair');
    const m = await month(w);
    const g = m.sessions.find((x: any) => x.id === w.sid);
    expect(g).toMatchObject({ state: 'canceled', charged: true, courtCostCents: 4800, collectedCents: 4500 });
    expect(m.courtCostCents).toBe(4800);
    expect(m.collectedCents).toBe(4500);
    expect(m.netCents).toBe(-300);
    expect(m.coveredCents).toBe(300);
    expect(m.surplusCents).toBe(0);
    expect(m.bottomLine).toBe('You covered $3 of the court costs');
    // Credits owed = the players' credit (4 paid players x $5; Blair paid exactly $9).
    let pots = 0;
    for (const p of others) pots += await pot(w, p);
    expect(pots).toBe(2000);
    expect(m.creditsOwedCents).toBe(pots);
    expect((await sess(w)).court.yourShareCents).toBeGreaterThanOrEqual(0);
  });
});

// ---------- cases 8, 10, 11, 13 ----------

describe('cases 8, 10, 11, 13: unchanged', () => {
  it('8. 6 in, the venue waived it: everything comes back as credit, nobody owes', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w);
    expect((await cancel(w, true)).status).toBe(200);
    for (const p of OTHERS) {
      expect(await pot(w, p)).toBe(1400);
      expect(await owes(w, p)).toBe(0);
    }
    expect((await sess(w)).feeSplit).toBeNull();
    expect(health(w)).toEqual({});
  });

  it('10. a waitlisted person never owes anything (and is not counted in N)', async () => {
    const w = await world({ maxPlayers: 6 });
    await alexIn(w);
    await join(w, [...OTHERS, 'Gale']);
    expect((await row(w, 'Gale')).status).toBe('waitlisted');
    await markPaid(w, 'Casey');
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await owes(w, 'Gale')).toBe(0);
    expect(await pot(w, 'Gale')).toBe(0);
    expect((await sess(w)).feeSplit).toEqual({ count: 6, priceCents: 900 });
    expect(await pot(w, 'Casey')).toBe(500);
  });

  it('11. late drops, then subs take the spots: the oldest debt clears, and the cancel prices the people in', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w, 6);
    await drop(w, 'Blair'); // 5 left: free
    await drop(w, 'Casey'); // 4 left: free
    await drop(w, 'Devon'); // 3 left: owes $14 (paid, so it stays on the game)
    expect((await row(w, 'Devon')).lateFee).toMatchObject({ kind: 'late_drop', paid: true });
    expect(await pot(w, 'Blair')).toBe(1400);
    await join(w, ['Gale']); // the sub: Devon's $14 comes back as credit
    expect(await pot(w, 'Devon')).toBe(1400);
    expect((await row(w, 'Devon')).lateFee).toBeNull();
    await join(w, ['Harper']); // 5 in now
    await markPaid(w, 'Gale');
    late(w, 4);
    expect((await cancel(w, false)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 5, priceCents: 1100 });
    expect(await owes(w, 'Harper')).toBe(1100);
    expect(await pot(w, 'Gale')).toBe(300);
    for (const p of ['Emery', 'Frankie']) expect(await pot(w, p)).toBe(300);
    // The droppers owe nothing and keep their $14 credit.
    for (const p of ['Blair', 'Casey', 'Devon']) {
      expect(await owes(w, p)).toBe(0);
      expect(await pot(w, p)).toBe(1400);
    }
    expect(health(w)).toEqual({});
  });

  it('11b. a late-drop debt still open stays $14 (not split): 4 in, 1 leaves, 2 more join, then the cancel', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, ['Blair', 'Casey', 'Devon']);
    late(w, 6);
    await drop(w, 'Blair'); // 3 left: Blair owes $14 (unpaid)
    await join(w, ['Gale']); // clears Blair
    expect(await owes(w, 'Blair')).toBe(0);
    await join(w, ['Harper']); // 5 in
    late(w, 4);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(0);
    for (const p of ['Casey', 'Devon', 'Gale', 'Harper']) expect(await owes(w, p)).toBe(1100);
  });

  it('4 in, fee kept: everyone owes $14, nothing moves (unchanged)', async () => {
    const { w, others } = await feeKept(4);
    expect(await owes(w, 'Blair')).toBe(1400);
    for (const p of others.slice(1)) expect(await pot(w, p)).toBe(0);
    expect((await sess(w)).feeSplit).toBeNull();
    expect((await sess(w)).court).toMatchObject({ playersCoverCents: 4200, yourShareCents: 600 });
  });

  for (const [label, opts] of [
    ['13. switch off (Settings off)', { split: 'off' as Mode }],
    ['13. kill switch LATE_FEE_SPLIT = "off" beats Settings', { split: 'settings' as Mode, env: { LATE_FEE_SPLIT: 'off' } }],
  ] as const) {
    it(`${label}: 6 in, fee kept is a flat $14 exactly as today`, async () => {
      const { w, others } = await feeKept(6, opts);
      expect(await owes(w, 'Blair')).toBe(1400);
      for (const p of others.slice(1)) {
        expect(await pot(w, p)).toBe(0);
        expect(await row(w, p)).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
      }
      const s = await sess(w);
      expect(s.feeSplit).toBeNull();
      expect(s.court).toMatchObject({ costCents: 4800, playersCoverCents: 7000, yourShareCents: 0 });
      expect(audits(w, 'session_canceled')[0].split).toBeUndefined();
      expect((raw(w).prepare('SELECT final_price_cents, final_played_count FROM sessions WHERE id = ?').get(w.sid) as any)).toEqual({ final_price_cents: null, final_played_count: null });
      expect(health(w)).toEqual({});
    });
  }

  it('13. needs late fees: split on with LATE_FEES off asks the old question and cancels with credit', async () => {
    const w = await world({ lateFees: false });
    await alexIn(w);
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w);
    const r = await admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'cancel', confirm: true });
    expect(r.status, r.text).toBe(200);
    for (const p of OTHERS) expect(await pot(w, p)).toBe(1400);
    expect((await sess(w)).feeSplit).toBeNull();
  });
});

// ---------- credit and debts: no double credit, no lost money ----------

describe('credit and debts after a split', () => {
  it('a seat paid with credit: $5 back, Clear later gives back exactly the $9 left (no double credit)', async () => {
    const w = await world();
    givePot(w, 'Blair', 1400);
    await alexIn(w);
    await join(w, OTHERS);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
    expect(await pot(w, 'Blair')).toBe(0);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(500);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, lateFee: { kind: 'canceled_late' } });
    expect(await owes(w, 'Blair')).toBe(0);
    expect(health(w)).toEqual({});
    // Clear (venue waived after all): the $9 still on the game comes back. Total back = $14, never more.
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect(ledgerTotal(w, 'Blair')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('a seat paid in cash: Clear gives back the $9, so $5 + $9 = $14 in all', async () => {
    const { w } = await feeKept(6);
    expect(await pot(w, 'Casey')).toBe(500);
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'choice' })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(1400);
    // A second Clear tap changes nothing.
    await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Casey, why: 'choice' });
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(health(w)).toEqual({});
  });

  it('part credit ($3 used, owed $11): the split leaves $6 to pay, nothing comes back', async () => {
    const w = await world();
    givePot(w, 'Blair', 300);
    await alexIn(w);
    await join(w, OTHERS);
    expect(await owes(w, 'Blair')).toBe(1100);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(600);
    expect(await pot(w, 'Blair')).toBe(0);
    // Mark paid records $9 in all ($3 credit + $6 cash).
    await markPaid(w, 'Blair');
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(health(w)).toEqual({});
  });

  it('credit on an unpaid seat above the split price ($11 used, owed $3): $2 back, seat paid with $9 credit', async () => {
    const w = await world();
    givePot(w, 'Blair', 1100);
    await alexIn(w);
    await join(w, OTHERS);
    expect(await owes(w, 'Blair')).toBe(300);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await owes(w, 'Blair')).toBe(0);
    expect(await pot(w, 'Blair')).toBe(200);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(ledgerTotal(w, 'Blair')).toBe(200 - 900 + 900); // pot 2 = 11 kept - 9 used
    expect(health(w)).toEqual({});
    // Clear: $9 back, $11 in all (what they put in).
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1100);
  });

  it('Use credit on a split debt takes only the split price', async () => {
    const { w } = await feeKept(6);
    givePot(w, 'Blair', 2000);
    const r = await call(w, 'Blair', 'POST', `/api/sessions/${w.sid}/use-credit`, {});
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ usedCents: 900, paid: true });
    expect(await pot(w, 'Blair')).toBe(1100);
    expect(await row(w, 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900 });
    expect(health(w)).toEqual({});
  });

  it('an I paid not confirmed at the cancel waits; Mark paid then brings it to $9 with $5 back (once)', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    expect((await call(w, 'Devon', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect(await pot(w, 'Devon')).toBe(0);
    expect(await row(w, 'Devon')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, selfPaid: true });
    await markPaid(w, 'Devon');
    expect(await pot(w, 'Devon')).toBe(500);
    expect(await row(w, 'Devon')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, selfPaid: false });
    await markPaid(w, 'Devon');
    expect(await pot(w, 'Devon')).toBe(500);
    expect(health(w)).toEqual({});
  });

  it('an I paid not confirmed, answered "didn\'t pay" (Unmark): they owe $9', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    expect((await call(w, 'Devon', 'POST', `/api/sessions/${w.sid}/paid`, { paid: true })).status).toBe(200);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    await markPaid(w, 'Devon', false);
    expect(await owes(w, 'Devon')).toBe(900);
    expect(await pot(w, 'Devon')).toBe(0);
  });

  it('Unmark a split seat paid in cash: owes $9 again, the $5 credit they got stays theirs', async () => {
    const { w } = await feeKept(6);
    await markPaid(w, 'Casey', false);
    expect(await owes(w, 'Casey')).toBe(900);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(health(w)).toEqual({});
  });

  it('a second cancel tap moves nothing more', async () => {
    const { w } = await feeKept(6);
    expect((await cancel(w, false)).status).toBe(200);
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    for (const p of ['Casey', 'Devon', 'Emery', 'Frankie']) expect(await pot(w, p)).toBe(500);
    expect(await owes(w, 'Blair')).toBe(900);
    expect(health(w)).toEqual({});
  });

  it('a payment landing between the read and the cancel: the cancel refuses, nothing moves', async () => {
    const w = await world();
    await alexIn(w);
    await join(w, OTHERS);
    for (const p of OTHERS) await markPaid(w, p);
    late(w);
    // Pause the cancel's batch, and pay in between: the money check fails, the game stays on.
    const db = w.app.db as any;
    const realBatch = db.batch.bind(db);
    let once = false;
    db.batch = async (stmts: any[]) => {
      if (!once && stmts.length > 5) {
        once = true;
        raw(w).prepare("UPDATE session_players SET payment_amount_cents = 1300 WHERE player_id = ?").run(w.byName.Casey);
      }
      return realBatch(stmts);
    };
    const r = await cancel(w, false);
    db.batch = realBatch;
    expect(r.status).toBe(409);
    expect((await sess(w)).state.flags.canceled).toBe(false);
    for (const p of OTHERS) expect(await pot(w, p)).toBe(0);
  });

  it('Reopen a split game: a normal $14 game again, the $5 credit covers the $5 left', async () => {
    const { w } = await feeKept(6);
    const r = await admin(w, 'POST', `/api/admin/sessions/${w.sid}/decision`, { decision: 'reopen' });
    expect(r.status, r.text).toBe(200);
    const s = await sess(w);
    expect(s.state.flags.canceled).toBe(false);
    expect(s.feeSplit).toBeNull();
    expect((raw(w).prepare('SELECT final_price_cents, final_played_count FROM sessions WHERE id = ?').get(w.sid) as any)).toEqual({ final_price_cents: null, final_played_count: null });
    expect(await owes(w, 'Casey')).toBe(500);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(await owes(w, 'Blair')).toBe(1400);
    const u = await call(w, 'Casey', 'POST', `/api/sessions/${w.sid}/use-credit`, {});
    expect(u.status, u.text).toBe(200);
    expect(await owes(w, 'Casey')).toBe(0);
    expect(await pot(w, 'Casey')).toBe(0);
    expect(await row(w, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect(health(w)).toEqual({});
    // Played after all, 6 of them: Finalize gives $5 back again, as for any played game.
    w.app.now = Date.parse(s.endsAt) + HOUR;
    expect((await admin(w, 'POST', `/api/admin/sessions/${w.sid}/finalize`, { everyone: true })).status).toBe(200);
    expect(await pot(w, 'Casey')).toBe(500);
    expect(health(w)).toEqual({});
  });
});

// ---------- the switch and the text ----------

describe('the switch and the Heads up text', () => {
  it('private header for one phone only, Settings for everyone, History lines, organizer only', async () => {
    const w = await world({ split: 'off' });
    expect((await dash(w)).lateFeeSplit).toBe(false);
    expect((await w.organizer.call('GET', '/api/admin/dashboard', undefined, { [LATE_FEE_SPLIT_HEADER]: 'on' })).data.lateFeeSplit).toBe(true);
    expect((await admin(w, 'PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
    const d = await dash(w);
    expect(d.lateFeeSplitForAll).toBe(true);
    expect(audits(w, 'late_fee_split_on')).toHaveLength(1);
    const b = await phone(w, 'Blair');
    expect((await b.call('PUT', '/api/admin/late-fee-split', { on: false })).status).toBe(401);
    const k = await world({ env: { LATE_FEE_SPLIT: 'off' } });
    expect((await dash(k)).lateFeeSplit).toBe(false);
  });

  it('the private header splits that phone\'s cancel', async () => {
    const { w } = await feeKept(6, { split: 'header' });
    expect((await sess(w)).feeSplit).toEqual({ count: 6, priceCents: 900 });
  });

  it('the late-fees private header plus the split header works with both Settings rows off', async () => {
    const w = await world({ split: 'off', lateFees: false });
    w.headers[LATE_FEES_HEADER] = 'on';
    w.headers[LATE_FEE_SPLIT_HEADER] = 'on';
    await alexIn(w);
    await join(w, OTHERS);
    late(w);
    expect((await cancel(w, false)).status).toBe(200);
    expect((await sess(w)).feeSplit).toEqual({ count: 6, priceCents: 900 });
  });

  it('"your $9 share" in the Heads up text (old and round 2 wording), otherwise the same words', async () => {
    const { w } = await feeKept(6);
    const d = await dash(w);
    const s = d.sessions.find((x: any) => x.id === w.sid);
    const old = lateCancelText({ ...d, textsR2: false }, s, '')!;
    expect(old.body).toBe(
      `Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. If you were signed up, your $9 share still applies (if you already paid, you're all set). You can pay on the site: ${old.body.split('You can pay on the site: ')[1].split('. Sorry')[0]}. Sorry about that!`,
    );
    const r2 = lateCancelText({ ...d, textsR2: true }, s, '')!;
    expect(r2.body).toContain('your $9 share still applies');
    expect(r2.body).not.toContain('$14');
    // Switch off: $14 as before.
    const off = await feeKept(6, { split: 'off' });
    const d2 = await dash(off.w);
    const s2 = d2.sessions.find((x: any) => x.id === off.w.sid);
    expect(lateCancelText({ ...d2, textsR2: false }, s2, '')!.body).toContain('your $14 share still applies');
  });
});
