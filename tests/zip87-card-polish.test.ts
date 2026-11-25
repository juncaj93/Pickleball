import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, dash, draftAndPublish, games, group, playPools, potOf, setWinner, START_MS, world, type World } from './zip58-world';
import { cardButtons, dueOf, moneySheet, pillOf, statusWords, stepOf, ticketCount, ticketWords } from '../shared/tournamentCard';
import { boxCostCents, boxWords, prizesOfRow, readPrizes, withPicks, withPrizes } from '../shared/tournamentPrizes';
import { planMoney, suggestedBoxes } from '../shared/tournamentMoney';
import { formatPrice } from '../shared/money';
import type { AdminTournamentView } from '../shared/tournament';

// Zip 87 (🎾87.card polish), on the real server code:
//   1. Prizes for both styles: the boxes are stored in the award settings (no migration), the money line prices the style's own box, the night
//      pays the box of the style actually played, to the cent;
//   2. Locked doubles' 2nd place team is paid again (Alex, reversing Zip 83): each player once, never at $0; all three integrity files read 0;
//   3. "6 of 10 locked in" counts everyone who can make the date (the organizer too), the balls players see;
//   4. the card's buttons over time (pictures 3 to 8), the status line, the pill;
//   5. the look rules (no bold status lines, colors from tokens).

const raw = (ctx: World) => ctx.app.db.raw;
const SQL = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);
/** All three integrity files: every problem column 0 (the info_ ones are counts, not problems). */
function integrity(ctx: World) {
  for (const [file, sql] of SQL) {
    const r = raw(ctx).prepare(sql.replace(/^\s*--.*$/gm, '')).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(v), `${file}: ${k}`).toBe(0);
  }
}
const css = (f: string) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Locked doubles to the Final (Zip 82's helper): pool games by seat order, every playoff game by the lower seat, until End shows. */
async function doublesDone(n: number, secondCents = 0) {
  const ctx = await world(n, { secondCents });
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 60_000;
  await playPools(ctx, (a, b) => Math.min(a, b));
  for (let guard = 0; guard < 20 && !(await adminTour(ctx)).end; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) {
      const tie = d.ties?.[0];
      if (!tie) throw new Error('stuck');
      const r = tie.mode === 'wheel' ? await games(ctx, { action: 'spin', key: tie.key }) : await games(ctx, { action: 'pick', key: tie.key, seat: tie.teams[0].seat, picks: tie.picks });
      expect(r.status, r.text).toBe(200);
      continue;
    }
    for (const g of open) await setWinner(ctx, g.num, Math.min(g.a.seat, g.b.seat));
  }
  expect((await adminTour(ctx)).end).toBeTruthy();
  return ctx;
}

/** Every Americano game by a player's first score (Zip 82's helper), until every round is in. */
async function playAmericano(ctx: World) {
  for (let guard = 0; guard < 60; guard++) {
    const r = (await adminTour(ctx)).rounds;
    const open = r.games.filter((g: any) => g.status === 'playing');
    if (!open.length) return;
    for (const g of open) {
      const who = g.a.names[0];
      const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
      const aWins = g.num % 3 !== 0;
      const res = await (await playerPhone(ctx, who)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
      expect(res.status, res.text).toBe(200);
    }
  }
  throw new Error('the night never ended');
}

/** The Prizes sheet's save: the tournament's own Edit save with both boxes. */
async function savePrizes(ctx: World, prizes: { doubles: { first: number; second: number }; americano: { first: number; second: number } }) {
  const t = await adminTour(ctx);
  return ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { name: t.name, dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: prizes.doubles.first, visibility: t.visibility, prizes });
}

const allNames = async (ctx: World) => (await dash(ctx)).players.map((p: any) => p.name) as string[];

