// "Late drops owe $14" (LATE_FEES, Alex's rules of Mon Nov 2, 2026; shared/lateFees.ts). The court needs 4 people
// paying. A late drop or a no-show only owes their $14 when their absence leaves the game SHORT of 4. With the switch
// off, every path below must behave exactly as before (those tests run the same taps with the switch off).
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupToSql } from '../scripts/backup-sql.mjs';
import { createNodeD1 } from '../dev/nodeD1';
import { activityText } from '../shared/activity';
import { creditChanges } from '../shared/credit';
import { dropLeavesShort, FEE_KEPT, feeClearedNotice, LATE_FEES_HEADER, lateDropDialogText, lateDropToast, lateFeeKind, lateFeesAllowed } from '../shared/lateFees';
import type { GroupView } from '../shared/api';
import { OPEN_FEE } from '../server/lateFees';
import { backOutTexts, confirmedReach, lateCancelText, sessionTexts } from '../src/pages/admin/textMenu';
import { unpaidRows } from '../src/pages/admin/moneyList';
import { smsHref } from '../shared/messages';
import { type Client, HOUR, PIN, setupGroup, TestApp, withoutIds } from './harness';

const PRICE = 1400;
const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const ORG = 'Alex';
type Mode = 'off' | 'header' | 'settings';

