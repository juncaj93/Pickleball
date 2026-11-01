// Player-side audit (Nov 1, 2026): API-level scenarios as many fake players.
// Everything here runs on a throwaway in-memory database with a fake clock and a fake Telegram.
// Families: sign up, drop out (and the Oct 31 rejoin bug), payment states, credit and cash out,
// waitlist and promotion, time edges, privacy, error responses. After every scenario that moves money
// the books are checked, and every player's cards are checked for "a way forward".
// Tests named "FIXED (Nov 1): ..." describe a real bug: they fail today and pass once it is fixed.
vi.hoisted(() => {
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GroupView, PlayerSessionView } from '../shared/api';
import { courtStatus } from '../shared/court';
import { creditChanges, potEffect } from '../shared/credit';
import { courtDisplay, isNoCourt } from '../src/courtDisplay';
import { balanceOf, heldCents } from '../src/pages/admin/todo';
// The page is TSX and is type-checked in the app project; this test only renders it.
// @ts-ignore
import { ScheduleRow } from '../src/pages/PlayerHome';
import { type Client, HOUR, PIN, setupGroup, TestApp, withoutIds } from './harness';

const TZ = 'America/Detroit';
const PRICE = 1400;
const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane'];
const VENMO = (n: string) => `@${n}-Pays-${n.length}x`;
type Court = 'booked' | 'not_booked' | 'waitlist';
type W = Awaited<ReturnType<typeof world>>;

// ---------- the world ----------

/** A group: Alex organizes (and plays), 11 other players with phones and Venmo names, a fake Telegram. */
async function world(opts: { maxPlayers?: number; court?: Court; courtAll?: boolean } = {}) {
  const app = new TestApp();
  const sent: string[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.example',
    TELEGRAM_BOT_TOKEN: '123456:FAKE-never-real',
    TELEGRAM_CHAT_ID: '1',
    TELEGRAM_FETCH: (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  for (const [i, n] of EXTRA.entries()) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-02${String(i).padStart(2, '0')}`, venmo: VENMO(n) });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  for (const [i, n] of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].entries()) {
    const r = await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName[n]}`, { name: n, phone: `(313) 555-01${String(i + 1).padStart(2, '0')}`, venmo: VENMO(n) });
    expect(r.status, r.text).toBe(200);
  }
  const phones = new Map<string, Client>();
  const w = { ...ctx, sent, phones };
  if (opts.court) {
    const games = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > app.now);
    for (const s of opts.courtAll ? games : games.slice(0, 4)) if (opts.court !== 'not_booked') await setCourt(w, s.id, opts.court);
  }
  return w;
}

/** The organizer's dashboard (signing in again after a long clock jump: the sign-in lasts 30 days). */
async function dash(w: { organizer: Client }) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard');
  }
  return r.data;
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
async function on(w: W, date: string) {
  const s = (await dash(w)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
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
const view = async (w: W, name: string): Promise<GroupView> => {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const shown = async (w: W, name: string) => courtDisplay(await view(w, name));
const sOf = (g: GroupView, sid: string) => g.sessions.find((s) => s.id === sid) as PlayerSessionView;
const mine = async (w: W, name: string, sid: string) => sOf(await view(w, name), sid)?.mine ?? null;
const shownMine = async (w: W, name: string, sid: string) => sOf(await shown(w, name), sid)?.mine ?? null;
const joinRaw = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/join`, {});
const join = async (w: W, sid: string, name: string) => {
  const r = await joinRaw(w, sid, name);
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const joinAll = async (w: W, sid: string, names: string[]) => {
  for (const n of names) await join(w, sid, n);
};
const drop = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/withdraw`, {});
const iPaid = (w: W, sid: string, name: string, paid = true, cents?: number) => call(w, name, 'POST', `/api/sessions/${sid}/paid`, cents === undefined ? { paid } : { paid, cents });
const useCredit = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/use-credit`, {});
const undoCredit = (w: W, sid: string, name: string) => call(w, name, 'POST', `/api/sessions/${sid}/undo-credit`, {});
const askCashOut = (w: W, name: string, cents: number) => call(w, name, 'POST', '/api/me/refund-request', { cents });
const markPaid = (w: W, sid: string, name: string, paid = true) => w.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid });
const setCourt = (w: { organizer: Client }, sid: string, status: Court) => w.organizer.call('POST', `/api/admin/sessions/${sid}/court-status`, { status });
const cancelGame = (w: W, sid: string, reason?: string) => w.organizer.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true, ...(reason ? { reason } : {}) });
const finalize = (w: W, sid: string, played?: string[]) => w.organizer.call('POST', `/api/admin/sessions/${sid}/finalize`, played ? { played: played.map((n) => w.byName[n]) } : { everyone: true });
const setMax = (w: W, maxPlayers: number) => w.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers } });
const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
const ledger = (w: W, name: string) => w.app.db.raw.prepare('SELECT * FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid').all(w.byName[name]) as any[];
const liveUsed = (w: W, sid: string, name: string) =>
  (w.app.db.raw.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(sid, w.byName[name]) as any).c as number;
const seatRow = (w: W, sid: string, name: string) => w.app.db.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, w.byName[name]) as any;
const adminSeat = async (w: W, sid: string, name: string) => (await dash(w)).sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === name);

/** Put `cents` of credit in a player's pot, as if a canceled October game's payment came back (a real entry). */
function givePot(w: W, name: string, cents: number) {
  w.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}-${Math.random()}', g.id, '${w.byName[name]}', 'kept', ${cents}, (SELECT id FROM sessions WHERE starts_at = '2026-10-30T00:00:00.000Z'), '2026-10-26T13:00:00.000Z', 'canceled' FROM groups g`,
  );
}

