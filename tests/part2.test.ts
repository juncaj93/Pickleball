import { describe, expect, it } from 'vitest';
import { DAY, firstSession, HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function join(ctx: Ctx, name: string, sessionId: string) {
  return (await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${sessionId}/join`, {})).data;
}

async function adminSession(ctx: Ctx, id: string) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id === id);
}

const confirmedNames = (s: any) => s.roster.filter((r: any) => r.status === 'confirmed').map((r: any) => r.name);
const waitingNames = (s: any) => s.roster.filter((r: any) => r.status === 'waitlisted').map((r: any) => r.name);

/** Extra names so a game can pass the default max of 10 (and the database cap of 12). */
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee', 'Morgan'];

async function withMore(ctx: Ctx, count = MORE.length) {
  for (const name of MORE.slice(0, count)) {
    const res = await ctx.organizer.call('POST', '/api/admin/players', { name });
    ctx.byName[name] = res.data.id;
  }
  return ctx;
}

const setMax = (ctx: Ctx, maxPlayers: number) => ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers } });

describe('one court: any number from 4 to the max', () => {
  it('the 5th, 6th and 7th are simply in; the 11th waits at the default max of 10', async () => {
    const ctx = await withMore(await setupGroup());
    const s = await firstSession(ctx);
    const ten = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules'];
    for (const name of ten) expect(await join(ctx, name, s.id), name).toEqual({ result: 'confirmed' });
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(10);

    // Nobody was "moved in": they were all simply in.
    const full = await adminSession(ctx, s.id);
    expect(confirmedNames(full)).toEqual(ten);
    expect(full.roster.some((r: any) => r.promotionReason)).toBe(false);
    expect(full.state.flags).toMatchObject({ full: true, openSpots: 0, playersNeeded: 0 });

    // The 5th sees a plain count, no good-news line.
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(emery.mine).toMatchObject({ status: 'confirmed', promotion: null, shareCents: 1400 });
    expect(emery.countText).toBe('10 in, full');
    expect(emery.full).toBe(true);

    // An 11th waits.
    expect(await join(ctx, 'Kit', s.id)).toEqual({ result: 'waitlisted', position: 1 });
    expect(waitingNames(await adminSession(ctx, s.id))).toEqual(['Kit']);
  });

  it('counts read "3 of 4 in", then "5 in", then "10 in, full"', async () => {
    const ctx = await withMore(await setupGroup());
    const s = await firstSession(ctx);
    const text = async () => (await (await playerPhone(ctx, 'Morgan')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id).countText;
    for (const name of ['Alex', 'Blair', 'Casey']) await join(ctx, name, s.id);
    expect(await text()).toBe('3 of 4 in');
    for (const name of ['Devon', 'Emery']) await join(ctx, name, s.id);
    expect(await text()).toBe('5 in');
    for (const name of ['Frankie', 'Gale', 'Harper', 'Indy', 'Jules']) await join(ctx, name, s.id);
    expect(await text()).toBe('10 in, full');
  });

  it('prepares a message for each person moved in from the waitlist, until the organizer marks it sent', async () => {
    const ctx = await setupGroup();
    await setMax(ctx, 4);
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, name, s.id);
    expect(waitingNames(await adminSession(ctx, s.id))).toEqual(['Emery', 'Frankie']);
    for (const name of ['Alex', 'Blair']) await (await playerPhone(ctx, name)).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    let after = await adminSession(ctx, s.id);
    expect(confirmedNames(after)).toEqual(['Casey', 'Devon', 'Emery', 'Frankie']);
    expect(after.roster.filter((r: any) => r.promotedAt && !r.promotionNotifiedAt).map((r: any) => r.name)).toEqual(['Emery', 'Frankie']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/told`, { playerId: ctx.byName.Emery });
    after = await adminSession(ctx, s.id);
    expect(after.roster.filter((r: any) => r.promotedAt && !r.promotionNotifiedAt).map((r: any) => r.name)).toEqual(['Frankie']);
  });

  it('moves the first waiting player in when someone drops out of a full game', async () => {
    const ctx = await setupGroup();
    await setMax(ctx, 4);
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, name, s.id);
    expect(waitingNames(await adminSession(ctx, s.id))).toEqual(['Emery']);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const after = await adminSession(ctx, s.id);
    expect(confirmedNames(after)).toEqual(['Alex', 'Casey', 'Devon', 'Emery']);
    expect(after.roster.find((r: any) => r.name === 'Emery')).toMatchObject({ promotionReason: 'spot_opened', promotionNotifiedAt: null });
    expect(waitingNames(after)).toEqual([]);
    // Now in, they owe $14 like everyone else.
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(emery.mine).toMatchObject({ status: 'confirmed', promotion: 'spot_opened', oweCents: 1400 });
  });

  it('a drop out of 6 leaves 5 in: nothing special happens, and the organizer can still move people by hand', async () => {
    const ctx = await withMore(await setupGroup(), 1);
    await setMax(ctx, 6);
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) await join(ctx, name, s.id);
    expect(waitingNames(await adminSession(ctx, s.id))).toEqual(['Gale']);
    // At the max, a drop moves the waiting player in by itself.
    await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    let six = await adminSession(ctx, s.id);
    expect(six.confirmedCount).toBe(6);
    expect(waitingNames(six)).toEqual([]);
    expect(six.state.flags).toMatchObject({ full: true, openSpots: 0 });

    // Nobody waiting: a drop simply leaves 5 in. No "5 going" state, no flag.
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const five = await adminSession(ctx, s.id);
    expect(five.confirmedCount).toBe(5);
    expect(five.state.label).not.toMatch(/five|going/);
    expect(five.state.text).not.toMatch(/5 going|need 4 or 6/);
    expect(five.state.flags).toMatchObject({ full: false, openSpots: 1, playersNeeded: 0, underfilled: false });
    expect('fiveGoing' in five.state.flags).toBe(false);

    // The organizer can move someone to the waitlist; they stay there until confirmed again.
    const path = `/api/admin/sessions/${s.id}/roster`;
    await ctx.organizer.call('POST', path, { playerId: ctx.byName.Gale, action: 'waitlist' });
    const four = await adminSession(ctx, s.id);
    expect(four.confirmedCount).toBe(4);
    expect(waitingNames(four)).toEqual(['Gale']);
    expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName.Gale, action: 'confirm' })).data.result).toBe('confirmed');
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(5);
  });

  it('lets a new person turn 5 into 6 when nobody is waiting', async () => {
    const ctx = await withMore(await setupGroup(), 1);
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, name, s.id);
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const gale = await playerPhone(ctx, 'Gale');
    const view = (await gale.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(view.joinAs).toBe('in');
    expect((await gale.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(6);
  });

  it('never goes above the max, even when everyone taps at once', async () => {
    const eleven = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
    for (let round = 0; round < 5; round++) {
      const ctx = await withMore(await setupGroup(), 5);
      const s = await firstSession(ctx);
      const phones = await Promise.all(eleven.map((n) => playerPhone(ctx, n)));
      await Promise.all(phones.map((p) => p.call('POST', `/api/sessions/${s.id}/join`, {})));
      const after = await adminSession(ctx, s.id);
      expect(after.confirmedCount).toBe(10);
      expect(after.waitlistCount).toBe(1);
    }
  });

  it('blocks a 13th confirmed player at the database level (the widest max is 12)', async () => {
    const ctx = await withMore(await setupGroup());
    const s = await firstSession(ctx);
    const insert = ctx.app.db.raw.prepare(
      "INSERT INTO session_players (id, session_id, player_id, status, claimed_at, updated_at) VALUES (?, ?, ?, 'confirmed', '2026-01-01', '2026-01-01')",
    );
    const twelve = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
    twelve.forEach((n, i) => insert.run(`row-${i}`, s.id, ctx.byName[n]));
    expect(() => insert.run('row-13', s.id, ctx.byName.Morgan)).toThrow(/session_full/);
  });

  it('lets the organizer give spots up to the max, never more', async () => {
    const ctx = await withMore(await setupGroup(), 5);
    const s = await firstSession(ctx);
    const path = `/api/admin/sessions/${s.id}/roster`;
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules']) {
      expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName[name], action: 'confirm' })).status, name).toBe(200);
    }
    const eleventh = await ctx.organizer.call('POST', path, { playerId: ctx.byName.Kit, action: 'confirm' });
    expect(eleventh.status).toBe(409);
    expect(eleventh.data.message).toBe('The game is full (10 in).');
    // A lower max from Settings is the limit too.
    await setMax(ctx, 6);
    const t = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: any) => x.id !== s.id && Date.parse(x.startsAt) > ctx.app.now);
    const path2 = `/api/admin/sessions/${t.id}/roster`;
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
      expect((await ctx.organizer.call('POST', path2, { playerId: ctx.byName[name], action: 'confirm' })).status, name).toBe(200);
    }
    expect((await ctx.organizer.call('POST', path2, { playerId: ctx.byName.Gale, action: 'confirm' })).status).toBe(409);
  });
});

