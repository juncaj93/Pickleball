// "Adjust credit" (ADJUST_CREDIT, Nov 2026): the organizer adds or removes credit on one player's pot by hand, with a required reason.
// It uses the credit ledger that already exists: Add is one 'kept' entry and Remove one 'used' entry, no game, reason "adjusted:<why>".
// These tests cover the rules (add, remove, floor at $0, reason required), the ledger totals, the credit math everywhere else after an
// adjustment (use at I'm in, drop, finalize, cash out), the words the player and the organizer read, and that with the switch off nothing differs.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADJUST_CREDIT_HEADER, adjustCreditAllowed, adjustNoteOf, adjustReasonColumn, adjustedPlayerLine, cleanReason, latestAdjustment, planAdjust } from '../shared/adjustCredit';
import { activityText } from '../shared/activity';
import { creditChanges, creditEntryText, potBalance } from '../shared/credit';
import { DAY, HOUR, playerPhone, setupGroup, TestApp, PIN } from './harness';

const on = { [ADJUST_CREDIT_HEADER]: 'on' };
const REASON = 'Venue refunded his half of the court after the Oct 27 game';

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const potOf = async (w: W, name: string, headers: Record<string, string> = on) =>
  (await dash(w, headers)).creditLedger.find((l: any) => l.playerId === w.byName[name])?.balanceCents ?? 0;
const adjust = (w: W, name: string, body: Record<string, unknown>, headers: Record<string, string> = on) =>
  w.organizer.call('POST', `/api/admin/players/${w.byName[name]}/credit-adjust`, body, headers);
/** A good adjustment body for the pot the screen shows. */
const body = (direction: 'add' | 'remove', cents: number, seen: number, reason = REASON) => ({ direction, cents, reason, seen });
const ledgerRows = (w: W, name: string) =>
  w.app.db.raw.prepare('SELECT kind, amount_cents, reason, session_id, ended_at FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid').all(w.byName[name]) as { kind: string; amount_cents: number; reason: string | null; session_id: string | null; ended_at: string | null }[];
/** The pot worked out straight from the ledger rows (kept minus used minus refunded), the way the site's own SQL does it. */
const potFromLedger = (w: W, name: string) =>
  ledgerRows(w, name)
    .filter((r) => !r.ended_at)
    .reduce((sum, r) => sum + (r.kind === 'kept' ? r.amount_cents : -r.amount_cents), 0);
const firstGame = async (w: W) => (await dash(w)).sessions.find((s: any) => Date.parse(s.startsAt) > w.app.now);

