import { describe, expect, it } from 'vitest';
import { venmoNote, venmoPayUrl } from '../shared/money';
import { PIN, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

async function on(ctx: Ctx, date: string) {
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) expect((await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {})).status).toBe(200);
}
async function view(ctx: Ctx, name: string) {
  return (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
}

describe('payment waits for game day', () => {
  it('nothing to pay when signing up or the day before; the card starts at 8:00 AM on game day', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27'); // Tue 8:00 PM
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await view(ctx, 'Alex')).payDue).toEqual([]);
    ctx.app.now = Date.parse('2026-10-27T11:59:00.000Z'); // 7:59 AM Eastern
    expect((await view(ctx, 'Alex')).payDue).toEqual([]);
    ctx.app.now = Date.parse('2026-10-27T12:00:00.000Z'); // 8:00 AM Eastern
    const alex = await view(ctx, 'Alex');
    expect(alex.payDue).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 1400, discount: false, creditCents: 0, reminder: false })]);
    // People not playing that day see no card.
    expect((await view(ctx, 'Emery')).payDue).toEqual([]);
  });

  it('stays until the organizer marks it paid; opening Venmo changes nothing', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-10-28T13:00:00.000Z'); // next morning
    expect((await view(ctx, 'Devon')).payDue).toHaveLength(1);
    ctx.app.now = Date.parse('2026-10-29T03:00:00.000Z'); // more than 24 hours after it ended
    expect((await view(ctx, 'Devon')).payDue[0].reminder).toBe(true);
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Devon, paid: true });
    expect((await view(ctx, 'Devon')).payDue).toEqual([]);
  });

  it('two unpaid sessions combine into one total with one note listing both dates', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    const thu = await on(ctx, '2026-10-29');
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-10-29T12:30:00.000Z'); // Thu 8:30 AM
    const due = (await view(ctx, 'Devon')).payDue;
    expect(due.map((o: any) => o.sessionId)).toEqual([tue.id, thu.id]);
    const total = due.reduce((n: number, o: any) => n + o.amountCents, 0);
    expect(total).toBe(2800);
    const note = venmoNote(
      due.map((o: any) => o.startsAt),
      TZ,
      'Devon',
    );
    expect(note).toBe('Pickleball Tue Oct 27, Thu Oct 29 - Devon');
    expect(venmoPayUrl('https://venmo.com/u/club', total, note).url).toBe(
      'https://venmo.com/club?txn=pay&amount=28.00&note=Pickleball%20Tue%20Oct%2027%2C%20Thu%20Oct%2029%20-%20Devon',
    );
  });

  it('uses the right amount: $9 for the 5th and 6th, and the amount after a credit', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    await join(ctx, tue.id, PLAYER_NAMES);
    ctx.app.now = Date.parse('2026-10-27T12:00:00.000Z');
    expect((await view(ctx, 'Emery')).payDue[0]).toMatchObject({ amountCents: 900, discount: true });
    expect((await view(ctx, 'Alex')).payDue[0]).toMatchObject({ amountCents: 1400, discount: false });
    // The first four earned a $5 credit; it comes off their next session.
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
    for (const n of PLAYER_NAMES) await ctx.organizer.call('POST', `/api/admin/sessions/${tue.id}/payment`, { playerId: ctx.byName[n], paid: true });
    const thu = await on(ctx, '2026-10-29');
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-10-29T12:00:00.000Z');
    expect((await view(ctx, 'Alex')).payDue[0]).toMatchObject({ sessionId: thu.id, amountCents: 900, creditCents: 500 });
  });

  it('the first four hear about the credit once 6 are confirmed', async () => {
    const ctx = await setupGroup();
    const tue = await on(ctx, '2026-10-27');
    await join(ctx, tue.id, PLAYER_NAMES);
    const row = (name: string) => view(ctx, name).then((g) => g.sessions.find((x: any) => x.id === tue.id).mine);
    expect((await row('Alex')).creditComing).toBe(true);
    expect((await row('Frankie')).creditComing).toBe(false);
  });
});