async function world(opts: { mode?: Mode; maxPlayers?: number; env?: Record<string, string> } = { mode: 'settings' }) {
  const app = new TestApp();
  Object.assign(app.env, opts.env ?? {});
  const ctx = await setupGroup(app);
  const body: Record<string, unknown> = { organizerName: ORG };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  for (const n of ['Gale', 'Harper', 'Indy']) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-02${n.length}${n.charCodeAt(0) % 10}` });
    expect(r.status, r.text).toBe(200);
    ctx.byName[n] = r.data.id;
  }
  const mode = opts.mode ?? 'settings';
  if (mode === 'settings') expect((await ctx.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  const headers: Record<string, string> = mode === 'header' ? { [LATE_FEES_HEADER]: 'on' } : {};
  return { ...ctx, headers, phones: new Map<string, Client>() };
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
/** The next game (a Tuesday), its id and start. */
async function game(w: W, nth = 0) {
  const d = await dash(w);
  const s = d.sessions.filter((x: any) => Date.parse(x.startsAt) > w.app.now && !x.state.flags.canceled)[nth];
  return { id: s.id as string, start: Date.parse(s.startsAt) };
}
const join = async (w: W, sid: string, names: string[]) => {
  for (const n of names) {
    const r = await call(w, n, 'POST', `/api/sessions/${sid}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
};
const drop = async (w: W, sid: string, name: string) => {
  const r = await call(w, name, 'POST', `/api/sessions/${sid}/withdraw`, {});
  expect(r.status, r.text).toBe(200);
  return r.data;
};
const markPaid = async (w: W, sid: string, name: string) => {
  const r = await admin(w, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: true });
  expect(r.status, r.text).toBe(200);
};
const rowOf = async (w: W, sid: string, name: string) => (await dash(w)).sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === name);
const sessOf = async (w: W, sid: string) => (await dash(w)).sessions.find((s: any) => s.id === sid);
const pot = async (w: W, name: string) => (await view(w, name)).credit.balanceCents;
const owedOf = async (w: W, name: string, sid: string) => (await view(w, name)).owed.find((o) => o.sessionId === sid) ?? null;
function health(w: W) {
  const raw = (w.app.db as any).raw;
  const sql = INTEGRITY.split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const row = raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const info = (w: W) => {
  const raw = (w.app.db as any).raw;
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return raw.prepare(sql).get().info_open_late_fees as number;
};
/** Inside the 12 hours: `h` hours before the start. */
const at = (w: W, start: number, h: number) => {
  w.app.now = start - h * HOUR;
};
const audits = (w: W, action: string) =>
  ((w.app.db as any).raw.prepare('SELECT details_json, actor_label FROM admin_audit_log WHERE action = ? ORDER BY created_at, rowid').all(action) as { details_json: string }[]).map((r) =>
    JSON.parse(r.details_json),
  );

// ---------- the switch ----------

describe('the switch', () => {
  it('ships off: the Settings row, the private header and the kill switch', async () => {
    expect(lateFeesAllowed(undefined)).toBe(true);
    expect(lateFeesAllowed('off')).toBe(false);
    const w = await world({ mode: 'off' });
    expect((await view(w, 'Blair')).lateFees).toBe(false);
    expect((await dash(w)).lateFeesForAll).toBe(false);
    // The private test link: that phone only.
    const b = await phone(w, 'Blair');
    expect((await b.call('GET', '/api/group', undefined, { [LATE_FEES_HEADER]: 'on' })).data.lateFees).toBe(true);
    expect((await view(w, 'Casey')).lateFees).toBe(false);
    // Settings: everyone, logged in History.
    expect((await admin(w, 'PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
    expect((await view(w, 'Casey')).lateFees).toBe(true);
    expect((await dash(w)).lateFeesForAll).toBe(true);
    expect(audits(w, 'late_fees_on')).toHaveLength(1);
    // Only the organizer can flip it.
    expect((await b.call('PUT', '/api/admin/late-fees', { on: false })).status).toBe(401);
    // The kill switch beats Settings and the header.
    const k = await world({ mode: 'settings', env: { LATE_FEES: 'off' } });
    expect((await view(k, 'Casey')).lateFees).toBe(false);
    expect((await (await phone(k, 'Blair')).call('GET', '/api/group', undefined, { [LATE_FEES_HEADER]: 'on' })).data.lateFees).toBe(false);
  });
});

// ---------- late drops: the threshold ----------

describe('late drops owe only when the game goes below 4', () => {
  it('6 in, 2 drop late, 4 left: nobody owes, money back as credit', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
    for (const n of ['Blair', 'Casey']) await markPaid(w, g.id, n);
    at(w, g.start, 6);
    for (const n of ['Blair', 'Casey']) {
      const r = await drop(w, g.id, n);
      expect(r.lateFee).toBeUndefined();
      expect(r.creditBackCents).toBe(PRICE);
      expect(await pot(w, n)).toBe(PRICE);
      expect((await rowOf(w, g.id, n)).lateFee).toBeNull();
    }
    expect(health(w)).toEqual({});
  });

  it('5 in, 1 drops late, 4 left: nobody owes', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 3);
    const r = await drop(w, g.id, 'Blair');
    expect(r.lateFee).toBeUndefined();
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
  });

  it('4 in, 1 drops late (unpaid), 3 left: the dropper owes $14 on the Pay card, the late-drop History line says so', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    // Before the drop, the dialog knows it would owe.
    const before = (await view(w, 'Blair')).sessions.find((s) => s.id === g.id)!;
    expect(before.mine!.lateDrop).toMatchObject({ owes: true, paid: false, feeCents: PRICE });
    expect(before.dropCutoffAt).toBe(new Date(g.start - 12 * HOUR).toISOString());
    const r = await drop(w, g.id, 'Blair');
    expect(r.lateFee).toEqual({ cents: PRICE, paid: false });
    const o = await owedOf(w, 'Blair', g.id);
    expect(o).toMatchObject({ amountCents: PRICE, lateFee: 'late_drop' });
    expect((await view(w, 'Blair')).payDue.map((x) => x.sessionId)).toContain(g.id);
    const row = await rowOf(w, g.id, 'Blair');
    expect(row).toMatchObject({ status: 'withdrawn', owesCents: PRICE, lateFee: { kind: 'late_drop', paid: false }, paymentStatus: 'unpaid' });
    expect(row.lateDropAt).toBeTruthy();
    expect(audits(w, 'late_fee_owed')).toEqual([expect.objectContaining({ player: 'Blair', kind: 'late_drop' })]);
    // The game reads 3 in; the payable count includes the debt.
    const s = await sessOf(w, g.id);
    expect(s.confirmedCount).toBe(3);
    expect(s.payableCount).toBe(4);
    expect(health(w)).toEqual({});
    expect(info(w)).toBe(1);
  });

  it('a paid dropper keeps the $14 on the game: cash stays paid, credit stays spent, nothing comes back', async () => {
    const w = await world();
    const g = await game(w);
    const later = await game(w, 1);
    // Casey gets $14 credit from an early drop of a later game, then it is used at I'm in on this one.
    await join(w, later.id, ['Casey']);
    await markPaid(w, later.id, 'Casey');
    await drop(w, later.id, 'Casey');
    expect(await pot(w, 'Casey')).toBe(PRICE);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect(await pot(w, 'Casey')).toBe(0);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 2);
    expect((await view(w, 'Blair')).sessions.find((s) => s.id === g.id)!.mine!.lateDrop).toMatchObject({ owes: true, paid: true });
    expect((await view(w, 'Blair')).sessions.find((s) => s.id === g.id)!.mine).toMatchObject({ dropCashCents: 0, dropCreditCents: 0 });
    const r1 = await drop(w, g.id, 'Blair');
    expect(r1).toMatchObject({ creditBackCents: 0, creditReturnedCents: 0, lateFee: { paid: true } });
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toEqual({ kind: 'late_drop', paid: true, oweCents: 0 });
    // 3 left; Casey (paid with credit) drops: 2 left, credit stays spent.
    const r2 = await drop(w, g.id, 'Casey');
    expect(r2).toMatchObject({ creditBackCents: 0, creditReturnedCents: 0, lateFee: { paid: true } });
    expect(await pot(w, 'Casey')).toBe(0);
    // Nothing is owed by a paid debt; neither is on the Pay card.
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect(health(w)).toEqual({});
  });

  it('4 in, 2 drop late: both owe (each drop takes it further below 4)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    expect((await drop(w, g.id, 'Blair')).lateFee).toBeTruthy();
    expect((await drop(w, g.id, 'Casey')).lateFee).toBeTruthy();
    expect((await sessOf(w, g.id)).roster.filter((r: any) => r.lateFee).map((r: any) => r.name)).toEqual(['Blair', 'Casey']);
  });

  it('5 in, 2 drop: only the drop that takes it below 4 owes', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 4);
    expect((await drop(w, g.id, 'Blair')).lateFee).toBeUndefined();
    expect((await drop(w, g.id, 'Casey')).lateFee).toBeTruthy();
  });

  it('a waitlist that fills the seat at once: no debt (the waiting player counts)', async () => {
    const w = await world({ maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 4);
    expect((await view(w, 'Blair')).sessions.find((s) => s.id === g.id)!.mine!.lateDrop!.owes).toBe(false);
    expect((await drop(w, g.id, 'Blair')).lateFee).toBeUndefined();
    expect((await sessOf(w, g.id)).confirmedCount).toBe(4);
  });

  it('before the cutoff (more than 12 hours out): no debt, as before', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 13);
    expect((await view(w, 'Blair')).sessions.find((s) => s.id === g.id)!.mine!.lateDrop).toBeUndefined();
    expect((await drop(w, g.id, 'Blair')).lateFee).toBeUndefined();
    expect((await rowOf(w, g.id, 'Blair')).lateDropAt).toBeNull();
  });

  it('an organizer removal of someone else is never late', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 3);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'withdraw' })).status).toBe(200);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
  });

  it('the private test header only changes that phone\'s own drop', async () => {
    const w = await world({ mode: 'off' });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    const casey = await phone(w, 'Casey');
    expect((await casey.call('POST', `/api/sessions/${g.id}/withdraw`, {}, { [LATE_FEES_HEADER]: 'on' })).data.lateFee).toBeTruthy();
    // 3 left, Blair's phone has no header: today's rule (money back, no debt).
    expect((await drop(w, g.id, 'Blair')).lateFee).toBeUndefined();
  });
});