describe('Adjust credit rules (planAdjust)', () => {
  const base = { direction: 'add' as const, cents: 500, reason: REASON, potCents: 1400, reservedCents: 0, name: 'Mitchel' };
  it('C1 add: credit after is the pot plus the amount', () => {
    expect(planAdjust(base)).toEqual({ ok: true, deltaCents: 500, afterCents: 1900 });
  });
  it('C2 remove: credit after is the pot minus the amount, down to exactly $0', () => {
    expect(planAdjust({ ...base, direction: 'remove', cents: 500 })).toEqual({ ok: true, deltaCents: -500, afterCents: 900 });
    expect(planAdjust({ ...base, direction: 'remove', cents: 1400 })).toEqual({ ok: true, deltaCents: -1400, afterCents: 0 });
  });
  it('C3 remove cannot go below $0, with the message that names the player and the credit', () => {
    expect(planAdjust({ ...base, direction: 'remove', cents: 2000 })).toEqual({ ok: false, error: "Can't remove more than the $14 credit Mitchel has." });
    expect(planAdjust({ ...base, direction: 'remove', cents: 100, potCents: 0 })).toEqual({ ok: false, error: "Can't remove more than the $0 credit Mitchel has." });
  });
  it('C4 the amount must be positive whole dollars, at most $500', () => {
    for (const cents of [null, 0, -500, 550, 1.5, 50_100]) expect(planAdjust({ ...base, cents }).ok, String(cents)).toBe(false);
    expect(planAdjust({ ...base, cents: 50_000 }).ok).toBe(true);
  });
  it('C5 the reason is required (blank and spaces do not count)', () => {
    for (const reason of ['', '   ', '\n\t']) expect(planAdjust({ ...base, reason })).toEqual({ ok: false, error: 'Say why. The player will see this.' });
  });
  it('C6 credit a cash-out request is holding cannot be removed', () => {
    const r = planAdjust({ ...base, direction: 'remove', cents: 500, potCents: 1400, reservedCents: 1400 });
    expect(r.ok).toBe(false);
    expect(planAdjust({ ...base, direction: 'remove', cents: 500, potCents: 1900, reservedCents: 1400 }).ok).toBe(true);
    expect(planAdjust({ ...base, direction: 'remove', cents: 600, potCents: 1900, reservedCents: 1400 }).ok).toBe(false);
  });
  it('C7 a reason is cleaned to one line, and kept in the ledger column after "adjusted:"', () => {
    expect(cleanReason('  two\n  lines   here ')).toBe('two lines here');
    expect(cleanReason('x'.repeat(500))).toHaveLength(120);
    expect(adjustNoteOf(adjustReasonColumn('Court refund'))).toBe('Court refund');
    expect(adjustNoteOf('canceled')).toBeNull();
    expect(adjustNoteOf(null)).toBeNull();
  });
  it('C8 the var is allowed unless it says off', () => {
    expect(adjustCreditAllowed(undefined)).toBe(true);
    expect(adjustCreditAllowed('on')).toBe(true);
    expect(adjustCreditAllowed(' OFF ')).toBe(false);
  });
});

