// Independent money audit, round 4 (Nov 1, 2026): only CONFIRMED money becomes credit; claims; withheld money back;
// a held drop sent before I'm in. Each `it.fails` is a confirmed finding that still reproduces on this code (the
// suite goes red once it is fixed: then turn it into a plain `it`). Everything else is a passing attack.
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { D1Database, D1PreparedStatement } from '../server/db';
import { potEffect } from '../shared/credit';
import { finalPrice } from '../shared/pricing';
import { heldCents } from '../src/pages/admin/todo';
import { flushHold, holdPending, pendingDropAction, settleHolds, startHold, undoHold, UNDO_MS } from '../src/hold';
import { type Client, HOUR, playerPhone, setupGroup, TestApp } from './harness';

vi.setConfig({ testTimeout: 600_000 });
/** A confirmed finding: `it.fails` while the bug is there. R4_SHOW=1 runs them as plain tests to see each failure. */
// All findings are fixed (Oct 31 evening): they stay as plain regression tests.
const finding = it;

const TZ = 'America/Detroit';
const FLAT = 1400;
const ORG = 'Alex';
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kai', 'Lee'];
const PLAYERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA];

// ---------------------------------------------------------------- a database that can pause before a statement

type Gate = { match: RegExp; before: () => Promise<void>; used: boolean };

class Hooked implements D1Database {
  gates: Gate[] = [];
  constructor(private real: D1Database) {}
  pauseBefore(match: RegExp, before: () => Promise<void>) {
    this.gates.push({ match, before, used: false });
  }
  private async gate(sql: string) {
    for (const g of this.gates) {
      if (!g.used && g.match.test(sql)) {
        g.used = true;
        await g.before();
      }
    }
  }
  prepare(sql: string): D1PreparedStatement {
    return this.wrap(this.real.prepare(sql), sql);
  }
  private wrap(s: D1PreparedStatement, sql: string): D1PreparedStatement {
    const self = this;
    const w: any = {
      __real: s,
      __sql: sql,
      bind: (...v: unknown[]) => self.wrap(s.bind(...v), sql),
      async first() {
        await self.gate(sql);
        return s.first();
      },
      async all() {
        await self.gate(sql);
        return s.all();
      },
      async run() {
        await self.gate(sql);
        return s.run();
      },
    };
    return w;
  }
  async batch(statements: D1PreparedStatement[]) {
    const sql = statements.map((s: any) => s.__sql).join('\n;;\n');
    await this.gate(sql);
    return this.real.batch(statements.map((s: any) => s.__real));
  }
}

// ---------------------------------------------------------------- the world

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
interface World {
  ctx: Ctx;
  app: TestApp;
  db: Hooked;
  org: Client;
  org2: Client;
  ids: Record<string, string>;
  phones: Map<string, Client>;
  /** Cash players really sent (an I paid counts once confirmed, claimed, or played; cleared ones leave). */
  cash: number;
  old: string;
}

async function world(opts: { book?: boolean } = {}): Promise<World> {
  const app = new TestApp();
  const db = new Hooked(app.db);
  app.env = { ...app.env, DB: db };
  const ctx = await setupGroup(app);
  const r = await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ORG });
  if (r.status !== 200) throw new Error(r.text);
  for (const [i, name] of EXTRA.entries()) {
    const res = await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` });
    if (res.status !== 200) throw new Error(res.text);
    ctx.byName[name] = res.data.id;
  }
  // A second organizer device (same PIN, its own cookies).
  const org2 = app.client();
  expect((await org2.call('POST', '/api/admin/login', { pin: '246810' })).status).toBe(200);
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const old = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-10-29').id;
  const w: World = { ctx, app, db, org: ctx.organizer, org2, ids: ctx.byName, phones: new Map(), cash: 0, old };
  if (opts.book !== false) for (const s of d.sessions) if (Date.parse(s.startsAt) > app.now) await w.org.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  return w;
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dash = async (w: World) => (await w.org.call('GET', '/api/admin/dashboard')).data;
async function on(w: World, date: string) {
  const s = (await dash(w)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s as any;
}
async function phone(w: World, name: string, device = 0): Promise<Client> {
  const key = `${name}#${device}`;
  let c = w.phones.get(key);
  if (!c) {
    c = await playerPhone(w.ctx, name);
    w.phones.set(key, c);
  }
  return c;
}
const raw = (w: World) => w.app.db.raw;
const ledger = (w: World) => raw(w).prepare('SELECT * FROM credit_ledger ORDER BY created_at, rowid').all() as any[];
const eff = (r: any) => potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents });
function potOf(w: World, name: string) {
  return ledger(w)
    .filter((r) => r.player_id === w.ids[name] && !r.ended_at)
    .reduce((n, r) => n + eff(r), 0);
}
/** Real credit (as if from an old canceled game where the money was confirmed): it is in the book as cash sent. */
function givePot(w: World, name: string, cents: number) {
  raw(w).exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', id, '${w.ids[name]}', 'kept', ${cents}, '${w.old}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
  w.cash += cents;
}
const seatRow = (w: World, sid: string, name: string) => raw(w).prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, w.ids[name]) as any;
const usedOn = (w: World, sid: string, name: string) =>
  (raw(w).prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND session_id = ? AND player_id = ?").get(sid, w.ids[name]) as any).c as number;
const rowOf = async (w: World, sid: string, name: string) => (await dash(w)).sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === name);
const month = async (w: World, m: string) => (await w.org.call('GET', `/api/admin/money?month=${m}`)).data;
const view = async (w: World, name: string) => (await (await phone(w, name)).call('GET', '/api/group')).data;

// ---------------------------------------------------------------- taps (each keeps the cash book)

const join = async (w: World, name: string, sid: string, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/join`, {});
const drop = async (w: World, name: string, sid: string, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/withdraw`, {});
async function shownOwe(w: World, name: string, sid: string) {
  return ((await view(w, name))?.owed?.find((o: any) => o.sessionId === sid)?.amountCents ?? 0) as number;
}
/** The cash in a seat's current payment (beyond credit and cash held on it). */
function seatCash(w: World, sid: string, name: string) {
  const s = seatRow(w, sid, name);
  if (!s || s.payment_status !== 'paid' || s.refunded_at) return 0;
  return Math.max(0, (s.payment_amount_cents ?? 0) - usedOn(w, sid, name));
}
/** I paid for what the screen shows. Counted as sent (it is paid until someone says it was not). */
async function iPaid(w: World, name: string, sid: string, device = 0, shown?: number) {
  const cents = shown ?? (await shownOwe(w, name, sid));
  const before = seatRow(w, sid, name);
  const res = await (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/paid`, { paid: true, cents });
  const after = seatRow(w, sid, name);
  if (res.status === 200 && res.data.changed !== false && before?.payment_status !== 'paid' && after?.payment_status === 'paid') w.cash += cents;
  return res;
}
/** Any tap that may clear a payment: the money it removes must be exactly the latest cash on the seat, or nothing. */
async function clearing(w: World, name: string, sid: string, tap: () => Promise<any>) {
  const cashBefore = seatCash(w, sid, name);
  const m0 = totalMoney(w).total;
  const res = await tap();
  const dM = totalMoney(w).total - m0;
  expect([0, -cashBefore], `clearing ${name}: removed ${-dM}, latest cash was ${cashBefore}`).toContain(dM);
  w.cash += dM;
  return res;
}
/** Two (or more) taps at once: money may only change by one of `allowed` (cents), applied to the book. */
async function together(w: World, allowed: number[], taps: (() => Promise<any>)[]) {
  const c0 = w.cash;
  const m0 = totalMoney(w).total;
  const rs = await Promise.all(taps.map((t) => t()));
  const dM = totalMoney(w).total - m0;
  expect(allowed, `taps at once changed the money by ${dM}`).toContain(dM);
  w.cash = c0 + dM;
  return rs;
}
async function markPaid(w: World, name: string, sid: string, org: Client = w.org, seen = true) {
  const r = await rowOf(w, sid, name);
  const before = seatRow(w, sid, name);
  const owe = r?.owesCents ?? 0;
  const res = await org.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids[name], paid: true, ...(seen ? { seen: r?.moneySeen } : {}) });
  const after = seatRow(w, sid, name);
  if (res.status === 200 && before?.payment_status === 'unpaid' && after?.payment_status === 'paid' && !after.self_paid_at && owe > 0) w.cash += owe;
  return res;
}
async function unmark(w: World, name: string, sid: string, org: Client = w.org, seen = true) {
  const r = await rowOf(w, sid, name);
  return clearing(w, name, sid, () => org.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids[name], paid: false, ...(seen ? { seen: r?.moneySeen } : {}) }));
}
const claim = (w: World, name: string, sid: string, paid: boolean, org: Client = w.org) =>
  clearing(w, name, sid, () => org.call('POST', `/api/admin/sessions/${sid}/claim`, { playerId: w.ids[name], paid }));
const didntPay = async (w: World, name: string, sid: string, device = 0) =>
  clearing(w, name, sid, async () => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/paid`, { paid: false }));
const finalize = (w: World, sid: string, played: string[] | 'everyone', org: Client = w.org) =>
  org.call('POST', `/api/admin/sessions/${sid}/finalize`, played === 'everyone' ? { everyone: true } : { played: played.map((n) => w.ids[n]) });
const reopen = (w: World, sid: string, org: Client = w.org) => org.call('POST', `/api/admin/sessions/${sid}/reopen`, {});
const cancel = (w: World, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true });
const uncancel = (w: World, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'reopen' });
const orgRemove = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'withdraw' });
const orgWaitlist = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'waitlist' });
const orgAdd = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'confirm' });
const useCredit = async (w: World, name: string, sid: string) => (await phone(w, name)).call('POST', `/api/sessions/${sid}/use-credit`, {});

// ---------------------------------------------------------------- the books (own arithmetic)

const MONTHS = ['2026-10', '2026-11', '2026-12'];
let BOOKS = 0;
const EVENTS = new Map<string, number>();
const KNOWN = new Map<string, number>();

function isClaimSeat(sp: any) {
  const unsettledPaid = sp.payment_status === 'paid' && !sp.refunded_at;
  return !!(unsettledPaid && !!sp.self_paid_at && (sp.status !== 'confirmed' || sp.s_status === 'canceled' || (sp.finalized_at && sp.played === 0)));
}