describe('zip 87: the prize boxes (pure)', () => {
  it('reads saved boxes, else the columns exactly as before (Locked doubles never pays the 2nd place amount saved on its row)', () => {
    expect(prizesOfRow({ award_pick: null, champion_credit_cents: 1400, second_credit_cents: 700 })).toEqual({ doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 }, saved: false });
    const json = withPrizes(withPicks(null, { first: '3', second: '2' }), { doubles: { first: 1400, second: 700 }, americano: { first: 1000, second: 500 } });
    expect(JSON.parse(json)).toEqual({ first: '3', second: '2', prizes: { doubles: [1400, 700], americano: [1000, 500] } });
    expect(prizesOfRow({ award_pick: json, champion_credit_cents: 0, second_credit_cents: 0 })).toEqual({ doubles: { first: 1400, second: 700 }, americano: { first: 1000, second: 500 }, saved: true });
    // New picks keep the boxes; a broken JSON reads as the columns.
    expect(JSON.parse(withPicks(json, { first: '1' }))).toEqual({ first: '1', prizes: { doubles: [1400, 700], americano: [1000, 500] } });
    expect(prizesOfRow({ award_pick: '{bad', champion_credit_cents: 900, second_credit_cents: 0 }).saved).toBe(false);
    expect(readPrizes({ doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 } })).not.toBeNull();
    expect(readPrizes({ doubles: { first: 1450, second: 0 }, americano: { first: 1400, second: 700 } })).toBeNull(); // whole dollars only
    expect(readPrizes({ doubles: { first: -100, second: 0 }, americano: { first: 1400, second: 700 } })).toBeNull();
    expect(readPrizes({ doubles: { first: 1400 }, americano: { first: 1400, second: 700 } })).toBeNull();
  });

  it('costs and words: Locked doubles $14 / $0 costs $28, $14 / $7 costs $42; Americano $14 / $7 costs $21; the suggestion for $42 left', () => {
    expect(boxCostCents('doubles', { first: 1400, second: 0 })).toBe(2800);
    expect(boxCostCents('doubles', { first: 1400, second: 700 })).toBe(4200);
    expect(boxCostCents('americano', { first: 1400, second: 700 })).toBe(2100);
    expect(boxWords('doubles', { first: 1400, second: 0 }, formatPrice)).toBe('$14 each to winners');
    expect(boxWords('doubles', { first: 1400, second: 700 }, formatPrice)).toBe('1st $14 · 2nd $7 each');
    expect(boxWords('americano', { first: 1400, second: 700 }, formatPrice)).toBe('1st $14 · 2nd $7');
    expect(boxWords('americano', { first: 0, second: 0 }, formatPrice)).toBe('Medals only');
    // Picture 9: $42 left: Locked doubles $14 / $0 (keep +$14), Americano $14 / $7 (keep +$21). $20 left: doubles medals only, Americano 1st only.
    expect(suggestedBoxes(4200)).toEqual({ doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 } });
    expect(suggestedBoxes(2000)).toEqual({ doubles: { first: 0, second: 0 }, americano: { first: 1400, second: 0 } });
    // The money line prices the style's own box.
    const base = { format: 'doubles' as const, closed: false, expected: 10, courts: 2, minutes: 150, ticketCents: 1800, championCents: 0, secondCents: 0 };
    expect(planMoney({ ...base, prizes: { doubles: { first: 1400, second: 700 }, americano: { first: 1400, second: 700 } } }).youCents).toBe(0);
    expect(planMoney({ ...base, expected: 9, prizes: { doubles: { first: 1400, second: 700 }, americano: { first: 1400, second: 700 } } }).style).toBe('americano');
    expect(planMoney({ ...base, expected: 9, prizes: { doubles: { first: 1400, second: 700 }, americano: { first: 1400, second: 700 } } }).youCents).toBe(16 * 0 + 8 * 1800 - 12000 - 2100);
  });
});

