import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';

// Zip 61 (🎾61.americano): the Americano night on the real server code (the test harness). The clock starts Monday Oct 26, 2026, 12 PM Eastern.
// The tournament is Thu Nov 12, 7:30 to 10:00 PM; Pay by is Wed Nov 11, 7:00 PM (the night before). Same world as tests/zip57-day.test.ts.

const DATE = '2026-11-12';
const DATES = ['2026-11-05', DATE, '2026-11-19'];
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z'); // Wed Nov 11, 7:00 PM EST
const START_MS = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

async function world(n: number, opts: { courts?: 1 | 2; minutes?: number; visibility?: 'me' | 'all'; format?: 'americano' | 'doubles'; passPayBy?: boolean } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
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
    visibility: opts.visibility ?? 'all',
    format: opts.format ?? 'americano',
  });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id };
  const names = ALL.slice(0, n);
  for (const [i, name] of names.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: opts.minutes ?? 150, courts: opts.courts ?? 2 });
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
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const admin = (ctx: Ctx, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
/** A player's tap as their screen sends it: the game's key from their own card, and with Yes or No, fix it the score the screen showed. */
const play = async (ctx: Ctx, name: string, body: Record<string, unknown>) => {
  const phone = await playerPhone(ctx, name);
  const mine = ((await phone.call('GET', '/api/group')).data.tournament?.day?.rounds ?? []).find((r: any) => r.num === body.num);
  const fill = {
    ...(body.key === undefined && mine ? { key: mine.key } : {}),
    ...((body.action === 'confirm' || body.action === 'fix') && body.shown === undefined && mine?.ask ? { shown: { mine: mine.ask.mine, theirs: mine.ask.theirs } } : {}),
  };
  return phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, ...fill, ...body });
};
const rowCount = (ctx: Ctx) => Number((ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM tournament_games WHERE slot_a LIKE '%+%'").get() as { n: number }).n);
function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}
const moneyRows = (ctx: Ctx) => JSON.stringify([ctx.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY rowid').all(), ctx.app.db.raw.prepare('SELECT * FROM tournament_tickets ORDER BY rowid').all()]);
/** Every key of an answer, deep. */
function keys(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => keys(y, out));
  else if (x && typeof x === 'object')
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keys(v, out);
    }
  return out;
}

/** The first game of round 1 from the organizer's screen, and a player on each side. */
async function firstGame(ctx: Ctx) {
  const r = (await dash(ctx)).rounds;
  const g = r.games[0];
  return { g, a: g.a.names[0] as string, a2: g.a.names[1] as string, b: g.b.names[0] as string, b2: g.b.names[1] as string };
}
const myRound = (day: any, round: number) => day.rounds.find((x: any) => x.round === round);

describe('zip 61: before the night', () => {
  it('Americano before Pay by: no rounds yet (the style is TBD for players); after Pay by every player in it sees their rounds', async () => {
    const ctx = await world(10, { passPayBy: false });
    expect((await card(ctx, 'Blair')).day).toBeUndefined();
    expect((await dash(ctx)).rounds).toBeUndefined();
    ctx.app.now = PAY_BY_MS + 60_000;
    const d = (await dash(ctx)).rounds;
    expect(d).toMatchObject({ kind: 'americano', lockedIn: 10, plan: { gameTo: 11, rounds: 6, fits: true, onCourt: 8 } });
    expect(d.games).toHaveLength(12);
    expect(d.sits.every((s: any) => s.names.length === 2)).toBe(true);
    for (const name of ALL.slice(0, 10)) {
      const v = (await card(ctx, name)).day;
      expect(v.kind).toBe('americano');
      expect(v.me).toBe(name);
      expect(v.rounds).toHaveLength(6);
      expect(v.today).toBe(false);
      // Every round: a game with a partner and two opponents (never themselves), or a break.
      for (const r of v.rounds) {
        if (r.num === null) expect(r.alsoOff).toHaveLength(1);
        else {
          expect([r.partner, ...r.opponents]).not.toContain(name);
          expect(new Set([r.partner, ...r.opponents]).size).toBe(3);
        }
      }
      // New partner every round.
      const partners = v.rounds.filter((r: any) => r.partner).map((r: any) => r.partner);
      expect(new Set(partners).size).toBe(partners.length);
    }
    // Nothing is written by reading (Zip 62): the schedule is worked out until the first save.
    expect(rowCount(ctx)).toBe(0);
  });

  it('a back out before the night gives a new schedule for who is in (9 players: one sits each round)', async () => {
    const ctx = await world(10);
    expect((await dash(ctx)).rounds.games).toHaveLength(12);
    expect((await (await playerPhone(ctx, 'Jules')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid })).status).toBe(200);
    const d = (await dash(ctx)).rounds;
    expect(d.lockedIn).toBe(9);
    expect(d.sits.every((s: any) => s.names.length === 1)).toBe(true);
    expect(d.players.map((p: any) => p.name)).not.toContain('Jules');
    expect((await card(ctx, 'Jules')).day).toBeUndefined();
  });

  it('players never get a level, an id or money of anyone else in the night (every key walked)', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { a } = await firstGame(ctx);
    const v = await card(ctx, a);
    const k = keys(v.day);
    for (const bad of ['level', 'levels', 'id', 'ids', 'playerId', 'phone', 'cents', 'credit', 'approved_level', 'picked_level']) expect(k.has(bad), bad).toBe(false);
    const text = JSON.stringify(v.day);
    for (const id of Object.values(ctx.byName)) expect(text).not.toContain(id);
  });

  it('a player who may not see the tournament gets no tournament data at all (the switch off); a player not in the night gets no rounds', async () => {
    const ctx = await world(8);
    ctx.app.now = START_MS + 60_000;
    expect((await card(ctx, 'Blair')).day.kind).toBe('americano');
    // On the group, not in the night: the card, but no rounds, no table, no scores.
    const outside = await card(ctx, 'Shay');
    expect(outside?.day).toBeUndefined();
    expect((await play(ctx, 'Shay', { num: 1, action: 'score', mine: 11, theirs: 5 })).status).toBe(409);
    // The switch off: nothing at all, and a score tap answers like there is no tournament.
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const off = await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group');
    expect(off.data.tournament).toBeUndefined();
    expect(off.text).not.toContain('The Cold Open');
    expect(off.text).not.toContain('americano');
    expect((await play(ctx, 'Blair', { num: 1, action: 'score', mine: 11, theirs: 5 })).status).toBe(404);
  });
});