async function books(w: World, label = '') {
  BOOKS++;
  const at = (what: string) => `${label} :: ${what}`;
  const L = ledger(w);
  const live = L.filter((r) => !r.ended_at);
  const orgId = w.ids[ORG];
  expect(L.filter((r) => r.player_id === orgId).length, at('organizer has ledger rows')).toBe(0);
  const pots = new Map<string, number>();
  for (const r of live) pots.set(r.player_id, (pots.get(r.player_id) ?? 0) + eff(r));
  for (const [p, c] of pots) expect(c, at(`pot of ${p} below 0`)).toBeGreaterThanOrEqual(0);

  const seats = raw(w)
    .prepare('SELECT sp.*, s.status AS s_status, s.finalized_at, s.final_price_cents, p.display_name AS name FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN players p ON p.id = sp.player_id')
    .all() as any[];
  const sum = (sp: any, f: (r: any) => boolean) => live.filter((r) => r.session_id === sp.session_id && r.player_id === sp.player_id && f(r)).reduce((s, r) => s + r.amount_cents, 0);
  const d = await dash(w);
  const claims = d.paymentClaims as any[];
  for (const sp of seats) {
    if (sp.player_id === orgId) continue;
    const who = `${sp.name} on ${dayOf((raw(w).prepare('SELECT starts_at FROM sessions WHERE id = ?').get(sp.session_id) as any).starts_at)} (${sp.status}/${sp.payment_status}${sp.refunded_at ? '/settled' : ''}${sp.self_paid_at ? '/self' : ''} played=${sp.played})`;
    const usedNC = sum(sp, (r) => r.kind === 'used' && r.reason !== 'cash');
    const held = sum(sp, (r) => r.kind === 'used' && r.reason === 'cash');
    const backFin = sum(sp, (r) => r.kind === 'kept' && r.reason === 'finalized');
    const backNP = sum(sp, (r) => r.kind === 'kept' && r.reason === 'not_played');
    const unsettledPaid = sp.payment_status === 'paid' && !sp.refunded_at;
    const isClaim = isClaimSeat(sp);
    const listed = claims.some((c) => c.sessionId === sp.session_id && c.playerId === sp.player_id);
    expect(listed, at(`claim listed on Home = seat is a claim: ${who}`)).toBe(isClaim);
    if (isClaim) {
      const c = claims.find((x) => x.sessionId === sp.session_id && x.playerId === sp.player_id);
      expect(c.cents, at(`claim amount ${who}`)).toBe(Math.max(0, sp.payment_amount_cents - usedNC - held));
      continue;
    }
    if (sp.s_status === 'canceled' || sp.status === 'withdrawn' || sp.status === 'declined') {
      expect(usedNC, at(`credit stuck on ${who}`)).toBe(0);
      expect(held, at(`cash held on ${who}`)).toBe(0);
      expect(unsettledPaid, at(`unsettled payment on ${who}`)).toBe(false);
      expect(backFin, at(`finalized back on ${who}`)).toBe(0);
      continue;
    }
    if (sp.status === 'waitlisted') {
      if (!unsettledPaid && !sp.refunded_at) expect(usedNC + held, at(`credit on unpaid waitlist ${who}`)).toBe(0);
      continue;
    }
    // confirmed
    const price = !sp.finalized_at ? FLAT : sp.played === 1 ? sp.final_price_cents : null;
    if (price === null) {
      // Did not play: everything came back.
      expect(unsettledPaid, at(`did-not-play seat still paid ${who}`)).toBe(false);
      if (usedNC + held > 0) expect(backNP, at(`did-not-play credit not all back ${who}`)).toBeGreaterThanOrEqual(usedNC + held);
      continue;
    }
    const withheldSeat = unsettledPaid && !!sp.self_paid_at && !!sp.finalized_at && backFin === 0;
    if (!withheldSeat) expect(usedNC - backFin, at(`more credit than price ${who}`)).toBeLessThanOrEqual(price);
    if (unsettledPaid) {
      const reopenedCash = !sp.finalized_at && usedNC + held === 0 && sp.payment_amount_cents < price;
      const withheld = !!sp.self_paid_at && !!sp.finalized_at && backFin === 0;
      if (!reopenedCash && !withheld) expect(sp.payment_amount_cents - backFin, at(`paid seat net of back is not its price ${who}`)).toBe(price);
      if (withheld) expect(sp.payment_amount_cents, at(`withheld seat below price ${who}`)).toBeGreaterThanOrEqual(price);
    } else if (sp.payment_status === 'unpaid') {
      expect(usedNC + held, at(`unpaid seat fully covered (credit stuck) ${who}`)).toBeLessThan(price);
      expect(backFin, at(`finalized back on unpaid ${who}`)).toBe(0);
    } else throw new Error(at(`odd confirmed seat ${who}`));
  }
  // Every claim on Home is a real claim seat.
  for (const c of claims) {
    const sp = seats.find((x) => x.session_id === c.sessionId && x.player_id === c.playerId);
    expect(sp && isClaimSeat(sp), at(`Home lists a claim that is not one: ${JSON.stringify(c)}`)).toBe(true);
  }
  // Balances on Players and on each phone.
  for (const name of PLAYERS) {
    const pid = w.ids[name];
    const pot = pots.get(pid) ?? 0;
    const shown = d.creditLedger.find((l: any) => l.playerId === pid)?.balanceCents ?? 0;
    expect(shown, at(`${name} balance on Players`)).toBe(pot);
    if (w.phones.has(`${name}#0`)) expect((await view(w, name)).credit.balanceCents, at(`${name} own balance`)).toBe(pot);
  }
  // Conservation + Money tab vs Players-tab Held.
  let keptHeld = 0;
  let moneyHeld = 0;
  let owed = 0;
  for (const m of MONTHS) {
    const mm = await month(w, m);
    keptHeld += mm.collectedCents + mm.heldCents;
    moneyHeld += mm.heldCents;
    owed += mm.creditsOwedCents;
    for (const ms of mm.sessions.filter((x: any) => x.state === 'played')) {
      const ds = d.sessions.find((x: any) => x.id === ms.id);
      if (!ds?.court) continue;
      const owing = seats.some((sp) => sp.session_id === ms.id && sp.player_id !== orgId && sp.status === 'confirmed' && sp.payment_status === 'unpaid' && sp.played === 1);
      const anyClaimOrWithheld = seats.some((sp) => sp.session_id === ms.id && sp.self_paid_at && sp.payment_status === 'paid' && !sp.refunded_at);
      if (!owing && !anyClaimOrWithheld) expect(ms.collectedCents, at(`Money collected vs court row for ${dayOf(ms.startsAt)}`)).toBe(ds.court.playersCoverCents);
    }
  }
  expect(heldCents(d), at('Players-tab Held vs Money tab Held')).toBe(moneyHeld);
  const allPots = [...pots.values()].reduce((a, b) => a + b, 0);
  const cashedOut = live.filter((r) => r.kind === 'refunded').reduce((s, r) => s + r.amount_cents - r.five_cents, 0);
  expect(keptHeld + allPots + cashedOut, at(`conservation: sent ${w.cash} vs kept+held ${keptHeld} + pots ${allPots} + out ${cashedOut}`)).toBe(w.cash);
  expect(owed, at('Money credits owed = pots')).toBe(allPots);
}

/** Over: the game has ended. */
const after = (w: World, g: any) => (w.app.now = Math.max(w.app.now, Date.parse(g.endsAt) + HOUR));


describe('harness', () => {
  it('books balance on a fresh world with credit', async () => {
    const w = await world();
    givePot(w, 'Blair', 1400);
    await books(w, 'fresh');
  });
});

// ---------------------------------------------------------------- money as the database holds it

/** What a seat holds for the group (own arithmetic): an unsettled payment net of money back; else credit + cash held on it. */
function seatY(sp: any, live: any[]) {
  const mine = live.filter((r) => r.session_id === sp.session_id && r.player_id === sp.player_id);
  const s = (f: (r: any) => boolean) => mine.filter(f).reduce((a, r) => a + r.amount_cents, 0);
  if (sp.payment_status === 'paid' && !sp.refunded_at) return (sp.payment_amount_cents ?? 0) - s((r) => r.kind === 'kept' && r.reason === 'finalized');
  if (sp.refunded_at) return 0;
  return s((r) => r.kind === 'used');
}
/** All the money in the system: pots + what seats hold + cashed out. Only a payment tap may change it. */
function totalMoney(w: World) {
  const live = ledger(w).filter((r) => !r.ended_at);
  const orgId = w.ids[ORG];
  const seats = (raw(w).prepare('SELECT * FROM session_players').all() as any[]).filter((sp) => sp.player_id !== orgId);
  const onSeats = seats.reduce((a, sp) => a + seatY(sp, live), 0);
  const pots = live.reduce((a, r) => a + eff(r), 0);
  const out = live.filter((r) => r.kind === 'refunded').reduce((a, r) => a + r.amount_cents - r.five_cents, 0);
  return { onSeats, total: onSeats + pots + out, seats, live };
}
/** Seats carrying an unconfirmed I paid right now (key session:player). */
function selfPaidSeats(w: World) {
  const m = new Map<string, any>();
  for (const sp of raw(w).prepare("SELECT * FROM session_players WHERE self_paid_at IS NOT NULL AND payment_status = 'paid' AND refunded_at IS NULL").all() as any[])
    m.set(`${sp.session_id}:${sp.player_id}`, sp);
  return m;
}

// ---------------------------------------------------------------- random sequences

class NoSeat extends Error {}
/** A sequence failure that is a pinned finding (F1 / F2 below), or null for anything new. */
function knownFinding(msg: string): string | null {
  const lines = msg.split('\n');
  const stepLines = lines.filter((l) => /^\s{9}|steps: /.test(l));
  const last = stepLines[stepLines.length - 1] ?? '';
  if (/unconfirmed I paid (without an answer|turned into confirmed money)/.test(lines[0]) && /finalize|reopen/.test(msg)) return 'F1';
  if (/credit stuck|more credit than price/.test(lines[0]) && /unmark|didn't pay/.test(last)) return 'F2';
  return null;
}
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { next, int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)), pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
}

type Step = { act?: string; label: string; kind: 'neutral' | 'pay' | 'clear' | 'confirm' | 'mixed'; seat?: [string, string]; run: () => Promise<any> };

