// Independent attack on the money logic (Oct 31, 2026 audit).
//
// Every scenario drives the real API (server/app.ts) through the test harness,
// with a fake clock, and after every step checks the books from scratch with
// its own arithmetic (`books` below), never trusting the app's own helpers:
//
//  - each player's pot = the sum of their live ledger rows, never below $0;
//  - cash pairs (reason 'cash') are matched +kept/-used per seat;
//  - no seat holds more credit than its price; a paid seat's payment, net of
//    what came back from it, is exactly its price; an unpaid seat owes the rest;
//  - no credit or unsettled cash on a withdrawn seat or a canceled game;
//  - the organizer never has a ledger row;
//  - the player's own screen (GET /api/group: owed and the card's `mine`)
//    adds up: due + credit + paid earlier = price, and shows their pot;
//  - the dashboard (Players balances, Who paid rows) matches the ledger;
//  - the conservation book: the real cash players sent (what their screen
//    said they owed when they paid) = what the Money tab says the group kept
//    or holds + all pots + cashed out; and the Money tab's credit owed adds up
//    to all pots.
//
// Exact interleavings come from a wrapped database (`Hooked`) that can pause a
// request just before a given SQL statement (and run another request then), or
// throw at the Nth write (a request cut off halfway).

import { afterAll, describe, expect, it, vi } from 'vitest';
import type { D1Database, D1PreparedStatement } from '../server/db';
import { finalPrice } from '../shared/pricing';
import { type Client, HOUR, playerPhone, setupGroup, TestApp } from './harness';

vi.setConfig({ testTimeout: 900_000 });

const TZ = 'America/Detroit';
const FLAT = 1400;
const ORG = 'Alex';
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kai', 'Lee'];
const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA];

// ---------------------------------------------------------------- the hooked database

type Gate = { match: RegExp; before: () => Promise<void>; used: boolean };

/** Wraps the D1 binding: pause before a matching statement, or throw at the Nth write. */
class Hooked implements D1Database {
  gates: Gate[] = [];
  writes = 0;
  failAt: number | null = null;
  log: string[] = [];
  constructor(private real: D1Database) {}

  /** Before the next statement (or batch) whose SQL matches, run `before` (once). */
  pauseBefore(match: RegExp, before: () => Promise<void>) {
    const g = { match, before, used: false };
    this.gates.push(g);
    return g;
  }

  /** Database calls made so far (every first/all/run/batch). */
  calls = 0;
  pauseAt: { n: number; before: () => Promise<void> } | null = null;

  private async gate(sql: string) {
    this.calls++;
    if (this.pauseAt && this.calls === this.pauseAt.n) {
      const p = this.pauseAt;
      this.pauseAt = null;
      await p.before();
    }
    for (const g of this.gates) {
      if (!g.used && g.match.test(sql)) {
        g.used = true;
        await g.before();
      }
    }
  }

  private countWrite(sql: string) {
    this.writes++;
    if (this.failAt !== null && this.writes === this.failAt) {
      this.failAt = null;
      throw new Error(`cut off at write ${this.writes}: ${sql.slice(0, 60)}`);
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
        if (!/^\s*select\b/i.test(sql)) self.countWrite(sql);
        return s.run();
      },
    };
    return w;
  }

  async batch(statements: D1PreparedStatement[]) {
    const sql = statements.map((s: any) => s.__sql).join('\n;;\n');
    await this.gate(sql);
    this.countWrite(sql);
    const out = await this.real.batch(statements.map((s: any) => s.__real));
    if (process.env.AUDIT_TRACE && new RegExp(process.env.AUDIT_TRACE).test(sql)) console.log('TRACE', out.map((o) => o.meta.changes), (statements[0] as any).__real.values, sql.slice(0, 900));
    return out;
  }
}

// ---------------------------------------------------------------- the world

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

interface World {
  ctx: Ctx;
  app: TestApp;
  db: Hooked;
  org: Client;
  ids: Record<string, string>;
  phones: Map<string, Client>;
  /** Cash players really sent, by the test's own book (what their screen said they owed when they paid). */
  cash: number;
  steps: number;
  /** One-off games (Sat Oct 31, from 10 AM) used only to earn credit the real way. */
  bank: string[];
}

async function world(opts: { maxPlayers?: number; book?: boolean } = {}): Promise<World> {
  const app = new TestApp();
  const db = new Hooked(app.db);
  app.env = { ...app.env, DB: db };
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: ORG };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  const r = await ctx.organizer.call('PUT', '/api/admin/group', body);
  if (r.status !== 200) throw new Error(r.text);
  for (const [i, name] of EXTRA.entries()) {
    const res = await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` });
    if (res.status !== 200) throw new Error(res.text);
    ctx.byName[name] = res.data.id;
  }
  const bank: string[] = [];
  for (let h = 14; h <= 20; h += 2) {
    const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: `2026-10-31T${h}:00:00.000Z`, endsAt: `2026-10-31T${h + 1}:00:00.000Z`, note: 'bank' });
    if (res.status !== 200) throw new Error(res.text);
    bank.push(res.data.id);
  }
  const w: World = { ctx, app, db, org: ctx.organizer, ids: ctx.byName, phones: new Map(), cash: 0, steps: 0, bank };
  // The organizer is a player (so "the organizer never uses or earns credit" can be checked).
  if (opts.book !== false) for (const s of await sessionsAll(w)) if (Date.parse(s.startsAt) > app.now) await w.org.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  return w;
}

const dash = async (w: World) => (await w.org.call('GET', '/api/admin/dashboard')).data;
const sessionsAll = async (w: World) => (await dash(w)).sessions as any[];
async function on(w: World, date: string): Promise<string> {
  const s = (await sessionsAll(w)).find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s.id;
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
const view = async (w: World, name: string) => (await (await phone(w, name)).call('GET', '/api/group')).data;
const sessionRow = (w: World, sid: string) => w.app.db.raw.prepare('SELECT * FROM sessions WHERE id = ?').get(sid) as any;
const seatRow = (w: World, sid: string, name: string) => w.app.db.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, w.ids[name]) as any;
const ledger = (w: World) => w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY created_at, rowid').all() as any[];
const eff = (r: any) => (r.kind === 'kept' ? r.amount_cents : r.kind === 'used' ? -r.amount_cents : -(r.amount_cents - r.five_cents));
function potOf(w: World, name: string): number {
  return ledger(w)
    .filter((r) => r.player_id === w.ids[name] && !r.ended_at)
    .reduce((s, r) => s + eff(r), 0);
}

// ---------------------------------------------------------------- actions (the taps)

const join = async (w: World, name: string, sid: string, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/join`, {});
const drop = async (w: World, name: string, sid: string, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/withdraw`, {});

/** What the player's own screen says they owe for a game right now (0 when nothing). */
async function shownOwe(w: World, name: string, sid: string): Promise<number> {
  const v = await view(w, name);
  return v?.owed?.find((o: any) => o.sessionId === sid)?.amountCents ?? 0;
}

/** "I paid" for what their screen showed. Cash counts in the book only when the tap went in. */
async function iPaid(w: World, name: string, sid: string, device = 0, shown?: number) {
  const cents = shown ?? (await shownOwe(w, name, sid));
  const res = await (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/paid`, { paid: true, cents });
  if (res.status === 200 && res.data.changed) w.cash += cents;
  return res;
}

/** "Didn't pay?" right after their own I paid: the cash they said they sent did not go. */
async function iDidNotPay(w: World, name: string, sid: string, lastShown: number) {
  const res = await (await phone(w, name)).call('POST', `/api/sessions/${sid}/paid`, { paid: false });
  if (res.status === 200 && res.data.changed) w.cash -= lastShown;
  return res;
}

const MARKED = new Set<string>();
/** The organizer's Mark paid, for what Who paid showed. */
async function markPaid(w: World, name: string, sid: string) {
  const d = await dash(w);
  const r = d.sessions.find((s: any) => s.id === sid).roster.find((x: any) => x.playerId === w.ids[name]);
  const cents = r?.owesCents ?? 0;
  // Counted only when this tap recorded a payment (its Activity line has the amounts), not when it confirmed a
  // player's own I paid that landed at the same moment.
  const res = await w.org.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids[name], paid: true, cents });
  const rows = w.app.db.raw
    .prepare("SELECT id FROM admin_audit_log WHERE session_id = ? AND action = 'marked_paid' AND details_json LIKE '%cashCents%' AND details_json LIKE ?")
    .all(sid, `%"player":"${name}"%`) as any[];
  for (const x of rows) {
    if (MARKED.has(x.id)) continue;
    MARKED.add(x.id);
    w.cash += cents;
  }
  return res;
}
/** The organizer's Unmark: the payment never happened, so the cash in it leaves the book (credit on it goes back to the pot). */
async function unmark(w: World, name: string, sid: string) {
  const before = seatRow(w, sid, name);
  const credit = usedOn(w, sid, name);
  const res = await w.org.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids[name], paid: false });
  // Counted when this tap did it: its answer says so, or it was cut off (500) after the seat changed.
  const went = before?.payment_status === 'paid' && !before.refunded_at && seatRow(w, sid, name)?.payment_status !== 'paid';
  if (went && ((res.status === 200 && res.data.changed) || res.status >= 500)) w.cash -= before.payment_amount_cents - credit;
  return res;
}
const finalize = (w: World, sid: string, played: string[] | 'everyone') =>
  w.org.call('POST', `/api/admin/sessions/${sid}/finalize`, played === 'everyone' ? { everyone: true } : { played: played.map((n) => w.ids[n]) });
const reopen = (w: World, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/reopen`, {});
const cancel = (w: World, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true });
const uncancel = (w: World, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'reopen' });
const orgAdd = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'confirm' });
const orgRemove = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'withdraw' });
const orgWaitlist = (w: World, name: string, sid: string) => w.org.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[name], action: 'waitlist' });
const useCredit = async (w: World, name: string, sid: string, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/use-credit`, {});
const undoCredit = async (w: World, name: string, sid: string) => (await phone(w, name)).call('POST', `/api/sessions/${sid}/undo-credit`, {});
const useCashOut = async (w: World, name: string, sid: string, cents: number, device = 0) => (await phone(w, name, device)).call('POST', `/api/sessions/${sid}/use-cash-out`, { cents });
const askCashOut = async (w: World, name: string, cents: number, device = 0) => (await phone(w, name, device)).call('POST', '/api/me/refund-request', { cents });
const cancelAsk = async (w: World, name: string) => (await phone(w, name)).call('POST', '/api/me/refund-request/cancel', {});
const pendingReq = (w: World, name: string) => w.app.db.raw.prepare("SELECT * FROM refund_requests WHERE player_id = ? AND status = 'pending'").get(w.ids[name]) as any;
const lastReq = (w: World, name: string) => w.app.db.raw.prepare('SELECT * FROM refund_requests WHERE player_id = ? ORDER BY created_at DESC, rowid DESC').get(w.ids[name]) as any;
const markRefunded = (w: World, reqId: string, cents?: number) => w.org.call('POST', `/api/admin/refund-requests/${reqId}`, cents === undefined ? { action: 'refunded' } : { action: 'refunded', cents });
const notNow = (w: World, reqId: string) => w.org.call('POST', `/api/admin/refund-requests/${reqId}`, { action: 'not_now' });
const undoRefunded = (w: World, reqId: string) => w.org.call('POST', `/api/admin/refund-requests/${reqId}`, { action: 'undo' });
async function refundBalance(w: World, name: string) {
  const d = await dash(w);
  const cents = d.creditLedger.find((l: any) => l.playerId === w.ids[name])?.refundCents ?? 0;
  return w.org.call('POST', `/api/admin/players/${w.ids[name]}/credit-refund`, { refunded: true, cents });
}

/**
 * Real credit, made the real way: the player joins the Sat Oct 31 bank games, pays
 * $14 cash (into the book), and drops: $14 back as credit. Repeat for more.
 */
async function earnCredit(w: World, name: string, times = 1) {
  if (times > w.bank.length) throw new Error('not enough bank games');
  // Pay cash on each game first (credit would be used automatically on a rejoin), then drop them all.
  for (const sid of w.bank.slice(0, times)) {
    expect((await join(w, name, sid)).status).toBe(200);
    const owe = await shownOwe(w, name, sid);
    if (owe > 0) expect((await iPaid(w, name, sid, 0, owe)).status).toBe(200);
  }
  for (const sid of w.bank.slice(0, times)) expect((await drop(w, name, sid)).status).toBe(200);
}

// ---------------------------------------------------------------- the books

const TOLERATED = { settledCash: 0 };

function dump(w: World, label: string) {
  const raw = w.app.db.raw;
  const names = new Map(Object.entries(w.ids).map(([n, id]) => [id, n]));
  const sess = new Map((raw.prepare('SELECT id, starts_at FROM sessions').all() as any[]).map((r) => [r.id, r.starts_at.slice(5, 13)]));
  console.log('DUMP', label);
  for (const sp of raw.prepare("SELECT * FROM session_players WHERE status <> 'declined' OR payment_status = 'paid'").all() as any[])
    console.log('  seat', sess.get(sp.session_id), names.get(sp.player_id), sp.status, sp.payment_status, sp.payment_amount_cents, sp.refunded_at ? 'settled' : '', 'played', sp.played);
  for (const r of ledger(w)) console.log('  row', sess.get(r.session_id), names.get(r.player_id), r.kind, r.amount_cents, r.reason, r.ended_at ? `ENDED ${r.ended_reason}` : '');
}