describe('flat price', () => {
  it('marks paid for the right player and session only', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const other = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions[1];
    for (const name of ['Alex', 'Blair']) await join(ctx, name, s.id);
    await join(ctx, 'Blair', other.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const x = await adminSession(ctx, s.id);
    expect(x.roster.find((r: any) => r.name === 'Blair')).toMatchObject({ paymentStatus: 'paid', paymentAmountCents: 1400 });
    expect(x.roster.find((r: any) => r.name === 'Alex').paymentStatus).toBe('unpaid');
    expect((await adminSession(ctx, other.id)).roster.find((r: any) => r.name === 'Blair').paymentStatus).toBe('unpaid');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: false });
    expect((await adminSession(ctx, s.id)).roster.find((r: any) => r.name === 'Blair').paymentStatus).toBe('unpaid');
  });

  it('only shows the soft "unpaid" reminder once the session ended more than 24 hours ago', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Devon', s.id);
    const devon = await playerPhone(ctx, 'Devon');
    const owed = async () => (await devon.call('GET', '/api/group')).data.owed;

    expect(await owed()).toEqual([expect.objectContaining({ sessionId: s.id, amountCents: 1400, reminder: false })]);
    ctx.app.now = Date.parse(s.endsAt) + 23 * HOUR;
    expect((await owed())[0].reminder).toBe(false);
    ctx.app.now = Date.parse(s.endsAt) + 25 * HOUR;
    expect((await owed())[0].reminder).toBe(true);

    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Devon, paid: true });
    expect(await owed()).toEqual([]);
  });

  it('shows a player only their own payment, and a player cannot mark anything paid', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Casey']) await join(ctx, name, s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true });
    const casey = await playerPhone(ctx, 'Casey');
    const view = await casey.call('GET', '/api/group');
    expect(view.data.sessions.find((x: any) => x.id === s.id).mine).toMatchObject({ shareCents: 1400, paymentStatus: 'unpaid' });
    const body = JSON.stringify(view.data);
    expect(body).not.toMatch(/"paid"/);
    expect(body).not.toMatch(/555-01/);
    expect((await casey.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true })).status).toBe(401);
  });

  it('owes nothing for canceled sessions', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Alex', s.id);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Alex, paid: true })).status).toBe(409);
    expect((await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data.owed).toEqual([]);
    expect((await adminSession(ctx, s.id)).payableCount).toBe(0);
  });
});

