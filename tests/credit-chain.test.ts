// Zip 8, item D: Alex's credit chain, replayed through the real API with real dollars (permanent regression test).
// A player pays $14; more players come, the final price drops and the overpayment becomes credit; next week that
// credit pays part of the $14 (automatically at I'm in) and the rest is paid in cash; that game also ends with more
// than 4, so its price drops too, and the overpayment (credit used plus cash, above the new price) comes back as credit
// again. Every step checks the pot, the seat and the game, and at the end every dollar is accounted for.
//
// Price rule: floor(4 x $14 / N) whole dollars, never above $14 (6 play: $9, 5: $11, 7: $8, 4: $14).
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group() {
  const ctx = await setupGroup();
  for (const name of MORE) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null });
  // The organizer is not one of the players here, so N is just the players who played.
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  return ctx;
}

const dashboard = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const potOf = async (ctx: Ctx, name: string) => (await dashboard(ctx)).creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
const seat = async (ctx: Ctx, sessionId: string, name: string) => (await dashboard(ctx)).sessions.find((s: any) => s.id === sessionId).roster.find((r: any) => r.name === name);

/** Every credit entry for one player, oldest first, straight from the ledger table. */
function ledgerOf(ctx: Ctx, name: string) {
  return ctx.app.db.raw
    .prepare('SELECT kind, amount_cents, session_id, reason, ended_at FROM credit_ledger WHERE player_id = ? ORDER BY created_at, rowid')
    .all(ctx.byName[name]) as { kind: string; amount_cents: number; session_id: string | null; reason: string | null; ended_at: string | null }[];
}

interface Step {
  players: number;
  price: number;
  creditUsed: number;
  cash: number;
  creditBack: number;
  potAfter: number;
}

