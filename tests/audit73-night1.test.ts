import { describe, expect, it } from 'vitest';
import { payCountdown } from '../shared/tournamentTickets';
import {
  ALL, CUTOFF_MS, DATE, END_MS, HOUR, MIN, PAY_BY_MS, START_MS, adminTour, allPots, answer, awards, books, booksBad, card, coldOpen, dash, finalize, gamesA, giveCredit,
  group, history, iPaid, lock, moneyTotals, phone, pot, score, signUp, teams, ticket, type W,
} from './audit73-world';

// 🎾73.audit, Part A night 1: 10 players, Locked doubles, The Cold Open's real settings, from Finalize to the next morning.
const soft = expect.soft;
const log = (label: string, x: unknown) => console.log(`\n=== ${label}\n${typeof x === 'string' ? x : JSON.stringify(x, null, 1).slice(0, 4000)}`);
const ten = ALL.slice(0, 11); // Alex..Kit, with Gale (index 6) on Dec 8 only

async function lockedTen(w: W) {
  for (const n of ten) await signUp(w, n, n === 'Gale' ? ['2026-12-08'] : [DATE, '2026-12-08'], n === 'Blair' || n === 'Casey' ? 'locked' : 'either');
  const f = await finalize(w);
  soft(f.payBy, 'Pay by Mon Nov 30 7 PM').toBe(new Date(PAY_BY_MS).toISOString());
  soft(f.format, 'vote winner').toBe('doubles');
  // Credit (whole ticket), credit + I paid, I paid, a Didn't pay then paid again.
  await giveCredit(w, 'Blair', 1800);
  await giveCredit(w, 'Casey', 2500);
  await giveCredit(w, 'Devon', 1000);
  for (const n of ['Blair', 'Casey']) soft((await lock(w, n)).data.result, `${n} credit lock`).toBe('locked');
  const d = await lock(w, 'Devon');
  soft(d.data, 'Devon part credit').toMatchObject({ creditUsedCents: 1000, dueCents: 800, result: 'due' });
  soft((await iPaid(w, 'Devon', 800)).status).toBe(200);
  for (const n of ['Emery', 'Frankie', 'Harper', 'Indy', 'Jules', 'Kit']) {
    soft((await lock(w, n)).data.dueCents, `${n} due`).toBe(1800);
    soft((await iPaid(w, n, 1800)).status, `${n} I paid`).toBe(200);
  }
  // A second I paid (double tap) changes nothing.
  soft((await iPaid(w, 'Kit', 1800)).data.claimCents, 'double I paid').toBe(1800);
  soft((await answer(w, 'Kit', 'reject', 1800)).status, "Kit Didn't pay").toBe(200);
  soft(ticket(w, 'Kit'), 'after reject').toMatchObject({ claim_cents: 0, paid_cents: 0, place: 'none' });
  soft((await iPaid(w, 'Kit', 1800)).status, 'Kit pays again').toBe(200);
  for (const n of ['Devon', 'Emery', 'Frankie', 'Harper', 'Indy', 'Jules', 'Kit']) soft((await answer(w, n, 'confirm')).status, `confirm ${n}`).toBe(200);
  // A second confirm (double tap) is refused, nothing moves.
  soft((await answer(w, 'Kit', 'confirm')).status, 'second confirm').toBe(409);
}