/** The player's card for one game, as text (screen-reader text included). */
function card(g: GroupView, id: string): string {
  const s = sOf(g, id);
  const html = renderToStaticMarkup(createElement(ScheduleRow, { s, g, tier: 'next', onChanged: async () => {}, setOverlay: () => {}, joinToast: () => {} }));
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** A 4xx/5xx with a plain message: no stack trace, no SQL, no code words. */
function friendly(res: { status: number; data: any; text: string }, status?: number) {
  if (status !== undefined) expect(res.status, res.text).toBe(status);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(typeof res.data, res.text).toBe('object');
  expect(typeof res.data.message).toBe('string');
  expect(res.data.message.trim().length).toBeGreaterThan(3);
  expect(res.text).not.toMatch(/SELECT |INSERT |UPDATE |sqlite|constraint|TypeError|ReferenceError|RangeError|\bstack\b|\.ts:\d+|at async|node_modules|undefined|NaN|\[object/i);
}

// ---------- the books and "a way forward" ----------

/**
 * Every balance is the sum of its history (on the organizer's Players tab AND on the player's own screen), never
 * below $0; usable is the pot minus a pending cash out; no seat holds more credit than it costs; Money and Players
 * agree; and every player's every card offers a way forward.
 */
async function books(w: W, label = '') {
  const d = await dash(w);
  const rows = w.app.db.raw.prepare('SELECT * FROM credit_ledger').all() as any[];
  for (const p of d.players) {
    const sum = rows.filter((r) => r.player_id === p.id && !r.ended_at).reduce((n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }), 0);
    expect(sum, `${label} ${p.name}'s history is never below $0`).toBeGreaterThanOrEqual(0);
    expect(d.creditLedger.find((l: any) => l.playerId === p.id)?.balanceCents ?? 0, `${label} ${p.name}'s balance on Players`).toBe(sum);
    expect(balanceOf(d, p.id).creditCents).toBe(sum);
    if (p.name !== 'Alex' && p.isActive) {
      const v = await view(w, p.name);
      expect(v.credit.balanceCents, `${label} ${p.name}'s own balance`).toBe(sum);
      // The history the player sees adds up to the balance they see.
      const seen = v.credit.history.filter((e) => !e.endedAt).reduce((n, e) => n + potEffect({ kind: e.kind as any, cents: e.cents, fiveCents: 0 }), 0);
      expect(seen, `${label} ${p.name}'s visible history adds up`).toBe(v.credit.balanceCents);
      expect(v.credit.usableCents, `${label} ${p.name}'s usable`).toBe(Math.max(0, v.credit.balanceCents - (v.credit.pending?.cents ?? 0)));
      wayForward(v, `${label} ${p.name}`);
    }
  }
  for (const s of d.sessions) {
    const price = s.finalized ? s.finalized.priceCents : PRICE;
    const confirmed = s.roster.filter((r: any) => r.status === 'confirmed').length;
    if (s.status !== 'canceled') expect(confirmed, `${label} never above the max`).toBeLessThanOrEqual(d.group.settings.maxPlayers);
    for (const r of s.roster) {
      const used = rows.filter((x) => x.kind === 'used' && x.session_id === s.id && x.player_id === r.playerId && !x.ended_at).reduce((n, x) => n + x.amount_cents, 0);
      if (r.isOrganizer) {
        expect(used, 'the organizer never uses credit').toBe(0);
        continue;
      }
      expect(used, `${label} credit on ${r.name}'s seat`).toBeLessThanOrEqual(Math.max(price, r.paymentAmountCents ?? 0));
      if (r.status !== 'confirmed' && !(r.paymentStatus === 'paid' && r.selfPaid)) expect(used, `${label} ${r.name} is out, no credit on the seat`).toBe(0);
      if (s.status === 'canceled' && !(r.paymentStatus === 'paid' && r.selfPaid)) expect(used, `${label} canceled game holds no credit`).toBe(0);
      if (r.paymentStatus === 'paid' && !r.refundedAt) expect(r.paymentAmountCents ?? 0, `${label} ${r.name} paid`).toBeLessThanOrEqual(PRICE);
    }
  }
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  const ms = [];
  for (const m of ['2026-10', '2026-11', '2026-12', '2027-01']) ms.push((await w.organizer.call('GET', `/api/admin/money?month=${m}`)).data);
  expect(ms.reduce((n, m) => n + m.creditsOwedCents, 0), `${label} credits owed`).toBe(potTotal);
  for (const m of ms) expect(m.sessions.reduce((n: number, s: any) => n + s.collectedCents, 0)).toBe(m.collectedCents);
  expect(ms.reduce((n, m) => n + m.heldCents, 0)).toBe(heldCents(d));
  return d;
}

/**
 * "Every card offers a way forward" from the data. A confirmed, unpaid seat on a booked court shows a Pay (oweCents > 0)
 * or a Use credit (useCreditCents > 0); the money on the card adds up to the price. On a game with no court there is no
 * Pay, but usable credit is always offered. A paid seat shows Paid (with Undo for credit, Didn't pay? for an I paid).
 */
function wayForward(raw: GroupView, label: string) {
  const g = courtDisplay(raw);
  const organizer = raw.me?.name === raw.group.organizerName;
  for (const s of g.sessions) {
    const r = sOf(raw, s.id);
    const m = s.mine;
    if (!m || s.canceled || !r.mine) continue;
    if (organizer) {
      expect(m.oweCents + m.useCreditCents + m.creditCents, `${label}: the organizer has no money on a card`).toBe(0);
      continue;
    }
    if (r.mine.status === 'confirmed' && r.mine.paymentStatus === 'unpaid' && (r.mine.shareCents ?? 0) > 0) {
      const share = r.mine.shareCents!;
      expect(r.mine.oweCents + r.mine.creditCents + r.mine.paidEarlierCents, `${label}: ${dayOf(s.startsAt)} card adds up`).toBe(share);
      if (!isNoCourt(r)) {
        expect(m.oweCents > 0 || m.useCreditCents > 0, `${label}: ${dayOf(s.startsAt)} booked, unpaid, no Pay and no Use credit`).toBe(true);
        expect(m.useCreditCents).toBe(Math.min(raw.credit.usableCents, m.oweCents));
      } else {
        expect(m.oweCents, `${label}: no Pay before Court booked`).toBe(0);
        if (raw.credit.usableCents > 0) expect(m.useCreditCents, `${label}: ${dayOf(s.startsAt)} no court, usable credit must be offered`).toBeGreaterThan(0);
      }
    }
    if (r.mine.status === 'confirmed' && r.mine.paymentStatus === 'paid') {
      expect(m.oweCents, `${label}: paid owes nothing`).toBe(0);
    }
    if (r.mine.status === 'waitlisted') expect(m.oweCents + m.useCreditCents, `${label}: a waitlist spot owes nothing`).toBe(0);
  }
  // Owed and the top Pay card only for booked games, at the card's amount.
  for (const o of g.owed) {
    const s = sOf(raw, o.sessionId);
    if (s) expect(o.amountCents, `${label}: owed matches the card`).toBe(s.mine!.oweCents);
  }
}

// =====================================================================================================
describe('1. Sign up', () => {
  for (let n = 0; n <= 10; n++) {
    it(`booked court, max 10: ${n} in`, async () => {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-03');
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA].slice(0, n);
      for (const name of names) expect((await join(w, g.id, name)).result).toBe('confirmed');
      const v = await view(w, 'Lane');
      const s = sOf(v, g.id);
      expect(s.confirmed.map((c) => c.name)).toEqual(names);
      expect(s.countText).toBe(n < 4 ? `${n} of 4 in` : n >= 10 ? `${n} in, full` : `${n} in`);
      expect(s.full).toBe(n >= 10);
      expect(s.joinAs).toBe(n >= 10 ? 'waitlist' : 'in');
      expect(s.openSpots).toBe(10 - n);
      for (const name of names) expect(await mine(w, name, g.id)).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', oweCents: PRICE, shareCents: PRICE });
      await books(w);
    });
  }

  it('over full on a booked court: 11th and 12th go on the real waitlist, in order, owing nothing', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules']);
    givePot(w, 'Kai', 1400);
    expect(await join(w, g.id, 'Kai')).toEqual({ result: 'waitlisted', position: 1 });
    expect(await join(w, g.id, 'Lane')).toEqual({ result: 'waitlisted', position: 2 });
    expect(await mine(w, 'Kai', g.id)).toMatchObject({ status: 'waitlisted', waitlistPosition: 1, oweCents: 0, useCreditCents: 0, paymentStatus: 'not_applicable' });
    expect(await mine(w, 'Lane', g.id)).toMatchObject({ status: 'waitlisted', waitlistPosition: 2 });
    expect(await pot(w, 'Kai')).toBe(1400);
    const s = sOf(await view(w, 'Lane'), g.id);
    expect(s.waitlist.map((x) => x.name)).toEqual(['Kai', 'Lane']);
    expect(s.countText).toBe('10 in, full');
    expect((await shown(w, 'Kai')).owed.some((o) => o.sessionId === g.id)).toBe(false);
    await books(w);
  });

  for (const max of [4, 5, 6, 7, 8, 9, 10]) {
    it(`max players ${max}: ${max} in is full, the next one waits, never above the max`, async () => {
      const w = await world({ court: 'booked', maxPlayers: max });
      const g = await on(w, '2026-11-05');
      const all = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA];
      for (const [i, n] of all.slice(0, max + 1).entries()) {
        const r = await join(w, g.id, n);
        expect(r.result, `${n} (#${i + 1})`).toBe(i < max ? 'confirmed' : 'waitlisted');
      }
      const s = sOf(await view(w, 'Lane'), g.id);
      expect(s.confirmed).toHaveLength(max);
      expect(s.countText).toBe(`${max} in, full`);
      expect(s.waitlist).toHaveLength(1);
      await books(w);
    });
  }

  for (const court of ['not_booked', 'waitlist'] as const) {
    it(`${court} court: I'm in gives a normal seat (never standby), 'Court not booked', no Pay`, async () => {
      const w = await world();
      const g = await on(w, '2026-11-05');
      if (court === 'waitlist') expect((await setCourt(w, g.id, 'waitlist')).status).toBe(200);
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) expect((await join(w, g.id, n)).result).toBe('confirmed');
      const raw = await view(w, 'Blair');
      expect(sOf(raw, g.id).waitlist).toEqual([]);
      expect(courtStatus(sOf(raw, g.id)).playerText).toBe('Court not booked');
      const disp = sOf(courtDisplay(raw), g.id);
      expect(disp.mine).toMatchObject({ status: 'confirmed', oweCents: 0 });
      expect(disp.bookingStatus).not.toBe('unavailable');
      expect(disp.courtState).toBeNull();
      const text = card(courtDisplay(raw), g.id);
      expect(text).toContain('Court not booked');
      expect(text).not.toMatch(/waitlist|waiting|standby|\bPay\b|\$14 due/i);
      await books(w);
    });
    it(`${court} court, max 4, full: the 5th really waits (a real waitlist, only when full)`, async () => {
      const w = await world({ maxPlayers: 4 });
      const g = await on(w, '2026-11-05');
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
      expect(await join(w, g.id, 'Frankie')).toEqual({ result: 'waitlisted', position: 1 });
      const disp = sOf(await shown(w, 'Frankie'), g.id);
      expect(disp.mine!.status).toBe('waitlisted');
      expect(disp.joinAs).toBe('waitlist');
      await books(w);
    });
  }

  const creditCases: [string, number, Court, object, number][] = [
    ['no credit', 0, 'booked', { paymentStatus: 'unpaid', oweCents: 1400, creditCents: 0, useCreditCents: 0 }, 0],
    ['part credit $3', 300, 'booked', { paymentStatus: 'unpaid', oweCents: 1100, creditCents: 300, useCreditCents: 0 }, 0],
    ['exact credit $14', 1400, 'booked', { paymentStatus: 'paid', paidWithCredit: true, oweCents: 0 }, 0],
    ['more than enough $20', 2000, 'booked', { paymentStatus: 'paid', paidWithCredit: true, oweCents: 0 }, 600],
    ['part credit $3, no court', 300, 'not_booked', { paymentStatus: 'unpaid', oweCents: 0, creditCents: 300, useCreditCents: 0 }, 0],
    ['exact credit, no court', 1400, 'not_booked', { paymentStatus: 'paid', paidWithCredit: true }, 0],
    ['more than enough, Waitlist court', 2500, 'waitlist', { paymentStatus: 'paid', paidWithCredit: true }, 1100],
  ];
  for (const [label, credit, court, expectMine, left] of creditCases) {
    it(`credit at I'm in: ${label}`, async () => {
      const w = await world();
      const g = await on(w, '2026-11-03');
      if (court !== 'not_booked') await setCourt(w, g.id, court);
      if (credit) givePot(w, 'Casey', credit);
      const r = await join(w, g.id, 'Casey');
      const used = Math.min(credit, PRICE);
      expect(r).toEqual(used ? { result: 'confirmed', creditCents: used, paidWithCredit: used === PRICE } : { result: 'confirmed' });
      expect(await shownMine(w, 'Casey', g.id)).toMatchObject(expectMine);
      expect(await pot(w, 'Casey')).toBe(left);
      expect(liveUsed(w, g.id, 'Casey')).toBe(used);
      await books(w);
    });
  }

  it('two games, limited credit ($20), one after the other: $14 then $6, never twice', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Devon', 2000);
    const a = await on(w, '2026-11-03');
    const b = await on(w, '2026-11-05');
    expect(await join(w, a.id, 'Devon')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await join(w, b.id, 'Devon')).toMatchObject({ creditCents: 600, paidWithCredit: false });
    expect(await mine(w, 'Devon', b.id)).toMatchObject({ oweCents: 800, creditCents: 600, useCreditCents: 0 });
    expect(await pot(w, 'Devon')).toBe(0);
    await books(w);
  });

  it('three games tapped at the same moment with $20: exactly $20 is used in all', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Devon', 2000);
    const ids = [(await on(w, '2026-11-03')).id, (await on(w, '2026-11-05')).id, (await on(w, '2026-11-10')).id];
    const p = await phone(w, 'Devon');
    const res = await Promise.all(ids.map((id) => p.call('POST', `/api/sessions/${id}/join`, {})));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(res.reduce((n, r) => n + (r.data.creditCents ?? 0), 0)).toBe(2000);
    expect(ids.reduce((n, id) => n + liveUsed(w, id, 'Devon'), 0)).toBe(2000);
    await books(w);
  });

  it('double tap and two phones on the same game: one seat, one credit entry, one "credit used" answer', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 2800);
    const g = await on(w, '2026-11-03');
    const p1 = await phone(w, 'Casey');
    const p2 = w.app.client();
    p2.groupKey = w.groupKey;
    await p2.call('POST', '/api/me', { playerId: w.byName.Casey });
    const res = await Promise.all([p1.call('POST', `/api/sessions/${g.id}/join`, {}), p1.call('POST', `/api/sessions/${g.id}/join`, {}), p2.call('POST', `/api/sessions/${g.id}/join`, {})]);
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(res.filter((r) => r.data.creditCents === 1400)).toHaveLength(1);
    expect(liveUsed(w, g.id, 'Casey')).toBe(1400);
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(sOf(await view(w, 'Blair'), g.id).confirmed.map((c) => c.name)).toEqual(['Casey']);
    await books(w);
  });

  it('the last seat, two players tap at once: one in, one waits; the one who waits keeps all their credit', async () => {
    const w = await world({ court: 'booked', maxPlayers: 4 });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon']);
    givePot(w, 'Emery', 1400);
    givePot(w, 'Frankie', 1400);
    const [a, b] = await Promise.all([joinRaw(w, g.id, 'Emery'), joinRaw(w, g.id, 'Frankie')]);
    expect([a.data.result, b.data.result].sort()).toEqual(['confirmed', 'waitlisted']);
    const waiter = a.data.result === 'waitlisted' ? 'Emery' : 'Frankie';
    expect(await pot(w, waiter)).toBe(1400);
    expect(sOf(await view(w, 'Blair'), g.id).confirmed).toHaveLength(4);
    await books(w);
  });

  it('already in, I\'m in again: already_confirmed, nothing new used', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 2800);
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    expect(await join(w, g.id, 'Casey')).toEqual({ result: 'already_confirmed' });
    expect(liveUsed(w, g.id, 'Casey')).toBe(1400);
    await books(w);
  });

  const races: [string, (w: W, sid: string) => Promise<unknown>][] = [
    ['court switched to Waitlist', (w, sid) => setCourt(w, sid, 'waitlist')],
    ['court switched to Booked', (w, sid) => setCourt(w, sid, 'booked')],
    ['court switched to Not booked', (w, sid) => setCourt(w, sid, 'not_booked')],
    ['time moved 30 minutes later', async (w, sid) => {
      const s = (await dash(w)).sessions.find((x: any) => x.id === sid);
      return w.organizer.call('PUT', `/api/admin/sessions/${sid}/time`, { startsAt: new Date(Date.parse(s.startsAt) + 30 * 60_000).toISOString(), endsAt: new Date(Date.parse(s.endsAt) + 30 * 60_000).toISOString() });
    }],
  ];
  for (const [label, act] of races) {
    it(`join at the same moment as the organizer: ${label}: a normal seat, credit used once`, async () => {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-05');
      givePot(w, 'Casey', 900);
      const [j, o] = await Promise.all([joinRaw(w, g.id, 'Casey'), act(w, g.id) as any]);
      expect(j.status, j.text).toBe(200);
      expect(o.status, o.text).toBe(200);
      expect(j.data).toMatchObject({ result: 'confirmed', creditCents: 900 });
      expect(await mine(w, 'Casey', g.id)).toMatchObject({ status: 'confirmed', creditCents: 900 });
      expect(await pot(w, 'Casey')).toBe(0);
      await books(w);
    });
  }

  it('join at the same moment as the organizer cancels: either refused with a plain message, or in and then all credit back', async () => {
    for (let k = 0; k < 4; k++) {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-05');
      givePot(w, 'Casey', 1400);
      const calls = [joinRaw(w, g.id, 'Casey'), cancelGame(w, g.id, 'Rain')];
      const [j, c] = k % 2 ? await Promise.all(calls) : (await Promise.all(calls.reverse())).reverse();
      expect(c.status, c.text).toBe(200);
      if (j.status !== 200) friendly(j, 409);
      expect(await pot(w, 'Casey')).toBe(1400);
      expect(liveUsed(w, g.id, 'Casey')).toBe(0);
      const s = sOf(await view(w, 'Casey'), g.id);
      expect(s.canceled).toBe(true);
      expect(s.mine?.useCreditCents ?? 0).toBe(0);
      await books(w);
    }
  });

  it('join a canceled game: refused, plain message, nothing used', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-05');
    givePot(w, 'Casey', 1400);
    await cancelGame(w, g.id);
    const r = await joinRaw(w, g.id, 'Casey');
    friendly(r, 409);
    expect(r.data.message).toBe('This session was canceled.');
    expect(await pot(w, 'Casey')).toBe(1400);
  });

  it('a brand-new player (added their own name) can sign up and sees $14 due on a booked game', async () => {
    const w = await world({ court: 'booked' });
    const c = w.app.client();
    c.groupKey = w.groupKey;
    const add = await c.call('POST', '/api/players/self', { name: 'Zoë O\'Neil', confirmNew: true });
    expect(add.status, add.text).toBe(200);
    const g = await on(w, '2026-11-03');
    expect((await c.call('POST', `/api/sessions/${g.id}/join`, {})).data).toEqual({ result: 'confirmed' });
    const v = (await c.call('GET', '/api/group')).data as GroupView;
    expect(v.me!.name).toBe("Zoë O'Neil");
    expect(sOf(v, g.id).mine).toMatchObject({ oweCents: 1400, useCreditCents: 0 });
    expect(v.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    expect(card(courtDisplay(v), g.id)).toMatch(/\$14 due.*Pay/);
  });
});