describe('zip 87: Locked doubles 2nd place is paid again, to the cent (money proof)', () => {
  it('$14 each to the winners and $7 each to the runner-up team: each player once; a second End changes nothing; the books and all three integrity files read 0', async () => {
    const ctx = await doublesDone(8);
    // Edit awards on the night: the same Prizes sheet (both boxes), the style played on top.
    const end0 = (await adminTour(ctx)).end;
    const save = await awards(ctx, { action: 'save', first: end0.first.key, championCents: 1400, secondCents: 700, prizes: { doubles: { first: 1400, second: 700 }, americano: { first: 1400, second: 700 } }, weeks: 1 });
    expect(save.status, save.text).toBe(200);
    const end = (await adminTour(ctx)).end;
    expect(end.second).toBeTruthy();
    expect(end.secondCents).toBe(700);
    // The runner-up is the Final's loser (right below the champion, as the board shows).
    expect(end.standings[1].name).toBe(end.second.name);
    const firsts = end.first.players as string[];
    const seconds = end.second.players as string[];
    expect(seconds).toHaveLength(2);
    const all = await allNames(ctx);
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
    for (const n of all) expect(potOf(ctx, n), n).toBe(before[n] + (firsts.includes(n) ? 1400 : seconds.includes(n) ? 700 : 0));
    expect(raw(ctx).prepare("SELECT COUNT(*) AS c FROM tournament_results WHERE tournament_id = ? AND award = 'second'").get(ctx.tid)).toEqual({ c: 2 });
    expect(raw(ctx).prepare("SELECT COUNT(*) AS c, SUM(amount_cents) AS s FROM credit_ledger WHERE reason = ?").get(`tour:${ctx.tid}:second`)).toEqual({ c: 2, s: 1400 });
    expect(raw(ctx).prepare("SELECT COUNT(*) AS c, SUM(amount_cents) AS s FROM credit_ledger WHERE reason = ?").get(`tour:${ctx.tid}:champion`)).toEqual({ c: 2, s: 2800 });
    // Medals only for the winners; the runner-ups see "Second place".
    const medals = raw(ctx).prepare('SELECT p.display_name AS n FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? AND r.medal = 1').all(ctx.tid) as { n: string }[];
    expect(medals.map((m) => m.n).sort()).toEqual([...firsts].sort());
    for (const n of seconds) expect((await group(ctx, n)).tourAwards?.congrats?.title, n).toMatch(/^Second place/);
    books(ctx);
    integrity(ctx);
  });

  it('a 2nd place team at $0 is never paid: no 2nd place rows, no credit, no card (even with $7 saved on the old column)', async () => {
    const ctx = await doublesDone(8, 700);
    const end0 = (await adminTour(ctx)).end;
    expect(end0.second).toBeNull(); // no saved boxes: as before (the column's $7 is never Locked doubles' 2nd place)
    expect((await awards(ctx, { action: 'save', first: end0.first.key, championCents: 1400, secondCents: 0, prizes: { doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 } }, weeks: 1 })).status).toBe(200);
    const end = (await adminTour(ctx)).end;
    expect(end.second).toBeNull();
    expect(end.secondCents).toBe(0);
    const firsts = end.first.players as string[];
    const all = await allNames(ctx);
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    for (const n of all) expect(potOf(ctx, n), n).toBe(before[n] + (firsts.includes(n) ? 1400 : 0));
    expect(raw(ctx).prepare("SELECT COUNT(*) AS c FROM tournament_results WHERE tournament_id = ? AND award = 'second'").get(ctx.tid)).toEqual({ c: 0 });
    for (const n of all.filter((x) => !firsts.includes(x))) expect((await group(ctx, n)).tourAwards?.congrats, n).toBeUndefined();
    books(ctx);
    integrity(ctx);
  });

  it('Edit awards can move 2nd place to another team (paid instead of the Final’s loser); 1st and 2nd can never be the same team', async () => {
    const ctx = await doublesDone(8);
    const end0 = (await adminTour(ctx)).end;
    const third = end0.choices.find((c: any) => c.key !== end0.first.key && !(end0.standings[1].name === c.name));
    const r = await awards(ctx, { action: 'save', first: end0.first.key, second: third.key, championCents: 1400, secondCents: 700, prizes: { doubles: { first: 1400, second: 700 }, americano: { first: 0, second: 0 } }, weeks: 1 });
    expect(r.status, r.text).toBe(200);
    const end = (await adminTour(ctx)).end;
    expect(end.second.key).toBe(third.key);
    expect(end.standings[1].name).toBe(third.name);
    // The same team for 1st and 2nd is refused.
    expect((await awards(ctx, { action: 'save', first: end0.first.key, second: end0.first.key, championCents: 1400, secondCents: 700, weeks: 1 })).status).toBe(409);
    const all = await allNames(ctx);
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const org = (await dash(ctx)).group.organizerName as string;
    for (const n of all) expect(potOf(ctx, n), n).toBe(before[n] + (n === org ? 0 : end.first.players.includes(n) ? 1400 : third.players.includes(n) ? 700 : 0));
    books(ctx);
    integrity(ctx);
  });
});