describe('Night 1: 10 players, Locked doubles', () => {
  it('Finalize to the next morning, money to the cent', async () => {
    const w = await coldOpen();
    await lockedTen(w);
    const t0 = await adminTour(w);
    log('admin after lock-ins (lockedIn, expected, money, cost, spots)', { lockedIn: t0.lockedIn, expected: t0.expected, money: t0.money, cost: t0.cost, spots: t0.spots, notSignedUp: t0.notSignedUp });
    soft(t0.lockedIn).toBe(10);
    // Money to the cent: 9 paid tickets of $18 (Alex's seat $0): $162 on the tickets; credit used $18 + $18 + $10 = $46; cash confirmed $116.
    const m0 = moneyTotals(w);
    soft(m0, 'money on tickets').toMatchObject({ ticketCredit: 4600, ticketPaid: 11600, ticketClaim: 0, creditUsedLive: 4600 });
    soft(pot(w, 'Casey'), 'Casey has $7 left').toBe(700);
    soft(t0.money, 'money line 10 expected').toEqual({ courtCents: 12000, ticketsCents: 16200, youCents: 4200 });
    books(w);

    // The countdown cards (pure, on the real Pay by) at the moments Alex sees them.
    const pb = new Date(PAY_BY_MS).toISOString();
    const cd = (ms: number) => payCountdown(pb, ms, 'America/Detroit', 'The Cold Open');
    const moments: [string, number][] = [
      ['Wed Nov 25 noon', Date.parse('2026-11-25T17:00:00Z')],
      ['Fri Nov 27 noon', Date.parse('2026-11-27T17:00:00Z')],
      ['Sat Nov 28 noon', Date.parse('2026-11-28T17:00:00Z')],
      ['Sun Nov 29 11 PM', Date.parse('2026-11-30T04:00:00Z')],
      ['Mon Nov 30 9 AM', Date.parse('2026-11-30T14:00:00Z')],
      ['Mon 1:01 PM (5h59 left)', PAY_BY_MS - 5 * HOUR - 59 * MIN],
      ['Mon 2:01 PM (4h59 left)', PAY_BY_MS - 4 * HOUR - 59 * MIN],
      ['Mon 5:31 PM (1h29 left)', PAY_BY_MS - 89 * MIN],
      ['Mon 6:20 PM', PAY_BY_MS - 40 * MIN],
      ['Mon 7:00 PM', PAY_BY_MS],
    ];
    log('countdown', moments.map(([l, ms]) => `${l}: ${cd(ms) ? `${cd(ms)!.title} | ${cd(ms)!.sub}` : '(none)'}`).join('\n'));
    soft(cd(PAY_BY_MS - 4 * HOUR - 59 * MIN)?.title).toBe('Due in 5 hours');
    soft(cd(Date.parse('2026-11-30T14:00:00Z'))?.title).toBe('Payment due today');

    // Pay by passes. Nothing switches (even), Draft teams opens.
    w.app.now = PAY_BY_MS + MIN;
    const t1 = await adminTour(w);
    soft(t1.format).toBe('doubles');
    soft(t1.styleDecided).toBe(true);
    soft(t1.day.canDraft, t1.day.why).toBe(true);
    const blairCard = await card(w, 'Blair');
    soft(blairCard.styleTbd ?? false, 'style no longer TBD for players').toBe(false);
    // The missed-date player (Gale) after Pay by: what does their card say?
    log('Gale (missed date) card after Pay by', await card(w, 'Gale'));

    // Draft teams; tap two to swap; totals; publish; team names.
    soft((await teams(w, { action: 'draft' })).status).toBe(200);
    let d = (await adminTour(w)).day;
    log('draft', { phase: d.phase, teams: d.teams.map((x: any) => `${x.name}: ${x.players.map((p: any) => `${p.name} ${p.level ?? ''}`).join(' + ')} = ${x.total ?? '?'}`) });
    soft(d.teams).toHaveLength(5);
    const a = d.teams[0].players[0].id ?? d.teams[0].players[0].playerId;
    const b = d.teams[1].players[1].id ?? d.teams[1].players[1].playerId;
    soft((await teams(w, { action: 'swap', a, b })).status, 'swap').toBe(200);
    d = (await adminTour(w)).day;
    log('after swap', d.teams.map((x: any) => `${x.name}: ${x.players.map((p: any) => p.name).join(' + ')} = ${x.total ?? '?'}`));
    // Players do not see draft teams.
    soft(JSON.stringify(await card(w, 'Blair')).includes(d.teams[0].name), 'draft hidden from players').toBe(false);
    w.app.now = PAY_BY_MS + HOUR; // Mon 8 PM
    soft((await teams(w, { action: 'publish' })).status, 'publish').toBe(200);
    const vic = d.teams[0].players[0].name as string;
    const nm = await (await phone(w, vic)).call('POST', '/api/tournament/team-name', { tournamentId: w.tid, name: 'Net Ninjas' });
    soft(nm.status, `team name: ${nm.text}`).toBe(200);
    const dup = await (await phone(w, d.teams[1].players[0].name)).call('POST', '/api/tournament/team-name', { tournamentId: w.tid, name: 'net ninjas' });
    soft(dup.status, 'duplicate team name refused').toBe(409);
    log('player card after publish (Blair)', (await card(w, 'Blair')).day ?? '(no day key)');

    // Tue Dec 1: the night appears on Home 30 minutes before.
    w.app.now = START_MS - 31 * MIN;
    const early = await card(w, vic);
    w.app.now = START_MS - 29 * MIN;
    const near = await card(w, vic);
    log('Home 31 min before / 29 min before (keys)', { early: Object.keys(early), earlyDay: Object.keys(early.day ?? {}), near: Object.keys(near), nearDay: Object.keys(near.day ?? {}) });
    const g31 = await group(w, vic);
    log('regular games on Home at 7:01 PM (sessions count)', (g31.sessions ?? []).length);
    // Score refused more than 15 minutes before the start.
    const g1 = (await adminTour(w)).day.games[0];
    soft((await score(w, vic, g1.num, 11, 3)).status, 'score 29 min before').toBe(409);

    w.app.now = START_MS + 20 * MIN;
    // Enter score: the first of 4 counts; 11 to 0 start is client side; a second refused; the same player again fine.
    const day0 = (await adminTour(w)).day;
    log('games', day0.games.map((g: any) => `#${g.num} r${g.round} c${g.court} ${g.stage} ${g.a?.name ?? g.slotA ?? '?'} v ${g.b?.name ?? g.slotB ?? '?'} to ${g.playTo}`));
    const seatPlayers = new Map(day0.teams.map((x: any) => [x.seat, x.players.map((p: any) => p.name)]));
    const first = day0.games[0];
    const pA = seatPlayers.get(first.a.seat)![1];
    const pB = seatPlayers.get(first.b.seat)![0];
    soft((await score(w, pA, first.num, 11, 7)).status, 'first score').toBe(200);
    soft((await score(w, pA, first.num, 11, 7)).status, 'same player same score again').toBe(200);
    const second = await score(w, pB, first.num, 11, 9);
    soft(second.status, 'second score refused').toBe(409);
    log('second score message', second.data.message);
    const agree = await score(w, pB, first.num, 7, 11);
    log('agreeing second score message', `${agree.status} ${agree.data.message}`);

    // The night: seat 1 wins everything; seats 2 and 3 level at 2-2 with a head to head; a no-phone game entered by Alex; a Fix; Time check; Pause.
    soft((await gamesA(w, { action: 'pause' })).status).toBe(200);
    log('player day while paused (Vic)', { paused: (await card(w, vic)).day?.paused });
    soft((await gamesA(w, { action: 'resume' })).status).toBe(200);
    const tc = await gamesA(w, { action: 'apply', fromRound: 4, to: 9 });
    soft(tc.status, 'Time check to 9 from round 4').toBe(200);
    log('time check games', tc.data);
    const res: Record<string, [number, number]> = { '2>4': [11, 2], '2>5': [11, 2], '3>2': [11, 9], '3>5': [11, 8], '4>3': [11, 9], '5>4': [11, 9] };
    const pts = (x: number, y: number): [number, number] => (x === first.a.seat && y === first.b.seat ? [11, 7] : x === 1 ? [11, 5] : y === 1 ? [5, 11] : (res[`${x}>${y}`] ?? (res[`${y}>${x}`] ? [res[`${y}>${x}`][1], res[`${y}>${x}`][0]] : [11, 6])));
    let alexEntered = 0;
    for (let guard = 0; guard < 30; guard++) {
      const dd = (await adminTour(w)).day;
      const open = dd.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b && g.stage === 'pool');
      if (!open.length) break;
      const round = Math.min(...open.map((g: any) => g.round));
      for (const g of open.filter((x: any) => x.round === round)) {
        let [x, y] = pts(g.a.seat, g.b.seat);
        if (g.playTo === 9) [x, y] = x > y ? [9, Math.min(y, 7)] : [Math.min(x, 7), 9];
        // A court with no phones: every game of seat 5 vs seat 4 is Alex's.
        if ((g.a.seat === 5 && g.b.seat === 4) || (g.a.seat === 4 && g.b.seat === 5)) {
          alexEntered++;
          const r = await gamesA(w, { action: 'result', num: g.num, a: x, b: y, seen: { winner: null, scoreA: null, scoreB: null } });
          soft(r.status, `Alex enters #${g.num}: ${r.text}`).toBe(200);
        } else {
          const r = await score(w, seatPlayers.get(g.a.seat)![0], g.num, x, y);
          soft(r.status, `#${g.num}: ${r.text}`).toBe(200);
        }
        w.app.now += 2 * MIN;
      }
      w.app.now += 15 * MIN;
    }
    soft(alexEntered, 'Alex entered a no-phone game').toBeGreaterThan(0);
    // Fix: Alex changes one result (the screen sends what it showed).
    const dd = (await adminTour(w)).day;
    const any = dd.games.find((g: any) => g.stage === 'pool' && g.a.seat === 1);
    const fx = await gamesA(w, { action: 'result', num: any.num, a: any.scoreA === 11 ? 11 : any.scoreA, b: 3, seen: { winner: any.winner, scoreA: any.scoreA, scoreB: any.scoreB } });
    soft(fx.status, `Fix: ${fx.text}`).toBe(200);
    const stale = await gamesA(w, { action: 'result', num: any.num, a: 11, b: 4, seen: { winner: any.winner, scoreA: any.scoreA, scoreB: any.scoreB } });
    soft(stale.status, 'a stale Fix is refused').toBe(409);
    const after = (await adminTour(w)).day;
    log('standings / ties after pools', { standings: after.standings ?? after.table ?? null, ties: after.ties ?? after.blocks ?? null, next: after.games.filter((g: any) => g.stage !== 'pool').map((g: any) => `#${g.num} ${g.stage} ${g.a?.name ?? g.slotA} v ${g.b?.name ?? g.slotB}`) });
    log('player standings (Vic card day)', (await card(w, vic)).day?.standings ?? (await card(w, vic)).day);

    // Final + 3rd place (whatever the plan made), by players.
    for (let guard = 0; guard < 10; guard++) {
      const x = (await adminTour(w)).day;
      const open = x.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
      if (!open.length) break;
      for (const g of open) {
        const r = await score(w, seatPlayers.get(g.a.seat)![0], g.num, 11, 8);
        soft(r.status, `playoff #${g.num} ${g.stage}: ${r.text}`).toBe(200);
      }
      w.app.now += 15 * MIN;
    }
    const tEnd = await adminTour(w);
    log('End card', tEnd.end ?? tEnd.day?.end ?? '(no end)');
    soft(tEnd.end, 'End tournament shows').toBeTruthy();
    // Edit awards: Alex sets the prize now ($10 each to the winners), then Confirm winners and end.
    const potsBefore = allPots(w);
    const ticketsBefore = moneyTotals(w);
    const sv = await awards(w, { action: 'save', first: tEnd.end.first.key, championCents: 1000, weeks: 2 });
    soft(sv.status, `save awards: ${sv.text}`).toBe(200);
    const end2 = (await adminTour(w)).end;
    log('End card after Edit awards', end2);
    const done = await awards(w, { action: 'end', seen: end2.seen });
    soft(done.status, `end: ${done.text}`).toBe(200);
    const again = await awards(w, { action: 'end', seen: end2.seen });
    soft(again.status, 'second End refused or no-op').not.toBe(200);
    const potsAfter = allPots(w);
    const diff = Object.fromEntries(Object.entries(potsAfter).filter(([n, c]) => c !== potsBefore[n]).map(([n, c]) => [n, c - potsBefore[n]]));
    log('credit granted (pots that changed)', diff);
    log('tickets money before/after End', { before: ticketsBefore, after: moneyTotals(w) });
    soft(booksBad(w), 'books after End').toEqual({});
    const winners = end2.first.players as string[];
    const expected = Object.fromEntries(winners.filter((n) => n !== 'Alex').map((n) => [n, 1000]));
    soft(diff, 'each winner $10 once (Alex none)').toEqual(expected);

    // Players: congratulations, medals, ticker; History; Players card; the next morning regular games back.
    w.app.now = END_MS + 10 * HOUR; // Wed 8 AM
    const gw = await group(w, winners.find((n) => n !== 'Alex') ?? winners[0]);
    log('winner Home next morning: tourAwards + tournament + sessions', { tourAwards: gw.tourAwards, tournament: gw.tournament ?? null, sessions: (gw.sessions ?? []).length });
    const gl = await group(w, 'Kit');
    log('Kit Home next morning', { tourAwards: gl.tourAwards, tournament: gl.tournament ?? null });
    const hist = await w.organizer.call('GET', '/api/admin/tournament-history');
    log('History > Tournaments', hist.data);
    const h = await history(w);
    log('History lines (tournament)', h.filter((e) => String(e.action).startsWith('tournament')).map((e) => `${e.action} ${JSON.stringify(e.details)}`).slice(0, 60).join('\n'));
    const dsh = await dash(w);
    log('dashboard next morning: tournament key / sessions', { tournament: dsh.tournament ? Object.keys(dsh.tournament) : null, sessions: (dsh.sessions ?? []).length });
    books(w);
  });
});
void CUTOFF_MS;