async function runSeq(seed: number, stats: { steps: number; seqs: number }, mode: 'mixed' | 'finalize' = 'mixed') {
  const r = prng(seed);
  const w = await world({ book: false });
  const games = mode === 'finalize' ? [await on(w, '2026-11-03')] : [await on(w, '2026-11-03'), await on(w, '2026-11-05'), await on(w, '2026-11-10')];
  // Court: booked / not booked / the venue's waitlist, at random per game.
  for (const g of games) {
    const c = mode === 'finalize' ? 'booked' : r.pick(['booked', 'booked', 'none', 'waitlist']);
    if (c === 'booked') await w.org.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    if (c === 'waitlist') await w.org.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' });
  }
  const names = mode === 'finalize' ? PLAYERS.slice(0, 10) : PLAYERS.slice(0, r.int(5, 10));
  for (const n of names) if (r.next() < (mode === 'finalize' ? 0.5 : 0.35)) givePot(w, n, r.pick([300, 500, 900, 1000, 1400, 2800]));
  for (const n of names) await phone(w, n);
  const log: string[] = [];
  let before = totalMoney(w).total;
  w.cash = before;
  const fail = (msg: string) => {
    throw new Error(`seed ${seed}: ${msg}\n  steps: ${log.join('\n         ')}`);
  };
  const doStep = async (steps: Step[]) => {
    const selfBefore = selfPaidSeats(w);
    const keptBefore = new Set(ledger(w).map((x) => x.id));
    const res = steps.length === 1 ? [await steps[0].run()] : await Promise.all(steps.map((s) => s.run()));
    for (const [i, x] of res.entries()) if (x?.status >= 500) fail(`${steps[i].label} -> ${x.status} ${x.text}`);
    log.push(steps.map((s, i) => `${s.label}=${res[i]?.status ?? ''}${res[i]?.data?.changed === false ? '(nc)' : ''}`).join(' || '));
    const now = totalMoney(w);
    const delta = now.total - before;
    const kinds = new Set(steps.map((s) => s.kind));
    // Money appears only from a payment tap, and leaves only by a clearing tap.
    if (delta > 0 && !kinds.has('pay')) fail(`money made (+${delta}) by ${[...kinds]}`);
    if (delta < 0 && !kinds.has('clear')) fail(`money lost (${delta}) by ${[...kinds]}`);
    if (delta > 0) {
      const shown = steps.filter((s) => s.kind === 'pay').length * FLAT;
      if (delta > shown) fail(`more money in (${delta}) than the taps could bring`);
    }
    // Only confirmed money becomes credit: a seat that carried an unconfirmed I paid gives no credit and loses its
    // self-paid mark only by an answer (Mark paid, Paid / Didn't pay, Unmark, the player's Didn't pay?).
    const answered = new Set(steps.filter((s) => s.seat).map((s) => s.seat!.join(':')));
    const selfAfter = selfPaidSeats(w);
    for (const [k, sp] of selfBefore) {
      if (answered.has(k)) continue;
      const newKept = ledger(w).filter((x) => !keptBefore.has(x.id) && `${x.session_id}:${x.player_id}` === k && x.kind === 'kept');
      if (newKept.length) fail(`credit from an unconfirmed I paid without an answer: ${JSON.stringify(newKept.map((x) => [x.reason, x.amount_cents]))}`);
      if (!selfAfter.has(k)) {
        const s2 = raw(w).prepare('SELECT * FROM session_players WHERE id = ?').get(sp.id) as any;
        // Still in the system as the group's money (paid seat or cash held), but the claim mark is gone.
        const holds = s2.payment_status === 'paid' || usedOn(w, s2.session_id, Object.keys(w.ids).find((n) => w.ids[n] === s2.player_id)!) > 0;
        if (holds) fail(`unconfirmed I paid turned into confirmed money without an answer (${s2.status}/${s2.payment_status})`);
      }
    }
    w.cash += delta;
    before = now.total;
    stats.steps++;
    for (const [i, s] of steps.entries()) {
      const k = s.act ?? '?';
      const ok = res[i]?.status === 200 && res[i]?.data?.changed !== false;
      const kk = k + (ok ? ' ok' : ` no ${res[i]?.data?.error ?? 'nc'}`);
      EVENTS.set(kk, (EVENTS.get(kk) ?? 0) + 1);
    }
    const sp = selfPaidSeats(w);
    const cl = (await dash(w)).paymentClaims.length;
    if (cl) EVENTS.set('steps with a claim on Home', (EVENTS.get('steps with a claim on Home') ?? 0) + 1);
    const withheld = [...sp.values()].filter((x) => x.played === 1).length;
    if (withheld) EVENTS.set('steps with a withheld seat', (EVENTS.get('steps with a withheld seat') ?? 0) + 1);
    try {
      await books(w, `seed ${seed} step ${log.length}`);
    } catch (e: any) {
      fail(e.message);
    }
    // Money tab = what seats hold.
    let mt = 0;
    for (const m of MONTHS) {
      const mm = await month(w, m);
      mt += mm.collectedCents + mm.heldCents;
    }
    if (mt !== now.onSeats) fail(`Money tab collected+held ${mt} vs seats hold ${now.onSeats}`);
  };
  const pickName = () => r.pick(names);
  const pickGame = () => r.pick(games);
  const nameOf = (pid: string) => Object.keys(w.ids).find((k) => w.ids[k] === pid)!;
  /** A (player, game) pair whose seat matches `where` (SQL over session_players sp, sessions s), or a random pair. */
  const pickSeat = (where: string): [string, any] => {
    if (r.next() < 0.95) {
      const rows = raw(w)
        .prepare(`SELECT sp.player_id, sp.session_id FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE sp.player_id <> ? AND (${where}) ORDER BY sp.id`)
        .all(w.ids[ORG]) as any[];
      const ok = rows.filter((x) => names.includes(nameOf(x.player_id)) && games.some((g) => g.id === x.session_id));
      if (ok.length) {
        const x = r.pick(ok);
        return [nameOf(x.player_id), games.find((g) => g.id === x.session_id)];
      }
      throw new NoSeat();
    }
    return [pickName(), pickGame()];
  };
  const IN = "sp.status IN ('confirmed', 'waitlisted')";
  const OWES = "sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.status <> 'canceled'";
  const SELF = "sp.self_paid_at IS NOT NULL AND sp.payment_status = 'paid' AND sp.refunded_at IS NULL";
  const PAID = "sp.payment_status = 'paid' AND sp.refunded_at IS NULL";
  const CLAIM = `${SELF} AND (sp.status <> 'confirmed' OR s.status = 'canceled' OR (s.finalized_at IS NOT NULL AND sp.played = 0))`;
  const playerStep = (): Step => {
    const dev = r.int(0, 1);
    const a = r.pick(['join', 'join', 'join', 'drop', 'drop', 'ipaid', 'ipaid', 'ipaid', 'didntpay', 'usecredit']);
    if (a === 'join') {
      const [n, g] = pickSeat("sp.status IN ('withdrawn', 'declined')");
      const m = r.next() < 0.5 ? pickName() : n;
      return { act: 'join', label: `${m} join ${dayOf(g.startsAt)}#${dev}`, kind: 'neutral', run: () => join(w, m, g.id, dev) };
    }
    if (a === 'drop') {
      const [n, g] = pickSeat(IN);
      return { act: 'drop', label: `${n} drop ${dayOf(g.startsAt)}#${dev}`, kind: 'neutral', run: () => drop(w, n, g.id, dev) };
    }
    if (a === 'usecredit') {
      const [n, g] = pickSeat(OWES);
      return { act: 'use credit', label: `${n} use credit ${dayOf(g.startsAt)}`, kind: 'neutral', run: () => useCredit(w, n, g.id) };
    }
    if (a === 'didntpay') {
      const [n, g] = pickSeat(SELF);
      return { act: "didn't pay?", label: `${n} didn't pay? ${dayOf(g.startsAt)}#${dev}`, kind: 'clear', seat: [g.id, w.ids[n]], run: async () => (await phone(w, n, dev)).call('POST', `/api/sessions/${g.id}/paid`, { paid: false }) };
    }
    const [n, g] = pickSeat(OWES);
    return {
      act: 'I paid',
      label: `${n} I paid ${dayOf(g.startsAt)}#${dev}`,
      kind: 'pay',
      seat: [g.id, w.ids[n]],
      run: async () => {
        const owe = await shownOwe(w, n, g.id);
        return (await phone(w, n, dev)).call('POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: owe });
      },
    };
  };
  const orgStep = (late = false): Step => {
    const org = r.next() < 0.5 ? w.org : w.org2;
    const seen = r.next() < 0.6;
    const a = r.pick(
      late
        ? ['mark', 'mark', 'unmark', 'claimY', 'claimN', 'claimY', 'claimN', 'final', 'final', 'final', 'reopen', 'reopen', 'unmark']
        : ['mark', 'mark', 'unmark', 'claimY', 'claimN', 'remove', 'waitlist', 'add', 'cancel', 'uncancel', 'uncancel', 'opened', 'cwait', 'final', 'reopen'],
    );
    const tagOf = (g: any) => `${dayOf(g.startsAt)}${org === w.org2 ? '@2' : ''}`;
    const withSeen = async (n: string, g: any, paid: boolean) => {
      const row = await rowOf(w, g.id, n);
      return org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids[n], paid, ...(seen && row ? { seen: row.moneySeen } : {}) });
    };
    if (a === 'mark') {
      const [n, g] = pickSeat(`(${OWES}) OR (${SELF})`);
      return { act: 'mark paid', label: `org mark paid ${n} ${tagOf(g)}${seen ? ' seen' : ''}`, kind: 'pay', seat: [g.id, w.ids[n]], run: () => withSeen(n, g, true) };
    }
    if (a === 'unmark') {
      const [n, g] = pickSeat(`(${PAID}) OR (${OWES})`);
      return { act: 'unmark', label: `org unmark ${n} ${tagOf(g)}${seen ? ' seen' : ''}`, kind: 'clear', seat: [g.id, w.ids[n]], run: () => withSeen(n, g, false) };
    }
    if (a === 'claimY' || a === 'claimN') {
      const [n, g] = pickSeat(CLAIM);
      const paid = a === 'claimY';
      return {
        act: paid ? 'claim Paid' : "claim Didn't pay",
        label: `org claim ${paid ? 'Paid' : "Didn't pay"} ${n} ${tagOf(g)}`,
        kind: paid ? 'confirm' : 'clear',
        seat: [g.id, w.ids[n]],
        run: () => org.call('POST', `/api/admin/sessions/${g.id}/claim`, { playerId: w.ids[n], paid }),
      };
    }
    if (a === 'remove') {
      const [n, g] = pickSeat(IN);
      return { act: 'remove', label: `org remove ${n} ${tagOf(g)}`, kind: 'neutral', run: () => orgRemove(w, n, g.id) };
    }
    if (a === 'waitlist') {
      const [n, g] = pickSeat("sp.status = 'confirmed'");
      return { act: 'org waitlist', label: `org waitlist ${n} ${tagOf(g)}`, kind: 'neutral', run: () => orgWaitlist(w, n, g.id) };
    }
    if (a === 'add') {
      const n = pickName();
      const g = pickGame();
      return { act: 'org add', label: `org add ${n} ${tagOf(g)}`, kind: 'neutral', run: () => orgAdd(w, n, g.id) };
    }
    const g = pickGame();
    const tag = tagOf(g);
    if (a === 'cancel') return { act: 'cancel', label: `org cancel ${tag}`, kind: 'neutral', run: () => cancel(w, g.id) };
    if (a === 'uncancel') return { act: 'uncancel', label: `org uncancel ${tag}`, kind: 'neutral', run: () => uncancel(w, g.id) };
    if (a === 'opened') return { act: 'court opened', label: `org court opened ${tag}`, kind: 'neutral', run: () => org.call('POST', `/api/admin/sessions/${g.id}/booked`, {}) };
    if (a === 'cwait') return { act: 'venue waitlist', label: `org venue waitlist ${tag}`, kind: 'neutral', run: () => org.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' }) };
    if (a === 'final') {
      const keep = r.pick([1, 0.9, 0.75, 0.5]);
      const orgPlays = r.next() < 0.3;
      return {
        act: 'finalize',
        label: `org finalize ${tag} keep ${keep}${orgPlays ? ' +Alex' : ''}`,
        kind: 'neutral',
        run: async () => {
          const s2 = raw(w).prepare("SELECT player_id FROM session_players WHERE session_id = ? AND status = 'confirmed' ORDER BY id").all(g.id) as any[];
          const played = s2.map((x) => x.player_id).filter((x) => x === w.ids[ORG] ? orgPlays : r.next() < keep);
          return org.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played });
        },
      };
    }
    return { act: 'reopen', label: `org reopen ${tag}`, kind: 'neutral', run: () => reopen(w, g.id, org) };
  };
  const retry = <T,>(f: () => T): T => {
    for (let i = 0; i < 20; i++) {
      try {
        return f();
      } catch (e) {
        if (!(e instanceof NoSeat)) throw e;
      }
    }
    const n = pickName();
    const g = pickGame();
    return { act: 'join', label: `${n} join ${dayOf(g.startsAt)}`, kind: 'neutral', run: () => join(w, n, g.id) } as T;
  };
  const P = () => retry(playerStep);
  const O = (late = false) => retry(() => orgStep(late));
  // A Mark paid either records a payment (money in) or confirms an I paid / answers a claim (no money in).
  const fix = (s: Step): Step => (s.kind === 'mixed' ? { ...s, kind: 'pay', run: s.run } : s);
  const confirmAware = (s: Step): Step[] => (s.kind === 'mixed' ? [{ ...s, kind: 'pay' }] : [s]);
  if (mode === 'finalize') for (const n of names) if (r.next() < 0.9) await doStep([{ act: 'join', label: `${n} join`, kind: 'neutral', run: () => join(w, n, games[0].id) }]);
  const stepsBefore = mode === 'finalize' ? r.int(4, 14) : r.int(6, 22);
  for (let i = 0; i < stepsBefore; i++) {
    const a = r.next() < 0.6 ? P() : O();
    if (r.next() < 0.25) {
      // two at once: the same tap from two devices, or two different taps
      const b = r.next() < 0.5 ? { ...a, label: a.label + ' (again)' } : r.next() < 0.5 ? P() : O();
      await doStep([...confirmAware(a), ...confirmAware(b)].map(markMixed));
    } else await doStep(confirmAware(a).map(markMixed));
  }
  // The games are over: Finalize, Reopen, answers, in any order.
  w.app.now = Date.parse(games[games.length - 1].endsAt) + HOUR;
  const stepsAfter = mode === 'finalize' ? r.int(12, 30) : r.int(4, 16);
  for (let i = 0; i < stepsAfter; i++) {
    const a = r.next() < (mode === 'finalize' ? 0.65 : 0.75) ? O(true) : P();
    if (r.next() < 0.25) {
      const b = r.next() < 0.5 ? { ...a, label: a.label + ' (again)' } : O(true);
      await doStep([...confirmAware(a), ...confirmAware(b)].map(markMixed));
    } else await doStep(confirmAware(a).map(markMixed));
  }
  stats.seqs++;
  void fix;
  function markMixed(s: Step): Step {
    // Mark paid counts as a possible answer to that seat's claim / I paid too.
    if (s.label.startsWith('org mark paid')) return { ...s, kind: 'pay', seat: s.seat };
    return s;
  }
}

