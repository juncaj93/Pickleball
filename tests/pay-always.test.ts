// "Ask for payment on every game" (PAY_ALWAYS, Nov 2, 2026). The scenario list is docs/AUDIT_SCENARIOS_payalways.md;
// the ids in the test names (S1, M3, E7...) point at it.
//
// What the switch does: a player who is in (a real spot) is asked to pay on every game, Booked, Waitlist or Not
// booked, with the same Pay, I paid, $14 and credit as a booked game. It is display only: the server has always
// worked out what is owed, used credit at I'm in, and given money back on a drop or a cancel the same way on every
// court status. These tests prove both halves: the screens follow the switch, and the money never depends on it.
vi.hoisted(() => {
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GroupView, PlayerSessionView } from '../shared/api';
import { joinedCreditText } from '../shared/credit';
import { PAY_ALWAYS_HEADER, payAlwaysAllowed } from '../shared/payAlways';
import { courtDisplay, hidesPay, isNoCourt } from '../src/courtDisplay';
import { heldCents } from '../src/pages/admin/todo';
// The page is TSX and is type-checked in the app project; this test only renders it.
// @ts-ignore
import { joinedText, ScheduleRow } from '../src/pages/PlayerHome';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';

const PRICE = 1400;
const INTEGRITY = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
type Court = 'booked' | 'not_booked' | 'waitlist';
type Mode = 'off' | 'header' | 'settings';
const COURTS: Court[] = ['not_booked', 'waitlist', 'booked'];

// ---------- the world ----------

async function world(opts: { mode?: Mode; env?: Record<string, string>; maxPlayers?: number } = {}) {
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
  const headers: Record<string, string> = opts.mode === 'header' ? { [PAY_ALWAYS_HEADER]: 'on' } : {};
  if (opts.mode === 'settings') expect((await ctx.organizer.call('PUT', '/api/admin/pay-always', { on: true })).status).toBe(200);
  return { ...ctx, headers, phones: new Map<string, Client>() };
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
const call = async (w: W, name: string, method: string, path: string, body?: unknown) => (await phone(w, name)).call(method, path, body, w.headers);
async function view(w: W, name: string): Promise<GroupView> {
  const r = await call(w, name, 'GET', '/api/group');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const shown = async (w: W, name: string) => courtDisplay(await view(w, name));
const sOf = (g: GroupView, sid: string) => g.sessions.find((s) => s.id === sid) as PlayerSessionView;
const games = async (w: W) => (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);
const join_ = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/join`, {});
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const drop = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/withdraw`, {});
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const iPaid = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/paid`, { paid: true });
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const markPaid = async (w: W, sid: string, name: string, paid = true) => {
  const r = await w.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid });
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const answerClaim = async (w: W, sid: string, name: string, paid: boolean) => {
  const r = await w.organizer.call('POST', `/api/admin/sessions/${sid}/claim`, { playerId: w.byName[name], paid });
  expect(r.status, r.text).toBe(200);
};
const setCourt = async (w: W, sid: string, status: Court) => {
  const r = await w.organizer.call('POST', `/api/admin/sessions/${sid}/court-status`, { status });
  expect(r.status, r.text).toBe(200);
};
const cancelGame = async (w: W, sid: string) => {
  const r = await w.organizer.call('POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true });
  expect(r.status, r.text).toBe(200);
};
const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
const adminGame = async (w: W, sid: string) => (await dash(w)).sessions.find((s: any) => s.id === sid);

/** Put credit in a player's pot (a real "kept" entry, as if an October game's payment came back). */
function givePot(w: W, name: string, cents: number) {
  if (cents <= 0) return;
  w.app.db.raw
    .prepare(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
       SELECT ?, g.id, ?, 'kept', ?, NULL, '2026-10-26T13:00:00.000Z', 'canceled' FROM groups g`,
    )
    .run(`pot-${name}-${cents}-${Math.random()}`, w.byName[name], cents);
}

