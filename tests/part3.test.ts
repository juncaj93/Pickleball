import { describe, expect, it } from 'vitest';
import { holidayFor, holidayOn } from '../shared/holidays';
import { pollMessage } from '../shared/messages';
import { allocateCredits } from '../shared/pricing';
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

describe('credits instead of refunds', () => {
  it('when 6 are in: first four keep $14 and hear about a credit; the last two owe $9', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await join(ctx, n, s.id);
    const before = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(before.mine).toMatchObject({ shareCents: 1400, creditComing: false, discount: false });

    for (const n of ['Emery', 'Frankie']) await join(ctx, n, s.id);
    const alex = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    expect(alex.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ shareCents: 1400, creditComing: true, discount: false });
    expect(alex.group.creditCents).toBe(500);
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data;
    expect(emery.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ shareCents: 900, discount: true, creditComing: false });
    expect(emery.owed[0]).toMatchObject({ amountCents: 900, discount: true, creditCents: 0 });

    const x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => [r.name, r.shareCents, r.discount])).toEqual([
      ['Alex', 1400, false],
      ['Blair', 1400, false],
      ['Casey', 1400, false],
      ['Devon', 1400, false],
      ['Emery', 900, true],
      ['Frankie', 900, true],
    ]);
    expect(x.refunds).toBeUndefined();
  });

  it('after a session with 6 ends, the first four get a $5 credit that comes off their next session', async () => {
    const ctx = await setupGroup();
    const [s, next] = (await dash(ctx)).sessions;
    await sixOn(ctx, s.id);
    await join(ctx, 'Alex', next.id);
    // Before the session ends: no credits yet.
    expect((await dash(ctx)).credits).toEqual([]);

    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    const d = await dash(ctx);
    expect(d.credits.map((c: any) => [c.name, c.balanceCents])).toEqual([
      ['Alex', 500],
      ['Blair', 500],
      ['Casey', 500],
      ['Devon', 500],
    ]);
    // Only once, however many times pages load.
    await dash(ctx);
    expect((ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credits').get() as { n: number }).n).toBe(4);

    const alex = await playerPhone(ctx, 'Alex');
    const owed = (await alex.call('GET', '/api/group')).data.owed.find((o: any) => o.sessionId === next.id);
    expect(owed).toMatchObject({ amountCents: 900, creditCents: 500 });

    // Marking paid uses the credit up.
    await ctx.organizer.call('POST', `/api/admin/sessions/${next.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const after = await dash(ctx);
    expect(after.sessions.find((v: any) => v.id === next.id).roster.find((r: any) => r.name === 'Alex')).toMatchObject({
      paymentAmountCents: 900,
      creditCents: 500,
    });
    expect(after.credits.find((c: any) => c.name === 'Alex')).toBeUndefined();
    // Unmarking gives the credit back.
    await ctx.organizer.call('POST', `/api/admin/sessions/${next.id}/payment`, { playerId: ctx.byName.Alex, paid: false });
    expect((await dash(ctx)).credits.find((c: any) => c.name === 'Alex').balanceCents).toBe(500);
  });

  it('shows a waiting credit when the player has no next session yet', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    const blair = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data;
    expect(blair.creditBalanceCents).toBe(500);
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data;
    expect(emery.creditBalanceCents).toBe(0);
  });

  it('issues no credits if only 4 or 5 end up playing', async () => {
    const ctx = await setupGroup();
    const [s4, s5] = (await dash(ctx)).sessions;
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await join(ctx, n, s4.id);
    await sixOn(ctx, s5.id);
    await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${s5.id}/withdraw`, {});
    ctx.app.now = Date.parse(s5.endsAt) + HOUR;
    expect((await dash(ctx)).credits).toEqual([]);
  });

  it('dropping below 6 takes the discount away and shows the organizer a card until sorted', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Emery, paid: true });
    expect((await dash(ctx)).sessions[0].sixDropped).toBe(false);

    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    let x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.confirmedCount).toBe(5);
    expect(x.sixDropped).toBe(true);
    expect(x.roster.filter((r: any) => r.status === 'confirmed').every((r: any) => r.shareCents === 1400 && !r.discount)).toBe(true);
    expect(x.roster.find((r: any) => r.name === 'Emery')).toMatchObject({ paymentAmountCents: 900, shareCents: 1400 });
    const frankie = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data;
    expect(frankie.sessions.find((v: any) => v.id === s.id).mine).toMatchObject({ shareCents: 1400, discount: false });
    const blair = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data;
    expect(blair.sessions.find((v: any) => v.id === s.id).mine.creditComing).toBe(false);

    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/six-sorted`, {});
    expect((await dash(ctx)).sessions.find((v: any) => v.id === s.id).sixDropped).toBe(false);

    // Back to 6, then down again: the card comes back.
    await join(ctx, 'Alex', s.id);
    expect((await dash(ctx)).sessions.find((v: any) => v.id === s.id).confirmedCount).toBe(6);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.sixDropped).toBe(true);
  });

  it('drops straight to 4 also counts, and no credits are issued for it', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.confirmedCount).toBe(4);
    expect(x.sixDropped).toBe(true);
    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    expect((await dash(ctx)).credits).toEqual([]);
  });

  it('Clear credit wipes a balance the organizer paid back by hand', async () => {
    const ctx = await setupGroup();
    const [s, next] = (await dash(ctx)).sessions;
    await sixOn(ctx, s.id);
    await join(ctx, 'Casey', next.id);
    ctx.app.now = Date.parse(s.endsAt) + HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/credits/${ctx.byName.Casey}/clear`, {})).data).toEqual({ ok: true, cleared: 1 });
    const d = await dash(ctx);
    expect(d.credits.find((c: any) => c.name === 'Casey')).toBeUndefined();
    const casey = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data;
    expect(casey.owed.find((o: any) => o.sessionId === next.id)).toMatchObject({ amountCents: 1400, creditCents: 0 });
    expect(d.audit[0]).toMatchObject({ action: 'credit_cleared' });
  });

  it('uses "Credit per person when 6 play" from Settings, and reads the old refund setting', async () => {
    expect(normalizeSettings({ refundCentsWhenSix: 400 }).creditCentsWhenSix).toBe(400);
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, settings: { creditCentsWhenSix: 600 } });
    const s = await firstSession(ctx);
    await sixOn(ctx, s.id);
    const x = (await dash(ctx)).sessions.find((v: any) => v.id === s.id);
    expect(x.roster.find((r: any) => r.name === 'Frankie').shareCents).toBe(800);
  });

  it('applies credits whole, to the earliest later session', () => {
    const plan = allocateCredits(
      [{ id: 'c1', playerId: 'p', amountCents: 500, earnedAfter: '2026-11-04T03:00:00.000Z' }],
      [
        { sessionId: 'before', playerId: 'p', startsAt: '2026-11-04T01:00:00.000Z', cents: 1400 },
        { sessionId: 'tiny', playerId: 'p', startsAt: '2026-11-06T01:00:00.000Z', cents: 400 },
        { sessionId: 'next', playerId: 'p', startsAt: '2026-11-11T01:00:00.000Z', cents: 1400 },
      ],
    );
    expect([...plan.keys()]).toEqual(['next:p']);
    expect(plan.get('next:p')).toEqual({ cents: 500, ids: ['c1'] });
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
  it('a credit earned Tuesday applies to Thursday', async () => {
    const ctx = await setupGroup();
    const [tue, thu] = (await dash(ctx)).sessions;
    expect(Date.parse(thu.startsAt) - Date.parse(tue.startsAt)).toBe(2 * DAY);
    await sixOn(ctx, tue.id);
    await join(ctx, 'Devon', thu.id);
    ctx.app.now = Date.parse(tue.endsAt) + 1;
    const devon = (await (await playerPhone(ctx, 'Devon')).call('GET', '/api/group')).data;
    expect(devon.owed.find((o: any) => o.sessionId === thu.id)).toMatchObject({ amountCents: 900, creditCents: 500 });
  });
});