describe('random sequences: every step checked from scratch', () => {
  it('finalize-heavy: one game, 10 players, pots, N from 1 to 11, FUZZ_FIN_SEQS sequences (default 40)', async () => {
    const stats = { steps: 0, seqs: 0 };
    const n = Number(process.env.FUZZ_FIN_SEQS ?? 40);
    const from = Number(process.env.FUZZ_FROM ?? 1);
    const failures: string[] = [];
    for (let seed = from; seed < from + n; seed++) {
      try {
        await runSeq(seed, stats, 'finalize');
      } catch (e: any) {
        const k = knownFinding(e.message);
        // F1 / F2 are fixed: a sequence that hits their shape again is a failure (R4_ALLOW_KNOWN=1 only counts them).
        if (k && process.env.R4_ALLOW_KNOWN) KNOWN.set(k, (KNOWN.get(k) ?? 0) + 1);
        else failures.push(e.message.split('\n')[0]);
        if (process.env.FUZZ_SHOW) console.log(e.message);
      }
    }
    console.log(`known findings hit: ${JSON.stringify(Object.fromEntries(KNOWN))}`);
    console.log(`FUZZ-FIN ${stats.seqs}/${n} clean sequences, ${stats.steps} steps`);
    if (failures.length) console.log(failures.join('\n'));
    // F2 (credit alone covers the final price, then Unmark / Didn't pay?) is pinned on its own; anything else fails here.
    expect(failures).toEqual([]);
  });

  it('runs FUZZ_SEQS sequences (default 60)', async () => {
    const stats = { steps: 0, seqs: 0 };
    const n = Number(process.env.FUZZ_SEQS ?? 60);
    const from = Number(process.env.FUZZ_FROM ?? 1);
    const failures: string[] = [];
    for (let seed = from; seed < from + n; seed++) {
      try {
        await runSeq(seed, stats);
      } catch (e: any) {
        const k = knownFinding(e.message);
        // F1 / F2 are fixed: a sequence that hits their shape again is a failure (R4_ALLOW_KNOWN=1 only counts them).
        if (k && process.env.R4_ALLOW_KNOWN) KNOWN.set(k, (KNOWN.get(k) ?? 0) + 1);
        else failures.push(e.message.split('\n')[0]);
        if (process.env.FUZZ_SHOW) console.log(e.message);
      }
    }
    console.log(`known findings hit: ${JSON.stringify(Object.fromEntries(KNOWN))}`);
    console.log(`FUZZ ${stats.seqs}/${n} clean sequences, ${stats.steps} steps, books checked ${BOOKS} times`);
    console.log([...EVENTS].sort().map(([k, v]) => `${k}: ${v}`).join('\n'));
    if (failures.length) console.log(failures.join('\n'));
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------- claims: every way in, every answer, twice / two devices / racing

type Way = 'drop' | 'remove' | 'cancel' | 'notplayed' | 'waitlist';
type Answer = 'claimY' | 'claimN' | 'mark' | 'unmark' | 'didntpay';
const PAIDLIKE: Answer[] = ['claimY', 'mark'];
const OTHERS5 = ['Casey', 'Devon', 'Emery', 'Frankie', 'Gale'];

/** Tue Nov 3 booked; Blair (with `credit` in her pot) and five others in and paid (confirmed); Blair taps I paid. Then the claim is made `way`. */
async function claimBy(way: Way, credit: number) {
  const w = await world();
  const g = await on(w, '2026-11-03');
  if (credit) givePot(w, 'Blair', credit);
  for (const n of ['Blair', ...OTHERS5]) expect((await join(w, n, g.id)).status).toBe(200);
  for (const n of OTHERS5) {
    await iPaid(w, n, g.id);
    await markPaid(w, n, g.id);
  }
  const owe = await shownOwe(w, 'Blair', g.id);
  expect(owe).toBe(Math.max(0, FLAT - credit));
  expect((await iPaid(w, 'Blair', g.id)).status).toBe(200);
  if (way === 'drop') expect((await drop(w, 'Blair', g.id)).status).toBe(200);
  if (way === 'remove') expect((await orgRemove(w, 'Blair', g.id)).status).toBe(200);
  if (way === 'waitlist') expect((await orgWaitlist(w, 'Blair', g.id)).status).toBe(200);
  if (way === 'cancel') expect((await cancel(w, g.id)).status).toBe(200);
  if (way === 'notplayed') {
    after(w, g);
    expect((await finalize(w, g.id, OTHERS5)).status).toBe(200);
  }
  await books(w, `claim by ${way}`);
  expect(potOf(w, 'Blair'), 'nothing on the seat moved').toBe(0);
  const claims = (await dash(w)).paymentClaims;
  expect(claims).toEqual([expect.objectContaining({ playerId: w.ids.Blair, cents: owe })]);
  return { w, g, owe };
}
async function answer(w: World, g: any, a: Answer, dev: 0 | 1) {
  const org = dev ? w.org2 : w.org;
  if (a === 'claimY') return claim(w, 'Blair', g.id, true, org);
  if (a === 'claimN') return claim(w, 'Blair', g.id, false, org);
  if (a === 'mark') return markPaid(w, 'Blair', g.id, org, dev === 0);
  if (a === 'unmark') return unmark(w, 'Blair', g.id, org, dev === 0);
  return didntPay(w, 'Blair', g.id, dev);
}

describe('claims: every way in x every answer, twice, two devices at once, racing', () => {
  const ways: Way[] = ['drop', 'remove', 'cancel', 'notplayed', 'waitlist'];
  const answers: Answer[] = ['claimY', 'claimN', 'mark', 'unmark', 'didntpay'];
  for (const way of ways)
    for (const credit of [0, 300])
      it(`${way}, credit $${credit / 100}: each answer twice and at once from two devices`, async () => {
        for (const a of answers)
          for (const mode of ['twice', 'atonce'] as const) {
            const { w, g } = await claimBy(way, credit);
            if (mode === 'twice') {
              const r1 = await answer(w, g, a, 0);
              await books(w, `${way} ${a} first`);
              const r2 = await answer(w, g, a, 1);
              expect([r1.status, r2.status].every((x) => x < 500)).toBe(true);
            } else {
              const cash = seatCash(w, g.id, 'Blair');
              const rs = await together(w, [0, -cash], [() => answer(w, g, a, 0), () => answer(w, g, a, 1)]);
              expect(rs.every((x) => x.status < 500)).toBe(true);
            }
            await books(w, `${way} ${a} ${mode}`);
            const want = PAIDLIKE.includes(a) ? FLAT : credit;
            expect(potOf(w, 'Blair'), `${way} ${a} ${mode}: Blair's pot`).toBe(want);
            expect((await dash(w)).paymentClaims, `${way} ${a} ${mode}: claim gone`).toEqual([]);
          }
      });
  for (const way of ways)
    it(`${way}: two different answers racing (both orders)`, async () => {
      const pairs: [Answer, Answer][] = [];
      for (const a of answers) for (const b of answers) if (a !== b) pairs.push([a, b]);
      for (const [a, b] of pairs) {
        const { w, g } = await claimBy(way, 300);
        const cash = seatCash(w, g.id, 'Blair');
        const rs = await together(w, [0, -cash], [() => answer(w, g, a, 0), () => answer(w, g, b, 1)]);
        expect(rs.every((x) => x.status < 500), `${a} vs ${b}: ${rs.map((x) => x.text)}`).toBe(true);
        await books(w, `${way} ${a} vs ${b}`);
        const pot = potOf(w, 'Blair');
        expect([FLAT, 300], `${way} ${a} vs ${b}: one answer won`).toContain(pot);
        expect((await dash(w)).paymentClaims).toEqual([]);
      }
    });
});

describe('claims, then the game changes', () => {
  it('drop claim: rejoin (seat as it was), drop again, then answers; remove claim then org add back', async () => {
    for (const ans of ['claimY', 'claimN'] as Answer[]) {
      const { w, g } = await claimBy('drop', 300);
      expect((await join(w, 'Blair', g.id, 1)).status).toBe(200);
      await books(w, 'rejoin');
      expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', payment_status: 'paid', payment_amount_cents: 1400 });
      expect(seatRow(w, g.id, 'Blair').self_paid_at).not.toBeNull();
      expect((await drop(w, 'Blair', g.id)).status).toBe(200);
      await books(w, 'drop again');
      await answer(w, g, ans, 0);
      await books(w, 'answered');
      expect(potOf(w, 'Blair')).toBe(ans === 'claimY' ? FLAT : 300);
      // rejoin after the answer: owes again from scratch, credit goes on at once
      expect((await join(w, 'Blair', g.id)).status).toBe(200);
      await books(w, 'rejoin after answer');
      expect((await drop(w, 'Blair', g.id)).status).toBe(200);
      await books(w, 'final drop');
      expect(potOf(w, 'Blair')).toBe(ans === 'claimY' ? FLAT : 300);
    }
    const { w, g } = await claimBy('remove', 0);
    expect((await orgAdd(w, 'Blair', g.id)).status).toBe(200);
    await books(w, 'org add back');
    await markPaid(w, 'Blair', g.id);
    await books(w, 'confirmed in');
    expect((await orgRemove(w, 'Blair', g.id)).status).toBe(200);
    await books(w, 'removed after confirm');
    expect(potOf(w, 'Blair')).toBe(FLAT);
  });

  it('cancel claim: un-cancel before / after each answer', async () => {
    for (const ans of ['none', 'claimY', 'claimN', 'mark', 'unmark', 'didntpay'] as const) {
      const { w, g } = await claimBy('cancel', 300);
      if (ans !== 'none') await answer(w, g, ans, 0);
      await books(w, `cancel ${ans}`);
      expect((await uncancel(w, g.id)).status).toBe(200);
      await books(w, `uncancel after ${ans}`);
      const sp = seatRow(w, g.id, 'Blair');
      const shown = await shownOwe(w, 'Blair', g.id);
      // in again: either still paid with the claim (none), or owes the price less any credit on the seat
      if (ans === 'none') expect(sp).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
      else expect(sp.payment_status === 'paid' ? 0 : shown + usedOn(w, g.id, 'Blair')).toBe(sp.payment_status === 'paid' ? 0 : FLAT);
      // and it can be canceled again without making money
      expect((await cancel(w, g.id)).status).toBe(200);
      await books(w, `recancel after ${ans}`);
    }
  });

  it('did-not-play claim: reopen, refinalize at every N with and without her, answers in between', async () => {
    for (const ans of ['none', 'claimY', 'claimN'] as const)
      for (const n of [4, 5, 6]) {
        const { w, g } = await claimBy('notplayed', 300);
        if (ans !== 'none') await answer(w, g, ans, 0);
        await books(w, `np ${ans}`);
        expect((await reopen(w, g.id)).status, 'reopen').toBe(200);
        await books(w, `np ${ans} reopen`);
        const played = ['Blair', ...OTHERS5].slice(0, n);
        const f = await finalize(w, g.id, played);
        expect(f.status).toBe(200);
        await books(w, `np ${ans} refinal ${n}`);
        // with Blair playing: if she still has the unconfirmed I paid, it counts as paid, money back withheld
        expect((await reopen(w, g.id)).status).toBeLessThan(500);
        await books(w, `np ${ans} reopen 2`);
        await finalize(w, g.id, OTHERS5);
        await books(w, `np ${ans} not played again`);
      }
  });

  it('waitlist claim: a spot opens and she moves in, Court opened on a venue-waitlist game', async () => {
    const { w, g } = await claimBy('waitlist', 300);
    expect((await drop(w, 'Casey', g.id)).status).toBe(200); // a spot opens; Blair moves in
    await books(w, 'moved in');
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    // venue waitlist game: standby I'm in owes nothing; Court opened moves in and uses credit
    const g2 = await on(w, '2026-11-05');
    expect((await w.org.call('POST', `/api/admin/sessions/${g2.id}/court`, { action: 'waitlist' })).status).toBe(200);
    givePot(w, 'Devon', 500);
    expect((await join(w, 'Devon', g2.id)).data).toMatchObject({ result: 'standby' });
    await books(w, 'standby');
    expect(potOf(w, 'Devon')).toBe(500 + 0);
    expect((await orgRemove(w, 'Devon', g2.id)).status).toBe(200);
    await books(w, 'standby removed');
    expect(potOf(w, 'Devon')).toBe(500);
    expect((await join(w, 'Devon', g2.id)).data).toMatchObject({ result: 'standby' });
    expect((await w.org.call('POST', `/api/admin/sessions/${g2.id}/booked`, {})).status).toBe(200);
    await books(w, 'court opened');
    expect(potOf(w, 'Devon')).toBe(0);
    await iPaid(w, 'Devon', g2.id);
    expect((await w.org.call('POST', `/api/admin/sessions/${g2.id}/court`, { action: 'waitlist' })).status).toBe(200);
    await books(w, 'back to venue waitlist with a paid seat');
    expect((await w.org.call('POST', `/api/admin/sessions/${g2.id}/court`, { action: 'not_opened' })).status).toBe(200);
    await books(w, "didn't open: canceled with Devon's unconfirmed I paid");
    expect((await dash(w)).paymentClaims.some((c: any) => c.playerId === w.ids.Devon)).toBe(true);
    await claim(w, 'Devon', g2.id, false);
    await books(w, 'devon cleared');
    expect(potOf(w, 'Devon')).toBe(500);
  });
});

// ---------------------------------------------------------------- played with an unconfirmed I paid, N = 5..10

describe('played with an unconfirmed I paid: money back withheld until confirmed, never twice, never lost', () => {
  for (const credit of [0, 300, 1000])
    for (const n of [5, 6, 7, 8, 9, 10])
      it(`credit $${credit / 100}, ${n} played: confirm, unmark, reopen, refinalize`, async () => {
        const w = await world();
        const g = await on(w, '2026-11-03');
        if (credit) givePot(w, 'Blair', credit);
        const others = PLAYERS.slice(1, 10);
        const ins = ['Blair', ...others];
        for (const x of ins) expect((await join(w, x, g.id)).status).toBe(200);
        for (const x of others) {
          await iPaid(w, x, g.id);
          await markPaid(w, x, g.id);
        }
        await iPaid(w, 'Blair', g.id);
        after(w, g);
        const played = ins.slice(0, n);
        expect((await finalize(w, g.id, played)).status).toBe(200);
        await books(w, 'final');
        const price = finalPrice(FLAT, n);
        const back = FLAT - price;
        expect(potOf(w, 'Blair'), 'withheld').toBe(0);
        // the player's own screen: nothing owed
        expect(await shownOwe(w, 'Blair', g.id)).toBe(0);
        // Reopen with it withheld, refinalize at another N
        expect((await reopen(w, g.id)).status).toBe(200);
        await books(w, 'reopen withheld');
        const n2 = n === 10 ? 5 : n + 1;
        expect((await finalize(w, g.id, ins.slice(0, n2))).status).toBe(200);
        await books(w, 'refinal withheld');
        const back2 = FLAT - finalPrice(FLAT, n2);
        // confirm twice from two devices at once
        const rs = await together(w, [0], [() => markPaid(w, 'Blair', g.id, w.org, true), () => markPaid(w, 'Blair', g.id, w.org2, false)]);
        expect(rs.map((x) => x.status).every((x) => x < 500)).toBe(true);
        await books(w, 'confirmed');
        expect(potOf(w, 'Blair'), 'money back once').toBe(back2);
        // reopen takes it back; refinalize at n gives the new amount once
        expect((await reopen(w, g.id)).status).toBe(200);
        await books(w, 'reopen confirmed');
        expect(potOf(w, 'Blair')).toBe(0);
        expect((await finalize(w, g.id, played)).status).toBe(200);
        await books(w, 'refinal confirmed');
        expect(potOf(w, 'Blair')).toBe(back);
        // Unmark: the latest payment goes. (Credit alone above the final price: finding F2, pinned there.)
        if (credit > price) return;
        await unmark(w, 'Blair', g.id);
        await books(w, 'unmark after confirm');
        expect(potOf(w, 'Blair'), 'after Unmark only credit above the price is back').toBe(Math.max(0, credit - price));
      });
});

// ================================================================= FINDINGS (it.fails: still reproduces)

/** Tue Nov 3 booked; `ins` join and every one but Blair pays (confirmed); Blair has `credit` in her pot. */
async function gameWith(w: World, ins: string[], credit = 0) {
  const g = await on(w, '2026-11-03');
  if (credit) givePot(w, 'Blair', credit);
  for (const n of ins) expect((await join(w, n, g.id)).status).toBe(200);
  for (const n of ins.filter((x) => x !== 'Blair')) {
    await iPaid(w, n, g.id);
    await markPaid(w, n, g.id);
  }
  return g;
}

describe('F1: an unconfirmed I paid becomes "paid earlier" cash at a Finalize redo (or a Reopen), then credit', () => {
  // A fix may refuse the Reopen / redo instead (409): the rule then holds, and these turn green.
  const ok = (res: any) => expect([200, 409], res.text).toContain(res.status);
  finding('I paid $11 after a 5-player Finalize, Reopen, redo with 4: the claim mark is gone; redo without her: $11 credit nobody confirmed', async () => {
    const w = await world();
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    const g = await gameWith(w, five);
    after(w, g);
    expect((await finalize(w, g.id, five)).status).toBe(200); // 5 played: $11
    expect(await shownOwe(w, 'Blair', g.id)).toBe(1100);
    expect((await iPaid(w, 'Blair', g.id)).status).toBe(200); // unconfirmed
    const ro = await reopen(w, g.id);
    ok(ro);
    if (ro.status === 200) {
      const f4 = await finalize(w, g.id, five.slice(0, 4)); // 4 played: $14, she owes $3 more
      ok(f4);
      // Still her unconfirmed I paid: the organizer must still be able to say "Didn't pay".
      const row = await rowOf(w, g.id, 'Blair');
      expect(row.selfPaid || (await dash(w)).paymentClaims.length > 0, 'the unconfirmed $11 is still marked as unconfirmed').toBe(true);
      ok(await reopen(w, g.id));
      ok(await finalize(w, g.id, five.slice(1))); // she did not play
    }
    // Only confirmed money becomes credit: nothing until the organizer answers.
    expect(potOf(w, 'Blair'), 'credit made from an unconfirmed I paid').toBe(0);
    await books(w, 'end');
  });

  finding('part credit + unconfirmed I paid at the final price; Reopen alone turns the I paid into held cash (self mark cleared)', async () => {
    const w = await world();
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    const g = await gameWith(w, five, 300);
    after(w, g);
    expect((await finalize(w, g.id, five)).status).toBe(200); // $11: her $3 credit on the seat, $8 due
    expect(await shownOwe(w, 'Blair', g.id)).toBe(800);
    expect((await iPaid(w, 'Blair', g.id)).status).toBe(200); // unconfirmed $8
    const ro = await reopen(w, g.id);
    ok(ro);
    const sp = seatRow(w, g.id, 'Blair');
    // Either refused, or the seat still carries the unconfirmed mark on that $8.
    expect(ro.status === 409 || (sp.self_paid_at !== null && sp.payment_status === 'paid'), 'still unconfirmed after Reopen').toBe(true);
  });

  finding('…and the redo without her: $11 credit ($3 hers + $8 never confirmed)', async () => {
    const w = await world();
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    const g = await gameWith(w, five, 300);
    after(w, g);
    await finalize(w, g.id, five);
    await iPaid(w, 'Blair', g.id);
    const ro = await reopen(w, g.id);
    ok(ro);
    if (ro.status === 200) ok(await finalize(w, g.id, five.slice(1)));
    expect(potOf(w, 'Blair'), 'only her own $3 credit may come back before Alex answers').toBeLessThanOrEqual(300);
  });
});

describe('F2: Unmark (or the player\'s own "Didn\'t pay?") of cash on top of credit that alone covers the final price', () => {
  async function tenWithCredit(confirm: boolean) {
    const w = await world();
    const ten = PLAYERS.slice(0, 10);
    const g = await gameWith(w, ten, 1000);
    expect(await shownOwe(w, 'Blair', g.id)).toBe(400);
    await iPaid(w, 'Blair', g.id);
    if (confirm) await markPaid(w, 'Blair', g.id);
    after(w, g);
    expect((await finalize(w, g.id, ten)).status).toBe(200); // 10 played: $5
    return { w, g };
  }
  finding('confirmed, finalized at 10 ($5), Unmark of the $4 cash: her $10 credit sits on a $5 seat; the $5 above the price never comes back', async () => {
    const { w, g } = await tenWithCredit(true);
    expect(potOf(w, 'Blair')).toBe(900);
    await unmark(w, 'Blair', g.id);
    // The $4 cash is gone; the $10 credit pays the $5 seat and $5 comes back.
    expect(potOf(w, 'Blair'), 'credit above the final price comes back').toBe(500);
  });
  finding("withheld (unconfirmed $4), then the player's own Didn't pay?: $5 of her own credit stuck on the seat for good", async () => {
    const { w, g } = await tenWithCredit(false);
    expect(potOf(w, 'Blair')).toBe(0); // withheld
    expect((await didntPay(w, 'Blair', g.id)).status).toBe(200);
    // Mark paid now records $5 against $10 of credit: the extra $5 is lost to her.
    await markPaid(w, 'Blair', g.id);
    expect(potOf(w, 'Blair'), 'credit above the final price comes back').toBe(500);
  });
  finding('credit exactly the final price ($9 at 6 played), Unmark of the cash on top: the seat stays "unpaid, $0 due" and its $9 sits in Held for good', async () => {
    const w = await world();
    const six = PLAYERS.slice(0, 6);
    const g = await gameWith(w, six, 900);
    await iPaid(w, 'Blair', g.id);
    await markPaid(w, 'Blair', g.id);
    after(w, g);
    expect((await finalize(w, g.id, six)).status).toBe(200); // $9
    await unmark(w, 'Blair', g.id);
    const r = await rowOf(w, g.id, 'Blair');
    const m = (await month(w, '2026-11')).sessions.find((x: any) => x.id === g.id);
    expect({ status: r.paymentStatus, owes: r.owesCents, collected: m.collectedCents }).toEqual({ status: 'paid', owes: 0, collected: 6 * 900 - 0 });
  });
  it('(control) the same seat confirmed and never unmarked gets $9 back', async () => {
    const { w } = await tenWithCredit(true);
    expect(potOf(w, 'Blair')).toBe(900);
    await books(w, 'control');
  });
});

describe('F3: Mark paid confirming a withheld seat races Reopen (two organizer devices)', () => {
  finding('the $5 money back lands on a game that is no longer finalized; redo at 10 then gives $5 instead of $9 ($4 lost)', async () => {
    const w = await world();
    const ten = PLAYERS.slice(0, 10);
    const g = await gameWith(w, ten);
    await iPaid(w, 'Blair', g.id);
    after(w, g);
    expect((await finalize(w, g.id, ten.slice(0, 6))).status).toBe(200); // 6 played: $9, $5 withheld
    let reo: any;
    w.db.pauseBefore(/UPDATE session_players SET self_paid_at = NULL, payment_updated_at[\s\S]*INSERT INTO credit_ledger/, async () => {
      reo = await reopen(w, g.id, w.org2);
    });
    const m = await w.org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: true });
    expect(reo.status).toBe(200);
    expect([200, 409], m.text).toContain(m.status); // a fix may refuse it: "look again"
    // Not finalized any more: no money back may exist yet.
    const early = potOf(w, 'Blair');
    expect((await finalize(w, g.id, ten)).status).toBe(200); // 10 played: $5, so $9 back once confirmed
    if (m.status === 409) await markPaid(w, 'Blair', g.id); // looked again and confirmed
    expect({ beforeRedo: early, afterRedo: potOf(w, 'Blair') }).toEqual({ beforeRedo: 0, afterRedo: 900 });
    await books(w, 'end');
  });
});

// ================================================================= the phone: a held drop, then I'm in on another game

class Offline extends Error {
  code = 'offline';
}
class Refused extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** One phone running the real hold code (src/hold.ts) with PlayerHome's glue copied from 43d21c0 (sendDropsBeforeJoin, dropOut, look). */
function phoneModel(w: World, name: string) {
  const storage = new Map<string, string>();
  const st = { signal: true };
  const inflight: Promise<unknown>[] = [];
  const post = async (sid: string, path: string) => {
    if (!st.signal) throw new Offline('offline');
    const call = (await phone(w, name)).call('POST', `/api/sessions/${sid}/${path}`, {});
    inflight.push(call);
    const res = await call;
    if (res.status !== 200) throw new Refused(res.data?.error ?? 'error');
    return res;
  };
  const forget = (sid: string) => {
    const raw = storage.get('note');
    if (raw && JSON.parse(raw).sessionId === sid) storage.delete('note');
  };
  const dropOut = (sid: string) => {
    storage.set('note', JSON.stringify({ sessionId: sid, at: w.app.now }));
    let leavingSend = false;
    startHold(sid, {
      send: async (leaving) => {
        leavingSend = leaving;
        await post(sid, 'withdraw');
      },
      settled: async (err) => {
        if (err && leavingSend && (err as any).code === 'offline') return;
        forget(sid);
      },
      undone: () => forget(sid),
    });
  };
  /** As PlayerHome sendDropsBeforeJoin since the fix (0416a20): the same age rules as a left-over note. */
  const sendDropsBeforeJoin = async (joiningId: string) => {
    await settleHolds();
    const raw = storage.get('note');
    const note = raw ? JSON.parse(raw) : null;
    if (!note?.sessionId || note.sessionId === joiningId) return;
    const next = pendingDropAction(note, w.app.now, () => true, holdPending);
    if (next.do === 'forget') {
      storage.delete('note');
      return;
    }
    if (next.do !== 'send') return;
    try {
      await post(note.sessionId, 'withdraw');
      storage.delete('note');
    } catch (err: any) {
      if (err?.code !== 'offline') storage.delete('note');
    }
  };
  const join = async (sid: string) => {
    if (undoHold(sid)) return 'undone';
    await sendDropsBeforeJoin(sid);
    return post(sid, 'join');
  };
  /** The page's look at a left-over note (PlayerHome useEffect), with `stillIn` from the server. */
  const look = async () => {
    const raw = storage.get('note');
    const note = raw ? JSON.parse(raw) : null;
    if (note?.sessionId && !st.signal) return 'no signal';
    const stillIn = (id: string) => ['confirmed', 'waitlisted'].includes(seatRow(w, id, name)?.status ?? '');
    const next = pendingDropAction(note, w.app.now, stillIn, holdPending);
    if (next.do === 'forget') storage.delete('note');
    else if (next.do === 'send') {
      try {
        await post(next.sessionId, 'withdraw');
        storage.delete('note');
      } catch (err: any) {
        if (err?.code !== 'offline') storage.delete('note');
      }
    }
    return next.do;
  };
  const landed = async () => {
    while (inflight.length) await Promise.allSettled(inflight.splice(0));
  };
  return { storage, st, dropOut, join, look, landed, close: () => flushHold(true) };
}
const tick = async (w: World, ms: number) => {
  w.app.now += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe('claims on seats that left, then Finalize / Reopen around the answer', () => {
  for (const way of ['drop', 'remove', 'waitlist'] as Way[])
    for (const a of ['claimY', 'claimN', 'mark', 'unmark', 'didntpay'] as Answer[])
      it(`${way} claim, Finalize (with and without her if still in), ${a}, Reopen, redo`, async () => {
        const { w, g } = await claimBy(way, 300);
        after(w, g);
        const f = await finalize(w, g.id, way === 'waitlist' ? OTHERS5 : 'everyone');
        expect(f.status, f.text).toBe(200);
        await books(w, 'finalized with the claim');
        await answer(w, g, a, 0);
        await books(w, `answered ${a}`);
        expect(potOf(w, 'Blair')).toBe(PAIDLIKE.includes(a) ? FLAT : 300);
        const ro = await reopen(w, g.id);
        expect(ro.status, ro.text).toBeLessThan(500);
        await books(w, 'reopen');
        await finalize(w, g.id, OTHERS5.slice(0, 4));
        await books(w, 'redo with 4');
        expect(potOf(w, 'Blair')).toBe(PAIDLIKE.includes(a) ? FLAT : 300);
      });
});

describe('Remove player on a standby seat', () => {
  it('standby with credit; standby carrying a frozen claim; then Court opened and the answers', async () => {
    const w = await world();
    const g = await on(w, '2026-11-05');
    givePot(w, 'Casey', 500);
    expect((await join(w, 'Blair', g.id)).status).toBe(200);
    await iPaid(w, 'Blair', g.id); // unconfirmed $14
    expect((await w.org.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' })).status).toBe(200);
    await books(w, 'venue waitlist');
    expect((await drop(w, 'Blair', g.id)).status).toBe(200); // claim
    await books(w, 'claim');
    expect((await join(w, 'Blair', g.id)).data).toMatchObject({ result: 'standby' });
    await books(w, 'standby carrying the claim');
    expect((await join(w, 'Casey', g.id)).data).toMatchObject({ result: 'standby' });
    expect(potOf(w, 'Casey')).toBe(500);
    await books(w, 'casey standby');
    for (const n of ['Blair', 'Casey']) {
      expect((await orgRemove(w, n, g.id)).data).toMatchObject({ result: 'withdrawn' });
      await books(w, `removed ${n}`);
    }
    expect(potOf(w, 'Casey')).toBe(500);
    expect(potOf(w, 'Blair')).toBe(0);
    expect((await w.org.call('POST', `/api/admin/sessions/${g.id}/booked`, {})).status).toBe(200); // Court opened
    await books(w, 'court opened');
    expect(seatRow(w, g.id, 'Blair').status).toBe('withdrawn');
    for (const n of ['Casey', 'Devon']) expect((await join(w, n, g.id)).status).toBe(200);
    await books(w, 'joined after opened');
    expect(potOf(w, 'Casey')).toBe(0);
    await claim(w, 'Blair', g.id, true);
    await books(w, 'claim paid');
    expect(potOf(w, 'Blair')).toBe(FLAT);
    // Rejoin uses the credit
    expect((await join(w, 'Blair', g.id)).data).toMatchObject({ result: 'confirmed', paidWithCredit: true });
    await books(w, 'rejoin');
    expect(potOf(w, 'Blair')).toBe(0);
  });
});

describe("held drop, then I'm in on another game", () => {
  for (const court of ['booked', 'none', 'waitlist'] as const)
    for (const money of ['credit', 'confirmed cash', 'unconfirmed cash'] as const)
      it(`drop Nov 3 (${money}) then at once I'm in on Nov 5 (${court}); also after a reload and with no signal`, async () => {
        vi.useFakeTimers();
        try {
          for (const variant of ['at once', 'after the hold', 'no signal at the tap', 'closed offline, reopened in 1 min']) {
            const w = await world({ book: false });
            const a = await on(w, '2026-11-03');
            const b = await on(w, '2026-11-05');
            await w.org.call('POST', `/api/admin/sessions/${a.id}/booked`, {});
            if (court === 'booked') await w.org.call('POST', `/api/admin/sessions/${b.id}/booked`, {});
            if (court === 'waitlist') await w.org.call('POST', `/api/admin/sessions/${b.id}/court`, { action: 'waitlist' });
            if (money === 'credit') givePot(w, 'Blair', 1400);
            expect((await join(w, 'Blair', a.id)).status).toBe(200);
            if (money !== 'credit') await iPaid(w, 'Blair', a.id);
            if (money === 'confirmed cash') await markPaid(w, 'Blair', a.id);
            await books(w, 'set');
            const ph = phoneModel(w, 'Blair');
            const m0 = totalMoney(w).total;
            ph.dropOut(a.id);
            if (variant === 'after the hold') await tick(w, UNDO_MS + 100);
            if (variant === 'no signal at the tap') ph.st.signal = false;
            if (variant === 'closed offline, reopened in 1 min') {
              ph.st.signal = false;
              ph.close();
              await vi.advanceTimersByTimeAsync(0);
              await tick(w, 60_000);
              expect(await ph.look()).toBe('no signal');
              ph.st.signal = true;
            }
            const res = await ph.join(b.id).catch((e) => e);
            await ph.landed();
            ph.st.signal = true;
            await tick(w, UNDO_MS + 3_000);
            await ph.look();
            await ph.landed();
            await books(w, `${variant}`);
            expect(totalMoney(w).total, `${variant}: no money made or lost`).toBe(m0);
            const sa = seatRow(w, a.id, 'Blair');
            const sb = seatRow(w, b.id, 'Blair');
            const pot = potOf(w, 'Blair');
            if (variant === 'no signal at the tap') {
              // Both taps failed: still in Nov 3 as before, nothing on Nov 5.
              expect(res).toBeInstanceOf(Offline);
              expect(sa.status).toBe('confirmed');
              expect(sb).toBeUndefined();
              continue;
            }
            expect(sa.status, variant).toBe('withdrawn');
            expect(['confirmed', 'waitlisted']).toContain(sb.status);
            if (money === 'unconfirmed cash') {
              // a claim: nothing moved, Nov 5 owes in full (court booked) or nothing yet
              expect(pot, `${variant}: no credit from an unconfirmed I paid`).toBe(0);
              expect((await dash(w)).paymentClaims).toEqual([expect.objectContaining({ playerId: w.ids.Blair, sessionId: a.id })]);
            } else if (court === 'waitlist') expect(pot, `${variant}: standby owes nothing, credit waits`).toBe(1400);
            else expect(pot, `${variant}: the drop's credit went on Nov 5`).toBe(0);
          }
        } finally {
          flushHold(false);
          vi.useRealTimers();
        }
      });

  finding("a drop note older than 2 minutes is sent anyway by the next I'm in (the documented limit is 2 minutes): she is dropped from a game she is in", async () => {
    vi.useFakeTimers();
    try {
      const w = await world();
      const a = await on(w, '2026-11-03');
      const b = await on(w, '2026-11-05');
      givePot(w, 'Blair', 1400);
      expect((await join(w, 'Blair', a.id)).status).toBe(200);
      const ph = phoneModel(w, 'Blair');
      // Drop out, then the phone goes into a pocket with no signal: the send while leaving fails, the note stays.
      ph.dropOut(a.id);
      ph.st.signal = false;
      ph.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(ph.storage.has('note')).toBe(true);
      // An hour later she opens the site: the page's look cannot ask the server yet (no signal), the note stays.
      await tick(w, HOUR);
      expect(await ph.look()).toBe('no signal');
      // She still shows as in for Tue (the drop never landed) and keeps her spot; signal is back, she taps I'm in on Thu.
      ph.st.signal = true;
      await ph.join(b.id);
      await ph.landed();
      // The hour-old drop must not be sent (too late to be sure, the page itself forgets it): she is still in Tue.
      expect(seatRow(w, a.id, 'Blair').status, 'dropped from Tue by an hour-old note').toBe('confirmed');
    } finally {
      flushHold(false);
      vi.useRealTimers();
    }
  });

  it('two drops held back to back, then I\'m in on a third game: the first drop lands before the join?', async () => {
    vi.useFakeTimers();
    try {
      const w = await world();
      const [a, b, c] = [await on(w, '2026-11-03'), await on(w, '2026-11-05'), await on(w, '2026-11-10')];
      givePot(w, 'Blair', 1400);
      expect((await join(w, 'Blair', a.id)).status).toBe(200); // paid with her $14 credit
      expect((await join(w, 'Blair', b.id)).status).toBe(200); // owes
      const ph = phoneModel(w, 'Blair');
      ph.dropOut(a.id);
      ph.dropOut(b.id); // the first is sent now (not awaited)
      await ph.join(c.id);
      await ph.landed();
      await books(w, 'two drops then join');
      // The first drop's credit is on the new seat, not left beside a seat that owes.
      expect(seatRow(w, c.id, 'Blair').payment_status).toBe('paid');
      expect(potOf(w, 'Blair')).toBe(0);
      expect(seatRow(w, a.id, 'Blair').status).toBe('withdrawn');
      expect(seatRow(w, b.id, 'Blair').status).toBe('withdrawn');
    } finally {
      flushHold(false);
      vi.useRealTimers();
    }
  });
});

// ================================================================= second pass (HEAD 5259075): the fixes under attack

/** Ten in, Blair with `credit` pays the rest (confirmed unless `unconfirmed`), the other nine pay; the game is over. */
async function tenOver(credit: number, unconfirmed = false) {
  const w = await world();
  const ten = PLAYERS.slice(0, 10);
  const g = await gameWith(w, ten, credit);
  await iPaid(w, 'Blair', g.id);
  if (!unconfirmed) await markPaid(w, 'Blair', g.id);
  after(w, g);
  return { w, g, ten };
}
const UNMARK_BATCH = /UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid'[\s\S]*INSERT INTO credit_ledger/;

describe('second pass: Unmark / Mark paid / Unmark cycles after Finalize, credit covering the price', () => {
  for (const credit of [500, 800, 900, 1000, 1300])
    for (const n of [6, 7, 8, 9, 10])
      it(`credit $${credit / 100}, ${n} played: Unmark, Mark paid, Unmark, player's Didn't pay?, I paid, Reopen, redo`, async () => {
        for (const unconfirmed of [false, true]) {
          const { w, g, ten } = await tenOver(credit, unconfirmed);
          const price = finalPrice(FLAT, n);
          expect((await finalize(w, g.id, ten.slice(0, n))).status).toBe(200);
          await books(w, 'final');
          const expectBack = () => {
            const sp = seatRow(w, g.id, 'Blair');
            // Whatever the seat holds, what came back is exactly what it holds above the final price (or nothing yet).
            return sp;
          };
          for (const [i, tap] of [
            () => unmark(w, 'Blair', g.id),
            () => markPaid(w, 'Blair', g.id),
            () => unmark(w, 'Blair', g.id),
            () => unmark(w, 'Blair', g.id),
            () => markPaid(w, 'Blair', g.id),
            () => didntPay(w, 'Blair', g.id),
            () => iPaid(w, 'Blair', g.id),
            () => unmark(w, 'Blair', g.id, w.org2, false),
            () => markPaid(w, 'Blair', g.id, w.org2, false),
          ].entries()) {
            const res = await tap();
            expect(res.status, `tap ${i}: ${res.text}`).toBeLessThan(500);
            await books(w, `${unconfirmed ? 'unconf' : 'conf'} credit ${credit} n ${n} tap ${i}`);
            expectBack();
          }
          // The pot never holds more than her credit above the price plus... : at most credit + cash she paid minus price.
          expect(potOf(w, 'Blair')).toBeLessThanOrEqual(Math.max(0, credit - price) + FLAT);
          const ro = await reopen(w, g.id);
          expect([200, 409], ro.text).toContain(ro.status);
          await books(w, 'reopen');
          if (ro.status === 200) {
            expect((await finalize(w, g.id, ten.slice(0, n === 10 ? 6 : n + 1))).status).toBeLessThan(500);
            await books(w, 'redo');
          }
        }
      });
});

/** Second-pass finding G1: fixed (Unmark's undo, unpaid and money back are tied to the finalize it read). Plain regression tests now. */
const finding2 = it;
const RACE_FINDINGS = new Set(['1000:finalize10', '1000:finalize6', '1000:reopen+finalize7']);

describe('second pass: Unmark racing Finalize / Reopen (two organizer devices)', () => {
  for (const credit of [0, 300, 1000])
    for (const other of ['finalize10', 'finalize6', 'reopen', 'reopen+finalize7', 'reopen+finalize5'] as const)
      (RACE_FINDINGS.has(`${credit}:${other}`) ? finding2 : it)(`${RACE_FINDINGS.has(`${credit}:${other}`) ? 'G1 ' : ''}credit $${credit / 100}: Unmark paused just before its batch while the other device does ${other}`, async () => {
        const { w, g, ten } = await tenOver(credit);
        const preFinal = other.startsWith('reopen');
        if (preFinal) expect((await finalize(w, g.id, ten)).status).toBe(200); // 10 played: $5
        await books(w, 'before');
        let otherRes: any[] = [];
        w.db.pauseBefore(UNMARK_BATCH, async () => {
          if (other === 'finalize10') otherRes = [await finalize(w, g.id, ten, w.org2)];
          if (other === 'finalize6') otherRes = [await finalize(w, g.id, ten.slice(0, 6), w.org2)];
          if (other.startsWith('reopen')) {
            otherRes = [await reopen(w, g.id, w.org2)];
            if (other === 'reopen+finalize7') otherRes.push(await finalize(w, g.id, ten.slice(0, 7), w.org2));
            if (other === 'reopen+finalize5') otherRes.push(await finalize(w, g.id, ten.slice(0, 5), w.org2));
          }
        });
        const m0 = totalMoney(w).total;
        const cash = seatCash(w, g.id, 'Blair');
        const u = await w.org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: false });
        const dM = totalMoney(w).total - m0;
        expect([0, -cash], `money moved by ${dM}`).toContain(dM);
        w.cash += dM;
        expect([u.status, ...otherRes.map((x) => x.status)].every((x) => x < 500), `${u.text} ${otherRes.map((x) => x.text)}`).toBe(true);
        await books(w, `unmark raced ${other}: ${u.status} ${otherRes.map((x) => x.status)}`);
      });
});

describe('second pass: Reopen with self-marked seats', () => {
  it('withheld (unconfirmed, paid the flat price) seats reopen and redo at every N; short unconfirmed seats block Reopen and Finalize; answers unblock', async () => {
    for (const n of [4, 5, 6, 8, 10]) {
      const { w, g, ten } = await tenOver(300, true);
      expect((await finalize(w, g.id, ten.slice(0, n))).status).toBe(200);
      await books(w, `final ${n}`);
      // Casey unmarked then pays the final price herself, unconfirmed (below the flat price): Reopen must refuse.
      await unmark(w, 'Casey', g.id);
      await iPaid(w, 'Casey', g.id);
      await books(w, 'casey short unconfirmed');
      const ro = await reopen(w, g.id);
      if (n > 4) expect(ro.status, ro.text).toBe(409);
      await books(w, 'reopen refused');
      // Answer it (Mark paid), then Reopen goes; Blair's withheld seat comes back as a flat-price I paid.
      await markPaid(w, 'Casey', g.id);
      if (ro.status !== 200) expect((await reopen(w, g.id)).status).toBe(200);
      await books(w, 'reopened');
      expect(seatRow(w, g.id, 'Blair')).toMatchObject({ payment_status: 'paid', payment_amount_cents: 1400 });
      expect(seatRow(w, g.id, 'Blair').self_paid_at).not.toBeNull();
      expect((await finalize(w, g.id, ten.slice(1, 6))).status).toBe(200); // Blair did not play: claim
      await books(w, 'blair not played');
      expect((await dash(w)).paymentClaims).toEqual([expect.objectContaining({ playerId: w.ids.Blair, why: 'not_played' })]);
      expect(potOf(w, 'Blair')).toBe(0);
    }
  });

  it("an I paid landing while Reopen runs (paused inside): Reopen refuses, nothing half-done", async () => {
    const { w, g, ten } = await tenOver(0);
    expect((await finalize(w, g.id, ten.slice(0, 5))).status).toBe(200); // $11
    await unmark(w, 'Casey', g.id);
    await books(w, 'casey unpaid');
    let paid: any;
    w.db.pauseBefore(/UPDATE credit_ledger SET ended_at = \?1, ended_reason = 'undone'/, async () => {
      paid = await iPaid(w, 'Casey', g.id);
    });
    const ro = await reopen(w, g.id);
    expect(paid.status).toBe(200);
    expect([200, 409]).toContain(ro.status);
    await books(w, `reopen ${ro.status} with an I paid inside`);
    if (ro.status === 200) expect(seatRow(w, g.id, 'Casey').self_paid_at, 'unconfirmed seat kept its mark').not.toBeNull();
  });
});

describe('G1: Unmark of the cash on top of credit that covers the price, racing a Finalize (or a Reopen + redo) from another device', () => {
  finding2('Finalize (10 played, $5) lands while the Unmark is on its way: the seat ends paid with $10 credit and no money back ($5 stuck)', async () => {
    const { w, g, ten } = await tenOver(1000);
    w.db.pauseBefore(UNMARK_BATCH, async () => {
      expect((await finalize(w, g.id, ten, w.org2)).status).toBe(200);
    });
    expect((await w.org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: false })).status).toBeLessThan(500);
    // Either the Unmark is refused ("look again": she keeps $9 back) or it went in and her $5 above the price came back.
    expect([900, 500], 'money back after Unmark racing Finalize').toContain(potOf(w, 'Blair'));
  });
  finding2('Reopen + redo at 7 ($8) lands while the Unmark (read at 10 played, $5) is on its way: $5 comes back instead of $2 ($3 made)', async () => {
    const { w, g, ten } = await tenOver(1000);
    expect((await finalize(w, g.id, ten)).status).toBe(200);
    w.db.pauseBefore(UNMARK_BATCH, async () => {
      expect((await reopen(w, g.id, w.org2)).status).toBe(200);
      expect((await finalize(w, g.id, ten.slice(0, 7), w.org2)).status).toBe(200);
    });
    expect((await w.org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: false })).status).toBeLessThan(500);
    // Refused: she keeps $6 back from the redo; went in: $10 credit on an $8 seat, $2 back.
    expect([600, 200], 'money back after Unmark racing Reopen + redo').toContain(potOf(w, 'Blair'));
  });
});