/** The player's card for one game as plain text (screen-reader text included). */
function card(g: GroupView, id: string): string {
  const s = sOf(g, id);
  const html = renderToStaticMarkup(createElement(ScheduleRow, { s, g, tier: 'next', onChanged: async () => {}, setOverlay: () => {}, joinToast: () => {} }));
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** The 20 health checks: every one 0 (info_ columns are to-dos, not problems). */
function healthy(w: W, label = '') {
  const row = w.app.db.raw.prepare(INTEGRITY).get() as Record<string, number>;
  for (const [k, n] of Object.entries(row)) if (!k.startsWith('info_')) expect(Number(n), `${label} ${k}`).toBe(0);
}

/**
 * The books: cash players sent = what the group kept + held on games + credit in pots + cashed out. Here nobody
 * cashes out and nothing is finalized, so: cash sent (+ seeded credit) = held + credit in pots.
 */
async function books(w: W, seeded: number, cashSent: number, label = '') {
  const d = await dash(w);
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  expect(heldCents(d) + potTotal, `${label} books: held + pots = cash sent + seeded credit`).toBe(cashSent + seeded);
  healthy(w, label);
}

// ---------- S: the switch ----------

describe('S: the PAY_ALWAYS switch', () => {
  it('S1 the var is a kill switch: allowed unless it says "off"', () => {
    expect(payAlwaysAllowed(undefined)).toBe(true);
    expect(payAlwaysAllowed(null)).toBe(true);
    expect(payAlwaysAllowed('on')).toBe(true);
    expect(payAlwaysAllowed('')).toBe(true);
    expect(payAlwaysAllowed('off')).toBe(false);
    expect(payAlwaysAllowed(' OFF ')).toBe(false);
  });

  it('S2 off for everyone at ship: no header, Settings off', async () => {
    const w = await world();
    expect((await view(w, 'Blair')).payAlways).toBe(false);
    expect((await dash(w)).payAlwaysForAll).toBe(false);
  });

  it('S3 the private test header turns it on for that phone only', async () => {
    const w = await world();
    const blair = await phone(w, 'Blair');
    expect((await blair.call('GET', '/api/group', undefined, { [PAY_ALWAYS_HEADER]: 'on' })).data.payAlways).toBe(true);
    expect((await blair.call('GET', '/api/group', undefined, { [PAY_ALWAYS_HEADER]: 'ON' })).data.payAlways).toBe(true);
    expect((await blair.call('GET', '/api/group', undefined, { [PAY_ALWAYS_HEADER]: 'yes' })).data.payAlways).toBe(false);
    expect((await blair.call('GET', '/api/group')).data.payAlways).toBe(false);
    // Another phone without the header: still off.
    expect((await (await phone(w, 'Casey')).call('GET', '/api/group')).data.payAlways).toBe(false);
  });

  it('S4 Settings switch: on for everyone with no deploy, and off again', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/pay-always', { on: true })).data).toEqual({ ok: true, on: true });
    expect((await view(w, 'Blair')).payAlways).toBe(true);
    expect((await view(w, 'Casey')).payAlways).toBe(true);
    expect((await dash(w)).payAlwaysForAll).toBe(true);
    // Twice on is still one row.
    await w.organizer.call('PUT', '/api/admin/pay-always', { on: true });
    expect((w.app.db.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'pay_always_on'").get() as any).n).toBe(1);
    expect((await w.organizer.call('PUT', '/api/admin/pay-always', { on: false })).data).toEqual({ ok: true, on: false });
    expect((await view(w, 'Blair')).payAlways).toBe(false);
    expect((await dash(w)).payAlwaysForAll).toBe(false);
    // Logged in History > Activity.
    const kinds = (w.app.db.raw.prepare("SELECT action FROM admin_audit_log WHERE action LIKE 'pay_always%' ORDER BY created_at, rowid").all() as any[]).map((r) => r.action);
    expect(kinds).toEqual(['pay_always_on', 'pay_always_on', 'pay_always_off']);
  });

  it('S5 the kill switch (PAY_ALWAYS=off) beats the header and the Settings switch', async () => {
    const w = await world({ env: { PAY_ALWAYS: 'off' }, mode: 'settings' });
    const blair = await phone(w, 'Blair');
    expect((await blair.call('GET', '/api/group')).data.payAlways).toBe(false);
    expect((await blair.call('GET', '/api/group', undefined, { [PAY_ALWAYS_HEADER]: 'on' })).data.payAlways).toBe(false);
  });

  it("S6 the organizer's View as demo (sandbox) always has it", async () => {
    const w = await world();
    (w.app.env as any).SANDBOX = true;
    expect((await view(w, 'Blair')).payAlways).toBe(true);
  });

  it('S7 only the organizer can change it', async () => {
    const w = await world();
    const r = await call(w, 'Blair', 'PUT', '/api/admin/pay-always', { on: true });
    expect([401, 403]).toContain(r.status);
    const anon = w.app.client();
    expect([401, 403]).toContain((await anon.call('PUT', '/api/admin/pay-always', { on: true })).status);
    expect((await w.organizer.call('PUT', '/api/admin/pay-always', { on: 'yes' })).status).toBe(400);
    expect((await view(w, 'Blair')).payAlways).toBe(false);
  });

  it('S8 a phone open on the site notices the Settings switch on its next 5-second check', async () => {
    const w = await world();
    const before = (await call(w, 'Blair', 'GET', '/api/group/version')).text;
    await w.organizer.call('PUT', '/api/admin/pay-always', { on: true });
    const after = (await call(w, 'Blair', 'GET', '/api/group/version')).text;
    expect(after).not.toBe(before);
    await w.organizer.call('PUT', '/api/admin/pay-always', { on: false });
    expect((await call(w, 'Blair', 'GET', '/api/group/version')).text).toBe(before);
  });

  it('S9 it changes nothing else in the answer', async () => {
    const w = await world();
    const [g] = await games(w);
    await join_(w, g.id, 'Blair');
    const blair = await phone(w, 'Blair');
    const off = (await blair.call('GET', '/api/group')).data;
    const on = (await blair.call('GET', '/api/group', undefined, { [PAY_ALWAYS_HEADER]: 'on' })).data;
    const { payAlways: a, ...restOff } = off;
    const { payAlways: b, ...restOn } = on;
    expect([a, b]).toEqual([false, true]);
    expect(restOn).toEqual(restOff);
  });
});

// ---------- M: every court status x credit amount, switch off and on ----------

const CREDITS = [
  { label: 'none', cents: 0 },
  { label: 'part', cents: 300 },
  { label: 'exact', cents: 1400 },
  { label: 'extra', cents: 2000 },
];

describe('M: sign up on every court status with every credit amount', () => {
  for (const court of COURTS) {
    for (const credit of CREDITS) {
      for (const mode of ['off', 'settings'] as const) {
        it(`M ${court} / credit ${credit.label} / switch ${mode}`, async () => {
          const w = await world({ mode });
          const [g] = await games(w);
          if (court !== 'not_booked') await setCourt(w, g.id, court);
          givePot(w, 'Blair', credit.cents);
          const res = await join_(w, g.id, 'Blair');
          const used = Math.min(credit.cents, PRICE);
          const owe = PRICE - used;
          // The server: the same on every court status and either switch position.
          expect(res.result).toBe('confirmed');
          expect(res.creditCents ?? 0).toBe(used);
          const raw = sOf(await view(w, 'Blair'), g.id).mine!;
          expect(raw.status).toBe('confirmed');
          expect(raw.oweCents).toBe(owe);
          expect(raw.paymentStatus).toBe(owe === 0 ? 'paid' : 'unpaid');
          expect(raw.paidWithCredit).toBe(owe === 0);
          expect(raw.creditCents).toBe(owe === 0 ? 0 : used);
          expect(await pot(w, 'Blair')).toBe(credit.cents - used);
          // The screen: Pay hides only on a game with no court while the switch is off.
          const hidden = court !== 'booked' && mode === 'off';
          const v = await shown(w, 'Blair');
          const mine = sOf(v, g.id).mine!;
          expect(mine.oweCents).toBe(hidden ? 0 : owe);
          expect(hidesPay(await view(w, 'Blair'), sOf(await view(w, 'Blair'), g.id))).toBe(hidden);
          const text = card(v, g.id);
          if (owe === 0) {
            // Exact or extra credit: "Paid with credit" with Undo, exactly as on a booked game. No Pay.
            expect(text).toContain('Paid with credit');
            expect(text).toContain('Undo');
            expect(text).not.toMatch(/Pay \$/);
          } else if (hidden) {
            expect(text).not.toMatch(/Pay \$|\$\d+ due|I paid/);
            if (used > 0) expect(text).toContain(`Credit $${used / 100} used`);
          } else {
            expect(text).toContain(`$${owe / 100} due`);
            expect(text).toMatch(/\bPay\b/);
            expect(text).toContain('I paid');
            if (used > 0) expect(text).toContain(`Credit $${used / 100} used`);
          }
          // The I'm in banner says what is due only where the card shows it.
          const noCourt = isNoCourt(sOf(await view(w, 'Blair'), g.id));
          expect(noCourt).toBe(court !== 'booked');
          const banner = joinedText(res, noCourt, PRICE, !noCourt || mode !== 'off');
          if (used > 0 && owe > 0) expect(banner).toBe(hidden ? `You're in. $${used / 100} credit used.` : `You're in. $${used / 100} credit used, $${owe / 100} due.`);
          else if (used > 0) expect(banner).toBe(`You're in. $${used / 100} credit used.`);
          else expect(banner).toBe("You're in");
          // Game day from 8:00 AM: the Pay card at the top lists it the same way.
          w.app.now = Date.parse(g.startsAt) - 6 * HOUR;
          const day = await shown(w, 'Blair');
          expect(day.payDue.some((o) => o.sessionId === g.id)).toBe(owe > 0 && !hidden);
          await books(w, credit.cents, 0, `${court}/${credit.label}/${mode}`);
        });
      }
    }
  }

  it('M13 the private test header on that phone behaves like Settings on (one sample: Not booked, no credit)', async () => {
    const w = await world({ mode: 'header' });
    const [g] = await games(w);
    await join_(w, g.id, 'Blair');
    const text = card(await shown(w, 'Blair'), g.id);
    expect(text).toContain('$14 due');
    expect(text).toMatch(/\bPay\b/);
    // A phone without the header: hidden as before.
    const casey = await phone(w, 'Casey');
    await casey.call('POST', `/api/sessions/${g.id}/join`, {});
    const cv = courtDisplay((await casey.call('GET', '/api/group')).data);
    expect(card(cv, g.id)).not.toMatch(/Pay \$|\$14 due/);
  });
});

// ---------- E: events ----------

for (const court of ['not_booked', 'waitlist'] as const) {
  describe(`E: events on a ${court === 'not_booked' ? 'Not booked' : 'Waitlist'} court, switch on`, () => {
    it('E1 pay $14 cash (I paid, organizer confirms), then drop out: all $14 back as credit', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      await iPaid(w, g.id, 'Blair');
      // The organizer confirms it (the Home card's Paid is Mark paid on the seat).
      await markPaid(w, g.id, 'Blair');
      const card1 = card(await shown(w, 'Blair'), g.id);
      expect(card1).toContain('Paid $14');
      expect((await adminGame(w, g.id)).paidCount).toBe(1);
      await books(w, 0, PRICE, 'paid');
      const res = await drop(w, g.id, 'Blair');
      expect(res.creditBackCents).toBe(PRICE);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      await books(w, 0, PRICE, 'dropped');
    });

    it('E1b an "I paid" not confirmed yet, then drop out: it waits for the organizer, then becomes credit (same rule as booked games)', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      await iPaid(w, g.id, 'Blair');
      expect(sOf(await view(w, 'Blair'), g.id).mine!.dropClaimCents).toBe(PRICE);
      expect((await drop(w, g.id, 'Blair')).creditBackCents).toBe(0);
      expect((await dash(w)).paymentClaims.some((c: any) => c.sessionId === g.id && c.why === 'dropped')).toBe(true);
      await answerClaim(w, g.id, 'Blair', true);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      await books(w, 0, PRICE);
    });

    it('E2 organizer Mark paid, then drop out: $14 back as credit', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      await markPaid(w, g.id, 'Blair');
      expect((await drop(w, g.id, 'Blair')).creditBackCents).toBe(PRICE);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      await books(w, 0, PRICE);
    });

    it('E3 part credit ($3) plus $11 cash, then drop out: $3 back to the pot and $11 back as credit', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      givePot(w, 'Blair', 300);
      expect((await join_(w, g.id, 'Blair')).creditCents).toBe(300);
      const before = card(await shown(w, 'Blair'), g.id);
      expect(before).toContain('$11 due');
      expect(before).toMatch(/\bPay\b/);
      await markPaid(w, g.id, 'Blair');
      await books(w, 300, 1100, 'paid');
      const res = await drop(w, g.id, 'Blair');
      expect(res.creditReturnedCents).toBe(300);
      expect(res.creditBackCents).toBe(1100);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      await books(w, 300, 1100, 'dropped');
    });

    it('E4 organizer cancels after cash, part credit and full credit: everything back as credit', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      givePot(w, 'Casey', 300);
      givePot(w, 'Devon', 1400);
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await join_(w, g.id, n);
      await markPaid(w, g.id, 'Blair');
      await markPaid(w, g.id, 'Casey');
      // Emery owes and has not paid: nothing to give back.
      await books(w, 1700, 1400 + 1100, 'before');
      await cancelGame(w, g.id);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      expect(await pot(w, 'Casey')).toBe(PRICE);
      expect(await pot(w, 'Devon')).toBe(PRICE);
      expect(await pot(w, 'Emery')).toBe(0);
      const v = await shown(w, 'Emery');
      expect(v.payDue.some((o) => o.sessionId === g.id)).toBe(false);
      expect(v.owed.some((o) => o.sessionId === g.id)).toBe(false);
      expect(card(v, g.id)).not.toMatch(/Pay \$|\$14 due/);
      const a = await adminGame(w, g.id);
      expect(a.status).toBe('canceled');
      expect(a.payableCount).toBe(0);
      await books(w, 1700, 1400 + 1100, 'after');
    });

    it('E5 an "I paid" not confirmed yet when the game is canceled waits for the organizer, then becomes credit (same rule as booked games)', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      await iPaid(w, g.id, 'Blair');
      await cancelGame(w, g.id);
      expect(await pot(w, 'Blair')).toBe(0);
      const d = await dash(w);
      expect(d.paymentClaims.some((c: any) => c.sessionId === g.id && c.why === 'canceled')).toBe(true);
      await answerClaim(w, g.id, 'Blair', true);
      expect(await pot(w, 'Blair')).toBe(PRICE);
      await books(w, 0, PRICE);
    });

    it('E6 court booked later: nothing about the money moves, Pay and Paid stay as they were', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      await join_(w, g.id, 'Casey');
      await markPaid(w, g.id, 'Blair');
      const ledgerBefore = JSON.stringify(w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all());
      const seatsBefore = JSON.stringify(w.app.db.raw.prepare('SELECT player_id, status, payment_status, payment_amount_cents FROM session_players ORDER BY player_id').all());
      await setCourt(w, g.id, 'booked');
      expect(JSON.stringify(w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all())).toBe(ledgerBefore);
      expect(JSON.stringify(w.app.db.raw.prepare('SELECT player_id, status, payment_status, payment_amount_cents FROM session_players ORDER BY player_id').all())).toBe(seatsBefore);
      expect(card(await shown(w, 'Blair'), g.id)).toContain('Paid $14');
      expect(card(await shown(w, 'Casey'), g.id)).toMatch(/\$14 due Pay I paid/);
      await books(w, 0, PRICE);
    });

    it('E7 court changed back from Booked: a payment stays paid; an unpaid seat keeps Pay with the switch on, hides it with the switch off', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      await setCourt(w, g.id, 'booked');
      await join_(w, g.id, 'Blair');
      await join_(w, g.id, 'Casey');
      await markPaid(w, g.id, 'Blair');
      await setCourt(w, g.id, court);
      expect(card(await shown(w, 'Blair'), g.id)).toContain('Paid $14');
      expect(card(await shown(w, 'Casey'), g.id)).toMatch(/\$14 due Pay I paid/);
      await w.organizer.call('PUT', '/api/admin/pay-always', { on: false });
      expect(card(await shown(w, 'Blair'), g.id)).toContain('Paid $14');
      expect(card(await shown(w, 'Casey'), g.id)).not.toMatch(/Pay \$|\$14 due/);
      await books(w, 0, PRICE);
    });

    it('E8 standby for a full game owes nothing and uses no credit; promoted, they are asked to pay (credit first)', async () => {
      const w = await world({ mode: 'settings', maxPlayers: 4 });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await join_(w, g.id, n);
      givePot(w, 'Frankie', 300);
      const res = await join_(w, g.id, 'Frankie');
      expect(res.result).toBe('waitlisted');
      const raw = sOf(await view(w, 'Frankie'), g.id).mine!;
      expect(raw.status).toBe('waitlisted');
      expect(raw.oweCents).toBe(0);
      expect(await pot(w, 'Frankie')).toBe(300);
      w.app.now = Date.parse(g.startsAt) - 6 * HOUR;
      const v = await shown(w, 'Frankie');
      expect(card(v, g.id)).not.toMatch(/Pay \$|\$\d+ due|I paid/);
      expect(v.payDue.some((o) => o.sessionId === g.id)).toBe(false);
      // Someone drops: Frankie moves in, $3 credit goes on, $11 due.
      await drop(w, g.id, 'Emery');
      const m = sOf(await view(w, 'Frankie'), g.id).mine!;
      expect(m.status).toBe('confirmed');
      expect(m.oweCents).toBe(1100);
      expect(await pot(w, 'Frankie')).toBe(0);
      const after = await shown(w, 'Frankie');
      // Game day: the Pay button sits on the Pay card at the top; the row keeps the chip (never two Pay buttons).
      expect(card(after, g.id)).toContain('$11 due');
      expect(after.payDue.some((o) => o.sessionId === g.id && o.amountCents === 1100)).toBe(true);
      await books(w, 300, 0);
    });

    it('E9 Undo on "Paid with credit": the credit goes back to the pot and $14 is due again (Pay shows)', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      givePot(w, 'Blair', 1400);
      await join_(w, g.id, 'Blair');
      expect(card(await shown(w, 'Blair'), g.id)).toContain('Paid with credit');
      const r = await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/undo-credit`, {});
      expect(r.status, r.text).toBe(200);
      expect(await pot(w, 'Blair')).toBe(1400);
      const text = card(await shown(w, 'Blair'), g.id);
      expect(text).toContain('$14 due');
      expect(text).toMatch(/Use (\$14 )?credit/);
      await books(w, 1400, 0);
    });

    it('E10 the organizer is never asked to pay, on any court', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      const r = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/me`, { in: true });
      expect(r.status, r.text).toBe(200);
      const v = await shown(w, 'Alex');
      const m = sOf(v, g.id).mine!;
      expect(m.status).toBe('confirmed');
      expect(m.oweCents).toBe(0);
      expect(card(v, g.id)).not.toMatch(/Pay \$|\$14 due|I paid/);
      expect((await adminGame(w, g.id)).payableCount).toBe(0);
    });

    it('E11 drop out with nothing paid: nothing moves, no credit made', async () => {
      const w = await world({ mode: 'settings' });
      const [g] = await games(w);
      if (court === 'waitlist') await setCourt(w, g.id, 'waitlist');
      await join_(w, g.id, 'Blair');
      const res = await drop(w, g.id, 'Blair');
      expect(res.creditBackCents).toBe(0);
      expect(res.creditReturnedCents).toBe(0);
      expect(await pot(w, 'Blair')).toBe(0);
      await books(w, 0, 0);
    });
  });
}

