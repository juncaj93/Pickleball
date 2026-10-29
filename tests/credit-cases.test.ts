import { describe, expect, it } from 'vitest';
import { creditHintText, creditOweText, creditUsedMessage } from '../shared/credit';
import { venmoNote, venmoPayUrl } from '../shared/money';
import { balanceOf, heldCents } from '../src/pages/admin/todo';
import { HOUR, playerPhone, setupGroup } from './harness';

// The credit cases the organizer asked to see, on fake data: what the player reads
// (exact words and amounts), and what Money and Players show. Everyone owes the
// flat $14 until the game is finalized; the final price (4 x $14 / players who
// played) is what changes a seat's price, and the extra comes back as credit.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const SIX = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
const join = async (ctx: Ctx, id: string, names: string[]) => {
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
};
const out = async (ctx: Ctx, id: string, n: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/withdraw`, {});
const pay = async (ctx: Ctx, id: string, names: string[]) => {
  for (const n of names) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
};
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mine = async (ctx: Ctx, n: string, sid: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === sid).mine;
const use = async (ctx: Ctx, n: string, sid: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/use-credit`, {});
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const pot = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n])?.balanceCents ?? 0;
/** The game is over and the organizer finalizes it: everyone played, or only these. */
async function finalize(ctx: Ctx, s: any, played?: string[]) {
  ctx.app.now = Date.parse(s.endsAt) + HOUR;
  const body = played ? { played: played.map((n) => ctx.byName[n]) } : { everyone: true };
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, body);
  expect(res.status, res.text).toBe(200);
  return res.data;
}
/** Put `cents` of credit in a player's pot, as if a canceled game's payment came back (a real entry, in October). */
async function givePot(ctx: Ctx, name: string, cents: number) {
  const old = await on(ctx, '2026-10-29');
  ctx.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
/** Everything the Players tab and the Money tab say, checked against each other. */
async function agree(ctx: Ctx) {
  const d = await dash(ctx);
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  const months = [await money(ctx, '2026-10'), await money(ctx, '2026-11')];
  // Credit still owed, by the month of the game it came from, adds up to what the Players tab shows (everyone's pot).
  expect(months.reduce((n, m) => n + m.creditsOwedCents, 0)).toBe(potTotal);
  // A player's Players-tab credit is their pot.
  for (const p of d.players) expect(balanceOf(d, p.id).creditCents).toBe(d.creditLedger.find((l: any) => l.playerId === p.id)?.balanceCents ?? 0);
  // Held and collected per game add up to the month.
  for (const m of months) expect(m.sessions.reduce((n: number, s: any) => n + s.collectedCents, 0)).toBe(m.collectedCents);
  expect(months.reduce((n, m) => n + m.heldCents, 0)).toBe(heldCents(d));
  return { d, potTotal, months };
}

describe('1. credit $14, game owes $14', () => {
  it('Use credit gives Paid with credit and the credit is $0', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const before = await mine(ctx, 'Casey', g.id);
    expect(before).toMatchObject({ oweCents: 1400, useCreditCents: 1400 });
    expect(creditHintText(before.useCreditCents, (await view(ctx, 'Casey')).credit.usableCents, before.oweCents)).toBe('Uses your $14 credit');
    const res = (await use(ctx, 'Casey', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Paid with credit. No credit left.');
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0, useCreditCents: 0 });
    expect((await view(ctx, 'Casey')).credit.balanceCents).toBe(0);
    expect(await pot(ctx, 'Casey')).toBe(0);
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, creditCents: 1400 });
  });
});