// =====================================================================================================
describe('2. Drop out', () => {
  /** A seat in one money state on Tue Nov 3 (booked). */
  async function seatIn(state: 'cash' | 'credit' | 'part' | 'part_cash' | 'unpaid' | 'claim' | 'claim_part' | 'waitlisted') {
    const w = await world({ court: 'booked', maxPlayers: state === 'waitlisted' ? 4 : 10 });
    const g = await on(w, '2026-11-03');
    if (state === 'waitlisted') await joinAll(w, g.id, ['Blair', 'Devon', 'Emery', 'Frankie']);
    if (state === 'credit') givePot(w, 'Casey', 1400);
    if (state === 'part' || state === 'part_cash' || state === 'claim_part') givePot(w, 'Casey', 300);
    if (state === 'waitlisted') givePot(w, 'Casey', 500);
    await join(w, g.id, 'Casey');
    if (state === 'cash' || state === 'part_cash') expect((await markPaid(w, g.id, 'Casey')).status).toBe(200);
    if (state === 'claim' || state === 'claim_part') expect((await iPaid(w, g.id, 'Casey')).status).toBe(200);
    return { w, g };
  }
  const cases: [Parameters<typeof seatIn>[0], { back: number; returned: number; pot: number; claim?: number }][] = [
    ['cash', { back: 1400, returned: 0, pot: 1400 }],
    ['credit', { back: 0, returned: 1400, pot: 1400 }],
    ['part', { back: 0, returned: 300, pot: 300 }],
    ['part_cash', { back: 1100, returned: 300, pot: 1400 }],
    ['unpaid', { back: 0, returned: 0, pot: 0 }],
    ['claim', { back: 0, returned: 0, pot: 0, claim: 1400 }],
    ['claim_part', { back: 0, returned: 0, pot: 0, claim: 1400 }],
    ['waitlisted', { back: 0, returned: 0, pot: 500 }],
  ];
  for (const [state, exp] of cases) {
    it(`drop out, seat ${state}: the card promised exactly what came back (credit $${exp.returned / 100}, cash as credit $${exp.back / 100})`, async () => {
      const { w, g } = await seatIn(state);
      const before = (await mine(w, 'Casey', g.id))!;
      const r = await drop(w, g.id, 'Casey');
      expect(r.status, r.text).toBe(200);
      expect(r.data).toEqual({ result: 'withdrawn', creditBackCents: exp.back, creditReturnedCents: exp.returned });
      // What the toast said ("You dropped out. $14 credit returned.") is what happened.
      expect(before.dropCreditCents, 'toast credit').toBe(exp.returned);
      expect(before.dropCashCents, 'toast cash').toBe(exp.back);
      expect(before.dropClaimCents, 'toast claim').toBe(exp.claim ?? 0);
      expect(await pot(w, 'Casey')).toBe(exp.pot);
      expect((await mine(w, 'Casey', g.id))!.status).toBe('withdrawn');
      await books(w);
      // A second tap (a retry) changes nothing.
      expect((await drop(w, g.id, 'Casey')).data).toEqual({ result: 'not_in_session', creditBackCents: 0, creditReturnedCents: 0 });
      expect(await pot(w, 'Casey')).toBe(exp.pot);
    });
  }

  /** The Oct 31 bug, every money state: after a drop and a rejoin of the same game the card must show credit used or $14 due with a way to pay. */
  for (const [state] of cases.filter(([s]) => s !== 'waitlisted')) {
    for (const court of ['booked', 'not_booked', 'waitlist'] as const) {
      it(`Oct 31: drop and rejoin the same game, seat ${state}, court ${court}: the card shows a way forward`, async () => {
        const { w, g } = await seatIn(state);
        if (court !== 'booked') await setCourt(w, g.id, court);
        await drop(w, g.id, 'Casey');
        const potAfterDrop = await pot(w, 'Casey');
        const r = await join(w, g.id, 'Casey');
        expect(r.result).toBe('confirmed');
        const raw = await view(w, 'Casey');
        const m = sOf(raw, g.id).mine!;
        const text = card(courtDisplay(raw), g.id);
        if (state === 'claim' || state === 'claim_part') {
          // The unconfirmed I paid came back exactly as it was: "Paid $14" with Didn't pay?.
          expect(m).toMatchObject({ paymentStatus: 'paid', selfPaid: true });
          expect(text).toMatch(/Paid.*Didn't pay\?/);
        } else if (potAfterDrop >= PRICE) {
          expect(r).toMatchObject({ creditCents: 1400, paidWithCredit: true });
          expect(m).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
          expect(text).toMatch(/Paid with credit.*Undo/);
        } else if (potAfterDrop > 0) {
          expect(r).toMatchObject({ creditCents: potAfterDrop });
          expect(m.creditCents).toBe(potAfterDrop);
          expect(text).toContain(`Credit $${potAfterDrop / 100} used`);
          if (court === 'booked') expect(text).toMatch(new RegExp(`\\$${(PRICE - potAfterDrop) / 100} due.*Pay`));
        } else {
          expect(m.paymentStatus).toBe('unpaid');
          if (court === 'booked') expect(text).toMatch(/\$14 due.*Pay/);
          else expect(text).toMatch(/You're in/);
        }
        await books(w);
      });
    }
  }

  it('Oct 31 with a cash out: paid $14 cash, drop, ask to cash out the $14, rejoin: $14 due with Pay, and the cash-out prompt', async () => {
    const { w, g } = await seatIn('cash');
    await drop(w, g.id, 'Casey');
    expect((await askCashOut(w, 'Casey', 1400)).status).toBe(200);
    const r = await join(w, g.id, 'Casey');
    expect(r).toEqual({ result: 'confirmed', cashOutOffer: { cents: 1400, requestCents: 1400 } });
    const raw = await view(w, 'Casey');
    expect(sOf(raw, g.id).mine).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 0 });
    expect(card(courtDisplay(raw), g.id)).toMatch(/\$14 due.*Pay/);
    await books(w);
  });

  it('drop then join a different game: the money from the first goes on the second', async () => {
    const { w, g } = await seatIn('cash');
    const b = await on(w, '2026-11-05');
    await drop(w, g.id, 'Casey');
    expect(await join(w, b.id, 'Casey')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    expect(await pot(w, 'Casey')).toBe(0);
    await books(w);
  });

  it('drop a part-credit game then join a no-court game: the $3 goes on it, "Credit $3 used", no Pay yet', async () => {
    const { w, g } = await seatIn('part');
    const b = await on(w, '2026-11-12');
    await drop(w, g.id, 'Casey');
    expect(await join(w, b.id, 'Casey')).toMatchObject({ creditCents: 300 });
    const text = card(await shown(w, 'Casey'), b.id);
    expect(text).toContain('Credit $3 used');
    expect(text).not.toMatch(/\bPay\b|due/);
    await books(w);
  });

  it('drop 1 ms before cancel-by: not late; at cancel-by exactly: late; money comes back either way', async () => {
    for (const [offset, late] of [[-1, false], [0, true], [HOUR, true]] as const) {
      const { w, g } = await seatIn('credit');
      const cut = sOf(await view(w, 'Casey'), g.id).dropCutoffAt;
      expect(cut).toBe(new Date(Date.parse(g.startsAt) - 12 * HOUR).toISOString());
      w.app.now = Date.parse(cut) + offset;
      expect((await drop(w, g.id, 'Casey')).data).toMatchObject({ result: 'withdrawn', creditReturnedCents: 1400 });
      expect(!!(await adminSeat(w, g.id, 'Casey')).lateDropAt, `offset ${offset}`).toBe(late);
      expect(await pot(w, 'Casey')).toBe(1400);
      await books(w);
    }
  });

  it('a late drop that rejoins no longer counts as late', async () => {
    const { w, g } = await seatIn('unpaid');
    w.app.now = Date.parse(g.startsAt) - 2 * HOUR;
    await drop(w, g.id, 'Casey');
    expect((await adminSeat(w, g.id, 'Casey')).lateDropAt).toBeTruthy();
    await join(w, g.id, 'Casey');
    expect((await adminSeat(w, g.id, 'Casey')).lateDropAt).toBeNull();
  });

  for (const [label, offset] of [['at the start exactly', 0], ['10 minutes after start', 10 * 60_000], ['after the end', 3 * HOUR]] as const) {
    it(`drop ${label}: refused with a plain message, money unchanged`, async () => {
      const { w, g } = await seatIn('credit');
      w.app.now = Date.parse(g.startsAt) + offset;
      const r = await drop(w, g.id, 'Casey');
      friendly(r, 409);
      expect(r.data.message).toBe('This session already started.');
      expect(seatRow(w, g.id, 'Casey').status).toBe('confirmed');
      expect(liveUsed(w, g.id, 'Casey')).toBe(1400);
      expect(await pot(w, 'Casey')).toBe(0);
    });
  }

  it('drop a game they never joined: answered calmly, nothing changes', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    expect((await drop(w, g.id, 'Casey')).data).toEqual({ result: 'not_in_session', creditBackCents: 0, creditReturnedCents: 0 });
  });

  it('a drop and an Undo of "Paid with credit" at the same moment: the $14 comes back once', async () => {
    const { w, g } = await seatIn('credit');
    const [a, b] = await Promise.all([drop(w, g.id, 'Casey'), undoCredit(w, g.id, 'Casey')]);
    expect(a.status, a.text).toBe(200);
    if (b.status !== 200) friendly(b, 409);
    expect(await pot(w, 'Casey')).toBe(1400);
    await books(w);
  });

  it('a drop and "I paid" at the same moment: never paid while out with the money stuck', async () => {
    const { w, g } = await seatIn('unpaid');
    const [a, b] = await Promise.all([drop(w, g.id, 'Casey'), iPaid(w, g.id, 'Casey')]);
    expect(a.status).toBe(200);
    if (b.status !== 200) friendly(b);
    const row = seatRow(w, g.id, 'Casey');
    expect(row.status).toBe('withdrawn');
    // Either nothing was paid, or it is an unconfirmed claim for the organizer to answer (Home card).
    if (row.payment_status === 'paid') expect(row.self_paid_at).toBeTruthy();
    await books(w);
  });
});