describe('E: the court that never opens, and games that never get a court', () => {
  it('E12 Waitlist court "Didn\'t open": the game is canceled and every payment comes back as credit', async () => {
    const w = await world({ mode: 'settings' });
    const [g] = await games(w);
    await setCourt(w, g.id, 'waitlist');
    givePot(w, 'Casey', 300);
    await join_(w, g.id, 'Blair');
    await join_(w, g.id, 'Casey');
    await markPaid(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Casey');
    const r = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'not_opened' });
    expect(r.status, r.text).toBe(200);
    expect((await adminGame(w, g.id)).status).toBe('canceled');
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect(await pot(w, 'Casey')).toBe(PRICE);
    await books(w, 300, 2500);
  });

  it('E13 no game ever cancels by itself: a never-booked game that ends keeps its money held (Money tab) until the organizer cancels or finalizes', async () => {
    const w = await world({ mode: 'settings' });
    const [g] = await games(w);
    for (const n of ['Blair', 'Casey', 'Devon']) await join_(w, g.id, n);
    await markPaid(w, g.id, 'Blair');
    w.app.now = Date.parse(g.endsAt) + 2 * 24 * HOUR;
    const a = await adminGame(w, g.id);
    expect(a.status).not.toBe('canceled');
    expect(a.needsFinalize).toBe(true);
    expect(await pot(w, 'Blair')).toBe(0);
    const d = await dash(w);
    expect(heldCents(d)).toBe(PRICE);
    // "Did you guys play?" > Cancel game: the usual cancel, money back as credit.
    await cancelGame(w, g.id);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect(heldCents(await dash(w))).toBe(0);
    await books(w, 0, PRICE);
  });

  it('E14 a never-booked game that was played: finalize uses the same price table (5 played: $11, $3 back)', async () => {
    const w = await world({ mode: 'settings' });
    const [g] = await games(w);
    const five = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of five) await join_(w, g.id, n);
    for (const n of five) await markPaid(w, g.id, n);
    w.app.now = Date.parse(g.endsAt) + HOUR;
    const r = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(r.status, r.text).toBe(200);
    for (const n of five) expect(await pot(w, n)).toBe(300);
    healthy(w);
  });

  it('E15 with the switch off, a game that ended without a court booked already shows Pay on the game-day card (before this change)', async () => {
    // Recorded so the change is honest about the old behavior: the hiding only covered games still on the schedule.
    const w = await world();
    const [g] = await games(w);
    await join_(w, g.id, 'Blair');
    w.app.now = Date.parse(g.endsAt) + HOUR;
    const v = await shown(w, 'Blair');
    expect(v.payAlways).toBe(false);
    expect(v.payDue.some((o) => o.sessionId === g.id)).toBe(true);
  });
});

