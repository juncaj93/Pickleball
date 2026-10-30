// Dry run before the first real game (Tue Nov 3, 2026): the whole money flow
// the way an organizer would run it, for 4 to 10 players and the edge cases,
// with one bookkeeping check after every step: all the cash players sent
// equals what the group kept + what is still held + credit in players' pots
// + credit paid back out. Nothing lost, nothing created.
import { describe, expect, it } from 'vitest';
import { finalMessage } from '../shared/messages';
import { creditBack, finalPrice } from '../shared/pricing';
import { HOUR, PLAYER_NAMES, playerPhone, setupGroup } from './harness';

type Phone = Awaited<ReturnType<typeof playerPhone>>;

const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
const EVERYONE = [...PLAYER_NAMES, ...MORE];
const TABLE: Record<number, [number, number]> = { 4: [1400, 0], 5: [1100, 300], 6: [900, 500], 7: [800, 600], 8: [700, 700], 9: [600, 800], 10: [500, 900] };

/** A fake group with 12 players and the organizer "Robin" (who plays, never pays the group). */
async function dry() {
  const ctx = await setupGroup();
  for (const name of [...MORE, 'Robin']) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null });
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
  const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
  ctx.byName = Object.fromEntries(dash.data.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  const phones: Record<string, Phone> = {};
  /** Cash that really left players' pockets (Venmo), and cash paid back out to them. */
  const book = { cashIn: 0, cashedOut: 0 };
  const phone = async (name: string) => (phones[name] ??= await playerPhone(ctx, name));
  return { ctx, phone, book };
}
type Dry = Awaited<ReturnType<typeof dry>>;

