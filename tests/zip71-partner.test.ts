import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { asScore, withScore } from './zip72-taps';

// Zip 71 (🎾71.teams), part 1, NO CONFIRMING (Alex, Nov 20): the FIRST answer from ANY of the 4 players in a game is the result, at once
// (Locked doubles: who won; Americano: the score). Nobody confirms. A second answer from anyone is refused by the server with who answered; the
// same player sending the same answer again is fine. The 5 second Undo is on the answering phone (nothing is sent until it runs out). The
// organizer can still Fix or clear any result. Same world as tests/zip57-day.test.ts and tests/zip61-day.test.ts (Thu Nov 12, 7:30 PM).

const DATE = '2026-11-12';
const DATES = ['2026-11-05', DATE, '2026-11-19'];
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z');
const START_MS = Date.parse('2026-11-13T00:30:00.000Z');
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

async function world(n: number, format: 'doubles' | 'americano'): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all', format });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id };
  const names = ALL.slice(0, n);
  for (const [i, name] of names.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 });
  expect(fin.status, fin.text).toBe(200);
  for (const name of names) {
    const seen = Number(
      (
        ctx.app.db.raw
          .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
          .get(ctx.byName[name]) as { c: number }
      ).c,
    );
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen })).status).toBe(200);
    expect((await (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 })).status).toBe(200);
  }
  ctx.app.now = PAY_BY_MS + 60_000;
  return ctx;
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const books = (ctx: Ctx) => {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
};
const moneyRows = (ctx: Ctx) => JSON.stringify([ctx.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY rowid').all(), ctx.app.db.raw.prepare('SELECT * FROM tournament_tickets ORDER BY rowid').all()]);
const gameRow = (ctx: Ctx, num: number) => ctx.app.db.raw.prepare('SELECT * FROM tournament_games WHERE tournament_id = ? AND num = ?').get(ctx.tid, num) as Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------------
// Locked doubles
// ---------------------------------------------------------------------------------------------------------------------

/** 8 players, teams published, Game 1 being played: a and a2 on one team, b and b2 on the other (names from the world). */
async function doublesNight() {
  const ctx = await world(8, 'doubles');
  expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'draft' })).status).toBe(200);
  expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'publish' })).status).toBe(200);
  ctx.app.now = START_MS + 60_000;
  const d = (await dash(ctx)).day;
  const g1 = d.games[0];
  const ta = d.teams.find((x: any) => x.seat === g1.a.seat);
  const tb = d.teams.find((x: any) => x.seat === g1.b.seat);
  return { ctx, num: g1.num as number, teamA: ta.name as string, teamB: tb.name as string, a: ta.players[0].name as string, a2: ta.players[1].name as string, b: tb.players[0].name as string, b2: tb.players[1].name as string };
}
const tap = async (ctx: Ctx, name: string, num: number, action: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, ...asScore(action) });
const fix = (ctx: Ctx, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, withScore(body));
const NO_CONFIRM_KEYS = ['askConfirm', 'waiting', 'ask'];

