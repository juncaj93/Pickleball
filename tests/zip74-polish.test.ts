import { describe, expect, it } from 'vitest';
import { HOUR, playerPhone } from './harness';
import { ALL, adminTour, books, card, DATE, draftAndPublish, games, PAY_BY_MS, playPools, potOf, START_MS, teams, world, type World } from './zip58-world';
import { fitWords, nightPlan } from '../shared/tournamentPlan';
import { theName } from '../shared/credit';
import { shortAlertOf } from '../shared/tournament';
import { timeCheck, type RoundState } from '../shared/tournamentSchedule';

// Zip 74 (🎾74.polish): the 🎾73 audit's fixes and the game night polish, on the real server code.
//   - The cap: before Pay by, a whole-ticket I paid can never push the players locked in past 16 (Lock in's full rule); Draft teams never 500s.
//   - "too tight" on 2 courts no longer says "Use 2 courts".
//   - "the The Cold Open" nowhere.
//   - Play to 9: the alert for every player (stable words while the night goes on, a new one for a second shortening), the Final and 3rd place
//     always to 11, the Time check never shortens a playoff.
//   - The Final alert: only the 4 players in it.
//   - The team name sheet's Randomize saves nothing.

const raw = (ctx: World) => ctx.app.db.raw;
const phone = (ctx: World, name: string) => playerPhone(ctx, name);
const lockedIn = (ctx: World) =>
  Number(
    (
      raw(ctx)
        .prepare(
          `SELECT COUNT(*) AS n FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id AND s.status = 'in'
           WHERE k.tournament_id = ? AND (k.place = 'spot' OR (k.place <> 'line' AND k.claim_cents > 0 AND k.credit_cents + k.paid_cents + k.claim_cents >= k.price_cents))`,
        )
        .get(ctx.tid) as { n: number }
    ).n,
  );
const ticket = (ctx: World, name: string) => raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as any;

