import { describe, expect, it } from 'vitest';
import { holidayFor, holidayOn } from '../shared/holidays';
import { pollMessage } from '../shared/messages';
import { normalizeSettings } from '../shared/settings';
import { DAY, firstSession, HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function sessionAt(ctx: Ctx, startsAt: string) {
  return (await dash(ctx)).sessions.find((x: any) => x.startsAt === startsAt);
}
async function join(ctx: Ctx, name: string, sessionId: string) {
  return (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${sessionId}/join`, {})).data;
}
async function sixOn(ctx: Ctx, sessionId: string) {
  for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, n, sessionId);
}
const TUE_OCT_27 = '2026-10-28T00:00:00.000Z';
const TUE_NOV_3 = '2026-11-04T01:00:00.000Z';
const THU_NOV_5 = '2026-11-06T01:00:00.000Z';
const THU_NOV_26 = '2026-11-27T01:00:00.000Z';

describe('first session date', () => {
  it('hides and stops making sessions before the date, for players and on Home', async () => {
    const ctx = await setupGroup();
    expect((await dash(ctx)).sessions[0].startsAt).toBe(TUE_OCT_27);
    const res = await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, firstSessionDate: '2026-11-03' });
    expect(res.status).toBe(200);
    const d = await dash(ctx);
    expect(d.group.firstSessionDate).toBe('2026-11-03');
    expect(d.sessions[0].startsAt).toBe(TUE_NOV_3); // Oct 27 and Oct 29 are gone from Home
    const player = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(player.sessions[0].startsAt).toBe(TUE_NOV_3);
    expect(player.sessions.some((s: any) => s.startsAt < TUE_NOV_3)).toBe(false);
    // Clearing the date brings them back.
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, firstSessionDate: null });
    expect((await dash(ctx)).sessions[0].startsAt).toBe(TUE_OCT_27);
  });

  it('never creates sessions before the date on a fresh schedule', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, firstSessionDate: '2026-11-03' });
    ctx.app.db.raw.exec('DELETE FROM sessions');
    await dash(ctx);
    const early = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE starts_at < ?').get(TUE_NOV_3) as { n: number };
    expect(early.n).toBe(0);
  });

  it('rejects a date that is not a date', async () => {
    const ctx = await setupGroup();
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', firstSessionDate: 'Nov 3' })).status).toBe(400);
  });
});

describe('group poll text', () => {
  it('uses the real date, the per-player price and the plain site address', () => {
    const s = { startsAt: TUE_NOV_3, endsAt: '2026-11-04T03:00:00.000Z' };
    expect(pollMessage(s, TZ, 1400, 'https://pickleball.juncaj.net/')).toBe('Pickleball Tue Nov 3, 8:00 to 10:00 PM. $14 each. In or out? pickleball.juncaj.net');
    expect(pollMessage(s, TZ, 1450, 'https://pickleball.juncaj.net')).toContain('$14.50 each');
  });
});

describe('court cost is private', () => {
  it('never reaches players, links, calendars, or the export', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Alex', s.id);
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, {
      bookingStatus: 'booked',
      courtCostCents: 4837,
      cancellationDeadlineAt: s.cancellationDeadlineAt,
    });
    // The organizer sees it.
    expect((await dash(ctx)).sessions.find((x: any) => x.id === s.id).courtCostCents).toBe(4837);

    const leaks = (text: string) => /(?<![A-Za-z0-9_-])4837(?![A-Za-z0-9_-])|48\.37|courtCost|court_cost/i.test(text);
    const alex = await playerPhone(ctx, 'Alex');
    expect(leaks((await alex.call('GET', '/api/group')).text)).toBe(false);
    const asAlex = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Alex });
    expect(leaks(asAlex.text)).toBe(false);
    const links = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'attendance' });
    const token = links.data.drafts[0].url.split('/t/')[1];
    expect(leaks((await ctx.app.client().call('POST', '/api/link', { token })).text)).toBe(false);
    expect(leaks((await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`)).text)).toBe(false);
    expect(leaks((await ctx.organizer.call('GET', '/api/admin/export')).text)).toBe(false);
  });
});

