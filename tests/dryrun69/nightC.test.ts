import { describe, expect, it } from 'vitest';
import { adminTour, awards, books, card, confirmPaid, dump, finalize, games, giveCredit, liveLike, lockIn, MIN, NAMES, note, PAY_BY_MS, phone, play, potOf, START_MS, signUp, teams, tickets, tourLedger, snap } from './world69';

const EIGHT = NAMES.slice(0, 8);
const playersOf = (d: any, seat: number) => d.teams.find((t: any) => t.seat === seat).players.map((p: any) => p.name);

async function eightReady(extraSignups: string[] = []) {
  const w = await liveLike();
  await signUp(w, [...EIGHT, ...extraSignups], { votes: Object.fromEntries(EIGHT.map((n) => [n, 'locked'])) });
  await finalize(w);
  for (const [n, c] of Object.entries({ Vic: 1800, Parker: 1000 })) await giveCredit(w, n, c);
  for (const n of EIGHT) await lockIn(w, n);
  for (const n of EIGHT.filter((n) => !['Alex', 'Vic'].includes(n))) await confirmPaid(w, n);
  books(w);
  return w;
}

describe('Night C: 8 players', () => {
  it('three-way tie: the wheel, Game A and B to 5, the Final', async () => {
    const w = await eightReady();
    w.app.now = PAY_BY_MS + MIN;
    expect((await teams(w, { action: 'draft' })).status).toBe(200);
    expect((await teams(w, { action: 'publish' })).status).toBe(200);
    w.app.now = START_MS + 5 * MIN;
    let d = (await adminTour(w)).day;
    // Seat 1 beats all; 2 beats 3, 3 beats 4, 4 beats 2: a circle for 2nd to 4th.
    const win = (a: number, b: number) => {
      const [x, y] = [Math.min(a, b), Math.max(a, b)];
      if (x === 1) return 1;
      if (x === 2 && y === 4) return 4;
      return x;
    };
    for (const g of d.games.filter((x: any) => x.stage === 'pool')) {
      w.app.now = Math.max(w.app.now, START_MS + (g.round - 1) * 22 * MIN + 5 * MIN);
      const ws = win(g.a.seat, g.b.seat);
      const ls = ws === g.a.seat ? g.b.seat : g.a.seat;
      expect((await play(w, playersOf(d, ws)[0], g.num, 'won')).status).toBe(200);
      expect((await play(w, playersOf(d, ls)[0], g.num, 'confirm')).status).toBe(200);
    }
    let t = await adminTour(w);
    dump('C-day-tied', t.day);
    const spinner = playersOf(t.day, 1)[0];
    const tiedPlayer = playersOf(t.day, 2)[0];
    const sc = await card(w, spinner);
    const tc = await card(w, tiedPlayer);
    dump('C-spinner-card', sc);
    snap(w, 'C1-tied', { spinner, tiedPlayer });
    dump('C-tied-card', tc);
    // Find the tie key from the spinner's card or the admin view.
    const key = t.day.ties?.[0]?.key;
    note(w, `C tie key ${key}`);
    dump('C-tie-key', { key });
    // A tied team cannot spin; the spinner can; a second spin gives the same answer.
    const bad = await (await phone(w, tiedPlayer)).call('POST', '/api/tournament/spin', { tournamentId: w.tid, key });
    const [s1, s2] = await Promise.all([
      (await phone(w, spinner)).call('POST', '/api/tournament/spin', { tournamentId: w.tid, key }),
      games(w, { action: 'spin', key }),
    ]);
    dump('C-spins', { bad: [bad.status, bad.data], s1: [s1.status, s1.data], s2: [s2.status, s2.data] });
    t = await adminTour(w);
    dump('C-day-spun', t.day);
    snap(w, 'C1b-spun', { spinner, tiedPlayer });
    dump('C-tied-card-spun', await card(w, tiedPlayer));
    // Play the tie games (A then B) and the playoffs as they fill in.
    for (let step = 0; step < 6; step++) {
      t = await adminTour(w);
      const open = t.day.games.filter((g: any) => g.stage !== 'pool' && !g.winner && g.a?.seat && g.b?.seat && !g.skipped);
      if (!open.length) break;
      for (const g of open) {
        w.app.now += 12 * MIN;
        dump(`C-open-${step}-${g.num}`, g);
        const ws = Math.min(g.a.seat, g.b.seat);
        const ls = ws === g.a.seat ? g.b.seat : g.a.seat;
        const r1 = await play(w, playersOf(t.day, ws)[1], g.num, 'won');
        expect(r1.status, r1.text).toBe(200);
        const r2 = await play(w, playersOf(t.day, ls)[1], g.num, 'confirm');
        expect(r2.status, r2.text).toBe(200);
      }
    }
    t = await adminTour(w);
    dump('C-day-done', t.day);
    dump('C-end', t.end);
    expect(t.end, 'End card after the Final').toBeTruthy();
    const e = await awards(w, { action: 'end', seen: t.end.seen });
    expect(e.status, e.text).toBe(200);
    books(w, 'C after end');
    dump('C-results', w.app.db.raw.prepare('SELECT p.display_name AS name, r.finish, r.wins, r.losses, r.medal, r.award, r.credit_cents FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE tournament_id = ? ORDER BY finish').all(w.tid));
    dump('C-notes', w.notes);
  });

  it('back out after Pay by: Americano, a late join fills, Switch back', async () => {
    const w = await eightReady(['Sage']);
    w.app.now = PAY_BY_MS + MIN;
    expect((await teams(w, { action: 'draft' })).status).toBe(200);
    expect((await teams(w, { action: 'publish' })).status).toBe(200);
    const potBefore = potOf(w, 'Quinn');
    w.app.now = PAY_BY_MS + 60 * MIN;
    const bo = await (await phone(w, 'Quinn')).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    dump('C2-backout', { status: bo.status, data: bo.data });
    expect(bo.status, bo.text).toBe(200);
    dump('C2-quinn-pot', { before: potBefore, after: potOf(w, 'Quinn') });
    const adm = await adminTour(w);
    dump('C2-admin-after-backout', { format: adm.format, oddSwitch: adm.oddSwitch, switchBack: adm.switchBack, day: adm.day, rounds: adm.rounds ? { plan: adm.rounds.plan, sits: adm.rounds.sits } : null, cost: adm.cost, notSignedUp: adm.notSignedUp });
    dump('C2-vic-after-backout', await card(w, 'Vic'));
    snap(w, 'C2-backed-out');
    dump('C2-sage-card', await card(w, 'Sage'));
    // Sage (on the list, never paid) pays now, a spot is open after Pay by.
    const s = await lockIn(w, 'Sage');
    dump('C2-sage-lock', s);
    await confirmPaid(w, 'Sage');
    const adm2 = await adminTour(w);
    dump('C2-admin-after-sage', { format: adm2.format, oddSwitch: adm2.oddSwitch, switchBack: adm2.switchBack, lockedIn: adm2.lockedIn, day: adm2.day });
    snap(w, 'C3-switch-back-offer');
    const sb = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/switch-back`, {});
    dump('C2-switchback', { status: sb.status, data: sb.data });
    const adm3 = await adminTour(w);
    dump('C2-admin-after-switchback', { format: adm3.format, switchBack: adm3.switchBack, day: adm3.day });
    dump('C2-vic-after-switchback', await card(w, 'Vic'));
    dump('C2-tickets', tickets(w));
    dump('C2-ledger', tourLedger(w));
    books(w, 'C2');
  });
});