// ---------- subs ----------

describe('a sub clears the oldest open late drop, one each', () => {
  it('drop then a new I\'m in: the debt is cleared, a paid dropper gets $14 back as credit, the credit line says someone took the spot', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect(await pot(w, 'Blair')).toBe(0);
    await join(w, g.id, ['Frankie']);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    expect(await pot(w, 'Blair')).toBe(PRICE);
    const v = await view(w, 'Blair');
    const e = v.credit.history.find((h) => h.sessionId === g.id)!;
    expect(e.lateFee).toBe('sub');
    const lines = creditChanges(v.credit.history, 'America/Detroit', ORG);
    expect(lines[0].text).toMatch(/^Tue, Oct 27: someone took your spot\. \$14 back as credit\.$/);
    expect(audits(w, 'late_fee_cleared')).toEqual([expect.objectContaining({ player: 'Blair', why: 'sub', sub: 'Frankie', amountCents: PRICE })]);
    expect(health(w)).toEqual({});
    expect(info(w)).toBe(0);
  });

  it('two drops, then one sub: only the oldest clears; the next sub clears the second; a clear is final', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 60_000;
    await drop(w, g.id, 'Casey');
    await join(w, g.id, ['Frankie']);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    expect((await rowOf(w, g.id, 'Casey')).lateFee).toMatchObject({ kind: 'late_drop' });
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    expect(await owedOf(w, 'Casey', g.id)).toMatchObject({ amountCents: PRICE });
    // Frankie drops again (now 3 → 2... Frankie owes); Blair's clear stays final.
    w.app.now += 60_000;
    await join(w, g.id, ['Gale']);
    expect((await rowOf(w, g.id, 'Casey')).lateFee).toBeNull();
    // A new sign-up clears a debt even with 5 or more in: none left now, so this one clears nothing.
    await join(w, g.id, ['Harper']);
    expect(audits(w, 'late_fee_cleared').map((a) => a.player)).toEqual(['Blair', 'Casey']);
    expect(health(w)).toEqual({});
  });

  it('a sub with 5 or more in still clears (the court is covered)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await join(w, g.id, ['Frankie', 'Gale']);
    expect((await sessOf(w, g.id)).confirmedCount).toBe(5);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
  });

  it('waitlist move-in, the organizer adding someone, and the organizer\'s own In each count as a sub', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    w.app.now += 1000;
    await drop(w, g.id, 'Devon');
    // The organizer adds Frankie: clears Blair.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Frankie, action: 'confirm' })).status).toBe(200);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toBeNull();
    w.app.now += 1000;
    // The organizer's own In: clears Casey.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    expect((await rowOf(w, g.id, 'Casey')).lateFee).toBeNull();
    expect((await rowOf(w, g.id, 'Devon')).lateFee).toMatchObject({ kind: 'late_drop' });
    expect(audits(w, 'late_fee_cleared').map((a) => [a.player, a.sub])).toEqual([
      ['Blair', 'Frankie'],
      ['Casey', ORG],
    ]);
  });

  it('the dropper coming back settles only their own debt, keeps their payment (no double charge) and clears nobody else', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Casey');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    await join(w, g.id, ['Casey']);
    const c = await rowOf(w, g.id, 'Casey');
    expect(c).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', lateFee: null, lateDropAt: null });
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'late_drop' });
    expect(await pot(w, 'Casey')).toBe(0);
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
  });

  it('double taps and two phones joining at once clear one debt per seat, never more', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    const f = await phone(w, 'Frankie');
    await Promise.all([f.call('POST', `/api/sessions/${g.id}/join`, {}, w.headers), f.call('POST', `/api/sessions/${g.id}/join`, {}, w.headers)]);
    expect(audits(w, 'late_fee_cleared')).toHaveLength(1);
    expect((await rowOf(w, g.id, 'Casey')).lateFee).toMatchObject({ kind: 'late_drop' });
  });
});

// ---------- retries never leak the held $14 ----------