describe('2. credit $14, 6 in: owes the flat $14, and $5 comes back once 6 played at $9', () => {
  it('Use credit takes $14; after finalizing the credit is $5 again', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    // No special price for the 5th or 6th: $14 like everyone.
    const before = await mine(ctx, 'Emery', g.id);
    expect(before).toMatchObject({ shareCents: 1400, oweCents: 1400, useCreditCents: 1400 });
    expect(creditHintText(1400, 1400, 1400)).toBe('Uses your $14 credit');
    const res = (await use(ctx, 'Emery', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Paid with credit. No credit left.');
    expect(await mine(ctx, 'Emery', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect((await view(ctx, 'Emery')).credit.balanceCents).toBe(0);
    await pay(ctx, g.id, SIX.filter((n) => n !== 'Emery'));
    // 6 played: $9 each, so $5 of his $14 is credit again.
    await finalize(ctx, g);
    // The game is over, so it is off his list: nothing owed, and the $5 is in his credit with its history line.
    const v = await view(ctx, 'Emery');
    expect(v.owed).toEqual([]);
    expect(v.credit.balanceCents).toBe(500);
    expect(v.credit.history[0]).toMatchObject({ kind: 'kept', cents: 500, reason: 'finalized', playedCount: 6, sessionId: g.id });
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Emery')).toMatchObject({ paymentAmountCents: 1400, creditCents: 1400, creditBackCents: 500, creditBackReason: 'finalized' });
    expect(await pot(ctx, 'Emery')).toBe(500);
    expect((await money(ctx, '2026-11')).collectedCents).toBe(6 * 900);
  });
});

describe('3. credit $14, 5 in: paid with credit, finalized at $11', () => {
  it('ends with $3 credit, and Money counts his $14 as $11 collected and $3 owed', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Alex', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX.slice(0, 5));
    const before = await mine(ctx, 'Alex', g.id);
    expect(before).toMatchObject({ shareCents: 1400, oweCents: 1400, creditBackCents: 0 });
    const res = (await use(ctx, 'Alex', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Paid with credit. No credit left.');
    expect(await mine(ctx, 'Alex', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect((await view(ctx, 'Alex')).credit.balanceCents).toBe(0);
    // The game is played with 5: $11 each. His credit is now exactly $3; the others (unpaid) owe $11.
    await finalize(ctx, g);
    const after = await view(ctx, 'Alex');
    expect(after.credit.balanceCents).toBe(300);
    expect(after.credit.history[0]).toMatchObject({ kind: 'kept', cents: 300, reason: 'finalized', playedCount: 5 });
    const d = await dash(ctx);
    expect(seat(d, g.id, 'Alex')).toMatchObject({ paymentAmountCents: 1400, creditBackCents: 300, owesCents: 0 });
    expect(seat(d, g.id, 'Blair')).toMatchObject({ paymentStatus: 'unpaid', owesCents: 1100 });
    expect(await pot(ctx, 'Alex')).toBe(300);
    expect(balanceOf(d, ctx.byName.Alex).creditCents).toBe(300);
    // Money: his $14 (paid with credit) is $11 collected for the game, and $3 credit is owed.
    const m = await money(ctx, '2026-11');
    expect(m.collectedCents).toBe(1100); // only Alex paid
    expect(m.creditsOwedCents).toBe(300);
    await agree(ctx);
  });
});

describe('4. credit $5, game owes $14', () => {
  it('Use credit applies $5, $9 is left to pay, and Venmo is for exactly $9 with the right note', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 500);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const before = await mine(ctx, 'Casey', g.id);
    expect(creditHintText(before.useCreditCents, (await view(ctx, 'Casey')).credit.usableCents, before.oweCents)).toBe('Uses your $5 credit. $9 left to pay');
    const res = (await use(ctx, 'Casey', g.id)).data;
    expect(res).toMatchObject({ usedCents: 500, paid: false });
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Used $5 credit. $9 left to pay.');
    const after = await mine(ctx, 'Casey', g.id);
    expect(after).toMatchObject({ paymentStatus: 'unpaid', oweCents: 900, creditCents: 500, useCreditCents: 0 });
    expect(creditOweText(after.oweCents, after.creditCents)).toBe('$9 left to pay. $5 credit used.');
    const v = await view(ctx, 'Casey');
    expect(v.credit.balanceCents).toBe(0);
    const pay = venmoPayUrl(v.group.venmoUrl, after.oweCents, venmoNote(g.startsAt, TZ, 'Casey'));
    expect(pay.url).toBe('https://venmo.com/?txn=pay&recipients=organizer&amount=9&note=Pickleball%20Tue%20Nov%203%20-%20Casey');
    // Organizer: still owes $9 (not paid), $5 credit used; Players shows $0 credit.
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'unpaid', shareCents: 1400, creditCents: 500, owesCents: 900 });
    expect(balanceOf(d, ctx.byName.Casey)).toEqual({ owedCents: 0, creditCents: 0 }); // game is days away; not "owed" yet
  });
});

describe('5. credit $14, two games owed at $14 each', () => {
  it('using it on one leaves the other owed with no credit button', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 1400);
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    await join(ctx, a.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, b.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect(await mine(ctx, 'Casey', a.id)).toMatchObject({ useCreditCents: 1400 });
    expect(await mine(ctx, 'Casey', b.id)).toMatchObject({ useCreditCents: 1400 });
    await use(ctx, 'Casey', a.id);
    expect(await mine(ctx, 'Casey', a.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect(await mine(ctx, 'Casey', b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 0, creditCents: 0 });
    expect((await view(ctx, 'Casey')).credit.usableCents).toBe(0);
    expect((await use(ctx, 'Casey', b.id)).status).toBe(409); // and nothing to spend
    await agree(ctx);
  });
});

describe('6. used $9 credit on a $14 seat, then the game is finalized', () => {
  it('5 played ($11): he sees $2 more to pay (not Paid), and Venmo is for $2', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 900);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    expect((await use(ctx, 'Emery', g.id)).data).toMatchObject({ usedCents: 900, paid: false }); // $9 of $14
    expect(await mine(ctx, 'Emery', g.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 500, creditCents: 900 });
    await pay(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await finalize(ctx, g, SIX.filter((n) => n !== 'Frankie')); // Frankie did not play: 5 at $11
    // The game is over: it lives in the "owed" card now, for $2 after the $9 credit.
    const v = await view(ctx, 'Emery');
    const after = v.owed.find((o: any) => o.sessionId === g.id);
    expect(after).toMatchObject({ amountCents: 200, creditCents: 900, finalized: true });
    expect(v.payDue).toHaveLength(1);
    expect(creditOweText(after.amountCents, after.creditCents)).toBe('$2 left to pay. $9 credit used.');
    expect(venmoPayUrl(v.group.venmoUrl, after.amountCents, venmoNote(g.startsAt, TZ, 'Emery')).url).toContain('amount=2&note=Pickleball%20Tue%20Nov%203%20-%20Emery');
    // Organizer: unpaid, owes $2 after the $9 credit; nothing vanished.
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Emery')).toMatchObject({ paymentStatus: 'unpaid', shareCents: 1100, owesCents: 200, creditCents: 900 });
    // He pays the $2: the game is paid in full at $11 (the credit part counts as collected too).
    const phone = await playerPhone(ctx, 'Emery');
    expect((await phone.call('POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    await pay(ctx, g.id, ['Emery']);
    expect(seat(await dash(ctx), g.id, 'Emery')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1100, creditBackCents: 0 });
    expect((await money(ctx, '2026-11')).collectedCents).toBe(5 * 1100);
  });
  it('6 played ($9): the $9 credit covers it, he is paid with nothing more to pay and nothing back', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 900);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    await use(ctx, 'Emery', g.id);
    expect((await mine(ctx, 'Emery', g.id)).oweCents).toBe(500);
    await pay(ctx, g.id, SIX.filter((n) => n !== 'Emery'));
    await finalize(ctx, g);
    // Nothing owed and nothing back: the $9 credit was exactly the price.
    const v = await view(ctx, 'Emery');
    expect(v.owed).toEqual([]);
    expect(v.credit).toMatchObject({ balanceCents: 0, usableCents: 0 });
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Emery')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 900, creditCents: 900, creditBackCents: 0, owesCents: 0 });
    expect(await pot(ctx, 'Emery')).toBe(0);
    expect((await money(ctx, '2026-11')).collectedCents).toBe(6 * 900);
  });
});

describe('7. drops out of a game he paid for with credit', () => {
  it('the credit comes back in full and Players and Money agree', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await use(ctx, 'Casey', g.id);
    expect((await view(ctx, 'Casey')).credit.balanceCents).toBe(0);
    expect((await out(ctx, g.id, 'Casey')).data).toMatchObject({ result: 'withdrawn', creditBackCents: 0 }); // nothing new: the credit just comes back
    expect((await view(ctx, 'Casey')).credit.balanceCents).toBe(1400);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    const { d, months } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ status: 'withdrawn', paymentStatus: 'not_applicable', paymentAmountCents: null, creditBackCents: 0 });
    expect(months[1].heldCents).toBe(0);
    expect(months[0].creditsOwedCents).toBe(1400);
    expect(balanceOf(d, ctx.byName.Casey).creditCents).toBe(1400);
  });
});

