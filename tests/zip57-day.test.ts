import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { asScore, withScore } from './zip72-taps';
import { nightPlan } from '../shared/tournamentPlan';

// Zip 57 (🎾57.tourney3): teams, the schedule and game day on the real server code (the test harness). The clock starts Monday Oct 26, 2026,
// 12 PM Eastern. The tournament is Thu Nov 12, 7:30 to 10:00 PM; Pay by is Wed Nov 11, 7:00 PM (the night before).

const DATE = '2026-11-12';
const DATES = ['2026-11-05', DATE, '2026-11-19'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all', format: 'doubles' };
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z'); // Wed Nov 11, 7:00 PM EST
const START_MS = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

/** n players signed up and locked in (with credit), the date finalized (courts, Plays), and the clock moved past Pay by. */
async function world(n: number, opts: { courts?: 1 | 2; start?: number; minutes?: number; visibility?: 'me' | 'all'; passPayBy?: boolean } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, visibility: opts.visibility ?? 'all' });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id };
  const names = ALL.slice(0, n);
  for (const [i, name] of names.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  // Zip 89 (Alex, "build in what fits"): 8 players (4 teams: the round robin, then the Final, as these tests expect) is a 2 hour night here; on
  // 2.5 hours the plan builds in the semifinals.
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: opts.start ?? 19 * 60 + 30, minutes: opts.minutes ?? (n === 8 ? 120 : 150), courts: opts.courts ?? 2 });
  expect(fin.status, fin.text).toBe(200);
  for (const name of names) await lockWithCredit(ctx, name);
  if (opts.passPayBy !== false) ctx.app.now = PAY_BY_MS + 60_000;
  return ctx;
}

async function lockWithCredit(ctx: Ctx, name: string) {
  const seen = Number(
    (
      ctx.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
  const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen });
  expect(give.status, give.text).toBe(200);
  const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
  expect(r.status, r.text).toBe(200);
  expect(r.data.result).toBe('locked');
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const teams = (ctx: Ctx, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, body);
const games = (ctx: Ctx, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, withScore(body));
const play = async (ctx: Ctx, name: string, num: number, action: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, ...asScore(action) });
function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}
const moneyRows = (ctx: Ctx) => JSON.stringify([ctx.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY rowid').all(), ctx.app.db.raw.prepare('SELECT * FROM tournament_tickets ORDER BY rowid').all()]);

async function draftAndPublish(ctx: Ctx) {
  const d = await teams(ctx, { action: 'draft' });
  expect(d.status, d.text).toBe(200);
  const p = await teams(ctx, { action: 'publish' });
  expect(p.status, p.text).toBe(200);
}

describe('zip 57: Finalize has Courts, saved in the courts field; the plan line and the close check follow it', () => {
  it('Courts 1 is saved; the organizer card plans on 1 court with the real hours; Finalize starts on it again', async () => {
    const ctx = await world(6, { courts: 1, passPayBy: false });
    expect((ctx.app.db.raw.prepare('SELECT courts FROM tournaments WHERE id = ?').get(ctx.tid) as { courts: number }).courts).toBe(1);
    const d = await dash(ctx);
    expect([d.courts, d.minutes, d.chosenCourts]).toEqual([1, 150, 1]);
    // A bad value is refused.
    const bad = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, courts: 3 });
    expect(bad.status).toBe(409); // tickets are open: the date step is closed anyway
  });
  it('when tickets close: too tight (12 on 1 court, 2 hours), a court no longer needed (6 on 2 courts), under 6', async () => {
    const tight = await world(12, { courts: 1, start: 19 * 60 + 30, minutes: 120 });
    // Zip 92: 12 locked in plays Americano (shared/tournament.ts playsAmericano), so the check names the style really played.
    expect((await dash(tight)).closeCheck).toEqual({ kind: 'tight', text: 'Americano for 12: too tight on 1 court. Use 2 courts or add court time.' });
    const extra = await world(6, { courts: 2 });
    expect((await dash(extra)).closeCheck).toEqual({ kind: 'extra_court', text: '6 locked in: 1 court is enough. Call the venue to cancel court 2.' });
    const few = await world(4, { courts: 1 });
    expect((await dash(few)).closeCheck).toMatchObject({ kind: 'few', text: 'Only 4 locked in. Cancel or reschedule?' });
    // Before Pay by: no check yet.
    const early = await world(6, { courts: 2, passPayBy: false });
    expect((await dash(early)).closeCheck).toBeNull();
  });
});