// =====================================================================================================
describe('3. Payment states and buttons', () => {
  async function booked(names = ['Casey']) {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, names);
    return { w, g };
  }

  it('$14 due: Pay (Venmo) and a quiet I paid; owed lists it at $14', async () => {
    const { w, g } = await booked();
    const v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ oweCents: 1400, useCreditCents: 0, paymentStatus: 'unpaid' });
    expect(v.owed.map((o) => [o.sessionId, o.amountCents])).toEqual([[g.id, 1400]]);
    const text = card(v, g.id);
    expect(text).toMatch(/\$14 due/);
    expect(text).toMatch(/\bPay\b/);
    expect(text).toMatch(/I paid/);
  });

  it('I paid: "Paid $14" with Didn\'t pay?; Didn\'t pay? puts it back to $14 due', async () => {
    const { w, g } = await booked();
    expect((await iPaid(w, g.id, 'Casey', true, 1400)).data).toEqual({ ok: true, changed: true });
    let v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ paymentStatus: 'paid', selfPaid: true, oweCents: 0 });
    expect(card(v, g.id)).toMatch(/Paid \$14.*Didn't pay\?/);
    expect(v.owed).toEqual([]);
    expect((await iPaid(w, g.id, 'Casey', false)).data).toEqual({ ok: true, changed: true });
    v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400 });
    await books(w);
  });

  it('I paid twice (double tap): one payment', async () => {
    const { w, g } = await booked();
    const [a, b] = await Promise.all([iPaid(w, g.id, 'Casey'), iPaid(w, g.id, 'Casey')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(seatRow(w, g.id, 'Casey')).toMatchObject({ payment_status: 'paid', payment_amount_cents: 1400 });
    await books(w);
  });

  it('I paid with an amount that is no longer right (stale screen): refused with a plain message', async () => {
    const { w, g } = await booked();
    const r = await iPaid(w, g.id, 'Casey', true, 1100);
    friendly(r, 409);
    expect(r.data.message).toBe('The amount changed to $14. Look again.');
    expect(seatRow(w, g.id, 'Casey').payment_status).toBe('unpaid');
  });

  it('organizer confirmed it: "Paid $14", no Didn\'t pay?; the player\'s Didn\'t pay? is refused politely', async () => {
    const { w, g } = await booked();
    await markPaid(w, g.id, 'Casey');
    const v = await shown(w, 'Casey');
    expect(card(v, g.id)).toMatch(/Paid \$14/);
    expect(card(v, g.id)).not.toMatch(/Didn't pay\?/);
    const r = await iPaid(w, g.id, 'Casey', false);
    friendly(r, 409);
    expect(r.data.message).toMatch(/organizer marked this paid/);
  });

  it('Paid with credit + Undo: Undo gives the $14 back and the card shows $14 due with Use credit and Pay', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    expect(card(await shown(w, 'Casey'), g.id)).toMatch(/Paid with credit.*Undo/);
    expect((await undoCredit(w, g.id, 'Casey')).data).toEqual({ ok: true, returnedCents: 1400 });
    const v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400 });
    expect(card(v, g.id)).toMatch(/Use credit.*Pay/);
    // Undo again: nothing to undo, plain words.
    friendly(await undoCredit(w, g.id, 'Casey'), 409);
    // Use credit puts it back on.
    expect((await useCredit(w, g.id, 'Casey')).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    await books(w);
  });

  it('Undo of Paid with credit on a no-court game: no Pay, but "Use $14 credit" is offered', async () => {
    const w = await world();
    givePot(w, 'Casey', 1400);
    const g = await on(w, '2026-11-12');
    await join(w, g.id, 'Casey');
    await undoCredit(w, g.id, 'Casey');
    const v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ oweCents: 0, useCreditCents: 1400 });
    const text = card(v, g.id);
    expect(text).toContain('Use $14 credit');
    expect(text).not.toMatch(/\bPay\b/);
    await books(w);
  });

  it('part credit: "Credit $3 used", "$11 due", Pay $11; I paid records the whole $14', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 300);
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    const v = await shown(w, 'Casey');
    const text = card(v, g.id);
    expect(text).toContain('Credit $3 used');
    expect(text).toContain('$11 due');
    expect(text).toContain('Pay $11');
    expect((await iPaid(w, g.id, 'Casey', true, 1100)).status).toBe(200);
    expect(seatRow(w, g.id, 'Casey')).toMatchObject({ payment_status: 'paid', payment_amount_cents: 1400 });
    // Didn't pay? undoes only the cash: back to "Credit $3 used, $11 due".
    expect((await iPaid(w, g.id, 'Casey', false)).status).toBe(200);
    expect(await mine(w, 'Casey', g.id)).toMatchObject({ paymentStatus: 'unpaid', creditCents: 300, oweCents: 1100 });
    await books(w);
  });

  it('Undo is refused on a part-credit payment (credit + cash): plain words, nothing moves', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 300);
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Casey');
    expect((await mine(w, 'Casey', g.id))!.paidWithCredit).toBe(false);
    friendly(await undoCredit(w, g.id, 'Casey'), 409);
    expect(liveUsed(w, g.id, 'Casey')).toBe(300);
    await books(w);
  });

  it('Use credit with no credit: refused, plain words', async () => {
    const { w, g } = await booked();
    const r = await useCredit(w, g.id, 'Casey');
    friendly(r, 409);
    expect(r.data.message).toBe('You have no credit to use.');
  });

  it('Use credit on a game not joined / already paid: refused, plain words', async () => {
    const { w, g } = await booked();
    givePot(w, 'Devon', 1400);
    friendly(await useCredit(w, g.id, 'Devon'), 409);
    await markPaid(w, g.id, 'Casey');
    givePot(w, 'Casey', 1400);
    friendly(await useCredit(w, g.id, 'Casey'), 409);
  });

  it('two games owed, credit arrives ($14), Use credit tapped on both at once: $14 used once', async () => {
    const w = await world({ court: 'booked' });
    const a = await on(w, '2026-11-03');
    const b = await on(w, '2026-11-05');
    await join(w, a.id, 'Casey');
    await join(w, b.id, 'Casey');
    givePot(w, 'Casey', 1400);
    const [x, y] = await Promise.all([useCredit(w, a.id, 'Casey'), useCredit(w, b.id, 'Casey')]);
    expect([x.status, y.status].filter((s) => s === 200)).toHaveLength(1);
    expect(liveUsed(w, a.id, 'Casey') + liveUsed(w, b.id, 'Casey')).toBe(1400);
    await books(w);
  });

  it('waitlist: the card owes nothing, no Pay, no owed entry', async () => {
    const w = await world({ court: 'booked', maxPlayers: 4 });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const v = await shown(w, 'Frankie');
    expect(sOf(v, g.id).mine).toMatchObject({ status: 'waitlisted', oweCents: 0, useCreditCents: 0 });
    expect(v.owed).toEqual([]);
    expect(card(v, g.id)).not.toMatch(/\bPay\b|\$14 due/);
    await books(w);
  });

  it('canceled with a reason: "Canceled - Thanksgiving" data, credit back, no Pay, no owed, I\'m in refused', async () => {
    const w = await world({ court: 'booked', courtAll: true });
    const g = await on(w, '2026-11-26');
    givePot(w, 'Casey', 1400);
    await join(w, g.id, 'Casey');
    await join(w, g.id, 'Devon');
    await markPaid(w, g.id, 'Devon');
    await join(w, g.id, 'Emery');
    expect((await cancelGame(w, g.id, 'Thanksgiving')).status).toBe(200);
    for (const n of ['Casey', 'Devon', 'Emery']) {
      const v = await shown(w, n);
      const s = sOf(v, g.id);
      expect(s).toMatchObject({ canceled: true, cancelReason: 'Thanksgiving', holiday: 'Thanksgiving', openSpots: 0 });
      expect(s.mine!.useCreditCents).toBe(0);
      expect(v.owed).toEqual([]);
      expect(card(v, g.id)).not.toMatch(/\bPay\b|due/);
    }
    expect(await pot(w, 'Casey')).toBe(1400);
    expect(await pot(w, 'Devon')).toBe(1400);
    expect(await pot(w, 'Emery')).toBe(0);
    friendly(await joinRaw(w, g.id, 'Frankie'), 409);
    await books(w);
  });

  it('finalized, 5 played (all paid $14): final price $11, $3 back as credit with "(5 played)"', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    for (const n of five) await markPaid(w, g.id, n);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await finalize(w, g.id)).status).toBe(200);
    const v = await view(w, 'Casey');
    expect(v.credit.balanceCents).toBe(300);
    const e = v.credit.history.find((h) => h.reason === 'finalized')!;
    expect(e).toMatchObject({ kind: 'kept', cents: 300, playedCount: 5, sessionId: g.id });
    expect(creditChanges(v.credit.history, TZ, 'Alex')[0].text).toMatch(/\$3 back from Nov 3 \(5 played\)/);
    await books(w);
  });

  const table: [number, number][] = [[4, 1400], [5, 1100], [6, 900], [7, 800], [8, 700], [9, 600], [10, 500]];
  for (const [n, final] of table) {
    it(`price table: ${n} played, all paid $14 -> final $${final / 100}, $${(PRICE - final) / 100} back each`, async () => {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-03');
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA].slice(0, n);
      await joinAll(w, g.id, names);
      for (const p of names) await markPaid(w, g.id, p);
      w.app.now = Date.parse(g.endsAt) + HOUR;
      expect((await finalize(w, g.id)).status).toBe(200);
      for (const p of names.slice(0, 2)) expect(await pot(w, p)).toBe(PRICE - final);
      await books(w);
    });
  }

  it('finalized with an unpaid player: owed at the final price ($11, "finalized"), I paid $11 settles it', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    for (const n of five.slice(0, 4)) await markPaid(w, g.id, n);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await finalize(w, g.id)).status).toBe(200);
    const v = await shown(w, 'Frankie');
    expect(v.owed).toEqual([expect.objectContaining({ sessionId: g.id, amountCents: 1100, finalized: true })]);
    expect((await iPaid(w, g.id, 'Frankie', true, 1100)).status).toBe(200);
    expect((await shown(w, 'Frankie')).owed).toEqual([]);
    await books(w);
  });

  it('finalized, did not play, paid with credit: the whole $14 comes back; Undo is refused after Finalize', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await finalize(w, g.id, ['Blair', 'Devon', 'Emery', 'Frankie'])).status).toBe(200);
    friendly(await undoCredit(w, g.id, 'Casey'), 409);
    expect(await pot(w, 'Casey')).toBe(1400);
    await books(w);
  });

  it('game day: the top Pay card appears at 8:00 AM Eastern (not 7:59), only for the booked game', async () => {
    const w = await world();
    const g = await on(w, '2026-11-03');
    await setCourt(w, g.id, 'booked');
    await join(w, g.id, 'Casey');
    w.app.now = Date.parse('2026-11-03T12:59:00.000Z'); // 7:59 AM EST
    expect((await shown(w, 'Casey')).payDue).toEqual([]);
    w.app.now = Date.parse('2026-11-03T13:00:00.000Z'); // 8:00 AM EST
    expect((await shown(w, 'Casey')).payDue.map((o) => o.sessionId)).toEqual([g.id]);
    await setCourt(w, g.id, 'not_booked');
    expect((await shown(w, 'Casey')).payDue).toEqual([]);
  });

  it('booked, then Not booked, then Booked: Pay hides and comes back; a payment made stays paid', async () => {
    const { w, g } = await booked(['Casey', 'Devon']);
    await iPaid(w, g.id, 'Devon');
    await setCourt(w, g.id, 'not_booked');
    expect(card(await shown(w, 'Casey'), g.id)).not.toMatch(/\bPay\b|due/);
    expect(card(await shown(w, 'Devon'), g.id)).toMatch(/Paid/);
    await setCourt(w, g.id, 'waitlist');
    expect(card(await shown(w, 'Casey'), g.id)).not.toMatch(/\bPay\b|due/);
    await setCourt(w, g.id, 'booked');
    expect(card(await shown(w, 'Casey'), g.id)).toMatch(/\$14 due.*Pay/);
    await books(w);
  });

  it('the organizer\'s own player screen: in the game with no share, no Pay, no credit even with a pot', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Alex', 1400);
    const g = await on(w, '2026-11-03');
    expect(await join(w, g.id, 'Alex')).toEqual({ result: 'confirmed' });
    const v = await shown(w, 'Alex');
    expect(sOf(v, g.id).mine).toMatchObject({ status: 'confirmed', paymentStatus: 'not_applicable', oweCents: 0, useCreditCents: 0, shareCents: null, dropCreditCents: 0, dropCashCents: 0 });
    expect(v.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    expect(v.owed).toEqual([]);
    expect(card(v, g.id)).not.toMatch(/\bPay\b|due|credit/i);
    friendly(await iPaid(w, g.id, 'Alex'), 409);
    friendly(await useCredit(w, g.id, 'Alex'), 409);
    friendly(await askCashOut(w, 'Alex', 100), 409);
    expect(liveUsed(w, g.id, 'Alex')).toBe(0);
  });

  for (let seed = 1; seed <= 6; seed++) {
    it(`way-forward sweep, seed ${seed}: random taps by 6 players over 3 games, every card always has a way forward`, async () => {
      let s = seed * 7919;
      const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
      const w = await world({ maxPlayers: 5 });
      const games = [(await on(w, '2026-11-03')).id, (await on(w, '2026-11-05')).id, (await on(w, '2026-11-10')).id];
      await setCourt(w, games[0], 'booked');
      await setCourt(w, games[1], 'waitlist');
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'];
      givePot(w, 'Casey', 1400);
      givePot(w, 'Devon', 300);
      givePot(w, 'Emery', 2500);
      for (let step = 0; step < 30; step++) {
        const n = pick(names);
        const gid = pick(games);
        const act = pick(['join', 'join', 'drop', 'paid', 'unpaid', 'use', 'undo', 'cash', 'nocash', 'court', 'mark']);
        if (act === 'join') await joinRaw(w, gid, n);
        else if (act === 'drop') await drop(w, gid, n);
        else if (act === 'paid') await iPaid(w, gid, n);
        else if (act === 'unpaid') await iPaid(w, gid, n, false);
        else if (act === 'use') await useCredit(w, gid, n);
        else if (act === 'undo') await undoCredit(w, gid, n);
        else if (act === 'cash') await askCashOut(w, n, 100 * (1 + Math.floor(rnd() * 5)));
        else if (act === 'nocash') await call(w, n, 'POST', '/api/me/refund-request/cancel', {});
        else if (act === 'court') await setCourt(w, gid, pick(['booked', 'not_booked', 'waitlist'] as Court[]));
        else await markPaid(w, gid, n, rnd() < 0.7);
        if (step % 6 === 5) await books(w, `seed ${seed} step ${step} (${act} ${n})`);
      }
      await books(w, `seed ${seed} end`);
    });
  }
});