describe('zip 71, no confirming: Locked doubles, the first answer from any of the 4 players is the result', () => {
  it("Vic's We won is the result at once: all four phones show it done, nothing to confirm, standings and the next game follow", async () => {
    const { ctx, num, a, a2, b, b2 } = await doublesNight();
    const before = moneyRows(ctx);
    expect((await tap(ctx, a, num, 'won')).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim: null, claim_by: ctx.byName[a], result_by: 'players' });
    for (const [who, won] of [[a, true], [a2, true], [b, false], [b2, false]] as const) {
      const day = (await card(ctx, who)).day;
      expect(day.games[0], who).toMatchObject({ state: 'done', won });
      for (const k of NO_CONFIRM_KEYS) expect(day.games[0][k], `${who} ${k}`).toBeUndefined();
      expect(day.games.find((g: any) => g.state === 'next')?.label, who).toBe('Game 2');
      expect(day.standings[0].rows.find((r: any) => r.me).record, who).toBe(won ? '1-0' : '0-1');
    }
    const g = (await dash(ctx)).day.games[0];
    expect(g).toMatchObject({ winner: 'a', scoreA: 11, scoreB: 7, by: a });
    expect(g.claim).toBeUndefined();
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('a second answer from anyone (either team, any button) is refused with who answered; the same player sending the same answer is fine', async () => {
    const { ctx, num, teamA, a, a2, b, b2 } = await doublesNight();
    await tap(ctx, a, num, 'won');
    const line = `${a} entered ${teamA} 11 to 7. Ask Alex to fix it.`;
    for (const who of [a2, b, b2])
      for (const action of ['won', 'lost', 'confirm', 'dispute', 'undo']) {
        const r = await tap(ctx, who, num, action);
        expect(r.status, `${who} ${action}`).toBe(409);
        // An answer that says the same thing is still the second one (refused), but nothing needs fixing.
        const agrees = (who === a2 && action === 'won') || (who !== a2 && action === 'lost');
        expect(r.text).toContain(agrees ? `${a} entered ${teamA} 11 to 7. It is in.` : line);
      }
    expect((await tap(ctx, a, num, 'won')).status).toBe(200);
    for (const action of ['lost', 'undo']) {
      const r = await tap(ctx, a, num, action);
      expect(r.status).toBe(409);
      expect(r.text).toContain(`You entered ${teamA} 11 to 7. Ask Alex to fix it.`);
    }
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim_by: ctx.byName[a] });
  });

  it('any of the four can be first, the losing side too ("<other team> won"); then the winners cannot answer again', async () => {
    const { ctx, num, teamA, a, b2 } = await doublesNight();
    expect((await tap(ctx, b2, num, 'lost')).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim_by: ctx.byName[b2] });
    const r = await tap(ctx, a, num, 'won');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`${b2} entered ${teamA} 11 to 7. It is in.`);
    const r2 = await tap(ctx, a, num, 'lost');
    expect(r2.text).toContain(`${b2} entered ${teamA} 11 to 7. Ask Alex to fix it.`);
  });

  it('nothing to confirm: Yes / No / Undo with no result are refused, nothing written', async () => {
    const { ctx, num, b } = await doublesNight();
    const stamp = gameRow(ctx, num).updated_at;
    for (const action of ['confirm', 'dispute', 'undo']) expect((await tap(ctx, b, num, action)).status).toBe(409);
    expect(gameRow(ctx, num).updated_at).toBe(stamp);
  });

  it("Undo: Vic's 5 seconds run on his phone and send nothing, so after his Undo anyone else may answer first", async () => {
    const { ctx, num, a, b } = await doublesNight();
    // (Vic tapped We won and then Undo inside the 5 seconds: no request ever reached the server.)
    expect(gameRow(ctx, num)).toMatchObject({ winner: null, claim: null });
    expect((await tap(ctx, b, num, 'won')).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', claim_by: ctx.byName[b] });
    expect((await tap(ctx, a, num, 'won')).status).toBe(409);
  });

  it('the organizer fixes or clears any result afterward; a cleared game takes a first answer again', async () => {
    const { ctx, num, teamB, a, a2 } = await doublesNight();
    await tap(ctx, a, num, 'won');
    expect((await fix(ctx, { action: 'result', num, winner: 'b' })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', result_by: 'organizer', claim_by: null });
    expect((await card(ctx, a)).day.games[0]).toMatchObject({ state: 'done', won: false });
    const r = await tap(ctx, a, num, 'won');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`Alex set ${teamB} 11 to 7. Ask Alex to fix it.`);
    expect((await fix(ctx, { action: 'result', num, winner: null })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: null, claim: null });
    expect((await tap(ctx, a2, num, 'won')).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim_by: ctx.byName[a2] });
  });

  it('two phones at once: one answer lands, the other is refused; the same player on two phones with the same answer: both fine', async () => {
    const { ctx, num, a, b } = await doublesNight();
    const both = await Promise.all([tap(ctx, a, num, 'won'), tap(ctx, b, num, 'won')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = gameRow(ctx, num);
    expect(row.claim_by).toBe(row.winner === 'a' ? ctx.byName[a] : ctx.byName[b]);
    const stamp = row.updated_at;
    for (const name of [a, b]) await card(ctx, name);
    await dash(ctx);
    expect(gameRow(ctx, num).updated_at).toBe(stamp);
    const n = await doublesNight();
    const same = await Promise.all([tap(n.ctx, n.a, n.num, 'won'), tap(n.ctx, n.a, n.num, 'won')]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    books(n.ctx);
  });

  it('an old disputed game (from before this zip): no buttons on it for either team; the organizer settles it', async () => {
    const { ctx, num, a, b } = await doublesNight();
    ctx.app.db.raw.prepare("UPDATE tournament_games SET claim = 'a', disputed_at = ? WHERE tournament_id = ? AND num = ?").run(new Date(START_MS).toISOString(), ctx.tid, num);
    for (const who of [a, b]) expect((await card(ctx, who)).day.games[0].onNow, who).toBeUndefined();
    expect((await fix(ctx, { action: 'result', num, winner: 'b' })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', disputed_at: null });
  });

  it('a We won from before this zip (still waiting, no claim_by) counts as the result: nobody can answer over it', async () => {
    const { ctx, num, teamA, b } = await doublesNight();
    ctx.app.db.raw.prepare("UPDATE tournament_games SET claim = 'a', claim_at = ? WHERE tournament_id = ? AND num = ?").run(new Date(START_MS).toISOString(), ctx.tid, num);
    const r = await tap(ctx, b, num, 'confirm');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`${teamA} won. Ask Alex to fix it.`);
    expect((await card(ctx, b)).day.games[0].askConfirm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Americano
// ---------------------------------------------------------------------------------------------------------------------

/** 10 players on Americano, Round 1 being played: a and a2 together against b and b2. */
async function americanoNight() {
  const ctx = await world(10, 'americano');
  ctx.app.now = START_MS + 60_000;
  const g = (await dash(ctx)).rounds.games[0];
  return { ctx, num: g.num as number, a: g.a.names[0] as string, a2: g.a.names[1] as string, b: g.b.names[0] as string, b2: g.b.names[1] as string };
}
const score = async (ctx: Ctx, name: string, body: Record<string, unknown>) => {
  const phone = await playerPhone(ctx, name);
  const mine = ((await phone.call('GET', '/api/group')).data.tournament?.day?.rounds ?? []).find((r: any) => r.num === body.num);
  return phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, ...(mine ? { key: mine.key } : {}), ...body });
};
const round1 = (day: any) => day.rounds.find((r: any) => r.round === 1);

describe('zip 71, no confirming: Americano, the first score from any of the 4 players is the result', () => {
  it("Vic's 11 to 8 is in at once: all four see it done with the score, nothing to confirm, the table follows", async () => {
    const { ctx, num, a, a2, b, b2 } = await americanoNight();
    const before = moneyRows(ctx);
    expect((await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim: null, claim_by: ctx.byName[a], score_a: 11, score_b: 8, result_by: 'players' });
    for (const [who, mine, theirs] of [[a, 11, 8], [a2, 11, 8], [b, 8, 11], [b2, 8, 11]] as const) {
      const r = round1((await card(ctx, who)).day);
      expect(r, who).toMatchObject({ state: 'done', won: mine > theirs, score: { mine, theirs } });
      for (const k of [...NO_CONFIRM_KEYS, 'claimed']) expect(r[k], `${who} ${k}`).toBeUndefined();
    }
    const table = (await card(ctx, a)).day.standings;
    expect(table.find((x: any) => x.name === a)).toMatchObject({ record: '1-0', points: 11 });
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('any other score (the partner or the other side, the same or another), Yes, No fix it and Undo are refused with who entered it', async () => {
    const { ctx, num, a, a2, b, b2 } = await americanoNight();
    await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 });
    const line = `${a} entered 11 to 8. Ask Alex to fix it.`;
    // The same score from someone else: refused, but nothing needs fixing.
    expect((await score(ctx, a2, { num, action: 'score', mine: 11, theirs: 8 })).text).toContain(`${a} entered 11 to 8. It is in.`);
    expect((await score(ctx, b, { num, action: 'score', mine: 8, theirs: 11 })).text).toContain(`${a} entered 11 to 8. It is in.`);
    for (const who of [a2, b, b2])
      for (const body of [
        { action: 'score', mine: 11, theirs: 9 },
        { action: 'score', mine: 9, theirs: 11 },
        { action: 'confirm', shown: { mine: 11, theirs: 8 } },
        { action: 'fix', mine: 11, theirs: 2, shown: { mine: 11, theirs: 8 } },
        { action: 'undo' },
      ]) {
        const r = await score(ctx, who, { num, ...body });
        expect(r.status, `${who} ${JSON.stringify(body)}: ${r.text}`).toBe(409);
        expect(r.text).toContain(line);
      }
    expect((await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    const own = await score(ctx, a, { num, action: 'score', mine: 11, theirs: 6 });
    expect(own.status).toBe(409);
    expect(own.text).toContain('You entered 11 to 8. Ask Alex to fix it.');
    expect(gameRow(ctx, num)).toMatchObject({ score_a: 11, score_b: 8, claim_by: ctx.byName[a] });
  });

  it('the other side can be first; after Undo on the phone (nothing sent) anyone may enter it', async () => {
    const { ctx, num, a, b2 } = await americanoNight();
    expect((await score(ctx, b2, { num, action: 'score', mine: 11, theirs: 5 })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', score_a: 5, score_b: 11, claim_by: ctx.byName[b2] });
    expect((await score(ctx, a, { num, action: 'score', mine: 5, theirs: 11 })).status).toBe(409);
  });

  it('the organizer fixes or clears a score; a cleared game takes a first score again', async () => {
    const { ctx, num, a, a2 } = await americanoNight();
    await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 });
    const g = (await dash(ctx)).rounds.games[0];
    expect(g.status).toBe('done');
    expect((await fix(ctx, { action: 'score', num, a: 7, b: 11, seen: g.stamp })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', score_a: 7, score_b: 11, result_by: 'organizer' });
    const r = await score(ctx, a2, { num, action: 'score', mine: 11, theirs: 7 });
    expect(r.status).toBe(409);
    expect(r.text).toContain('Alex set it to 11 to 7. Ask Alex to fix it.');
    const g2 = (await dash(ctx)).rounds.games[0];
    expect((await fix(ctx, { action: 'clear', num, seen: g2.stamp })).status).toBe(200);
    expect((await score(ctx, a2, { num, action: 'score', mine: 11, theirs: 7 })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', claim_by: ctx.byName[a2] });
  });

  it('two phones at once: one score lands, the other is refused; the same player twice with the same score: both fine', async () => {
    const { ctx, num, a, b } = await americanoNight();
    const both = await Promise.all([score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 }), score(ctx, b, { num, action: 'score', mine: 11, theirs: 5 })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect([ctx.byName[a], ctx.byName[b]]).toContain(gameRow(ctx, num).claim_by);
    const n = await americanoNight();
    const same = await Promise.all([score(n.ctx, n.a, { num: n.num, action: 'score', mine: 11, theirs: 4 }), score(n.ctx, n.a, { num: n.num, action: 'score', mine: 11, theirs: 4 })]);
    expect(same.map((r) => r.status)).toEqual([200, 200]);
    books(n.ctx);
  });
});