describe('zip 57: draft, swap, name, publish', () => {
  it('8 locked in: Draft teams pairs strongest with weakest; players see nothing until Publish; no money moves', async () => {
    const ctx = await world(8);
    const before = moneyRows(ctx);
    expect((await dash(ctx)).day).toMatchObject({ phase: 'none', canDraft: true, lockedIn: 8 });
    expect((await teams(ctx, { action: 'draft' })).status).toBe(200);
    const d = (await dash(ctx)).day;
    expect(d.phase).toBe('draft');
    expect(d.teams.map((x: any) => x.players.map((p: any) => p.name).join('+'))).toEqual(['Blair+Indy', 'Casey+Harper', 'Devon+Gale', expect.stringMatching(/Emery\+Frankie|Frankie\+Emery/)]);
    expect(d.teams.map((x: any) => x.total)).toEqual([610, 625, 640, 640]);
    expect(d.teams.map((x: any) => x.name)).toEqual(['Net Ninjas', 'Dill With It', 'Kitchen Crew', 'Third Shot Gang']);
    // Not published: a player gets no teams at all.
    const c = await card(ctx, 'Blair');
    expect(c.day).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('Net Ninjas');
    // Swap Indy and Harper.
    const sw = await teams(ctx, { action: 'swap', a: ctx.byName.Indy, b: ctx.byName.Harper });
    expect(sw.status, sw.text).toBe(200);
    const d2 = (await dash(ctx)).day;
    expect(d2.teams[0].players.map((p: any) => p.name)).toEqual(['Blair', 'Harper']);
    expect(d2.teams[0].total).toBe(360 + 275);
    // A name typed by the organizer.
    expect((await teams(ctx, { action: 'rename', teamId: d2.teams[0].id, name: 'Blair Force' })).status).toBe(200);
    expect((await teams(ctx, { action: 'rename', teamId: d2.teams[1].id, name: 'blair force' })).status).toBe(400);
    expect((await teams(ctx, { action: 'publish' })).status).toBe(200);
    const pub = (await dash(ctx)).day;
    expect(pub.phase).toBe('published');
    expect(pub.games).toHaveLength(8); // 6 round robin games, the Final and the 3rd place game
    expect(pub.games.map((g: any) => g.playTo)).toEqual([11, 11, 11, 11, 11, 11, 11, 11]);
    const me = (await card(ctx, 'Blair')).day;
    expect(me.team).toMatchObject({ name: 'Blair Force', players: ['Blair', 'Harper'] });
    expect(me.games.filter((g: any) => g.stage === 'pool')).toHaveLength(3);
    // Only their own games: every game listed has them in it (or is the Final they may reach).
    expect(me.games.map((g: any) => g.label)).toEqual(['Game 1', 'Game 2', 'Game 3', 'Final']);
    expect(me.games[3]).toMatchObject({ opponent: null, pending: 'If you finish in the top 2' });
    // Names only: no levels, phones or money of anyone in the player answer.
    const text = JSON.stringify(me);
    expect(text).not.toMatch(/level|360|phone|cents|555-/i);
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });
  it('Draft teams waits for Pay by, needs Locked doubles and an even number of 6 or more', async () => {
    const early = await world(8, { passPayBy: false });
    expect((await dash(early)).day).toMatchObject({ canDraft: false, why: 'Draft teams opens when tickets close (Pay by).' });
    expect((await teams(early, { action: 'draft' })).status).toBe(409);
    // 7 locked in: the style switches to Americano (zip 64) and there are no teams.
    const odd = await world(7);
    const d = await dash(odd);
    expect(d.format).toBe('americano');
    expect(d.day).toMatchObject({ canDraft: false, why: 'Americano night: no teams.' });
  });
});