describe("credit chain (Alex's scenario, Zip 8)", () => {
  it('$14 at 6 players, then credit plus cash at 5, then 7, then 4: every overpayment comes back as credit, nothing lost, doubled or negative', async () => {
    const ctx = await group();
    const P = 'Blair';
    const others = ['Alex', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules'];
    const phone = await playerPhone(ctx, P);
    const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = { [P]: phone };
    for (const n of others) phones[n] = await playerPhone(ctx, n);
    const upcoming = (await dashboard(ctx)).sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now);
    expect(upcoming.length).toBeGreaterThanOrEqual(4);

    // Game by game: how many play, and what we expect for the player (all in cents).
    const plan: Step[] = [
      { players: 6, price: 900, creditUsed: 0, cash: 1400, creditBack: 500, potAfter: 500 },
      { players: 5, price: 1100, creditUsed: 500, cash: 900, creditBack: 300, potAfter: 300 },
      { players: 7, price: 800, creditUsed: 300, cash: 1100, creditBack: 600, potAfter: 600 },
      { players: 4, price: 1400, creditUsed: 600, cash: 800, creditBack: 0, potAfter: 0 },
    ];
    const report: string[] = [];
    let cashTotal = 0;
    let pricesTotal = 0;
    for (const [i, step] of plan.entries()) {
      // Fetch again each game: the list moves on as time passes.
      const s = (await dashboard(ctx)).sessions.find((x: any) => x.id === upcoming[i].id);
      const potBefore = await potOf(ctx, P);
      // The player taps I'm in: any credit is used at once, up to $14.
      const join = await phone.call('POST', `/api/sessions/${s.id}/join`, {});
      expect(join.status, join.text).toBe(200);
      expect(join.data.result).toBe('confirmed');
      expect(join.data.creditCents ?? 0, `game ${i + 1}: credit used at I'm in`).toBe(step.creditUsed);
      expect(await potOf(ctx, P), `game ${i + 1}: pot after I'm in`).toBe(potBefore - step.creditUsed);
      let mine = await seat(ctx, s.id, P);
      expect(mine.owesCents, `game ${i + 1}: owes before paying`).toBe(1400 - step.creditUsed);
      // The others: in and paid $14 cash each.
      for (const n of others.slice(0, step.players - 1)) {
        expect((await phones[n].call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
        // Clear any credit the others got, so only cash is in play for them (their own pots are checked below too).
        const o = await seat(ctx, s.id, n);
        if (o.paymentStatus !== 'paid') expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
      }
      // The rest is paid in cash (the organizer marks it paid, as for a Venmo or cash payment).
      if (step.cash > 0) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[P], paid: true })).status).toBe(200);
      mine = await seat(ctx, s.id, P);
      expect(mine).toMatchObject({ paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400 });
      expect(mine.creditCents ?? 0, `game ${i + 1}: credit on the seat`).toBe(step.creditUsed);
      // The game ends with everyone in having played; the organizer finalizes.
      ctx.app.now = Date.parse(s.endsAt) + 10 * 60_000;
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
      expect(fin.status, fin.text).toBe(200);
      const after = (await dashboard(ctx)).sessions.find((x: any) => x.id === s.id);
      expect(after.finalized.priceCents, `game ${i + 1}: final price for ${step.players}`).toBe(step.price);
      expect(after.finalized.playedCount).toBe(step.players);
      mine = after.roster.find((r: any) => r.name === P);
      expect(mine.creditBackCents ?? 0, `game ${i + 1}: credit back`).toBe(step.creditBack);
      expect(mine.owesCents).toBe(0);
      const pot = await potOf(ctx, P);
      expect(pot, `game ${i + 1}: pot after finalize`).toBe(step.potAfter);
      expect(pot).toBeGreaterThanOrEqual(0);
      // What the player put in for this game (credit used plus cash) minus the price is exactly what came back.
      expect(step.creditUsed + step.cash - step.price).toBe(step.creditBack);
      cashTotal += step.cash;
      pricesTotal += step.price;
      report.push(
        `Game ${i + 1}: ${step.players} play, price $${step.price / 100}. Credit used $${step.creditUsed / 100} + cash $${step.cash / 100} = $${(step.creditUsed + step.cash) / 100}; back as credit $${step.creditBack / 100}; credit after $${pot / 100}.`,
      );
      // Every other player who paid $14 cash also got exactly $14 - price back (nobody else's money moved).
      for (const n of others.slice(0, step.players - 1)) {
        const r = after.roster.find((x: any) => x.name === n);
        expect(r.paymentAmountCents - step.price + 0, `${n} game ${i + 1}`).toBe(r.creditBackCents ?? 0);
      }
      // Next game: the others start with no credit so only the player under test carries credit forward.
      for (const n of others) {
        const p = await potOf(ctx, n);
        if (p > 0) {
          expect((await phones[n].call('POST', '/api/me/refund-request', { cents: p })).status).toBe(200);
          const req = (await dashboard(ctx)).refundRequests.find((x: any) => x.playerId === ctx.byName[n]);
          expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' })).status).toBe(200);
          expect(await potOf(ctx, n)).toBe(0);
        }
      }
    }
    // Nothing lost or doubled: all the cash the player paid equals the four prices exactly, and the pot ends at $0.
    expect(cashTotal).toBe(1400 + 900 + 1100 + 800);
    expect(pricesTotal).toBe(900 + 1100 + 800 + 1400);
    expect(cashTotal).toBe(pricesTotal);
    expect(await potOf(ctx, P)).toBe(0);
    // The ledger itself: credit in and credit out balance, and no entry is negative.
    const rows = ledgerOf(ctx, P).filter((r) => !r.ended_at);
    const into = rows.filter((r) => r.kind === 'kept').reduce((a, r) => a + r.amount_cents, 0);
    const outOf = rows.filter((r) => r.kind === 'used').reduce((a, r) => a + r.amount_cents, 0);
    expect(rows.every((r) => r.amount_cents > 0)).toBe(true);
    expect(into).toBe(500 + 300 + 600);
    expect(outOf).toBe(500 + 300 + 600);
    // The numbers, for the report.
    console.log(`CREDIT CHAIN (${P}):\n${report.join('\n')}\nCash paid $${cashTotal / 100} = prices $${pricesTotal / 100}; credit at the end $0.`);
  });

  it('the same chain with the organizer playing (counted in N, pays nothing): 6 then 5, $5 back then $3 back', async () => {
    const ctx = await group();
    // Alex is the organizer and plays, as in the real group.
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    const P = 'Blair';
    const payers = ['Casey', 'Devon', 'Emery', 'Frankie'];
    const phone = await playerPhone(ctx, P);
    const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = {};
    for (const n of payers) phones[n] = await playerPhone(ctx, n);
    const [g1, g2] = (await dashboard(ctx)).sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now);
    const play = async (s: any, others: string[]) => {
      expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true })).status).toBe(200);
      for (const n of others) {
        expect((await phones[n].call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
        const o = await seat(ctx, s.id, n);
        if (o.paymentStatus !== 'paid') await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true });
      }
    };
    // Game 1: Alex + Blair + 4 = 6 play, $9 each. Blair paid $14 cash: $5 back.
    expect((await phone.call('POST', `/api/sessions/${g1.id}/join`, {})).status).toBe(200);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/payment`, { playerId: ctx.byName[P], paid: true });
    await play(g1, payers);
    ctx.app.now = Date.parse(g1.endsAt) + 10 * 60_000;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/finalize`, { everyone: true })).status).toBe(200);
    let view = (await dashboard(ctx)).sessions.find((x: any) => x.id === g1.id);
    expect(view.finalized).toMatchObject({ priceCents: 900, playedCount: 6 });
    expect(view.roster.find((r: any) => r.name === 'Alex').creditBackCents ?? 0).toBe(0);
    expect(await potOf(ctx, 'Alex')).toBe(0);
    expect(await potOf(ctx, P)).toBe(500);
    // Game 2: Alex + Blair + 3 = 5 play, $11 each. Blair: $5 credit at I'm in + $9 cash = $14; $3 back.
    const join = await phone.call('POST', `/api/sessions/${g2.id}/join`, {});
    expect(join.data.creditCents).toBe(500);
    expect((await seat(ctx, g2.id, P)).owesCents).toBe(900);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/payment`, { playerId: ctx.byName[P], paid: true });
    await play(g2, payers.slice(0, 3));
    ctx.app.now = Date.parse(g2.endsAt) + 10 * 60_000;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/finalize`, { everyone: true })).status).toBe(200);
    view = (await dashboard(ctx)).sessions.find((x: any) => x.id === g2.id);
    expect(view.finalized).toMatchObject({ priceCents: 1100, playedCount: 5 });
    expect(view.roster.find((r: any) => r.name === P)).toMatchObject({ paymentAmountCents: 1400, creditCents: 500, creditBackCents: 300, owesCents: 0 });
    expect(await potOf(ctx, P)).toBe(300);
    expect(await potOf(ctx, 'Alex')).toBe(0);
  });
});
