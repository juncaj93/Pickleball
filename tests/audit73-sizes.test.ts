import { describe, expect, it } from 'vitest';
import {
  ALL, DATE, MIN, PAY_BY_MS, START_MS, adminTour, allPots, awards, booksBad, card, coldOpen, finalize, giveCredit, lock, moneyTotals, phone, score, signUp, teams,
} from './audit73-world';

// 🎾73.audit: every size the night can really have, played to End on the real server code (2 courts, 7:30 to 10 PM), money to the cent.
const soft = expect.soft;
const out: string[] = [];

async function night(n: number) {
  const w = await coldOpen();
  const names = ALL.slice(0, n);
  for (const x of names) await signUp(w, x, [DATE]);
  await finalize(w);
  for (const x of names.slice(1)) {
    await giveCredit(w, x, 1800);
    soft((await lock(w, x)).data.result, `${n}: ${x}`).toBe('locked');
  }
  w.app.now = PAY_BY_MS + MIN;
  const t = await adminTour(w);
  const format = t.format;
  const money0 = moneyTotals(w);
  let games = 0;
  let endAt = '';
  if (format === 'doubles') {
    soft((await teams(w, { action: 'draft' })).status).toBe(200);
    const p = await teams(w, { action: 'publish' });
    soft(p.status, `${n} publish ${p.text}`).toBe(200);
    w.app.now = START_MS;
    for (let guard = 0; guard < 60; guard++) {
      const d = (await adminTour(w)).day;
      const seats = new Map<number, string>(d.teams.map((x: any) => [x.seat, x.players[0].name]));
      // A wheel or picks: settle them the way Alex would.
      for (const tie of d.ties ?? []) {
        if (tie.mode === 'wheel' && tie.spinner === null) await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/games`, { action: 'spin', key: tie.key });
        else if (tie.mode === 'wheel') await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/games`, { action: 'spin', key: tie.key });
      }
      const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
      if (!open.length) break;
      const round = Math.min(...open.map((g: any) => g.round));
      for (const g of open.filter((x: any) => x.round === round)) {
        const to = g.playTo ?? 11;
        const r = await score(w, seats.get(g.a.seat)!, g.num, (g.a.seat + g.num) % 3 === 0 ? to - 4 : to, (g.a.seat + g.num) % 3 === 0 ? to : to - 2 - (g.num % 5));
        soft(r.status, `${n} #${g.num} ${g.stage}: ${r.text}`).toBe(200);
        games++;
      }
      w.app.now += 13 * MIN;
    }
    endAt = new Date(w.app.now).toISOString().slice(11, 16);
  } else {
    w.app.now = START_MS - 10 * MIN;
    for (let guard = 0; guard < 60; guard++) {
      const d = (await adminTour(w)).rounds;
      const left = d.games.filter((g: any) => g.scoreA == null && g.status !== 'skipped');
      if (!left.length) break;
      const round = Math.min(...left.map((g: any) => g.round));
      for (const g of left.filter((x: any) => x.round === round)) {
        const who = g.a.names[0];
        const key = (await card(w, who)).day.rounds.find((x: any) => x.num === g.num)?.key;
        const r = await (await phone(w, who)).call('POST', '/api/tournament/game', { tournamentId: w.tid, num: g.num, key, action: 'score', mine: g.playTo, theirs: g.num % g.playTo });
        soft(r.status, `${n} am #${g.num}: ${r.text}`).toBe(200);
        games++;
      }
      w.app.now += 13 * MIN;
    }
    endAt = new Date(w.app.now).toISOString().slice(11, 16);
  }
  const e = (await adminTour(w)).end;
  soft(e, `${n}: End shows`).toBeTruthy();
  if (!e) return;
  const pots = allPots(w);
  const sv = await awards(w, { action: 'save', first: e.first.key, ...(format === 'americano' ? { second: e.second.key, secondCents: 700 } : {}), championCents: 1400, weeks: 1 });
  soft(sv.status, `${n} save ${sv.text}`).toBe(200);
  const e2 = (await adminTour(w)).end;
  const r = await awards(w, { action: 'end', seen: e2.seen });
  soft(r.status, `${n} end ${r.text}`).toBe(200);
  const diff = Object.fromEntries(Object.entries(allPots(w)).filter(([k, c]) => c !== pots[k]).map(([k, c]) => [k, c - pots[k]]));
  const exp: Record<string, number> = {};
  if (format === 'doubles') for (const p of e2.first.players) if (p !== 'Alex') exp[p] = 1400;
  if (format === 'americano') {
    if (e2.first.name !== 'Alex') exp[e2.first.name] = 1400;
    if (e2.second.name !== 'Alex') exp[e2.second.name] = 700;
  }
  soft(diff, `${n}: awards to the cent`).toEqual(exp);
  soft(moneyTotals(w).ticketCredit, `${n}: tickets unchanged`).toBe(money0.ticketCredit);
  soft(booksBad(w), `${n}: books`).toEqual({});
  out.push(`${n} ${format}: ${games} games scored, last result about ${endAt} UTC (+13 min each round in this test), winners ${JSON.stringify(diff)}`);
}

describe('every size, 2 courts, played to End', () => {
  for (const n of [6, 7, 8, 11, 12, 13, 14, 15, 16]) it(`${n} players`, async () => night(n));
  it('summary', () => console.log(out.join('\n')));
});