describe('zip 57: every size 6 to 16, odd and even, with back outs', () => {
  for (const n of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    it(`${n} locked in`, async () => {
      const ctx = await world(n, { courts: n <= 7 ? 1 : 2, start: n >= 12 ? 19 * 60 : 19 * 60 + 30, minutes: n >= 12 ? 180 : 150 });
      const d = await dash(ctx);
      // Zip 92: 12 and 14 play Americano too, exactly like an odd count (pools with a group of three gave those teams 2 regular games). Zip 97:
      // and 6 (3 teams gave 2 regular games each).
      if (n % 2 === 1 || n === 6 || n === 12 || n === 14) {
        expect(d.format).toBe('americano');
        expect(d.day.canDraft).toBe(false);
        // The players hear it from zip 64's banner; no teams reach them. Zip 61: their Americano rounds do (on purpose).
        const c = await card(ctx, 'Blair');
        const day = c.day;
        expect(day.kind).toBe('americano');
        expect(day.team).toBeUndefined();
        if (n % 2 === 0) {
          // Zip 92: switched at the first read after Pay by: the organizer's switched card, the players' banner, Draft refused, the Americano plan.
          expect(d.oddSwitch).toBeTruthy();
          expect(d.day.why).toBe('Americano night: no teams.');
          expect(c.styleNote?.text).toBe('Tournament style is now Americano.');
          expect((await teams(ctx, { action: 'draft' })).status).toBe(409);
          // Zip 97: the night's own courts and time (6 is on 1 court, 2.5 hours; 12 and 14 on 2 courts, 3 hours).
          expect(Math.max(...d.rounds.games.map((g: any) => g.round))).toBe(nightPlan(n, n <= 7 ? 1 : 2, n >= 12 ? 180 : 150, 'americano').rounds);
        }
        return;
      }
      await draftAndPublish(ctx);
      const day = (await dash(ctx)).day;
      expect(day.teams).toHaveLength(n / 2);
      expect(day.teams.flatMap((x: any) => x.players.map((p: any) => p.name)).sort()).toEqual(ALL.slice(0, n).sort());
      // Pools from 12 (Zip 92: on a real night only 16 now): Pool A first, each a pool.
      if (n >= 12) expect(new Set(day.teams.map((x: any) => x.pool))).toEqual(new Set(['A', 'B']));
      // Every player sees their own team and only games with their team in them.
      for (const name of ALL.slice(0, n)) {
        const v = (await card(ctx, name)).day;
        expect(v.team.players).toContain(name);
        for (const g of v.games.filter((x: any) => x.opponent)) expect(v.teams.find((x: any) => x.me).name).not.toBe(g.opponent.name);
      }
    });
  }
  it('back outs after publishing: a whole team leaving keeps Locked doubles with one fewer team; two left-over players are paired', async () => {
    // Zip 89: a 2 hour night (on 2.5 hours more playoff games would be built in).
    const ctx = await world(10, { minutes: 120 });
    await draftAndPublish(ctx);
    const t0 = (await dash(ctx)).day.teams;
    // One player of team 1 and one of team 2 back out (before the night): the count stays even.
    const a = t0[0].players[1].name;
    const b = t0[1].players[1].name;
    for (const name of [a, b]) {
      const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
      expect(r.status, r.text).toBe(200);
      // 9 locked in after the first back out: the first screen that reads it switches the style to Americano (zip 64).
      if (name === a) expect((await dash(ctx)).format).toBe('americano');
    }
    // Even again: the organizer switches back (never by itself).
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {})).status).toBe(200);
    const d = (await dash(ctx)).day;
    expect(d.fix?.text).toContain('not locked in now');
    const fixed = await teams(ctx, { action: 'fix' });
    expect(fixed.status, fixed.text).toBe(200);
    const after = (await dash(ctx)).day;
    expect(after.teams).toHaveLength(4);
    expect(after.fix).toBeNull();
    // The two left-over partners now play together, and each is told.
    const left = [t0[0].players[0].name, t0[1].players[0].name];
    const pair = after.teams.find((x: any) => x.players.some((p: any) => p.name === left[0]));
    expect(pair.players.map((p: any) => p.name).sort()).toEqual(left.sort());
    expect((await card(ctx, left[0])).day.partnerNote.text).toBe(`Your new partner is ${left[1]}.`);
    // A whole team leaves: one fewer team, still Locked doubles. Zip 97: 6 locked in plays Americano now (AMERICANO_EVEN), so 4 teams going
    // to 3 would switch the night; this part is a fresh 10 player night instead: 5 teams going to 4 (was 4 teams going to 3, above).
    const whole = await world(10, { minutes: 120 });
    await draftAndPublish(whole);
    const five = (await dash(whole)).day.teams;
    expect(five).toHaveLength(5);
    for (const p of five[4].players) await (await playerPhone(whole, p.name)).call('POST', '/api/tournament/back-out', { tournamentId: whole.tid });
    expect((await whole.organizer.call('POST', `/api/admin/tournament/${whole.tid}/switch-back`, {})).status).toBe(200);
    expect((await teams(whole, { action: 'fix' })).status).toBe(200);
    const four = (await dash(whole)).day;
    expect(four.teams).toHaveLength(4);
    // 4 teams on 2 hours: 3 round robin rounds (6 games), the Final and 3rd place.
    expect(four.games.map((g: any) => g.stage)).toEqual(['pool', 'pool', 'pool', 'pool', 'pool', 'pool', 'final', 'third']);
    expect((await dash(whole)).format).toBe('doubles');
  });
});

