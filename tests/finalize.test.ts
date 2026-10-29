// The money engine under the "any number from 4 to 10 plays" model: the
// final price, credit back, no-shows, partial credit, unpaid players,
// drops, cancels, the waitlist at the max, reopen, and the numbers agreeing
// on Money, Players and each game.
import { describe, expect, it } from 'vitest';
import { creditBack, finalPrice } from '../shared/pricing';
import { DAY, HOUR, PLAYER_NAMES, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

/** Extra names so a game can reach 10. */
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];

async function group(opts: { organizerPlays?: boolean; maxPlayers?: number } = {}) {
  const ctx = await setupGroup();
  for (const name of MORE) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null });
  const body: Record<string, unknown> = { organizerName: 'Robin' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  await ctx.organizer.call('PUT', '/api/admin/group', body);
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.players = dash.data.players;
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  return ctx;
}

async function session(ctx: Ctx) {
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  return dash.data.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now);
}

async function joinAll(ctx: Ctx, sessionId: string, names: string[]) {
  const phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> = {};
  for (const name of names) {
    phones[name] = await playerPhone(ctx, name);
    const res = await phones[name].call('POST', `/api/sessions/${sessionId}/join`, {});
    expect(res.status, res.text).toBe(200);
  }
  return phones;
}

const pay = (ctx: Ctx, sessionId: string, name: string, paid = true) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/payment`, { playerId: ctx.byName[name], paid });

async function adminSession(ctx: Ctx, id: string) {
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  return dash.data.sessions.find((s: any) => s.id === id);
}

const row = (s: any, name: string) => s.roster.find((r: any) => r.name === name);

async function endGame(ctx: Ctx, s: any) {
  ctx.app.now = Date.parse(s.endsAt) + 5 * 60_000;
}

async function month(ctx: Ctx, s: any) {
  const m = new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).slice(0, 7);
  return (await ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
}

async function creditOf(ctx: Ctx, name: string) {
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  return dash.data.creditLedger.find((l: any) => l.playerId === ctx.byName[name])?.balanceCents ?? 0;
}

describe('the final price', () => {
  it('is 4 x $14 / N rounded down to whole dollars, never above $14', () => {
    const table: Record<number, [number, number]> = { 4: [1400, 0], 5: [1100, 300], 6: [900, 500], 7: [800, 600], 8: [700, 700], 9: [600, 800], 10: [500, 900] };
    for (const [n, [p, back]] of Object.entries(table)) {
      expect(finalPrice(1400, Number(n)), `N=${n}`).toBe(p);
      expect(creditBack(1400, Number(n)), `N=${n}`).toBe(back);
    }
    expect(finalPrice(1400, 3)).toBe(1400);
    expect(finalPrice(1400, 2)).toBe(1400);
    expect(finalPrice(1400, 12)).toBe(400);
    expect(finalPrice(1600, 5)).toBe(1200);
    expect(finalPrice(1500, 7)).toBe(800);
  });
});

describe('N from 4 to 10, everyone paid and played', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    it(`${n} play: $${finalPrice(1400, n) / 100} each, $${creditBack(1400, n) / 100} back, collected and the court row agree`, async () => {
      const ctx = await group();
      const s = await session(ctx);
      const names = [...PLAYER_NAMES, ...MORE].slice(0, n);
      await joinAll(ctx, s.id, names);
      for (const name of names) expect((await pay(ctx, s.id, name)).status).toBe(200);
      // Before finalizing: everyone paid $14 and the money is held, before and after the game.
      let m = await month(ctx, s);
      expect(m.heldCents).toBe(n * 1400);
      await endGame(ctx, s);
      m = await month(ctx, s);
      expect(m.heldCents).toBe(n * 1400);
      expect(m.collectedCents).toBe(0);
      let view = await adminSession(ctx, s.id);
      expect(view.needsFinalize).toBe(true);
      const fin = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
      expect(fin.status, fin.text).toBe(200);
      expect(fin.data.played).toBe(n);
      expect(fin.data.priceCents).toBe(finalPrice(1400, n));
      view = await adminSession(ctx, s.id);
      expect(view.finalized.priceCents).toBe(finalPrice(1400, n));
      expect(view.finalized.playedCount).toBe(n);
      expect(view.needsFinalize).toBe(false);
      const back = creditBack(1400, n);
      for (const name of names) {
        const r = row(view, name);
        expect(r.played).toBe(true);
        expect(r.paymentStatus).toBe('paid');
        expect(r.paymentAmountCents).toBe(1400);
        expect(r.creditBackCents, name).toBe(back);
        expect(r.owesCents).toBe(0);
        expect(await creditOf(ctx, name)).toBe(back);
      }
      // Collected = P x N (no organizer in this game), court cost $48 typical.
      m = await month(ctx, s);
      expect(m.collectedCents).toBe(finalPrice(1400, n) * n);
      expect(m.heldCents).toBe(0);
      expect(m.creditsOwedCents).toBe(back * n);
      expect(m.courtCostCents).toBe(4800);
      expect(m.netCents).toBe(finalPrice(1400, n) * n - 4800);
      expect(m.sessions.find((x: any) => x.id === s.id)).toMatchObject({ state: 'played', playedCount: n, priceCents: finalPrice(1400, n), collectedCents: finalPrice(1400, n) * n });
      // The court row: players cover P x N.
      expect(view.court.playersCoverCents).toBe(finalPrice(1400, n) * n);
      expect(view.court.yourShareCents).toBe(Math.max(0, 4800 - finalPrice(1400, n) * n));
      // Players tab agrees.
      const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
      for (const name of names) {
        const l = dash.data.creditLedger.find((x: any) => x.playerId === ctx.byName[name]);
        if (back > 0) expect(l.entries.filter((e: any) => !e.endedAt)).toEqual([expect.objectContaining({ kind: 'kept', cents: back, reason: 'finalized', playedCount: n })]);
        else expect(l).toBeUndefined();
      }
    });
  }
});

describe('the organizer playing', () => {
  it('counts toward N but never pays: 5 play with the organizer, the 4 others pay $11 and get $3 back', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const names = PLAYER_NAMES.slice(0, 4);
    await joinAll(ctx, s.id, names);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true })).status).toBe(200);
    for (const name of names) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    let view = await adminSession(ctx, s.id);
    expect(view.confirmedCount).toBe(5);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    for (const name of names) expect(row(view, name).creditBackCents).toBe(300);
    const me = view.roster.find((r: any) => r.isOrganizer);
    expect(me.played).toBe(true);
    expect(me.creditBackCents).toBe(0);
    expect(me.shareCents).toBeNull();
    const m = await month(ctx, s);
    expect(m.collectedCents).toBe(4 * 1100);
    expect(view.court.playersCoverCents).toBe(4400);
    expect(view.court.yourShareCents).toBe(400);
    // The organizer has no credit anywhere.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect(dash.data.creditLedger.some((l: any) => l.playerId === dash.data.me.id)).toBe(false);
  });

  it('with the organizer not playing: 4 others play, $14 each, nothing back', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const names = PLAYER_NAMES.slice(0, 4);
    await joinAll(ctx, s.id, names);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const name of names) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const played = names.map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { played })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 4, priceCents: 1400 });
    expect(view.roster.find((r: any) => r.playerId === dash.data.me.id).played).toBe(false);
    for (const name of names) expect(row(view, name).creditBackCents).toBe(0);
  });
});

describe('who did not play', () => {
  it('a no-show who paid cash gets it all back as credit; the others pay the price for 5', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const names = PLAYER_NAMES; // 6 in
    await joinAll(ctx, s.id, names);
    for (const name of names) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    const played = names.filter((n) => n !== 'Frankie').map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { played })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    const f = row(view, 'Frankie');
    expect(f.played).toBe(false);
    expect(f.creditBackCents).toBe(1400);
    expect(f.creditBackReason).toBe('not_played');
    expect(f.owesCents).toBe(0);
    expect(f.refundedAt).not.toBeNull();
    expect(await creditOf(ctx, 'Frankie')).toBe(1400);
    for (const name of names.slice(0, 5)) expect(row(view, name).creditBackCents).toBe(300);
    const m = await month(ctx, s);
    expect(m.collectedCents).toBe(5 * 1100);
    expect(m.creditsOwedCents).toBe(5 * 300 + 1400);
    expect(m.heldCents).toBe(0);
  });

  it('a no-show who paid with credit gets the credit back; a no-show who paid nothing owes nothing', async () => {
    const ctx = await group();
    const s1 = await session(ctx);
    // Give Alex $14 credit: pay for a game, then it is canceled.
    const phones = await joinAll(ctx, s1.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s1.id, 'Alex');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s1.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s2 = dash.data.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now && s.id !== s1.id);
    await joinAll(ctx, s2.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await phones.Alex.call('POST', `/api/sessions/${s2.id}/use-credit`, {})).data).toMatchObject({ paid: true, usedCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    for (const name of ['Blair', 'Casey', 'Devon']) await pay(ctx, s2.id, name);
    await endGame(ctx, s2);
    // Alex and Emery did not play (Emery never paid).
    const played = ['Blair', 'Casey', 'Devon'].map((n) => ctx.byName[n]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/finalize`, { played })).status).toBe(200);
    const view = await adminSession(ctx, s2.id);
    expect(view.finalized).toMatchObject({ playedCount: 3, priceCents: 1400 });
    expect(row(view, 'Alex')).toMatchObject({ played: false, creditBackCents: 1400, owesCents: 0 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(row(view, 'Emery')).toMatchObject({ played: false, creditBackCents: 0, owesCents: 0, paymentStatus: 'unpaid' });
    const m = await month(ctx, s2);
    expect(m.collectedCents).toBe(3 * 1400);
    // Emery is not in "who owes".
    const dash2 = await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect(dash2.data.sessions.find((x: any) => x.id === s2.id).roster.find((r: any) => r.name === 'Emery').shareCents).toBeNull();
  });
});