const MONTHS = ['2026-10', '2026-11', '2026-12'];

/** Every invariant, from scratch. Throws with `label` on the first broken one. */
let BOOKS = 0;
async function books(w: World, label = '') {
  w.steps++;
  BOOKS++;
  const raw = w.app.db.raw;
  const L = ledger(w);
  const live = L.filter((r) => !r.ended_at);
  const orgId = w.ids[ORG];
  const at = (what: string) => `${label} :: ${what}`;

  // The organizer never has a ledger row.
  expect(L.filter((r) => r.player_id === orgId).length, at('organizer ledger rows')).toBe(0);

  // Pots: sum of live rows, never below $0.
  const pots = new Map<string, number>();
  for (const r of live) pots.set(r.player_id, (pots.get(r.player_id) ?? 0) + eff(r));
  for (const [p, c] of pots) expect(c, at(`pot of ${p} below 0`)).toBeGreaterThanOrEqual(0);
  const reserved = new Map<string, number>();
  for (const r of raw.prepare("SELECT * FROM refund_requests WHERE status = 'pending'").all() as any[]) reserved.set(r.player_id, (reserved.get(r.player_id) ?? 0) + r.amount_cents);
  for (const [p, c] of reserved) expect(c, at('a pending cash out is more than the pot')).toBeLessThanOrEqual(pots.get(p) ?? 0);

  // Cash pairs matched per seat.
  const pairKey = new Map<string, number>();
  for (const r of live.filter((x) => x.reason === 'cash')) {
    const k = `${r.session_id}:${r.player_id}`;
    pairKey.set(k, (pairKey.get(k) ?? 0) + (r.kind === 'kept' ? r.amount_cents : -r.amount_cents));
  }
  for (const [k, v] of pairKey) expect(v, at(`cash pair unmatched ${k}`)).toBe(0);

  // Seats.
  const seats = raw
    .prepare('SELECT sp.*, s.status AS s_status, s.finalized_at, s.final_price_cents, p.display_name AS name FROM session_players sp JOIN sessions s ON s.id = sp.session_id JOIN players p ON p.id = sp.player_id')
    .all() as any[];
  const seatSum = (sp: any, f: (r: any) => boolean) => live.filter((r) => r.session_id === sp.session_id && r.player_id === sp.player_id && f(r)).reduce((s, r) => s + r.amount_cents, 0);
  for (const sp of seats) {
    if (sp.player_id === orgId) continue;
    const who = `${sp.name} on ${sp.session_id.slice(0, 8)} (${sp.status}/${sp.payment_status}${sp.refunded_at ? '/settled' : ''})`;
    const usedNC = seatSum(sp, (r) => r.kind === 'used' && r.reason !== 'cash');
    const held = seatSum(sp, (r) => r.kind === 'used' && r.reason === 'cash');
    const backFin = seatSum(sp, (r) => r.kind === 'kept' && r.reason === 'finalized');
    const backNP = seatSum(sp, (r) => r.kind === 'kept' && r.reason === 'not_played');
    const unsettledPaid = sp.payment_status === 'paid' && !sp.refunded_at;
    if (sp.s_status === 'canceled' || sp.status === 'withdrawn') {
      expect(usedNC, at(`credit left on ${who}`)).toBe(0);
      expect(held, at(`cash held on ${who}`)).toBe(0);
      expect(unsettledPaid, at(`unsettled cash on ${who}`)).toBe(false);
      expect(backFin, at(`finalized credit back on ${who}`)).toBe(0);
      continue;
    }
    if (sp.status !== 'confirmed') {
      // Waitlisted: a paid seat stays paid (documented); an unpaid one carries no credit.
      if (!unsettledPaid) expect(usedNC + held, at(`credit on unpaid ${who}`)).toBe(0);
      continue;
    }
    const price = !sp.finalized_at ? FLAT : sp.played === 1 ? sp.final_price_cents : null;
    if (price === null) {
      // Did not play: everything came back; a seat still holding credit must be settled with all of it back.
      expect(unsettledPaid, at(`did-not-play seat still paid ${who}`)).toBe(false);
      if (usedNC + held > 0) {
        expect(!!sp.refunded_at, at(`did-not-play seat with credit not settled ${who}`)).toBe(true);
        expect(backNP, at(`did-not-play credit not all back ${who}`)).toBeGreaterThanOrEqual(usedNC + held);
      }
      continue;
    }
    // Credit used on a seat, net of what came back from it after Finalize, is never above its price.
    expect(usedNC - backFin, at(`more credit than the price on ${who}`)).toBeLessThanOrEqual(price);
    expect(usedNC + held - backFin, at(`credit + held above price on ${who}`)).toBeLessThanOrEqual(price);
    if (unsettledPaid) {
      // Tolerated (by design, server/credit.ts repriceStatements `short`): after a Reopen, a seat paid in cash at
      // the lower final price shows paid at the flat price until the game is finalized again.
      const reopenedCashSeat = !sp.finalized_at && usedNC + held === 0 && sp.payment_amount_cents < price;
      if (!reopenedCashSeat) expect(sp.payment_amount_cents - backFin, at(`paid seat net of credit back is not its price ${who}`)).toBe(price);
      expect(usedNC + held, at(`credit on a paid seat above its payment ${who}`)).toBeLessThanOrEqual(sp.payment_amount_cents);
    } else if (sp.payment_status === 'unpaid') {
      expect(usedNC + held, at(`unpaid seat whose credit covers it ${who}`)).toBeLessThan(price);
      expect(backFin, at(`finalized credit back on an unpaid seat ${who}`)).toBe(0);
    } else {
      throw new Error(at(`confirmed seat in odd state ${who}`));
    }
  }

  // Each player's own screen.
  const d = await dash(w);
  for (const name of OTHERS) {
    const pid = w.ids[name];
    const pot = pots.get(pid) ?? 0;
    const v = await view(w, name);
    expect(v.credit.balanceCents, at(`${name}'s own balance`)).toBe(pot);
    expect(v.credit.usableCents, at(`${name}'s usable`)).toBe(Math.max(0, pot - (reserved.get(pid) ?? 0)));
    const shownLedger = d.creditLedger.find((l: any) => l.playerId === pid)?.balanceCents ?? 0;
    expect(shownLedger, at(`${name}'s balance on Players`)).toBe(pot);
    for (const o of v.owed) {
      const sp = seats.find((x) => x.session_id === o.sessionId && x.player_id === pid);
      const price = !sp.finalized_at ? FLAT : sp.final_price_cents;
      const usedNC = seatSum(sp, (r) => r.kind === 'used' && r.reason !== 'cash');
      const held = seatSum(sp, (r) => r.kind === 'used' && r.reason === 'cash');
      expect(o.amountCents, at(`${name}'s owed line`)).toBe(price - usedNC - held);
      expect(o.creditCents, at(`${name}'s owed credit`)).toBe(usedNC);
      expect(o.amountCents, at(`${name} owes nothing but is listed`)).toBeGreaterThan(0);
    }
    for (const s of v.sessions) {
      if (s.canceled || !s.mine) continue;
      for (const other of [...s.confirmed, ...s.waitlist]) {
        for (const k of Object.keys(other)) expect(/pay|credit|owe|cents|paid/i.test(k), at(`${name} sees another player's ${k}`)).toBe(false);
      }
      const m = s.mine;
      if (m.status === 'confirmed' && m.paymentStatus === 'unpaid' && m.shareCents !== null) {
        expect(m.oweCents + m.creditCents + m.paidEarlierCents, at(`${name}'s card: due + credit + paid earlier = price`)).toBe(m.shareCents);
        const inOwed = v.owed.find((o: any) => o.sessionId === s.id);
        if (m.oweCents > 0) expect(inOwed?.amountCents, at(`${name}'s card and owed agree`)).toBe(m.oweCents);
      }
    }
    // Every seat that still owes shows up on their screen.
    for (const sp of seats.filter((x) => x.player_id === pid && x.status === 'confirmed' && x.payment_status === 'unpaid' && x.s_status !== 'canceled')) {
      const price = !sp.finalized_at ? FLAT : sp.played === 1 ? sp.final_price_cents : 0;
      const owe = price - seatSum(sp, (r) => r.kind === 'used');
      if (owe > 0) expect(v.owed.some((o: any) => o.sessionId === sp.session_id), at(`${name} owes ${owe} for a game not on their screen`)).toBe(true);
    }
  }
  // Who paid rows agree with the ledger.
  for (const s of d.sessions) {
    for (const r of s.roster) {
      if (r.isOrganizer) continue;
      const sp = seats.find((x) => x.session_id === s.id && x.player_id === r.playerId);
      const usedNC = seatSum(sp, (x) => x.kind === 'used' && x.reason !== 'cash');
      expect(r.creditCents, at(`Who paid credit for ${r.name}`)).toBe(usedNC);
    }
  }
  expect(d.creditLedger.some((l: any) => l.playerId === orgId), at('organizer on the credit list')).toBe(false);

  // The conservation book and the Money tab.
  let keptHeld = 0;
  let owedCredit = 0;
  for (const m of MONTHS) {
    const mm = (await w.org.call('GET', `/api/admin/money?month=${m}`)).data;
    keptHeld += mm.collectedCents + mm.heldCents;
    owedCredit += mm.creditsOwedCents;
    // A finalized game everyone has paid for: the Money tab's Collected = the dashboard's "Players cover".
    for (const ms of mm.sessions.filter((x: any) => x.state === 'played')) {
      const ds = d.sessions.find((x: any) => x.id === ms.id);
      if (!ds?.court) continue;
      const owing = seats.some((sp) => sp.session_id === ms.id && sp.player_id !== orgId && sp.status === 'confirmed' && sp.payment_status === 'unpaid' && sp.played === 1);
      if (owing) continue;
      const settledHeld = seats
        .filter((sp) => sp.session_id === ms.id && sp.player_id !== orgId && sp.refunded_at)
        .reduce((sum, sp) => sum + seatSum(sp, (r) => r.kind === 'used' && r.reason === 'cash'), 0);
      if (settledHeld > 0 && ms.collectedCents === ds.court.playersCoverCents + settledHeld) continue; // BUG 1
      expect(ms.collectedCents, at(`Money tab vs dashboard for ${ms.id.slice(0, 8)}`)).toBe(ds.court.playersCoverCents);
    }
  }
  const allPots = [...pots.values()].reduce((a, b) => a + b, 0);
  const cashedOut = live.filter((r) => r.kind === 'refunded').reduce((s, r) => s + r.amount_cents - r.five_cents, 0);
  // `allPots` already has the refunds taken off; the book counts them once as cashed out.
  if (process.env.AUDIT_DEBUG && keptHeld + allPots + cashedOut !== w.cash) dump(w, label);
  // BUG 1 (pinned by its own failing test below): cash held against a seat that then did not play stays as a live
  // cash pair on the settled seat, and the Money tab counts it as collected although it came back as credit. The
  // other scenarios tolerate exactly that amount, so they keep looking for anything else.
  const settledCash = seats
    .filter((sp) => sp.player_id !== orgId && sp.refunded_at && sp.s_status !== 'canceled')
    .reduce((sum, sp) => sum + seatSum(sp, (r) => r.kind === 'used' && r.reason === 'cash'), 0);
  if (settledCash > 0 && keptHeld + allPots + cashedOut === w.cash + settledCash) {
    TOLERATED.settledCash++;
    keptHeld -= settledCash;
  }
  expect(keptHeld + allPots + cashedOut, at(`conservation: cash sent ${w.cash} vs kept+held ${keptHeld} + pots ${allPots} + cashed out ${cashedOut}`)).toBe(w.cash);
  expect(owedCredit, at('Money tab credit owed = all pots')).toBe(allPots);
}

// ---------------------------------------------------------------- smoke

describe('audit harness', () => {
  it('sets up, earns credit the real way, and the books balance', async () => {
    const w = await world();
    const ss = await sessionsAll(w);
    expect(ss.length).toBeGreaterThan(3);
    await earnCredit(w, 'Blair');
    await books(w, 'after earn');
    expect(potOf(w, 'Blair')).toBe(1400);
  });
});

// ---------------------------------------------------------------- sweeps

let SCENARIOS = 0;
let INTERLEAVINGS = 0;
let CUTOFFS = 0;

/**
 * Every interleaving of B inside A: for each database call A makes, a fresh
 * world runs A, pauses it just before that call, runs B to the end, then lets
 * A finish. The books are checked after each.
 */
async function sweep<S extends { w: World }>(
  name: string,
  setup: () => Promise<S>,
  A: (s: S) => Promise<any>,
  B: (s: S) => Promise<any>,
  after?: (s: S, ra: any, rb: any) => Promise<void>,
) {
  const probe = await setup();
  const c0 = probe.w.db.calls;
  await A(probe);
  const total = probe.w.db.calls - c0;
  for (let n = 1; n <= total + 1; n++) {
    const s = await setup();
    let rb: any;
    s.w.db.pauseAt = { n: s.w.db.calls + n, before: async () => void (rb = await B(s)) };
    const ra = await A(s);
    if (s.w.db.pauseAt) {
      s.w.db.pauseAt = null;
      rb = await B(s);
    }
    await books(s.w, `${name} [B before call ${n} of ${total}]`);
    if (after) await after(s, ra, rb);
    INTERLEAVINGS++;
  }
}