// =====================================================================================================
describe('4. Credit', () => {
  it('history entries and plain words: kept, used at I\'m in, returned on drop, used again; balance = history', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    const g = await on(w, '2026-11-05');
    await join(w, g.id, 'Casey');
    w.app.advance(HOUR);
    await drop(w, g.id, 'Casey');
    w.app.advance(HOUR);
    await join(w, g.id, 'Casey');
    const v = await view(w, 'Casey');
    expect(v.credit.history.map((e) => [e.kind, e.cents, e.reason, e.endedReason])).toEqual([
      ['used', 1400, 'auto', null],
      ['used', 1400, 'auto', 'dropped'],
      ['kept', 1400, 'canceled', null],
    ]);
    expect(creditChanges(v.credit.history, TZ, 'Alex').map((c) => c.text)).toEqual([
      'Oct 26: $14 used for Nov 5',
      'Oct 26: $14 returned from Nov 5 (you dropped)',
      'Oct 26: $14 used for Nov 5',
      'Oct 26: $14 back from Oct 29 (canceled)',
    ]);
    expect(v.credit.balanceCents).toBe(0);
    await books(w);
  });

  it('only the last 10 changes are listed, newest first', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    const g = await on(w, '2026-11-05');
    for (let i = 0; i < 6; i++) {
      await join(w, g.id, 'Casey');
      w.app.advance(60_000);
      await drop(w, g.id, 'Casey');
      w.app.advance(60_000);
    }
    const v = await view(w, 'Casey');
    const list = creditChanges(v.credit.history, TZ, 'Alex');
    expect(list).toHaveLength(10);
    expect([...list].sort((a, b) => b.at.localeCompare(a.at)).map((c) => c.key)).toEqual(list.map((c) => c.key));
    expect(v.credit.balanceCents).toBe(1400);
    await books(w);
  });

  it('cash-out request: amount reserved, usable shrinks, pending shows; Withdraw makes it usable again', async () => {
    const w = await world();
    givePot(w, 'Casey', 2000);
    const r = await askCashOut(w, 'Casey', 1500);
    expect(r.data).toMatchObject({ ok: true, request: { cents: 1500 } });
    let v = await view(w, 'Casey');
    expect(v.credit).toMatchObject({ balanceCents: 2000, usableCents: 500, pending: { cents: 1500 } });
    expect(w.sent.length + (await w.app.settle(), w.sent.length)).toBeGreaterThan(0); // one Telegram alert (fake)
    expect((await call(w, 'Casey', 'POST', '/api/me/refund-request/cancel', {})).data).toEqual({ ok: true, changed: true });
    v = await view(w, 'Casey');
    expect(v.credit).toMatchObject({ balanceCents: 2000, usableCents: 2000, pending: null });
    expect((await call(w, 'Casey', 'POST', '/api/me/refund-request/cancel', {})).data).toEqual({ ok: true, changed: false });
    await books(w);
  });

  const badAsks: [string, unknown, number, RegExp][] = [
    ['more than usable', 2500, 409, /You have 20 dollars of credit/],
    ['not whole dollars', 1050, 400, /whole-dollar/],
    ['zero', 0, 400, /whole-dollar/],
    ['negative', -100, 400, /between/],
    ['text', 'ten', 400, /between/],
  ];
  for (const [label, cents, status, msg] of badAsks) {
    it(`cash-out request refused (${label}): plain message`, async () => {
      const w = await world();
      givePot(w, 'Casey', 2000);
      const r = await call(w, 'Casey', 'POST', '/api/me/refund-request', { cents });
      friendly(r, status);
      expect(r.data.message).toMatch(msg);
      expect((await view(w, 'Casey')).credit.pending).toBeNull();
    });
  }

  it('a second cash-out request while one is open: refused, plain words', async () => {
    const w = await world();
    givePot(w, 'Casey', 2000);
    await askCashOut(w, 'Casey', 500);
    const r = await askCashOut(w, 'Casey', 500);
    friendly(r, 409);
    expect(r.data.message).toMatch(/already asked/);
  });

  it('pending cash out is never used by itself; Use it (all) withdraws the request; the card is Paid with credit', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    await askCashOut(w, 'Casey', 1400);
    const g = await on(w, '2026-11-03');
    const r = await join(w, g.id, 'Casey');
    expect(r).toEqual({ result: 'confirmed', cashOutOffer: { cents: 1400, requestCents: 1400 } });
    friendly(await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 }), 409);
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 })).data).toEqual({ ok: true, usedCents: 1400, paid: true, requestLeftCents: 0 });
    const v = await view(w, 'Casey');
    expect(v.credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null });
    expect(sOf(v, g.id).mine).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    friendly(await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 }), 409);
    await books(w);
  });

  it('partial: pot $20, cash out $15 -> $5 used at I\'m in, $9 offered; Use it shrinks the request to $6', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Devon', 2000);
    await askCashOut(w, 'Devon', 1500);
    const g = await on(w, '2026-11-03');
    expect(await join(w, g.id, 'Devon')).toEqual({ result: 'confirmed', creditCents: 500, paidWithCredit: false, cashOutOffer: { cents: 900, requestCents: 1500 } });
    expect((await call(w, 'Devon', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 900 })).data).toEqual({ ok: true, usedCents: 900, paid: true, requestLeftCents: 600 });
    expect((await view(w, 'Devon')).credit).toMatchObject({ balanceCents: 600, usableCents: 0, pending: { cents: 600 } });
    await books(w);
  });

  it('use-cash-out with no request or no seat: refused, plain words', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    friendly(await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 }), 409);
    givePot(w, 'Casey', 1400);
    await askCashOut(w, 'Casey', 1400);
    friendly(await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 }), 409);
  });

  it('cash out marked refunded by the organizer: "$14 cashed out" in the list, balance $0, chip gone', async () => {
    const w = await world();
    givePot(w, 'Casey', 1400);
    const id = (await askCashOut(w, 'Casey', 1400)).data.request.id;
    expect((await w.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents: 1400 })).status).toBe(200);
    const v = await view(w, 'Casey');
    expect(v.credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null });
    expect(creditChanges(v.credit.history, TZ, 'Alex')[0].text).toMatch(/\$14 cashed out/);
    await books(w);
  });

  it('cash-out request and I\'m in at the same moment: the pot never goes below $0, never reserved and spent twice', async () => {
    for (let k = 0; k < 4; k++) {
      const w = await world({ court: 'booked' });
      givePot(w, 'Casey', 1400);
      const g = await on(w, '2026-11-03');
      const calls = [askCashOut(w, 'Casey', 1400), joinRaw(w, g.id, 'Casey')];
      const [ask, j] = k % 2 ? await Promise.all(calls) : (await Promise.all(calls.reverse())).reverse();
      expect(j.status).toBe(200);
      const v = await view(w, 'Casey');
      const used = liveUsed(w, g.id, 'Casey');
      expect(used + (v.credit.pending?.cents ?? 0)).toBeLessThanOrEqual(1400);
      if (ask.status !== 200) friendly(ask, 409);
      await books(w);
    }
  });

  it('chip fields: a new player has nothing; any pot or pending request shows, hasCredit drives creditBackCents', async () => {
    const w = await world({ court: 'booked' });
    expect((await view(w, 'Gale')).credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Gale');
    await markPaid(w, g.id, 'Gale');
    await drop(w, g.id, 'Gale');
    let v = await view(w, 'Gale');
    expect(v.credit).toMatchObject({ balanceCents: 1400, usableCents: 1400 });
    expect(sOf(v, g.id).mine!.creditBackCents).toBe(1400);
    // Spent elsewhere: the "Your $14 is now credit" line goes.
    await join(w, (await on(w, '2026-11-05')).id, 'Gale');
    v = await view(w, 'Gale');
    expect(v.credit.balanceCents).toBe(0);
    expect(sOf(v, g.id).mine!.creditBackCents).toBe(0);
    await books(w);
  });
});