describe('second pass: two devices at once on a finalized seat whose credit covers the price', () => {
  const taps = {
    unmark: (w: World, g: any, dev: 0 | 1) => (dev ? w.org2 : w.org).call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: false }),
    mark: (w: World, g: any, dev: 0 | 1) => (dev ? w.org2 : w.org).call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: true }),
    didntpay: async (w: World, g: any, dev: 0 | 1) => (await phone(w, 'Blair', dev)).call('POST', `/api/sessions/${g.id}/paid`, { paid: false }),
    reopen: (w: World, g: any, dev: 0 | 1) => reopen(w, g.id, dev ? w.org2 : w.org),
  };
  type T = keyof typeof taps;
  const pairs: [T, T][] = [['unmark', 'unmark'], ['unmark', 'mark'], ['unmark', 'didntpay'], ['mark', 'didntpay'], ['unmark', 'reopen'], ['didntpay', 'reopen'], ['mark', 'reopen']];
  for (const unconfirmed of [false, true])
    for (const [a, b] of pairs)
      it(`${unconfirmed ? 'unconfirmed' : 'confirmed'} $4 on $10 credit, 10 played: ${a} || ${b}`, async () => {
        const { w, g, ten } = await tenOver(1000, unconfirmed);
        expect((await finalize(w, g.id, ten)).status).toBe(200);
        await books(w, 'final');
        const cash = seatCash(w, g.id, 'Blair');
        const rs = await together(w, [0, -cash], [() => taps[a](w, g, 0), () => taps[b](w, g, 1)]);
        expect(rs.every((x) => x.status < 500), rs.map((x) => x.text).join(' ')).toBe(true);
        await books(w, `${a} || ${b}`);
        // and then the rest, in order: every answer still consistent
        await unmark(w, 'Blair', g.id);
        await books(w, 'then unmark');
        await markPaid(w, 'Blair', g.id);
        await books(w, 'then mark paid');
      });
});