describe('retries', () => {
  it('a second Drop out tap (switch on or off) never hands the held $14 back', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect(await drop(w, g.id, 'Blair')).toMatchObject({ result: 'not_in_session', creditBackCents: 0 });
    // Switch off for everyone now: the debt stays, a retry still moves nothing.
    expect((await admin(w, 'PUT', '/api/admin/late-fees', { on: false })).status).toBe(200);
    expect(await drop(w, g.id, 'Blair')).toMatchObject({ creditBackCents: 0 });
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'withdraw' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toEqual({ kind: 'late_drop', paid: true, oweCents: 0 });
    // The old Done button refuses an open debt (it would leave the money nowhere).
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-drop-done`, { playerId: w.byName.Blair })).status).toBe(409);
    // A sub still clears it with the switch off.
    await join(w, g.id, ['Frankie']);
    expect(await pot(w, 'Blair')).toBe(PRICE);
  });
});

// ---------- independent review findings (Nov 2) ----------

describe('review fixes', () => {
  it('cancel with the fee kept: a paid waitlist seat (not in) gets its $14 back as credit; everyone in still owes', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await markPaid(w, g.id, 'Frankie');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Frankie, action: 'waitlist' })).status).toBe(200);
    at(w, g.start, 4);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    expect(await pot(w, 'Frankie')).toBe(PRICE);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'canceled_late' });
    expect(health(w)).toEqual({});
  });

  it('moving a late-drop debtor to the waitlist is refused (the debt and its money stay put)', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 4);
    await drop(w, g.id, 'Blair');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/roster`, { playerId: w.byName.Blair, action: 'waitlist' })).status).toBe(409);
    expect((await rowOf(w, g.id, 'Blair'))).toMatchObject({ status: 'withdrawn', lateFee: { kind: 'late_drop', paid: true } });
    w.app.now = g.start + 3 * HOUR;
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true });
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'late_drop' });
  });

  it('"No" on a game you owe a late fee for does not end the debt', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 4);
    await drop(w, g.id, 'Blair');
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/decline`, {})).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'late_drop' });
  });

  it('the organizer\'s own seat is never counted as an open fee in the health check', async () => {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 4);
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    expect(info(w)).toBe(3);
  });
});

// ---------- paying a debt ----------

describe('paying and clearing a debt', () => {
  it('Mark paid, Unmark, I paid then Mark paid, and Use credit all work on a late-drop debt', async () => {
    const w = await world();
    const g = await game(w);
    const later = await game(w, 1);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    // Organizer Mark paid with the screen's money summary.
    let row = await rowOf(w, g.id, 'Blair');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: true, seen: row.moneySeen, cents: row.owesCents })).status).toBe(200);
    row = await rowOf(w, g.id, 'Blair');
    expect(row).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: PRICE, lateFee: { paid: true } });
    expect(await owedOf(w, 'Blair', g.id)).toBeNull();
    // Unmark: owes again, no credit made.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: false, seen: row.moneySeen })).status).toBe(200);
    expect(await owedOf(w, 'Blair', g.id)).toMatchObject({ amountCents: PRICE });
    expect(await pot(w, 'Blair')).toBe(0);
    // The player's own I paid, then the organizer confirms: stays on the game, never becomes credit.
    expect((await call(w, 'Blair', 'POST', `/api/sessions/${g.id}/paid`, { paid: true, cents: PRICE })).status).toBe(200);
    expect((await dash(w)).paymentClaims).toEqual([]);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/claim`, { playerId: w.byName.Blair, paid: true })).status).toBe(200);
    expect(await rowOf(w, g.id, 'Blair')).toMatchObject({ paymentStatus: 'paid', selfPaid: false, lateFee: { paid: true } });
    expect(await pot(w, 'Blair')).toBe(0);
    // Use credit on a debt: Casey drops late and owes; credit from a later game pays it.
    await join(w, later.id, ['Casey']);
    w.app.now = later.start - 48 * HOUR > w.app.now ? w.app.now : w.app.now;
    await markPaid(w, later.id, 'Casey');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    // Casey's later game drop (more than 12 hours out) gives $14 credit.
    await drop(w, later.id, 'Casey');
    expect(await pot(w, 'Casey')).toBe(PRICE);
    const used = await call(w, 'Casey', 'POST', `/api/sessions/${g.id}/use-credit`, {});
    expect(used.status, used.text).toBe(200);
    expect(used.data).toMatchObject({ usedCents: PRICE, paid: true });
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
    expect(health(w)).toEqual({});
  });

  it('Clear (Sub found / Venue waived / My choice): money back as credit, each with a History line', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    w.app.now += 1000;
    await drop(w, g.id, 'Devon');
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).data).toMatchObject({ changed: true, creditBackCents: PRICE });
    // A second tap clears nothing more.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).data.changed).toBe(false);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Casey, why: 'choice' })).status).toBe(200);
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Devon, why: 'sub' })).status).toBe(200);
    expect(audits(w, 'late_fee_cleared').map((a) => [a.player, a.why])).toEqual([
      ['Blair', 'venue'],
      ['Casey', 'choice'],
      ['Devon', 'sub'],
    ]);
    const lines = (await dash(w)).audit.map((a: any) => activityText({ ...a, sessionStartsAt: new Date(g.start).toISOString() }, 'America/Detroit', ORG));
    expect(lines.join('\n')).toMatch(/cleared Blair's \$14 \(venue waived\)/);
    expect(lines.join('\n')).toMatch(/cleared Casey's \$14 \(my choice\)/);
    expect((await view(w, 'Blair')).credit.history.find((h) => h.sessionId === g.id)!.lateFee).toBe('cleared');
    expect((await sessOf(w, g.id)).roster.filter((r: any) => r.lateFee)).toEqual([]);
    expect(health(w)).toEqual({});
  });
});

// ---------- finalize ----------

describe('Finalize: did not play owes only when fewer than 4 played', () => {
  async function played(w: W, names: string[], everyone: string[]) {
    const g = await game(w);
    await join(w, g.id, everyone);
    for (const n of everyone) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    const r = await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: names.map((n) => w.byName[n]) });
    expect(r.status, r.text).toBe(200);
    return g;
  }

  it('5 signed up, 4 played: the 5th owes nothing, their $14 comes back as credit (as before)', async () => {
    const w = await world();
    const g = await played(w, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect(await pot(w, 'Frankie')).toBe(PRICE);
    expect((await rowOf(w, g.id, 'Frankie')).lateFee).toBeNull();
    expect((await sessOf(w, g.id)).finalized).toMatchObject({ playedCount: 4, priceCents: PRICE });
  });

  it('4 signed up, 3 played: the no-show owes $14 flat (their payment stays), N is 3, Clear gives it back', async () => {
    const w = await world();
    const g = await played(w, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey', 'Devon', 'Emery']);
    expect(await pot(w, 'Emery')).toBe(0);
    expect((await rowOf(w, g.id, 'Emery')).lateFee).toEqual({ kind: 'no_show', paid: true, oweCents: 0 });
    expect((await sessOf(w, g.id)).finalized).toMatchObject({ playedCount: 3, priceCents: PRICE });
    expect(audits(w, 'late_fee_owed')).toEqual([expect.objectContaining({ player: 'Emery', kind: 'no_show' })]);
    expect(health(w)).toEqual({});
    // Reopen: the no-show debt goes with the finalize; Finalize again with the switch off works as before.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/reopen`, {})).status).toBe(200);
    expect((await rowOf(w, g.id, 'Emery'))).toMatchObject({ lateFee: null, lateDropAt: null, played: null });
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) })).status).toBe(200);
    expect((await rowOf(w, g.id, 'Emery')).lateFee).toMatchObject({ kind: 'no_show' });
    // Clear: what Finalize gives a no-show when 4 or more play (all of it back).
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Emery, why: 'choice' })).data.changed).toBe(true);
    expect(await pot(w, 'Emery')).toBe(PRICE);
    expect(health(w)).toEqual({});
  });

  it('an unpaid no-show owes $14 on their Pay card', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    for (const n of ['Blair', 'Casey', 'Devon']) await markPaid(w, g.id, n);
    w.app.now = g.start + 3 * HOUR;
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) });
    expect(await owedOf(w, 'Emery', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'no_show' });
  });

  it('switch off: 4 signed, 3 played, the no-show gets everything back (today)', async () => {
    const w = await world({ mode: 'off' });
    const g = await played(w, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey', 'Devon', 'Emery']);
    expect(await pot(w, 'Emery')).toBe(PRICE);
    expect((await rowOf(w, g.id, 'Emery')).lateFee).toBeNull();
  });
});