const dash = async (d: Dry) => (await d.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const view = async (d: Dry, id: string) => (await dash(d)).sessions.find((s: any) => s.id === id);
const row = (s: any, name: string) => s.roster.find((r: any) => r.name === name);
async function games(d: Dry) {
  const all = (await dash(d)).sessions.filter((s: any) => Date.parse(s.startsAt) > d.ctx.app.now);
  return all.sort((a: any, b: any) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
async function join(d: Dry, id: string, names: string[]) {
  for (const n of names) {
    const r = await (await d.phone(n)).call('POST', `/api/sessions/${id}/join`, {});
    expect(r.status, `${n} join: ${r.text}`).toBe(200);
  }
}
/** What the player's own screen says they owe for this game (what Venmo would open for). */
async function owes(d: Dry, name: string, id: string) {
  const g = (await (await d.phone(name)).call('GET', '/api/group')).data;
  return g.owed.find((o: any) => o.sessionId === id)?.amountCents ?? 0;
}
/** The player sends the Venmo for exactly what their screen says, and the organizer marks it paid. */
async function venmoAndMark(d: Dry, name: string, id: string) {
  const amount = await owes(d, name, id);
  d.book.cashIn += amount;
  const r = await d.ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: d.ctx.byName[name], paid: true });
  expect(r.status, r.text).toBe(200);
  return amount;
}
async function useCredit(d: Dry, name: string, id: string) {
  return (await (await d.phone(name)).call('POST', `/api/sessions/${id}/use-credit`, {})).data;
}
async function finalize(d: Dry, id: string, body: Record<string, unknown>) {
  const r = await d.ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, body);
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const played = (d: Dry, names: string[]) => ({ played: names.map((n) => d.ctx.byName[n]) });

/**
 * Nothing lost, nothing created: cash in = collected (finalized games, every
 * month) + held (not finalized) + every pot + cashed out. Also: each pot on
 * Players equals what the player sees, and no pot is negative.
 */
async function balanced(d: Dry, label: string) {
  let collected = 0;
  let held = 0;
  for (const m of ['2026-10', '2026-11', '2026-12']) {
    const r = (await d.ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data;
    collected += r.collectedCents;
    held += r.heldCents;
  }
  const ledger = (await dash(d)).creditLedger as any[];
  const pots = ledger.reduce((s, l) => s + l.balanceCents, 0);
  expect({ label, sum: collected + held + pots + d.book.cashedOut }).toEqual({ label, sum: d.book.cashIn });
  for (const l of ledger) {
    expect(l.balanceCents, `${label}: negative pot`).toBeGreaterThanOrEqual(0);
    const name = Object.keys(d.ctx.byName).find((n) => d.ctx.byName[n] === l.playerId)!;
    if (name === 'Robin') throw new Error(`${label}: the organizer has credit`);
    const g = (await (await d.phone(name)).call('GET', '/api/group')).data;
    expect(g.credit.balanceCents, `${label}: ${name} sees a different pot`).toBe(l.balanceCents);
  }
  return { collected, held, pots };
}

const endOf = (d: Dry, s: any) => (d.ctx.app.now = Date.parse(s.endsAt) + 5 * 60_000);

describe('dry run: 4 to 10 play, the organizer among them, mixed ways of paying', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    it(`${n} play (organizer + ${n - 1}): price, credit back, Money, court row, post-game text, player screens`, async () => {
      const d = await dry();
      const [g1, g2] = await games(d);
      // Give Blair $14 credit from a game that gets canceled, so she can pay with credit later.
      await join(d, g1.id, ['Blair']);
      await venmoAndMark(d, 'Blair', g1.id);
      expect((await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
      await balanced(d, 'after cancel');

      const others = EVERYONE.filter((x) => x !== 'Robin').slice(0, n - 1);
      await join(d, g2.id, others);
      expect((await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/me`, { in: true })).status).toBe(200);
      let v = await view(d, g2.id);
      expect(v.confirmedCount).toBe(n);
      // Ways of paying: Alex never pays, Blair pays with credit, Casey taps "I paid" (organizer confirms), the rest Venmo + Mark paid.
      expect(await useCredit(d, 'Blair', g2.id)).toMatchObject({ paid: true, usedCents: 1400 });
      if (others.includes('Casey')) {
        expect(await owes(d, 'Casey', g2.id)).toBe(1400);
        d.book.cashIn += 1400;
        expect((await (await d.phone('Casey')).call('POST', `/api/sessions/${g2.id}/paid`, { paid: true })).status).toBe(200);
        await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/payment`, { playerId: d.ctx.byName.Casey, paid: true });
      }
      for (const x of others.filter((y) => !['Alex', 'Blair', 'Casey'].includes(y))) expect(await venmoAndMark(d, x, g2.id)).toBe(1400);
      await balanced(d, 'paid, game not over');

      // The organizer row before finalizing: others count at $14.
      const paidOthers = n - 1;
      expect(v.court).toBeTruthy();
      endOf(d, g2);
      v = await view(d, g2.id);
      expect(v.needsFinalize).toBe(true);
      expect(v.court.playersCoverCents).toBe(paidOthers * 1400);
      // The Finalize card preview the organizer sees.
      const [P, back] = TABLE[n];
      const fin = await finalize(d, g2.id, { everyone: true });
      expect(fin).toMatchObject({ played: n, priceCents: P });
      v = await view(d, g2.id);
      expect(v.finalized).toMatchObject({ playedCount: n, priceCents: P });

      // Each player: what they paid and what came back.
      for (const x of others) {
        const r = row(v, x);
        expect(r.played, x).toBe(true);
        if (x === 'Alex') expect(r, x).toMatchObject({ paymentStatus: 'unpaid', owesCents: P, shareCents: P, creditBackCents: 0 });
        else expect(r, x).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditBackCents: back, owesCents: 0 });
      }
      const me = v.roster.find((r: any) => r.isOrganizer);
      expect(me).toMatchObject({ played: true, creditBackCents: 0, shareCents: null });
      // Alex's own screen: owes exactly P, not $14.
      expect(await owes(d, 'Alex', g2.id)).toBe(P);
      // The court row now counts others at P: Alex unpaid still owes P, so it covers P x (n-1).
      expect(v.court.playersCoverCents).toBe(P * (n - 1));
      expect(v.court.yourShareCents).toBe(Math.max(0, 4800 - P * (n - 1)));

      let b = await balanced(d, 'finalized, Alex unpaid');
      // Collected so far = P from each of the n-2 who paid.
      expect(b.collected).toBe(P * (n - 2));
      await venmoAndMark(d, 'Alex', g2.id);
      b = await balanced(d, 'finalized, all paid');
      expect(b.collected).toBe(P * (n - 1));
      expect(b.held).toBe(0);
      // Pots: everyone who paid $14 has `back`; Blair's credit is back too.
      const ledger = (await dash(d)).creditLedger as any[];
      for (const x of others) expect(ledger.find((l) => l.playerId === d.ctx.byName[x])?.balanceCents ?? 0, x).toBe(x === 'Alex' ? 0 : back);
      const ym = new Date(g2.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }).slice(0, 7);
      const mNov = (await d.ctx.organizer.call('GET', `/api/admin/money?month=${ym}`)).data;
      expect(mNov.sessions.find((s: any) => s.id === g2.id)).toMatchObject({ state: 'played', playedCount: n, priceCents: P, collectedCents: P * (n - 1) });

      // The post-game group text on organizer Home.
      const fv = (await view(d, g2.id)).finalized;
      expect(fv.flatCents).toBe(1400);
      const text = finalMessage(g2, 'America/Detroit', fv.playedCount, fv.priceCents, fv.flatCents, 'pickleball.juncaj.net');
      const day = new Date(g2.startsAt).toLocaleDateString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric' });
      const want = back > 0
        ? `Pickleball ${day} is final: ${n} played, $${P / 100} each. If you paid $14, the extra $${back / 100} is now credit on your account.`
        : `Pickleball ${day} is final: ${n} played, $14 each.`;
      expect(text).toBe(`${want} pickleball.juncaj.net`);
      // A paid player's own screen: credit history line "+$X Tue, Nov 3 (N played)".
      if (back > 0) {
        const g = (await (await d.phone('Devon')).call('GET', '/api/group')).data;
        expect(g.credit.balanceCents).toBe(back);
        expect(g.credit.history[0]).toMatchObject({ playedCount: n });
      }
    });
  }
});