describe('players: remembered name, usual days, suggestions', () => {
  it('remembers the picked name on that phone, and "Not you?" forgets it', async () => {
    const ctx = await setupGroup();
    const phone = ctx.app.client();
    phone.groupKey = ctx.groupKey;
    expect((await phone.call('GET', '/api/group')).data.me).toBeNull();
    await phone.call('POST', '/api/me', { playerId: ctx.byName.Casey });
    // A later visit from the same phone: straight to "Welcome, Casey".
    ctx.app.advance(30 * DAY);
    expect((await phone.call('GET', '/api/group')).data.me).toMatchObject({ name: 'Casey' });
    // Another phone with the same link is a stranger.
    const other = ctx.app.client();
    other.groupKey = ctx.groupKey;
    expect((await other.call('GET', '/api/group')).data.me).toBeNull();
    await phone.call('DELETE', '/api/me');
    expect((await phone.call('GET', '/api/group')).data.me).toBeNull();
  });

  it('saves usual days and Regular / Occasional, and can add people', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Blair}`, { name: 'Blair', usualDays: [4, 2], isRegular: true });
    const add = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Ryan', usualDays: [2], isRegular: false });
    expect(add.status).toBe(200);
    const players = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players;
    expect(players.find((p: any) => p.name === 'Blair')).toMatchObject({ usualDays: [2, 4], isRegular: true });
    expect(players.find((p: any) => p.name === 'Ryan')).toMatchObject({ usualDays: [2], isRegular: false });
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Blair}`, { name: 'Blair', usualDays: [3] })).status).toBe(400);
  });

  it('suggests the next usual day to a regular who has not answered; No hides it', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Blair}`, { name: 'Blair', usualDays: [4] });
    const blair = await playerPhone(ctx, 'Blair');
    const g = (await blair.call('GET', '/api/group')).data;
    // Monday Oct 26 now: the next Thursday is Oct 29.
    expect(g.suggestion).toMatchObject({ startsAt: '2026-10-30T00:00:00.000Z', joinAs: 'in' });
    expect((await blair.call('POST', `/api/sessions/${g.suggestion.sessionId}/decline`, {})).data).toEqual({ result: 'declined' });
    const after = (await blair.call('GET', '/api/group')).data;
    expect(after.suggestion?.sessionId).not.toBe(g.suggestion.sessionId);
    // Saying no doesn't take a spot or join the waitlist.
    const s = await adminSession(ctx, g.suggestion.sessionId);
    expect(s.confirmedCount + s.waitlistCount).toBe(0);
  });

  it('suggests nothing to occasional players or people with no usual day', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Casey}`, { name: 'Casey', usualDays: [2, 4], isRegular: false });
    expect((await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data.suggestion).toBeNull();
    expect((await (await playerPhone(ctx, 'Devon')).call('GET', '/api/group')).data.suggestion).toBeNull();
  });

  it('stops suggesting a day once the player answered Yes', async () => {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}`, { name: 'Alex', usualDays: [2] });
    const alex = await playerPhone(ctx, 'Alex');
    const first = (await alex.call('GET', '/api/group')).data.suggestion;
    expect(first.startsAt).toBe('2026-10-28T00:00:00.000Z'); // Tue Oct 27, 8 PM
    expect((await alex.call('POST', `/api/sessions/${first.sessionId}/join`, {})).data).toEqual({ result: 'confirmed' });
    // Next Tuesday is more than 8 days out, so nothing yet...
    expect((await alex.call('GET', '/api/group')).data.suggestion).toBeNull();
    // ...until it comes into range.
    ctx.app.advance(DAY);
    const next = (await alex.call('GET', '/api/group')).data.suggestion;
    expect(next.startsAt).toBe('2026-11-04T01:00:00.000Z'); // Tue Nov 3, 8 PM EST
  });
});

describe('View as', () => {
  it('shows exactly what the player sees, and only to the signed-in organizer', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    await join(ctx, 'Casey', s.id);
    const asCasey = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Casey });
    const realCasey = await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group');
    expect(asCasey.data.viewingAs).toBe(true);
    expect({ ...asCasey.data, viewingAs: false }).toEqual(realCasey.data);

    // A player can't use the header to become someone else.
    const alex = await playerPhone(ctx, 'Alex');
    expect((await alex.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Casey })).status).toBe(401);
  });

  it('is look-only: every tap answers "Demo only", nothing changes, nothing is logged', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const as = { 'X-View-As': ctx.byName.Devon };
    const before = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const taps: [string, string, unknown][] = [
      ['POST', `/api/sessions/${s.id}/join`, {}],
      ['POST', `/api/sessions/${s.id}/withdraw`, {}],
      ['POST', `/api/sessions/${s.id}/paid`, { paid: true }],
      ['POST', `/api/sessions/${s.id}/confirm`, {}],
      ['POST', `/api/sessions/${s.id}/decline`, {}],
      ['PUT', '/api/me/days', { days: [2] }],
    ];
    for (const [m, p, b] of taps) {
      const r = await ctx.organizer.call(m, p, b, as);
      expect(r.status, p).toBe(403);
      expect(r.data).toEqual({ error: 'demo_only', message: 'Demo only. Nothing was saved.' });
    }
    const after = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(confirmedNames(after.sessions.find((x: any) => x.id === s.id))).toEqual([]);
    expect(after.audit).toEqual(before.audit);
    expect(after.players.find((p: any) => p.name === 'Devon').usualDays).toEqual(before.players.find((p: any) => p.name === 'Devon').usualDays);
    // Looking still works.
    expect((await ctx.organizer.call('GET', '/api/group', undefined, as)).data.me.name).toBe('Devon');
  });
});

describe('calendar file', () => {
  it('downloads an event for the session with the venue from Settings', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    let res = await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    expect(res.headers.get('Content-Disposition')).toContain('pickleball-2026-10-27.ics');
    expect(res.text).toContain('SUMMARY:Pickleball');
    expect(res.text).toContain('LOCATION:Northville Pickleball Club\r\n');
    expect(res.text).toContain('DTSTART;TZID=America/Detroit:20261027T200000'); // 8:00 PM Eastern
    expect(res.text).toContain('DTEND;TZID=America/Detroit:20261027T220000'); // 10:00 PM Eastern
    expect(res.text).toContain('TZID:America/Detroit\r\n');

    await ctx.organizer.call('PUT', '/api/admin/group', { name: 'Dinks', venmoUrl: null, venueAddress: '123 Main St, Northville, MI' });
    res = await ctx.app.client().call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(res.text).toContain('LOCATION:Northville Pickleball Club\\, 123 Main St\\, Northville\\, MI');
    expect((await ctx.app.client().call('GET', `/api/sessions/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/calendar.ics`)).status).toBe(404);
  });
});