// ---------- organizer cancels inside the 12 hours ----------

describe('Cancel inside the 12 hours: "Did the venue waive the fee?"', () => {
  async function setup(mode: Mode = 'settings') {
    const w = await world({ mode });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 4);
    await drop(w, g.id, 'Emery');
    return { w, g };
  }
  const cancel = (w: W, sid: string, extra: Record<string, unknown> = {}) => admin(w, 'POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true, ...extra });

  it('an answer is required (no default)', async () => {
    const { w, g } = await setup();
    expect((await cancel(w, g.id)).status).toBe(400);
    expect((await sessOf(w, g.id)).state.flags.canceled).toBe(false);
  });

  it('Yes: today\'s cancel, everyone gets money back as credit, the late drop is cleared too', async () => {
    const { w, g } = await setup();
    expect((await cancel(w, g.id, { venueWaived: true })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect((await rowOf(w, g.id, 'Emery')).lateFee).toBeNull();
    expect(await owedOf(w, 'Emery', g.id)).toBeNull();
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
    expect(health(w)).toEqual({});
    expect(info(w)).toBe(0);
  });

  it('No: no money moves, everyone signed up still owes $14 (late drop too); a second tap moves nothing; Reopen makes a normal game', async () => {
    const { w, g } = await setup();
    expect((await cancel(w, g.id, { venueWaived: false, reason: 'Rain' })).status).toBe(200);
    const s = await sessOf(w, g.id);
    expect(s.canceledBy).toBe(FEE_KEPT);
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toEqual({ kind: 'canceled_late', paid: true, oweCents: 0 });
    expect(await owedOf(w, 'Casey', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'canceled_late' });
    expect(await owedOf(w, 'Emery', g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'late_drop' });
    expect(s.court).not.toBeNull();
    expect(s.payableCount).toBe(4);
    // The player's own card says it, not "it's now your credit".
    expect((await view(w, 'Casey')).sessions.find((x) => x.id === g.id)!.mine!.lateFee).toMatchObject({ kind: 'canceled_late', oweCents: PRICE });
    // A second cancel tap must not give anything back.
    expect((await cancel(w, g.id, { venueWaived: true })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(0);
    expect(health(w)).toEqual({});
    // Money: the venue charged the court, what was paid counts as collected.
    const month = (await admin(w, 'GET', '/api/admin/money?month=2026-10')).data;
    expect(month.sessions.find((x: any) => x.id === g.id)).toMatchObject({ state: 'canceled', charged: true, collectedCents: PRICE });
    // Pay it with Mark paid on a canceled game; Clear another.
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Casey, paid: true })).status).toBe(200);
    expect(await owedOf(w, 'Casey', g.id)).toBeNull();
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    // Reopen: a normal game again (Casey's payment is a normal payment, Devon owes as a player, Emery's late drop stays).
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'reopen' })).status).toBe(200);
    const after = await sessOf(w, g.id);
    expect(after.canceledBy).toBeNull();
    expect((await rowOf(w, g.id, 'Casey'))).toMatchObject({ paymentStatus: 'paid', lateFee: null });
    expect((await rowOf(w, g.id, 'Devon'))).toMatchObject({ owesCents: PRICE, lateFee: null });
    expect(health(w)).toEqual({});
  });

  it('switch off: the old question, today\'s cancel (no answer needed)', async () => {
    const { w, g } = await setup('off');
    expect((await cancel(w, g.id, { chargedCents: 4800 })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    expect((await sessOf(w, g.id)).canceledBy).toBe('organizer');
  });
});

// ---------- switch off is today ----------