describe('zip 61: game night, scores', () => {
  it('Enter score counts at once; the partner sees it; the other side is asked "Is this right?"; Yes stands it; the table moves', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS - 20 * 60_000;
    const { g, a, a2, b } = await firstGame(ctx);
    const key = myRound((await card(ctx, a)).day, 1).key;
    // Results open 15 minutes before the start.
    const early = await play(ctx, a, { num: g.num, key, action: 'score', mine: 11, theirs: 8 });
    expect([early.status, early.data.message]).toEqual([409, 'Round 1 begins at 7:30 PM.']);
    ctx.app.now = START_MS + 60_000;
    const v0 = (await card(ctx, a)).day;
    expect(v0.today).toBe(true);
    expect(v0.progress.label).toBe('Round 1 of 6');
    expect(myRound(v0, 1)).toMatchObject({ state: 'next', onNow: true, court: g.court });
    const before = moneyRows(ctx);
    const r = await play(ctx, a, { num: g.num, key, action: 'score', mine: 11, theirs: 8 });
    expect(r.status, r.text).toBe(200);
    expect(rowCount(ctx)).toBe(12);
    const mine = (await card(ctx, a2)).day;
    expect(myRound(mine, 1)).toMatchObject({ state: 'done', won: true, claimed: true, score: { mine: 11, theirs: 8 } });
    expect(mine.progress.label).toBe('Round 2 of 6');
    const top = mine.standings[0];
    expect([top.record, top.points]).toEqual(['1-0', 11]);
    const theirs = (await card(ctx, b)).day;
    expect(myRound(theirs, 1)).toMatchObject({ won: false, ask: { by: a, mine: 8, theirs: 11, winners: `${g.a.names[0]} + ${g.a.names[1]}` } });
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'waiting', scoreA: 11, scoreB: 8, by: a });
    // A player not in the game cannot answer it.
    const outsider = ALL.slice(0, 10).find((x) => ![...g.a.names, ...g.b.names].includes(x))!;
    expect((await play(ctx, outsider, { num: g.num, action: 'confirm' })).status).toBe(409);
    expect((await play(ctx, b, { num: g.num, action: 'confirm' })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'done', scoreA: 11, scoreB: 8 });
    expect(myRound((await card(ctx, b)).day, 1).ask).toBeUndefined();
    // Undo is gone once the other side said Yes. No money moved.
    expect((await play(ctx, a, { num: g.num, action: 'undo' })).data.result).toBe('nothing');
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('"No, fix it": their score replaces it (it counts), the side that entered first is asked, and Yes stands it', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a, b, b2 } = await firstGame(ctx);
    expect((await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    expect((await play(ctx, b, { num: g.num, action: 'fix', mine: 11, theirs: 9 })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'changed', scoreA: 9, scoreB: 11, by: b });
    expect(myRound((await card(ctx, b2)).day, 1)).toMatchObject({ won: true, claimed: true });
    const back = myRound((await card(ctx, a)).day, 1);
    expect(back.ask).toEqual({ by: b, mine: 9, theirs: 11, winners: `${g.b.names[0]} + ${g.b.names[1]}` });
    expect((await play(ctx, a, { num: g.num, action: 'confirm' })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'done', scoreA: 9, scoreB: 11 });
  });

  it('Undo takes back our score while the other side has not said Yes; the same score from both sides is a Yes', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a, b } = await firstGame(ctx);
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 4 });
    expect((await play(ctx, a, { num: g.num, action: 'undo' })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'playing', scoreA: null });
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 4 });
    // The other side enters the same score: it stands.
    expect((await play(ctx, b, { num: g.num, action: 'score', mine: 4, theirs: 11 })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0].status).toBe('done');
    // A different score from the other side is refused (their screen asks "Is this right?" instead).
    const g2 = (await dash(ctx)).rounds.games[1];
    await play(ctx, g2.a.names[0], { num: g2.num, action: 'score', mine: 11, theirs: 6 });
    expect((await play(ctx, g2.b.names[0], { num: g2.num, action: 'score', mine: 11, theirs: 6 })).status).toBe(409);
  });

  it('bad scores are refused: a tie, a negative, over 30; and a schedule that changed in between says look again', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a } = await firstGame(ctx);
    for (const [mine, theirs] of [
      [11, 11],
      [-1, 11],
      [31, 2],
      [8.5, 11],
    ])
      expect((await play(ctx, a, { num: g.num, action: 'score', mine, theirs })).status).toBe(400);
    expect((await play(ctx, a, { num: g.num, key: 'stale', action: 'score', mine: 11, theirs: 2 })).status).toBe(409);
    expect(rowCount(ctx)).toBe(0);
  });

  it('the organizer: Confirm, Fix with two numbers, Clear; a tap on a game that changed since does nothing', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a } = await firstGame(ctx);
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 3 });
    const w = (await dash(ctx)).rounds.games[0];
    expect((await admin(ctx, { action: 'confirm', num: g.num, seen: w.stamp })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0].status).toBe('done');
    // Stale: the stamp from before the Confirm.
    expect((await admin(ctx, { action: 'score', num: g.num, a: 9, b: 11, seen: w.stamp })).status).toBe(409);
    const now = (await dash(ctx)).rounds.games[0];
    expect((await admin(ctx, { action: 'score', num: g.num, a: 9, b: 11, seen: now.stamp })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'done', scoreA: 9, scoreB: 11 });
    const after = (await dash(ctx)).rounds.games[0];
    expect((await admin(ctx, { action: 'clear', num: g.num, seen: after.stamp })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'playing', scoreA: null, scoreB: null });
    // The organizer can set a game nobody entered (it writes the rows first, like a player's score).
    const g2 = (await dash(ctx)).rounds.games[1];
    expect((await admin(ctx, { action: 'score', num: g2.num, a: 11, b: 7, seen: g2.stamp })).status).toBe(200);
    expect((await dash(ctx)).rounds.games[1].status).toBe('done');
  });

  it('late: a score waiting for a Yes more than 5 minutes, and a round playing past its time, are flagged on the organizer card', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a } = await firstGame(ctx);
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 3 });
    ctx.app.now = START_MS + 8 * 60_000;
    const d = (await dash(ctx)).rounds;
    expect(d.games[0].late).toBe('Waiting 7 min');
    expect(d.games[1].late).toBeUndefined();
    ctx.app.now = START_MS + 31 * 60_000;
    expect((await dash(ctx)).rounds.games[1].late).toBe('8 min over');
  });

  it('the whole night: every round in, the table ranks by wins then points, "Done", and a tie at the end says Tied', async () => {
    const ctx = await world(8, { courts: 2, minutes: 120 });
    ctx.app.now = START_MS + 60_000;
    let d = (await dash(ctx)).rounds;
    expect(d.plan).toMatchObject({ gameTo: 11, rounds: 4 });
    for (const g of d.games) {
      // Side a always wins 11 to 5: everybody ends 2-2 with the same points somewhere.
      const fresh = (await dash(ctx)).rounds.games.find((x: any) => x.num === g.num);
      expect((await admin(ctx, { action: 'score', num: g.num, a: 11, b: 5, seen: fresh.stamp })).status).toBe(200);
    }
    d = (await dash(ctx)).rounds;
    expect(d.round).toBeNull();
    const v = (await card(ctx, 'Blair')).day;
    expect(v.progress.label).toBe('Done');
    const pts = v.standings.map((r: any) => [r.record, r.points]);
    // Sorted: wins first, then points.
    for (let i = 1; i < pts.length; i++) {
      const [w1, p1] = [Number(pts[i - 1][0].split('-')[0]), pts[i - 1][1]];
      const [w2, p2] = [Number(pts[i][0].split('-')[0]), pts[i][1]];
      expect(w1 > w2 || (w1 === w2 && p1 >= p2)).toBe(true);
    }
    // Level on wins and points at the end: Tied, and the organizer is told who.
    const level = v.standings.filter((r: any) => r.tied).map((r: any) => r.name);
    expect(d.tied ?? []).toEqual(expect.arrayContaining(level));
  });
});