// ---------- O: the organizer's money screens ----------

describe('O: organizer money screens show early payments', () => {
  it('O1 "x of y paid", Players and Money held count payments on Not booked and Waitlist games', async () => {
    const w = await world({ mode: 'settings' });
    const [g1, g2] = await games(w);
    await setCourt(w, g2.id, 'waitlist');
    for (const g of [g1, g2]) {
      await join_(w, g.id, 'Blair');
      await join_(w, g.id, 'Casey');
      await markPaid(w, g.id, 'Blair');
    }
    for (const g of [g1, g2]) {
      const a = await adminGame(w, g.id);
      expect([a.paidCount, a.payableCount]).toEqual([1, 2]);
      const blair = a.roster.find((r: any) => r.name === 'Blair');
      expect(blair.paymentStatus).toBe('paid');
      expect(blair.paymentAmountCents).toBe(PRICE);
    }
    const d = await dash(w);
    expect(heldCents(d)).toBe(2 * PRICE);
    await books(w, 0, 2 * PRICE);
  });

  it('O2 a game canceled after early payments: Money shows nothing held on it and the credit owed went up', async () => {
    const w = await world({ mode: 'settings' });
    const [g] = await games(w);
    await join_(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    const month = new Date(g.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).slice(0, 7);
    const before = (await w.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    expect(before.heldCents).toBe(PRICE);
    await cancelGame(w, g.id);
    const after = (await w.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    expect(after.heldCents).toBe(0);
    expect(after.collectedCents).toBe(0);
    const row = after.sessions.find((s: any) => s.id === g.id || s.sessionId === g.id);
    if (row) expect(row.state).toBe('canceled');
    const d = await dash(w);
    expect(d.creditLedger.find((p: any) => p.playerId === w.byName.Blair).balanceCents).toBe(PRICE);
    await books(w, 0, PRICE);
  });

  it('O3 a cash out of credit from a canceled early payment works as before', async () => {
    const w = await world({ mode: 'settings' });
    const [g] = await games(w);
    await join_(w, g.id, 'Blair');
    await markPaid(w, g.id, 'Blair');
    await cancelGame(w, g.id);
    const r = await call(w, 'Blair', 'POST', '/api/me/refund-request', { cents: PRICE });
    expect(r.status, r.text).toBe(200);
    const d = await dash(w);
    expect(d.refundRequests.length).toBe(1);
    healthy(w);
  });
});

// ---------- Z: the switch never changes money ----------

describe('Z: the same taps move the same money with the switch off and on', () => {
  it('Z1 a 40-step script on Not booked and Waitlist games ends with identical books either way', async () => {
    const out: string[] = [];
    for (const mode of ['off', 'header', 'settings'] as const) {
      const w = await world({ mode, maxPlayers: 5 });
      const gs = (await games(w)).slice(0, 3);
      await setCourt(w, gs[1].id, 'waitlist');
      givePot(w, 'Casey', 300);
      givePot(w, 'Devon', 2000);
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper'];
      let seed = 7;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let step = 0; step < 40; step++) {
        const g = gs[Math.floor(rand() * gs.length)];
        const n = names[Math.floor(rand() * names.length)];
        const r = rand();
        if (r < 0.4) await call(w, n, 'POST', `/api/sessions/${g.id}/join`, {});
        else if (r < 0.55) await call(w, n, 'POST', `/api/sessions/${g.id}/withdraw`, {});
        else if (r < 0.7) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[n], paid: true });
        else if (r < 0.78) await call(w, n, 'POST', `/api/sessions/${g.id}/use-credit`, {});
        else if (r < 0.84) await call(w, n, 'POST', `/api/sessions/${g.id}/undo-credit`, {});
        else if (r < 0.92) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/court-status`, { status: COURTS[Math.floor(rand() * 3)] });
        else if (r < 0.96) await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
        else await w.organizer.call('POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' });
        healthy(w, `${mode} step ${step}`);
      }
      const d = await dash(w);
      out.push(
        JSON.stringify({
          pots: d.creditLedger.map((p: any) => [p.name ?? p.playerId.slice(0, 0), p.balanceCents]).sort(),
          held: heldCents(d),
          seats: d.sessions.slice(0, 3).map((s: any) => s.roster.map((r: any) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents ?? null])),
        }),
      );
    }
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBe(out[0]);
  });

  it('Z2 the banner text helper: "$ due" only when the card shows it', () => {
    expect(joinedCreditText("You're in", 300, PRICE, true)).toBe("You're in. $3 credit used, $11 due.");
    expect(joinedCreditText("You're in", 300, PRICE, false)).toBe("You're in. $3 credit used.");
    expect(joinedCreditText("You're in", 1400, PRICE, true)).toBe("You're in. $14 credit used.");
    expect(joinedCreditText("You're in", 0, PRICE, true)).toBe("You're in");
  });
});
