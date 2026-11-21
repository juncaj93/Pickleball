import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, potOf, START_MS, world, type World } from './zip58-world';

// Zip 80 (🎾80.leftovers), the AUDIT before shipping: Americano nights for 9 and 10 players (The Cold Open may run as Americano for 9), on 2
// courts as booked and on 1 court (the patterns this zip changed), played round by round by the players' own scores to Reveal standings.
// Checked: nobody sits 3 rounds in a row in the games the night really stored, sit-outs differ by at most 1, every pot is exactly what it was
// plus the award credit (to the cent), nothing else moved, and every integrity check (the new double credit ones too) reads 0.

const raw = (ctx: World) => ctx.app.db.raw;
const moneyPrint = (ctx: World) =>
  JSON.stringify([
    raw(ctx).prepare('SELECT player_id, place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets ORDER BY player_id').all(),
    raw(ctx).prepare("SELECT player_id, kind, amount_cents, five_cents, reason, ended_at FROM credit_ledger WHERE COALESCE(reason, '') NOT LIKE 'tour:%:champion' AND COALESCE(reason, '') NOT LIKE 'tour:%:second' ORDER BY rowid").all(),
  ]);
const enter = async (ctx: World, name: string, body: Record<string, unknown>) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', ...body });
const pots = (ctx: World) => Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));

/** From the stored games: per player, the most rounds sat in a row and the sit-outs after every round. */
function sitsOf(ctx: World) {
  const rows = raw(ctx).prepare("SELECT round, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND slot_a LIKE '%+%' ORDER BY round, num").all(ctx.tid) as { round: number; slot_a: string; slot_b: string }[];
  const locked = (raw(ctx).prepare("SELECT player_id FROM tournament_tickets WHERE tournament_id = ? AND place = 'spot'").all(ctx.tid) as { player_id: string }[]).map((r) => r.player_id);
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const run = new Map(locked.map((p) => [p, 0]));
  const sat = new Map(locked.map((p) => [p, 0]));
  let most = 0;
  let gap = 0;
  for (const round of rounds) {
    const on = new Set(rows.filter((r) => r.round === round).flatMap((r) => [...r.slot_a.split('+'), ...r.slot_b.split('+')]));
    for (const p of locked) {
      const sits = !on.has(p);
      run.set(p, sits ? run.get(p)! + 1 : 0);
      if (sits) sat.set(p, sat.get(p)! + 1);
    }
    most = Math.max(most, ...run.values());
    gap = Math.max(gap, Math.max(...sat.values()) - Math.min(...sat.values()));
  }
  return { rounds: rounds.length, most, gap, players: locked.length };
}

describe('zip 80 audit: Americano 9 and 10, to the reveal, money to the cent', () => {
  for (const n of [9, 10])
    for (const courts of [2, 1] as const)
      it(`${n} players, ${courts} ${courts === 1 ? 'court' : 'courts'}, 7:30 to 10:00 PM`, async () => {
        const ctx = await world(n, { courts, format: 'americano' });
        expect((await adminTour(ctx)).format).toBe('americano');
        ctx.app.now = START_MS + 60_000;
        const before = moneyPrint(ctx);
        const pot0 = pots(ctx);
        for (let guard = 0; guard < 40; guard++) {
          const r = (await adminTour(ctx)).rounds;
          const open = r.games.filter((g: any) => g.status === 'playing');
          if (!open.length) break;
          for (const g of open) {
            const who = g.a.names[0];
            const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
            const aWins = g.num % 3 !== 0;
            const res = await enter(ctx, who, { num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
            expect(res.status, res.text).toBe(200);
          }
          ctx.app.now += 15 * 60_000;
        }
        expect((await adminTour(ctx)).rounds.games.every((g: any) => g.status === 'done')).toBe(true);
        const s = sitsOf(ctx);
        expect(s.players).toBe(n);
        expect(s.rounds).toBeGreaterThan(0);
        expect(s.most, `${n} on ${courts}: most rounds sat in a row`).toBeLessThanOrEqual(2);
        expect(s.gap).toBeLessThanOrEqual(1);
        expect(moneyPrint(ctx)).toBe(before);
        // Reveal standings (the Americano End): 1st $14, 2nd $7, once.
        const end = (await adminTour(ctx)).end;
        expect(end, 'Reveal standings shows').toBeTruthy();
        expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
        expect((await awards(ctx, { action: 'end', seen: end.seen })).status).not.toBe(500);
        const first = end.first.name as string;
        const second = end.second.name as string;
        for (const [name, p] of Object.entries(pots(ctx))) expect(p, name).toBe(pot0[name] + (name === first ? 1400 : name === second ? 700 : 0));
        expect(moneyPrint(ctx)).toBe(before);
        // A player who was in it gets the reveal.
        const someone = (raw(ctx).prepare("SELECT p.display_name AS n FROM tournament_tickets k JOIN players p ON p.id = k.player_id WHERE k.tournament_id = ? AND k.place = 'spot' LIMIT 1").get(ctx.tid) as { n: string }).n;
        expect((await card(ctx, someone)).reveal).toBeTruthy();
        books(ctx);
      });
});