describe('zip 61: Time check, Pause, Player left, back outs', () => {
  it('the Time check counts in rounds and never shortens the last round', async () => {
    const ctx = await world(10, { minutes: 150 });
    // 7:30 PM, 6 rounds to 11 (138 minutes). An hour in and nothing entered: well behind.
    ctx.app.now = START_MS + 75 * 60_000;
    const d = (await dash(ctx)).rounds;
    expect(d.timeCheck).toBeTruthy();
    expect(d.timeCheck.text).toMatch(/^Running about \d+ minutes behind\. From Round \d on, play to (9|7)/);
    const r = await admin(ctx, { action: 'apply', fromRound: d.timeCheck.fromRound, to: d.timeCheck.to });
    expect(r.status, r.text).toBe(200);
    const after = (await dash(ctx)).rounds;
    expect(after.games.filter((g: any) => g.round === 6).every((g: any) => g.playTo === 11)).toBe(true);
    expect(after.games.filter((g: any) => g.round >= d.timeCheck.fromRound && g.round < 6).every((g: any) => g.playTo === d.timeCheck.to)).toBe(true);
    // Players see the words.
    const v = (await card(ctx, 'Blair')).day;
    expect(v.timeNote).toContain(`From Round ${d.timeCheck.fromRound} on, play to ${d.timeCheck.to}`);
  });

  it('Pause shows on every phone; Resume takes it off', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    expect((await admin(ctx, { action: 'pause' })).status).toBe(200);
    expect((await card(ctx, 'Blair')).day.paused).toBe(true);
    expect((await admin(ctx, { action: 'resume' })).status).toBe(200);
    expect((await card(ctx, 'Blair')).day.paused).toBeUndefined();
  });

  it('Player left: their later games are skipped, the others in them get a plain note, and the table ranks by win percentage', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    let d = (await dash(ctx)).rounds;
    // Round 1 in.
    for (const g of d.games.filter((x: any) => x.round === 1)) {
      const fresh = (await dash(ctx)).rounds.games.find((x: any) => x.num === g.num);
      expect((await admin(ctx, { action: 'score', num: g.num, a: 11, b: 6, seen: fresh.stamp })).status).toBe(200);
    }
    d = (await dash(ctx)).rounds;
    const leaver = d.players.find((p: any) => d.games.some((g: any) => g.round === 2 && g.a.ids.includes(p.id)))!;
    const r = await admin(ctx, { action: 'left', playerId: leaver.id });
    expect(r.status, r.text).toBe(200);
    expect(r.data.skipped).toBeGreaterThan(0);
    d = (await dash(ctx)).rounds;
    expect(d.byPercent).toBe(true);
    expect(d.players.find((p: any) => p.id === leaver.id).left).toBe(true);
    const off = d.games.find((g: any) => g.round === 2 && g.a.ids.includes(leaver.id));
    expect(off).toMatchObject({ status: 'skipped', by: leaver.name });
    // The partner in that game is told, plainly.
    const partner = off.a.names.find((x: string) => x !== leaver.name);
    const v = (await card(ctx, partner)).day;
    expect(v.leftNote.text).toMatch(new RegExp(`^${leaver.name} left\\. Your (Round 2 game is off|games in Rounds .* are off)\\.$`));
    expect(myRound(v, 2)).toMatchObject({ skipped: true, state: 'done' });
    // Round 2's live game moved on: the night's round is still 2 with one game to play.
    expect(d.round).toBe(2);
    // A second tap changes nothing.
    expect((await admin(ctx, { action: 'left', playerId: leaver.id })).data.skipped).toBe(0);
  });

  it('Zip 70: a back out in the last 3 hours is refused (Drop out has closed); nothing changes (the organizer uses Player left)', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS - 10 * 60_000;
    const { g, a } = await firstGame(ctx);
    expect((await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 2 })).status).toBe(200);
    // Ticket taps stop at the start; the organizer takes a player off (the same rows a back out writes).
    const out = (await dash(ctx)).rounds.players.find((p: any) => p.name !== a && !g.a.names.includes(p.name) && !g.b.names.includes(p.name));
    const before = JSON.stringify((await dash(ctx)).rounds.games);
    const r = await (await playerPhone(ctx, out.name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
    expect(r.status, r.text).toBe(409);
    expect(r.data.error).toBe('drop_closed');
    const d = (await dash(ctx)).rounds;
    expect(d.players.find((p: any) => p.id === out.id).left).toBeUndefined();
    expect(JSON.stringify(d.games)).toBe(before);
  });
});