// =====================================================================================================
describe('5. Waitlist and promotion', () => {
  async function full(max = 4) {
    const w = await world({ court: 'booked', maxPlayers: max });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery'].slice(0, max));
    return { w, g };
  }

  it('order: three wait in tap order; positions 1, 2, 3 on each phone', async () => {
    const { w, g } = await full();
    for (const [i, n] of ['Frankie', 'Gale', 'Harper'].entries()) expect(await join(w, g.id, n)).toEqual({ result: 'waitlisted', position: i + 1 });
    for (const [i, n] of ['Frankie', 'Gale', 'Harper'].entries()) expect((await mine(w, n, g.id))!.waitlistPosition).toBe(i + 1);
  });

  it('promotion on a drop: the first waiting moves in with "spot_opened", the rest move up', async () => {
    const { w, g } = await full();
    await joinAll(w, g.id, ['Frankie', 'Gale']);
    await drop(w, g.id, 'Blair');
    expect(await mine(w, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', promotion: 'spot_opened', oweCents: 1400 });
    expect(await mine(w, 'Gale', g.id)).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 });
    expect(card(await shown(w, 'Frankie'), g.id)).toMatch(/\$14 due.*Pay/);
    await books(w);
  });

  for (const [credit, exp] of [[1400, { paymentStatus: 'paid', paidWithCredit: true }], [300, { creditCents: 300, oweCents: 1100 }], [2000, { paymentStatus: 'paid', paidWithCredit: true }]] as const) {
    it(`credit applied on promotion: pot $${credit / 100}`, async () => {
      const { w, g } = await full();
      givePot(w, 'Frankie', credit);
      await join(w, g.id, 'Frankie');
      expect(await pot(w, 'Frankie')).toBe(credit);
      await drop(w, g.id, 'Casey');
      expect(await mine(w, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', promotion: 'spot_opened', ...exp });
      expect(await pot(w, 'Frankie')).toBe(Math.max(0, credit - PRICE));
      await books(w);
    });
  }

  it('promotion with a pending cash out: the reserved amount is not used; the card shows $14 due', async () => {
    const { w, g } = await full();
    givePot(w, 'Frankie', 1400);
    await askCashOut(w, 'Frankie', 1400);
    await join(w, g.id, 'Frankie');
    await drop(w, g.id, 'Casey');
    expect(await mine(w, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', oweCents: 1400, creditCents: 0, useCreditCents: 0 });
    expect((await view(w, 'Frankie')).credit).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: { cents: 1400 } });
    await books(w);
  });

  it('a waitlisted player leaves: the others move up, nobody is promoted past the max', async () => {
    const { w, g } = await full();
    await joinAll(w, g.id, ['Frankie', 'Gale', 'Harper']);
    await drop(w, g.id, 'Gale');
    expect((await mine(w, 'Harper', g.id))!.waitlistPosition).toBe(2);
    expect(sOf(await view(w, 'Blair'), g.id).confirmed).toHaveLength(4);
  });

  it('two drops at the same moment: two promotions, never above the max', async () => {
    const { w, g } = await full();
    givePot(w, 'Frankie', 1400);
    givePot(w, 'Gale', 1400);
    await joinAll(w, g.id, ['Frankie', 'Gale', 'Harper']);
    await Promise.all([drop(w, g.id, 'Blair'), drop(w, g.id, 'Casey')]);
    const s = sOf(await view(w, 'Harper'), g.id);
    expect(s.confirmed.map((c) => c.name).sort()).toEqual(['Devon', 'Emery', 'Frankie', 'Gale']);
    expect(s.waitlist.map((c) => c.name)).toEqual(['Harper']);
    expect(await pot(w, 'Frankie')).toBe(0);
    expect(await pot(w, 'Gale')).toBe(0);
    await books(w);
  });

  it('promoted, then drops and rejoins: promotion note gone, credit used once again', async () => {
    const { w, g } = await full();
    givePot(w, 'Frankie', 1400);
    await join(w, g.id, 'Frankie');
    await drop(w, g.id, 'Casey');
    await drop(w, g.id, 'Frankie');
    expect(await pot(w, 'Frankie')).toBe(1400);
    await join(w, g.id, 'Frankie');
    expect(await mine(w, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', promotion: null, paidWithCredit: true });
    await books(w);
  });

  it('a waitlisted player taps I\'m in again: stays in line, nothing changes', async () => {
    const { w, g } = await full();
    await joinAll(w, g.id, ['Frankie', 'Gale']);
    expect(await join(w, g.id, 'Gale')).toEqual({ result: 'waitlisted', position: 2 });
  });

  it('FIXED (Nov 1): the organizer raises Max players while people wait: the first waiting player moves in', async () => {
    const { w, g } = await full();
    givePot(w, 'Frankie', 1400);
    await join(w, g.id, 'Frankie');
    expect((await setMax(w, 6)).status).toBe(200);
    const s = sOf(await view(w, 'Frankie'), g.id);
    // Rule: a real waitlist exists only when the game is full beyond Max players; 4 of 6 is not full.
    expect(s.mine!.status, 'Frankie still waits on a game with 2 open spots').toBe('confirmed');
    expect(s.waitlist).toEqual([]);
    await books(w);
  });

  it('FIXED (Nov 1): after Max players goes up, a newcomer\'s I\'m in does not jump ahead of someone already waiting', async () => {
    const { w, g } = await full();
    await join(w, g.id, 'Frankie');
    await setMax(w, 5);
    expect((await join(w, g.id, 'Gale')).result).toBe('waitlisted');
    expect((await mine(w, 'Frankie', g.id))!.status, 'Frankie (waiting first) got the 5th spot').toBe('confirmed');
  });
});

// =====================================================================================================
describe('6. Time edges (fake clock)', () => {
  it('cancel-by is always start minus 12 hours: Tue Nov 3 8:00 PM -> 8:00 AM, on the card data', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    const s = sOf(await view(w, 'Casey'), g.id);
    expect(s.startsAt).toBe('2026-11-04T01:00:00.000Z');
    expect(s.dropCutoffAt).toBe('2026-11-03T13:00:00.000Z');
    expect(s.holiday).toBe('Election Day');
  });

  it('at the start: started, no open spots, I\'m in and Drop out refused with plain words; at the end it leaves the list', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    w.app.now = Date.parse(g.startsAt) - 1;
    expect(sOf(await view(w, 'Casey'), g.id)).toMatchObject({ started: false });
    w.app.now = Date.parse(g.startsAt);
    const s = sOf(await view(w, 'Casey'), g.id);
    expect(s).toMatchObject({ started: true, openSpots: 0, past: false });
    friendly(await joinRaw(w, g.id, 'Devon'), 409);
    friendly(await drop(w, g.id, 'Casey'), 409);
    // Still owes: Pay keeps working during the game.
    expect(s.mine!.oweCents).toBe(1400);
    w.app.now = Date.parse(g.endsAt) - 1;
    expect(sOf(await view(w, 'Casey'), g.id)).toBeTruthy();
    w.app.now = Date.parse(g.endsAt);
    expect(sOf(await view(w, 'Casey'), g.id)).toBeUndefined();
    // The money is still owed and listed.
    expect((await shown(w, 'Casey')).owed.map((o) => o.sessionId)).toEqual([g.id]);
    await books(w);
  });

  it('Sun Nov 1, 1:30 AM happens twice: taps in both hours work, the Tue Nov 3 times stay 8:00 PM EST', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 1400);
    w.app.now = Date.parse('2026-11-01T05:30:00.000Z'); // 1:30 AM EDT
    await join(w, g.id, 'Casey');
    w.app.now = Date.parse('2026-11-01T06:30:00.000Z'); // 1:30 AM EST (again)
    await drop(w, g.id, 'Casey');
    w.app.now = Date.parse('2026-11-01T06:45:00.000Z');
    await join(w, g.id, 'Casey');
    const v = await view(w, 'Casey');
    expect(sOf(v, g.id)).toMatchObject({ startsAt: '2026-11-04T01:00:00.000Z', dropCutoffAt: '2026-11-03T13:00:00.000Z' });
    expect(v.credit.history.filter((e) => e.kind === 'used').map((e) => e.at)).toEqual(['2026-11-01T06:45:00.000Z', '2026-11-01T05:30:00.000Z']);
    expect(creditChanges(v.credit.history, TZ, 'Alex').slice(0, 3).map((c) => c.text)).toEqual(['Nov 1: $14 used for Nov 3', 'Nov 1: $14 returned from Nov 3 (you dropped)', 'Nov 1: $14 used for Nov 3']);
    await books(w);
  });

  it('a game during the repeated hour (Sun Nov 1, 1:30 AM EST): cancel-by is 12 real hours before; the calendar file says 1:30 AM', async () => {
    const w = await world();
    w.app.now = Date.parse('2026-10-30T16:00:00.000Z');
    const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-01T06:30:00.000Z', endsAt: '2026-11-01T08:30:00.000Z' });
    expect(add.status, add.text).toBe(200);
    await join(w, add.data.id, 'Casey');
    const s = sOf(await view(w, 'Casey'), add.data.id);
    expect(s.dropCutoffAt).toBe('2026-10-31T18:30:00.000Z');
    const ics = await w.app.client().call('GET', `/api/sessions/${add.data.id}/calendar.ics`);
    expect(ics.text).toContain('DTSTART;TZID=America/Detroit:20261101T013000');
    expect(ics.text).toContain('DTEND;TZID=America/Detroit:20261101T033000');
  });

  it('a game that crosses midnight (11:00 PM to 1:00 AM): shown, joinable until 11:00 PM, gone at 1:00 AM', async () => {
    const w = await world();
    const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-07T04:00:00.000Z', endsAt: '2026-11-07T06:00:00.000Z' });
    expect(add.status, add.text).toBe(200);
    w.app.now = Date.parse('2026-11-07T03:59:59.000Z');
    expect((await join(w, add.data.id, 'Casey')).result).toBe('confirmed');
    w.app.now = Date.parse('2026-11-07T05:00:00.000Z'); // 12:00 AM (midnight)
    expect(sOf(await view(w, 'Casey'), add.data.id)).toMatchObject({ started: true });
    w.app.now = Date.parse('2026-11-07T06:00:00.000Z');
    expect(sOf(await view(w, 'Casey'), add.data.id)).toBeUndefined();
  });

  it('month change: a drop on Oct 31 at 11:59 PM for Nov 3 reads "Oct 31", a use on Nov 1 reads "Nov 1"', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 1400);
    w.app.now = Date.parse('2026-11-01T03:59:00.000Z'); // Sat Oct 31 11:59 PM EDT
    await join(w, g.id, 'Casey');
    await drop(w, g.id, 'Casey');
    w.app.now = Date.parse('2026-11-01T04:01:00.000Z'); // Sun Nov 1 12:01 AM EDT
    await join(w, g.id, 'Casey');
    const texts = creditChanges((await view(w, 'Casey')).credit.history, TZ, 'Alex').map((c) => c.text);
    expect(texts.slice(0, 3)).toEqual(['Nov 1: $14 used for Nov 3', 'Oct 31: $14 returned from Nov 3 (you dropped)', 'Oct 31: $14 used for Nov 3']);
  });

  it('year change: Dec 31 (New Year\'s Eve) and Jan 2027 games show, join and drop work across midnight Dec 31', async () => {
    const w = await world();
    w.app.now = Date.parse('2026-12-28T17:00:00.000Z');
    const v = await view(w, 'Casey');
    const dec31 = v.sessions.find((s) => dayOf(s.startsAt) === '2026-12-31')!;
    expect(dec31.holiday).toBe("New Year's Eve");
    const jan = v.sessions.find((s) => dayOf(s.startsAt).startsWith('2027-01'))!;
    expect(jan).toBeTruthy();
    givePot(w, 'Casey', 1400);
    await setCourt(w, jan.id, 'booked');
    w.app.now = Date.parse('2027-01-01T04:59:00.000Z'); // Dec 31 11:59 PM EST
    await join(w, jan.id, 'Casey');
    w.app.now = Date.parse('2027-01-01T05:01:00.000Z'); // Jan 1 12:01 AM
    expect((await drop(w, jan.id, 'Casey')).data).toMatchObject({ creditReturnedCents: 1400 });
    const t = creditChanges((await view(w, 'Casey')).credit.history, TZ, 'Alex').map((c) => c.text);
    expect(t[0]).toMatch(/^Jan 1: \$14 returned from Jan \d+ \(you dropped\)$/);
    expect(t[1]).toMatch(/^Dec 31: \$14 used for Jan \d+$/);
    await books(w);
  });

  it('Thanksgiving week: Tue Nov 24 is a normal game, Thu Nov 26 says Thanksgiving; canceling it gives credit back with the reason', async () => {
    const w = await world({ court: 'booked', courtAll: true });
    const tue = await on(w, '2026-11-24');
    const thu = await on(w, '2026-11-26');
    let v = await view(w, 'Casey');
    expect(sOf(v, tue.id).holiday).toBeNull();
    expect(sOf(v, thu.id).holiday).toBe('Thanksgiving');
    givePot(w, 'Casey', 1400);
    await join(w, thu.id, 'Casey');
    await cancelGame(w, thu.id, 'Thanksgiving');
    v = await view(w, 'Casey');
    expect(sOf(v, thu.id)).toMatchObject({ canceled: true, cancelReason: 'Thanksgiving' });
    expect(v.credit.balanceCents).toBe(1400);
    expect(creditChanges(v.credit.history, TZ, 'Alex')[0].text).toBe('Oct 26: $14 returned from Nov 26 (canceled)');
    // The credit goes on Tue Nov 24 instead.
    expect(await join(w, tue.id, 'Casey')).toMatchObject({ creditCents: 1400, paidWithCredit: true });
    await books(w);
  });

  it('a moved game: drop rules follow the new time (cancel-by and start move with it)', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-05');
    await join(w, g.id, 'Casey');
    const startsAt = '2026-11-06T00:30:00.000Z'; // 7:30 PM EST
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt, endsAt: '2026-11-06T02:30:00.000Z' })).status).toBe(200);
    const s = sOf(await view(w, 'Casey'), g.id);
    expect(s).toMatchObject({ startsAt, dropCutoffAt: '2026-11-05T12:30:00.000Z' });
    w.app.now = Date.parse(startsAt);
    friendly(await drop(w, g.id, 'Casey'), 409);
  });
});