/** 15 locked in (credit), Pay by tomorrow; the last 3 names signed up with no ticket yet. */
async function nearlyFull() {
  const ctx = await world(15);
  ctx.app.now = PAY_BY_MS - 6 * HOUR; // before Pay by
  for (const name of ALL.slice(15, 18)) {
    const r = await (await phone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 300, dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  expect(lockedIn(ctx)).toBe(15);
  return ctx;
}
const lock = async (ctx: World, name: string) => (await phone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
const iPaid = async (ctx: World, name: string) => (await phone(ctx, name)).call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 });

describe('zip 74: the cap of 16, before Pay by too', () => {
  it('an I paid waiting fills the 16th place: the next I paid and the next Lock are refused, standby still works, nothing moves', async () => {
    const ctx = await nearlyFull();
    const [p16, p17, p18] = ALL.slice(15, 18);
    // Two players tap Lock while 15 are in (no credit: each owes $16, nothing is held yet).
    for (const n of [p16, p17]) expect((await lock(ctx, n)).data.result).toBe('due');
    // p16's I paid: the 16th locked in (the trust rule).
    expect((await iPaid(ctx, p16)).status).toBe(200);
    expect(lockedIn(ctx)).toBe(16);
    // p17's I paid would be the 17th: refused, nothing saved.
    const before = JSON.stringify(ticket(ctx, p17));
    const r = await iPaid(ctx, p17);
    expect(r.status).toBe(409);
    expect(r.data.message).toBe('Every spot just filled. Join standby.');
    expect(JSON.stringify(ticket(ctx, p17))).toBe(before);
    expect(lockedIn(ctx)).toBe(16);
    // Their card says full (Join standby), and standby takes them.
    expect((await card(ctx, p17)).tickets.full).toBe(true);
    const w = await (await phone(ctx, p17)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid });
    expect(w.status, w.text).toBe(200);
    expect(ticket(ctx, p17).place).toBe('line');
    // A fresh Lock is refused too (spots are 15, but 16 are locked in).
    const l = await lock(ctx, p18);
    expect(l.status).toBe(409);
    expect(l.data.message).toBe('Every spot just filled. Join standby.');
    expect(lockedIn(ctx)).toBe(16);
    // The organizer confirms p16: the 16th spot. Still 16, the books read 0.
    const ok = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[p16], action: 'confirm', cents: 1600 });
    expect(ok.status, ok.text).toBe(200);
    expect(ticket(ctx, p16).place).toBe('spot');
    expect(lockedIn(ctx)).toBe(16);
    books(ctx);
  });

  it('a standby I paid (in line) and a spot holder never count past the cap', async () => {
    const ctx = await nearlyFull();
    const [p16, p17] = ALL.slice(15, 17);
    expect((await lock(ctx, p16)).data.result).toBe('due');
    expect((await iPaid(ctx, p16)).status).toBe(200);
    // p17 joins standby first, then pays: a held place in line is not locked in, so it is allowed.
    expect((await (await phone(ctx, p17)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).status).toBe(200);
    const hold = await (await phone(ctx, p17)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'hold', priceCents: 1600 });
    expect(hold.status, hold.text).toBe(200);
    const paid = await iPaid(ctx, p17);
    expect(paid.status, paid.text).toBe(200);
    expect(ticket(ctx, p17)).toMatchObject({ place: 'line', claim_cents: 1600 });
    expect(lockedIn(ctx)).toBe(16);
    // The review's case: the organizer confirms p17 (standby) FIRST. p16's waiting I paid already holds the 16th place, so p17 stays in line.
    const c17 = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[p17], action: 'confirm', cents: 1600 });
    expect(c17.status, c17.text).toBe(200);
    expect(ticket(ctx, p17).place).toBe('line');
    expect(lockedIn(ctx)).toBe(16);
    // Then p16: the 16th spot. Still 16.
    const c16 = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[p16], action: 'confirm', cents: 1600 });
    expect(c16.status, c16.text).toBe(200);
    expect(ticket(ctx, p16).place).toBe('spot');
    expect(ticket(ctx, p17).place).toBe('line');
    expect(lockedIn(ctx)).toBe(16);
    // A repeat Lock from p16 is a harmless no-op.
    expect((await lock(ctx, p16)).status).toBe(200);
    books(ctx);
  });

  it('a standby hold paid with credit waits behind a waiting I paid (no 17th through the line)', async () => {
    const ctx = await nearlyFull();
    const [p16, p17] = ALL.slice(15, 17);
    expect((await lock(ctx, p16)).data.result).toBe('due');
    expect((await iPaid(ctx, p16)).status).toBe(200);
    const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[p17]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen: potOf(ctx, p17) });
    expect(give.status, give.text).toBe(200);
    expect((await (await phone(ctx, p17)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).status).toBe(200);
    const hold = await (await phone(ctx, p17)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'hold', priceCents: 1600 });
    expect(hold.status, hold.text).toBe(200);
    expect(ticket(ctx, p17)).toMatchObject({ place: 'line', credit_cents: 1600 });
    expect(lockedIn(ctx)).toBe(16);
    // The organizer says p16 did not pay: the reserved place opens and p17 (paid, first in line) takes it in the same step.
    const no = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[p16], action: 'reject', cents: 1600 });
    expect(no.status, no.text).toBe(200);
    expect(ticket(ctx, p17).place).toBe('spot');
    expect(lockedIn(ctx)).toBe(16);
    books(ctx);
  });

  it('Draft teams never 500s: more than 16 locked in (an old row) gives a plain answer', async () => {
    const ctx = await nearlyFull();
    for (const n of ALL.slice(15, 18)) expect((await lock(ctx, n)).data.result).toBe('due');
    // Rows written past the cap on purpose (as before this zip): 18 locked in.
    raw(ctx).prepare("UPDATE tournament_tickets SET claim_cents = 1600, claim_at = '2026-11-11T12:00:00.000Z' WHERE tournament_id = ? AND place = 'none'").run(ctx.tid);
    expect(lockedIn(ctx)).toBe(18);
    ctx.app.now = PAY_BY_MS + 60_000;
    const day = (await adminTour(ctx)).day;
    expect(day.canDraft).toBe(false);
    expect(day.why).toBe('18 are locked in. Take 2 off first (16 at most).');
    const d = await teams(ctx, { action: 'draft' });
    expect(d.status).toBe(409);
    expect(d.text).toContain('Take 2 off first');
  });
});

describe('zip 74: words', () => {
  it('too tight on 2 courts suggests a later end, not "Use 2 courts"; 1 court unchanged', () => {
    expect(fitWords(nightPlan(16, 2, 90, 'doubles'), 19 * 60 + 30)).toEqual({ fits: false, text: 'Locked doubles for 16: too tight on 2 courts. Move the end later.' });
    expect(fitWords(nightPlan(12, 1, 120, 'doubles'), 19 * 60 + 30).text).toBe('Locked doubles for 12: too tight on 1 court. Use 2 courts or add court time.');
  });
  it('"the The Cold Open" never: a name that starts with The stays as it is', () => {
    expect(theName('The Cold Open')).toBe('The Cold Open');
    expect(theName('the snow bowl')).toBe('the snow bowl');
    expect(theName('Winter Classic')).toBe('the Winter Classic');
    expect(theName('Theodore Cup')).toBe('the Theodore Cup');
  });
});