describe('switch off behaves exactly as before', () => {
  async function script(mode: Mode) {
    const w = await world({ mode });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    const out: unknown[] = [];
    out.push(await drop(w, g.id, 'Frankie'));
    out.push(await drop(w, g.id, 'Blair'));
    out.push(await drop(w, g.id, 'Casey'));
    await join(w, g.id, ['Gale']);
    const d = await dash(w);
    const s = d.sessions.find((x: any) => x.id === g.id);
    out.push(s.roster.map((r: any) => [r.name, r.status, r.paymentStatus, r.owesCents, r.lateFee ?? null, !!r.lateDropAt]));
    for (const n of ['Blair', 'Casey', 'Frankie', 'Gale']) out.push([n, await pot(w, n), await owedOf(w, n, g.id)]);
    out.push(health(w));
    return out;
  }
  it('the same taps with the switch off give money back on every late drop, exactly like today', async () => {
    const off = await script('off');
    // Today: the late drops are recorded and money comes back as credit; nobody owes.
    expect(JSON.stringify(off)).not.toMatch(/late_drop"|"lateFee":\{/);
    expect(off.slice(-2, -1)).toEqual([['Gale', 0, expect.objectContaining({ amountCents: PRICE })]]);
    expect(off.find((x: any) => Array.isArray(x) && x[0] === 'Blair')).toEqual(['Blair', PRICE, null]);
    // With the switch on: Frankie's drop leaves 4 (nothing owed), Blair's leaves 3 and Casey's 2 (both owe); Gale's
    // sign-up clears the oldest (Blair gets her $14 back as credit), Casey still owes.
    const on = await script('settings');
    expect(on.find((x: any) => Array.isArray(x) && x[0] === 'Blair')).toEqual(['Blair', PRICE, null]);
    expect(on.find((x: any) => Array.isArray(x) && x[0] === 'Casey')).toEqual(['Casey', 0, expect.objectContaining({ amountCents: PRICE, lateFee: 'late_drop' })]);
    expect(on.find((x: any) => Array.isArray(x) && x[0] === 'Frankie')).toEqual(['Frankie', 0, null]);
  });
});

// ---------- restore, privacy, the two rule copies ----------

describe('restore round trip, privacy, and the SQL rule matching the TypeScript rule', () => {
  it('a backup taken with open debts restores them exactly', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await drop(w, g.id, 'Casey');
    const file = (await admin(w, 'GET', '/api/admin/backup')).data;
    const fresh = createNodeD1(':memory:');
    (fresh as any).raw.exec(backupToSql(file));
    const q = (db: any) =>
      db.raw.prepare(`SELECT p.display_name AS n, sp.status, sp.payment_status, sp.played, sp.late_drop_done_at FROM session_players sp JOIN players p ON p.id = sp.player_id WHERE sp.session_id = ? AND ${OPEN_FEE('sp')} ORDER BY n`).all(g.id);
    expect(q(fresh)).toEqual(q(w.app.db));
    expect(q(fresh).map((r: any) => r.n)).toEqual(['Blair', 'Casey']);
  });

  it('nobody sees another player\'s debt', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    const other = withoutIds(JSON.stringify(await view(w, 'Casey')));
    expect(other).not.toMatch(/late_drop|lateFee":\{|Blair owes/);
    expect((await view(w, 'Casey')).owed.filter((o) => o.lateFee)).toEqual([]);
    // The organizer's data needs the sign-in.
    expect((await (await phone(w, 'Casey')).call('GET', '/api/admin/dashboard')).status).toBe(401);
  });

  it('lateFeeKind (TypeScript) and OPEN_FEE (SQL) agree on every seat shape', async () => {
    const w = await world();
    const raw = (w.app.db as any).raw;
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    const combos: unknown[] = [];
    for (const status of ['confirmed', 'withdrawn', 'waitlisted'])
      for (const played of [null, 0, 1])
        for (const lateAt of [null, 'X'])
          for (const done of [null, 'D'])
            for (const pay of ['unpaid', 'paid', 'paid-refunded', 'not_applicable'])
              for (const sess of ['planned', 'canceled-kept', 'canceled', 'finalized'])
                combos.push({ status, played, lateAt, done, pay, sess });
    const finAt = '2026-10-28T01:00:00.000Z';
    for (const c of combos as any[]) {
      raw.prepare("UPDATE sessions SET status = ?, canceled_by = ?, finalized_at = ? WHERE id = ?").run(
        c.sess.startsWith('canceled') ? 'canceled' : 'planned',
        c.sess === 'canceled-kept' ? FEE_KEPT : c.sess === 'canceled' ? 'organizer' : null,
        c.sess === 'finalized' ? finAt : null,
        g.id,
      );
      const lateAt = c.lateAt === 'X' ? (c.sess === 'finalized' ? finAt : '2026-10-27T20:00:00.000Z') : null;
      raw
        .prepare('UPDATE session_players SET status = ?, played = ?, late_drop_at = ?, late_drop_done_at = ?, payment_status = ?, refunded_at = ?, payment_amount_cents = ? WHERE session_id = ?')
        .run(c.status, c.played, lateAt, c.done, c.pay === 'paid-refunded' ? 'paid' : c.pay, c.pay === 'paid-refunded' ? '2026-10-27T00:00:00.000Z' : null, c.pay.startsWith('paid') ? 1400 : null, g.id);
      const seat = raw.prepare('SELECT * FROM session_players WHERE session_id = ?').get(g.id);
      const sess = raw.prepare('SELECT * FROM sessions WHERE id = ?').get(g.id);
      const sql = raw.prepare(`SELECT ${OPEN_FEE('sp')} AS f FROM session_players sp WHERE sp.session_id = ?`).get(g.id).f;
      expect(!!lateFeeKind(seat, sess), JSON.stringify(c)).toBe(sql === 1);
    }
  });
});

// ---------- words ----------

describe('the words', () => {
  it('dialog, banner and threshold', () => {
    expect(lateDropDialogText('8:00 AM', true, '$14', null)).toBe("It's past the 8:00 AM cancel-by. If no one takes your spot, you still owe $14.");
    expect(lateDropDialogText('8:00 AM', false, '$14', 'your $14 comes back as credit')).toBe("It's past the 8:00 AM cancel-by. Enough players are still in, so your $14 comes back as credit.");
    expect(lateDropToast('$14', false)).toBe("You're out. You owe $14 unless someone takes your spot.");
    expect(lateDropToast('$14', true)).toBe("You're out. Your $14 stays on this game unless someone takes your spot.");
    expect(dropLeavesShort(4, 0)).toBe(true);
    expect(dropLeavesShort(5, 0)).toBe(false);
    expect(dropLeavesShort(4, 1)).toBe(false);
  });
});

// ---------- round 2 (Alex, Mon Nov 2 evening) ----------

const A_TEXT =
  "Hey guys, sorry, I have to back out of today's game. I canceled the court, so you can still book the same slot as non-members. It's only $2 more per person. Book online: https://app.courtreserve.com/Online/publicbookings/13765?tab=reserve&step=initial or call the courts at 810-207-5698. Sorry again, hope you can still get it in!";
const B_TEXT =
  "Hey guys, sorry, I have to back out of today's game. The court is still booked under my name, so you can still play. They might charge you $2 more each since the non-member rate is $16. They may be cool though and let you play under my membership pricing. Questions? Call the courts at 810-207-5698. Sorry again!";

