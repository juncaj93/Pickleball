import { describe, expect, it } from 'vitest';
import { canceledMessage, movedMessage } from '../shared/messages';
import { venmoNote, venmoPayUrl } from '../shared/money';
import { buildTodo } from '../src/pages/admin/todo';
import { bottomLine } from '../server/money';
import { DAY, HOUR, PIN, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
/** The session starting on this Eastern date, like "2026-11-03". */
async function on(ctx: Ctx, date: string) {
  const d = await dash(ctx);
  const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
}
async function pay(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) {
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true });
    expect(res.status).toBe(200);
  }
}
async function money(ctx: Ctx, month: string) {
  const res = await ctx.organizer.call('GET', `/api/admin/money?month=${month}`);
  expect(res.status).toBe(200);
  return res.data;
}

describe('Venmo note', () => {
  it('is "Pickleball Tue Nov 3 - Ryan" and rides along with the amount', () => {
    expect(venmoNote('2026-11-04T01:00:00.000Z', TZ, 'Ryan')).toBe('Pickleball Tue Nov 3 - Ryan');
    const pay = venmoPayUrl('https://venmo.com/u/Alex-Smith', 1400, venmoNote('2026-11-04T01:00:00.000Z', TZ, 'Ryan'));
    expect(pay.prefilled).toBe(true);
    expect(pay.url).toBe('https://venmo.com/?txn=pay&recipients=Alex-Smith&amount=14&note=Pickleball%20Tue%20Nov%203%20-%20Ryan');
    // A link Venmo can't prefill opens as is; the page then shows the note with Copy.
    expect(venmoPayUrl('https://example.com/pay', 1400, 'x')).toEqual({ url: 'https://example.com/pay', appUrl: null, prefilled: false });
  });
});

const LONG_BEFORE = Date.parse('2026-10-26T16:00:00Z');

describe('texts when a session changes', () => {
  const s = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' };
  const moved = { startsAt: '2026-11-06T01:00:00.000Z', endsAt: '2026-11-06T03:00:00.000Z' };
  it('cancel: "Pickleball Tue Nov 3 is canceled." then the credit line, with an optional reason after the first sentence', () => {
    const credit = "If you paid, it's now your credit. You can request a cash out on the site.";
    expect(canceledMessage(s, TZ, LONG_BEFORE, 'pickleball.juncaj.net')).toBe(`Pickleball Tue Nov 3 is canceled. ${credit} pickleball.juncaj.net`);
    expect(canceledMessage(s, TZ, LONG_BEFORE, 'pickleball.juncaj.net', '  rain in the forecast ')).toBe(`Pickleball Tue Nov 3 is canceled. rain in the forecast. ${credit} pickleball.juncaj.net`);
    expect(canceledMessage(s, TZ, LONG_BEFORE, 'pickleball.juncaj.net', 'Court closed!')).toBe(`Pickleball Tue Nov 3 is canceled. Court closed! ${credit} pickleball.juncaj.net`);
  });
  it('reschedule: "Pickleball Tue Nov 3 is moved to Thu Nov 5, 8:00 PM. {link}"', () => {
    expect(movedMessage(moved, s.startsAt, TZ, LONG_BEFORE, 'pickleball.juncaj.net')).toBe('Pickleball Tue Nov 3 is moved to Thu Nov 5, 8:00 PM. pickleball.juncaj.net');
    expect(movedMessage(moved, s.startsAt, TZ, LONG_BEFORE, 'pickleball.juncaj.net', 'Court swap')).toBe('Pickleball Tue Nov 3 is moved to Thu Nov 5, 8:00 PM. Court swap. pickleball.juncaj.net');
  });
  it('never says a message was sent', () => {
    for (const m of [canceledMessage(s, TZ, LONG_BEFORE, 'L', 'x'), movedMessage(moved, s.startsAt, TZ, LONG_BEFORE, 'L', 'y')]) expect(m).not.toMatch(/\bsent\b/i);
  });
  it('players see Canceled or the new time', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    await ctx.organizer.call('PUT', `/api/admin/sessions/${a.id}/time`, { startsAt: '2026-11-04T00:30:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' });
    const b = await on(ctx, '2026-11-05');
    await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/decision`, { decision: 'cancel', confirm: true });
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === a.id).startsAt).toBe('2026-11-04T00:30:00.000Z');
    expect(g.sessions.find((x: any) => x.id === b.id).canceled).toBe(true);
  });
});

describe('credit back after a cancel', () => {
  it('everyone who paid has their money as credit, a refund request is a card, and Mark refunded or undo follow', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, ['Alex', 'Blair']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    let d = await dash(ctx);
    let x = d.sessions.find((y: any) => y.id === s.id);
    expect(x.roster.filter((r: any) => r.paymentStatus === 'paid').map((r: any) => [r.name, r.creditBackCents, r.creditBackReason, typeof r.refundedAt])).toEqual([
      ['Alex', 1400, 'canceled', 'string'],
      ['Blair', 1400, 'canceled', 'string'],
    ]);
    expect(x.roster.find((r: any) => r.name === 'Casey').creditBackCents).toBe(0); // never paid: nothing comes back
    expect(buildTodo(d).map((i) => i.kind)).not.toContain('refund_request'); // nothing to decide
    // Someone with no credit can't ask for a refund; players can't answer requests; a made-up request is not found.
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(409);
    expect((await (await playerPhone(ctx, 'Alex')).call('POST', '/api/admin/refund-requests/x', { action: 'refunded' })).status).toBe(401);
    expect((await ctx.organizer.call('POST', '/api/admin/refund-requests/00000000-0000-4000-8000-000000000000', { action: 'refunded' })).status).toBe(404);
    for (const n of ['Alex', 'Blair']) expect((await (await playerPhone(ctx, n)).call('POST', '/api/me/refund-request', { cents: 1400 })).status).toBe(200);
    d = await dash(ctx);
    expect(buildTodo(d).filter((i) => i.kind === 'refund_request')).toHaveLength(2);
    for (const r of d.refundRequests) expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${r.id}`, { action: 'refunded' })).status).toBe(200);
    d = await dash(ctx);
    x = d.sessions.find((y: any) => y.id === s.id);
    expect(buildTodo(d).map((i) => i.kind)).not.toContain('refund_request');
    expect(d.creditLedger.map((l: any) => l.balanceCents)).toEqual([0, 0]);
    // Undo puts Blair's credit back, and her request waits again.
    const blair = d.audit.find((a: any) => a.action === 'credit_refund_marked' && a.details.player === 'Blair');
    expect(blair).toBeDefined();
    const req = (await ctx.app.db.prepare("SELECT id FROM refund_requests WHERE player_id = ? AND status = 'refunded'").bind(ctx.byName.Blair).first<{ id: string }>())!;
    expect((await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'undo' })).data.changed).toBe(true);
    d = await dash(ctx);
    expect(buildTodo(d).filter((i) => i.kind === 'refund_request').map((i: any) => i.request.name)).toEqual(['Blair']);
    expect(d.creditLedger.find((l: any) => l.playerId === ctx.byName.Blair).balanceCents).toBe(1400);
  });
});