describe('zip 74: Play to 9 and the Final to 11', () => {
  it('shortAlertOf: the words stay put while the night goes on; a second shortening is a new alert; none once nothing short is left', () => {
    const g = (round: number, playTo: number, decided = false, pool = true) => ({ round, playTo, pool, decided });
    const a = shortAlertOf('t1', [g(1, 11, true), g(2, 9), g(3, 9), g(4, 11, false, false)], 11)!;
    expect(a).toEqual({ key: 'short:t1:2:9', title: 'Starting Round 2, all games go to 9 points.', sub: 'We’re running behind, so games are shorter.' });
    // Round 2 done: still "Starting Round 2" (same key, so a dismissed alert stays dismissed).
    expect(shortAlertOf('t1', [g(1, 11, true), g(2, 9, true), g(3, 9), g(4, 11, false, false)], 11)!.key).toBe('short:t1:2:9');
    // Shortened again, to 7 from Round 4: a new alert.
    expect(shortAlertOf('t1', [g(1, 11, true), g(2, 9, true), g(3, 9, true), g(4, 7), g(5, 7), g(6, 11, false, false)], 11)).toMatchObject({ key: 'short:t1:4:7', title: 'Starting Round 4, all games go to 7 points.' });
    // Every short game played (only the Final left): no alert.
    expect(shortAlertOf('t1', [g(1, 11, true), g(2, 9, true), g(3, 11, false, false)], 11)).toBeUndefined();
    // A plan already to 9 (pools) is not "shorter".
    expect(shortAlertOf('t1', [g(1, 9), g(2, 9)], 9)).toBeUndefined();
  });

  it('the Time check counts the Final at 11 and never shortens it', () => {
    const r = (round: number, pool = true, done = false): RoundState => ({ round, pool, playTo: 11, done, anyResult: done, doneAt: done ? 19 * 60 + 30 + round * 40 : undefined });
    // Way behind after Round 1: the suggestion shortens pool rounds only; the Final round keeps its full length in the math.
    const c = timeCheck([r(1, true, true), r(2), r(3), r(4, false)], 19 * 60 + 30, 21 * 60 + 30, 20 * 60 + 40);
    expect(c.suggest).not.toBeNull();
    expect(c.suggest!.fromRound).toBeLessThanOrEqual(3);
    const longFinal = timeCheck([r(1, true, true), r(2), r(3), r(4, false)], 19 * 60 + 30, 24 * 60, 20 * 60 + 40);
    const noFinal = timeCheck([r(1, true, true), r(2), r(3)], 19 * 60 + 30, 24 * 60, 20 * 60 + 40);
    expect(longFinal.finish - noFinal.finish).toBeGreaterThanOrEqual(20); // the Final's full length is always in the finish
  });

  it('Locked doubles, 8 players: Alex shortens to 9 at Round 2: every player gets the alert and the pills; to 7 later is a new alert; the Final and 3rd place stay at 11; the 4 finalists get the Final alert', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 5 * 60_000;
    const d = (await adminTour(ctx)).day;
    // Round 1 played by Alex's Fix.
    for (const g of d.games.filter((x: any) => x.round === 1)) expect((await games(ctx, { action: 'result', num: g.num, winner: 'a' })).status).toBe(200);
    const ap = await games(ctx, { action: 'apply', fromRound: 2, to: 9 });
    expect(ap.status, ap.text).toBe(200);
    const names = ALL.slice(0, 8);
    for (const n of names) {
      const c = (await card(ctx, n)).day;
      expect(c.shortAlert, n).toEqual({ key: `short:${ctx.tid}:2:9`, title: 'Starting Round 2, all games go to 9 points.', sub: 'We’re running behind, so games are shorter.' });
      // Your games: the shortened pool games are to 9; the Final row stays 11; the old "· to 9" text is gone from the sub line.
      for (const g of c.games) {
        if (g.stage === 'pool' && g.round >= 2) expect(g.playTo).toBe(9);
        if (g.stage === 'final' || g.stage === 'third') expect(g.playTo).toBe(11);
      }
    }
    const rows = raw(ctx).prepare('SELECT stage, play_to FROM tournament_games WHERE tournament_id = ?').all(ctx.tid) as { stage: string; play_to: number }[];
    expect(rows.filter((x) => x.stage !== 'pool').every((x) => x.play_to === 11)).toBe(true);
    // Round 2 played; then to 7 from Round 3: a new alert.
    for (const g of (await adminTour(ctx)).day.games.filter((x: any) => x.round === 2)) expect((await games(ctx, { action: 'result', num: g.num, winner: 'a' })).status).toBe(200);
    expect((await card(ctx, names[0])).day.shortAlert.key).toBe(`short:${ctx.tid}:2:9`);
    expect((await games(ctx, { action: 'apply', fromRound: 3, to: 7 })).status).toBe(200);
    expect((await card(ctx, names[0])).day.shortAlert).toMatchObject({ key: `short:${ctx.tid}:3:7`, title: 'Starting Round 3, all games go to 7 points.' });
    // The pools to the end (seat order: 1 and 2 to the Final, 3 and 4 to 3rd place). No Final alert before the Final is set.
    await playPools(ctx, (a, b) => Math.min(a, b));
    const after = (await adminTour(ctx)).day;
    const fin = after.games.find((g: any) => g.stage === 'final');
    expect(fin.a && fin.b).toBeTruthy();
    expect(raw(ctx).prepare("SELECT play_to FROM tournament_games WHERE tournament_id = ? AND stage IN ('final', 'third')").all(ctx.tid).every((x: any) => x.play_to === 11)).toBe(true);
    const finalists = new Set([...after.teams.find((x: any) => x.seat === fin.a.seat).players, ...after.teams.find((x: any) => x.seat === fin.b.seat).players].map((p: any) => p.name));
    expect(finalists.size).toBe(4);
    for (const n of names) {
      const c = (await card(ctx, n)).day;
      // Nothing short left to play: the shorter games alert is gone.
      expect(c.shortAlert, n).toBeUndefined();
      if (finalists.has(n)) expect(c.finalAlert, n).toEqual({ key: `final:${ctx.tid}:${fin.num}:${fin.a.seat}-${fin.b.seat}`, title: 'You’re in the Final! It goes to 11 points.', sub: `Head to Court ${fin.court ?? 1}.` });
      else expect(c.finalAlert, n).toBeUndefined();
    }
    // The Final played: the alert goes.
    expect((await games(ctx, { action: 'result', num: fin.num, a: 11, b: 8 })).status).toBe(200);
    for (const n of finalists) expect((await card(ctx, n)).day.finalAlert).toBeUndefined();
    // No money moved; the books read 0.
    books(ctx);
    for (const n of names) expect(potOf(ctx, n)).toBe(0);
  });

  it('Americano, 9 players: shortening shows the same alert to every player; the last round is never shortened', async () => {
    const ctx = await world(9);
    // The first read after Pay by switches an odd count to Americano (Zip 64's rule).
    await adminTour(ctx);
    ctx.app.now = START_MS + 5 * 60_000;
    expect(raw(ctx).prepare('SELECT format FROM tournaments WHERE id = ?').get(ctx.tid)).toMatchObject({ format: 'americano' });
    const ap = await games(ctx, { action: 'apply', fromRound: 2, to: 9 });
    expect(ap.status, ap.text).toBe(200);
    for (const n of ALL.slice(0, 9)) {
      const c = (await card(ctx, n)).day;
      expect(c.shortAlert, n).toMatchObject({ key: `short:${ctx.tid}:2:9`, title: 'Starting Round 2, all games go to 9 points.' });
      const last = Math.max(...c.rounds.map((r: any) => r.round));
      expect(c.rounds.find((r: any) => r.round === last).playTo).toBe(11);
    }
  });
});

