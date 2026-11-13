import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHEAPER_FIX, cheaperFixAllowed } from '../shared/cheaperFix';
import { applyFinalize } from '../server/finalize';
import { splitSeatStatements } from '../server/credit';
import { makeCtx } from '../server/context';
import { getGroup, getSession } from '../server/repo';
import { withShortGames } from '../server/zip9';
import { HOUR, ORIGIN, playerPhone, setupGroup } from './harness';
import { buildWorld, flipPriceRules, moneyDump, settledPart } from './zip27-world';

vi.setConfig({ testTimeout: 120_000 });

const MAIN_DUMP = JSON.parse(readFileSync(pjoin(process.cwd(), 'tests/fixtures/zip27-main-dump.json'), 'utf8'));
const INTEGRITY = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

type W = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group(switches: string[] = ['short-games-switch', 'late-fees'], fix = true) {
  const w = await setupGroup();
  for (const name of MORE) await w.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${MORE.indexOf(name)}0` });
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const sw of [...switches, ...(fix ? ['cheaper-fix-switch'] : [])]) expect((await w.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status, sw).toBe(200);
  const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  w.byName = Object.fromEntries(d.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  w.app.now = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern
  return w;
}
const dash = async (w: W) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
const game = async (w: W, id: string) => (await dash(w)).sessions.find((s: { id: string }) => s.id === id);
const seat = async (w: W, id: string, name: string) => (await game(w, id)).roster.find((r: { name: string }) => r.name === name);
const pot = async (w: W, name: string) => (await dash(w)).creditLedger.find((l: { playerId: string }) => l.playerId === w.byName[name])?.balanceCents ?? 0;
const phones = new WeakMap<W, Record<string, Awaited<ReturnType<typeof playerPhone>>>>();
async function phone(w: W, name: string) {
  const all = phones.get(w) ?? {};
  phones.set(w, all);
  all[name] ??= await playerPhone(w, name);
  return all[name];
}
const owedOf = async (w: W, name: string, id: string) => ((await (await phone(w, name)).call('GET', '/api/group')).data.owed.find((o: { sessionId: string }) => o.sessionId === id)?.amountCents ?? 0);
async function addGame(w: W, day: string, minutes: number): Promise<{ id: string; start: number }> {
  const startsAt = `${day}T22:00:00.000Z`;
  const res = await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(), note: null });
  expect(res.status, res.text).toBe(200);
  return { id: res.data.id, start: Date.parse(startsAt) };
}
async function joinAll(w: W, id: string, names: string[]) {
  for (const n of names) expect((await (await phone(w, n)).call('POST', `/api/sessions/${id}/join`, {})).status, n).toBe(200);
}
async function pay(w: W, id: string, names: string[]) {
  for (const n of names) expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName[n], paid: true })).status).toBe(200);
}
async function setLength(w: W, id: string, start: number, minutes: number) {
  const r = await w.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + minutes * 60_000).toISOString() });
  expect(r.status, r.text).toBe(200);
}
const lateCancel = async (w: W, id: string) =>
  expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false })).status).toBe(200);
function health(w: W) {
  const sql = INTEGRITY.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = (w.app.db as any).raw.prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && n !== 0));
}
const collected = async (w: W, g: { start: number }) =>
  (await w.organizer.call('GET', '/api/admin/money?month=2026-11')).data.sessions.find((s: { startsAt: string }) => s.startsAt === new Date(g.start).toISOString()).collectedCents;
/** Every player's pot plus every Totals month's collected and held: nothing lost, nothing created, whatever the path. */
async function books(w: W) {
  const d = await dash(w);
  const pots = d.creditLedger.reduce((s: number, l: { balanceCents: number }) => s + l.balanceCents, 0);
  let kept = 0;
  for (const m of ['2026-10', '2026-11']) {
    const r = (await w.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
    kept += r.collectedCents + r.heldCents;
  }
  return { pots, kept, total: pots + kept };
}

// ---------- The switch ----------


const audits = (w: W, action: string) => ((w.app.db as any).raw.prepare('SELECT details_json FROM admin_audit_log WHERE action = ? ORDER BY created_at').all(action) as { details_json: string }[]).map((r) => JSON.parse(r.details_json));

describe('probe', () => {
  it('A: drop trim on credit-paid seat: response and audit', async () => {
    const w = await group();
    const old = await addGame(w, '2026-11-11', 120);
    await joinAll(w, old.id, ['Blair']);
    await pay(w, old.id, ['Blair']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${old.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    const g = await addGame(w, '2026-11-10', 120);
    await joinAll(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await pay(w, g.id, ['Casey', 'Devon', 'Emery']);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    const before = await books(w);
    const r = await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {});
    console.log('A response', JSON.stringify(r.data), 'pot', await pot(w, 'Blair'));
    console.log('A books', before.total, (await books(w)).total);
  });
  it('B: drop trim on cash seat: credit_back audit', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    const r = await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {});
    console.log('B response', JSON.stringify(r.data), 'pot', await pot(w, 'Blair'), 'audits', JSON.stringify(audits(w, 'credit_back')));
  });
  it('C: claim confirmed after cancel trim', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, ['Casey', 'Devon', 'Emery']);
    expect((await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    await lateCancel(w, g.id);
    const m = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: true });
    const s = await seat(w, g.id, 'Blair');
    console.log('C markpaid', m.status, 'Blair seat', s.paymentAmountCents, 'pot', await pot(w, 'Blair'), 'Casey', (await seat(w, g.id, 'Casey')).paymentAmountCents, 'collected', await collected(w, g));
  });
  it('D: unmark after drop trim (cash never received)', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    w.app.now = g.start - 3 * HOUR;
    const before = await books(w);
    expect((await (await phone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    const u = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Blair, paid: false });
    console.log('D unmark', u.status, u.text.slice(0, 200), 'pot', await pot(w, 'Blair'), 'books', before.total, (await books(w)).total, 'health', JSON.stringify(health(w)));
  });
  it('E: no-show finalize trim, Clear, Reopen', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    const before = await books(w);
    w.app.now = g.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) })).status).toBe(200);
    const c = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/late-fee`, { playerId: w.byName.Emery, why: 'choice' });
    console.log('E clear', c.status, 'pot', await pot(w, 'Emery'), 'books', before.total, (await books(w)).total, JSON.stringify(health(w)));
    const ro = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/reopen`, {});
    console.log('E reopen', ro.status, 'pot', await pot(w, 'Emery'), 'seat', JSON.stringify(await seat(w, g.id, 'Emery')).slice(0, 300), 'books', (await books(w)).total, JSON.stringify(health(w)));
    w.app.now += 60_000;
    const f2 = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) });
    console.log('E refinalize', f2.status, 'pot', await pot(w, 'Emery'), 'books', (await books(w)).total, JSON.stringify(health(w)));
  });
  it('F: unmark no-show after finalize trim', async () => {
    const w = await group();
    const g = await addGame(w, '2026-11-10', 120);
    const four = ['Blair', 'Casey', 'Devon', 'Emery'];
    await joinAll(w, g.id, four);
    await pay(w, g.id, four);
    await setLength(w, g.id, g.start, 90);
    const before = await books(w);
    w.app.now = g.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { played: ['Blair', 'Casey', 'Devon'].map((n) => w.byName[n]) })).status).toBe(200);
    const u = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: w.byName.Emery, paid: false });
    console.log('F unmark', u.status, 'pot', await pot(w, 'Emery'), 'books', before.total, (await books(w)).total, JSON.stringify(health(w)));
  });
});