// =====================================================================================================
describe('7. Privacy', () => {
  /** A busy group: credit, cash outs, payments, a court cost and a membership. */
  async function busy() {
    const w = await world({ court: 'booked' });
    await w.organizer.call('PUT', '/api/admin/group', { settings: { typicalCourtCostCents: 4700, monthlyMembershipCents: 3300 } });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 1700);
    givePot(w, 'Devon', 900);
    await askCashOut(w, 'Devon', 900);
    await joinAll(w, g.id, ['Alex', 'Casey', 'Devon', 'Emery', 'Blair']);
    await markPaid(w, g.id, 'Emery');
    await iPaid(w, g.id, 'Blair');
    return { w, g };
  }
  const SECRETS = ['555-01', '555-02', '5550', 'Pays-', '4700', '$47', '3300', '$33', '1700', '$17', '"900"', '$9 ', 'phone', 'venmo_handle', '"venmo"', 'membership', 'courtCost', 'refundRequests'];
  const clean = (text: string) => withoutIds(text).replace(/"version":"[^"]*"/, '').replace(/"v":"[^"]*"/, '');

  it('GET /api/group as Blair: no phones, Venmo names, court cost, membership, or anyone else\'s credit', async () => {
    const { w } = await busy();
    const r = await call(w, 'Blair', 'GET', '/api/group');
    const text = clean(r.text);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    const v = r.data as GroupView;
    for (const p of v.players) expect(Object.keys(p).sort()).toEqual(['id', 'name']);
    for (const s of v.sessions) {
      for (const c of s.confirmed) expect(Object.keys(c).sort()).toEqual(['attendanceConfirmed', 'name']);
      for (const c of s.waitlist) expect(Object.keys(c)).toEqual(['name']);
    }
    // Blair's own history is only Blair's.
    expect(v.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
  });

  it('each player\'s own history has exactly their own entries (count matches the database)', async () => {
    const { w } = await busy();
    for (const n of ['Casey', 'Devon', 'Emery', 'Blair']) {
      const v = await view(w, n);
      const own = ledger(w, n).filter((r) => r.reason !== 'cash');
      expect(v.credit.history.map((e) => e.id).sort(), n).toEqual(own.map((r) => r.id).sort());
    }
  });

  it('GET /api/group/version holds only a short code', async () => {
    const { w } = await busy();
    const r = await call(w, 'Blair', 'GET', '/api/group/version');
    expect(r.status).toBe(200);
    expect(Object.keys(r.data)).toEqual(['v']);
    expect(String(r.data.v).length).toBeLessThanOrEqual(64);
  });

  it('calendar.ics: time and place only, no names, money or phones', async () => {
    const { w, g } = await busy();
    const r = await w.app.client().call('GET', `/api/sessions/${g.id}/calendar.ics`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/text\/calendar/);
    for (const s of [...SECRETS, 'Casey', 'Devon', 'Blair', 'Emery', '$14', 'paid', 'credit']) expect(clean(r.text), s).not.toContain(s);
  });

  it('the join, drop and cash-out answers carry only the player\'s own money', async () => {
    const { w } = await busy();
    const g = await on(w, '2026-11-05');
    const answers = [await join(w, g.id, 'Casey'), await join(w, g.id, 'Blair'), (await drop(w, g.id, 'Blair')).data];
    expect(answers[1]).toEqual({ result: 'confirmed' });
    expect(answers[2]).toEqual({ result: 'withdrawn', creditBackCents: 0, creditReturnedCents: 0 });
  });

  const impersonations: [string, (w: W, sid: string) => Promise<any>, (w: W, sid: string) => Promise<void>][] = [
    ['join with Casey\'s playerId in the body', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/join`, { playerId: w.byName.Casey }), async (w, sid) => {
      expect(seatRow(w, sid, 'Blair').status).toBe('confirmed');
    }],
    ['drop out with Casey\'s playerId in the body', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/withdraw`, { playerId: w.byName.Casey }), async () => {}],
    ['I paid with Casey\'s playerId in the body', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/paid`, { paid: true, playerId: w.byName.Casey }), async () => {}],
    ['Didn\'t pay? with Casey\'s playerId', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/paid`, { paid: false, playerId: w.byName.Casey }), async () => {}],
    ['Undo credit with Casey\'s playerId', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/undo-credit`, { playerId: w.byName.Casey }), async () => {}],
    ['Use credit with Casey\'s playerId', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/use-credit`, { playerId: w.byName.Casey }), async () => {}],
    ['cash out with Casey\'s playerId', (w) => call(w, 'Blair', 'POST', '/api/me/refund-request', { cents: 100, playerId: w.byName.Casey }), async () => {}],
    ['withdraw Casey\'s cash-out request by its id', (w) => call(w, 'Blair', 'POST', '/api/me/refund-request/cancel', { id: w.app.db.raw.prepare('SELECT id FROM refund_requests').get() ? (w.app.db.raw.prepare('SELECT id FROM refund_requests').get() as any).id : '', playerId: w.byName.Casey }), async () => {}],
    ['use Casey\'s cash out on a game by its request id', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/use-cash-out`, { cents: 500, requestId: (w.app.db.raw.prepare('SELECT id FROM refund_requests').get() as any).id, playerId: w.byName.Casey }), async () => {}],
    ['pick Casey\'s name with a forged cookie value', async (w) => {
      const c = w.app.client();
      c.groupKey = w.groupKey;
      c.cookies.set('pb_player', 'forged-token-0123456789');
      return c.call('POST', `/api/me/refund-request`, { cents: 100 });
    }, async () => {}],
    ['act as Casey via the View-as header without the organizer\'s sign-in', (w, sid) => call(w, 'Blair', 'POST', `/api/sessions/${sid}/undo-credit`, undefined).then(() => (phone(w, 'Blair').then((p) => p.call('POST', `/api/sessions/${sid}/undo-credit`, {}, { 'X-View-As': w.byName.Casey })))), async () => {}],
    ['read Casey\'s screen via the View-as header without sign-in', (w) => phone(w, 'Blair').then((p) => p.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Casey })), async () => {}],
    ['pretend-time header from a player', (w) => phone(w, 'Blair').then((p) => p.call('GET', '/api/group', undefined, { 'X-Pretend-Now': '2026-11-03T20:00' })), async () => {}],
    ['an organizer route from a player phone', (w, sid) => call(w, 'Blair', 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName.Casey, paid: false }), async () => {}],
    ['the organizer dashboard from a player phone', (w) => call(w, 'Blair', 'GET', '/api/admin/dashboard'), async () => {}],
  ];
  for (const [label, act, extra] of impersonations) {
    it(`a player cannot act for another: ${label}`, async () => {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-03');
      givePot(w, 'Casey', 2800);
      await join(w, g.id, 'Casey'); // Paid with credit, $14 left
      await askCashOut(w, 'Casey', 1400);
      const before = JSON.stringify([
        w.app.db.raw.prepare('SELECT * FROM session_players WHERE player_id = ?').all(w.byName.Casey),
        ledger(w, 'Casey'),
        w.app.db.raw.prepare('SELECT * FROM refund_requests').all(),
      ]);
      const r = await act(w, g.id);
      if (r.status >= 400) friendly(r);
      else expect(clean(r.text)).not.toMatch(/2800|1400|Casey/);
      const after = JSON.stringify([
        w.app.db.raw.prepare('SELECT * FROM session_players WHERE player_id = ?').all(w.byName.Casey),
        ledger(w, 'Casey'),
        w.app.db.raw.prepare('SELECT * FROM refund_requests').all(),
      ]);
      expect(after, 'Casey\'s seat, credit and request are untouched').toBe(before);
      await extra(w, g.id);
    });
  }

  it('a removed player\'s phone can no longer act or see money', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-05');
    const p = await phone(w, 'Gale');
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Gale}`)).status).toBe(200);
    const r = await p.call('POST', `/api/sessions/${g.id}/join`, {});
    friendly(r, 401);
    expect((await p.call('GET', '/api/group')).data.me).toBeNull();
  });

  it('the plain address (no key, open access): names and games only, no one picked, no money; a wrong key gets plain words', async () => {
    const { w } = await busy();
    const c = w.app.client();
    const r = await c.call('GET', '/api/group');
    expect(r.status).toBe(200);
    expect(r.data.me).toBeNull();
    expect(r.data.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    for (const s of SECRETS) expect(clean(r.text), s).not.toContain(s);
    for (const s of r.data.sessions) expect(s.mine).toBeNull();
    friendly(await c.call('POST', `/api/me/refund-request`, { cents: 100 }), 401);
    c.groupKey = 'not-a-real-key-000000000000';
    friendly(await c.call('GET', '/api/group'), 404);
  });

  it('View as (the organizer, signed in) sees the player\'s screen but cannot save anything', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 1400);
    const v = await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.byName.Casey });
    expect(v.status).toBe(200);
    expect(v.data).toMatchObject({ viewingAs: true, me: { name: 'Casey' }, credit: { balanceCents: 1400 } });
    const r = await w.organizer.call('POST', `/api/sessions/${g.id}/join`, {}, { 'X-View-As': w.byName.Casey });
    friendly(r, 403);
    expect(r.data.message).toBe('Demo only. Nothing was saved.');
    expect(await pot(w, 'Casey')).toBe(1400);
  });
});

// =====================================================================================================
describe('8. Error responses are plain words', () => {
  const FAKE = '00000000-0000-4000-8000-000000000000';
  const cases: [string, (w: W, sid: string) => Promise<any>, number][] = [
    ['unknown session id (join)', (w) => call(w, 'Casey', 'POST', `/api/sessions/${FAKE}/join`, {}), 404],
    ['broken session id (join)', (w) => call(w, 'Casey', 'POST', '/api/sessions/abc/join', {}), 400],
    ['broken %-escape in the address', (w) => call(w, 'Casey', 'POST', '/api/sessions/%E0%A4%A/join', {}), 404],
    ['unknown route', (w) => call(w, 'Casey', 'GET', '/api/nope'), 404],
    ['wrong method', (w) => call(w, 'Casey', 'GET', '/api/me/refund-request'), 405],
    ['not JSON', async (w, sid) => (await phone(w, 'Casey')).call('POST', `/api/sessions/${sid}/paid`, undefined, { 'Content-Type': 'text/plain' }), 415],
    ['I paid with no paid field', (w, sid) => call(w, 'Casey', 'POST', `/api/sessions/${sid}/paid`, {}), 400],
    ['I paid on a game not joined', (w, sid) => call(w, 'Devon', 'POST', `/api/sessions/${sid}/paid`, { paid: true }), 404],
    ['I paid with cents = a string', (w, sid) => call(w, 'Casey', 'POST', `/api/sessions/${sid}/paid`, { paid: true, cents: '14' }), 400],
    ['check in on a game not joined', (w, sid) => call(w, 'Devon', 'POST', `/api/sessions/${sid}/confirm`, {}), 409],
    ['use-cash-out with cents too big', (w, sid) => call(w, 'Casey', 'POST', `/api/sessions/${sid}/use-cash-out`, { cents: 1e12 }), 400],
    ['cross-site post', async (w, sid) => (await phone(w, 'Casey')).call('POST', `/api/sessions/${sid}/join`, {}, { Origin: 'https://evil.example' }), 403],
    ['no name picked yet', async (w, sid) => {
      const c = w.app.client();
      c.groupKey = w.groupKey;
      return c.call('POST', `/api/sessions/${sid}/join`, {});
    }, 401],
    ['pick a name that does not exist', async (w) => {
      const c = w.app.client();
      c.groupKey = w.groupKey;
      return c.call('POST', '/api/me', { playerId: FAKE });
    }, 404],
    ['calendar for an unknown game', (w) => w.app.client().call('GET', `/api/sessions/${FAKE}/calendar.ics`), 404],
    ['request too large', (w, sid) => call(w, 'Casey', 'POST', `/api/sessions/${sid}/paid`, { paid: true, junk: 'x'.repeat(30_000) }), 413],
    ['preferred days junk', (w) => call(w, 'Casey', 'PUT', '/api/me/days', { days: 'every day!!' }), 400],
    ['add a name that is taken', async (w) => {
      const c = w.app.client();
      c.groupKey = w.groupKey;
      return c.call('POST', '/api/players/self', { name: 'casey', confirmNew: true });
    }, 409],
  ];
  for (const [label, act, status] of cases) {
    it(`${label}: ${status} with a plain message`, async () => {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-03');
      await join(w, g.id, 'Casey');
      friendly(await act(w, g.id), status);
    });
  }
});