describe('zip 57: game night', () => {
  async function night() {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const d = (await dash(ctx)).day;
    const g1 = d.games[0];
    const nameA = d.teams.find((x: any) => x.seat === g1.a.seat).players[0].name;
    const nameB = d.teams.find((x: any) => x.seat === g1.b.seat).players[0].name;
    return { ctx, g1, nameA, nameB };
  }
  it('We won is the result at once (zip 71: no confirming); standings 1-0; the other team sees it, nothing to answer', async () => {
    const { ctx, g1, nameA, nameB } = await night();
    const before = moneyRows(ctx);
    // A player not in the game cannot answer it.
    const outsider = (await dash(ctx)).day.teams.find((x: any) => x.seat !== g1.a.seat && x.seat !== g1.b.seat).players[0].name;
    expect((await play(ctx, outsider, g1.num, 'won')).status).toBe(409);
    expect((await play(ctx, nameA, g1.num, 'won')).status).toBe(200);
    const mine = (await card(ctx, nameA)).day;
    expect(mine.games[0]).toMatchObject({ state: 'done', won: true });
    expect(mine.standings[0].rows[0]).toMatchObject({ record: '1-0', me: true });
    const theirs = (await card(ctx, nameB)).day;
    expect(theirs.games[0]).toMatchObject({ state: 'done', won: false });
    expect(theirs.games[0].askConfirm).toBeUndefined();
    const g = (await dash(ctx)).day.games[0];
    expect([g.winner, g.resultBy]).toEqual(['a', 'players']);
    // Nothing to confirm, and Undo after the 5 seconds is gone (only the organizer changes it).
    expect((await play(ctx, nameB, g1.num, 'confirm')).status).toBe(409);
    expect((await play(ctx, nameA, g1.num, 'undo')).status).toBe(409);
    expect(moneyRows(ctx)).toBe(before);
  });
  it('the organizer Fix changes any result, and can clear it', async () => {
    const { ctx, g1, nameA } = await night();
    await play(ctx, nameA, g1.num, 'won');
    expect((await games(ctx, { action: 'result', num: g1.num, winner: 'b' })).status).toBe(200);
    const g = (await dash(ctx)).day.games[0];
    expect([g.winner, g.scoreA, g.scoreB, g.resultBy]).toEqual(['b', 7, 11, 'organizer']);
    expect((await card(ctx, nameA)).day.standings[0].rows.find((r: any) => r.me).record).toBe('0-1');
    expect((await games(ctx, { action: 'result', num: g1.num, winner: null })).status).toBe(200);
    expect((await dash(ctx)).day.games[0].winner).toBeNull();
  });
  it('the losing team can be first and say the other team won', async () => {
    const { ctx, g1, nameB } = await night();
    expect((await play(ctx, nameB, g1.num, 'lost')).status).toBe(200);
    expect((await dash(ctx)).day.games[0].winner).toBe('a');
  });
  it('results wait for the night (15 minutes before the start)', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    const d = (await dash(ctx)).day;
    const name = d.teams.find((x: any) => x.seat === d.games[0].a.seat).players[0].name;
    expect((await play(ctx, name, d.games[0].num, 'won')).status).toBe(409);
  });
  it('the Time check: late, it suggests shorter pool games; Apply plays them to 9 or 7; players see the words', async () => {
    // Zip 92: 16 players (12 plays Americano now), 7:00 to 10:30 PM on 2 courts: two groups of 4, 6 pool rounds to 11, the semifinals, then the
    // Final and 3rd place. Zip 97: 10 warm-up + 6 x 17 + 2 x 20 = 152 minutes, done 9:32 PM (was 160, 9:50), the limit 10:10 PM.
    const ctx = await world(16, { start: 19 * 60, minutes: 210 });
    const start = START_MS - 30 * 60_000;
    await draftAndPublish(ctx);
    // Round 1 ends at 7:40 PM, 13 minutes late (Zip 97: due at 7:27 PM after the warm-up, was 7:30). Zip 92: a slow night eases into its pace,
    // a third of the way after Round 1. Zip 97: from the table's 17, 17 + 13 / 3 = 21.3 a round to 11 (a playoff round 20 x 21.3 / 17 = 25.1):
    // about 45 behind (was 33), the night ends about 10:17 PM, 7 past the limit. Round 2 is already on the courts (never shortened); to 9 from
    // Round 6 saves about 4 (not enough), from Round 5 about 7.5 (was from Round 4).
    ctx.app.now = start + (10 + 20 + 10) * 60_000;
    const d = (await dash(ctx)).day;
    for (const g of d.games.filter((x: any) => x.round === 1)) expect((await games(ctx, { action: 'result', num: g.num, winner: 'a' })).status).toBe(200);
    const tc = (await dash(ctx)).day.timeCheck;
    expect(tc).toMatchObject({ fromRound: 5, to: 9 });
    expect(tc.text).toBe('Running about 45 minutes behind. From Round 5 on, play to 9 so we finish on time.');
    expect((await games(ctx, { action: 'apply', fromRound: tc.fromRound, to: tc.to })).status).toBe(200);
    const after = (await dash(ctx)).day;
    // Zip 97: from Round 5 (was 4).
    expect(after.games.filter((g: any) => g.stage === 'pool' && g.round >= 5).every((g: any) => g.playTo === 9)).toBe(true);
    expect(after.games.filter((g: any) => g.stage === 'pool' && g.round < 5).every((g: any) => g.playTo === 11)).toBe(true);
    expect(after.games.filter((g: any) => g.stage !== 'pool').every((g: any) => g.playTo === 11)).toBe(true);
    const anyone = after.teams[0].players[0].name;
    expect((await card(ctx, anyone)).day.timeNote).toMatch(/From Round 5 on, play to 9/);
  });
  it('Pause shows the players; Player left: swap in, or the team sits out (its later games skipped)', async () => {
    const { ctx } = await night();
    expect((await games(ctx, { action: 'pause' })).status).toBe(200);
    const anyone = (await dash(ctx)).day.teams[0].players[0].name;
    expect((await card(ctx, anyone)).day.paused).toBe(true);
    expect((await games(ctx, { action: 'resume' })).status).toBe(200);
    const team = (await dash(ctx)).day.teams[2];
    const r = await games(ctx, { action: 'left', playerId: team.players[0].id });
    expect(r.status, r.text).toBe(200);
    const d = (await dash(ctx)).day;
    expect(d.teams[2].out).toBe(true);
    expect(d.games.filter((g: any) => g.skipped).length).toBe(r.data.skipped);
    expect(r.data.skipped).toBeGreaterThan(0);
  });
});