describe('credit and unpaid players at finalize', () => {
  it('partial credit then a lower final price: used $5, owes $6 at $11; used $5 at $5 (10 play) is paid with nothing back', async () => {
    const ctx = await group();
    const s1 = await session(ctx);
    const phones = await joinAll(ctx, s1.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s1.id, 'Alex');
    // Alex drops: the $14 is credit. Then he spends $9 of it elsewhere to leave $5.
    expect((await phones.Alex.call('POST', `/api/sessions/${s1.id}/withdraw`, {})).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    // Simplest way to a $5 pot: request and mark refunded $9.
    expect((await phones.Alex.call('POST', '/api/me/refund-request', { cents: 900 })).status).toBe(200);
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${dash.data.refundRequests[0].id}`, { action: 'refunded' })).status).toBe(200);
    expect(await creditOf(ctx, 'Alex')).toBe(500);
    const s2 = dash.data.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now && s.id !== s1.id);
    await joinAll(ctx, s2.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await phones.Alex.call('POST', `/api/sessions/${s2.id}/use-credit`, {})).data).toMatchObject({ paid: false, usedCents: 500 });
    for (const name of ['Blair', 'Casey', 'Devon', 'Emery']) await pay(ctx, s2.id, name);
    await endGame(ctx, s2);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/finalize`, { everyone: true })).status).toBe(200);
    let view = await adminSession(ctx, s2.id);
    expect(view.finalized.priceCents).toBe(1100);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 600, creditCents: 500, shareCents: 1100 });
    // The player sees exactly $6 to pay for the finalized game.
    const g = (await phones.Alex.call('GET', '/api/group')).data;
    expect(g.owed).toEqual([expect.objectContaining({ sessionId: s2.id, amountCents: 600, creditCents: 500, finalized: true })]);
    // Mark paid: the payment is the whole $11 (cash $6 plus credit $5), nothing back.
    expect((await pay(ctx, s2.id, 'Alex')).status).toBe(200);
    view = await adminSession(ctx, s2.id);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100, creditBackCents: 0, owesCents: 0 });
    const m = await month(ctx, s2);
    expect(m.collectedCents).toBe(5 * 1100);
  });

  it('used $9 credit on a $14 seat, 10 play ($5): paid with credit and $4 comes back', async () => {
    const ctx = await group();
    const s1 = await session(ctx);
    const phones = await joinAll(ctx, s1.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s1.id, 'Alex');
    await phones.Alex.call('POST', `/api/sessions/${s1.id}/withdraw`, {});
    await phones.Alex.call('POST', '/api/me/refund-request', { cents: 500 });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    await ctx.organizer.call('POST', `/api/admin/refund-requests/${dash.data.refundRequests[0].id}`, { action: 'refunded' });
    expect(await creditOf(ctx, 'Alex')).toBe(900);
    const s2 = dash.data.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now && s.id !== s1.id);
    const names = [...PLAYER_NAMES, ...MORE].slice(0, 10);
    await joinAll(ctx, s2.id, names);
    expect((await phones.Alex.call('POST', `/api/sessions/${s2.id}/use-credit`, {})).data).toMatchObject({ paid: false, usedCents: 900 });
    for (const name of names.slice(1)) await pay(ctx, s2.id, name);
    await endGame(ctx, s2);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/finalize`, { everyone: true })).status).toBe(200);
    const view = await adminSession(ctx, s2.id);
    expect(view.finalized.priceCents).toBe(500);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, creditCents: 900, creditBackCents: 400, owesCents: 0 });
    expect(await creditOf(ctx, 'Alex')).toBe(400);
    const m = await month(ctx, s2);
    expect(m.collectedCents).toBe(10 * 500);
  });

  it('someone who has not paid owes the final price, not $14, and Venmo is for exactly that', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, PLAYER_NAMES);
    for (const name of PLAYER_NAMES.slice(1)) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(row(view, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 900, shareCents: 900, creditBackCents: 0 });
    const g = (await phones.Alex.call('GET', '/api/group')).data;
    expect(g.owed).toEqual([expect.objectContaining({ amountCents: 900, finalized: true })]);
    expect(g.payDue).toHaveLength(1);
    // Who owes you on Home lists $9.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const sv = dash.data.sessions.find((x: any) => x.id === s.id);
    expect(sv.roster.find((r: any) => r.name === 'Alex').owesCents).toBe(900);
    // Marking paid records $9 and collected is 6 x $9.
    await pay(ctx, s.id, 'Alex');
    const after = await adminSession(ctx, s.id);
    expect(row(after, 'Alex').paymentAmountCents).toBe(900);
    expect((await month(ctx, s)).collectedCents).toBe(5400);
  });

  it('changing $14 in Settings after finalizing does not change old games', async () => {
    const ctx = await group();
    const s = await session(ctx);
    await joinAll(ctx, s.id, PLAYER_NAMES);
    for (const name of PLAYER_NAMES) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 2000 } })).status).toBe(200);
    const view = await adminSession(ctx, s.id);
    expect(view.finalized.priceCents).toBe(900);
    for (const name of PLAYER_NAMES) expect(row(view, name).creditBackCents).toBe(500);
    expect((await month(ctx, s)).collectedCents).toBe(5400);
    // A new game uses $20 and finalizes with the formula on $20.
    expect(finalPrice(2000, 5)).toBe(1600);
  });
});

describe('money coming back becomes credit automatically', () => {
  it('a paid player taps I\'m out: credit right away, the seat is settled, held drops, rejoining owes again', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, 'Alex');
    expect((await month(ctx, s)).heldCents).toBe(1400);
    const out = await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    expect(out.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect((await month(ctx, s)).heldCents).toBe(0);
    let g = (await phones.Alex.call('GET', '/api/group')).data;
    expect(g.credit.balanceCents).toBe(1400);
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ status: 'withdrawn', creditBackCents: 1400 });
    // Back in: owes $14 again (the money is credit now) and Use credit is offered.
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/join`, {})).data.result).toBe('confirmed');
    g = (await phones.Alex.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 1400, creditBackCents: 1400 });
    // No refund card anywhere: nothing on Home for it.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect(dash.data.refundRequests).toEqual([]);
    const history = dash.data.creditLedger.find((l: any) => l.playerId === ctx.byName.Alex).entries;
    expect(history).toEqual([expect.objectContaining({ kind: 'kept', cents: 1400, reason: 'dropped', sessionId: s.id })]);
  });

  it('an unpaid player who drops creates nothing; a drop of a credit-paid seat returns the credit', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await phones.Blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).data.creditBackCents).toBe(0);
    expect(await creditOf(ctx, 'Blair')).toBe(0);
    // Alex: paid, out (credit $14), in, Use credit (paid with credit), out again: the credit comes back, no second entry.
    await pay(ctx, s.id, 'Alex');
    await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await phones.Alex.call('POST', `/api/sessions/${s.id}/join`, {});
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/use-credit`, {})).data.paid).toBe(true);
    expect(await creditOf(ctx, 'Alex')).toBe(0);
    expect((await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {})).data.creditBackCents).toBe(0);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
  });

  it('canceling with several paid players: everyone gets credit, "Were you charged" at 11 hours but not 13', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, 'Alex');
    await pay(ctx, s.id, 'Blair');
    // Casey pays with credit from an earlier drop elsewhere: skip, keep it simple. Cancel at 13 hours: no charge recorded even if sent.
    ctx.app.now = Date.parse(s.startsAt) - 13 * HOUR;
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true, chargedCents: 4800 });
    expect(res.status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(view.chargedCents).toBeNull();
    expect(row(view, 'Alex')).toMatchObject({ creditBackCents: 1400, creditBackReason: 'canceled' });
    expect(row(view, 'Blair').creditBackCents).toBe(1400);
    expect(row(view, 'Casey').creditBackCents).toBe(0);
    expect(await creditOf(ctx, 'Alex')).toBe(1400);
    expect(await creditOf(ctx, 'Blair')).toBe(1400);
    const g = (await phones.Alex.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine.creditBackCents).toBe(1400);
    // Another game canceled at 11 hours with the charge: recorded as its court cost.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s2 = dash.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now && x.id !== s.id);
    await joinAll(ctx, s2.id, ['Casey']);
    ctx.app.now = Date.parse(s2.startsAt) - 11 * HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/decision`, { decision: 'cancel', confirm: true, chargedCents: 4800 })).status).toBe(200);
    view = await adminSession(ctx, s2.id);
    expect(view.chargedCents).toBe(4800);
    expect((await month(ctx, s2)).courtCostCents).toBe(4800);
    expect((await month(ctx, s)).creditsOwedCents).toBe(2800);
  });
});