describe('1a. cancel inside 12 hours with the organizer in the game', () => {
  async function setup() {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    await markPaid(w, g.id, 'Blair');
    // The organizer paid the venue (the court row).
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: true })).status).toBe(200);
    at(w, g.start, 4);
    return { w, g };
  }
  it('Yes: every player gets their money back as credit, nobody owes, the organizer gets nothing back and owes nothing', async () => {
    const { w, g } = await setup();
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: true })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(PRICE);
    for (const n of ['Casey', 'Devon']) expect(await owedOf(w, n, g.id)).toBeNull();
    expect((await rowOf(w, g.id, ORG)).lateFee).toBeNull();
    expect((await dash(w)).creditLedger.find((p: any) => p.playerId === w.byName[ORG])).toBeUndefined();
    expect(health(w)).toEqual({});
  });
  it('No: the 3 players owe $14 each (Blair already paid), the organizer owes nothing, the court row stays', async () => {
    const { w, g } = await setup();
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(0);
    expect((await rowOf(w, g.id, 'Blair')).lateFee).toMatchObject({ kind: 'canceled_late', paid: true });
    for (const n of ['Casey', 'Devon']) expect(await owedOf(w, n, g.id)).toMatchObject({ amountCents: PRICE, lateFee: 'canceled_late' });
    expect((await rowOf(w, g.id, ORG)).lateFee).toBeNull();
    const s = await sessOf(w, g.id);
    expect(s.payableCount).toBe(3);
    expect(s.paidCount).toBe(1);
    expect(s.court).toMatchObject({ paid: true });
    expect(unpaidRows(s).map((r: any) => r.name).sort()).toEqual(['Casey', 'Devon']);
    expect(health(w)).toEqual({});
  });
});

describe('1b. the organizer drops late and the game goes on: treated like any player', () => {
  it('leaves fewer than 4: the $14 shows as owed on Money and Home, one tap clears it ("My choice"), and it never blocks them', async () => {
    const w = await world();
    const g = await game(w);
    const later = await game(w, 1);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName[ORG], paid: true })).status).toBe(200);
    at(w, g.start, 3);
    const out = await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
    expect(out.data).toMatchObject({ result: 'withdrawn', lateFee: { cents: PRICE } });
    const row = await rowOf(w, g.id, ORG);
    expect(row).toMatchObject({ status: 'withdrawn', isOrganizer: true, lateFee: { kind: 'late_drop', paid: false, oweCents: PRICE } });
    expect(audits(w, 'late_fee_owed')).toEqual([expect.objectContaining({ player: ORG, kind: 'late_drop' })]);
    // The court payment is untouched (it is never a share, never credit).
    expect((await sessOf(w, g.id)).court).toMatchObject({ paid: true });
    // Never blocks: the organizer's own In on another game, and the remind list never texts them.
    expect((await admin(w, 'POST', `/api/admin/sessions/${later.id}/me`, { in: true })).data.result).toBe('confirmed');
    expect(unpaidRows(await sessOf(w, g.id)).map((r: any) => r.name)).not.toContain(ORG);
    // One tap: Clear, "My choice".
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName[ORG], why: 'choice' })).data.changed).toBe(true);
    expect((await rowOf(w, g.id, ORG)).lateFee).toBeNull();
    expect((await sessOf(w, g.id)).court).toMatchObject({ paid: true });
    expect((await dash(w)).creditLedger.find((p: any) => p.playerId === w.byName[ORG])).toBeUndefined();
    expect(health(w)).toEqual({});
  });
  it('a sub clears the organizer\'s debt like anyone\'s; the organizer coming back in settles their own', async () => {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 3);
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
    await join(w, g.id, ['Emery']);
    expect((await rowOf(w, g.id, ORG)).lateFee).toBeNull();
    expect(audits(w, 'late_fee_cleared')).toEqual([expect.objectContaining({ player: ORG, why: 'sub', sub: 'Emery' })]);
    // Again: drop (4 left now: Blair, Casey, Devon, Emery -> nothing owed); come back in.
    w.app.now += 1000;
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    w.app.now += 1000;
    await drop(w, g.id, 'Emery');
    w.app.now += 1000;
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
    expect((await rowOf(w, g.id, ORG)).lateFee).toMatchObject({ kind: 'late_drop' });
    w.app.now += 1000;
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).data.result).toBe('confirmed');
    expect((await rowOf(w, g.id, ORG))).toMatchObject({ status: 'confirmed', lateFee: null });
  });
  it('switch off: the organizer\'s late drop owes nothing (as before)', async () => {
    const w = await world({ mode: 'off' });
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 3);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false })).data.lateFee).toBeUndefined();
    expect((await rowOf(w, g.id, ORG)).lateFee).toBeNull();
  });
});

describe('2. Text the players', () => {
  it('goes only to the players confirmed in that game: not the organizer, not the waitlist, not hidden players', async () => {
    const w = await world({ maxPlayers: 4 });
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await w.organizer.call('POST', `/api/admin/players/${w.byName.Casey}/admin-hide`, { hidden: true }, { 'X-Admin-R2': 'on' })).status).toBe(200);
    const d = (await w.organizer.call('GET', '/api/admin/dashboard', undefined, { ...w.headers, 'X-Admin-R2': 'on' })).data;
    const s = d.sessions.find((x: any) => x.id === g.id);
    expect(s.roster.find((r: any) => r.name === 'Emery').status).toBe('waitlisted');
    const who = confirmedReach(d, s, false);
    const phoneOf = (n: string) => s.roster.find((r: any) => r.name === n).phone;
    expect(who.phones.sort()).toEqual([phoneOf('Blair'), phoneOf('Devon')].sort());
    expect(who.count).toBe(2);
    expect(who.phones).not.toContain(phoneOf(ORG));
  });
  it('the two texts, word for word, in order, with the booking link and the courts\' number', () => {
    const t = backOutTexts();
    expect(t.map((x) => x.label)).toEqual(['Court canceled', 'Court still booked (backup)']);
    expect(t[0].body).toBe(A_TEXT);
    expect(t[1].body).toBe(B_TEXT);
    expect(t[0].body).toContain('https://app.courtreserve.com/Online/publicbookings/13765?tab=reserve&step=initial');
    expect(t[1].body).toContain('810-207-5698');
    // Messages opens with the words and the numbers (the site never sends).
    expect(smsHref(['3135550101', '3135550103'], t[0].body, true)).toMatch(/^sms:/);
  });
  it('shows only with the switch on (the dashboard says so)', async () => {
    expect((await dash(await world({ mode: 'off' }))).lateFees).toBe(false);
    expect((await dash(await world())).lateFees).toBe(true);
  });
});