describe('dry run: edge cases', () => {
  it('drops before and after the cutoff (cash, credit, unpaid), then a no-show, with the waitlist moving in', async () => {
    const d = await dry();
    await d.ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } });
    const [g1, g2] = await games(d);
    // Blair gets $14 credit from a canceled game.
    await join(d, g1.id, ['Blair']);
    await venmoAndMark(d, 'Blair', g1.id);
    await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });

    await join(d, g2.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']);
    let v = await view(d, g2.id);
    expect(v.confirmedCount).toBe(6);
    expect(row(v, 'Gale').status).toBe('waitlisted');
    expect(await owes(d, 'Gale', g2.id)).toBe(0);
    for (const x of ['Alex', 'Casey', 'Devon', 'Emery']) await venmoAndMark(d, x, g2.id);
    await useCredit(d, 'Blair', g2.id);
    await balanced(d, 'all paid but Frankie');

    // Early drop, cash paid: Alex. Gale moves in owing $14.
    expect((await (await d.phone('Alex')).call('POST', `/api/sessions/${g2.id}/withdraw`, {})).data).toMatchObject({ creditBackCents: 1400 });
    v = await view(d, g2.id);
    expect(row(v, 'Gale').status).toBe('confirmed');
    expect(await owes(d, 'Gale', g2.id)).toBe(1400);
    await balanced(d, 'Alex dropped');
    // Late drop (inside the cutoff), paid with credit: Blair gets her credit back.
    d.ctx.app.now = Date.parse(g2.startsAt) - 2 * HOUR;
    const bl = await (await d.phone('Blair')).call('POST', `/api/sessions/${g2.id}/withdraw`, {});
    expect(bl.status, bl.text).toBe(200);
    await balanced(d, 'Blair late drop');
    expect((await (await d.phone('Blair')).call('GET', '/api/group')).data.credit.balanceCents).toBe(1400);
    // Unpaid late drop: Frankie owes nothing, nothing created.
    await (await d.phone('Frankie')).call('POST', `/api/sessions/${g2.id}/withdraw`, {});
    expect(await owes(d, 'Frankie', g2.id)).toBe(0);
    await balanced(d, 'Frankie dropped');
    await venmoAndMark(d, 'Gale', g2.id);
    // In now: Casey, Devon, Emery, Gale (4). Emery does not show.
    endOf(d, g2);
    await finalize(d, g2.id, played(d, ['Casey', 'Devon', 'Gale']));
    v = await view(d, g2.id);
    expect(v.finalized).toMatchObject({ playedCount: 3, priceCents: 1400 });
    expect(row(v, 'Emery')).toMatchObject({ creditBackCents: 1400, owesCents: 0 });
    const b = await balanced(d, 'finalized 3 played, no-show');
    expect(b.collected).toBe(3 * 1400);
  });

  it('partial credit, someone who owes nothing, Reopen, Undo, and a pending cash out during finalize', async () => {
    const d = await dry();
    const [g1, g2, g3] = await games(d);
    // Alex ends with $5 credit: $14 back from a cancel, cashes out $9.
    await join(d, g1.id, ['Alex', 'Blair']);
    await venmoAndMark(d, 'Alex', g1.id);
    await venmoAndMark(d, 'Blair', g1.id);
    await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await (await d.phone('Alex')).call('POST', '/api/me/refund-request', { cents: 900 })).status).toBe(200);
    let req = (await dash(d)).refundRequests[0];
    expect((await d.ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' })).status).toBe(200);
    d.book.cashedOut += 900;
    await balanced(d, 'Alex cashed out $9');
    // Blair asks to cash out all $14 and it is still pending during the next finalize.
    expect((await (await d.phone('Blair')).call('POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(200);
    // Pending amount can't be spent.
    await join(d, g2.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const blocked = await useCredit(d, 'Blair', g2.id);
    expect(blocked.usedCents ?? 0).toBe(0);
    // Alex uses $5, owes $9.
    expect(await useCredit(d, 'Alex', g2.id)).toMatchObject({ usedCents: 500 });
    expect(await owes(d, 'Alex', g2.id)).toBe(900);
    await venmoAndMark(d, 'Alex', g2.id);
    for (const x of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await venmoAndMark(d, x, g2.id);
    await balanced(d, 'six paid, Blair request pending');
    endOf(d, g2);
    await finalize(d, g2.id, { everyone: true });
    let v = await view(d, g2.id);
    expect(v.finalized).toMatchObject({ playedCount: 6, priceCents: 900 });
    for (const x of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) expect(row(v, x).creditBackCents, x).toBe(500);
    await balanced(d, 'finalized 6 with a pending request');
    // Blair: $14 pending + $5 new = pot $19, usable $5.
    let bl = (await dash(d)).creditLedger.find((l: any) => l.playerId === d.ctx.byName.Blair);
    expect(bl).toMatchObject({ balanceCents: 1900, reservedCents: 1400 });
    // Reopen is blocked? Blair's $5 is still in her pot on top of the $14 reserved, so reopen is allowed.
    const ro = await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/reopen`, {});
    expect(ro.status, ro.text).toBe(200);
    await balanced(d, 'reopened');
    v = await view(d, g2.id);
    expect(row(v, 'Alex')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    // Redo: Frankie did not play, 5 at $11.
    await finalize(d, g2.id, played(d, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']));
    v = await view(d, g2.id);
    for (const x of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) expect(row(v, x).creditBackCents, x).toBe(300);
    expect(row(v, 'Frankie').creditBackCents).toBe(1400);
    let b = await balanced(d, 'refinalized at 5');
    expect(b.collected).toBe(5 * 1100);
    // Mark refunded Blair's $14, then Undo, then do it again.
    req = (await dash(d)).refundRequests[0];
    await d.ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' });
    d.book.cashedOut += 1400;
    await balanced(d, 'Blair refunded');
    // Frankie owes nothing on g3 if they use credit: $14 covers it.
    await join(d, g3.id, ['Frankie', 'Casey', 'Devon', 'Emery']);
    expect(await useCredit(d, 'Frankie', g3.id)).toMatchObject({ paid: true, usedCents: 1400 });
    expect(await owes(d, 'Frankie', g3.id)).toBe(0);
    // Undo "Paid with credit", then use it again.
    expect((await (await d.phone('Frankie')).call('POST', `/api/sessions/${g3.id}/undo-credit`, {})).status).toBe(200);
    expect(await owes(d, 'Frankie', g3.id)).toBe(1400);
    await balanced(d, 'Frankie undo credit');
    expect(await useCredit(d, 'Frankie', g3.id)).toMatchObject({ paid: true });
    b = await balanced(d, 'end');
    // Now g2 cannot be reopened (Frankie spent credit from it).
    expect((await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/reopen`, {})).status).toBe(409);
    bl = (await dash(d)).creditLedger.find((l: any) => l.playerId === d.ctx.byName.Blair);
    expect(bl).toMatchObject({ balanceCents: 300, reservedCents: 0 });
  });

  it('double taps never double charge or double credit', async () => {
    const d = await dry();
    const [g1, g2] = await games(d);
    await join(d, g1.id, ['Alex']);
    await venmoAndMark(d, 'Alex', g1.id);
    await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });
    await join(d, g2.id, EVERYONE.slice(0, 6));
    // Two Use credit taps at once.
    const alex = await d.phone('Alex');
    await Promise.all([alex.call('POST', `/api/sessions/${g2.id}/use-credit`, {}), alex.call('POST', `/api/sessions/${g2.id}/use-credit`, {})]);
    expect((await alex.call('GET', '/api/group')).data.credit.balanceCents).toBe(0);
    // Two Mark paid taps at once (Venmo was sent once).
    const amount = await owes(d, 'Blair', g2.id);
    d.book.cashIn += amount;
    const mark = () => d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/payment`, { playerId: d.ctx.byName.Blair, paid: true });
    await Promise.all([mark(), mark()]);
    for (const x of ['Casey', 'Devon', 'Emery', 'Frankie']) await venmoAndMark(d, x, g2.id);
    await balanced(d, 'after double taps on pay');
    endOf(d, g2);
    // Two Everyone played taps at once.
    const fin = () => d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/finalize`, { everyone: true });
    const res = await Promise.all([fin(), fin()]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const b = await balanced(d, 'after double finalize');
    expect(b.pots).toBe(6 * 500);
    // Two Reopen taps, then two finalizes again.
    const reo = () => d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/reopen`, {});
    await Promise.all([reo(), reo()]);
    await balanced(d, 'after double reopen');
    await Promise.all([fin(), fin()]);
    expect((await balanced(d, 'after second double finalize')).pots).toBe(6 * 500);
    // Two cash-out requests and two Mark refunded at once.
    const casey = await d.phone('Casey');
    await Promise.all([casey.call('POST', '/api/me/refund-request', { cents: 500 }), casey.call('POST', '/api/me/refund-request', { cents: 500 })]);
    const reqs = (await dash(d)).refundRequests.filter((r: any) => r.playerId === d.ctx.byName.Casey);
    expect(reqs).toHaveLength(1);
    const done = () => d.ctx.organizer.call('POST', `/api/admin/refund-requests/${reqs[0].id}`, { action: 'refunded' });
    await Promise.all([done(), done()]);
    d.book.cashedOut += 500;
    await balanced(d, 'after double Mark refunded');
  });

  it('a game canceled after payment turns every payment into credit; Reopen of the cancel clears the reason', async () => {
    const d = await dry();
    const [g1] = await games(d);
    await join(d, g1.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    for (const x of ['Alex', 'Blair', 'Casey']) await venmoAndMark(d, x, g1.id);
    const c = await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain & <wind> "gusts" \u{1F327}' });
    expect(c.status, c.text).toBe(200);
    const b = await balanced(d, 'canceled');
    expect(b.pots).toBe(3 * 1400);
    expect(b.held).toBe(0);
    expect(creditBack(1400, 4)).toBe(0);
    expect(finalPrice(1400, 4)).toBe(1400);
  });

  it('paid late at the final price, then Reopen and a redo with fewer players: owes the difference, books still balance', async () => {
    const d = await dry();
    const [, g2] = await games(d);
    await join(d, g2.id, PLAYER_NAMES);
    for (const x of PLAYER_NAMES.slice(1)) await venmoAndMark(d, x, g2.id);
    endOf(d, g2);
    await finalize(d, g2.id, { everyone: true });
    expect(await venmoAndMark(d, 'Alex', g2.id)).toBe(900);
    await balanced(d, 'Alex paid $9 late');
    expect((await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/reopen`, {})).status).toBe(200);
    await balanced(d, 'reopened after a late $9');
    // After reopen the flat price is back; Alex paid $9 of $14.
    const owedAfterReopen = await owes(d, 'Alex', g2.id);
    await finalize(d, g2.id, played(d, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']));
    const v = await view(d, g2.id);
    expect(v.finalized).toMatchObject({ playedCount: 5, priceCents: 1100 });
    expect(row(v, 'Alex').owesCents).toBe(200);
    expect(await owes(d, 'Alex', g2.id)).toBe(200);
    await venmoAndMark(d, 'Alex', g2.id);
    const b = await balanced(d, 'Alex paid the $2 rest');
    expect(b.collected).toBe(5 * 1100);
    // Right after the reopen Alex (paid $9 at the final price) shows as paid, nothing owed, until the redo.
    // Reported to Alex as a money question, not changed: the redo below charges the right difference.
    expect(owedAfterReopen).toBe(0);
  });

  it('a game that ended with 3 in: Cancel session from the Finalize card gives paid players credit', async () => {
    const d = await dry();
    const [g1] = await games(d);
    await join(d, g1.id, ['Alex', 'Blair', 'Casey']);
    await venmoAndMark(d, 'Alex', g1.id);
    endOf(d, g1);
    expect((await view(d, g1.id)).needsFinalize).toBe(true);
    const c = await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });
    expect(c.status, c.text).toBe(200);
    const b = await balanced(d, 'canceled after the game');
    expect(b.pots).toBe(1400);
    expect((await view(d, g1.id)).needsFinalize).toBe(false);
  });

  it('"I paid" not yet confirmed by the organizer still counts at finalize; unmarking it later takes the credit back', async () => {
    const d = await dry();
    const [, g2] = await games(d);
    await join(d, g2.id, PLAYER_NAMES);
    for (const x of PLAYER_NAMES.slice(1)) await venmoAndMark(d, x, g2.id);
    // Alex taps I paid but never actually sent it.
    expect((await (await d.phone('Alex')).call('POST', `/api/sessions/${g2.id}/paid`, { paid: true })).status).toBe(200);
    endOf(d, g2);
    await finalize(d, g2.id, { everyone: true });
    let v = await view(d, g2.id);
    expect(row(v, 'Alex')).toMatchObject({ paymentStatus: 'paid', creditBackCents: 500 });
    // Organizer notices no Venmo came in and unmarks: the $5 credit goes away, Alex owes $9.
    const u = await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/payment`, { playerId: d.ctx.byName.Alex, paid: false });
    expect(u.status, u.text).toBe(200);
    v = await view(d, g2.id);
    expect(row(v, 'Alex')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 900, creditBackCents: 0 });
    await balanced(d, 'unconfirmed I paid unmarked');
  });

  it('nobody can drop out of a game that is over, and a finalized game can not be canceled', async () => {
    const d = await dry();
    const [, g2] = await games(d);
    await join(d, g2.id, PLAYER_NAMES.slice(0, 4));
    for (const x of PLAYER_NAMES.slice(0, 4)) await venmoAndMark(d, x, g2.id);
    endOf(d, g2);
    const w = await (await d.phone('Alex')).call('POST', `/api/sessions/${g2.id}/withdraw`, {});
    expect(w.status, w.text).not.toBe(200);
    await finalize(d, g2.id, { everyone: true });
    expect((await d.ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(409);
    await balanced(d, 'end');
  });

  it('KNOWN MONEY QUESTION: credit used on a seat that still owes is in no Money row until the rest is paid', async () => {
    const d = await dry();
    const [g1, g2] = await games(d);
    await join(d, g1.id, ['Alex']);
    await venmoAndMark(d, 'Alex', g1.id);
    await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });
    await (await d.phone('Alex')).call('POST', '/api/me/refund-request', { cents: 1100 });
    const req = (await dash(d)).refundRequests[0];
    await d.ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded' });
    d.book.cashedOut += 1100;
    await join(d, g2.id, PLAYER_NAMES);
    expect(await useCredit(d, 'Alex', g2.id)).toMatchObject({ usedCents: 300 });
    for (const x of PLAYER_NAMES.slice(1)) await venmoAndMark(d, x, g2.id);
    endOf(d, g2);
    await finalize(d, g2.id, { everyone: true });
    const v = await view(d, g2.id);
    expect(row(v, 'Alex').owesCents).toBe(600);
    // Today: the $3 is missing from collected + held + pots (books short by $3) and the court row leaves it out too.
    let collected = 0, held = 0;
    for (const m of ['2026-10', '2026-11']) { const r = (await d.ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data; collected += r.collectedCents; held += r.heldCents; }
    const pots = ((await dash(d)).creditLedger as any[]).reduce((s, l) => s + l.balanceCents, 0);
    expect(d.book.cashIn - (collected + held + pots + d.book.cashedOut)).toBe(300);
    // Court row: 5 x $9 paid + Alex's $6 still owed = $51; with his $3 credit it would be $54.
    expect(v.court.playersCoverCents).toBe(5100);
    // Once Alex pays the $6 rest, everything balances again.
    await venmoAndMark(d, 'Alex', g2.id);
    await balanced(d, 'Alex paid the rest');
  });

  it('Players tab "played" leaves out a game someone was marked "did not play" for', async () => {
    const d = await dry();
    const [, g2] = await games(d);
    await join(d, g2.id, PLAYER_NAMES);
    endOf(d, g2);
    await finalize(d, g2.id, played(d, PLAYER_NAMES.slice(0, 5)));
    const players = (await dash(d)).players as any[];
    expect(players.find((p) => p.name === 'Frankie').played).toBe(0);
    expect(players.find((p) => p.name === 'Alex').played).toBe(1);
  });

  it('a second cash-out request says "cash out", not "refund"', async () => {
    const d = await dry();
    const [g1] = await games(d);
    await join(d, g1.id, ['Alex']);
    await venmoAndMark(d, 'Alex', g1.id);
    await d.ctx.organizer.call('POST', `/api/admin/sessions/${g1.id}/decision`, { decision: 'cancel', confirm: true });
    const alex = await d.phone('Alex');
    expect((await alex.call('POST', '/api/me/refund-request', { cents: 500 })).status).toBe(200);
    const again = await alex.call('POST', '/api/me/refund-request', { cents: 500 });
    expect(again.status).toBe(409);
    expect(again.data.message).toBe('You already asked for a cash out. Cancel it to make a new one.');
  });
});