describe('the waitlist at the max', () => {
  it('the 11th person waits; a drop moves them in owing $14 with the Spot opened text; the max is a setting', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const names = [...PLAYER_NAMES, ...MORE].slice(0, 10);
    const phones = await joinAll(ctx, s.id, names);
    const eleventh = await playerPhone(ctx, MORE[4]);
    const res = await eleventh.call('POST', `/api/sessions/${s.id}/join`, {});
    expect(res.data).toMatchObject({ result: 'waitlisted', position: 1 });
    let g = (await eleventh.call('GET', '/api/group')).data;
    const sv = g.sessions.find((x: any) => x.id === s.id);
    expect(sv.countText).toBe('10 in, full');
    expect(sv.full).toBe(true);
    expect(sv.mine).toMatchObject({ status: 'waitlisted', oweCents: 0, shareCents: null });
    // Someone drops: the waiting player moves in and owes $14.
    await phones.Alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    g = (await eleventh.call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ status: 'confirmed', promotion: 'spot_opened', oweCents: 1400 });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const view = dash.data.sessions.find((x: any) => x.id === s.id);
    expect(view.confirmedCount).toBe(10);
    expect(view.roster.find((r: any) => r.name === MORE[4]).promotionReason).toBe('spot_opened');
    // Max players is a setting: with 6, the 7th waits.
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } })).status).toBe(200);
    const dash2 = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s2 = dash2.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now && x.id !== s.id);
    await joinAll(ctx, s2.id, PLAYER_NAMES);
    const seventh = await playerPhone(ctx, MORE[0]);
    expect((await seventh.call('POST', `/api/sessions/${s2.id}/join`, {})).data.result).toBe('waitlisted');
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 13 } })).status).toBe(200);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.settings.maxPlayers).toBe(12);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 2 } })).status).toBe(200);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.group.settings.maxPlayers).toBe(4);
  });

  it('the 5th, 7th and 9th are simply in: no special rules, counts read "5 in"', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, PLAYER_NAMES.slice(0, 5));
    const g = (await phones.Emery.call('GET', '/api/group')).data;
    const sv = g.sessions.find((x: any) => x.id === s.id);
    expect(sv.countText).toBe('5 in');
    expect(sv.mine).toMatchObject({ status: 'confirmed', oweCents: 1400, shareCents: 1400 });
    expect(sv.joinAs).toBe('in');
    const three = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(three.confirmed).toHaveLength(5);
  });
});

