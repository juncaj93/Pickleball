// 🎾73.audit: The Cold Open's real settings on the real server code (tests/harness.ts), for the second dry run.
// Tue Dec 1 2026, 7:30 to 10 PM, 2 courts, $18 tickets, credits $0, Pay by Mon Nov 30 7:00 PM (the default), style "Let players vote" (Auto).
// The clock starts Fri Nov 20 2026, 12 PM Eastern. Alex is the organizer and plays ($0 seat).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { playerPhone, setupGroup, TestApp } from './harness';

export const DATE = '2026-12-01';
export const DATES = [DATE, '2026-12-08'];
export const FRI_NOON = Date.parse('2026-11-20T17:00:00.000Z');
export const PAY_BY_MS = Date.parse('2026-12-01T00:00:00.000Z'); // Mon Nov 30, 7:00 PM EST
export const CUTOFF_MS = Date.parse('2026-12-01T21:30:00.000Z'); // Tue Dec 1, 4:30 PM EST
export const START_MS = Date.parse('2026-12-02T00:30:00.000Z'); // Tue Dec 1, 7:30 PM EST
export const END_MS = Date.parse('2026-12-02T03:00:00.000Z'); // Tue Dec 1, 10:00 PM EST
export const MIN = 60_000;
export const HOUR = 60 * MIN;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
/** Alex (the organizer) first, then the others in sign-up order. */
export const ALL = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const LEVELS = [340, 360, 350, 320, 320, 300, 275, 250, 300, 340, 320, 300, 275, 250, 350, 360, 340, 320];
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const EXT_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-extension.sql'), 'utf8');

export type W = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

export async function coldOpen(opts: { visibility?: 'me' | 'all'; format?: 'vote' | 'doubles' | 'americano' } = {}): Promise<W> {
  const app = new TestApp();
  app.now = FRI_NOON;
  const base = await setupGroup(app);
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: DATES,
    ticketCents: 1800,
    creditCents: 0,
    secondCreditCents: 0,
    visibility: opts.visibility ?? 'all',
    format: opts.format ?? 'vote',
  });
  expect(created.status, created.text).toBe(200);
  return { ...base, byName, tid: created.data.id };
}

export const phone = (w: W, name: string) => playerPhone(w, name);
export async function signUp(w: W, name: string, dates = [DATE], vote: 'locked' | 'americano' | 'either' = 'either') {
  const i = ALL.indexOf(name);
  const r = await (await phone(w, name)).call('POST', '/api/tournament/signup', { tournamentId: w.tid, level: LEVELS[i % LEVELS.length], dates, formatVote: vote });
  expect(r.status, `${name} signup: ${r.text}`).toBe(200);
  return r;
}
export async function finalize(w: W, body: Record<string, unknown> = {}) {
  const r = await w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2, ...body });
  expect(r.status, r.text).toBe(200);
  return r.data;
}

/** A player's credit pot, to the cent (live ledger rows). */
export function pot(w: W, name: string): number {
  return Number(
    (
      w.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(w.byName[name]) as { c: number }
    ).c,
  );
}
export async function giveCredit(w: W, name: string, cents: number) {
  const r = await w.organizer.call('POST', `/api/admin/players/${w.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'Audit credit', seen: pot(w, name) });
  expect(r.status, r.text).toBe(200);
}
export const lock = async (w: W, name: string, priceCents = 1800) => (await phone(w, name)).call('POST', '/api/tournament/lock', { tournamentId: w.tid, intent: 'lock', priceCents });
export const iPaid = async (w: W, name: string, cents: number) => (await phone(w, name)).call('POST', '/api/tournament/paid', { tournamentId: w.tid, cents });
export const answer = (w: W, name: string, action: 'confirm' | 'reject' | 'mark_paid' | 'take_off', cents?: number) =>
  w.organizer.call('POST', `/api/admin/tournament/${w.tid}/ticket`, { playerId: w.byName[name], action, ...(cents === undefined ? {} : { cents }) });
export const backOut = async (w: W, name: string, body: Record<string, unknown> = {}) => (await phone(w, name)).call('POST', '/api/tournament/back-out', { tournamentId: w.tid, ...body });
export const dash = async (w: W) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
export const adminTour = async (w: W) => (await dash(w)).tournament;
export const group = async (w: W, name: string) => (await (await phone(w, name)).call('GET', '/api/group')).data;
export const card = async (w: W, name: string) => (await group(w, name)).tournament;
export const teams = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/teams`, body);
export const gamesA = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/games`, body);
export const awards = (w: W, body: Record<string, unknown>) => w.organizer.call('POST', `/api/admin/tournament/${w.tid}/awards`, body);
export const score = async (w: W, name: string, num: number, mine: number, theirs: number) =>
  (await phone(w, name)).call('POST', '/api/tournament/game', { tournamentId: w.tid, num, action: 'score', mine, theirs });

export const ticket = (w: W, name: string) =>
  w.app.db.raw.prepare('SELECT place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(w.tid, w.byName[name]) as
    | { place: string; price_cents: number; credit_cents: number; paid_cents: number; claim_cents: number }
    | undefined;
export const signupStatus = (w: W, name: string) =>
  (w.app.db.raw.prepare('SELECT status FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').get(w.tid, w.byName[name]) as { status: string } | undefined)?.status;

/** Every check file reads 0 (info_ columns are counts, not problems). Returns the non-zero columns instead of failing, so a test can print them. */
export function booksBad(w: W): Record<string, number> {
  const bad: Record<string, number> = {};
  for (const sql of [OLD_SQL, EXT_SQL, TOUR_SQL]) {
    const r = w.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_') && Number(v) !== 0) bad[k] = Number(v);
  }
  return bad;
}
export const books = (w: W) => expect(booksBad(w)).toEqual({});

/** Money totals of the tournament, to the cent: tickets (what is on them), credit used live, cash confirmed, credit granted. */
export function moneyTotals(w: W) {
  const r = w.app.db.raw;
  const tk = r.prepare('SELECT COALESCE(SUM(credit_cents),0) AS credit, COALESCE(SUM(paid_cents),0) AS paid, COALESCE(SUM(claim_cents),0) AS claim FROM tournament_tickets WHERE tournament_id = ?').get(w.tid) as Record<string, number>;
  const used = r.prepare("SELECT COALESCE(SUM(amount_cents),0) AS c FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND reason = ?").get(`tour:${w.tid}`) as { c: number };
  const granted = r.prepare("SELECT reason, COALESCE(SUM(amount_cents),0) AS c FROM credit_ledger WHERE kind = 'kept' AND reason LIKE ? GROUP BY reason ORDER BY reason").all(`tour:${w.tid}:%`) as { reason: string; c: number }[];
  return { ticketCredit: tk.credit, ticketPaid: tk.paid, ticketClaim: tk.claim, creditUsedLive: used.c, granted: Object.fromEntries(granted.map((g) => [g.reason.split(':').pop()!, g.c])) };
}
export const allPots = (w: W) => Object.fromEntries(Object.keys(w.byName).map((n) => [n, pot(w, n)]));
export const history = async (w: W) => (await w.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown>; text?: string }[];