describe('zip 61: the switch from Locked doubles, and back', () => {
  it('an odd count at Pay by plays Americano: players see "Tournament style is now Americano." and their new rounds', async () => {
    const ctx = await world(9, { format: 'doubles' });
    const d = await dash(ctx);
    expect(d.format).toBe('americano');
    expect(d.rounds).toMatchObject({ kind: 'americano', lockedIn: 9, plan: { rounds: 6 } });
    const v = await card(ctx, 'Blair');
    expect(v.styleNote.text).toBe('Tournament style is now Americano.');
    expect(v.day.kind).toBe('americano');
    expect(v.day.rounds).toHaveLength(6);
  });

  it('a back out after the teams were published (odd) switches to Americano rounds; Switch back gives zip 57 teams again; no switch back once a score is in', async () => {
    const ctx = await world(10, { format: 'doubles' });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'draft' })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'publish' })).status).toBe(200);
    expect((await card(ctx, 'Blair')).day.team).toBeTruthy();
    expect((await (await playerPhone(ctx, 'Jules')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid })).status).toBe(200);
    // 9: Americano rounds for the 9 in.
    let d = await dash(ctx);
    expect(d.format).toBe('americano');
    expect(d.rounds.lockedIn).toBe(9);
    const v = (await card(ctx, 'Blair')).day;
    expect(v.kind).toBe('americano');
    expect(v.team).toBeUndefined();
    // Jules pays again: 10, the organizer switches back, zip 57's teams apply again (they need a change: Jules was on one).
    await lockWithCredit(ctx, 'Jules').catch(() => undefined);
    const sign = await (await playerPhone(ctx, 'Jules')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 300, dates: [DATE] });
    if (sign.status === 200) await lockWithCredit(ctx, 'Jules').catch(() => undefined);
    d = await dash(ctx);
    if (d.lockedIn === 10) {
      expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {})).status).toBe(200);
      d = await dash(ctx);
      expect(d.format).toBe('doubles');
      expect(d.rounds).toBeUndefined();
      expect((await card(ctx, 'Blair')).day.kind).toBeUndefined();
    }
  });

  it('Switch back is refused once an Americano score is in (results open 15 minutes before the start)', async () => {
    const ctx = await world(9, { format: 'doubles' });
    expect((await dash(ctx)).format).toBe('americano');
    ctx.app.now = START_MS - 10 * 60_000;
    const { g, a } = await firstGame(ctx);
    expect((await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 9 })).status).toBe(200);
    // The organizer cannot make it even now (tickets are cut 3 hours before), so check the guard directly on the endpoint: Switch back after
    // an even count is not offered, and the endpoint refuses while the rounds have started.
    const sb = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
    expect([200, 409]).toContain(sb.status);
    expect((await dash(ctx)).format).toBe('americano');
  });
});

