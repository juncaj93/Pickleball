import { describe, expect, it } from 'vitest';
import { creditHintText, creditOweText, creditUsedMessage } from '../shared/credit';
import { venmoNote, venmoPayUrl } from '../shared/money';
import { balanceOf, heldCents } from '../src/pages/admin/todo';
import { HOUR, playerPhone, setupGroup } from './harness';

// The credit cases the organizer asked to see, on fake data: what the player reads
// (exact words and amounts), and what Money and Players show.

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
const view = async (ctx: Ctx, n: string) => (await (await playerPhone(ctx, n)).call('GET', '/api/group')).data;
const mine = async (ctx: Ctx, n: string, sid: string) => (await view(ctx, n)).sessions.find((s: any) => s.id === sid).mine;
const use = async (ctx: Ctx, n: string, sid: string) => (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/use-credit`, {});
const money = async (ctx: Ctx, month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
const seat = (d: any, sid: string, n: string) => d.sessions.find((s: any) => s.id === sid).roster.find((r: any) => r.name === n);
const pot = async (ctx: Ctx, n: string) => (await dash(ctx)).creditLedger.find((p: any) => p.playerId === ctx.byName[n])?.balanceCents ?? 0;
/** Put `cents` of credit in a player's pot, as if a canceled game's payment was kept (a real entry, in October). */
async function givePot(ctx: Ctx, name: string, cents: number) {
  const old = await on(ctx, '2026-10-29');
  ctx.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at)
     SELECT 'pot-${name}-${cents}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${old.id}', '2026-10-26T13:00:00.000Z' FROM groups`,
  );
}
/** Everything the Players tab and the Money tab say, checked against each other. */
async function agree(ctx: Ctx) {
  const d = await dash(ctx);
  const potTotal = d.creditLedger.reduce((n: number, p: any) => n + p.balanceCents, 0);
  const months = [await money(ctx, '2026-10'), await money(ctx, '2026-11')];
  // Credit kept and not yet used, by month, adds up to what the Players tab shows (everyone's pot).
  expect(months.reduce((n, m) => n + m.keptCreditCents, 0)).toBe(potTotal);
  // A player's Players-tab credit is their pot (no $5 credits in these cases).
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
    expect(creditHintText(before.useCreditCents, (await view(ctx, 'Casey')).potCents, before.oweCents)).toBe('Uses your $14 credit');
    const res = (await use(ctx, 'Casey', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Paid with credit. No credit left.');
    expect(await mine(ctx, 'Casey', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0, useCreditCents: 0 });
    expect((await view(ctx, 'Casey')).creditBalanceCents).toBe(0);
    expect(await pot(ctx, 'Casey')).toBe(0);
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, potCreditCents: 1400 });
  });
});

describe('2. credit $14, game owes $9 (6 playing, he is 5th or 6th)', () => {
  it('Use credit takes $9 and leaves $5', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    const before = await mine(ctx, 'Emery', g.id);
    expect(before).toMatchObject({ shareCents: 900, oweCents: 900, discount: true, useCreditCents: 900 });
    expect(creditHintText(900, 1400, 900)).toBe('Uses $9 of your $14 credit');
    const res = (await use(ctx, 'Emery', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Used $9 of your $14 credit. $5 left.');
    expect(await mine(ctx, 'Emery', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect((await view(ctx, 'Emery')).creditBalanceCents).toBe(500);
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Emery')).toMatchObject({ paymentAmountCents: 900, potCreditCents: 900 });
    expect(await pot(ctx, 'Emery')).toBe(500);
  });
});

describe('3. credit $14, among the first four of a 6-player game (owes $14, earns the $5 credit)', () => {
  it('ends with $5 credit, and the $5 wording stays right', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Alex', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    const before = await mine(ctx, 'Alex', g.id);
    expect(before).toMatchObject({ shareCents: 1400, oweCents: 1400, discount: false, creditComing: true });
    expect((await view(ctx, 'Alex')).group.creditCents).toBe(500); // "6 are playing. You'll get a $5 credit toward your next session."
    const res = (await use(ctx, 'Alex', g.id)).data;
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Paid with credit. No credit left.');
    expect(await mine(ctx, 'Alex', g.id)).toMatchObject({ paymentStatus: 'paid', creditComing: true });
    expect((await view(ctx, 'Alex')).creditBalanceCents).toBe(0);
    // The game is played with 6: the first four each earn the $5 credit. His credit is now exactly $5.
    ctx.app.now = Date.parse(g.endsAt) + HOUR;
    const after = await view(ctx, 'Alex');
    expect(after.creditBalanceCents).toBe(500);
    const d = await dash(ctx);
    expect(d.credits.find((c: any) => c.playerId === ctx.byName.Alex).balanceCents).toBe(500);
    expect(await pot(ctx, 'Alex')).toBe(0);
    expect(balanceOf(d, ctx.byName.Alex).creditCents).toBe(500);
    // Money: his $14 (paid with credit) is collected for the game, and $5 credit is owed.
    const m = await money(ctx, '2026-11');
    expect(m.collectedCents).toBe(1400); // only Alex paid
    expect(m.creditsOwedCents).toBe(4 * 500);
    expect(m.keptCreditCents).toBe(0);
  });
});

describe('4. credit $5, game owes $14', () => {
  it('Use credit applies $5, $9 is left to pay, and Venmo is for exactly $9 with the right note', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 500);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const before = await mine(ctx, 'Casey', g.id);
    expect(creditHintText(before.useCreditCents, (await view(ctx, 'Casey')).potCents, before.oweCents)).toBe('Uses your $5 credit. $9 left to pay');
    const res = (await use(ctx, 'Casey', g.id)).data;
    expect(res).toMatchObject({ usedCents: 500, paid: false });
    expect(creditUsedMessage(res.usedCents, res.potBeforeCents, res.owedBeforeCents)).toBe('Used $5 credit. $9 left to pay.');
    const after = await mine(ctx, 'Casey', g.id);
    expect(after).toMatchObject({ paymentStatus: 'unpaid', oweCents: 900, creditCents: 500, potUsedCents: 500, useCreditCents: 0 });
    expect(creditOweText(after.oweCents, after.creditCents, after.potUsedCents)).toBe('$9 left to pay. $5 credit used.');
    const v = await view(ctx, 'Casey');
    expect(v.creditBalanceCents).toBe(0);
    const pay = venmoPayUrl(v.group.venmoUrl, after.oweCents, venmoNote(g.startsAt, TZ, 'Casey'));
    expect(pay.url).toBe('https://venmo.com/?txn=pay&recipients=organizer&amount=9&note=Pickleball%20Tue%20Nov%203%20-%20Casey');
    // Organizer: still owes $9 (not paid), $5 credit used; Players shows $0 credit.
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ paymentStatus: 'unpaid', shareCents: 1400, creditCents: 500 });
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
    expect(await mine(ctx, 'Casey', b.id)).toMatchObject({ paymentStatus: 'unpaid', oweCents: 1400, useCreditCents: 0, creditCents: 0, potUsedCents: 0 });
    expect((await view(ctx, 'Casey')).potCents).toBe(0);
    expect((await use(ctx, 'Casey', b.id)).status).toBe(409); // and nothing to spend
    await agree(ctx);
  });
});