/** A request cut off at each of its writes in turn, then tapped again. Books after each. */
async function cutoffSweep<S extends { w: World }>(name: string, setup: () => Promise<S>, A: (s: S) => Promise<any>, after?: (s: S) => Promise<void>) {
  const probe = await setup();
  const w0 = probe.w.db.writes;
  await A(probe);
  const total = probe.w.db.writes - w0;
  for (let n = 1; n <= total; n++) {
    const s = await setup();
    s.w.db.failAt = s.w.db.writes + n;
    await A(s);
    s.w.db.failAt = null;
    await books(s.w, `${name} [cut at write ${n} of ${total}]`);
    await A(s);
    await books(s.w, `${name} [cut at write ${n}, then retried]`);
    if (after) await after(s);
    CUTOFFS++;
  }
}

const atIso = (w: World, iso: string) => void (w.app.now = Date.parse(iso));
// Tue Oct 27 game: 8-10 PM EDT = 00:00-02:00Z Oct 28. Thu Oct 29: 00:00-02:00Z Oct 30. Tue Nov 3 (after the clock change): 01:00-03:00Z Nov 4.
const OCT27 = '2026-10-27';
const OCT29 = '2026-10-29';
const NOV3 = '2026-11-03';
const NOV5 = '2026-11-05';
const AFTER_OCT27 = '2026-10-28T02:30:00.000Z';
const AFTER_NOV3 = '2026-11-04T03:30:00.000Z';

/** Exactly `cents` in a player's pot, made the real way: earn $14 lots, then cash out the excess. */
async function givePot(w: World, name: string, cents: number) {
  const times = Math.ceil(cents / FLAT);
  await earnCredit(w, name, times);
  const extra = times * FLAT - cents;
  if (extra > 0) {
    expect((await askCashOut(w, name, extra)).status).toBe(200);
    const req = pendingReq(w, name);
    expect((await markRefunded(w, req.id, extra)).status).toBe(200);
  }
  expect(potOf(w, name)).toBe(cents);
}

const usedOn = (w: World, sid: string, name: string) =>
  ledger(w)
    .filter((r) => r.kind === 'used' && r.session_id === sid && r.player_id === w.ids[name] && !r.ended_at && r.reason !== 'cash')
    .reduce((s, r) => s + r.amount_cents, 0);

// ---------------------------------------------------------------- double taps and two devices

describe('double taps and two devices', () => {
  it('I in, twice at once, on one phone and on two phones: credit used once', async () => {
    SCENARIOS++;
    const w = await world();
    await givePot(w, 'Blair', 2000);
    const a = await on(w, NOV3);
    const r = await Promise.all([join(w, 'Blair', a), join(w, 'Blair', a), join(w, 'Blair', a, 1), join(w, 'Blair', a, 2)]);
    expect(r.map((x) => x.status)).toEqual([200, 200, 200, 200]);
    await books(w, 'quad tap join');
    expect(usedOn(w, a, 'Blair')).toBe(1400);
    expect(potOf(w, 'Blair')).toBe(600);
    expect(r.filter((x) => x.data.creditCents).length, 'only one tap reports the credit').toBe(1);
  });

  it('two games tapped at once with $14: the credit goes to one game, never both', async () => {
    SCENARIOS++;
    for (const cents of [1400, 900, 2000, 2800]) {
      const w = await world();
      await givePot(w, 'Casey', cents);
      const a = await on(w, NOV3);
      const b = await on(w, NOV5);
      const c = await on(w, '2026-11-10');
      await Promise.all([join(w, 'Casey', a), join(w, 'Casey', b, 1), join(w, 'Casey', c, 2)]);
      await books(w, `three games at once with ${cents}`);
      const total = usedOn(w, a, 'Casey') + usedOn(w, b, 'Casey') + usedOn(w, c, 'Casey');
      expect(total).toBe(Math.min(cents, 3 * FLAT));
      expect(potOf(w, 'Casey')).toBe(cents - total);
    }
  });

  it('every interleaving of I in on game A inside I in on game B with $14 of credit', async () => {
    SCENARIOS++;
    const setup = async () => {
      const w = await world();
      await givePot(w, 'Casey', 1400);
      return { w, a: await on(w, NOV3), b: await on(w, NOV5) };
    };
    await sweep(
      'join A inside join B',
      setup,
      (s) => join(s.w, 'Casey', s.a),
      (s) => join(s.w, 'Casey', s.b, 1),
      async (s) => expect(usedOn(s.w, s.a, 'Casey') + usedOn(s.w, s.b, 'Casey')).toBe(1400),
    );
  });

  it('drop twice at once, and on two phones: money back once', async () => {
    SCENARIOS++;
    for (const paidCash of [false, true]) {
      const w = await world();
      await givePot(w, 'Devon', 1400);
      const a = await on(w, NOV3);
      if (paidCash) {
        // spend the credit elsewhere first so this seat is paid in cash
        expect((await join(w, 'Devon', await on(w, NOV5))).status).toBe(200);
      }
      expect((await join(w, 'Devon', a)).status).toBe(200);
      if (paidCash) expect((await iPaid(w, 'Devon', a)).status).toBe(200);
      await books(w, 'before drops');
      const before = potOf(w, 'Devon');
      await Promise.all([drop(w, 'Devon', a), drop(w, 'Devon', a), drop(w, 'Devon', a, 1)]);
      await books(w, `triple drop paidCash=${paidCash}`);
      expect(potOf(w, 'Devon')).toBe(before + 1400);
    }
  });

  it('drop, rejoin, drop, rejoin ... (Undo sends nothing) with credit, part credit and cash', async () => {
    SCENARIOS++;
    for (const start of [0, 300, 1400, 2000]) {
      const w = await world();
      if (start) await givePot(w, 'Emery', start);
      const a = await on(w, NOV3);
      let pot = start;
      for (let i = 0; i < 5; i++) {
        expect((await join(w, 'Emery', a)).status).toBe(200);
        await books(w, `start=${start} join #${i}`);
        if (i % 2 === 1 && (await shownOwe(w, 'Emery', a)) > 0) {
          expect((await iPaid(w, 'Emery', a)).status).toBe(200);
          await books(w, `start=${start} paid #${i}`);
        }
        expect((await drop(w, 'Emery', a)).status).toBe(200);
        await books(w, `start=${start} drop #${i}`);
        pot = potOf(w, 'Emery');
      }
      expect(pot).toBeGreaterThanOrEqual(start);
    }
  });

  it('I paid twice at once, on two phones: one payment', async () => {
    SCENARIOS++;
    const w = await world();
    const a = await on(w, NOV3);
    await join(w, 'Frankie', a);
    const owe = await shownOwe(w, 'Frankie', a);
    const r = await Promise.all([iPaid(w, 'Frankie', a, 0, owe), iPaid(w, 'Frankie', a, 1, owe), iPaid(w, 'Frankie', a, 0, owe)]);
    expect(r.filter((x) => x.data.changed).length).toBe(1);
    await books(w, 'triple I paid');
  });

  it('Use credit twice at once and on two phones', async () => {
    SCENARIOS++;
    const w = await world();
    const a = await on(w, NOV3);
    await join(w, 'Gale', a); // no credit yet: owes $14
    await givePot(w, 'Gale', 2000); // credit arrives later
    await books(w, 'before use credit');
    const r = await Promise.all([useCredit(w, 'Gale', a), useCredit(w, 'Gale', a, 1), useCredit(w, 'Gale', a)]);
    expect(r.filter((x) => x.status === 200).length).toBe(1);
    await books(w, 'triple use credit');
    expect(usedOn(w, a, 'Gale')).toBe(1400);
    expect(potOf(w, 'Gale')).toBe(600);
  });

  it('cash-out request twice at once, two phones: one request', async () => {
    SCENARIOS++;
    const w = await world();
    await givePot(w, 'Harper', 1400);
    const r = await Promise.all([askCashOut(w, 'Harper', 1400), askCashOut(w, 'Harper', 1000, 1), askCashOut(w, 'Harper', 1400, 2)]);
    expect(r.filter((x) => x.status === 200).length).toBe(1);
    await books(w, 'triple ask');
  });

  it('cash-out request while joining, every interleaving: the $14 goes to one of them', async () => {
    SCENARIOS++;
    const setup = async () => {
      const w = await world();
      await givePot(w, 'Indy', 1400);
      return { w, a: await on(w, NOV3) };
    };
    await sweep(
      'ask inside join',
      setup,
      (s) => join(s.w, 'Indy', s.a),
      (s) => askCashOut(s.w, 'Indy', 1400, 1),
      async (s) => {
        const req = pendingReq(s.w, 'Indy');
        expect(usedOn(s.w, s.a, 'Indy') + (req?.amount_cents ?? 0)).toBe(1400);
      },
    );
    await sweep(
      'join inside ask',
      setup,
      (s) => askCashOut(s.w, 'Indy', 1400, 1),
      (s) => join(s.w, 'Indy', s.a),
      async (s) => {
        const req = pendingReq(s.w, 'Indy');
        expect(usedOn(s.w, s.a, 'Indy') + (req?.amount_cents ?? 0)).toBe(1400);
      },
    );
  });
});