describe('wording', () => {
  it('never says insufficient funds, and every line is short and exact', () => {
    const lines = [
      creditUsedMessage(1400, 1400, 1400),
      creditUsedMessage(900, 1400, 900),
      creditUsedMessage(500, 500, 1400),
      creditHintText(1400, 1400, 1400),
      creditHintText(900, 1400, 900),
      creditHintText(500, 500, 1400),
      creditOweText(900, 500),
      creditOweText(200, 900),
    ];
    expect(lines).toEqual([
      'Paid with credit. No credit left.',
      'Used $9 of your $14 credit. $5 left.',
      'Used $5 credit. $9 left to pay.',
      'Uses your $14 credit',
      'Uses $9 of your $14 credit',
      'Uses your $5 credit. $9 left to pay',
      '$9 left to pay. $5 credit used.',
      '$2 left to pay. $9 credit used.',
    ]);
    for (const l of lines) expect(l).not.toMatch(/insufficient|funds|sent/i);
  });
});

describe('Undo under "Paid with credit"', () => {
  it('puts the full credit back and the game is owed again; no cash moves', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await use(ctx, 'Casey', g.id);
    expect(await pot(ctx, 'Casey')).toBe(0);
    const res = await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/undo-credit`, {});
    expect(res.data).toMatchObject({ ok: true, returnedCents: 1400 });
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ paymentStatus: 'unpaid', paidWithCredit: false, oweCents: 1400, useCreditCents: 1400 });
    expect(await pot(ctx, 'Casey')).toBe(1400);
    await agree(ctx);
  });
  it('is refused when nothing was paid with credit', async () => {
    const ctx = await setupGroup();
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const res = await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/undo-credit`, {});
    expect(res.status).toBe(409);
  });
  it('is refused when the player paid with "I paid" instead', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 500);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/paid`, { paid: true });
    const res = await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${g.id}/undo-credit`, {});
    expect(res.status).toBe(409);
  });
});
