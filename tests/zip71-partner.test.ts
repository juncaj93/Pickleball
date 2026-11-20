import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';

// Zip 71 (🎾71.teams), part 1: partner taps on game night. The FIRST answer from a side counts: once Vic answers, his partner's answer for that
// game is refused by the server (not only hidden), the partner's screen gets the waiting line, either player on the other side can confirm (or say
// No), the organizer can confirm or fix, and only the one who answered can take it back. Locked doubles AND Americano scores. Same world as
// tests/zip57-day.test.ts and tests/zip61-day.test.ts (Thu Nov 12, 7:30 PM; Pay by the night before).

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

/** 8 players, teams published, Game 1 being played: Vic (a) and Wren (a2) on one side, Quinn (b) and Reese (b2) on the other (names from the world). */
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
const tap = async (ctx: Ctx, name: string, num: number, action: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action });

describe('zip 71: Locked doubles, the first answer from a team counts', () => {
  it("Vic's We won: his partner's answers are refused by the server with the waiting line; the partner's card shows it; Vic's does not", async () => {
    const { ctx, num, teamA, teamB, a, a2 } = await doublesNight();
    const before = moneyRows(ctx);
    expect((await tap(ctx, a, num, 'won')).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ claim: 'a', claim_by: ctx.byName[a] });
    const line = `${a} said ${teamA} won. Waiting for ${teamB} or Alex to confirm.`;
    for (const action of ['lost', 'won', 'undo', 'confirm', 'dispute']) {
      const r = await tap(ctx, a2, num, action);
      expect(r.status, `${action}: ${r.text}`).toBe(409);
      expect(r.data.error?.message ?? r.data.message ?? r.text).toContain(line);
    }
    // Nothing changed: still Vic's We won, waiting for the other team.
    expect(gameRow(ctx, num)).toMatchObject({ claim: 'a', claim_by: ctx.byName[a], winner: null, disputed_at: null });
    const partner = (await card(ctx, a2)).day;
    expect(partner.games[0]).toMatchObject({ state: 'done', won: true, claimed: true, waiting: line });
    const mine = (await card(ctx, a)).day;
    expect(mine.games[0].waiting).toBeUndefined();
    expect(mine.games[0]).toMatchObject({ claimed: true });
    // Vic tapping again (a refresh, a double tap) is fine; changing his own answer is not (Alex fixes it).
    expect((await tap(ctx, a, num, 'won')).data.result).toBe('claimed');
    const own = await tap(ctx, a, num, 'lost');
    expect(own.status).toBe(409);
    expect(own.text).toContain(`You said ${teamA} won. Waiting for ${teamB} or Alex to confirm.`);
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('either player on the other side can confirm, or say No (the organizer then decides)', async () => {
    for (const who of ['b', 'b2'] as const) {
      const n = await doublesNight();
      await tap(n.ctx, n.a, n.num, 'won');
      expect((await card(n.ctx, n[who])).day.games[0].askConfirm).toBe(true);
      expect((await tap(n.ctx, n[who], n.num, 'confirm')).status).toBe(200);
      expect(gameRow(n.ctx, n.num)).toMatchObject({ winner: 'a' });
      expect((await card(n.ctx, n.a2)).day.games[0].waiting).toBeUndefined();
    }
    const n = await doublesNight();
    await tap(n.ctx, n.a, n.num, 'won');
    expect((await tap(n.ctx, n.b2, n.num, 'dispute')).status).toBe(200);
    // Both teams say they won: only the organizer settles it. Nobody on either side can answer again (the review's findings 1 and 2), and
    // all four phones show the line instead of the buttons.
    const both = `${n.teamA} and ${n.teamB} both say they won. Alex will decide.`;
    for (const who of [n.a, n.a2, n.b, n.b2])
      for (const action of ['lost', 'won', 'confirm', 'dispute', 'undo']) {
        const r = await tap(n.ctx, who, n.num, action);
        expect(r.status, `${who} ${action}`).toBe(409);
        expect(r.text).toContain(both);
      }
    for (const who of [n.a, n.a2, n.b, n.b2]) expect((await card(n.ctx, who)).day.games[0]).toMatchObject({ disputed: true, waiting: both, onNow: true });
    expect((await n.ctx.organizer.call('POST', `/api/admin/tournament/${n.ctx.tid}/games`, { action: 'result', num: n.num, winner: 'b' })).status).toBe(200);
    expect(gameRow(n.ctx, n.num)).toMatchObject({ winner: 'b', disputed_at: null });
    return;
    expect(gameRow(n.ctx, n.num)).toMatchObject({ claim: 'a', winner: null });
    expect(gameRow(n.ctx, n.num).disputed_at).not.toBeNull();
  });

  it('the organizer can confirm from the night screen, and fix or change the result afterward', async () => {
    const { ctx, num, a, a2 } = await doublesNight();
    await tap(ctx, a, num, 'won');
    const g = (await dash(ctx)).day.games[0];
    expect(g.claim).toBe('a');
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'result', num, winner: 'a', seen: { claim: 'a', winner: null } })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', result_by: 'organizer' });
    expect((await card(ctx, a2)).day.games[0].waiting).toBeUndefined();
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'result', num, winner: 'b' })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b' });
  });

  it("Undo: Vic's 5 seconds never reach the server, so the partner may answer; after a sent We won only Vic can take it back, then the partner may answer", async () => {
    // The 5 second Undo is on Vic's phone only: nothing was sent, so Wren's answer is the first one.
    const n = await doublesNight();
    expect((await tap(n.ctx, n.a2, n.num, 'lost')).status).toBe(200);
    expect(gameRow(n.ctx, n.num)).toMatchObject({ winner: 'b' });
    // Sent, then taken back by Vic: the game is open again and Wren answers.
    const m = await doublesNight();
    await tap(m.ctx, m.a, m.num, 'won');
    expect((await tap(m.ctx, m.a2, m.num, 'undo')).status).toBe(409);
    expect((await tap(m.ctx, m.a, m.num, 'undo')).status).toBe(200);
    expect(gameRow(m.ctx, m.num)).toMatchObject({ claim: null, claim_by: null });
    expect((await card(m.ctx, m.a2)).day.games[0]).toMatchObject({ state: 'next', onNow: true });
    expect((await tap(m.ctx, m.a2, m.num, 'lost')).status).toBe(200);
    expect(gameRow(m.ctx, m.num)).toMatchObject({ winner: 'b' });
  });

  it('two phones at once on the same side: exactly one answer lands; the other is refused; refreshing changes nothing', async () => {
    const { ctx, num, a, a2 } = await doublesNight();
    const [x, y] = await Promise.all([tap(ctx, a, num, 'won'), tap(ctx, a2, num, 'lost')]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const row = gameRow(ctx, num);
    if (x.status === 200) expect(row).toMatchObject({ claim: 'a', claim_by: ctx.byName[a], winner: null });
    else expect(row).toMatchObject({ winner: 'b' });
    // A refresh on every phone reads the same thing and writes nothing.
    const stamp = row.updated_at;
    for (const name of [a, a2]) await card(ctx, name);
    await dash(ctx);
    expect(gameRow(ctx, num).updated_at).toBe(stamp);
    // Both partners tapping We won at once: one claim, by one of them.
    const n = await doublesNight();
    const both = await Promise.all([tap(n.ctx, n.a, n.num, 'won'), tap(n.ctx, n.a2, n.num, 'won')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect([n.ctx.byName[n.a], n.ctx.byName[n.a2]]).toContain(gameRow(n.ctx, n.num).claim_by);
    books(n.ctx);
  });

  it("a claim from before Zip 71 (no claim_by): the partner is refused with \"Your team said ...\"; either partner may still take it back", async () => {
    const { ctx, num, teamA, teamB, a, a2 } = await doublesNight();
    await tap(ctx, a, num, 'won');
    ctx.app.db.raw.prepare('UPDATE tournament_games SET claim_by = NULL WHERE tournament_id = ? AND num = ?').run(ctx.tid, num);
    const r = await tap(ctx, a2, num, 'lost');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`Your team said ${teamA} won. Waiting for ${teamB} or Alex to confirm.`);
    expect((await card(ctx, a2)).day.games[0].waiting).toBeUndefined();
    expect((await tap(ctx, a2, num, 'undo')).status).toBe(200);
  });

  it('a stale screen: the partner whose phone still shows the buttons is refused with the waiting line (not a silent overwrite)', async () => {
    const { ctx, num, teamA, teamB, a, a2 } = await doublesNight();
    const stale = (await card(ctx, a2)).day.games[0];
    expect(stale).toMatchObject({ onNow: true, state: 'next' });
    await tap(ctx, a, num, 'won');
    const r = await tap(ctx, a2, num, 'lost');
    expect(r.status).toBe(409);
    expect(r.text).toContain(`${a} said ${teamA} won. Waiting for ${teamB} or Alex to confirm.`);
    expect(gameRow(ctx, num)).toMatchObject({ claim: 'a', winner: null });
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
  const fill = {
    ...(mine ? { key: mine.key } : {}),
    ...((body.action === 'confirm' || body.action === 'fix') && mine?.ask ? { shown: { mine: mine.ask.mine, theirs: mine.ask.theirs } } : {}),
  };
  return phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, ...fill, ...body });
};
const round1 = (day: any) => day.rounds.find((r: any) => r.round === 1);

describe('zip 71: Americano, the first score from a side counts', () => {
  it("Vic's 11 to 8: his partner's score (the same or another), Undo and No, fix it are refused with the waiting line; the partner's card shows it", async () => {
    const { ctx, num, a, a2, b, b2 } = await americanoNight();
    const before = moneyRows(ctx);
    expect((await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    const line = `${a} entered 11 to 8. Waiting for ${b}, ${b2} or Alex to confirm.`;
    for (const body of [
      { action: 'score', mine: 11, theirs: 8 },
      { action: 'score', mine: 11, theirs: 9 },
      { action: 'score', mine: 8, theirs: 11 },
      { action: 'undo' },
      { action: 'confirm', shown: { mine: 11, theirs: 8 } },
      { action: 'fix', mine: 11, theirs: 2, shown: { mine: 11, theirs: 8 } },
    ]) {
      const r = await score(ctx, a2, { num, ...body });
      expect(r.status, `${JSON.stringify(body)}: ${r.text}`).toBe(409);
      expect(r.text).toContain(line);
    }
    expect(gameRow(ctx, num)).toMatchObject({ claim: 'a', claim_by: ctx.byName[a], score_a: 11, score_b: 8, winner: null });
    expect(round1((await card(ctx, a2)).day)).toMatchObject({ claimed: true, waiting: line, score: { mine: 11, theirs: 8 } });
    expect(round1((await card(ctx, a)).day).waiting).toBeUndefined();
    // Vic sending the same score again is fine (a refresh); another score from him is refused (Alex fixes it).
    expect((await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    const own = await score(ctx, a, { num, action: 'score', mine: 11, theirs: 6 });
    expect(own.status).toBe(409);
    expect(own.text).toContain(`You entered 11 to 8. Waiting for ${b}, ${b2} or Alex to confirm.`);
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('either player on the other side says Yes; or No, fix it, and then that side is the one waiting (its partner refused, the first side asked)', async () => {
    for (const who of ['b', 'b2'] as const) {
      const n = await americanoNight();
      await score(n.ctx, n.a, { num: n.num, action: 'score', mine: 11, theirs: 8 });
      expect(round1((await card(n.ctx, n[who])).day).ask).toMatchObject({ by: n.a });
      expect((await score(n.ctx, n[who], { num: n.num, action: 'confirm' })).status).toBe(200);
      expect(gameRow(n.ctx, n.num)).toMatchObject({ winner: 'a' });
      expect(round1((await card(n.ctx, n.a2)).day).waiting).toBeUndefined();
    }
    const n = await americanoNight();
    await score(n.ctx, n.a, { num: n.num, action: 'score', mine: 11, theirs: 8 });
    expect((await score(n.ctx, n.b2, { num: n.num, action: 'fix', mine: 11, theirs: 9 })).status).toBe(200);
    expect(gameRow(n.ctx, n.num)).toMatchObject({ claim: 'b', claim_by: n.ctx.byName[n.b2], score_a: 9, score_b: 11 });
    const r = await score(n.ctx, n.b, { num: n.num, action: 'score', mine: 11, theirs: 9 });
    expect(r.status).toBe(409);
    expect(r.text).toContain(`${n.b2} entered 11 to 9. Waiting for ${n.a}, ${n.a2} or Alex to confirm.`);
    expect(round1((await card(n.ctx, n.b)).day).waiting).toBe(`${n.b2} entered 11 to 9. Waiting for ${n.a}, ${n.a2} or Alex to confirm.`);
    // The first side's partner answers the fix (both of them are asked).
    expect(round1((await card(n.ctx, n.a2)).day).ask).toMatchObject({ by: n.b2 });
    expect((await score(n.ctx, n.a2, { num: n.num, action: 'confirm' })).status).toBe(200);
    expect(gameRow(n.ctx, n.num)).toMatchObject({ winner: 'b', score_a: 9, score_b: 11 });
  });

  it('the organizer confirms the score waiting, or fixes it', async () => {
    const { ctx, num, a, a2 } = await americanoNight();
    await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 });
    const g = (await dash(ctx)).rounds.games[0];
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'confirm', num, seen: g.stamp })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'a', result_by: 'organizer' });
    expect(round1((await card(ctx, a2)).day).waiting).toBeUndefined();
    const g2 = (await dash(ctx)).rounds.games[0];
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'score', num, a: 7, b: 11, seen: g2.stamp })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ winner: 'b', score_a: 7, score_b: 11 });
  });

  it('Undo by the one who entered it opens the round again: then the partner may enter the score', async () => {
    const { ctx, num, a, a2 } = await americanoNight();
    await score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 });
    expect((await score(ctx, a, { num, action: 'undo' })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ claim: null, claim_by: null, score_a: null });
    expect((await score(ctx, a2, { num, action: 'score', mine: 11, theirs: 7 })).status).toBe(200);
    expect(gameRow(ctx, num)).toMatchObject({ claim: 'a', claim_by: ctx.byName[a2], score_a: 11, score_b: 7 });
  });

  it('two phones at once on the same side: one score lands, the other is refused', async () => {
    const { ctx, num, a, a2 } = await americanoNight();
    const both = await Promise.all([score(ctx, a, { num, action: 'score', mine: 11, theirs: 8 }), score(ctx, a2, { num, action: 'score', mine: 11, theirs: 5 })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = gameRow(ctx, num);
    expect([ctx.byName[a], ctx.byName[a2]]).toContain(row.claim_by);
    expect(row.score_b).toBe(row.claim_by === ctx.byName[a] ? 8 : 5);
    books(ctx);
  });
});
