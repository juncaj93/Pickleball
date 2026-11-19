import { expect } from 'vitest';
import { adminTour, awards, books, card, dump, games, MIN, NAMES, phone, potOf, START_MS, tourLedger, type W , snap } from './world69';

const NINE = NAMES.slice(0, 9);
const rank = (n: string) => NINE.indexOf(n);
async function myRound(w: W, name: string, num: number) {
  const c = await card(w, name);
  return c.day.rounds.find((r: any) => r.num === num);
}
const act = async (w: W, name: string, body: Record<string, unknown>) => (await phone(w, name)).call('POST', '/api/tournament/game', { tournamentId: w.tid, ...body });

export async function nightBPart2(w: W) {
  const r0 = (await adminTour(w)).rounds;
  const all = r0.games as any[];
  const rounds = Math.max(...all.map((g) => g.round));
  let lateNum: number | null = null;
  let fixDone = false;
  let undoDone = false;
  for (let r = 1; r <= rounds; r++) {
    w.app.now = START_MS + (r - 1) * 23 * MIN + 2 * MIN;
    if (r === 3 && lateNum) {
      // The late Round 2 score: the organizer sees it Waiting and confirms it.
      const adm = (await adminTour(w)).rounds;
      const g = adm.games.find((x: any) => x.num === lateNum);
      dump('B-late-admin-view', { round: adm.round, game: g, timeCheck: adm.timeCheck });
      snap(w, 'B2-late-r3');
      const c = await games(w, { action: 'confirm', num: lateNum, seen: g.stamp });
      dump('B-late-confirm', { status: c.status, data: c.data });
      expect(c.status, c.text).toBe(200);
    }
    for (const g of all.filter((x) => x.round === r)) {
      const aBest = Math.min(...g.a.names.map(rank));
      const bBest = Math.min(...g.b.names.map(rank));
      const aWins = (aBest + g.num) % 3 !== 0 ? aBest < bBest : aBest > bBest;
      const lose = 4 + (g.num % 6);
      const pa = g.a.names[0];
      const pb = g.b.names[1];
      const mine = await myRound(w, pa, g.num);
      if (!undoDone) {
        const s1 = await act(w, pa, { num: g.num, key: mine.key, action: 'score', mine: aWins ? 11 : lose, theirs: aWins ? lose : 11 });
        expect(s1.status, s1.text).toBe(200);
        const u = await act(w, pa, { num: g.num, key: mine.key, action: 'undo' });
        dump('B-undo', u.data);
        undoDone = true;
      }
      const s = await act(w, pa, { num: g.num, key: mine.key, action: 'score', mine: aWins ? 11 : lose, theirs: aWins ? lose : 11 });
      expect(s.status, `score r${r} g${g.num}: ${s.text}`).toBe(200);
      if (r === 2 && !lateNum && g.court === 2) {
        lateNum = g.num; // nobody answers: late
        continue;
      }
      const theirs = await myRound(w, pb, g.num);
      dump(`B-other-side-r${r}-g${g.num}`, theirs);
      if (r === 2 && !fixDone) {
        // No, fix it: their score replaces it, then the first side says Yes.
        const f = await act(w, pb, { num: g.num, key: theirs.key, action: 'fix', shown: { mine: aWins ? lose : 11, theirs: aWins ? 11 : lose }, mine: aWins ? lose : 11, theirs: aWins ? 11 - 2 : lose + 1 });
        dump('B-fix', { status: f.status, data: f.data });
        expect(f.status, f.text).toBe(200);
        const back = await myRound(w, pa, g.num);
        dump('B-fix-asked-back', back);
        const y = await act(w, pa, { num: g.num, key: back.key, action: 'confirm', shown: { mine: aWins ? 9 : lose + 1, theirs: aWins ? lose : 11 } });
        dump('B-fix-yes', { status: y.status, data: y.data });
        fixDone = true;
        continue;
      }
      const y = await act(w, pb, { num: g.num, key: theirs.key, action: 'confirm', shown: { mine: aWins ? lose : 11, theirs: aWins ? 11 : lose } });
      expect(y.status, `confirm r${r} g${g.num}: ${y.text}`).toBe(200);
    }
    if (r === 3) {
      dump('B-vic-r3', await card(w, 'Vic'));
      dump('B-admin-r3', (await adminTour(w)).rounds);
    }
  }
  const t = await adminTour(w);
  dump('B-admin-done', { rounds: t.rounds, end: t.end });
  dump('B-vic-done', await card(w, 'Vic'));
  // Edit awards: 1st $14, 2nd $7.
  const end = t.end;
  const sv = await awards(w, { action: 'save', first: end.first.key, second: end.second.key, championCents: 1400, secondCents: 700, weeks: 1 });
  expect(sv.status, sv.text).toBe(200);
  const end2 = (await adminTour(w)).end;
  dump('B-end-card', end2);
  snap(w, 'B3-end-card');
  const before = Object.fromEntries(NINE.map((n) => [n, potOf(w, n)]));
  const e = await awards(w, { action: 'end', seen: end2.seen });
  dump('B-end', e.data);
  expect(e.status, e.text).toBe(200);
  const after = Object.fromEntries(NINE.map((n) => [n, potOf(w, n)]));
  dump('B-end-pots', { first: end2.first, second: end2.second, before, after });
  books(w, 'B after End');
  dump('B-results', w.app.db.raw.prepare('SELECT p.display_name AS name, r.finish, r.wins, r.losses, r.points, r.medal, r.award, r.credit_cents FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE tournament_id = ? ORDER BY finish').all(w.tid));
  dump('B-ledger-end', tourLedger(w));
  const hist = await w.organizer.call('GET', '/api/admin/tournament-history');
  dump('B-history', hist.data);
}