describe('zip 57: who may see it', () => {
  it('switched off: a player gets no tournament, no team, no game; the player route answers not open', async () => {
    const open = await world(8);
    await draftAndPublish(open);
    const raw = async (name: string) => (await (await playerPhone(open, name)).call('GET', '/api/group')).text;
    expect(await raw('Blair')).toContain('Net Ninjas');
    expect((await open.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const off = await raw('Blair');
    expect(JSON.parse(off).tournament).toBeUndefined();
    expect(off).not.toContain('Net Ninjas');
    expect((await play(open, 'Blair', 1, 'won')).status).toBe(404);
    // The organizer routes are refused too.
    expect((await teams(open, { action: 'draft' })).status).toBe(403);
    expect((await games(open, { action: 'pause' })).status).toBe(403);
  });
  it('a player not on any team (not locked in) sees the teams but no games of their own', async () => {
    const ctx = await world(8);
    // Kai signs up late and does not pay: on the list, on no team.
    const r = await (await playerPhone(ctx, 'Kai')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 300, dates: [DATE] });
    expect(r.status, r.text).toBe(200);
    await draftAndPublish(ctx);
    const v = (await card(ctx, 'Kai')).day;
    expect(v.team).toBeNull();
    expect(v.games).toEqual([]);
    expect(v.teams).toHaveLength(4);
  });
});

describe('zip 57: the review fixes (playoffs after a team leaves or a result changes, stale taps)', () => {
  /** 16 locked in (Zip 92: 12 plays Americano now), published, the night on, every pool game won by the lower seat. */
  async function poolsDone() {
    const ctx = await world(16, { start: 19 * 60 + 30, minutes: 150 });
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const d = (await dash(ctx)).day;
    for (const g of d.games.filter((x: any) => x.stage === 'pool')) expect((await games(ctx, { action: 'result', num: g.num, winner: g.a.seat < g.b.seat ? 'a' : 'b' })).status).toBe(200);
    return ctx;
  }
  it('a played semifinal keeps its teams when a pool result is changed later', async () => {
    const ctx = await poolsDone();
    const semi = (await dash(ctx)).day.games.find((g: any) => g.stage === 'semi');
    expect((await games(ctx, { action: 'result', num: semi.num, winner: 'a' })).status).toBe(200);
    const poolGame = (await dash(ctx)).day.games.find((g: any) => g.stage === 'pool' && g.pool === 'A');
    expect((await games(ctx, { action: 'result', num: poolGame.num, winner: poolGame.winner === 'a' ? 'b' : 'a' })).status).toBe(200);
    const after = (await dash(ctx)).day.games.find((g: any) => g.num === semi.num);
    expect([after.a.seat, after.b.seat, after.winner]).toEqual([semi.a.seat, semi.b.seat, 'a']);
  });
  it('a team that leaves after pool play: its semifinal is a walkover and the Final still fills', async () => {
    const ctx = await poolsDone();
    const d = (await dash(ctx)).day;
    const semi = d.games.find((g: any) => g.stage === 'semi');
    const leaving = d.teams.find((x: any) => x.seat === semi.a.seat);
    expect((await games(ctx, { action: 'left', playerId: leaving.players[0].id })).status).toBe(200);
    const other = d.games.find((g: any) => g.stage === 'semi' && g.num !== semi.num);
    expect((await games(ctx, { action: 'result', num: other.num, winner: 'a' })).status).toBe(200);
    const fin = (await dash(ctx)).day.games.find((g: any) => g.stage === 'final');
    expect([fin.a?.seat, fin.b?.seat]).toEqual([semi.b.seat, other.a.seat]);
    // Nothing is left waiting forever: the 3rd place game (one side never comes) counts as not played.
    expect((await dash(ctx)).day.games.find((g: any) => g.stage === 'third').skipped).toBe(true);
  });
  it('the organizer Fix sends what it saw: a change in between does nothing ("look again")', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const d = (await dash(ctx)).day;
    const g = d.games[0];
    const a = d.teams.find((x: any) => x.seat === g.a.seat).players[0].name;
    const b = d.teams.find((x: any) => x.seat === g.b.seat).players[0].name;
    void b;
    await play(ctx, a, g.num, 'won');
    // Zip 71, no confirming: A's We won is the result. The organizer's screen showed "A won"; meanwhile it was fixed to B (another tap).
    expect((await games(ctx, { action: 'result', num: g.num, winner: 'b', seen: { winner: 'a', scoreA: 11, scoreB: 7 } })).status).toBe(200);
    expect((await games(ctx, { action: 'result', num: g.num, winner: null, seen: { winner: 'a', scoreA: 11, scoreB: 7 } })).status).toBe(409);
    expect((await dash(ctx)).day.games[0].winner).toBe('b');
  });
  it('zip 71: a second answer is refused even when it agrees (the first one is the result)', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const d = (await dash(ctx)).day;
    const g = d.games[0];
    const a = d.teams.find((x: any) => x.seat === g.a.seat).players[0].name;
    const b = d.teams.find((x: any) => x.seat === g.b.seat).players[0].name;
    expect((await play(ctx, b, g.num, 'lost')).status).toBe(200);
    const r = await play(ctx, a, g.num, 'won');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`${b} entered`);
    expect((await play(ctx, b, g.num, 'lost')).status).toBe(200);
  });
  it('the plan check card can change the courts (before the teams are published)', async () => {
    // Zip 97: 6 locked in plays Americano now (AMERICANO_EVEN): the card still shows at 6 (1 court is enough) and changes the courts, but 6 has
    // no teams to publish, so "never after the teams are published" is an 8 player Locked doubles night below (was the same 6 player night).
    const ctx = await world(6, { courts: 2 });
    expect((await dash(ctx)).closeCheck.kind).toBe('extra_court');
    expect((await teams(ctx, { action: 'count', courts: 1 })).status).toBe(200);
    const d = await dash(ctx);
    expect([d.courts, d.closeCheck]).toEqual([1, null]);
    const eight = await world(8, { courts: 2 });
    await draftAndPublish(eight);
    expect((await teams(eight, { action: 'count', courts: 1 })).status).toBe(409);
  });
});

