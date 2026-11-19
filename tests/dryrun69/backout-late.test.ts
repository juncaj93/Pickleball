import { describe, expect, it } from 'vitest';
import { adminTour, books, card, confirmPaid, dump, finalize, games, giveCredit, liveLike, lockIn, MIN, NAMES, PAY_BY_MS, phone, play, potOf, START_MS, signUp, teams, tickets, tourLedger , snap } from './world69';

async function ten() {
  const w = await liveLike();
  await signUp(w, NAMES, { votes: Object.fromEntries(NAMES.map((n) => [n, 'locked'])) });
  await finalize(w);
  await giveCredit(w, 'Vic', 1800);
  for (const n of NAMES) await lockIn(w, n);
  for (const n of NAMES.filter((n) => !['Alex', 'Vic'].includes(n))) await confirmPaid(w, n);
  w.app.now = PAY_BY_MS + MIN;
  const dr = await teams(w, { action: 'draft' });
  expect(dr.status, dr.text).toBe(200);
  const pb = await teams(w, { action: 'publish' });
  expect(pb.status, pb.text).toBe(200);
  return w;
}

describe('Back out late', () => {
  it('2 hours before the start (Drop out hidden on the card)', async () => {
    const w = await ten();
    w.app.now = START_MS - 120 * MIN;
    const c = await card(w, 'Zoe');
    dump('L-zoe-card-2h', c.tickets);
    snap(w, 'L1-two-hours-before');
    const before = potOf(w, 'Zoe');
    const bo = await (await phone(w, 'Zoe')).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    const a = await adminTour(w);
    dump('L-2h', { status: bo.status, data: bo.data, before, after: potOf(w, 'Zoe'), format: a.format, oddSwitch: a.oddSwitch, lockedIn: a.lockedIn, fix: a.day?.fix, cost: a.cost });
    books(w);
  });
  it('during the night, after playing games', async () => {
    const w = await ten();
    w.app.now = START_MS + 5 * MIN;
    let d = (await adminTour(w)).day;
    const r1 = d.games.filter((g: any) => g.round === 1);
    for (const g of r1) {
      const pa = d.teams.find((t: any) => t.seat === g.a.seat).players[0].name;
      const pb = d.teams.find((t: any) => t.seat === g.b.seat).players[0].name;
      await play(w, pa, g.num, 'won');
      await play(w, pb, g.num, 'confirm');
    }
    w.app.now = START_MS + 30 * MIN;
    const who = d.teams.find((t: any) => t.seat === r1[0].a.seat).players[1].name;
    const before = potOf(w, who);
    const bo = await (await phone(w, who)).call('POST', '/api/tournament/back-out', { tournamentId: w.tid });
    const a = await adminTour(w);
    dump('L-night', { who, status: bo.status, data: bo.data, before, after: potOf(w, who), format: a.format, lockedIn: a.lockedIn, fix: a.day?.fix });
    books(w);
    // The organizer's Player left instead.
    const left = await games(w, { action: 'left', playerId: w.byName[d.teams.find((t: any) => t.seat === r1[1].a.seat).players[1].name] });
    dump('L-player-left', { status: left.status, data: left.data });
    // After the night ends (10:00 PM), before End: does anything come back?
    w.app.now = START_MS + 200 * MIN;
    dump('L-after-10pm', { tickets: tickets(w), ledger: tourLedger(w) });
  });
});
