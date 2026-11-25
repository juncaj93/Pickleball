// Zip 58 (🎾58.tourney4): a tournament night on the real server code (the test harness), shared by the zip 58 tests. The clock starts Monday Oct 26,
// 2026, 12 PM Eastern. The tournament is Thu Nov 12, 7:30 to 10:00 PM; Pay by is Wed Nov 11, 7:00 PM (the night before). The same world as
// tests/zip57-day.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { asScore, withScore } from './zip72-taps';

export const DATE = '2026-11-12';
const DATES = ['2026-11-05', DATE, '2026-11-19'];
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
export const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
export const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z'); // Wed Nov 11, 7:00 PM EST
export const START_MS = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];

export type World = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

/** n players signed up and locked in (with credit), the date finalized, and the clock moved past Pay by. `organizerPlays`: Blair is the organizer. */
export async function world(
  n: number,
  opts: { courts?: 1 | 2; start?: number; minutes?: number; visibility?: 'me' | 'all'; format?: 'doubles' | 'americano'; organizer?: string; secondCents?: number } = {},
): Promise<World> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: opts.organizer ?? 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: DATES,
    ticketCents: 1600,
    creditCents: 1400,
    // Zip 82: Locked doubles pays 2nd place too now; the tournament page saved $0 for it before Zip 82, so the older Locked doubles nights keep
    // $0 unless asked. An Americano night (asked, or an odd count, which switches to it) keeps $7.
    secondCreditCents: opts.secondCents ?? ((opts.format ?? 'doubles') === 'americano' || n % 2 === 1 ? 700 : 0),
    visibility: opts.visibility ?? 'all',
    format: opts.format ?? 'doubles',
  });
  expect(created.status, created.text).toBe(200);
  const ctx: World = { ...base, byName, tid: created.data.id };
  const names = ALL.slice(0, n);
  for (const [i, name] of names.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: opts.start ?? 19 * 60 + 30, minutes: opts.minutes ?? 150, courts: opts.courts ?? 2 });
  expect(fin.status, fin.text).toBe(200);
  for (const name of names) await lockWithCredit(ctx, name, opts.organizer === name);
  ctx.app.now = PAY_BY_MS + 60_000;
  return ctx;
}

/** Credit given by the organizer's Adjust credit, then Lock my spot (credit first). The organizer's own seat is $0 (nothing to give). */
async function lockWithCredit(ctx: World, name: string, organizer: boolean) {
  if (!organizer) {
    const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen: potOf(ctx, name) });
    expect(give.status, give.text).toBe(200);
  }
  const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: organizer ? 0 : 1600 });
  expect(r.status, r.text).toBe(200);
}

/** A player's credit pot, to the cent, straight from the ledger (live rows only). */
export function potOf(ctx: World, name: string): number {
  return Number(
    (
      ctx.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
}

export const dash = async (ctx: World) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
export const adminTour = async (ctx: World) => (await dash(ctx)).tournament;
export const group = async (ctx: World, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
export const card = async (ctx: World, name: string) => (await group(ctx, name)).tournament;
export const teams = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, body);
/**
 * Zip 89 (Alex): on a night where nobody sits (8 players: 4 teams, or 8 Americano on 2 courts) the round after every 2nd round waits a 5 minute
 * break. A score these tests send at once for that round is refused ("not on a court yet"); on a real night the clock runs on: when, and only
 * when, a break is on, the clock moves to its end and the same call is sent again. Any other refusal is returned as it was.
 */
async function afterBreak<T extends { status: number; data: any }>(ctx: World, send: () => Promise<T>): Promise<T> {
  const r = await send();
  if (r.status !== 409 || r.data?.error !== 'not_yet') return r;
  const t = await adminTour(ctx);
  const b = (t?.day ?? t?.rounds)?.breakNow;
  if (!b) return r;
  ctx.app.now = Math.max(ctx.app.now, Date.parse(b.until) + 1000);
  return send();
}
export const games = (ctx: World, body: Record<string, unknown>) => afterBreak(ctx, () => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, withScore(body)));
export const awards = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/awards`, body);
export const play = async (ctx: World, name: string, num: number, action: string) => {
  const phone = await playerPhone(ctx, name);
  return afterBreak(ctx, () => phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, ...asScore(action) }));
};
export const spin = async (ctx: World, name: string, key: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/spin', { tournamentId: ctx.tid, key });

/** Every money check of the site and of tournaments reads zero. */
export function books(ctx: World) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(v), `${k} must be 0`).toBe(0);
  }
}

export async function draftAndPublish(ctx: World) {
  const d = await teams(ctx, { action: 'draft' });
  expect(d.status, d.text).toBe(200);
  const p = await teams(ctx, { action: 'publish' });
  expect(p.status, p.text).toBe(200);
}

/** The first player of the team in a seat. */
export async function playerOfSeat(ctx: World, seat: number, i = 0): Promise<string> {
  const t = (await adminTour(ctx)).day.teams.find((x: any) => x.seat === seat);
  return t.players[i].name;
}

/** Every pool game's result set by the organizer (Fix), the winner chosen by `win(seatA, seatB)`. */
export async function playPools(ctx: World, win: (a: number, b: number) => number) {
  const d = (await adminTour(ctx)).day;
  for (const g of d.games.filter((x: any) => x.stage === 'pool')) {
    const w = win(g.a.seat, g.b.seat);
    const r = await games(ctx, { action: 'result', num: g.num, winner: w === g.a.seat ? 'a' : 'b' });
    expect(r.status, r.text).toBe(200);
  }
}

/** Set a game's winner by seat (Fix). */
export async function setWinner(ctx: World, num: number, seat: number) {
  const g = (await adminTour(ctx)).day.games.find((x: any) => x.num === num);
  const r = await games(ctx, { action: 'result', num, winner: g.a?.seat === seat ? 'a' : 'b' });
  expect(r.status, r.text).toBe(200);
}