describe("zip 57: Alex's PM notes (team names by the players, the live window, never a level)", () => {
  it('either partner names the team (pencil) or rolls the dice until Game 1; names stay unique; the organizer renames any time', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    const d = (await dash(ctx)).day;
    const [a, b] = d.teams[0].players.map((p: any) => p.name);
    const other = d.teams[1].name;
    const name = (body: Record<string, unknown>, who = a) => playerPhone(ctx, who).then((c) => c.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, ...body }));
    expect((await card(ctx, a)).day.team).toMatchObject({ canRename: true });
    expect((await name({ name: 'Blair Force' })).data.name).toBe('Blair Force');
    // The partner sees it at once, and the last save wins.
    expect((await card(ctx, b)).day.team.name).toBe('Blair Force');
    expect((await name({ name: 'Dink Dynamos' }, b)).status).toBe(200);
    expect((await card(ctx, a)).day.team.name).toBe('Dink Dynamos');
    // Another team's name, any case: refused. Too long: refused.
    expect((await name({ name: other.toUpperCase() })).status).toBe(409);
    expect((await name({ name: 'x'.repeat(25) })).status).toBe(400);
    // The dice: a new suggestion nobody has.
    const rolled = (await name({})).data.name;
    expect(rolled).not.toBe('Dink Dynamos');
    expect((await dash(ctx)).day.teams.filter((x: any) => x.name.toLowerCase() === rolled.toLowerCase())).toHaveLength(1);
    // A player on another team cannot rename this one (only their own).
    const outsider = d.teams[1].players[0].name;
    expect((await name({ name: 'Mine Now' }, outsider)).status).toBe(200);
    expect((await dash(ctx)).day.teams[0].name).toBe(rolled);
    // Zip 88: from the team's first score on (no longer the start): no pencil or dice, and the server refuses; the organizer still renames.
    ctx.app.now = START_MS + 60_000;
    expect((await card(ctx, a)).day.team.canRename).toBe(true);
    const g1 = (await card(ctx, a)).day.games.find((g: any) => g.onNow);
    expect((await playerPhone(ctx, a).then((c) => c.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g1.num, action: 'score', mine: 11, theirs: 5 }))).status).toBe(200);
    expect((await card(ctx, a)).day.team.canRename).toBeUndefined();
    expect((await name({ name: 'Too Late' })).status).toBe(409);
    expect((await teams(ctx, { action: 'rename', teamId: d.teams[0].id, name: 'Late Bloomers' })).status).toBe(200);
    expect((await card(ctx, b)).day.team.name).toBe('Late Bloomers');
    // Every team name shows with its two players.
    const v = (await card(ctx, a)).day;
    expect(v.standings[0].rows.every((r: any) => Array.isArray(r.players) && r.players.length === 2)).toBe(true);
    const hist = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string }[];
    expect(hist.some((e) => e.action === 'tournament_team_named')).toBe(true);
  });
  it('the live window: from 30 minutes before the start the live view (and the folded Home); not before', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS - 31 * 60_000;
    expect((await card(ctx, 'Blair')).day.today).toBe(false);
    ctx.app.now = START_MS - 29 * 60_000;
    expect((await card(ctx, 'Blair')).day.today).toBe(true);
    // The next day, Home is back to normal.
    ctx.app.now = START_MS + 24 * 3_600_000;
    expect((await card(ctx, 'Blair')).day.today).toBe(false);
  });
  it('players never get a level: no organizer rating and no other player level in any player answer', async () => {
    const ctx = await world(8);
    // The organizer rates two players differently from what they picked.
    for (const [n, level] of [
      ['Casey', 275],
      ['Devon', 360],
    ] as [string, number][]) {
      expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/level`, { playerId: ctx.byName[n], level })).status).toBe(200);
    }
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    // Every key anywhere in the tournament answer that names a level: only the player's own pick (me.level) and lockedLevel may exist.
    const levelKeys = (x: unknown, path = ''): string[] =>
      x && typeof x === 'object'
        ? Object.entries(x as Record<string, unknown>).flatMap(([k, val]) => [...(/level|approved/i.test(k) ? [`${path}${k}`] : []), ...levelKeys(val, `${path}${k}.`)])
        : [];
    for (const name of ALL.slice(0, 8)) {
      const t = (await card(ctx, name)) as Record<string, unknown>;
      expect(levelKeys(t).filter((k) => k !== 'me.level' && k !== 'lockedLevel'), name).toEqual([]);
      const me = t.me as { level: number };
      // Their own pick only (never the organizer's rating for them).
      expect(me.level).toBe(LEVELS[ALL.indexOf(name) % LEVELS.length]);
    }
  });
});

describe("zip 57 add-on: a standby player swapped in during the night plays for their hold (Alex's answer 2)", () => {
  it('16 locked in and Kai paid on standby: Kai takes over, and the hold never comes back as credit at the end of the night', async () => {
    const ctx = await world(16, { start: 19 * 60, minutes: 180, passPayBy: false });
    const kai = 'Rory';
    expect((await (await playerPhone(ctx, kai)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 300, dates: [DATE] })).status).toBe(200);
    expect((await (await playerPhone(ctx, kai)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).status).toBe(200);
    const seen = Number((ctx.app.db.raw.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL").get(ctx.byName[kai]) as { c: number }).c);
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[kai]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen })).status).toBe(200);
    const hold = await (await playerPhone(ctx, kai)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'hold', priceCents: 1600 });
    expect(hold.data.result, hold.text).toBe('held');
    ctx.app.now = PAY_BY_MS + 60_000;
    await draftAndPublish(ctx);
    ctx.app.now = START_MS - 30 * 60_000 + 60_000;
    const d = (await dash(ctx)).day;
    expect(d.spares.map((x: any) => x.name)).toContain(kai);
    const leaving = d.teams[0].players[0];
    const r = await games(ctx, { action: 'left', playerId: leaving.id, swapIn: ctx.byName[kai] });
    expect(r.status, r.text).toBe(200);
    expect(r.data.holdToSpot).toBe(false); // every spot is taken: the hold stays on standby, but it is theirs
    expect((await dash(ctx)).day.teams[0].players.map((p: any) => p.name)).toContain(kai);
    const before = moneyRows(ctx);
    // After the night: the first screen that reads it gives unused holds back. Kai played: nothing comes back.
    ctx.app.now = START_MS + 4 * 3_600_000;
    await dash(ctx);
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });
});