async function payAll(ctx: Ctx, sessionId: string, names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
  for (const n of names) expect((await ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/payment`, { playerId: ctx.byName[n], paid: true })).status).toBe(200);
}
async function finalize(ctx: Ctx, s: any, body: Record<string, unknown> = { everyone: true }) {
  ctx.app.now = Math.max(ctx.app.now, Date.parse(s.endsAt) + HOUR);
  const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, body);
  expect(res.status, res.text).toBe(200);
  return res.data;
}
const potOf = (d: any, playerId: string) => d.creditLedger.find((l: any) => l.playerId === playerId);

describe('credit after the game', () => {
  it('when 6 are in: everyone owes the flat $14 until the game is finalized, and nobody is promised a credit', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await join(ctx, n, s.id);
    const before = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(before.mine).toMatchObject({ shareCents: 1400, oweCents: 1400, creditBackCents: 0 });
    expect(before.finalized).toBeNull();

    for (const n of ['Emery', 'Frankie']) await join(ctx, n, s.id);
    const alex = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    const mine = alex.sessions.find((x: any) => x.id === s.id).mine;
    expect(mine).toMatchObject({ shareCents: 1400, oweCents: 1400, creditBackCents: 0 });
    expect('creditComing' in mine).toBe(false);
    expect('discount' in mine).toBe(false);
    expect(alex.credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data;
    expect(emery.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ shareCents: 1400, oweCents: 1400 });
    expect(emery.owed[0]).toMatchObject({ amountCents: 1400, finalized: false, creditCents: 0 });

    const x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => [r.name, r.shareCents, r.owesCents, r.played])).toEqual([
      ['Alex', 1400, 1400, null],
      ['Blair', 1400, 1400, null],
      ['Casey', 1400, 1400, null],
      ['Devon', 1400, 1400, null],
      ['Emery', 1400, 1400, null],
      ['Frankie', 1400, 1400, null],
    ]);
    expect(x.finalized).toBeNull();
    expect(x.needsFinalize).toBe(false); // not over yet
    expect((await dash(ctx)).creditLedger).toEqual([]);
  });

  it('after 6 play and the organizer finalizes, everyone who paid $14 gets $5 credit, and Use credit takes it off their next game', async () => {
    const ctx = await setupGroup();
    const [s, next] = (await dash(ctx)).sessions;
    await sixOn(ctx, s.id);
    await payAll(ctx, s.id);
    await join(ctx, 'Alex', next.id);
    // Before the game ends: no credit, and finalizing is refused.
    expect((await dash(ctx)).creditLedger).toEqual([]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(409);

    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    expect((await dash(ctx)).sessions.find((v: any) => v.id === s.id).needsFinalize).toBe(true);
    expect(await finalize(ctx, s)).toMatchObject({ played: 6, priceCents: 900 });
    const d = await dash(ctx);
    expect(d.creditLedger.map((c: any) => [c.playerId, c.balanceCents])).toEqual(
      ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].map((n) => [ctx.byName[n], 500]),
    );
    const x = d.sessions.find((v: any) => v.id === s.id);
    expect(x.finalized).toMatchObject({ playedCount: 6, priceCents: 900, creditBackCents: 3000 });
    expect(x.roster.find((r: any) => r.name === 'Alex')).toMatchObject({ played: true, paymentAmountCents: 1400, creditBackCents: 500, creditBackReason: 'finalized', owesCents: 0 });
    // Only once: a second finalize is refused and nothing doubles.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(409);
    expect((ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'kept'").get() as { n: number }).n).toBe(6);

    // The credit is Alex's to use on the next game: nothing comes off by itself.
    const alex = await playerPhone(ctx, 'Alex');
    let g = (await alex.call('GET', '/api/group')).data;
    expect(g.credit).toMatchObject({ balanceCents: 500, usableCents: 500, pending: null });
    expect(g.credit.history).toEqual([expect.objectContaining({ kind: 'kept', cents: 500, reason: 'finalized', playedCount: 6, sessionId: s.id })]);
    expect(g.owed.find((o: any) => o.sessionId === next.id)).toMatchObject({ amountCents: 1400, creditCents: 0 });
    expect(g.sessions.find((v: any) => v.id === next.id).mine.useCreditCents).toBe(500);
    expect((await alex.call('POST', `/api/sessions/${next.id}/use-credit`, {})).data).toMatchObject({ paid: false, usedCents: 500 });
    g = (await alex.call('GET', '/api/group')).data;
    expect(g.owed.find((o: any) => o.sessionId === next.id)).toMatchObject({ amountCents: 900, creditCents: 500 });
    expect(g.credit.balanceCents).toBe(0);

    // Marking paid records the whole $14 (cash $9 plus credit $5).
    await ctx.organizer.call('POST', `/api/admin/sessions/${next.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    let after = await dash(ctx);
    expect(after.sessions.find((v: any) => v.id === next.id).roster.find((r: any) => r.name === 'Alex')).toMatchObject({
      paymentStatus: 'paid',
      paymentAmountCents: 1400,
      creditCents: 500,
    });
    expect(potOf(after, ctx.byName.Alex).balanceCents).toBe(0);
    // Unmarking gives the credit back.
    await ctx.organizer.call('POST', `/api/admin/sessions/${next.id}/payment`, { playerId: ctx.byName.Alex, paid: false });
    after = await dash(ctx);
    expect(potOf(after, ctx.byName.Alex).balanceCents).toBe(500);
  });

  it('the credit shows on the player\'s own screen even with no next game yet; someone who never paid owes the final price', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    await payAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Frankie never pays
    await finalize(ctx, s);
    const blair = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data;
    expect(blair.credit).toMatchObject({ balanceCents: 500, usableCents: 500, pending: null });
    expect(blair.owed).toEqual([]);
    const frankie = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data;
    expect(frankie.credit).toMatchObject({ balanceCents: 0, usableCents: 0, history: [] });
    expect(frankie.owed).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 900, finalized: true, creditCents: 0 })]);
    const x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.find((r: any) => r.name === 'Frankie')).toMatchObject({ played: true, paymentStatus: 'unpaid', shareCents: 900, owesCents: 900, creditBackCents: 0 });
  });

  it('issues no credit when 4 play, $3 each when 5 play', async () => {
    const ctx = await setupGroup();
    const [s4, s5] = (await dash(ctx)).sessions;
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await join(ctx, n, s4.id);
    await payAll(ctx, s4.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await sixOn(ctx, s5.id);
    await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${s5.id}/withdraw`, {});
    await payAll(ctx, s5.id, ['Alex', 'Blair', 'Devon', 'Emery', 'Frankie']);
    expect(await finalize(ctx, s4)).toMatchObject({ played: 4, priceCents: 1400 });
    expect((await dash(ctx)).creditLedger).toEqual([]);
    expect(await finalize(ctx, s5)).toMatchObject({ played: 5, priceCents: 1100 });
    const d = await dash(ctx);
    expect(d.creditLedger.map((c: any) => c.balanceCents)).toEqual([300, 300, 300, 300, 300]);
    expect(potOf(d, ctx.byName.Casey)).toBeUndefined();
    const x = d.sessions.find((v: any) => v.id === s5.id);
    expect(x.finalized).toMatchObject({ playedCount: 5, priceCents: 1100, creditBackCents: 1500 });
    expect(x.roster.filter((r: any) => r.status === 'confirmed').every((r: any) => r.shareCents === 1100 && r.creditBackCents === 300)).toBe(true);
  });

  it('a drop before the game changes nobody else\'s price; the dropped player\'s $14 is credit, and coming back owes $14 again', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Emery, paid: true });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });

    expect((await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {})).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    const d = await dash(ctx);
    const x = d.sessions.find((v: any) => v.id === s.id);
    expect(x.confirmedCount).toBe(5);
    expect('sixDropped' in x).toBe(false);
    expect(x.roster.filter((r: any) => r.status === 'confirmed').every((r: any) => r.shareCents === 1400)).toBe(true);
    expect(x.roster.find((r: any) => r.name === 'Emery')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400, shareCents: 1400, creditBackCents: 0 });
    expect(x.roster.find((r: any) => r.name === 'Alex')).toMatchObject({ status: 'withdrawn', creditBackCents: 1400, creditBackReason: 'dropped' });
    expect(potOf(d, ctx.byName.Alex).balanceCents).toBe(1400);
    expect(potOf(d, ctx.byName.Emery)).toBeUndefined();
    const frankie = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data;
    expect(frankie.sessions.find((v: any) => v.id === s.id).mine).toMatchObject({ shareCents: 1400, oweCents: 1400 });
    // Nothing for the organizer to sort out: no card, no refund request.
    expect(d.refundRequests).toEqual([]);

    // Back in: 6 again, and Alex's new $14 seat is paid with the $14 credit as he joins (credit at sign-up is automatic).
    expect(await join(ctx, 'Alex', s.id)).toEqual({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    const alex = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(alex.sessions.find((v: any) => v.id === s.id).mine).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paidWithCredit: true, shareCents: 1400, oweCents: 0, useCreditCents: 0 });
    expect(alex.credit.balanceCents).toBe(0);
    expect(potOf(await dash(ctx), ctx.byName.Alex).balanceCents).toBe(0);
    expect((await dash(ctx)).sessions.find((v: any) => v.id === s.id).confirmedCount).toBe(6);
  });

  it('Refund credit balance on the Players tab clears a balance the organizer paid back by hand, and can be undone', async () => {
    const ctx = await setupGroup();
    const [s, next] = (await dash(ctx)).sessions;
    await sixOn(ctx, s.id);
    await payAll(ctx, s.id);
    await join(ctx, 'Casey', next.id);
    await finalize(ctx, s);
    expect(potOf(await dash(ctx), ctx.byName.Casey)).toMatchObject({ balanceCents: 500, reservedCents: 0, refundCents: 500 });
    // The amount has to be the balance Venmo was opened for.
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Casey}/credit-refund`, { refunded: true, cents: 400 })).status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Casey}/credit-refund`, { refunded: true, cents: 500 })).data).toEqual({ ok: true, changed: true });
    let d = await dash(ctx);
    expect(potOf(d, ctx.byName.Casey)).toMatchObject({ balanceCents: 0, refundCents: 0 });
    expect(potOf(d, ctx.byName.Casey).entries.filter((e: any) => !e.endedAt).map((e: any) => [e.kind, e.cents])).toEqual([['kept', 500], ['refunded', 500]]);
    expect(d.audit[0]).toMatchObject({ action: 'credit_refund_marked', details: expect.objectContaining({ amountCents: 500 }) });
    const casey = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data;
    expect(casey.credit.balanceCents).toBe(0);
    expect(casey.owed.find((o: any) => o.sessionId === next.id)).toMatchObject({ amountCents: 1400, creditCents: 0 });
    expect(casey.sessions.find((v: any) => v.id === next.id).mine.useCreditCents).toBe(0);
    // Nothing left to pay back; undo brings it back.
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Casey}/credit-refund`, { refunded: true, cents: 500 })).status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Casey}/credit-refund`, { refunded: false })).data).toEqual({ ok: true, changed: true });
    d = await dash(ctx);
    expect(potOf(d, ctx.byName.Casey).balanceCents).toBe(500);
    expect(d.audit[0]).toMatchObject({ action: 'credit_refund_undone' });
  });

  it('uses "$14 each" from Settings for every seat and the final price; the old credit setting is ignored', async () => {
    const normalized: Record<string, unknown> = { ...normalizeSettings({ creditCentsWhenSix: 600, refundCentsWhenSix: 400 }) };
    expect(normalized.creditCentsWhenSix).toBeUndefined();
    expect(normalized.refundCentsWhenSix).toBeUndefined();
    expect(normalized.maxPlayers).toBe(10);
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, settings: { pricePerPlayerCents: 1600 } });
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    await (await playerPhone(ctx, 'Frankie')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    let x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.filter((r: any) => r.status === 'confirmed').every((r: any) => r.shareCents === 1600)).toBe(true);
    await payAll(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    // 5 played at $16: floor(64 / 5) = $12 each, $4 back.
    expect(await finalize(ctx, s)).toMatchObject({ played: 5, priceCents: 1200 });
    x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.find((r: any) => r.name === 'Emery')).toMatchObject({ shareCents: 1200, paymentAmountCents: 1600, creditBackCents: 400 });
  });
});

describe('holidays', () => {
  it('knows the 2026 dates, including Thanksgiving and Election Day', () => {
    expect(holidayOn(2026, 11, 3)).toBe('Election Day');
    expect(holidayOn(2026, 11, 26)).toBe('Thanksgiving');
    expect(holidayOn(2026, 11, 25)).toBe('Day before Thanksgiving');
    expect(holidayOn(2026, 5, 25)).toBe('Memorial Day');
    expect(holidayOn(2026, 9, 7)).toBe('Labor Day');
    expect(holidayOn(2026, 7, 4)).toBe('July 4');
    expect(holidayOn(2026, 12, 24)).toBe('Christmas Eve');
    expect(holidayOn(2026, 12, 25)).toBe('Christmas Day');
    expect(holidayOn(2026, 12, 31)).toBe("New Year's Eve");
    expect(holidayOn(2027, 1, 1)).toBe("New Year's Day");
    expect(holidayOn(2026, 11, 5)).toBeNull();
    expect(holidayOn(2026, 11, 10)).toBeNull();
  });

  it('gets Election Day right when the 1st is a Tuesday (it is then the 8th)', () => {
    expect(holidayOn(2027, 11, 2)).toBe('Election Day'); // Nov 1, 2027 is a Monday
    expect(holidayOn(2022, 11, 8)).toBe('Election Day'); // Nov 1, 2022 was a Tuesday
    expect(holidayOn(2022, 11, 1)).toBeNull();
    expect(holidayOn(2028, 11, 7)).toBe('Election Day');
    expect(holidayOn(2027, 11, 25)).toBe('Thanksgiving');
  });

  it('uses the Eastern date of the session, not the UTC date', () => {
    expect(holidayFor(TUE_NOV_3, TZ)).toBe('Election Day'); // 8 PM Nov 3 is already Nov 4 in UTC
    expect(holidayFor(THU_NOV_26, TZ)).toBe('Thanksgiving');
  });

  it('puts the holiday on session cards for players and the organizer', async () => {
    const ctx = await setupGroup();
    const player = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(player.sessions.find((s: any) => s.startsAt === TUE_NOV_3).holiday).toBe('Election Day');
    expect(player.sessions.find((s: any) => s.startsAt === THU_NOV_26).holiday).toBe('Thanksgiving');
    expect(player.sessions.find((s: any) => s.startsAt === THU_NOV_5).holiday).toBeNull();
    expect((await sessionAt(ctx, TUE_NOV_3)).holiday).toBe('Election Day');
  });
});

describe('add my name', () => {
  async function stranger(ctx: Ctx) {
    const c = ctx.app.client();
    c.groupKey = ctx.groupKey;
    return c;
  }

  it('adds a new person, remembers them, and saves their preferred days', async () => {
    const ctx = await setupGroup();
    const phone = await stranger(ctx);
    const res = await phone.call('POST', '/api/players/self', { name: 'Morgan' });
    expect(res.data).toMatchObject({ result: 'added', me: { name: 'Morgan' } });
    expect((await phone.call('GET', '/api/group')).data.me).toMatchObject({ name: 'Morgan' });
    expect((await phone.call('PUT', '/api/me/days', { days: [2, 4] })).data).toEqual({ ok: true, usualDays: '2,4' });
    const p = (await dash(ctx)).players.find((x: any) => x.name === 'Morgan');
    expect(p).toMatchObject({ isNew: true, usualDays: [2, 4], isRegular: true });
    // The organizer reviews them: the New tag goes away.
    await ctx.organizer.call('PUT', `/api/admin/players/${p.id}`, { name: 'Morgan', isRegular: false });
    expect((await dash(ctx)).players.find((x: any) => x.name === 'Morgan')).toMatchObject({ isNew: false, isRegular: false });
  });

  it('Skip leaves them occasional with no usual days', async () => {
    const ctx = await setupGroup();
    const phone = await stranger(ctx);
    await phone.call('POST', '/api/players/self', { name: 'Quinn' });
    expect((await dash(ctx)).players.find((x: any) => x.name === 'Quinn')).toMatchObject({ isNew: true, usualDays: [], isRegular: false });
  });

  it('asks "Is this you?" for a name that looks like someone already on the list', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('POST', '/api/admin/players', { name: 'Ryan' });
    const phone = await stranger(ctx);
    for (const typed of ['Ryan', 'ryan', 'Ryan S', 'Rayn']) {
      const res = await phone.call('POST', '/api/players/self', { name: typed });
      expect(res.data).toMatchObject({ result: 'looks_like', matches: [{ name: 'Ryan' }] });
    }
    expect((await phone.call('GET', '/api/group')).data.me).toBeNull(); // nothing added yet
    // "No, I'm new" with the exact same name: has to be told to pick another.
    expect((await phone.call('POST', '/api/players/self', { name: 'Ryan', confirmNew: true })).status).toBe(409);
    // A different name is fine.
    expect((await phone.call('POST', '/api/players/self', { name: 'Ryan S', confirmNew: true })).data.result).toBe('added');
    expect((await phone.call('POST', '/api/players/self', { name: 'Morgan' })).data.result).toBe('added');
  });

  it('needs the group link when the open address is off', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', openAccess: false });
    expect((await ctx.app.client().call('POST', '/api/players/self', { name: 'Morgan' })).status).toBe(404);
  });
});

describe('removing a name', () => {
  it('deletes someone with no history completely', async () => {
    const ctx = await setupGroup();
    const add = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Typo Name' });
    // Saying "No" to a suggestion isn't history.
    const s = await firstSession(ctx);
    ctx.app.db.raw
      .prepare("INSERT INTO session_players (id, session_id, player_id, status, claimed_at, updated_at) VALUES ('d1', ?, ?, 'declined', 'x', 'x')")
      .run(s.id, add.data.id);
    expect((await ctx.organizer.call('DELETE', `/api/admin/players/${add.data.id}`)).data).toEqual({ result: 'deleted' });
    expect((await dash(ctx)).players.some((p: any) => p.name === 'Typo Name')).toBe(false);
    expect((ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM players WHERE id = ?').get(add.data.id) as { n: number }).n).toBe(0);
  });

  it('hides someone who signed up, so their records stay', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Devon', s.id);
    await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    expect((await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName.Devon}`)).data).toEqual({ result: 'hidden' });
    const d = await dash(ctx);
    expect(d.players.find((p: any) => p.name === 'Devon')).toMatchObject({ isActive: false });
    expect(d.sessions.find((x: any) => x.id === s.id).roster.map((r: any) => r.name)).toContain('Devon');
    const names = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data.players.map((p: any) => p.name);
    expect(names).not.toContain('Devon');
  });

  it('only the organizer can remove names', async () => {
    const ctx = await setupGroup();
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('DELETE', `/api/admin/players/${ctx.byName.Blair}`)).status).toBe(401);
  });
});

