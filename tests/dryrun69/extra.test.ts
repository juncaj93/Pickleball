import { describe, it } from 'vitest';
import { adminTour, books, card, confirmPaid, dump, finalize, games, group, liveLike, lockIn, MIN, NAMES, PAY_BY_MS, phone, play, START_MS, signUp, teams } from './world69';
import { withoutIds } from '../harness';

describe('extra', () => {
  it('Only me before tickets: players get nothing', async () => {
    const w = await liveLike();
    await w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/visibility`, { visibility: 'me' });
    const g = await group(w, 'Vic');
    const s = await (await phone(w, 'Vic')).call('POST', '/api/tournament/signup', { tournamentId: w.tid, level: 300, dates: ['2026-12-01'], formatVote: 'either' });
    dump('X-only-me', { hasTour: 'tournament' in g, text: /Cold Open/.test(withoutIds(JSON.stringify(g))), signup: [s.status, s.data] });
  });
  it('Time check when rounds run late; Pair them after a swap-in', async () => {
    const w = await liveLike();
    await signUp(w, NAMES, { votes: Object.fromEntries(NAMES.map((n) => [n, 'locked'])) });
    await finalize(w);
    for (const n of NAMES) await lockIn(w, n);
    for (const n of NAMES.filter((n) => n !== 'Alex')) await confirmPaid(w, n);
    w.app.now = PAY_BY_MS + MIN;
    await teams(w, { action: 'draft' });
    await teams(w, { action: 'publish' });
    let d = (await adminTour(w)).day;
    const rounds = Math.max(...d.games.filter((g: any) => g.stage === 'pool').map((g: any) => g.round));
    // Round 1 ends 25 minutes late, round 2 another 15.
    for (const [r, at] of [[1, 48], [2, 80]] as const) {
      w.app.now = START_MS + at * MIN;
      for (const g of d.games.filter((x: any) => x.round === r && x.stage === 'pool')) {
        const pa = d.teams.find((t: any) => t.seat === g.a.seat).players[0].name;
        const pb = d.teams.find((t: any) => t.seat === g.b.seat).players[0].name;
        await play(w, pa, g.num, 'won');
        await play(w, pb, g.num, 'confirm');
      }
      const tc = (await adminTour(w)).day.timeCheck;
      dump(`X-timecheck-after-r${r}`, tc);
    }
    const tc = (await adminTour(w)).day.timeCheck;
    if (tc?.suggest) {
      const ap = await games(w, { action: 'apply', fromRound: tc.suggest.fromRound ?? tc.suggest.round, to: tc.suggest.to ?? tc.suggest.playTo });
      dump('X-apply', { status: ap.status, data: ap.data });
    }
    dump('X-vic-after-apply', (await card(w, 'Vic')).day);
    dump('X-rounds', { rounds, plan: d.plan });
    books(w);
  });
});