describe('3. the person who owed is told when the debt is cleared', () => {
  it('cleared by a sub, never paid: "Good news ... You no longer owe $14."; only they see it', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    expect((await view(w, 'Blair')).feeNotices).toEqual([]);
    await join(w, g.id, ['Frankie']);
    const n = (await view(w, 'Blair')).feeNotices!;
    expect(n).toEqual([expect.objectContaining({ why: 'sub', creditCents: 0, startsAt: new Date(g.start).toISOString() })]);
    expect(feeClearedNotice(n[0].why, 'Tue, Oct 27', '$14', null)).toBe('Good news: someone took your spot for Tue, Oct 27. You no longer owe $14.');
    for (const other of ['Casey', 'Frankie']) expect((await view(w, other)).feeNotices).toEqual([]);
    expect(withoutIds(JSON.stringify(await view(w, 'Casey')))).not.toMatch(/someone took your spot|late_fee/);
  });
  it('cleared by a sub after paying: "... Your $14 is back as credit."', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    await join(w, g.id, ['Frankie']);
    const n = (await view(w, 'Blair')).feeNotices!;
    expect(n[0]).toMatchObject({ why: 'sub', creditCents: PRICE });
    expect(feeClearedNotice('sub', 'Tue, Oct 27', '$14', '$14')).toBe('Good news: someone took your spot for Tue, Oct 27. Your $14 is back as credit.');
  });
  it('cleared by the organizer (venue waived or my choice): "You no longer owe $14 for Tue, Oct 27."', async () => {
    const w = await world();
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    at(w, g.start, 5);
    await drop(w, g.id, 'Blair');
    w.app.now += 1000;
    await drop(w, g.id, 'Casey');
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Blair, why: 'venue' });
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Casey, why: 'choice' });
    for (const n of ['Blair', 'Casey']) expect((await view(w, n)).feeNotices).toEqual([expect.objectContaining({ why: 'cleared', creditCents: 0 })]);
    expect(feeClearedNotice('cleared', 'Tue, Oct 27', '$14', null)).toBe('You no longer owe $14 for Tue, Oct 27.');
  });
  it('the organizer never gets a notice about their own debt', async () => {
    const w = await world();
    const g = await game(w);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: true })).status).toBe(200);
    await join(w, g.id, ['Blair', 'Casey', 'Devon']);
    at(w, g.start, 3);
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/me`, { in: false });
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName[ORG], why: 'choice' });
    expect((await view(w, ORG)).feeNotices).toEqual([]);
  });
});

describe('4. the text after a late cancel follows the venue answer', () => {
  async function canceled(waived: boolean) {
    const w = await world({ maxPlayers: 4 });
    const g = await game(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    at(w, g.start, 4);
    expect((await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: waived })).status).toBe(200);
    const d = await dash(w);
    return { w, g, d, s: d.sessions.find((x: any) => x.id === g.id) };
  }
  it('No: "Heads up: today\'s game is canceled ..." to the confirmed players only (not the waitlist); the Home card text matches', async () => {
    const { d, s } = await canceled(false);
    const t = lateCancelText(d, s, '')!;
    const link = String(d.group.playerLink).replace(/^https?:\/\//, '').replace(/\/$/, '');
    expect(t.feeKept).toBe(true);
    expect(t.body).toBe(
      `Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. If you were signed up, your $14 share still applies (if you already paid, you're all set). You can pay on the site: ${t.body.match(/site: (\S+)\. Sorry/)![1]}. Sorry about that!`,
    );
    expect(t.body).not.toMatch(/credit|tomorrow/);
    expect(t.body).toContain(link.split('/')[0]);
    const confirmedPhones = s.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.phone).sort();
    expect(t.reach.phones.sort()).toEqual(confirmedPhones);
    expect(t.reach.phones).not.toContain(s.roster.find((r: any) => r.status === 'waitlisted').phone);
    // The Home "Do this now" card's text button uses the same words and people.
    const item = sessionTexts(d, s, Date.parse(d.now)).find((x) => x.id === 'canceled')!;
    expect(item.body).toBe(t.body);
    expect(item.phones.sort()).toEqual(confirmedPhones);
  });
  it('Yes: the credit text, saying "today" (not "tomorrow"), to everyone signed up and waiting', async () => {
    const { d, s } = await canceled(true);
    const t = lateCancelText(d, s, 'Rain')!;
    expect(t.feeKept).toBe(false);
    expect(t.body).toMatch(/^Pickleball today is canceled\. Rain\. If you paid, it's now your credit\. You can request a cash out on the site\. /);
    expect(t.reach.count).toBe(5);
  });
  it('switch off: the old text stays', async () => {
    const w = await world({ mode: 'off' });
    const g = await game(w);
    await join(w, g.id, ['Blair']);
    at(w, g.start, 4);
    await admin(w, 'POST', `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true });
    const d = await dash(w);
    expect(lateCancelText(d, d.sessions.find((x: any) => x.id === g.id), '')).toBeNull();
  });
});