describe('time zone sanity for credits', () => {
  it('a credit earned Tuesday can be used on Thursday', async () => {
    const ctx = await setupGroup();
    const [tue, thu] = (await dash(ctx)).sessions;
    expect(Date.parse(thu.startsAt) - Date.parse(tue.startsAt)).toBe(2 * DAY);
    await sixOn(ctx, tue.id);
    await payAll(ctx, tue.id);
    await join(ctx, 'Devon', thu.id);
    ctx.app.now = Date.parse(tue.endsAt) + 1;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${tue.id}/finalize`, { everyone: true })).status).toBe(200);
    const devon = await playerPhone(ctx, 'Devon');
    let g = (await devon.call('GET', '/api/group')).data;
    expect(g.credit.balanceCents).toBe(500);
    expect(g.owed.find((o: any) => o.sessionId === thu.id)).toMatchObject({ amountCents: 1400, creditCents: 0 });
    expect(g.sessions.find((v: any) => v.id === thu.id).mine.useCreditCents).toBe(500);
    expect((await devon.call('POST', `/api/sessions/${thu.id}/use-credit`, {})).data).toMatchObject({ paid: false, usedCents: 500 });
    g = (await devon.call('GET', '/api/group')).data;
    expect(g.owed.find((o: any) => o.sessionId === thu.id)).toMatchObject({ amountCents: 900, creditCents: 500 });
  });
});