// ---------------------------------------------------------------- finalize at every N

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
function shuffle<T>(r: () => number, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Money = 'credit' | 'part' | 'over' | 'cash' | 'unpaid' | 'org_paid';

/** Sign `names` up for game `sid` with the given money mix (credit first, so it is used at sign-up). */
async function signUp(w: World, sid: string, who: [string, Money][]) {
  for (const [n, m] of who) {
    if (m === 'credit') await givePot(w, n, 1400);
    if (m === 'part') await givePot(w, n, 500);
    if (m === 'over') await givePot(w, n, 2000);
  }
  for (const [n] of who) {
    const r = n === ORG ? await w.org.call('POST', `/api/admin/sessions/${sid}/me`, { in: true }) : await join(w, n, sid);
    expect(r.status, r.text).toBe(200);
  }
  await books(w, 'signed up');
  for (const [n, m] of who) {
    if (m === 'cash') expect((await iPaid(w, n, sid)).status).toBe(200);
    if (m === 'org_paid') expect((await markPaid(w, n, sid)).status).toBe(200);
  }
  await books(w, 'paid up');
}

/** Everyone on the owed list for `sid` pays what their screen says. */
async function everyonePays(w: World, sid: string, names: string[]) {
  for (const n of names) {
    if (n === ORG) continue;
    const owe = await shownOwe(w, n, sid);
    if (owe > 0) {
      const r = await iPaid(w, n, sid, 0, owe);
      expect(r.status, r.text).toBe(200);
    }
  }
}

describe('finalize at every N from 4 to 10', () => {
  const MIX: Money[] = ['credit', 'part', 'over', 'cash', 'unpaid', 'org_paid'];
  for (let N = 3; N <= 10; N++) {
    for (const orgPlays of [true, false]) {
      it(`N=${N}${N < 4 ? ' (finalize anyway)' : ''}, organizer ${orgPlays ? 'plays' : 'does not play'}, mixed money, then reopen and redo`, async () => {
        for (let seed = 1; seed <= 3; seed++) {
          SCENARIOS++;
          const r = rng(N * 100 + seed + (orgPlays ? 7 : 0));
          const w = await world({ maxPlayers: 12 });
          const sid = await on(w, OCT27);
          const others = shuffle(r, OTHERS);
          const playersNeeded = orgPlays ? N - 1 : N;
          const notPlaying = Math.min(Math.floor(r() * 3), 11 - playersNeeded);
          const inGame = others.slice(0, playersNeeded + notPlaying);
          const who: [string, Money][] = inGame.map((n) => [n, pick(r, MIX)]);
          if (orgPlays) who.push([ORG, 'unpaid']);
          await signUp(w, sid, who);
          const potsBefore = new Map(inGame.map((n) => [n, potOf(w, n)]));
          const paidBefore = new Map(inGame.map((n) => [n, seatRow(w, sid, n)]));
          atIso(w, AFTER_OCT27);
          const played = [...inGame.slice(0, playersNeeded), ...(orgPlays ? [ORG] : [])];
          const f = await finalize(w, sid, played);
          expect(f.status, f.text).toBe(200);
          const price = finalPrice(FLAT, N);
          expect(f.data.priceCents).toBe(price);
          await books(w, `N=${N} seed=${seed} finalized`);
          // Explicit amounts for the plain cases.
          for (const n of inGame) {
            const before = paidBefore.get(n);
            const didPlay = played.includes(n);
            const paid = before.payment_status === 'paid' ? before.payment_amount_cents : 0;
            const delta = potOf(w, n) - potsBefore.get(n)!;
            if (paid === FLAT) expect(delta, `${n} paid $14, ${didPlay ? 'played' : 'did not play'}`).toBe(didPlay ? FLAT - price : FLAT);
          }
          await everyonePays(w, sid, inGame);
          await books(w, `N=${N} seed=${seed} everyone paid`);
          // Reopen and redo with a different number.
          const ro = await reopen(w, sid);
          await books(w, `N=${N} seed=${seed} reopen (${ro.status})`);
          if (ro.status === 200) {
            const N2 = 4 + Math.floor(r() * (Math.min(10, inGame.length + (orgPlays ? 1 : 0)) - 3));
            const pool = [...inGame, ...(orgPlays ? [ORG] : [])];
            const played2 = shuffle(r, pool).slice(0, Math.min(N2, pool.length));
            const f2 = await finalize(w, sid, played2);
            expect(f2.status, f2.text).toBe(200);
            await books(w, `N=${N} seed=${seed} refinalized with ${played2.length}`);
            await everyonePays(w, sid, inGame);
            await books(w, `N=${N} seed=${seed} everyone paid again`);
            const ro2 = await reopen(w, sid);
            await books(w, `N=${N} seed=${seed} second reopen (${ro2.status})`);
            if (ro2.status === 200) {
              expect((await finalize(w, sid, 'everyone')).status).toBe(200);
              await books(w, `N=${N} seed=${seed} everyone played`);
            }
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------- races around Finalize, Reopen, Cancel, cash out

/** Tue Oct 27: Blair paid with credit, Casey part credit ($5), Devon and Gale cash, Emery unpaid, Frankie unpaid (credit arrives after), organizer plays. Clock after the game. */
async function playedGame() {
  const w = await world();
  const sid = await on(w, OCT27);
  await givePot(w, 'Blair', 1400);
  await givePot(w, 'Casey', 500);
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) expect((await join(w, n, sid)).status).toBe(200);
  expect((await w.org.call('POST', `/api/admin/sessions/${sid}/me`, { in: true })).status).toBe(200);
  expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
  expect((await markPaid(w, 'Gale', sid)).status).toBe(200);
  await givePot(w, 'Frankie', 1400);
  atIso(w, AFTER_OCT27);
  return { w, sid };
}

describe('races: Finalize and Reopen against every other tap', () => {
  const finalizeAll = (s: { w: World; sid: string }) => finalize(s.w, s.sid, 'everyone');
  const finalizeSome = (s: { w: World; sid: string }) => finalize(s.w, s.sid, ['Blair', 'Casey', 'Devon', 'Gale', ORG]);
  const shownThen = async (s: { w: World; sid: string }, n: string) => shownOwe(s.w, n, s.sid);

  it('Finalize vs I paid (the amount shown before Finalize)', async () => {
    SCENARIOS++;
    await sweep('finalize ⊃ Emery I paid $14', playedGame, finalizeAll, async (s) => iPaid(s.w, 'Emery', s.sid, 0, FLAT));
    await sweep('Emery I paid $14 ⊃ finalize', playedGame, async (s) => iPaid(s.w, 'Emery', s.sid, 0, FLAT), finalizeAll);
    await sweep('finalize ⊃ Casey I paid $9', playedGame, finalizeSome, async (s) => iPaid(s.w, 'Casey', s.sid, 0, 900));
    await sweep('organizer Mark paid ⊃ finalize', playedGame, async (s) => markPaid(s.w, 'Emery', s.sid), finalizeAll);
  });

  it('Finalize vs Use credit, Undo credit, Unmark, a second Finalize', async () => {
    SCENARIOS++;
    await sweep('finalize ⊃ Frankie use credit', playedGame, finalizeAll, (s) => useCredit(s.w, 'Frankie', s.sid));
    // 'Frankie use credit ⊃ finalize' breaks: BUG 2 below.
    await sweep('finalize ⊃ Blair undo credit', playedGame, finalizeAll, (s) => undoCredit(s.w, 'Blair', s.sid));
    await sweep('finalize ⊃ unmark Blair', playedGame, finalizeAll, (s) => unmark(s.w, 'Blair', s.sid));
    await sweep('finalize ⊃ unmark Casey credit', playedGame, finalizeSome, (s) => unmark(s.w, 'Casey', s.sid));
    await sweep('finalize everyone ⊃ finalize some', playedGame, finalizeAll, finalizeSome);
  });

  const finalized = async () => {
    const s = await playedGame();
    expect((await finalize(s.w, s.sid, 'everyone')).status).toBe(200);
    await books(s.w, 'finalized');
    return s;
  };

  it('Reopen vs paying, using credit, unmark, cash out, a second Reopen, Finalize', async () => {
    SCENARIOS++;
    const reopenIt = (s: { w: World; sid: string }) => reopen(s.w, s.sid);
    await sweep('reopen ⊃ Emery I paid (shown)', finalized, reopenIt, async (s) => iPaid(s.w, 'Emery', s.sid));
    await sweep('Emery I paid (shown) ⊃ reopen', finalized, async (s) => iPaid(s.w, 'Emery', s.sid, 0, await shownThen(s, 'Emery')), reopenIt);
    await sweep('reopen ⊃ Frankie use credit', finalized, reopenIt, (s) => useCredit(s.w, 'Frankie', s.sid));
    await sweep('reopen ⊃ unmark Devon', finalized, reopenIt, (s) => unmark(s.w, 'Devon', s.sid));
    await sweep('reopen ⊃ Devon cash out of the $5 back', finalized, reopenIt, (s) => askCashOut(s.w, 'Devon', 500));
    await sweep('Devon cash out ⊃ reopen', finalized, (s) => askCashOut(s.w, 'Devon', 500), reopenIt);
    await sweep('reopen ⊃ reopen', finalized, reopenIt, reopenIt);
    await sweep('reopen ⊃ (reopen, finalize some)', finalized, reopenIt, async (s) => {
      await reopen(s.w, s.sid);
      return finalizeSome(s);
    });
    await sweep('Blair joins Nov 3 with the $5 back ⊃ reopen', finalized, async (s) => join(s.w, 'Blair', await on(s.w, NOV3)), reopenIt);
  });

  it('Unmark vs cash out of the credit it would take back', async () => {
    SCENARIOS++;
    await sweep('unmark Devon ⊃ Devon cash out $5', finalized, (s) => unmark(s.w, 'Devon', s.sid), (s) => askCashOut(s.w, 'Devon', 500));
    await sweep('Devon cash out $5 ⊃ unmark Devon', finalized, (s) => askCashOut(s.w, 'Devon', 500), (s) => unmark(s.w, 'Devon', s.sid));
    await sweep('unmark Devon ⊃ Devon joins Nov 3', finalized, (s) => unmark(s.w, 'Devon', s.sid), async (s) => join(s.w, 'Devon', await on(s.w, NOV3)));
    await sweep('Devon Didn\'t pay ⊃ Devon joins Nov 3', finalized, (s) => iDidNotPay(s.w, 'Devon', s.sid, FLAT), async (s) => join(s.w, 'Devon', await on(s.w, NOV3)));
  });
});

describe('races: Cancel against joins and drops', () => {
  const upcoming = async () => {
    const w = await world();
    const sid = await on(w, NOV3);
    await givePot(w, 'Blair', 1400);
    await givePot(w, 'Casey', 500);
    await givePot(w, 'Harper', 900);
    for (const n of ['Casey', 'Devon', 'Emery']) expect((await join(w, n, sid)).status).toBe(200);
    expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
    expect((await iPaid(w, 'Casey', sid)).status).toBe(200);
    return { w, sid };
  };
  const cancelIt = (s: { w: World; sid: string }) => cancel(s.w, s.sid);
  it('cancel vs I in (with credit), drop, I paid, use cash out, organizer add, reopen', async () => {
    SCENARIOS++;
    await sweep('cancel ⊃ Blair I in', upcoming, cancelIt, (s) => join(s.w, 'Blair', s.sid));
    await sweep('Blair I in ⊃ cancel', upcoming, (s) => join(s.w, 'Blair', s.sid), cancelIt);
    await sweep('cancel ⊃ Casey drop', upcoming, cancelIt, (s) => drop(s.w, 'Casey', s.sid));
    await sweep('Casey drop ⊃ cancel', upcoming, (s) => drop(s.w, 'Casey', s.sid), cancelIt);
    await sweep('cancel ⊃ Emery I paid', upcoming, cancelIt, (s) => iPaid(s.w, 'Emery', s.sid, 0, FLAT));
    await sweep('Emery I paid ⊃ cancel', upcoming, (s) => iPaid(s.w, 'Emery', s.sid, 0, FLAT), cancelIt);
    await sweep('cancel ⊃ organizer adds Harper', upcoming, cancelIt, (s) => orgAdd(s.w, 'Harper', s.sid));
    await sweep('cancel ⊃ cancel', upcoming, cancelIt, cancelIt);
    await sweep('cancel ⊃ (cancel, un-cancel, Blair I in)', upcoming, cancelIt, async (s) => {
      await cancel(s.w, s.sid);
      await uncancel(s.w, s.sid);
      return join(s.w, 'Blair', s.sid);
    });
  });
});

// ---------------------------------------------------------------- CONFIRMED FAILURES (minimal repros)
//
// Each test below states the correct behavior and currently FAILS (it.fails), so this file stays green as a
// regression suite and flips red the day a fix lands (then turn it.fails back into it).

describe('confirmed failures', () => {
  it.fails('BUG 1: cash held against a seat that then did not play is counted as Collected on the Money tab (and is also back in the pot)', async () => {
    const w = await world();
    const sid = await on(w, OCT27);
    await givePot(w, 'Blair', 500);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) expect((await join(w, n, sid)).status).toBe(200);
    for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) expect((await iPaid(w, n, sid)).status).toBe(200);
    atIso(w, AFTER_OCT27);
    // 5 played: $11 each. Blair ($5 credit at sign-up) pays the $6 his screen shows.
    expect((await finalize(w, sid, 'everyone')).status).toBe(200);
    expect(await shownOwe(w, 'Blair', sid)).toBe(600);
    expect((await iPaid(w, 'Blair', sid)).status).toBe(200);
    // Reopen (his $6 cash is held against the seat), then redo: Blair did not play after all.
    expect((await reopen(w, sid)).status).toBe(200);
    expect((await finalize(w, sid, ['Casey', 'Devon', 'Emery', 'Frankie'])).status).toBe(200);
    // Blair got everything back: $5 credit + $6 cash = $11 in his pot.
    expect(potOf(w, 'Blair')).toBe(1100);
    // The group kept 4 x $14 = $56 from this game, and nothing from Blair.
    const oct = (await w.org.call('GET', '/api/admin/money?month=2026-10')).data;
    const game = oct.sessions.find((x: any) => x.id === sid);
    expect(game.collectedCents).toBe(5600); // actually $62: Blair's $6 counted twice (collected AND in his pot)
  });

  for (const frankiePlays of [false, true]) {
    it(`BUG 2${frankiePlays ? 'b' : 'a'} (fixed in 58b0953 while this audit ran): Use credit tapped as the organizer finalizes spends credit ${frankiePlays ? 'at the old $14 on an $8 seat' : 'on a seat that did not play'}`, async () => {
      const { w, sid } = await playedGame(); // 7 in incl. the organizer; Frankie unpaid with $14 credit that arrived later
      const played = frankiePlays ? 'everyone' : ['Blair', 'Casey', 'Devon', 'Emery', 'Gale', ORG];
      // Frankie taps Use credit; the organizer's Finalize lands between the server reading the game and saving the credit.
      w.db.pauseBefore(/'used', \?4, \?5, \?6\s+WHERE/, async () => void expect((await finalize(w, sid, played)).status).toBe(200));
      const r = await useCredit(w, 'Frankie', sid);
      const price = frankiePlays ? finalPrice(FLAT, 7) : 0; // $8, or nothing for a player who did not play
      // Either the tap is refused (and his $14 stays in his pot), or it takes only the price.
      expect({ status: r.status, onSeat: usedOn(w, sid, 'Frankie') }).toEqual(r.status === 200 ? { status: 200, onSeat: price } : { status: r.status, onSeat: 0 });
      expect(potOf(w, 'Frankie')).toBe(FLAT - usedOn(w, sid, 'Frankie'));
    });
  }
});

// ---------------------------------------------------------------- cash out: stale amounts, twice, two games, Mark refunded and undo

describe('cash out prompt and Mark refunded', () => {
  /** Ivy-style: $14 credit, $10 of it asked as cash out; usable $4. */
  const asked = async (askCents = 1000, pot = 1400) => {
    const w = await world();
    await givePot(w, 'Indy', pot);
    expect((await askCashOut(w, 'Indy', askCents)).status).toBe(200);
    return { w, a: await on(w, NOV3), b: await on(w, NOV5), req: pendingReq(w, 'Indy').id as string };
  };

  it('use-cash-out with the right, stale, wrong, zero, negative and huge amounts, twice, and on two games', async () => {
    SCENARIOS++;
    const s = await asked();
    const j = await join(s.w, 'Indy', s.a);
    expect(j.data.creditCents).toBe(400);
    expect(j.data.cashOutOffer?.cents).toBe(1000);
    await books(s.w, 'joined A with $4 usable');
    for (const bad of [0, -100, 999, 1001, 1400, 100000, 1e12, 'x', null]) {
      const r = await useCashOut(s.w, 'Indy', s.a, bad as any);
      expect(r.status, `cents ${bad}`).not.toBe(200);
      await books(s.w, `bad cents ${bad}`);
    }
    const [r1, r2] = await Promise.all([useCashOut(s.w, 'Indy', s.a, 1000), useCashOut(s.w, 'Indy', s.a, 1000, 1)]);
    expect([r1.status, r2.status].filter((x) => x === 200).length).toBe(1);
    await books(s.w, 'double use cash out');
    expect(usedOn(s.w, s.a, 'Indy')).toBe(1400);
    expect(pendingReq(s.w, 'Indy')).toBeUndefined();
    // Game B: nothing left, nothing offered, nothing taken.
    const jb = await join(s.w, 'Indy', s.b);
    expect(jb.data.cashOutOffer).toBeUndefined();
    expect((await useCashOut(s.w, 'Indy', s.b, 1000)).status).not.toBe(200);
    await books(s.w, 'game B');
  });

  it('use-cash-out on two games at once, every interleaving', async () => {
    SCENARIOS++;
    const setup = async () => {
      const s = await asked(1400, 1400);
      await join(s.w, 'Indy', s.a);
      await join(s.w, 'Indy', s.b);
      await books(s.w, 'both joined, $14 asked');
      return s;
    };
    await sweep('use on A ⊃ use on B', setup, (s) => useCashOut(s.w, 'Indy', s.a, 1400), (s) => useCashOut(s.w, 'Indy', s.b, 1400, 1), async (s) => {
      expect(usedOn(s.w, s.a, 'Indy') + usedOn(s.w, s.b, 'Indy')).toBe(1400);
    });
  });

  it('use-cash-out vs Mark refunded, Not now, cancel request, drop, and the organizer refunding the balance', async () => {
    SCENARIOS++;
    const setup = async () => {
      const s = await asked();
      await join(s.w, 'Indy', s.a);
      return s;
    };
    const use = (s: any) => useCashOut(s.w, 'Indy', s.a, 1000);
    await sweep('use ⊃ Mark refunded', setup, use, (s) => markRefunded(s.w, s.req, 1000), async (s) => {
      const req = lastReq(s.w, 'Indy');
      const refunded = ledger(s.w).filter((r) => r.kind === 'refunded' && !r.ended_at).reduce((a, r) => a + r.amount_cents, 0);
      expect(usedOn(s.w, s.a, 'Indy') - 400 + refunded, `request ${req.status}`).toBe(1000);
    });
    await sweep('Mark refunded ⊃ use', setup, (s) => markRefunded(s.w, s.req, 1000), use);
    await sweep('use ⊃ Not now', setup, use, (s) => notNow(s.w, s.req));
    await sweep('use ⊃ cancel request', setup, use, (s) => cancelAsk(s.w, 'Indy'));
    await sweep('use ⊃ drop', setup, use, (s) => drop(s.w, 'Indy', s.a, 1));
    await sweep('drop ⊃ use', setup, (s) => drop(s.w, 'Indy', s.a, 1), use);
    await sweep('use ⊃ refund balance', setup, use, (s) => refundBalance(s.w, 'Indy'));
  });

  it('Mark refunded twice, Mark refunded vs undo, undo twice, undo vs a new request', async () => {
    SCENARIOS++;
    const setup = async () => asked(1400, 1400);
    await sweep('refunded ⊃ refunded', setup, (s) => markRefunded(s.w, s.req, 1400), (s) => markRefunded(s.w, s.req, 1400));
    await sweep('refunded ⊃ undo', setup, (s) => markRefunded(s.w, s.req, 1400), (s) => undoRefunded(s.w, s.req));
    const done = async () => {
      const s = await asked(1400, 1400);
      expect((await markRefunded(s.w, s.req, 1400)).status).toBe(200);
      return s;
    };
    await sweep('undo ⊃ undo', done, (s) => undoRefunded(s.w, s.req), (s) => undoRefunded(s.w, s.req));
    await sweep('undo ⊃ refunded', done, (s) => undoRefunded(s.w, s.req), (s) => markRefunded(s.w, s.req, 1400));
    // After the refund the pot is $0; undo brings back $14 and the request; a new request in between must not double-reserve.
    const s = await done();
    expect((await undoRefunded(s.w, s.req)).status).toBe(200);
    await books(s.w, 'undone');
    expect(potOf(s.w, 'Indy')).toBe(1400);
    expect(pendingReq(s.w, 'Indy')?.amount_cents).toBe(1400);
    expect((await markRefunded(s.w, s.req, 1400)).status).toBe(200);
    await books(s.w, 'refunded again');
    expect(potOf(s.w, 'Indy')).toBe(0);
  });

  it('Mark refunded after the player used part of the request: refused with the old amount, works with the new one', async () => {
    SCENARIOS++;
    const s = await asked(1400, 1400); // whole $14 asked; usable $0
    const j = await join(s.w, 'Indy', s.a);
    expect(j.data.cashOutOffer?.cents).toBe(1400);
    expect((await useCashOut(s.w, 'Indy', s.a, 1400)).status).toBe(200);
    await books(s.w, 'used all of it');
    expect((await markRefunded(s.w, s.req, 1400)).status).not.toBe(200);
    await books(s.w, 'old card refused');
    const s2 = await asked(1000, 1400);
    const j2 = await join(s2.w, 'Indy', s2.a); // $4 usable on the seat, $10 owed, $10 offered
    expect(j2.data.cashOutOffer?.cents).toBe(1000);
    // The offer is all or nothing on the amount shown: a different amount is refused.
    expect((await useCashOut(s2.w, 'Indy', s2.a, 500)).status).not.toBe(200);
    await books(s2.w, 'partial amount refused');
  });

  it('cash out of credit that came back from a game, then the organizer unmarks that payment', async () => {
    SCENARIOS++;
    const { w, sid } = await playedGame();
    expect((await finalize(w, sid, 'everyone')).status).toBe(200); // 7 played: $8, Devon paid $14 cash: $6 back
    expect(potOf(w, 'Devon')).toBe(600);
    expect((await askCashOut(w, 'Devon', 600)).status).toBe(200);
    const u = await unmark(w, 'Devon', sid);
    expect(u.status).toBe(409);
    await books(w, 'unmark refused while the $6 is asked for');
    expect((await markRefunded(w, pendingReq(w, 'Devon').id, 600)).status).toBe(200);
    expect((await unmark(w, 'Devon', sid)).status).toBe(409);
    await books(w, 'unmark refused after the $6 was cashed out');
    expect((await reopen(w, sid)).status).toBe(409);
    await books(w, 'reopen refused');
  });
});

// ---------------------------------------------------------------- requests cut off halfway, then tapped again

describe('cut off halfway, then retried', () => {
  /** Nov 3 with a waitlist: max 4; Blair (credit, in), Casey (part, in), Devon (cash, in), Emery (in), Kai waiting with credit. */
  const base = async () => {
    const w = await world({ maxPlayers: 4 });
    const sid = await on(w, NOV3);
    await givePot(w, 'Blair', 1400);
    await givePot(w, 'Casey', 500);
    await givePot(w, 'Kai', 1400);
    await givePot(w, 'Lee', 2000);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Kai']) expect((await join(w, n, sid)).status).toBe(200);
    expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
    expect((await askCashOut(w, 'Lee', 1000)).status).toBe(200);
    await books(w, 'cut-off base');
    return { w, sid, counted: false };
  };
  /** I paid that counts the cash once, however many tries it takes (the player sent it once). */
  const payOnce = (name: string) => async (s: { w: World; sid: string; counted: boolean }) => {
    const before = seatRow(s.w, s.sid, name)?.payment_status;
    const shown = await shownOwe(s.w, name, s.sid);
    const r = await (await phone(s.w, name)).call('POST', `/api/sessions/${s.sid}/paid`, { paid: true, cents: shown });
    if (!s.counted && before !== 'paid' && seatRow(s.w, s.sid, name)?.payment_status === 'paid') {
      s.w.cash += shown;
      s.counted = true;
    }
    return r;
  };
  const cases: [string, (s: any) => Promise<any>][] = [
    ['Blair drops (credit back, Kai moves in with his credit)', (s) => drop(s.w, 'Blair', s.sid)],
    ['Devon drops (cash back as credit, Kai moves in)', (s) => drop(s.w, 'Devon', s.sid)],
    ['Casey drops (part credit)', (s) => drop(s.w, 'Casey', s.sid)],
    ['Emery I paid', payOnce('Emery')],
    ['Casey I paid the rest', payOnce('Casey')],
    ['Lee I in (credit, cash out pending)', (s) => join(s.w, 'Lee', s.sid)],
    ['organizer removes Blair', (s) => orgRemove(s.w, 'Blair', s.sid)],
    ['organizer moves Casey to the waitlist', (s) => orgWaitlist(s.w, 'Casey', s.sid)],
    ['cancel the game', (s) => cancel(s.w, s.sid)],
    ['Lee asks to cash out more (refused: one open)', (s) => askCashOut(s.w, 'Lee', 500)],
    ['Lee: Mark refunded', (s) => markRefunded(s.w, pendingReq(s.w, 'Lee')?.id ?? 'none', 1000)],
    ['organizer refunds Blair\'s balance (nothing left)', (s) => refundBalance(s.w, 'Blair')],
    ['organizer unmarks Casey ($5 credit)', (s) => unmark(s.w, 'Casey', s.sid)],
    ['Blair Undo credit', (s) => undoCredit(s.w, 'Blair', s.sid)],
  ];
  for (const [name, A] of cases) {
    it(name, async () => {
      SCENARIOS++;
      await cutoffSweep(name, base, A);
    });
  }

  it('Lee I in, then Use it on the cash-out prompt, cut off', async () => {
    SCENARIOS++;
    const setup = async () => {
      const s = await base();
      await drop(s.w, 'Emery', s.sid); // room for Lee
      await drop(s.w, 'Kai', s.sid);
      expect((await join(s.w, 'Lee', s.sid)).data.cashOutOffer?.cents).toBe(400);
      await books(s.w, 'Lee in with $10 usable, $4 offered');
      return s;
    };
    await cutoffSweep('use cash out', setup, (s) => useCashOut(s.w, 'Lee', s.sid, 400));
  });

  const finalizedBase = async () => {
    const { w, sid } = await playedGame();
    return { w, sid, counted: false };
  };
  it('Finalize, Reopen, Unmark after Finalize, I paid after Finalize, cut off', async () => {
    SCENARIOS++;
    await cutoffSweep('finalize', finalizedBase, (s) => finalize(s.w, s.sid, ['Blair', 'Casey', 'Devon', 'Gale', 'Frankie', ORG]));
    const fin = async () => {
      const s = await finalizedBase();
      expect((await finalize(s.w, s.sid, ['Blair', 'Casey', 'Devon', 'Gale', 'Emery', ORG])).status).toBe(200);
      await books(s.w, 'finalized (Frankie did not play)');
      return s;
    };
    await cutoffSweep('reopen', fin, (s) => reopen(s.w, s.sid));
    await cutoffSweep('unmark Devon after finalize', fin, (s) => unmark(s.w, 'Devon', s.sid));
    await cutoffSweep('unmark Blair (credit) after finalize', fin, (s) => unmark(s.w, 'Blair', s.sid));
    await cutoffSweep('Casey pays the rest after finalize', fin, payOnce('Casey'));
    await cutoffSweep('Emery pays after finalize', fin, payOnce('Emery'));
  });
});

// ---------------------------------------------------------------- the clock: deadline, start, end, Sun Nov 1

describe('the clock', () => {
  it('drops at deadline-1ms, the deadline, start-1ms and the start; finalize at end-1ms and the end', async () => {
    SCENARIOS++;
    for (const sidDate of [OCT27, NOV3]) {
      const w = await world();
      const sid = await on(w, sidDate);
      const s = sessionRow(w, sid);
      const deadline = Date.parse(s.cancellation_deadline_at);
      const start = Date.parse(s.starts_at);
      const end = Date.parse(s.ends_at);
      await givePot(w, 'Blair', 1400);
      await givePot(w, 'Casey', 500);
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) expect((await join(w, n, sid)).status).toBe(200);
      expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
      expect((await iPaid(w, 'Emery', sid)).status).toBe(200);
      const tries: [string, number][] = [
        ['Blair', deadline - 1],
        ['Casey', deadline],
        ['Devon', start - 1],
        ['Emery', start],
      ];
      for (const [n, t] of tries) {
        w.app.now = t;
        const before = potOf(w, n);
        const r = await drop(w, n, sid);
        await books(w, `${sidDate} ${n} drops at ${new Date(t).toISOString()}`);
        if (t < start) {
          expect(r.status).toBe(200);
          expect(potOf(w, n) - before, `${n} money back`).toBe(n === 'Casey' ? 500 : FLAT);
        } else {
          expect(r.status).toBe(409);
          expect(potOf(w, n)).toBe(before);
        }
      }
      // A join at the start is refused, a second before is fine (and uses credit).
      w.app.now = start;
      expect((await join(w, 'Blair', sid)).status).toBe(409);
      w.app.now = end - 1;
      expect((await finalize(w, sid, 'everyone')).status).toBe(409);
      w.app.now = end;
      const f = await finalize(w, sid, 'everyone');
      expect(f.status, f.text).toBe(200);
      expect(f.data.played).toBe(3); // Emery (could not drop at the start), Frankie, Gale
      await books(w, `${sidDate} finalized at the end`);
    }
  });

  it('games around Sun Nov 1 (Sat 11 PM, 1:30 AM twice): the right month, the right price, the books', async () => {
    SCENARIOS++;
    const w = await world();
    const times = ['2026-11-01T03:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']; // Sat 11 PM EDT, 1:30 AM EDT, 1:30 AM EST
    const ids: string[] = [];
    for (const t of times) {
      const r = await w.org.call('POST', '/api/admin/sessions', { startsAt: t, endsAt: new Date(Date.parse(t) + 2 * HOUR).toISOString() });
      expect(r.status, r.text).toBe(200);
      ids.push(r.data.id);
    }
    await givePot(w, 'Blair', 2000);
    for (const [i, sid] of ids.entries()) {
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].slice(0, 4 + (i % 2))) expect((await join(w, n, sid)).status).toBe(200);
      for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) if ((await shownOwe(w, n, sid)) > 0) await iPaid(w, n, sid);
      await books(w, `dst game ${i} set`);
    }
    // Pay-from-8-AM card on the day of the 1:30 AM EST game.
    w.app.now = Date.parse('2026-11-01T13:00:00.000Z'); // 8:00 AM EST
    for (const sid of ids) {
      const r = await finalize(w, sid, 'everyone');
      expect(r.status, r.text).toBe(200);
      await books(w, `dst finalize ${sid.slice(0, 6)}`);
    }
    await everyonePays(w, ids[0], ['Blair']);
    await everyonePays(w, ids[1], ['Blair']);
    await everyonePays(w, ids[2], ['Blair']);
    await books(w, 'dst all paid');
    const oct = (await w.org.call('GET', '/api/admin/money?month=2026-10')).data;
    const nov = (await w.org.call('GET', '/api/admin/money?month=2026-11')).data;
    expect(oct.sessions.some((s: any) => s.id === ids[0]), 'Sat Oct 31 11 PM is an October game').toBe(true);
    expect(nov.sessions.some((s: any) => s.id === ids[0])).toBe(false);
    expect(nov.sessions.filter((s: any) => ids.slice(1).includes(s.id)).length).toBe(2);
  });
});

// ---------------------------------------------------------------- random sequences

let RANDOM_SEQS = 0;
let RANDOM_STEPS = 0;
const OP_STATS = new Map<string, number>();
const stat = (op: number, res: any) => {
  const k = `${op}:${res === null ? 'skip' : res?.status}`;
  OP_STATS.set(k, (OP_STATS.get(k) ?? 0) + 1);
};

/**
 * One random life of the group: four games (Oct 27, Oct 29, Nov 3 across the clock change, Nov 5), a random
 * max, random starting credit, and random taps by everyone, sometimes two at once, sometimes on a second
 * phone, with the clock moving past each game so it can be finalized, reopened, paid, unmarked. The books
 * after every step.
 */
async function randomLife(seed: number, steps: number) {
  const r = rng(seed);
  const w = await world({ maxPlayers: pick(r, [4, 5, 6, 8, 10]) });
  const games = [await on(w, OCT27), await on(w, OCT29), await on(w, NOV3), await on(w, NOV5)];
  const people = shuffle(r, OTHERS).slice(0, 4 + Math.floor(r() * 6));
  for (const p of people) {
    const c = pick(r, [0, 0, 300, 500, 1400, 1400, 2000, 2800]);
    if (c) await givePot(w, p, c);
  }
  await books(w, `seed ${seed} start`);
  const lastShown = new Map<string, number>();
  const offers = new Map<string, number>();
  const clock = [
    Date.parse('2026-10-26T16:00:00.000Z'),
    Date.parse(AFTER_OCT27),
    Date.parse('2026-10-30T02:30:00.000Z'),
    Date.parse(AFTER_NOV3),
    Date.parse('2026-11-06T03:30:00.000Z'),
  ];
  let phase = 0;
  const log: string[] = [];

  const q = (sql: string, ...a: unknown[]) => w.app.db.raw.prepare(sql).all(...(a as any[])) as any[];
  const nameOf = new Map(Object.entries(w.ids).map(([n, id]) => [id, n]));
  // Mostly a tap that can do something (a seat that owes, a game still open), sometimes anything at all.
  const smart = <T,>(good: T[], any: () => T) => (good.length && r() < 0.8 ? pick(r, good) : any());
  const openGame = () => smart(games.filter((g) => Date.parse(sessionRow(w, g).starts_at) > w.app.now && sessionRow(w, g).status !== 'canceled'), () => pick(r, games));
  const seatWhere = (cond: string) =>
    q(`SELECT sp.session_id AS g, sp.player_id AS p FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE sp.player_id <> ? AND ${cond}`, w.ids[ORG])
      .filter((x) => games.includes(x.g) && people.includes(nameOf.get(x.p)!))
      .map((x) => [nameOf.get(x.p)!, x.g] as [string, string]);
  const anySeat = (): [string, string] => [pick(r, people), pick(r, games)];
  const owing = () => smart(seatWhere("sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.status <> 'canceled'"), anySeat);
  const paidSeat = () => smart(seatWhere("sp.payment_status = 'paid' AND sp.refunded_at IS NULL"), anySeat);
  const inSeat = () => smart(seatWhere("sp.status IN ('confirmed', 'waitlisted') AND s.status <> 'canceled'"), anySeat);
  const gameWhere = (cond: string) => smart(q(`SELECT id FROM sessions WHERE ${cond}`).map((x) => x.id).filter((g) => games.includes(g)), () => pick(r, games));

  const ops: [number, (tag: string) => Promise<unknown>][] = [
    [10, async () => {
      const p = pick(r, people);
      const g = openGame();
      const res = await join(w, p, g, Math.floor(r() * 2));
      if (res.data?.cashOutOffer) offers.set(`${p}:${g}`, res.data.cashOutOffer.cents);
      return res;
    }],
    [6, async () => {
      const [p, g] = inSeat();
      return drop(w, p, g, Math.floor(r() * 2));
    }],
    [8, async () => {
      const [p, g] = owing();
      const stale = r() < 0.2 ? pick(r, [0, 300, 900, 1100, 1400]) : undefined;
      const shown = stale ?? (await shownOwe(w, p, g));
      const res = await iPaid(w, p, g, Math.floor(r() * 2), shown);
      if (res.status === 200 && res.data.changed) lastShown.set(`${p}:${g}`, shown);
      return res;
    }],
    [3, async () => {
      const [p, g] = owing();
      return markPaid(w, p, g);
    }],
    [2, async () => {
      const [p, g] = r() < 0.5 ? paidSeat() : owing();
      return unmark(w, p, g);
    }],
    [2, async () => {
      const keys = [...lastShown.keys()];
      if (!keys.length) return null;
      const k = pick(r, keys);
      const [p, g] = k.split(':');
      const seat = seatRow(w, g, p);
      if (!seat?.self_paid_at) return null;
      const res = await iDidNotPay(w, p, g, lastShown.get(k)!);
      if (res.status === 200 && res.data.changed) lastShown.delete(k);
      return res;
    }],
    [4, async () => {
      const [p, g] = owing();
      return useCredit(w, p, g, Math.floor(r() * 2));
    }],
    [2, async () => {
      const [p, g] = paidSeat();
      return undoCredit(w, p, g);
    }],
    [3, async () => {
      const p = pick(r, people);
      const v = await view(w, p);
      const cents = Math.max(100, Math.floor((v.credit.usableCents * (r() < 0.5 ? 1 : r())) / 100) * 100);
      return askCashOut(w, p, cents, Math.floor(r() * 2));
    }],
    [1, async () => cancelAsk(w, pick(r, people))],
    [3, async () => {
      const keys = [...offers.keys()];
      if (!keys.length) return null;
      const k = pick(r, keys);
      const [p, g] = k.split(':');
      return useCashOut(w, p, g, r() < 0.8 ? offers.get(k)! : pick(r, [100, 400, 1000, 1400]));
    }],
    [3, async () => {
      const reqs = q("SELECT * FROM refund_requests ORDER BY status = 'pending' DESC");
      if (!reqs.length) return null;
      const x = r() < 0.7 ? reqs[0] : pick(r, reqs);
      const a = r();
      if (a < 0.5) return markRefunded(w, x.id, r() < 0.8 ? x.amount_cents : x.amount_cents + 100);
      if (a < 0.75) return notNow(w, x.id);
      return undoRefunded(w, x.id);
    }],
    [1, async () => refundBalance(w, pick(r, people))],
    [3, async () => orgAdd(w, pick(r, people), openGame())],
    [2, async () => {
      const [p, g] = inSeat();
      return orgRemove(w, p, g);
    }],
    [1, async () => {
      const [p, g] = inSeat();
      return orgWaitlist(w, p, g);
    }],
    [1, async () => cancel(w, r() < 0.5 ? openGame() : pick(r, games))],
    [1, async () => uncancel(w, gameWhere("status = 'canceled'"))],
    [5, async () => {
      const g = gameWhere(`finalized_at IS NULL AND status <> 'canceled' AND ends_at <= '${new Date(w.app.now).toISOString()}'`);
      const conf = q("SELECT p.display_name AS n FROM session_players sp JOIN players p ON p.id = sp.player_id WHERE sp.session_id = ? AND sp.status = 'confirmed'", g).map((x) => x.n);
      return finalize(w, g, r() < 0.4 ? 'everyone' : conf.filter(() => r() < 0.8));
    }],
    [3, async () => reopen(w, gameWhere('finalized_at IS NOT NULL'))],
    [2, async () => {
      // The organizer plays (or drops) like a player; never uses credit.
      const g = openGame();
      return w.org.call('POST', `/api/admin/sessions/${g}/me`, { in: r() < 0.7 });
    }],
    [1, async () => w.org.call('POST', `/api/admin/sessions/${pick(r, games)}/payment`, { playerId: w.ids[ORG], paid: r() < 0.7 })],
    [1, async () => w.org.call('POST', `/api/admin/players/${w.ids[pick(r, people)]}/credit-refund`, { refunded: false })],
    [2, async () => {
      // A substitute claim link (texted by the organizer).
      const g = openGame();
      const links = await w.org.call('POST', `/api/admin/sessions/${g}/links`, { kind: 'claim' });
      const draft = links.data?.drafts?.find((d: any) => people.includes(d.name));
      if (!draft) return null;
      const token = String(draft.url).split('/t/')[1];
      const c = await phone(w, draft.name);
      return c.call('POST', '/api/link/act', { token, action: 'claim' });
    }],
    [2, async () => {
      // Pay what the screen says on a finalized game (after the price changed).
      const [p, g] = smart(seatWhere("sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.finalized_at IS NOT NULL"), anySeat);
      const shown = await shownOwe(w, p, g);
      const res = await iPaid(w, p, g, 0, shown);
      if (res.status === 200 && res.data.changed) lastShown.set(`${p}:${g}`, shown);
      return res;
    }],
  ];
  const total = ops.reduce((s, [wt]) => s + wt, 0);
  const one = () => {
    let x = r() * total;
    for (const [wt, f] of ops) {
      x -= wt;
      if (x < 0) return f;
    }
    return ops[0][1];
  };
  // Pairs that run at once (Use credit with Finalize was BUG 2, fixed in 58b0953). An organizer Unmark is never
  // paired (the book reads the seat around it).
  const pairable = new Set([0, 1, 2, 3, 6, 8, 10, 11, 13, 14, 16, 18, 19, 20, 23]);
  for (let i = 0; i < steps; i++) {
    // A second passes between taps (so every Finalize gets its own time, as on the real server).
    w.app.now += 1000;
    if (phase < clock.length - 1 && r() < 0.045) {
      phase++;
      w.app.now = clock[phase];
      log.push(`clock -> ${new Date(w.app.now).toISOString()}`);
    } else if (r() < 0.2) {
      const idx = [...pairable];
      const a = pick(r, idx);
      const b = pick(r, idx);
      log.push(`pair ${a}+${b}`);
      const [ra, rb] = await Promise.all([ops[a][1]('a'), ops[b][1]('b')]);
      stat(a, ra);
      stat(b, rb);
    } else {
      const f = one();
      const k = ops.findIndex((o) => o[1] === f);
      log.push(`op ${k}`);
      stat(k, await f(''));
    }
    RANDOM_STEPS++;
    try {
      await books(w, `seed ${seed} step ${i}`);
    } catch (err) {
      if (process.env.AUDIT_DEBUG) {
        console.log(log.join('\n'));
        dump(w, `seed ${seed} step ${i}`);
      }
      throw err;
    }
  }
  RANDOM_SEQS++;
}

describe('random lives', () => {
  const SEEDS = Number(process.env.AUDIT_SEEDS ?? 24);
  const STEPS = Number(process.env.AUDIT_STEPS ?? 60);
  for (let block = 0; block < 4; block++) {
    it(`seeds ${block * (SEEDS / 4) + 1}..${(block + 1) * (SEEDS / 4)}, ${STEPS} steps each`, async () => {
      for (let seed = block * (SEEDS / 4) + 1; seed <= (block + 1) * (SEEDS / 4); seed++) await randomLife(seed, STEPS);
      if (process.env.AUDIT_DEBUG) console.log([...OP_STATS].sort().map(([k, v]) => `${k}=${v}`).join(' '));
    });
  }
});



describe('confirmed failures (exact interleavings with the clock moving)', () => {
  it('BUG 3: a Reopen read before another device reopened and finalized again wipes the new credit back (game stays finalized)', async () => {
    const { w, sid } = await playedGame();
    expect((await finalize(w, sid, 'everyone')).status).toBe(200); // 7 played: $8; Blair (credit), Devon and Gale (cash) get $6 back
    const t0 = w.app.now;
    w.app.now = t0 + 60_000;
    // Organizer device 1 taps Reopen. Before its write lands, device 2 (a minute later) reopens and finalizes with 6 played.
    const g = w.db.pauseBefore(/ended_reason = 'undone' WHERE credit_ledger\.kind = 'kept'/, async () => {
      w.app.now = t0 + 120_000;
      expect((await reopen(w, sid)).status).toBe(200);
      expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Gale', ORG])).status).toBe(200); // $9: $5 back each
      w.app.now = t0 + 60_000;
    });
    const r = await reopen(w, sid);
    expect(g.used).toBe(true);
    expect(r.status).toBe(409); // device 1 is told "This game just changed"...
    expect(sessionRow(w, sid).finalized_at).not.toBeNull(); // ...and the game is still finalized at $9...
    // ...so Blair, Devon and Gale still have their $5 back each ($15 in all). Actually: $0 each, the rows were ended.
    expect([potOf(w, 'Blair'), potOf(w, 'Devon'), potOf(w, 'Gale')]).toEqual([500, 500, 500]);
  });

  it('BUG 4a: I paid $8 lands after a reopen and redo at the same $8 that says they did not play: kept as paid', async () => {
    const w = await world();
    const sid = await on(w, OCT27);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Lee', 'Kai']) expect((await join(w, n, sid)).status).toBe(200);
    atIso(w, AFTER_OCT27);
    expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Kai'])).status).toBe(200); // 7 of 8: $8
    const shown = await shownOwe(w, 'Emery', sid);
    expect(shown).toBe(800);
    const t0 = w.app.now;
    // Emery taps I paid $8. Meanwhile the organizer fixes who played: Lee played, Emery did not (still 7, still $8).
    const g = w.db.pauseBefore(/UPDATE session_players SET payment_status = 'paid', paid_at = \?1, payment_amount_cents = \?2, self_paid_at = \?3/, async () => {
      w.app.now = t0 + 60_000;
      expect((await reopen(w, sid)).status).toBe(200);
      expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Lee', 'Frankie', 'Gale', 'Kai'])).status).toBe(200);
      w.app.now = t0;
    });
    const r = await iPaid(w, 'Emery', sid, 0, shown);
    expect(g.used).toBe(true);
    const seat = seatRow(w, sid, 'Emery');
    // Correct: refused (he looks again and owes nothing), or his $8 comes back as credit. Actually: 200, kept as paid on a did-not-play seat.
    expect(r.status === 409 || potOf(w, 'Emery') === 800, `answered ${r.status}, seat ${seat.payment_status} played ${seat.played}, pot ${potOf(w, 'Emery')}`).toBe(true);
  });

  it('BUG 4b: Use credit lands after a reopen and redo at the same $8 that says they did not play: $8 of credit spent on it', async () => {
    const w = await world();
    const sid = await on(w, OCT27);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Lee', 'Kai']) expect((await join(w, n, sid)).status).toBe(200);
    atIso(w, AFTER_OCT27);
    expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Kai'])).status).toBe(200); // $8
    await givePot(w, 'Emery', 1400); // credit arrives after he joined: Use credit
    const t0 = w.app.now;
    const g = w.db.pauseBefore(/'used', \?4, \?5, \?6\s+WHERE/, async () => {
      w.app.now = t0 + 60_000;
      expect((await reopen(w, sid)).status).toBe(200);
      expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Lee', 'Frankie', 'Gale', 'Kai'])).status).toBe(200);
      w.app.now = t0;
    });
    const r = await useCredit(w, 'Emery', sid);
    expect(g.used).toBe(true);
    expect({ status: r.status, pot: potOf(w, 'Emery') }).toEqual({ status: 409, pot: 1400 }); // actually 200 and $6 left
  });
});

describe('claim links', () => {
  it('claim link tapped twice at once, plus I in on the phone, plus a claim on another game, with $14 of credit', async () => {
    SCENARIOS++;
    const w = await world();
    const a = await on(w, NOV3);
    const b = await on(w, NOV5);
    await givePot(w, 'Lee', 1400);
    const tokenFor = async (sid: string) => {
      const links = await w.org.call('POST', `/api/admin/sessions/${sid}/links`, { kind: 'claim', playerIds: [w.ids.Lee] });
      expect(links.status, links.text).toBe(200);
      return String(links.data.drafts[0].url).split('/t/')[1];
    };
    const ta = await tokenFor(a);
    const tb = await tokenFor(b);
    const c1 = await phone(w, 'Lee');
    const c2 = await phone(w, 'Lee', 1);
    await Promise.all([
      c1.call('POST', '/api/link/act', { token: ta, action: 'claim' }),
      c2.call('POST', '/api/link/act', { token: ta, action: 'claim' }),
      join(w, 'Lee', a, 2),
      c2.call('POST', '/api/link/act', { token: tb, action: 'claim' }),
    ]);
    await books(w, 'claims');
    expect(usedOn(w, a, 'Lee') + usedOn(w, b, 'Lee')).toBe(1400);
  });
});

// ---------------------------------------------------------------- every pair of taps, at every point

/**
 * Two taps from a menu, B run inside A at every database call A makes. The full matrix (every ordered pair) runs
 * with AUDIT_FULL=1; by default a fixed sample of pairs, so the file stays quick.
 */
describe('pair matrix', () => {
  const FULL = !!process.env.AUDIT_FULL;
  type S = { w: World; a: string; b: string };
  const pre = async (): Promise<S> => {
    const w = await world({ maxPlayers: 5 });
    const a = await on(w, NOV3);
    const b = await on(w, NOV5);
    await givePot(w, 'Blair', 1400);
    await givePot(w, 'Casey', 500);
    await givePot(w, 'Kai', 1400);
    await givePot(w, 'Lee', 1400);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Kai']) expect((await join(w, n, a)).status).toBe(200); // Kai waits
    expect((await iPaid(w, 'Devon', a)).status).toBe(200);
    expect((await askCashOut(w, 'Lee', 1000)).status).toBe(200);
    expect((await join(w, 'Lee', b)).data.cashOutOffer?.cents).toBe(1000);
    await books(w, 'matrix base');
    return { w, a, b };
  };
  const menu: [string, (s: S) => Promise<any>][] = [
    ['Blair drops A', (s) => drop(s.w, 'Blair', s.a)],
    ['Devon drops A', (s) => drop(s.w, 'Devon', s.a, 1)],
    ['Kai joins B', (s) => join(s.w, 'Kai', s.b)],
    ['Emery I paid A', (s) => iPaid(s.w, 'Emery', s.a, 0, FLAT)],
    ['Casey I paid A', (s) => iPaid(s.w, 'Casey', s.a, 0, 900)],
    ['Lee uses cash out on B', (s) => useCashOut(s.w, 'Lee', s.b, 1000)],
    ['Mark refunded Lee', (s) => markRefunded(s.w, pendingReq(s.w, 'Lee')?.id ?? 'none', 1000)],
    ['cancel A', (s) => cancel(s.w, s.a)],
    ['organizer removes Casey', (s) => orgRemove(s.w, 'Casey', s.a)],
    ['Blair joins B', (s) => join(s.w, 'Blair', s.b, 1)],
    ['Lee cancels the request', (s) => cancelAsk(s.w, 'Lee')],
    ['Kai asks $14 cash out', (s) => askCashOut(s.w, 'Kai', 1400)],
    ['organizer unmarks Blair', (s) => unmark(s.w, 'Blair', s.a)],
    ['Blair undoes credit', (s) => undoCredit(s.w, 'Blair', s.a)],
    ['Lee drops B', (s) => drop(s.w, 'Lee', s.b)],
  ];
  const pairs: [number, number][] = [];
  for (let i = 0; i < menu.length; i++) for (let j = 0; j < menu.length; j++) pairs.push([i, j]);
  const sample = FULL ? pairs : pairs.filter((_, k) => k % 23 === 0);
  it(`${sample.length} ordered pairs before the game`, async () => {
    for (const [i, j] of sample) {
      SCENARIOS++;
      await sweep(`${menu[i][0]} ⊃ ${menu[j][0]}`, pre, menu[i][1], menu[j][1]);
    }
  });

  type P = { w: World; sid: string };
  const post = async (): Promise<P> => {
    const s = await playedGame();
    expect((await finalize(s.w, s.sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Gale', ORG])).status).toBe(200); // 6 played: $9, Frankie did not
    await books(s.w, 'post base');
    return s;
  };
  const postMenu: [string, (s: P) => Promise<any>][] = [
    ['reopen', (s) => reopen(s.w, s.sid)],
    ['Emery I paid $9', (s) => iPaid(s.w, 'Emery', s.sid, 0, 900)],
    ['Casey I paid $4', (s) => iPaid(s.w, 'Casey', s.sid, 0, 400)],
    ['unmark Devon', (s) => unmark(s.w, 'Devon', s.sid)],
    ['unmark Blair', (s) => unmark(s.w, 'Blair', s.sid)],
    ['unmark Casey (credit)', (s) => unmark(s.w, 'Casey', s.sid)],
    ['Devon cashes out $5', (s) => askCashOut(s.w, 'Devon', 500)],
    ['Blair joins Nov 3 with the $5', async (s) => join(s.w, 'Blair', await on(s.w, NOV3))],
    ['Emery uses credit (none)', (s) => useCredit(s.w, 'Emery', s.sid)],
    ['Gale Didn\'t pay (organizer marked)', (s) => iDidNotPay(s.w, 'Gale', s.sid, FLAT)],
    ['organizer Mark paid Emery', (s) => markPaid(s.w, 'Emery', s.sid)],
    ['refund Devon\'s balance', (s) => refundBalance(s.w, 'Devon')],
  ];
  const postPairs: [number, number][] = [];
  for (let i = 0; i < postMenu.length; i++) for (let j = 0; j < postMenu.length; j++) postPairs.push([i, j]);
  const postSample = FULL ? postPairs : postPairs.filter((_, k) => k % 19 === 0);
  it(`${postSample.length} ordered pairs after Finalize`, async () => {
    for (const [i, j] of postSample) {
      // Unmark of "Credit $5" with Casey's I paid landing first erases her cash: BUG 5, pinned below.
      if (postMenu[i][0] === 'unmark Casey (credit)' && postMenu[j][0] === 'Casey I paid $4') continue;
      SCENARIOS++;
      await sweep(`${postMenu[i][0]} ⊃ ${postMenu[j][0]}`, post, postMenu[i][1], postMenu[j][1]);
    }
  });
});

describe('fewer than 4 when the game ended', () => {
  it('Cancel session after the game (credit, part credit, cash, unpaid): everything back; or Finalize anyway at $14', async () => {
    for (const choice of ['cancel', 'anyway'] as const) {
      SCENARIOS++;
      const w = await world();
      const sid = await on(w, OCT27);
      await givePot(w, 'Blair', 1400);
      await givePot(w, 'Casey', 500);
      for (const n of ['Blair', 'Casey', 'Devon']) expect((await join(w, n, sid)).status).toBe(200);
      expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
      expect((await iPaid(w, 'Casey', sid)).status).toBe(200);
      atIso(w, AFTER_OCT27);
      const pots = ['Blair', 'Casey', 'Devon'].map((n) => potOf(w, n));
      if (choice === 'cancel') {
        const [r1, r2] = await Promise.all([cancel(w, sid), cancel(w, sid)]);
        expect([r1.status, r2.status]).toEqual([200, 200]);
        await books(w, 'canceled after the game');
        expect(['Blair', 'Casey', 'Devon'].map((n) => potOf(w, n))).toEqual([pots[0] + 1400, pots[1] + 1400, pots[2] + 1400]);
      } else {
        expect((await finalize(w, sid, 'everyone')).status).toBe(200);
        await books(w, 'finalize anyway');
        expect(['Blair', 'Casey', 'Devon'].map((n) => potOf(w, n))).toEqual(pots);
      }
    }
  });
});

describe('same seat, two phones: drop and I in at every point', () => {
  const setup = async () => {
    const w = await world({ maxPlayers: 4 });
    const a = await on(w, NOV3);
    await givePot(w, 'Blair', 1400);
    await givePot(w, 'Casey', 500);
    await givePot(w, 'Kai', 900);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Kai']) expect((await join(w, n, a)).status).toBe(200); // Kai waits
    expect((await iPaid(w, 'Devon', a)).status).toBe(200);
    await books(w, 'same seat base');
    return { w, a };
  };
  for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) {
    it(`${n}: drop on one phone, I in on the other`, async () => {
      SCENARIOS++;
      await sweep(`${n} drop ⊃ ${n} I in`, setup, (s) => drop(s.w, n, s.a), (s) => join(s.w, n, s.a, 1));
      await sweep(`${n} I in ⊃ ${n} drop`, async () => {
        const s = await setup();
        expect((await drop(s.w, n, s.a)).status).toBe(200);
        return s;
      }, (s) => join(s.w, n, s.a, 1), (s) => drop(s.w, n, s.a));
      await sweep(`${n} drop ⊃ organizer removes ${n}`, setup, (s) => drop(s.w, n, s.a), (s) => orgRemove(s.w, n, s.a));
      await sweep(`${n} drop ⊃ organizer moves ${n} to the waitlist`, setup, (s) => drop(s.w, n, s.a), (s) => orgWaitlist(s.w, n, s.a));
    });
  }
});

afterAll(() => {
  console.log(
    `audit-attack: ${SCENARIOS} scenarios, ${INTERLEAVINGS} exact interleavings, ${CUTOFFS} cut-off points (each retried), ` +
      `${RANDOM_SEQS} random sequences (${RANDOM_STEPS} steps), ${BOOKS} full book checks; tolerated BUG 1 states: ${TOLERATED.settledCash}`,
  );
});

describe('confirmed failures (stale organizer screen)', () => {
  it.fails('BUG 5: Unmark on "Credit $5" after the player paid the other $4 erases the $4 cash payment', async () => {
    const { w, sid } = await playedGame();
    expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Gale', ORG])).status).toBe(200); // 6 played: $9
    // The organizer's Who paid shows Casey "Credit $5", owes $4. Casey pays the $4 her screen shows...
    const d = await dash(w);
    expect(d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === 'Casey').creditCents).toBe(500);
    expect((await iPaid(w, 'Casey', sid, 0, 400)).status).toBe(200);
    // ...and the organizer, still looking at "Credit $5", taps Unmark to put the $5 back in her pot.
    const u = await w.org.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids.Casey, paid: false });
    expect(u.status).toBe(200);
    // Correct: her $4 still counts (she now owes $5, the credit that went back), or the tap is refused as stale.
    // Actually: the whole payment is gone, the $5 is back in her pot, and she owes $9 although she sent $4.
    expect(await shownOwe(w, 'Casey', sid)).toBe(500);
  });
});

// ---------------------------------------------------------------- second pass (HEAD 2d43618): the new finalize guards

/** `sweep`, but B happens a minute later on the clock (another device, a slow phone): A keeps the time it started with. */
async function sweepLater<S extends { w: World }>(name: string, setup: () => Promise<S>, A: (s: S) => Promise<any>, B: (s: S) => Promise<any>, after?: (s: S, ra: any, rb: any) => Promise<void>) {
  return sweep(name, setup, A, async (s) => {
    s.w.app.now += 60_000;
    return B(s);
  }, after);
}

describe('second pass: Reopen and the taps that check the exact finalize', () => {
  type P = { w: World; sid: string };
  /** Tue Oct 27, 8 in (Lee and Kai too), 7 played: $8. Blair credit, Casey part credit, Devon and Gale cash, Emery/Frankie/Kai/Lee unpaid, organizer plays. */
  const eight = async (): Promise<P> => {
    const w = await world();
    const sid = await on(w, OCT27);
    await givePot(w, 'Blair', 1400);
    await givePot(w, 'Casey', 500);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Lee']) expect((await join(w, n, sid)).status).toBe(200);
    expect((await w.org.call('POST', `/api/admin/sessions/${sid}/me`, { in: true })).status).toBe(200);
    expect((await iPaid(w, 'Devon', sid)).status).toBe(200);
    expect((await markPaid(w, 'Gale', sid)).status).toBe(200);
    await givePot(w, 'Frankie', 1400); // credit that arrives after joining: Use credit
    atIso(w, AFTER_OCT27);
    expect((await finalize(w, sid, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', ORG])).status).toBe(200); // Lee did not play: 7, $8
    await books(w, 'eight base');
    return { w, sid };
  };
  const swap = ['Blair', 'Casey', 'Devon', 'Lee', 'Frankie', 'Gale', ORG]; // still 7 ($8), Emery out, Lee in
  const swapF = ['Blair', 'Casey', 'Devon', 'Emery', 'Lee', 'Gale', ORG]; // still 7, Frankie out
  const redo = (played: string[]) => async (s: P) => {
    const r1 = await reopen(s.w, s.sid);
    const r2 = await finalize(s.w, s.sid, played);
    return [r1.status, r2.status];
  };

  it('Reopen at every point inside another device\'s reopen + finalize (same set, same price other set, other price), and Reopen inside Reopen', async () => {
    SCENARIOS++;
    for (const played of [swap, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Lee', ORG], ['Blair', 'Casey', 'Devon', 'Emery', ORG]]) {
      await sweepLater(`reopen ⊃ (reopen, finalize ${played.length})`, eight, (s) => reopen(s.w, s.sid), redo(played), async (s, ra) => {
        // The stale Reopen either is the one that reopened (B then failed to reopen) or is refused; the game is finalized and its credit back intact.
        expect([200, 409]).toContain(ra.status);
      });
    }
    await sweepLater('reopen ⊃ reopen', eight, (s) => reopen(s.w, s.sid), (s) => reopen(s.w, s.sid));
    await sweepLater('finalize-again ⊃ (reopen, finalize)', async () => {
      const s = await eight();
      expect((await reopen(s.w, s.sid)).status).toBe(200);
      return s;
    }, (s) => finalize(s.w, s.sid, swap), async (s) => {
      await finalize(s.w, s.sid, 'everyone');
      return reopen(s.w, s.sid);
    });
  });

  it('I paid, Mark paid, Use credit, Unmark, Didn\'t pay at every point around a reopen + redo (a minute later)', async () => {
    SCENARIOS++;
    await sweepLater('Emery I paid $8 ⊃ redo without Emery', eight, (s) => iPaid(s.w, 'Emery', s.sid, 0, 800), redo(swap), async (s) => {
      const seat = seatRow(s.w, s.sid, 'Emery');
      // A payment that landed first comes back in full when the redo says he did not play (settled); one that lands after is refused.
      expect(seat.payment_status === 'paid' && !seat.refunded_at && seat.played === 0).toBe(false);
    });
    await sweepLater('Mark paid Emery ⊃ redo without Emery', eight, (s) => markPaid(s.w, 'Emery', s.sid), redo(swap));
    await sweepLater('Frankie Use credit ⊃ redo without Frankie', eight, (s) => useCredit(s.w, 'Frankie', s.sid), redo(swapF), async (s) => {
      if (seatRow(s.w, s.sid, 'Frankie').played === 0) expect(potOf(s.w, 'Frankie')).toBe(1400);
    });
    await sweepLater('Casey I paid $3 ⊃ redo, same set', eight, (s) => iPaid(s.w, 'Casey', s.sid, 0, 300), redo(['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', ORG]));
    await sweepLater('Emery I paid $8 ⊃ reopen only', eight, (s) => iPaid(s.w, 'Emery', s.sid, 0, 800), (s) => reopen(s.w, s.sid));
    await sweepLater('unmark Devon ⊃ redo', eight, (s) => unmark(s.w, 'Devon', s.sid), redo(swap));
    await sweepLater('unmark Blair ⊃ redo', eight, (s) => unmark(s.w, 'Blair', s.sid), redo(swap));
    await sweepLater('redo ⊃ Emery I paid (what the screen shows now)', eight, redo(swap), async (s) => iPaid(s.w, 'Emery', s.sid));
  });

  it('cut off halfway, then retried a minute later: Reopen, Finalize again, I paid and Use credit after a redo', async () => {
    SCENARIOS++;
    const later = <S extends P>(A: (s: S) => Promise<any>) => async (s: S) => {
      s.w.app.now += 60_000;
      return A(s);
    };
    await cutoffSweep('reopen (retry later)', eight, later((s) => reopen(s.w, s.sid)));
    const reopened = async () => {
      const s = await eight();
      expect((await reopen(s.w, s.sid)).status).toBe(200);
      return s;
    };
    await cutoffSweep('finalize again (retry later)', reopened, later((s) => finalize(s.w, s.sid, swap)));
    const redone = async () => {
      const s = await eight();
      s.w.app.now += 60_000;
      expect((await redo(swap)(s))).toEqual([200, 200]);
      return { ...s, counted: false };
    };
    await cutoffSweep('Lee pays after the redo (retry later)', redone, later(async (s: P & { counted: boolean }) => {
      const before = seatRow(s.w, s.sid, 'Lee').payment_status;
      const shown = await shownOwe(s.w, 'Lee', s.sid);
      const r = await (await phone(s.w, 'Lee')).call('POST', `/api/sessions/${s.sid}/paid`, { paid: true, cents: shown });
      if (!s.counted && before !== 'paid' && seatRow(s.w, s.sid, 'Lee').payment_status === 'paid') {
        s.w.cash += shown;
        s.counted = true;
      }
      return r;
    }), async (s) => expect(seatRow(s.w, s.sid, 'Lee').payment_status).toBe('paid'));
    await cutoffSweep('Frankie Use credit after the redo (retry later)', redone, later((s) => useCredit(s.w, 'Frankie', s.sid)), async (s) => {
      // Frankie did not play in swap? He did (swap keeps Frankie): after the retry his $8 is paid with credit.
      expect(usedOn(s.w, s.sid, 'Frankie')).toBe(800);
    });
  });

  it('normal flows are not broken by the new guards: double-tap I paid, two phones, I paid while the organizer confirms, before and after Finalize', async () => {
    SCENARIOS++;
    // Before Finalize (game upcoming), and after Finalize: every interleaving answers 200 (one changed), never an error.
    const upcoming = async () => {
      const w = await world();
      const sid = await on(w, NOV3);
      await givePot(w, 'Casey', 500);
      for (const n of ['Casey', 'Emery']) expect((await join(w, n, sid)).status).toBe(200);
      return { w, sid };
    };
    const both200 = async (_s: any, ra: any, rb: any) => {
      expect([ra.status, rb.status], `${ra.text} / ${rb.text}`).toEqual([200, 200]);
      expect([ra.data.changed, rb.data.changed].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    };
    for (const setup of [upcoming, eight]) {
      const isUp = setup === upcoming;
      const amt = isUp ? 1400 : 800;
      await sweep(`I paid ⊃ I paid (other phone) ${isUp ? 'upcoming' : 'finalized'}`, setup, (s: any) => iPaid(s.w, 'Emery', s.sid, 0, amt), (s: any) => iPaid(s.w, 'Emery', s.sid, 1, amt), both200);
      await sweep(`Casey I paid the rest ⊃ again ${isUp ? 'upcoming' : 'finalized'}`, setup, (s: any) => iPaid(s.w, 'Casey', s.sid, 0, isUp ? 900 : 300), (s: any) => iPaid(s.w, 'Casey', s.sid, 1, isUp ? 900 : 300), both200);
      await sweep(`I paid ⊃ organizer Mark paid ${isUp ? 'upcoming' : 'finalized'}`, setup, (s: any) => iPaid(s.w, 'Emery', s.sid, 0, amt), (s: any) => markPaid(s.w, 'Emery', s.sid), both200);
      await sweep(`Mark paid ⊃ Mark paid ${isUp ? 'upcoming' : 'finalized'}`, setup, (s: any) => markPaid(s.w, 'Emery', s.sid), (s: any) => markPaid(s.w, 'Emery', s.sid), both200);
    }
    // Use credit twice at once after Finalize: one 200, the other a clean 409 "nothing owed" / "credit changed", and a later tap sees it paid.
    await sweep('Use credit ⊃ Use credit (finalized)', eight, (s) => useCredit(s.w, 'Frankie', s.sid), (s) => useCredit(s.w, 'Frankie', s.sid, 1), async (s, ra, rb) => {
      expect([ra.status, rb.status].filter((x) => x === 200).length).toBe(1);
      expect(seatRow(s.w, s.sid, 'Frankie').payment_status).toBe('paid');
      expect(usedOn(s.w, s.sid, 'Frankie')).toBe(800);
    });
    // After a Reopen: a stale tap is refused once, the next tap (fresh read) goes through.
    const s = await eight();
    const stale = await shownOwe(s.w, 'Emery', s.sid); // $8 shown
    s.w.app.now += 60_000;
    expect((await reopen(s.w, s.sid)).status).toBe(200);
    expect((await iPaid(s.w, 'Emery', s.sid, 0, stale)).status).toBe(409);
    const fresh = await shownOwe(s.w, 'Emery', s.sid);
    expect(fresh).toBe(1400);
    expect((await iPaid(s.w, 'Emery', s.sid, 0, fresh)).status).toBe(200);
    expect((await useCredit(s.w, 'Frankie', s.sid)).status).toBe(200);
    await books(s.w, 'after reopen: fresh taps go through');
    s.w.app.now += 60_000;
    expect((await finalize(s.w, s.sid, 'everyone')).status).toBe(200);
    await books(s.w, 'finalized again with everyone');
    for (const n of ['Lee']) {
      const owe = await shownOwe(s.w, n, s.sid);
      expect((await iPaid(s.w, n, s.sid, 0, owe)).status).toBe(200);
    }
    await books(s.w, 'everyone paid after the redo');
  });
});