describe('zip 87: both boxes saved before the night; the night pays the box of the style played', () => {
  it('saved on the Prizes sheet (the Edit save): the columns hold the planned box, the money line prices it, Edit keeps the boxes', async () => {
    // Zip 89: 2.5 hours asked for (the 8-player world is 2 hours unless asked): the money line prices these courts.
    const ctx = await world(8, { minutes: 150 });
    // Before the night (Pay by just passed in this world; the night not started).
    const r = await savePrizes(ctx, { doubles: { first: 1400, second: 700 }, americano: { first: 1000, second: 500 } });
    expect(r.status, r.text).toBe(200);
    const t = (await adminTour(ctx)) as AdminTournamentView;
    expect(t.prizes).toEqual({ doubles: { first: 1400, second: 700 }, americano: { first: 1000, second: 500 }, saved: true });
    expect(raw(ctx).prepare('SELECT champion_credit_cents AS c, second_credit_cents AS s FROM tournaments WHERE id = ?').get(ctx.tid)).toEqual({ c: 1400, s: 700 });
    // 8 expected on Locked doubles: 7 x $16 = $112 - courts $120 - prizes (14 + 7) x 2 = $42: -$50.
    expect(t.money!.youCents).toBe(7 * 1600 - 12000 - 4200);
    // A save from the Edit page that leaves the amounts alone keeps both boxes.
    const keep = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { name: 'The Cold Open!', dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: 1400, secondCreditCents: 0, visibility: 'all', format: 'doubles', prizes: { doubles: t.prizes!.doubles, americano: t.prizes!.americano } });
    expect(keep.status, keep.text).toBe(200);
    expect(((await adminTour(ctx)) as AdminTournamentView).prizes).toEqual(t.prizes);
    // An older screen that sends only the amounts changes only the box of its style.
    const old = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { name: 'The Cold Open', dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: 1200, visibility: 'all' });
    expect(old.status, old.text).toBe(200);
    expect(((await adminTour(ctx)) as AdminTournamentView).prizes).toEqual({ doubles: { first: 1200, second: 700 }, americano: { first: 1000, second: 500 }, saved: true });
    // Refused: not whole dollars.
    expect((await savePrizes(ctx, { doubles: { first: 1450, second: 0 }, americano: { first: 0, second: 0 } })).status).toBe(400);
  });

  it('an odd count plays Americano: the Americano box is paid ($10 to 1st, $5 to 2nd), never the Locked doubles box', async () => {
    const ctx = await world(9);
    expect((await savePrizes(ctx, { doubles: { first: 1400, second: 700 }, americano: { first: 1000, second: 500 } })).status).toBe(200);
    const t0 = (await adminTour(ctx)) as AdminTournamentView;
    expect(t0.format).toBe('americano');
    ctx.app.now = START_MS + 60_000;
    await playAmericano(ctx);
    const end = (await adminTour(ctx)).end;
    expect(end.format).toBe('americano');
    expect([end.championCents, end.secondCents]).toEqual([1000, 500]);
    const all = await allNames(ctx);
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    const org = (await dash(ctx)).group.organizerName as string;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    for (const n of all) {
      const want = n === org ? 0 : n === end.first.name ? 1000 : n === end.second.name ? 500 : 0;
      expect(potOf(ctx, n), n).toBe(before[n] + want);
    }
    books(ctx);
    integrity(ctx);
  });
});

