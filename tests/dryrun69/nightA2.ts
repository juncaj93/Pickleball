import { expect } from 'vitest';
import { adminTour, awards, books, card, dash, dump, END_MS, games, group, MIN, NAMES, note, phone, play, potOf, START_MS, teams, tourLedger, type W , snap } from './world69';

const seatOf = (d: any, name: string) => d.teams.find((t: any) => t.players.some((p: any) => p.name === name))?.seat;
const playersOf = (d: any, seat: number) => d.teams.find((t: any) => t.seat === seat).players.map((p: any) => p.name);

/** Draft done. Swap two, publish, names, the night, End. */
export async function nightAPart2(w: W) {
  let t = await adminTour(w);
  dump('A-day-draft', t.day);
  // Tap two to swap: the first player of team 1 with the second of team 2.
  const t1 = t.day.teams[0];
  const t2 = t.day.teams[1];
  const sw = await teams(w, { action: 'swap', a: t1.players[0].id, b: t2.players[1].id });
  expect(sw.status, sw.text).toBe(200);
  const pub = await teams(w, { action: 'publish' });
  expect(pub.status, pub.text).toBe(200);
  t = await adminTour(w);
  dump('A-day-published', t.day);
  // A player renames their team (the pencil), another rolls the dice.
  const vicCard = await card(w, 'Vic');
  dump('A-vic-published', vicCard);
  const nm = await (await phone(w, 'Vic')).call('POST', '/api/tournament/team-name', { tournamentId: w.tid, name: 'Cold Feet' });
  dump('A-vic-rename', nm.data);
  expect(nm.status, nm.text).toBe(200);
  const dice = await (await phone(w, 'Sage')).call('POST', '/api/tournament/team-name', { tournamentId: w.tid });
  dump('A-sage-dice', dice.data);
  // 30 minutes before: the night on Home.
  w.app.now = START_MS - 30 * MIN;
  snap(w, 'A3-30-before');
  dump('A-vic-30-before', await card(w, 'Vic'));
  const early = await play(w, 'Vic', 1, 'won');
  dump('A-early-result', { status: early.status, data: early.data });
  w.app.now = START_MS;
  t = await adminTour(w);
  const d = t.day;
  dump('A-day-start', d);
  dump('A-vic-start', await card(w, 'Vic'));
  // Results by seat: 1 beats all; 2 beats 3, 4; 3 beats 4, 5; 4 beats 5; 5 beats 2. Standings 1: 4-0, 2 and 3: 2-2 (2 beat 3), 4 and 5: 1-3 (4 beat 5).

  const win = (a: number, b: number) => {
    const [x, y] = [Math.min(a, b), Math.max(a, b)];
    if (x === 1) return 1;
    if (x === 2 && y === 5) return 5;
    return x;
  };
  const pool = d.games.filter((g: any) => g.stage === 'pool').sort((a: any, b: any) => a.num - b.num);
  dump('A-pool-games', pool);
  let i = 0;
  let undoChecked = false;
  let disputeChecked = false;
  for (const g of pool) {
    // Each round starts on time-ish: move the clock 20 minutes per round.
    w.app.now = Math.max(w.app.now, START_MS + (g.round - 1) * 20 * MIN + 5 * MIN);
    const a = g.a.seat;
    const b = g.b.seat;
    const ws = win(a, b);
    const ls = ws === a ? b : a;
    const wp = playersOf(d, ws)[i % 2];
    const lp = playersOf(d, ls)[i % 2];
    if (!undoChecked) {
      // We won, then Undo (server side: take back while not confirmed), then We won again and the other side confirms.
      expect((await play(w, wp, g.num, 'won')).status).toBe(200);
      const u = await play(w, wp, g.num, 'undo');
      dump('A-undo', u.data);
      undoChecked = true;
    }
    if (!disputeChecked && g.round === 2) {
      // The loser says No, we won (dispute); the organizer fixes it.
      expect((await play(w, wp, g.num, 'won')).status).toBe(200);
      const dsp = await play(w, lp, g.num, 'dispute');
      dump('A-dispute', { status: dsp.status, data: dsp.data });
      const adm = await adminTour(w);
      dump('A-day-disputed', adm.day);
      snap(w, 'A4-disputed', { winnerPlayer: wp, loserPlayer: lp });
      const fix = await games(w, { action: 'result', num: g.num, winner: ws === a ? 'a' : 'b' });
      expect(fix.status, fix.text).toBe(200);
      disputeChecked = true;
    } else if (i % 3 === 2) {
      // The losing side taps "<other team> won" (the loss).
      const r = await play(w, lp, g.num, 'lost');
      expect(r.status, r.text).toBe(200);
    } else {
      expect((await play(w, wp, g.num, 'won')).status).toBe(200);
      // Two phones of the losing team confirm at once.
      const [c1, c2] = await Promise.all([play(w, playersOf(d, ls)[0], g.num, 'confirm'), play(w, playersOf(d, ls)[1], g.num, 'confirm')]);
      if (i === 1) dump('A-double-confirm', [c1.status, c1.data, c2.status, c2.data]);
      expect([c1.status, c2.status].includes(200)).toBe(true);
    }
    if (g.round === 2 && i % 2 === 0) {
      // Time check during round 2 and Pause.
      const tc = (await adminTour(w)).day.timeCheck;
      dump('A-timecheck-r2', tc);
      const p1 = await games(w, { action: 'pause' });
      dump('A-pause', p1.data);
      dump('A-vic-paused', await card(w, 'Vic'));
      await games(w, { action: 'resume' });
    }
    i++;
  }
  t = await adminTour(w);
  dump('A-day-pools-done', t.day);
  dump('A-vic-pools-done', await card(w, 'Vic'));
  // Standings: seat 2 above 3 by head to head, 4 above 5.
  const fin = t.day.games.find((g: any) => g.stage === 'final');
  const third = t.day.games.find((g: any) => g.stage === 'third');
  dump('A-playoffs', { fin, third });
  const fa = fin?.a?.seat;
  const fb = fin?.b?.seat;
  const ta = third?.a?.seat;
  const tb = third?.b?.seat;
  note(w, `A final ${fa} v ${fb}; third ${ta} v ${tb}`);
  expect([fa, fb].sort()).toEqual([1, 2]);
  expect([ta, tb].sort()).toEqual([3, 4]);
  w.app.now = START_MS + 110 * MIN;
  // Seat 2 wins the Final (so Alex's team, if it's seat 1, does not get credit) - decided below by whoever is on seat 1/2.
  const alexSeat = seatOf(t.day, 'Alex');
  note(w, `A Alex is on seat ${alexSeat}`);
  const champSeat = alexSeat === 1 || alexSeat === 2 ? alexSeat : 1; // Alex's team wins if it is in the Final: the medal-only case.
  const loseSeat = champSeat === fa ? fb : fa;
  expect((await play(w, playersOf(t.day, champSeat)[0], fin.num, 'won')).status).toBe(200);
  // The 3rd place game shows "Also now" for a finalist.
  snap(w, 'A5-final-claimed', { finalist: playersOf(t.day, champSeat)[1], loser: playersOf(t.day, loseSeat)[0] });
  dump('A-finalist-card', await card(w, playersOf(t.day, champSeat)[1]));
  expect((await play(w, playersOf(t.day, loseSeat)[0], fin.num, 'confirm')).status).toBe(200);
  expect((await play(w, playersOf(t.day, 3)[0], third.num, 'won')).status).toBe(200);
  expect((await play(w, playersOf(t.day, 4)[1], third.num, 'confirm')).status).toBe(200);
  t = await adminTour(w);
  dump('A-end-card', t.end);
  snap(w, 'A6-end-card');
  dump('A-day-final-done', t.day);
  // Edit awards: $14 each, 2 weeks.
  const sv = await awards(w, { action: 'save', first: t.end.first.key, championCents: 1400, weeks: 2 });
  dump('A-awards-save', sv.data);
  expect(sv.status, sv.text).toBe(200);
  t = await adminTour(w);
  dump('A-end-card-edited', t.end);
  const champs: string[] = t.end.first.players;
  const before = Object.fromEntries(NAMES.map((n) => [n, potOf(w, n)]));
  const [e1, e2] = await Promise.all([awards(w, { action: 'end', seen: t.end.seen }), awards(w, { action: 'end', seen: t.end.seen })]);
  dump('A-end-taps', [e1.status, e1.data, e2.status, e2.data]);
  await dash(w);
  snap(w, 'A7-ended', { champ: champs.find((n) => n !== 'Alex') });
  const after = Object.fromEntries(NAMES.map((n) => [n, potOf(w, n)]));
  dump('A-end-pots', { champs, before, after });
  for (const n of NAMES) {
    const want = champs.includes(n) && n !== 'Alex' ? 1400 : 0;
    expect(after[n] - before[n], `${n} credit at End`).toBe(want);
  }
  books(w, 'after End');
  dump('A-ledger-end', tourLedger(w));
  dump('A-results', w.app.db.raw.prepare('SELECT p.display_name AS name, r.finish, r.wins, r.losses, r.medal, r.award, r.credit_cents FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE tournament_id = ? ORDER BY finish').all(w.tid));
  // After the end: players' Home.
  const g = await group(w, champs.find((n) => n !== 'Alex')!);
  dump('A-champ-group-after', { tournament: g.tournament, winners: g.winners ?? g.ticker ?? null, keys: Object.keys(g), credit: g.credit, me: g.me, sessionsCount: g.sessions?.length });
  dump('A-loser-group-after', (({ tournament, me }) => ({ tournament, me }))(await group(w, 'Reese')));
  const adm = await dash(w);
  dump('A-admin-after-end', { tournament: adm.tournament, keys: Object.keys(adm) });
  const hist = await w.organizer.call('GET', '/api/admin/tournament-history');
  dump('A-history', hist.data);
  // The regular games come back: the next morning.
  w.app.now = END_MS + 10 * 60 * MIN;
  const next = await group(w, 'Vic');
  dump('A-vic-next-morning', { tournament: next.tournament, sessions: next.sessions?.map((s: any) => ({ startsAt: s.startsAt, status: s.status })), keys: Object.keys(next) });
  books(w, 'next morning');
  dump('A-money-dec', (await w.organizer.call('GET', '/api/admin/money?month=2026-12')).data);
  dump('A-money-nov', (await w.organizer.call('GET', '/api/admin/money?month=2026-11')).data);
  dump('A-notes', w.notes);
}