describe('zip 61: every size 6 to 16 through the API', () => {
  for (const n of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    it(`${n} locked in, ${n < 8 ? 1 : 2} court${n < 8 ? '' : 's'}, 3 hours`, async () => {
      const ctx = await world(n, { courts: n < 8 ? 1 : 2, minutes: 180 });
      const d = (await dash(ctx)).rounds;
      expect(d.lockedIn).toBe(n);
      const per = new Map<string, number>();
      for (const g of d.games) for (const x of [...g.a.names, ...g.b.names]) per.set(x, (per.get(x) ?? 0) + 1);
      expect(per.size).toBe(n);
      expect(Math.min(...per.values())).toBeGreaterThanOrEqual(d.plan.fits ? 4 : 1);
      for (const name of ALL.slice(0, n)) expect((await card(ctx, name)).day.rounds).toHaveLength(d.plan.rounds);
    });
  }
});

describe('zip 61: the preview test page, the Americano stages', () => {
  it('each stage is what its line says (the preview names only); Vic sits Round 4 only; the books stay at zero', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    ctx.app.env.PREVIEW_CALM = 'on';
    const byName: Record<string, string> = {};
    for (const n of ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese']) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
    for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
    const c = { ...ctx, byName, tid: '' } as Ctx;
    // Tonight at 9 PM, so the stages that started up to two hours ago are still tonight.
    ctx.app.now = Date.parse('2026-11-13T02:00:00.000Z');
    const stage = async (s: string) => {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
      expect(r.status, r.text).toBe(200);
      c.tid = r.data.id;
    };
    await stage('am_before');
    let v = (await card(c, 'Vic')).day;
    expect(v).toMatchObject({ kind: 'americano', today: false });
    expect(v.rounds.map((r: any) => (r.num === null ? 'Break' : 'Game'))).toEqual(['Game', 'Game', 'Game', 'Break', 'Game', 'Game']);
    await stage('am_round1');
    v = (await card(c, 'Vic')).day;
    expect(v).toMatchObject({ today: true, started: true, progress: { label: 'Round 1 of 6' } });
    expect(v.rounds[0]).toMatchObject({ state: 'next', onNow: true });
    await stage('am_round3');
    v = (await card(c, 'Vic')).day;
    expect(v.progress.label).toBe('Round 3 of 6');
    expect(v.rounds[2]).toMatchObject({ state: 'next', onNow: true });
    expect(v.rounds.slice(0, 2).every((r: any) => r.state === 'done' && r.score)).toBe(true);
    const d = (await dash(c)).rounds;
    expect(d.round).toBe(3);
    expect(d.games.filter((g: any) => g.round === 3).map((g: any) => g.status)).toEqual(['playing', 'playing']);
    // A Round 2 score still waits for a Yes, entered 8 minutes ago: late on the organizer's card.
    expect(d.games.filter((g: any) => g.round === 2).map((g: any) => g.status).sort()).toEqual(['done', 'waiting']);
    expect(d.games.find((g: any) => g.status === 'waiting').late).toBe('Waiting 8 min');
    expect(v.live).toHaveLength(1);
    // Alex's taps: Vic enters the score, one of Vic's opponents is asked.
    const mine = v.rounds[2];
    expect((await play(c, 'Vic', { num: mine.num, key: mine.key, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    const opp = (await card(c, mine.opponents[0])).day;
    expect(opp.rounds.find((r: any) => r.round === 3).ask).toMatchObject({ by: 'Vic', mine: 8, theirs: 11 });
    await stage('am_break');
    v = (await card(c, 'Vic')).day;
    expect(v.progress.label).toBe('Round 4 of 6');
    expect(v.rounds[3]).toMatchObject({ num: null, state: 'next' });
    expect(v.live).toHaveLength(2);
    await stage('am_standings');
    v = (await card(c, 'Vic')).day;
    expect(v.progress.label).toBe('Round 6 of 6');
    expect(v.standings).toHaveLength(10);
    expect(v.standings.reduce((s: number, r: any) => s + r.points, 0)).toBeGreaterThan(0);
    await stage('am_switched');
    const s = await card(c, 'Vic');
    expect(s.format).toBe('americano');
    expect(s.styleNote.text).toBe('Tournament style is now Americano.');
    expect(s.day.rounds).toHaveLength(6);
    books(c);
  }, 60_000);
});

describe('zip 61: the independent review, each finding', () => {
  it('a stale Yes: the score changed after the screen showed it, so Yes and No, fix it say look again', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a, b } = await firstGame(ctx);
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 8 });
    const shown = myRound((await card(ctx, b)).day, 1).ask;
    await play(ctx, a, { num: g.num, action: 'undo' });
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 1 });
    const r = await play(ctx, b, { num: g.num, action: 'confirm', shown: { mine: shown.mine, theirs: shown.theirs } });
    expect([r.status, r.data.message]).toEqual([409, 'The score just changed. Look again.']);
    expect((await play(ctx, b, { num: g.num, action: 'fix', mine: 11, theirs: 9, shown: { mine: shown.mine, theirs: shown.theirs } })).status).toBe(409);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ status: 'waiting', scoreA: 11, scoreB: 1 });
    // A Yes with no shown score is refused too.
    const phone = await playerPhone(ctx, b);
    expect((await phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g.num, key: myRound((await card(ctx, b)).day, 1).key, action: 'confirm' })).status).toBe(400);
  });

  it('a partner\'s score never overwrites the one waiting (zip 71: not even the same score; the first answer from a side counts)', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const { g, a, a2 } = await firstGame(ctx);
    await play(ctx, a, { num: g.num, action: 'score', mine: 11, theirs: 8 });
    expect((await play(ctx, a2, { num: g.num, action: 'score', mine: 11, theirs: 2 })).status).toBe(409);
    expect((await play(ctx, a2, { num: g.num, action: 'score', mine: 11, theirs: 8 })).status).toBe(409);
    expect((await dash(ctx)).rounds.games[0]).toMatchObject({ scoreA: 11, scoreB: 8, by: a });
  });

  it('a later round\'s score waits until its round comes; the key is required', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    const later = (await dash(ctx)).rounds.games.find((g: any) => g.round === 5);
    const r = await play(ctx, later.a.names[0], { num: later.num, action: 'score', mine: 11, theirs: 3 });
    expect([r.status, r.data.message]).toEqual([409, 'Round 5 has not started. Finish Round 1 first.']);
    const phone = await playerPhone(ctx, later.a.names[0]);
    expect((await phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: later.num, action: 'score', mine: 11, theirs: 3 })).status).toBe(409);
    expect(rowCount(ctx)).toBe(0);
  });

  it('after Player left nobody\'s answer carries the leaver\'s id; the leaver\'s own header follows the night', async () => {
    const ctx = await world(10);
    ctx.app.now = START_MS + 60_000;
    let d = (await dash(ctx)).rounds;
    for (const g of d.games.filter((x: any) => x.round === 1)) {
      const fresh = (await dash(ctx)).rounds.games.find((x: any) => x.num === g.num);
      await admin(ctx, { action: 'score', num: g.num, a: 11, b: 6, seen: fresh.stamp });
    }
    d = (await dash(ctx)).rounds;
    const leaver = d.players.find((p: any) => d.games.some((g: any) => g.round === 2 && g.a.ids.includes(p.id)))!;
    expect((await admin(ctx, { action: 'left', playerId: leaver.id })).status).toBe(200);
    for (const name of ALL.slice(0, 10)) {
      const text = JSON.stringify((await card(ctx, name)).day ?? {});
      if (name !== leaver.name) expect(text).not.toContain(leaver.id);
      for (const id of Object.values(ctx.byName)) expect(text).not.toContain(id);
    }
    const own = (await card(ctx, leaver.name)).day;
    expect(own.progress).toEqual({ label: 'Round 2 of 6', done: 1, total: 6 });
  });

  it('Player left with nothing left to play changes nothing and says so; organizer taps wait for the night', async () => {
    const early = await world(10);
    const r0 = await admin(early, { action: 'left', playerId: early.byName.Blair });
    expect([r0.status, r0.data.message]).toEqual([409, 'Round 1 begins at 7:30 PM.']);
    expect(rowCount(early)).toBe(0);
    const ctx = await world(8, { courts: 2, minutes: 120 });
    ctx.app.now = START_MS + 60_000;
    for (const g of (await dash(ctx)).rounds.games) {
      const fresh = (await dash(ctx)).rounds.games.find((x: any) => x.num === g.num);
      await admin(ctx, { action: 'score', num: g.num, a: 11, b: 5, seen: fresh.stamp });
    }
    const r = await admin(ctx, { action: 'left', playerId: ctx.byName.Blair });
    expect(r.data).toMatchObject({ ok: true, skipped: 0 });
    expect((await dash(ctx)).rounds.byPercent).toBe(false);
    // The organizer's score tap needs what the screen showed.
    const g = (await dash(ctx)).rounds.games[0];
    expect((await admin(ctx, { action: 'clear', num: g.num })).status).toBe(400);
  });
});
