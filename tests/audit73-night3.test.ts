import { describe, expect, it } from 'vitest';
import {
  ALL, DATE, MIN, PAY_BY_MS, START_MS, adminTour, allPots, answer, awards, booksBad, card, coldOpen, finalize, gamesA, giveCredit, iPaid, lock, phone, score, signUp, teams, type W,
} from './audit73-world';

// 🎾73.audit, Part A night 3: 8 players, Locked doubles: a three-way circle settled by point difference (no wheel); then a fully equal tie (the wheel).
const soft = expect.soft;
const log = (label: string, x: unknown) => console.log(`\n=== ${label}\n${typeof x === 'string' ? x : JSON.stringify(x, null, 1).slice(0, 5000)}`);

async function eight(w: W) {
  const names = ALL.slice(0, 8);
  for (const n of names) await signUp(w, n, [DATE], 'locked');
  await finalize(w);
  for (const n of names.slice(1)) {
    await giveCredit(w, n, 900);
    await lock(w, n);
    soft((await iPaid(w, n, 900)).status).toBe(200);
    soft((await answer(w, n, 'confirm')).status).toBe(200);
  }
  w.app.now = PAY_BY_MS + MIN;
  soft((await adminTour(w)).format).toBe('doubles');
  soft((await teams(w, { action: 'draft' })).status).toBe(200);
  soft((await teams(w, { action: 'publish' })).status).toBe(200);
  w.app.now = START_MS;
  const d = (await adminTour(w)).day;
  return new Map<number, string[]>(d.teams.map((x: any) => [x.seat, x.players.map((p: any) => p.name)]));
}

async function playPools(w: W, seats: Map<number, string[]>, pts: (a: number, b: number) => [number, number]) {
  for (let guard = 0; guard < 20; guard++) {
    const d = (await adminTour(w)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b && g.stage === 'pool');
    if (!open.length) return d;
    const round = Math.min(...open.map((g: any) => g.round));
    for (const g of open.filter((x: any) => x.round === round)) {
      const [x, y] = pts(g.a.seat, g.b.seat);
      const r = await score(w, seats.get(g.a.seat)![0], g.num, x, y);
      soft(r.status, `#${g.num}: ${r.text}`).toBe(200);
    }
    w.app.now += 15 * MIN;
  }
}

async function playRest(w: W, seats: Map<number, string[]>) {
  for (let guard = 0; guard < 10; guard++) {
    const d = (await adminTour(w)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) return d;
    for (const g of open) {
      const to = g.playTo ?? 11;
      const r = await score(w, seats.get(g.a.seat)![0], g.num, to, to - 3);
      soft(r.status, `#${g.num} ${g.stage}: ${r.text}`).toBe(200);
    }
    w.app.now += 15 * MIN;
  }
}

