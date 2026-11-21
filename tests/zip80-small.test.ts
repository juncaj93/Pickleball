import { describe, expect, it } from 'vitest';
import type { MonthlyMoney } from '../shared/api';
import { soFarCard } from '../shared/totalsRefresh';
import { formatAlertWords, mostPlayersVoted } from '../shared/tournament';
import { playerPhone } from './harness';
import { adminTour, awards, books, draftAndPublish, potOf, START_MS, world, type World } from './zip58-world';

// Zip 80 (🎾80.leftovers): the small fixes, each on the real server code.

const fix = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
async function playAll(ctx: World) {
  for (let guard = 0; guard < 40; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) return;
    const round = Math.min(...open.map((g: any) => g.round));
    for (const g of open.filter((x: any) => x.round === round)) expect((await fix(ctx, { action: 'result', num: g.num, a: 11, b: 11 - 2 - (g.a.seat % 5) })).status).toBe(200);
  }
  throw new Error('the night never ended');
}

describe('zip 80: the organizer\'s Players "Spent" reads the same So far card as Totals', () => {
  it('a month with an ended tournament and a month with hand-added credit: Spent = So far, with and without "Spent matches Totals"', async () => {
    const ctx = await world(10);
    for (const s of ['money-rework', 'players-redo-switch']) expect((await ctx.organizer.call('PUT', `/api/admin/${s}`, { on: true })).status).toBe(200);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    await playAll(ctx);
    expect((await awards(ctx, { action: 'end', seen: (await adminTour(ctx)).end.seen })).status).toBe(200);
    const money = async (m: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data as MonthlyMoney;
    const nov = soFarCard((await money('2026-11')).rework!);
    const oct = soFarCard((await money('2026-10')).rework!);
    expect(nov.tournaments).toHaveLength(1); // the tournament (+$12) is in November
    expect(oct.handCreditCents).toBe(16000); // the $16 each added by hand on Oct 26
    const alex = ctx.byName.Alex;
    const summary = async () => (await ctx.organizer.call('GET', `/api/admin/players/${alex}/summary`)).data;
    // "Spent matches Totals" on: the So far card's own total, below $0 too.
    expect((await ctx.organizer.call('PUT', '/api/admin/spent-totals-switch', { on: true })).status).toBe(200);
    let s = await summary();
    expect(s.organizer).toBe(true);
    expect(s.month).toMatchObject({ label: 'NOV 2026', spentCents: nov.netCents });
    expect(s.allTime.spentCents).toBe(nov.netCents + oct.netCents);
    // Off: the same card, never below $0 (as before).
    expect((await ctx.organizer.call('PUT', '/api/admin/spent-totals-switch', { on: false })).status).toBe(200);
    s = await summary();
    expect(s.month.spentCents).toBe(Math.max(0, nov.netCents));
    expect(s.allTime.spentCents).toBe(Math.max(0, nov.netCents) + Math.max(0, oct.netCents));
  });
});

describe('zip 80: a kept late drop is not "kept" after the tournament is canceled', () => {
  it('8 locked in on 2 courts, a drop after Pay by is kept ($0 back); Cancel: its money comes back once and the sign-up is "out"', async () => {
    const ctx = await world(8);
    const raw = ctx.app.db.raw;
    const name = 'Casey';
    const pid = ctx.byName[name];
    const status = () => (raw.prepare('SELECT status FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, pid) as { status: string }).status;
    const pot = () => potOf(ctx, name);
    const before = pot();
    expect((await (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid })).status).toBe(200);
    expect(status()).toBe('kept');
    expect(pot()).toBe(before); // nothing back yet
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).status).toBe(200);
    expect(status()).toBe('out');
    expect(pot()).toBe(before + 1600);
    // A second Cancel tap changes nothing.
    await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {});
    expect(pot()).toBe(before + 1600);
    books(ctx);
  });
});

describe('zip 80: "Most players voted" only for a real majority', () => {
  it('2 of 10 is not most players: the format only; 6 of 10 is; a tie or an Either crowd never claims it', () => {
    const c = (locked: number, americano: number, either: number) => ({ locked, americano, either });
    expect(mostPlayersVoted(c(2, 0, 8), 'doubles')).toBe(false);
    expect(mostPlayersVoted(c(6, 1, 3), 'doubles')).toBe(true);
    expect(mostPlayersVoted(c(5, 2, 3), 'doubles')).toBe(false); // exactly half is not most
    expect(mostPlayersVoted(c(1, 6, 2), 'americano')).toBe(true);
    expect(formatAlertWords('The Cold Open', '2026-12-01', 'doubles', 'vote', c(2, 0, 8))).toEqual({ title: 'The Cold Open is scheduled for Tue Dec 1.', sub: 'Format: Locked doubles' });
    expect(formatAlertWords('The Cold Open', '2026-12-01', 'doubles', 'vote', c(6, 1, 3)).sub).toBe('Most players voted Locked doubles.');
    expect(formatAlertWords('The Cold Open', '2026-12-01', 'americano', 'admin', c(0, 9, 1)).sub).toBe('Format: Americano');
  });
});