describe('zip 87: "6 of 10", the buttons over time, the status line, the pill', () => {
  const tz = 'America/Detroit';
  const now = '2026-11-19T15:00:00.000Z'; // Thu Nov 19, 10 AM Eastern
  const signup = (id: string, dates = ['2026-12-01']) => ({ playerId: id, name: id, pickedLevel: 300, level: 300, reviewed: false, dates, at: now });
  const spot = (id: string, extra: Partial<NonNullable<AdminTournamentView['tickets']>[number]> = {}) => ({
    playerId: id,
    name: id,
    place: 'spot' as const,
    placeAt: now,
    priceCents: 1800,
    creditCents: 0,
    paidCents: 1800,
    claimCents: 0,
    claimAt: null,
    out: false,
    organizer: false,
    ...extra,
  });
  const ten = ['Alex', 'P', 'R', 'S', 'C', 'W', 'V', 'Z', 'Q', 'E'];
  function view(paid: string[], o: Partial<AdminTournamentView> = {}): AdminTournamentView {
    const tickets = paid.map((id) => spot(id, id === 'Alex' ? { priceCents: 0, paidCents: 0, organizer: true } : {}));
    return {
      id: 't',
      name: 'The Cold Open',
      format: 'doubles',
      formatLocked: false,
      status: 'tickets',
      visibility: 'all',
      size: 8,
      courts: 2,
      minutes: 150,
      start: 19 * 60 + 30,
      startSet: true,
      ticketCents: 1800,
      championCreditCents: 0,
      secondCreditCents: 0,
      offeredDates: ['2026-12-01'],
      finalDate: '2026-12-01',
      createdAt: now,
      signups: [...ten.map((x) => signup(x)), signup('Off', ['2026-12-03'])],
      backedOut: [],
      payBy: '2026-12-01T00:00:00.000Z', // Mon Nov 30, 7 PM Eastern
      closed: false,
      over: false,
      tickets,
      lockedIn: tickets.length,
      spots: 8,
      money: { courtCents: 12000, ticketsCents: 16200, youCents: 4200, style: 'doubles' },
      ...o,
    } as AdminTournamentView;
  }
  const words = (t: AdminTournamentView, at = now) => Object.fromEntries(cardButtons(t, at, tz).map((b) => [b.key, `${b.tone}|${b.subTone}|${b.sub}`]));

  it('6 of 10: every one on the list who can make the date (Alex too), not the smart plan’s 8; a standby player is not in the 10; All 10 at the end', () => {
    const t = view(['Alex', 'P', 'R', 'S', 'C', 'W']);
    expect(t.spots).toBe(8);
    expect(ticketCount(t)).toEqual({ locked: 6, total: 10 });
    expect(ticketWords(ticketCount(t))).toBe('6 of 10 locked in');
    const standby = view(['Alex', 'P', 'R', 'S', 'C', 'W'], { tickets: [...view(['Alex', 'P', 'R', 'S', 'C', 'W']).tickets!, { ...spot('Q'), place: 'line' }] });
    expect(ticketCount(standby)).toEqual({ locked: 6, total: 9 });
    expect(ticketWords(ticketCount(view(ten)))).toBe('All 10 locked in');
  });

  it('pictures 3 to 6: early (plain Remind, amber words), Pay by day (amber tint), past Pay by (red tint), everyone paid (quiet), Tickets soft then solid', () => {
    const early = view(['Alex', 'P', 'R', 'S', 'C', 'W']);
    expect(words(early)).toEqual({
      tickets: 'soft|green|6 of 10 locked in',
      remind: 'plain|amber|4 haven’t paid',
      prizes: 'plain|gray|Not set yet',
      money: 'plain|green|+$42 if all pay',
    });
    expect(statusWords(early, now, tz, dueOf(early).length)).toBe('Payments · pay by Mon 7 PM');
    expect(pillOf(early)).toEqual({ words: '4 unpaid', unpaid: true });
    expect(stepOf(early)).toBe(1);
    // Pay by day (Mon Nov 30, 10 AM): amber tint "2 left · due 7 PM".
    const payDay = view(['Alex', 'P', 'R', 'S', 'C', 'W', 'V', 'Z']);
    expect(words(payDay, '2026-11-30T15:00:00.000Z').remind).toBe('amber|amber|2 left · due 7 PM');
    expect(statusWords(payDay, '2026-11-30T15:00:00.000Z', tz, 2)).toBe('Payments · pay by today 7 PM');
    // After Pay by (Mon Nov 30, 8 PM): red tint "1 past due", the pill still counts them.
    const past = view(['Alex', 'P', 'R', 'S', 'C', 'W', 'V', 'Z', 'Q']);
    expect(words(past, '2026-12-01T01:00:00.000Z').remind).toBe('red|red|1 past due');
    expect(pillOf(past)).toEqual({ words: '1 unpaid', unpaid: true });
    expect(statusWords(past, '2026-12-01T01:00:00.000Z', tz, 1)).toBe('Payments · Pay by passed');
    // Everyone paid before game day: quiet Remind, solid Tickets, green pill.
    const all = view(ten);
    expect(words(all)).toMatchObject({ tickets: 'solid|white|All 10 locked in', remind: 'quiet|gray|Everyone paid' });
    expect(pillOf(all)).toEqual({ words: '10 locked in', unpaid: false });
    expect(statusWords(all, now, tz, 0)).toBe('Payments · all paid');
    // Review fixes: every spot taken is not "all paid"; no Pay by: nobody to remind (never a crash on a missing date).
    const full = view(ten, { tickets: [...view(ten).tickets!, ...Array.from({ length: 6 }, (_, i) => spot(`X${i}`))] });
    expect(statusWords(full, now, tz, dueOf(full).length)).toBe('Payments · every spot taken');
    const noPayBy = view(['Alex', 'P'], { payBy: null });
    expect(dueOf(noPayBy)).toEqual([]);
    expect(words(noPayBy).remind).toBe('quiet|gray|No pay by set');
    // Below 0 the money is red with a real minus sign.
    expect(words(view(ten, { money: { courtCents: 12000, ticketsCents: 11400, youCents: -600, style: 'doubles' } })).money).toBe('plain|red|−$6 if all pay');
  });

  it('pictures 7 and 8: game day is Game night (Teams amber until published, Prizes amber until set, then soft green; Money "You keep")', () => {
    const at = '2026-12-01T15:00:00.000Z'; // Tue Dec 1, 10 AM Eastern
    const day = view(ten, { payBy: '2026-12-01T00:00:00.000Z' });
    expect(stepOf(day, true)).toBe(2);
    expect(statusWords(day, at, tz, 0)).toBe('Game night · 7:30 PM');
    expect(words(day, at)).toEqual({
      tickets: 'solid|white|All 10 locked in',
      teams: 'amber|amber|Draft before 7:30',
      prizes: 'amber|amber|Set before tonight',
      money: 'plain|green|+$42 if all pay',
    });
    const set = view(ten, {
      prizes: { doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 }, saved: true },
      money: { courtCents: 12000, ticketsCents: 16200, youCents: 1400, style: 'doubles' },
      day: { phase: 'published', teams: [1, 2, 3, 4, 5].map((seat) => ({ seat })) } as unknown as AdminTournamentView['day'],
    });
    expect(words(set, at)).toEqual({
      tickets: 'solid|white|All 10 locked in',
      teams: 'soft|green|5 teams set',
      prizes: 'soft|green|$14 each to winners',
      money: 'plain|green|You keep +$14',
    });
    // Americano: no draft, nothing to do: Rounds, soft green with the real count (Alex, round 2).
    const am = view(ten, { format: 'americano', rounds: { courtNumbers: null, plan: { rounds: 6 } } as unknown as AdminTournamentView['rounds'] });
    expect(words(am, at).rounds).toBe('soft|green|6 rounds ready');
    // A saved $0 box is set ("Medals only"), never "Not set yet".
    expect(words(view(ten, { prizes: { doubles: { first: 0, second: 0 }, americano: { first: 0, second: 0 }, saved: true } })).prizes).toBe('soft|green|Medals only');
    // The Money sheet follows the box (a saved $0 box is set).
    expect(moneySheet(view(ten, { prizes: { doubles: { first: 0, second: 0 }, americano: { first: 0, second: 0 }, saved: true }, cost: { courtCents: 12000, ifFillsCents: 0, nowCents: 0, paidNow: 9 } }))!.prizeAllWords).toBe('Medals only');
  });

  it('the look: status lines never bold, the buttons’ tints from the tokens, the Prizes sheet without the old note', () => {
    const c = css('src/pages/admin/tournament-card87.css');
    expect(c).toMatch(/\.tm87 \.tm86-btn-sub,\s*\.tm87 \.tm86-btn-sub\.tm86-amber \{\s*font-weight: 500;/);
    for (const f of ['src/pages/admin/tournament-card87.css', 'src/pages/admin/prize-boxes.css']) expect(css(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    const tsx = readFileSync(join(process.cwd(), 'src/pages/admin/Tournament.tsx'), 'utf8');
    const sheet = tsx.slice(tsx.indexOf('function PrizesBody('), tsx.indexOf('// Zip 56, piece 2: tickets'));
    expect(sheet.length).toBeGreaterThan(100);
    expect(sheet).not.toContain('Medal and banner are automatic');
    expect(readFileSync(join(process.cwd(), 'src/pages/admin/PrizeBoxes.tsx'), 'utf8')).toContain("'If Americano'");
  });
});