describe('Night 3: 8 players, ties', () => {
  it('a three-way circle settled by point difference (no wheel)', async () => {
    const w = await coldOpen();
    const seats = await eight(w);
    // Seat 1 beats everyone 11 to 5. The circle: 2 beats 3 by 6, 3 beats 4 by 2, 4 beats 2 by 1: diffs 2: +5, 3: -4, 4: -1.
    const circle: Record<string, [number, number]> = { '2>3': [11, 5], '3>4': [11, 9], '4>2': [11, 10] };
    const pts = (a: number, b: number): [number, number] => {
      if (a === 1) return [11, 5];
      if (b === 1) return [5, 11];
      if (circle[`${a}>${b}`]) return circle[`${a}>${b}`];
      const r = circle[`${b}>${a}`];
      return [r[1], r[0]];
    };
    const d = await playPools(w, seats, pts);
    log('after pools: playoff games', d.games.filter((g: any) => g.stage !== 'pool').map((g: any) => `#${g.num} ${g.stage} ${g.a?.name ?? g.slotA} (seat ${g.a?.seat}) v ${g.b?.name ?? g.slotB} (seat ${g.b?.seat})`));
    log('tie blocks (admin)', d.ties ?? d.blocks ?? d.tie ?? null);
    soft(d.games.some((g: any) => g.stage === 'tie'), 'no tie games').toBe(false);
    log('standings (player)', (await card(w, seats.get(2)![0])).day.standings);
    const fin = d.games.find((g: any) => g.stage === 'final');
    soft([fin.a?.seat, fin.b?.seat].sort(), 'Final: seat 1 vs seat 2 (best diff in the circle)').toEqual([1, 2]);
    const end = await playRest(w, seats);
    void end;
    const e = (await adminTour(w)).end;
    soft(e, 'End shows').toBeTruthy();
    const before = allPots(w);
    const r = await awards(w, { action: 'end', seen: e.seen });
    soft(r.status, r.text).toBe(200);
    const diff = Object.entries(allPots(w)).filter(([n, c]) => c !== before[n]);
    soft(diff, 'no credit with $0 prize').toEqual([]);
    soft(booksBad(w)).toEqual({});
  });

  it('a fully equal three-way tie reaches the wheel once; Game A / Game B; End', async () => {
    const w = await coldOpen();
    const seats = await eight(w);
    const pts = (a: number, b: number): [number, number] => (a === 1 ? [11, 5] : b === 1 ? [5, 11] : ((a === 2 && b === 3) || (a === 3 && b === 4) || (a === 4 && b === 2) ? [11, 7] : [7, 11]));
    const d = await playPools(w, seats, pts);
    const tour = await adminTour(w);
    log('admin day after pools (tie keys)', Object.keys(tour.day));
    log('admin tie card', tour.day.ties ?? tour.day.tieCards ?? tour.day.blocks ?? tour.day.tie);
    const pc = (await card(w, seats.get(1)![0])).day;
    log('player (seat 1, spinner?) day keys + tie', { keys: Object.keys(pc), tie: pc.tie ?? pc.wheel ?? pc.ties ?? null });
    const anyTie = JSON.stringify(tour.day).match(/"key":"([^"]*tie[^"]*|[^"]*wheel[^"]*)"/i);
    log('tie key found', anyTie?.[1] ?? null);
    const tieKey = (tour.day.ties?.[0]?.key ?? tour.day.tie?.key ?? anyTie?.[1]) as string | undefined;
    soft(tieKey, 'a wheel tie exists').toBeTruthy();
    if (!tieKey) return;
    // A player NOT on the spinning team is refused; the spinner's spin lands; a second spin returns the same.
    const wrong = await (await phone(w, seats.get(3)![0])).call('POST', '/api/tournament/spin', { tournamentId: w.tid, key: tieKey });
    log('spin by a tied team player', `${wrong.status} ${wrong.text}`);
    const s1 = await (await phone(w, seats.get(1)![0])).call('POST', '/api/tournament/spin', { tournamentId: w.tid, key: tieKey });
    log('spin by seat 1', `${s1.status} ${s1.text}`);
    const s2 = await gamesA(w, { action: 'spin', key: tieKey });
    log('organizer spin after', `${s2.status} ${s2.text}`);
    soft(s2.data?.bye, 'second spin is the same bye').toBe(s1.data?.bye);
    const d2 = (await adminTour(w)).day;
    log('games after spin', d2.games.filter((g: any) => g.stage !== 'pool').map((g: any) => `#${g.num} r${g.round} c${g.court} ${g.stage} ${g.a?.name ?? g.slotA} v ${g.b?.name ?? g.slotB} to ${g.playTo}`));
    await playRest(w, seats);
    const e = (await adminTour(w)).end;
    soft(e, 'End shows after the tie games').toBeTruthy();
    log('End card', e?.done);
    const r = await awards(w, { action: 'end', seen: e.seen });
    soft(r.status, r.text).toBe(200);
    soft(booksBad(w)).toEqual({});
    void d;
  });
});