describe('reopen', () => {
  it('reverses the credit and the finalize so it can be redone; blocked once credit from it was used or refunded', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, PLAYER_NAMES);
    for (const name of PLAYER_NAMES) await pay(ctx, s.id, name);
    await endGame(ctx, s);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    expect(await creditOf(ctx, 'Alex')).toBe(500);
    expect((await adminSession(ctx, s.id)).reopenBlockedBy).toEqual([]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {})).status).toBe(200);
    let view = await adminSession(ctx, s.id);
    expect(view.finalized).toBeNull();
    expect(view.needsFinalize).toBe(true);
    for (const name of PLAYER_NAMES) {
      expect(row(view, name)).toMatchObject({ played: null, creditBackCents: 0, paymentAmountCents: 1400 });
      expect(await creditOf(ctx, name)).toBe(0);
    }
    expect((await month(ctx, s)).heldCents).toBe(6 * 1400);
    // Redo with a no-show.
    const played = PLAYER_NAMES.filter((n) => n !== 'Frankie').map((n) => ctx.byName[n]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { played });
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    expect(row(view, 'Frankie').creditBackCents).toBe(1400);
    // Frankie spends some credit on the next game: reopen is blocked, with a plain reason.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s2 = dash.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now && x.id !== s.id);
    await phones.Frankie.call('POST', `/api/sessions/${s2.id}/join`, {});
    expect((await phones.Frankie.call('POST', `/api/sessions/${s2.id}/use-credit`, {})).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.reopenBlockedBy).toEqual(['Frankie']);
    const blocked = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.data.message).toMatch(/Frankie/);
    expect((await adminSession(ctx, s.id)).finalized).not.toBeNull();
  });

  it('finalizing with fewer than 4 in uses $14; the card offers cancel instead; canceling a finalized game is refused', async () => {
    const ctx = await group();
    const s = await session(ctx);
    await joinAll(ctx, s.id, ['Alex', 'Blair', 'Casey']);
    await pay(ctx, s.id, 'Alex');
    await endGame(ctx, s);
    let view = await adminSession(ctx, s.id);
    expect(view.needsFinalize).toBe(true);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    view = await adminSession(ctx, s.id);
    expect(view.finalized).toMatchObject({ playedCount: 3, priceCents: 1400 });
    expect(row(view, 'Alex').creditBackCents).toBe(0);
    expect(row(view, 'Blair').owesCents).toBe(1400);
    const cancel = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    expect(cancel.status).toBe(409);
    // Cannot finalize before the end, or twice.
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const s2 = dash.data.sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now);
    await joinAll(ctx, s2.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s2.id}/finalize`, { everyone: true })).status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(409);
  });
});

describe('the numbers agree and nothing private leaks', () => {
  it('Money, Players and each game tell one story across a cancel, a drop, a no-show and a finalize', async () => {
    const ctx = await group();
    const s = await session(ctx);
    const phones = await joinAll(ctx, s.id, PLAYER_NAMES);
    for (const name of PLAYER_NAMES.slice(0, 5)) await pay(ctx, s.id, name);
    // Emery drops (paid): $14 credit. Frankie never pays and does not play.
    await phones.Emery.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await endGame(ctx, s);
    const played = ['Alex', 'Blair', 'Casey', 'Devon'].map((n) => ctx.byName[n]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { played });
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const view = dash.data.sessions.find((x: any) => x.id === s.id);
    expect(view.finalized).toMatchObject({ playedCount: 4, priceCents: 1400, creditBackCents: 1400 });
    const m = await month(ctx, s);
    expect(m.collectedCents).toBe(4 * 1400);
    expect(m.heldCents).toBe(0);
    expect(m.creditsOwedCents).toBe(1400);
    const ledger = dash.data.creditLedger;
    const sumPots = ledger.reduce((sum: number, l: any) => sum + l.balanceCents, 0);
    expect(sumPots).toBe(m.creditsOwedCents);
    expect(ledger.find((l: any) => l.playerId === ctx.byName.Emery).balanceCents).toBe(1400);
    // Each player's own screen: only their own money.
    for (const name of PLAYER_NAMES) {
      const g = (await phones[name].call('GET', '/api/group')).data;
      const text = JSON.stringify(g);
      expect(text).not.toMatch(/phone|venmo_handle|venmoHandle|courtCost|membership/i);
      expect(text).not.toContain('555-');
      expect(g.credit.balanceCents).toBe(name === 'Emery' ? 1400 : 0);
      // Nobody else's credit or payment is in the response.
      for (const other of PLAYER_NAMES.filter((x) => x !== name)) expect(text).not.toMatch(new RegExp(`${other}[^"]*(credit|paid|owe)`, 'i'));
    }
  });
});