// =====================================================================================================
describe('9. More edges a bored friend would poke', () => {
  it('credit that arrives after joining a no-court game: "Use $14 credit" works there (no Pay needed)', async () => {
    const w = await world();
    const g = await on(w, '2026-11-12');
    await join(w, g.id, 'Casey');
    givePot(w, 'Casey', 1400);
    expect(card(await shown(w, 'Casey'), g.id)).toContain('Use $14 credit');
    expect((await useCredit(w, g.id, 'Casey')).data).toMatchObject({ ok: true, usedCents: 1400, paid: true });
    expect(card(await shown(w, 'Casey'), g.id)).toMatch(/Paid with credit.*Undo/);
    await books(w);
  });

  it('part credit that arrives after joining a no-court game: "Use $3 credit", then "Credit $3 used" and Pay waits for the court', async () => {
    const w = await world();
    const g = await on(w, '2026-11-12');
    await join(w, g.id, 'Casey');
    givePot(w, 'Casey', 300);
    expect(card(await shown(w, 'Casey'), g.id)).toContain('Use $3 credit');
    expect((await useCredit(w, g.id, 'Casey')).data).toMatchObject({ usedCents: 300, paid: false });
    let text = card(await shown(w, 'Casey'), g.id);
    expect(text).toContain('Credit $3 used');
    expect(text).not.toMatch(/\bPay\b/);
    await setCourt(w, g.id, 'booked');
    text = card(await shown(w, 'Casey'), g.id);
    expect(text).toMatch(/\$11 due.*Pay \$11/);
    await books(w);
  });

  it('after Finalize at $11, an old screen\'s I paid $14 is refused ("The amount changed to $11")', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    for (const n of five.slice(1)) await markPaid(w, g.id, n);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    await finalize(w, g.id);
    const r = await iPaid(w, g.id, 'Blair', true, 1400);
    friendly(r, 409);
    expect(r.data.message).toBe('The amount changed to $11. Look again.');
    await books(w);
  });

  it('a canceled game reopened by the organizer: the cash payment is credit now, the card shows $14 due with Use credit', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-05');
    await join(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Casey');
    await cancelGame(w, g.id);
    expect(await pot(w, 'Casey')).toBe(1400);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    const v = await shown(w, 'Casey');
    expect(sOf(v, g.id).mine).toMatchObject({ status: 'confirmed', paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400 });
    expect(card(v, g.id)).toMatch(/Use credit.*Pay/);
    await books(w);
  });

  it('No to a suggestion, then I\'m in anyway: a normal seat; No on a game already joined changes nothing', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/decline`, {})).status).toBe(200);
    givePot(w, 'Casey', 1400);
    expect(await join(w, g.id, 'Casey')).toMatchObject({ result: 'confirmed', creditCents: 1400 });
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/decline`, {})).status).toBe(200);
    expect(seatRow(w, g.id, 'Casey').status).toBe('confirmed');
    await books(w);
  });

  it('check-in ("Still coming"): works while in, refused with plain words when out or after the start', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    expect((await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/confirm`, {})).status).toBe(200);
    expect(sOf(await view(w, 'Blair'), g.id).confirmed[0]).toEqual({ name: 'Casey', attendanceConfirmed: true });
    friendly(await call(w, 'Devon', 'POST', `/api/sessions/${g.id}/confirm`, {}), 409);
    w.app.now = Date.parse(g.startsAt);
    friendly(await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/confirm`, {}), 409);
  });

  it('drop and I\'m in at the same moment on the same seat (paid with credit): ends consistent, money once', async () => {
    for (let k = 0; k < 4; k++) {
      const w = await world({ court: 'booked' });
      givePot(w, 'Casey', 1400);
      const g = await on(w, '2026-11-03');
      await join(w, g.id, 'Casey');
      const calls = [drop(w, g.id, 'Casey'), joinRaw(w, g.id, 'Casey')];
      const res = k % 2 ? await Promise.all(calls) : (await Promise.all(calls.reverse())).reverse();
      for (const r of res) expect(r.status, r.text).toBe(200);
      const row = seatRow(w, g.id, 'Casey');
      const p = await pot(w, 'Casey');
      expect(p + liveUsed(w, g.id, 'Casey')).toBe(1400);
      if (row.status === 'confirmed') expect(row.payment_status).toBe('paid');
      await books(w);
    }
  });

  it('two games, credit for one: drop the paid one and the $14 does NOT jump onto the other by itself; Use credit moves it', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Casey', 1400);
    const a = await on(w, '2026-11-03');
    const b = await on(w, '2026-11-05');
    await join(w, a.id, 'Casey');
    await join(w, b.id, 'Casey');
    await drop(w, a.id, 'Casey');
    const v = await shown(w, 'Casey');
    expect(sOf(v, b.id).mine).toMatchObject({ oweCents: 1400, useCreditCents: 1400 });
    expect(card(v, b.id)).toMatch(/Use credit.*Pay/);
    expect((await useCredit(w, b.id, 'Casey')).data).toMatchObject({ paid: true });
    await books(w);
  });

  it('a promoted player with a pending cash out can still use it on the game (API), the request shrinks', async () => {
    const w = await world({ court: 'booked', maxPlayers: 4 });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    givePot(w, 'Frankie', 2000);
    await askCashOut(w, 'Frankie', 2000);
    await join(w, g.id, 'Frankie');
    await drop(w, g.id, 'Blair');
    expect(await mine(w, 'Frankie', g.id)).toMatchObject({ status: 'confirmed', oweCents: 1400, useCreditCents: 0 });
    expect((await call(w, 'Frankie', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1400 })).data).toEqual({ ok: true, usedCents: 1400, paid: true, requestLeftCents: 600 });
    await books(w);
  });

  it('the organizer lowers Max players below who is in: nobody is bumped; the card says full; a newcomer waits', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
    await setMax(w, 4);
    const s = sOf(await view(w, 'Harper'), g.id);
    expect(s.confirmed).toHaveLength(6);
    expect(s).toMatchObject({ full: true, joinAs: 'waitlist', openSpots: 0 });
    expect(await join(w, g.id, 'Harper')).toEqual({ result: 'waitlisted', position: 1 });
    await drop(w, g.id, 'Blair');
    expect((await mine(w, 'Harper', g.id))!.status).toBe('waitlisted');
  });

  it('a removed player\'s credit stays theirs (books) and returns if they are added back', async () => {
    const w = await world({ court: 'booked' });
    givePot(w, 'Gale', 1400);
    expect((await w.organizer.call('DELETE', `/api/admin/players/${w.byName.Gale}`)).status).toBe(200);
    expect((await w.organizer.call('PUT', `/api/admin/players/${w.byName.Gale}`, { name: 'Gale', isActive: true })).status).toBe(200);
    w.phones.delete('Gale');
    expect(await pot(w, 'Gale')).toBe(1400);
    await books(w);
  });

  it('long names, emoji, accents and apostrophes travel through join, cards and the count', async () => {
    const w = await world({ court: 'booked' });
    for (const name of ["D'Angelo Martínez-O'Brien", 'Zoë 🏓 Ålund', 'Bartholomew Maximilian Featherstonehaugh']) {
      const c = w.app.client();
      c.groupKey = w.groupKey;
      const r = await c.call('POST', '/api/players/self', { name, confirmNew: true });
      expect(r.status, r.text).toBe(200);
      const g = await on(w, '2026-11-03');
      expect((await c.call('POST', `/api/sessions/${g.id}/join`, {})).data.result).toBe('confirmed');
      const v = (await c.call('GET', '/api/group')).data as GroupView;
      expect(sOf(v, g.id).confirmed.map((x) => x.name)).toContain(name);
      expect(card(courtDisplay(v), g.id)).toContain('$14 due');
    }
  });
});

describe('10. After the start and after Finalize', () => {
  it('(rule vs code) a game that never got "Court booked": once it starts, the card and the top Pay card ask for $14', async () => {
    const w = await world();
    const g = await on(w, '2026-11-03');
    await join(w, g.id, 'Casey');
    w.app.now = Date.parse(g.startsAt) - 60_000;
    expect((await shown(w, 'Casey')).payDue).toEqual([]);
    expect(card(await shown(w, 'Casey'), g.id)).not.toMatch(/due|\bPay\b/);
    w.app.now = Date.parse(g.startsAt) + 60_000;
    const v = await shown(w, 'Casey');
    expect(courtStatus(sOf(v, g.id)).playerText).toBe('Started, no court was booked');
    // Today: the money prompts come back once the game starts, though the card never said Court booked.
    expect(v.payDue.map((o) => [o.sessionId, o.amountCents])).toEqual([[g.id, 1400]]);
    expect(sOf(v, g.id).mine!.oweCents).toBe(1400);
  });

  it('part credit larger than the final price: 10 played, $9 on the seat -> paid with credit, $4 back', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 900);
    const ten = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA.slice(0, 5)];
    await joinAll(w, g.id, ten);
    for (const n of ten.filter((x) => x !== 'Casey')) await markPaid(w, g.id, n);
    expect(await mine(w, 'Casey', g.id)).toMatchObject({ creditCents: 900, oweCents: 500 });
    w.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await finalize(w, g.id)).status).toBe(200);
    const v = await shown(w, 'Casey');
    expect(v.owed).toEqual([]);
    expect(v.credit.balanceCents).toBe(400);
    expect(seatRow(w, g.id, 'Casey').payment_status).toBe('paid');
    await books(w);
  });

  it('part credit, did not play: the $3 comes back at Finalize, nothing owed', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 300);
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    expect((await finalize(w, g.id, five.filter((n) => n !== 'Casey'))).status).toBe(200);
    const v = await shown(w, 'Casey');
    expect(v.owed).toEqual([]);
    expect(v.credit.balanceCents).toBe(300);
    await books(w);
  });

  it('finalized, still unpaid, credit arrives: the top Pay card offers it and Use credit takes only the final $11', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    await joinAll(w, g.id, five);
    for (const n of five.slice(0, 4)) await markPaid(w, g.id, n);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    await finalize(w, g.id);
    givePot(w, 'Frankie', 1400);
    const v = await shown(w, 'Frankie');
    expect(v.payDue).toEqual([expect.objectContaining({ sessionId: g.id, amountCents: 1100, finalized: true })]);
    expect(v.credit.usableCents).toBe(1400);
    expect((await useCredit(w, g.id, 'Frankie')).data).toMatchObject({ ok: true, usedCents: 1100, paid: true });
    expect(await pot(w, 'Frankie')).toBe(300);
    expect((await shown(w, 'Frankie')).payDue).toEqual([]);
    await books(w);
  });

  it('a drop and a cancel at the same moment with a waiter holding credit: nobody keeps credit on a canceled game', async () => {
    for (let k = 0; k < 4; k++) {
      const w = await world({ court: 'booked', maxPlayers: 4 });
      const g = await on(w, '2026-11-05');
      await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
      givePot(w, 'Frankie', 1400);
      await join(w, g.id, 'Frankie');
      const calls = [drop(w, g.id, 'Blair'), cancelGame(w, g.id)];
      const res = k % 2 ? await Promise.all(calls) : (await Promise.all(calls.reverse())).reverse();
      for (const r of res) if (r.status !== 200) friendly(r);
      expect(await pot(w, 'Frankie')).toBe(1400);
      expect(liveUsed(w, g.id, 'Frankie')).toBe(0);
      await books(w);
    }
  });

  it('withdraw a cash out and use it on a game at the same moment: never both', async () => {
    for (let k = 0; k < 4; k++) {
      const w = await world({ court: 'booked' });
      const g = await on(w, '2026-11-03');
      givePot(w, 'Casey', 1400);
      await askCashOut(w, 'Casey', 1000);
      await join(w, g.id, 'Casey');
      const calls = [call(w, 'Casey', 'POST', '/api/me/refund-request/cancel', {}), call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-cash-out`, { cents: 1000 })];
      const res = k % 2 ? await Promise.all(calls) : (await Promise.all(calls.reverse())).reverse();
      for (const r of res) if (r.status !== 200) friendly(r);
      const v = await view(w, 'Casey');
      expect(v.credit.balanceCents + liveUsed(w, g.id, 'Casey')).toBe(1400);
      await books(w);
    }
  });

  it('an extra Sunday game on Nov 1 (after the clock change): the top Pay card starts at 8:00 AM EST', async () => {
    const w = await world();
    w.app.now = Date.parse('2026-10-31T16:00:00.000Z');
    const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-01T23:00:00.000Z', endsAt: '2026-11-02T01:00:00.000Z' });
    expect(add.status, add.text).toBe(200);
    await setCourt(w, add.data.id, 'booked');
    await join(w, add.data.id, 'Casey');
    w.app.now = Date.parse('2026-11-01T12:59:00.000Z');
    expect((await shown(w, 'Casey')).payDue).toEqual([]);
    w.app.now = Date.parse('2026-11-01T13:00:00.000Z');
    expect((await shown(w, 'Casey')).payDue.map((o) => o.sessionId)).toEqual([add.data.id]);
    expect(sOf(await view(w, 'Casey'), add.data.id).dropCutoffAt).toBe('2026-11-01T11:00:00.000Z');
  });
});

describe('11. Live refresh code (/api/group/version)', () => {
  it('another player\'s money moving never changes my code; their I\'m in, and my own money, do', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    await joinAll(w, g.id, ['Blair', 'Casey']);
    givePot(w, 'Devon', 1400);
    const v = async (n: string) => (await call(w, n, 'GET', '/api/group/version')).data.v as string;
    const start = await v('Blair');
    await iPaid(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Casey');
    await askCashOut(w, 'Devon', 1000);
    givePot(w, 'Casey', 500);
    expect(await v('Blair'), 'others\' money is not part of my code').toBe(start);
    await join(w, g.id, 'Devon');
    const afterJoin = await v('Blair');
    expect(afterJoin, 'a new name on the card changes it').not.toBe(start);
    await markPaid(w, g.id, 'Blair');
    expect(await v('Blair'), 'my own payment changes it').not.toBe(afterJoin);
  });

  it('a court switch, a cancel reason and a time move each change the code (a stale screen refreshes)', async () => {
    const w = await world();
    const g = await on(w, '2026-11-05');
    const v = async () => (await call(w, 'Blair', 'GET', '/api/group/version')).data.v as string;
    const seen = new Set([await v()]);
    await setCourt(w, g.id, 'waitlist');
    seen.add(await v());
    await setCourt(w, g.id, 'booked');
    seen.add(await v());
    await w.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: '2026-11-06T00:30:00.000Z', endsAt: '2026-11-06T02:30:00.000Z' });
    seen.add(await v());
    await cancelGame(w, g.id, 'Rain');
    seen.add(await v());
    expect(seen.size).toBe(5);
  });

  it('a stale screen\'s taps get clear answers: Undo after the organizer unmarked, I paid after a drop on another phone', async () => {
    const w = await world({ court: 'booked' });
    const g = await on(w, '2026-11-03');
    givePot(w, 'Casey', 1400);
    await join(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Casey', false); // organizer Unmark: credit back
    const r = await undoCredit(w, g.id, 'Casey'); // old screen still showed Paid with credit + Undo
    friendly(r, 409);
    expect(r.data.message).toBe('There is no credit payment to undo.');
    await drop(w, g.id, 'Casey'); // from a second phone
    const p = await iPaid(w, g.id, 'Casey', true, 1400); // the first phone's old card
    friendly(p, 409);
    expect(seatRow(w, g.id, 'Casey')).toMatchObject({ status: 'withdrawn' });
    expect(await pot(w, 'Casey')).toBe(1400);
    await books(w);
  });
});