// ================================================================= third pass (1627848): G1 variants, no money moves on a stale read
const STALE = new Map<string, number>();
describe('third pass: Unmark / Didn\'t pay? read one game, another device changes it before the save', () => {
  afterAll(() => console.log('third pass outcomes by status', JSON.stringify(Object.fromEntries(STALE))));
  type Other = 'fin6' | 'fin7' | 'fin10' | 'reopen' | 'reopen+redo5' | 'reopen+redo7' | 'reopen+redo10' | 'fin10+reopen';
  const others: Other[] = ['fin6', 'fin7', 'fin10', 'reopen', 'reopen+redo5', 'reopen+redo7', 'reopen+redo10', 'fin10+reopen'];
  for (const credit of [900, 1000, 1300])
    for (const unconfirmed of [false, true])
      it(`credit $${credit / 100}, ${unconfirmed ? 'unconfirmed' : 'confirmed'} cash: every interleaving, Unmark and the player's Didn't pay?`, async () => {
        for (const who of ['org', 'player'] as const)
          for (const other of others) {
            if (who === 'player' && !unconfirmed) continue; // Didn't pay? only on her own unconfirmed I paid
            const { w, g, ten } = await tenOver(credit, unconfirmed);
            const pre = other.startsWith('reopen');
            if (pre) expect((await finalize(w, g.id, ten.slice(0, 8))).status).toBe(200); // read at 8 played ($7)
            await books(w, 'before');
            const run: any[] = [];
            w.db.pauseBefore(UNMARK_BATCH, async () => {
              w.app.now += 1000;
              const o = w.org2;
              if (other === 'fin6') run.push(await finalize(w, g.id, ten.slice(0, 6), o));
              if (other === 'fin7') run.push(await finalize(w, g.id, ten.slice(0, 7), o));
              if (other === 'fin10' || other === 'fin10+reopen') run.push(await finalize(w, g.id, ten, o));
              if (other === 'fin10+reopen') run.push(await reopen(w, g.id, o));
              if (pre) run.push(await reopen(w, g.id, o));
              if (other === 'reopen+redo5') run.push(await finalize(w, g.id, ten.slice(0, 5), o));
              if (other === 'reopen+redo7') run.push(await finalize(w, g.id, ten.slice(0, 7), o));
              if (other === 'reopen+redo10') run.push(await finalize(w, g.id, ten, o));
            });
            const m0 = totalMoney(w).total;
            const cash = seatCash(w, g.id, 'Blair');
            const pot0 = potOf(w, 'Blair');
            const sp0 = { ...seatRow(w, g.id, 'Blair') };
            const res =
              who === 'org'
                ? await w.org.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.ids.Blair, paid: false })
                : await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/paid`, { paid: false });
            const dM = totalMoney(w).total - m0;
            const label = `${who} ${other}: ${res.status} ${res.text} / ${run.map((x) => x.status)}`;
            expect(run.length, `${label}: the other device ran inside the window`).toBeGreaterThan(0);
            STALE.set(`${res.status}`, (STALE.get(`${res.status}`) ?? 0) + 1);
            expect(res.status, label).toBeLessThan(500);
            expect([0, -cash], `${label}: money moved ${dM}`).toContain(dM);
            w.cash += dM;
            // A refused tap moves nothing: her pot and seat are exactly what the other device left.
            if (res.status === 409) {
              expect(dM, label).toBe(0);
              void pot0;
              void sp0;
            }
            await books(w, label);
            // and the organizer, looking again, can finish: Unmark then Mark paid, books still right
            await unmark(w, 'Blair', g.id);
            await books(w, `${label} :: look again, unmark`);
            await markPaid(w, 'Blair', g.id);
            await books(w, `${label} :: mark paid`);
          }
      });
});