describe('6. used credit on a 6-player game at $9, then the 6th drops so the price is $14', () => {
  it('he sees $5 more to pay (not Paid), and Venmo is for $5', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 900);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    await use(ctx, 'Emery', g.id); // $9 of $9
    expect(await mine(ctx, 'Emery', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true });
    expect((await out(ctx, g.id, 'Frankie')).status).toBe(200); // 6th leaves: 5 go, price is $14 for everyone
    const after = await mine(ctx, 'Emery', g.id);
    expect(after).toMatchObject({ paymentStatus: 'unpaid', paidWithCredit: false, shareCents: 1400, oweCents: 500, creditCents: 900, potUsedCents: 900 });
    expect(creditOweText(after.oweCents, after.creditCents, after.potUsedCents)).toBe('$5 left to pay. $9 credit used.');
    const v = await view(ctx, 'Emery');
    expect(v.owed.find((o: any) => o.sessionId === g.id)).toMatchObject({ amountCents: 500 });
    expect(venmoPayUrl(v.group.venmoUrl, after.oweCents, venmoNote(g.startsAt, TZ, 'Emery')).url).toContain('amount=5&note=Pickleball%20Tue%20Nov%203%20-%20Emery');
    // Organizer: unpaid, owes $5 after the $9 credit; nothing vanished.
    const { d } = await agree(ctx);
    expect(seat(d, g.id, 'Emery')).toMatchObject({ paymentStatus: 'unpaid', shareCents: 1400, creditCents: 900, potCreditCents: 900 });
    // He pays the $5: the game is paid in full (the credit part counts as collected too).
    const phone = await playerPhone(ctx, 'Emery');
    expect((await phone.call('POST', `/api/sessions/${g.id}/paid`, { paid: true })).status).toBe(200);
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Emery, paid: true });
    expect(seat(await dash(ctx), g.id, 'Emery')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
  });
  it('if the 6th comes back, he is paid again with nothing more to pay', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Emery', 900);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, SIX);
    await use(ctx, 'Emery', g.id);
    await out(ctx, g.id, 'Frankie');
    expect((await mine(ctx, 'Emery', g.id)).oweCents).toBe(500);
    await join(ctx, g.id, ['Frankie']);
    expect(await mine(ctx, 'Emery', g.id)).toMatchObject({ paymentStatus: 'paid', paidWithCredit: true, oweCents: 0 });
  });
});

describe('7. drops out of a game he paid for with credit', () => {
  it('the credit comes back in full and Players and Money agree', async () => {
    const ctx = await setupGroup();
    await givePot(ctx, 'Casey', 1400);
    const g = await on(ctx, '2026-11-03');
    await join(ctx, g.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await use(ctx, 'Casey', g.id);
    expect((await view(ctx, 'Casey')).creditBalanceCents).toBe(0);
    expect((await out(ctx, g.id, 'Casey')).status).toBe(200);
    expect((await view(ctx, 'Casey')).creditBalanceCents).toBe(1400);
    expect(await pot(ctx, 'Casey')).toBe(1400);
    const { d, months } = await agree(ctx);
    expect(seat(d, g.id, 'Casey')).toMatchObject({ status: 'withdrawn', paymentStatus: 'not_applicable', paymentAmountCents: null });
    expect(months[1].heldCents).toBe(0);
    expect(months[0].keptCreditCents).toBe(1400);
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
      creditOweText(900, 500, 500),
      creditOweText(900, 500, 0),
    ];
    expect(lines).toEqual([
      'Paid with credit. No credit left.',
      'Used $9 of your $14 credit. $5 left.',
      'Used $5 credit. $9 left to pay.',
      'Uses your $14 credit',
      'Uses $9 of your $14 credit',
      'Uses your $5 credit. $9 left to pay',
      '$9 left to pay. $5 credit used.',
      '$9, after your $5 credit',
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