describe('Adjust credit: the switch', () => {
  it('S1 ships off: no endpoint, the dashboard carries only the Settings row value, nothing in the ledger', async () => {
    const w = await world();
    const d = await dash(w, {});
    expect(d.adjustCredit).toBeUndefined();
    expect(d.adjustCreditForAll).toBe(false);
    const r = await adjust(w, 'Blair', body('add', 500, 0), {});
    expect(r.status).toBe(404);
    expect(ledgerRows(w, 'Blair')).toHaveLength(0);
  });
  it('S2 the private header turns it on for that phone only', async () => {
    const w = await world();
    expect((await dash(w, on)).adjustCredit).toBe(true);
    expect((await dash(w, {})).adjustCredit).toBeUndefined();
    expect((await adjust(w, 'Blair', body('add', 500, 0))).status).toBe(200);
  });
  it('S3 the Settings switch turns it on for everyone and off again (no deploy), logged, organizer only', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
    await w.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'adjust_credit_on'").first<{ n: number }>())?.n).toBe(1);
    const d = await dash(w, {});
    expect(d.adjustCredit).toBe(true);
    expect(d.adjustCreditForAll).toBe(true);
    expect((await adjust(w, 'Blair', body('add', 500, 0), {})).status).toBe(200);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    const sw = act.find((e: { action: string }) => e.action === 'adjust_credit_on');
    expect(activityText({ ...sw }, 'America/Detroit', 'Alex')).toBe('Alex switched "Adjust credit" on');
    expect((await w.app.client().call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: false });
    expect((await dash(w, {})).adjustCredit).toBeUndefined();
    expect((await adjust(w, 'Blair', body('add', 500, 500), {})).status).toBe(404);
  });
  it('S4 the kill switch beats both the header and Settings', async () => {
    const w = await world({ ADJUST_CREDIT: 'off' });
    await w.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
    expect((await dash(w, on)).adjustCredit).toBeUndefined();
    expect((await adjust(w, 'Blair', body('add', 500, 0))).status).toBe(404);
  });
  it('S5 a player cannot adjust anything', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/admin/players/${w.byName.Blair}/credit-adjust`, body('add', 500, 0), on)).status).toBe(401);
    expect(ledgerRows(w, 'Blair')).toHaveLength(0);
  });
  it('S6 no migration was added for it', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => f <= '0018_phone_tag.sql').at(-1)).toBe('0018_phone_tag.sql'); // Zip 33: newer migrations (0019, 0020) come from other zips, so look at the newest up to 0018 // Zip 14 added 0017 (the court column), Zip 30 0018 (the phone code); this feature itself still adds none
  });
  it('S7 switch off and nothing adjusted: the dashboard credit data equals a world that never heard of it', async () => {
    const w = await world();
    const d = await dash(w, {});
    expect(d.creditLedger).toEqual([]);
    expect(Object.keys(d).filter((k) => /adjust/i.test(k))).toEqual(['adjustCreditForAll']);
  });
});

describe('Adjust credit: saving', () => {
  it('A1 add $5 to $14 makes $19: one kept entry, no game, the reason in the same row, a log line, "Credit after" right', async () => {
    const w = await world();
    expect((await adjust(w, 'Blair', body('add', 1400, 0, 'Starting credit'))).status).toBe(200);
    expect(await potOf(w, 'Blair')).toBe(1400);
    w.app.advance(HOUR);
    const r = await adjust(w, 'Blair', body('add', 500, 1400));
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ ok: true, balanceCents: 1900, deltaCents: 500, text: 'Blair: credit +$5, $19 now' });
    expect(await potOf(w, 'Blair')).toBe(1900);
    const rows = ledgerRows(w, 'Blair');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: 'kept', amount_cents: 500, session_id: null, ended_at: null, reason: `adjusted:${REASON}` });
    expect(potFromLedger(w, 'Blair')).toBe(1900);
    const entries = (await dash(w)).creditLedger.find((l: any) => l.playerId === w.byName.Blair).entries;
    expect(entries[1]).toMatchObject({ kind: 'kept', cents: 500, reason: 'adjusted', note: REASON, balanceAfterCents: 1900 });
    expect(entries[0]).toMatchObject({ cents: 1400, balanceAfterCents: 1400 });
    // Money history line: "Blair: credit +$5, $19 now. Adjusted by organizer. Reason: ..."
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'credit_adjusted' && e.details.deltaCents === 500);
    expect(activityText({ ...act }, 'America/Detroit', 'Alex')).toBe(`Blair: credit +$5, $19 now. Adjusted by organizer. Reason: ${REASON}`);
  });
  it('A2 remove up to the whole pot works and leaves exactly $0; one more dollar is refused with the plain message and writes nothing', async () => {
    const w = await world();
    await adjust(w, 'Blair', body('add', 1400, 0));
    const r = await adjust(w, 'Blair', body('remove', 2000, 1400));
    expect(r.status).toBe(400);
    expect(r.data.message ?? r.data.error).toBe("Can't remove more than the $14 credit Blair has.");
    expect(ledgerRows(w, 'Blair')).toHaveLength(1);
    expect((await adjust(w, 'Blair', body('remove', 1400, 1400))).status).toBe(200);
    expect(await potOf(w, 'Blair')).toBe(0);
    expect(potFromLedger(w, 'Blair')).toBe(0);
    const rows = ledgerRows(w, 'Blair');
    expect(rows[1]).toMatchObject({ kind: 'used', amount_cents: 1400, session_id: null });
    // $0 left: nothing more can be taken.
    expect((await adjust(w, 'Blair', body('remove', 100, 0))).status).toBe(400);
    expect(await potOf(w, 'Blair')).toBe(0);
  });
  it('A3 the reason is required on the server too, and so is a positive whole-dollar amount', async () => {
    const w = await world();
    for (const reason of ['', '   ', undefined]) expect((await adjust(w, 'Blair', { direction: 'add', cents: 500, seen: 0, reason })).status).toBe(400);
    for (const cents of [0, -500, 550, 'five', null]) expect((await adjust(w, 'Blair', { direction: 'add', cents, seen: 0, reason: REASON })).status, String(cents)).toBe(400);
    expect((await adjust(w, 'Blair', { direction: 'sideways', cents: 500, seen: 0, reason: REASON })).status).toBe(400);
    expect((await adjust(w, 'Blair', { direction: 'add', cents: 500, reason: REASON })).status).toBe(400); // no "seen"
    expect(ledgerRows(w, 'Blair')).toHaveLength(0);
  });
  it('A4 a double tap or a stale screen adds nothing: the pot must still be exactly what the sheet showed', async () => {
    const w = await world();
    expect((await adjust(w, 'Blair', body('add', 500, 0))).status).toBe(200);
    const again = await adjust(w, 'Blair', body('add', 500, 0)); // the same tap again
    expect(again.status).toBe(409);
    expect(ledgerRows(w, 'Blair')).toHaveLength(1);
    expect(await potOf(w, 'Blair')).toBe(500);
    // Two phones at once from the same screen: one wins.
    const [a, b] = await Promise.all([adjust(w, 'Blair', body('remove', 500, 500)), adjust(w, 'Blair', body('remove', 500, 500))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await potOf(w, 'Blair')).toBe(0);
    expect(potFromLedger(w, 'Blair')).toBe(0);
  });
  it('A5 you cannot adjust your own credit (you pay the court), or a person who is not in the group', async () => {
    const w = await world();
    expect((await adjust(w, 'Alex', body('add', 500, 0))).status).toBe(409);
    const r = await w.organizer.call('POST', '/api/admin/players/00000000-0000-4000-8000-000000000000/credit-adjust', body('add', 500, 0), on);
    expect(r.status).toBe(404);
  });
  it('A6 the whole $500 limit holds on the server', async () => {
    const w = await world();
    expect((await adjust(w, 'Blair', body('add', 50_100, 0))).status).toBe(400);
    expect((await adjust(w, 'Blair', body('add', 50_000, 0))).status).toBe(200);
  });
});

describe('Adjust credit: credit math everywhere else after an adjustment', () => {
  it('M1 adjusted credit is used automatically at I\'m in, the same as any credit; dropping out returns it', async () => {
    const w = await world();
    const s = await firstGame(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    await adjust(w, 'Blair', body('add', 1400, 0));
    const blair = await playerPhone(w, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    let g = (await blair.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0 });
    expect(await potOf(w, 'Blair')).toBe(0);
    expect(g.credit.balanceCents).toBe(0);
    await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    g = (await blair.call('GET', '/api/group')).data;
    expect(g.credit.balanceCents).toBe(1400);
    expect(await potOf(w, 'Blair')).toBe(1400);
    expect(potFromLedger(w, 'Blair')).toBe(1400);
  });
  it('M2 a removed amount is not spent: $14 added, $9 removed leaves $5 to use and $9 still owed', async () => {
    const w = await world();
    const s = await firstGame(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    await adjust(w, 'Blair', body('add', 1400, 0));
    await adjust(w, 'Blair', body('remove', 900, 1400));
    const blair = await playerPhone(w, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const mine = (await blair.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).mine;
    expect(mine).toMatchObject({ creditCents: 500, oweCents: 900 });
    expect(await potOf(w, 'Blair')).toBe(0);
    expect(potFromLedger(w, 'Blair')).toBe(0);
  });
  it('M3 after Finalize the final price and the credit that comes back are right on top of an adjusted pot', async () => {
    const w = await world();
    const s = await firstGame(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    await adjust(w, 'Blair', body('add', 1400, 0));
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    for (const n of names.slice(1)) await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName[n], paid: true });
    w.app.now = Date.parse(s.endsAt) + HOUR;
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    // 5 played: $11 each. Blair paid $14 with credit: $3 comes back. Each cash payer gets $3 back too.
    expect(await potOf(w, 'Blair')).toBe(300);
    expect(await potOf(w, 'Casey')).toBe(300);
    expect(potFromLedger(w, 'Blair')).toBe(300);
    // The adjustment itself is still there, once, untouched.
    expect(ledgerRows(w, 'Blair').filter((r) => (r.reason ?? '').startsWith('adjusted:'))).toHaveLength(1);
  });
  it('M3b the month Totals "Credits owed" does not move when credit is added or removed by hand (a hand adjustment belongs to no game or month)', async () => {
    const w = await world();
    const s = await firstGame(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
    for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    for (const n of names) await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: w.byName[n], paid: true });
    w.app.now = Date.parse(s.endsAt) + HOUR;
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    const month = s.startsAt.slice(0, 7);
    const owed = async () => (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, on)).data.creditsOwedCents;
    const before = await owed();
    expect(before).toBe(1500); // 5 players got $3 back
    expect((await adjust(w, 'Blair', body('add', 500, 300))).status).toBe(200);
    expect(await owed()).toBe(before);
    expect((await adjust(w, 'Blair', body('remove', 500, 800))).status).toBe(200);
    expect(await owed()).toBe(before);
    expect(await potOf(w, 'Blair')).toBe(300);
  });
  it('M4 a pending cash-out request holds its credit: Remove cannot take it, Add works, and the cash-out amount is still payable', async () => {
    const w = await world();
    await adjust(w, 'Blair', body('add', 1400, 0));
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(200);
    const r = await adjust(w, 'Blair', body('remove', 500, 1400));
    expect(r.status).toBe(400);
    expect(await potOf(w, 'Blair')).toBe(1400);
    expect((await adjust(w, 'Blair', body('add', 500, 1400))).status).toBe(200);
    expect((await adjust(w, 'Blair', body('remove', 500, 1900))).status).toBe(200);
    expect((await adjust(w, 'Blair', body('remove', 100, 1400))).status).toBe(400);
    const d = await dash(w);
    expect(d.creditLedger.find((l: any) => l.playerId === w.byName.Blair)).toMatchObject({ balanceCents: 1400, reservedCents: 1400, refundCents: 0 });
  });
  it('M5 the ledger total is always the sum of its live rows and never negative, through a run of adds and removes', async () => {
    const w = await world();
    let seen = 0;
    const steps: ['add' | 'remove', number][] = [['add', 1400], ['remove', 500], ['add', 1000], ['remove', 1900], ['remove', 100], ['add', 500], ['remove', 500]];
    for (const [dir, cents] of steps) {
      const r = await adjust(w, 'Casey', body(dir, cents, seen));
      if (r.status === 200) seen = r.data.balanceCents;
      expect(await potOf(w, 'Casey')).toBe(seen);
      expect(potFromLedger(w, 'Casey')).toBe(seen);
      expect(seen).toBeGreaterThanOrEqual(0);
    }
    expect(seen).toBe(0);
  });
  it('M6 a refunded (cashed out) pot after an adjustment goes to exactly $0, nothing left over', async () => {
    const w = await world();
    await adjust(w, 'Devon', body('add', 1900, 0));
    const r = await w.organizer.call('POST', `/api/admin/players/${w.byName.Devon}/credit-refund`, { refunded: true, cents: 1900 });
    expect(r.status, r.text).toBe(200);
    expect(await potOf(w, 'Devon')).toBe(0);
    expect(potFromLedger(w, 'Devon')).toBe(0);
  });
});

describe('Adjust credit: what the player and the organizer read', () => {
  const entry = (kind: 'kept' | 'used', cents: number, note = REASON, endedAt: string | null = null, at = '2026-11-04T23:10:00.000Z') => ({
    id: 'e1', kind, cents, sessionId: null, sessionStartsAt: null, at, endedAt, endedReason: null, reason: 'adjusted' as const, playedCount: null, note,
  });
  it('R1 the player line is "Credit adjusted by organizer: +$5" (and -$5 for a removal)', () => {
    expect(adjustedPlayerLine(500)).toBe('Credit adjusted by organizer: +$5');
    expect(adjustedPlayerLine(-500)).toBe('Credit adjusted by organizer: -$5');
  });
  it('R2 the player sees the latest recent adjustment with its reason; old, undone or no adjustments show nothing', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(latestAdjustment([entry('kept', 500)], now)).toEqual({ deltaCents: 500, note: REASON, at: '2026-11-04T23:10:00.000Z' });
    expect(latestAdjustment([entry('used', 500)], now)?.deltaCents).toBe(-500);
    expect(latestAdjustment([entry('kept', 500, REASON, '2026-11-05T00:00:00.000Z')], now)).toBeNull();
    expect(latestAdjustment([entry('kept', 500, REASON, null, '2026-10-01T00:00:00.000Z')], now)).toBeNull();
    expect(latestAdjustment([], now)).toBeNull();
    const two = [entry('kept', 500, 'first', null, '2026-11-01T00:00:00.000Z'), { ...entry('kept', 900, 'second', null, '2026-11-03T00:00:00.000Z'), id: 'e2' }];
    expect(latestAdjustment(two, now)).toMatchObject({ deltaCents: 900, note: 'second' });
  });
  it('R3 the credit sheet\'s list says it in plain words, with the reason; the organizer\'s line says adjusted by organizer', () => {
    const rows = creditChanges([entry('kept', 500)], 'America/Detroit', 'Alex');
    expect(rows[0].text).toBe(`Nov 4: credit adjusted by organizer: +$5. ${REASON}`);
    expect(creditEntryText(entry('kept', 500), 'America/Detroit')).toBe('+$5 adjusted by organizer');
    expect(creditEntryText(entry('used', 500), 'America/Detroit')).toBe('-$5 adjusted by organizer');
  });
  it('R4 the player\'s own screen carries the adjustment (note included) and the same balance the organizer sees', async () => {
    const w = await world();
    await adjust(w, 'Blair', body('add', 1400, 0, 'Starting credit'));
    w.app.advance(HOUR);
    await adjust(w, 'Blair', body('add', 500, 1400));
    const blair = await playerPhone(w, 'Blair');
    const g = (await blair.call('GET', '/api/group')).data;
    expect(g.credit.balanceCents).toBe(1900);
    const last = g.credit.history[0];
    expect(last).toMatchObject({ kind: 'kept', cents: 500, reason: 'adjusted', note: REASON });
    expect(latestAdjustment(g.credit.history, Date.parse(g.now))).toMatchObject({ deltaCents: 500, note: REASON });
    // Never someone else's.
    const casey = (await (await playerPhone(w, 'Casey')).call('GET', '/api/group')).data;
    expect(casey.credit.history).toEqual([]);
  });
  it('R5 the potBalance helper counts adjusted rows like any other (also an adjustment row that is still waiting on nothing)', () => {
    const rows = [
      { id: 'a', playerId: 'p', kind: 'kept' as const, cents: 1400, fiveCents: 0, sessionId: null, createdAt: '1', endedAt: null, reason: 'adjusted' as const },
      { id: 'b', playerId: 'p', kind: 'used' as const, cents: 500, fiveCents: 0, sessionId: null, createdAt: '2', endedAt: null, reason: 'adjusted' as const },
    ];
    expect(potBalance(rows, 'p')).toBe(900);
  });
  it('R6 the history shows a day later, and 20 days later the pay-card note is gone but the history line stays', async () => {
    const w = await world();
    await adjust(w, 'Blair', body('add', 500, 0));
    const blair = await playerPhone(w, 'Blair');
    w.app.advance(20 * DAY);
    const g = (await blair.call('GET', '/api/group')).data;
    expect(latestAdjustment(g.credit.history, Date.parse(g.now))).toBeNull();
    expect(g.credit.history[0].reason).toBe('adjusted');
  });
});