describe('Mark paid tonight', () => {
  it('on game day, that day\'s unpaid players get their own card at the top', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // Monday 10 PM, the night before: they show under "Who owes you" from the check-in on.
    ctx.app.now = Date.parse(s.startsAt) - 22 * HOUR;
    let items = buildTodo(await dash(ctx));
    expect(items.find((i) => i.kind === 'tonight')).toBeUndefined();
    expect(items.find((i) => i.kind === 'owed')).toBeDefined();
    // Game day morning.
    ctx.app.now = Date.parse(s.startsAt) - 10 * HOUR;
    items = buildTodo(await dash(ctx));
    expect(items[0].kind).toBe('tonight');
    expect((items[0] as any).rows.map((r: any) => r.name)).toEqual(['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect(buildTodo(await dash(ctx)).find((i) => i.kind === 'tonight')).toBeUndefined();
    // Players see it paid.
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(g.sessions.find((x: any) => x.id === s.id).mine.paymentStatus).toBe('paid');
  });
});

describe('monthly money', () => {
  it('counts only played sessions, uses the entered court cost or the typical one, and gives a bottom line', async () => {
    const ctx = await setupGroup();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    const c = await on(ctx, '2026-11-10');
    await join(ctx, a.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, b.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, c.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/booked`, { courtCostCents: 5000 });
    await ctx.organizer.call('POST', `/api/admin/sessions/${b.id}/booked`, {});
    await pay(ctx, a.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await pay(ctx, b.id, ['Alex', 'Blair']);
    await pay(ctx, c.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // C is canceled: not counted at all.
    await ctx.organizer.call('POST', `/api/admin/sessions/${c.id}/decision`, { decision: 'cancel', confirm: true });

    // Before the sessions happen, nothing is counted yet. C's four payments came back as credit.
    let m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ collectedCents: 0, courtCostCents: 0, netCents: 0, heldCents: 8400, creditsOwedCents: 5600, label: 'November 2026' });

    ctx.app.now = Date.parse('2026-11-30T17:00:00.000Z');
    // A month later the organizer signs in again. Nothing is finalized yet: still held, nothing collected.
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
    m = await money(ctx, '2026-11');
    expect(m).toMatchObject({ collectedCents: 0, courtCostCents: 0, heldCents: 8400 });
    expect(m.sessions.find((x: any) => x.id === a.id)).toMatchObject({ state: 'not_finalized', collectedCents: 0, playedCount: null });
    expect(m.bottomLine).toBe('Nothing played yet');
    // Finalize both: 4 played each, $14, nothing back.
    for (const s of [a, b]) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    m = await money(ctx, '2026-11');
    // A: 4 x $14 in, $50 court. B: 2 x $14 in, typical $48 court. C canceled: its $56 is credit owed, not taken off Left.
    expect(m.collectedCents).toBe(5600 + 2800);
    expect(m.courtCostCents).toBe(5000 + 4800);
    expect(m.creditsOwedCents).toBe(5600);
    expect(m.heldCents).toBe(0);
    expect(m.netCents).toBe(-1400);
    expect(m.bottomLine).toBe('You covered $14 of the court costs');
    expect(m).toMatchObject({ surplusCents: 0, coveredCents: 1400 });
    expect(m.sessions.find((x: any) => x.id === b.id)).toMatchObject({ state: 'played', typicalCost: true, courtCostCents: 4800, playedCount: 4, priceCents: 1400, collectedCents: 2800 });
    expect(m.sessions.find((x: any) => x.id === c.id)).toMatchObject({ state: 'canceled', collectedCents: 0, courtCostCents: 0 });
    // Sessions nobody played don't count either.
    expect(m.sessions.filter((x: any) => x.state === 'not_played').every((x: any) => x.courtCostCents === 0)).toBe(true);

    // A lower typical cost and the rest of B paying.
    const settings = (await dash(ctx)).group.settings;
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', settings: { ...settings, typicalCourtCostCents: 4000, monthlyMembershipCents: 3000 } });
    m = await money(ctx, '2026-11');
    expect(m.courtCostCents).toBe(9000);
    expect(m.bottomLine).toBe('You covered $6 of the court costs');
  });

  it('6 played at $9: collected is what was kept, and the $5 back each is credit owed, not taken off Left', async () => {
    const ctx = await setupGroup();
    const s = await on(ctx, '2026-11-12');
    await join(ctx, s.id, PLAYER_NAMES);
    await pay(ctx, s.id, PLAYER_NAMES);
    ctx.app.now = Date.parse(s.endsAt) + DAY;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    const m = await money(ctx, '2026-11');
    // 6 x $14 paid, 6 x $9 kept, typical $48 court, 6 x $5 credits owed.
    expect(m.collectedCents).toBe(5400);
    expect(m.courtCostCents).toBe(4800);
    expect(m.creditsOwedCents).toBe(3000);
    expect(m.heldCents).toBe(0);
    expect(m.netCents).toBe(600);
    expect(m.bottomLine).toBe('Surplus: $6 toward the $30 membership');
    expect(m.sessions.find((x: any) => x.id === s.id)).toMatchObject({ state: 'played', playedCount: 6, priceCents: 900, collectedCents: 5400 });
  });

  it('bottom line wording', () => {
    expect(bottomLine(1400, 3000)).toBe('Surplus: $14 toward the $30 membership');
    // No surplus unless the players paid more than the courts cost; otherwise it is what the organizer covered.
    expect(bottomLine(0, 3000)).toBe('Players covered the court costs');
    expect(bottomLine(-800, 3000)).toBe('You covered $8 of the court costs');
  });

  it('defaults: typical court cost $48, membership $30; a bad month is refused', async () => {
    const ctx = await setupGroup();
    expect((await dash(ctx)).group.settings).toMatchObject({ typicalCourtCostCents: 4800, monthlyMembershipCents: 3000 });
    expect((await ctx.organizer.call('GET', '/api/admin/money?month=2026-13')).status).toBe(400);
  });
});

describe('monthly money is private', () => {
  it('never reaches a player screen, a calendar file or a text', async () => {
    const ctx = await setupGroup();
    const settings = (await dash(ctx)).group.settings;
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', settings: { ...settings, typicalCourtCostCents: 4321, monthlyMembershipCents: 2987 } });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const alex = await playerPhone(ctx, 'Alex');
    // Players can't open it.
    expect((await alex.call('GET', '/api/admin/money?month=2026-11')).status).toBe(401);
    expect((await ctx.app.client().call('GET', '/api/admin/money')).status).toBe(401);
    const texts = [
      (await alex.call('GET', '/api/group')).text,
      (await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`)).text,
      (await ctx.app.client().call('GET', '/api/status')).text,
      canceledMessage(s, TZ, LONG_BEFORE, 'L', 'x'),
      movedMessage(s, s.startsAt, TZ, LONG_BEFORE, 'L', 'y'),
    ];
    for (const t of texts) {
      expect(t).not.toMatch(/(?<![A-Za-z0-9_-])(4321|2987)(?![A-Za-z0-9_-])|43\.21|29\.87|membership|typicalCourtCost|monthlyMembership|Monthly money|Surplus|You covered|Players covered/i);
    }
  });
});
