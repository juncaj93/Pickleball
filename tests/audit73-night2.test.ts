import { describe, expect, it } from 'vitest';
import {
  ALL, DATE, END_MS, HOUR, MIN, PAY_BY_MS, START_MS, adminTour, allPots, answer, awards, books, booksBad, card, coldOpen, finalize, gamesA, giveCredit, group, iPaid, lock,
  moneyTotals, phone, signUp, type W,
} from './audit73-world';

// 🎾73.audit, Part A night 2: 9 players, the style switches to Americano at Pay by, a full Americano night with scores, a break, win %, End 1st + 2nd.
const soft = expect.soft;
const log = (label: string, x: unknown) => console.log(`\n=== ${label}\n${typeof x === 'string' ? x : JSON.stringify(x, null, 1).slice(0, 5000)}`);

async function nine(w: W) {
  const names = ALL.slice(0, 9);
  for (const n of names) await signUp(w, n, [DATE], n === 'Blair' ? 'locked' : 'either');
  await finalize(w);
  for (const n of names.slice(1)) {
    if (n === 'Blair' || n === 'Casey') {
      await giveCredit(w, n, 1800);
      soft((await lock(w, n)).data.result).toBe('locked');
    } else {
      await lock(w, n);
      soft((await iPaid(w, n, 1800)).status).toBe(200);
      soft((await answer(w, n, 'confirm')).status).toBe(200);
    }
  }
  return names;
}

describe('Night 2: 9 players, Americano', () => {
  it('switch at Pay by, the night, a break, win %, End 1st and 2nd', async () => {
    const w = await coldOpen();
    const names = await nine(w);
    w.app.now = PAY_BY_MS - MIN;
    const pre = await adminTour(w);
    soft(pre.format, 'still doubles one minute before Pay by').toBe('doubles');
    log('Plan before Pay by (expected, money)', { expected: pre.expected, money: pre.money, lockedIn: pre.lockedIn });
    w.app.now = PAY_BY_MS + MIN;
    const sentBefore = w.app.background.length;
    const t1 = await adminTour(w);
    soft(t1.format, 'odd count: Americano at Pay by').toBe('americano');
    log('organizer card after the switch', { format: t1.format, oddSwitch: t1.oddSwitch, switchBack: t1.switchBack, money: t1.money, expected: t1.expected });
    const c = await card(w, 'Casey');
    log('player card after the switch (Casey): formatAlert / styleBanner', { format: c.format, styleTbd: c.styleTbd, formatAlert: c.formatAlert, styleBanner: c.styleBanner ?? null });
    // Two more reads switch nothing again (one History line).
    await adminTour(w);
    await card(w, 'Blair');
    log('background tasks (alerts) queued by the switch', w.app.background.length - sentBefore);

    // The night.
    w.app.now = START_MS - 10 * MIN;
    const day0 = (await adminTour(w)).rounds;
    log('admin Americano rounds (first look)', { plan: day0.plan, sits: day0.sits, games: day0.games.slice(0, 3), round: day0.round, byPercent: day0.byPercent });
    const pc = await card(w, 'Casey');
    log('Casey day', pc.day);
    // Every round: a player's score (the other side refused), one round Alex enters, a Time check, a break (pause/resume).
    let round = 0;
    for (let guard = 0; guard < 40; guard++) {
      const d = (await adminTour(w)).rounds;
      const left = d.games.filter((g: any) => g.scoreA == null && g.status !== 'skipped');
      if (!left.length) break;
      round = Math.min(...left.map((g: any) => g.round));
      const open = left.filter((g: any) => g.round === round);
      if (round === 3) {
        soft((await gamesA(w, { action: 'pause' })).status, 'break').toBe(200);
        log('Casey during the break', (await card(w, 'Casey')).day?.paused);
        soft((await gamesA(w, { action: 'resume' })).status).toBe(200);
      }
      if (round === 4) log('time check', (await gamesA(w, { action: 'apply', fromRound: 5, to: 9 })).data);
      for (const g of open) {
        const a0 = g.a.names[0];
        const key = (await card(w, a0)).day.rounds.find((x: any) => x.num === g.num)?.key;
        const sc: [number, number] = g.playTo === 9 ? [9, 5] : [11, (g.num * 3) % 10];
        if (round === 2 && g === open[0]) {
          const r = await gamesA(w, { action: 'score', num: g.num, a: sc[0], b: sc[1], seen: g.stamp });
          soft(r.status, `Alex enters round 2 game: ${r.text}`).toBe(200);
          continue;
        }
        const pl = await phone(w, a0);
        const r = await pl.call('POST', '/api/tournament/game', { tournamentId: w.tid, num: g.num, key, action: 'score', mine: sc[0], theirs: sc[1] });
        soft(r.status, `round ${round} #${g.num} by ${a0}: ${r.text}`).toBe(200);
        const other = g.b.names[0];
        if (other && round === 1) {
          const r2 = await (await phone(w, other)).call('POST', '/api/tournament/game', { tournamentId: w.tid, num: g.num, key: (await card(w, other)).day.rounds.find((x: any) => x.num === g.num)?.key, action: 'score', mine: 11, theirs: 2 });
          soft(r2.status, 'the other side refused').toBe(409);
          log('Americano second score message', r2.data.message);
        }
      }
      w.app.now += 14 * MIN;
    }
    const dEnd = await adminTour(w);
    log('Americano after the last round', { over: dEnd.rounds.over, byPercent: dEnd.rounds.byPercent, tied: dEnd.rounds.tied ?? null, sits: dEnd.rounds.sits });
    log('End card', dEnd.end);
    soft(dEnd.end, 'End tournament shows').toBeTruthy();
    log('Casey standings', (await card(w, 'Casey')).day?.standings);
    const potsBefore = allPots(w);
    const money0 = moneyTotals(w);
    const e = dEnd.end;
    const sv = await awards(w, { action: 'save', first: e.first.key, second: e.second.key, championCents: 1400, secondCents: 700, weeks: 1 });
    soft(sv.status, sv.text).toBe(200);
    const e2 = (await adminTour(w)).end;
    const done = await awards(w, { action: 'end', seen: e2.seen });
    soft(done.status, done.text).toBe(200);
    const diff = Object.fromEntries(Object.entries(allPots(w)).filter(([n, c2]) => c2 !== potsBefore[n]).map(([n, c2]) => [n, c2 - potsBefore[n]]));
    log('credit granted', { diff, first: e2.first, second: e2.second, noCredit: e2.noCredit ?? null });
    const exp: Record<string, number> = {};
    if (e2.first.name !== 'Alex') exp[e2.first.name] = 1400;
    if (e2.second.name !== 'Alex') exp[e2.second.name] = 700;
    soft(diff, '1st $14, 2nd $7, once').toEqual(exp);
    soft(moneyTotals(w).ticketPaid, 'tickets unchanged').toBe(money0.ticketPaid);
    soft(booksBad(w)).toEqual({});
    w.app.now = END_MS + 10 * HOUR;
    log('next morning, 1st place Home', (await group(w, e2.first.name)).tourAwards);
    books(w);
    void names;
  });
});