describe('zip 74: the team name sheet', () => {
  it('Randomize suggests a name nobody else has and saves nothing; Save keeps the duplicate rule', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    const d = (await adminTour(ctx)).day;
    const t1 = d.teams[0];
    const t2 = d.teams[1];
    const p = await phone(ctx, t1.players[0].name);
    const before = raw(ctx).prepare('SELECT id, name FROM tournament_teams WHERE tournament_id = ? ORDER BY id').all(ctx.tid);
    const others = d.teams.filter((x: any) => x.seat !== t1.seat).map((x: any) => x.name);
    for (let i = 0; i < 8; i++) {
      const r = await p.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, suggest: true, not: 'Lob Stars' });
      expect(r.status, r.text).toBe(200);
      expect(r.data.suggested).toBe(true);
      expect(others).not.toContain(r.data.name);
      expect(r.data.name).not.toBe('Lob Stars');
    }
    expect(raw(ctx).prepare('SELECT id, name FROM tournament_teams WHERE tournament_id = ? ORDER BY id').all(ctx.tid)).toEqual(before);
    // Save: another team's name is refused; a new one is saved.
    const dup = await p.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: t2.name });
    expect(dup.status).toBe(409);
    const ok = await p.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: 'Kitchen Sinkers' });
    expect(ok.status, ok.text).toBe(200);
    expect((await card(ctx, t1.players[1].name)).day.team.name).toBe('Kitchen Sinkers');
    // After Game 1 starts: no Edit name (canRename gone), and the server refuses.
    ctx.app.now = START_MS + 60_000;
    expect((await card(ctx, t1.players[0].name)).day.team.canRename).toBeUndefined();
    expect((await p.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: 'Big Dills' })).status).toBe(409);
  });
});
