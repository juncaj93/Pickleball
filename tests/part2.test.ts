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

async function withSeventh(ctx: Ctx) {
  const res = await ctx.organizer.call('POST', '/api/admin/players', { name: 'Gale' });
  ctx.byName.Gale = res.data.id;
  return ctx;
}

describe('one court: exactly 4 or 6', () => {
  it('confirms 4, waitlists the 5th, and confirms both when a 6th joins', async () => {
    const ctx = await withSeventh(await setupGroup());
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) expect(await join(ctx, name, s.id)).toEqual({ result: 'confirmed' });
    expect(await join(ctx, 'Emery', s.id)).toEqual({ result: 'waitlisted', position: 1 });
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(4);

    // The 6th person: both of them are in.
    expect(await join(ctx, 'Frankie', s.id)).toEqual({ result: 'confirmed', madeSix: true });
    const six = await adminSession(ctx, s.id);
    expect(confirmedNames(six)).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    expect(six.roster.filter((r: any) => r.promotionReason === 'made_six').map((r: any) => r.name)).toEqual(['Emery', 'Frankie']);

    // Both see the good news.
    const emery = (await (await playerPhone(ctx, 'Emery')).call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(emery.mine).toMatchObject({ status: 'confirmed', promotion: 'made_six' });
    expect(emery.goingText).toBe('6 going');

    // A 7th waits.
    expect(await join(ctx, 'Gale', s.id)).toEqual({ result: 'waitlisted', position: 1 });
  });

  it('prepares a message for each person moved in, until the organizer marks it sent', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, name, s.id);
    let six = await adminSession(ctx, s.id);
    expect(six.roster.filter((r: any) => r.promotedAt && !r.promotionNotifiedAt).map((r: any) => r.name)).toEqual(['Emery', 'Frankie']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/told`, { playerId: ctx.byName.Emery });
    six = await adminSession(ctx, s.id);
    expect(six.roster.filter((r: any) => r.promotedAt && !r.promotionNotifiedAt).map((r: any) => r.name)).toEqual(['Frankie']);
  });

  it('moves the first waiting player in when someone drops out of 4', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) await join(ctx, name, s.id);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const after = await adminSession(ctx, s.id);
    expect(confirmedNames(after)).toEqual(['Alex', 'Casey', 'Devon', 'Emery']);
    expect(after.roster.find((r: any) => r.name === 'Emery')).toMatchObject({ promotionReason: 'spot_opened', promotionNotifiedAt: null });
    expect(waitingNames(after)).toEqual([]);
  });

  it('shows "5 going" when someone drops out of 6, and changes nothing by itself', async () => {
    const ctx = await withSeventh(await setupGroup());
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) await join(ctx, name, s.id);
    await (await playerPhone(ctx, 'Casey')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const five = await adminSession(ctx, s.id);
    expect(five.confirmedCount).toBe(5);
    expect(waitingNames(five)).toEqual(['Gale']); // not moved in automatically
    expect(five.state).toMatchObject({ label: 'five_going', text: '5 going' });
    expect(five.state.flags.fiveGoing).toBe(true);

    // Choice 1: move the waiting player in (6).
    const path = `/api/admin/sessions/${s.id}/roster`;
    expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName.Gale, action: 'confirm' })).data.result).toBe('confirmed');
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(6);

    // Choice 2 (after another drop): back to 4 by moving someone to the waitlist. They stay there.
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await ctx.organizer.call('POST', path, { playerId: ctx.byName.Gale, action: 'waitlist' });
    const four = await adminSession(ctx, s.id);
    expect(four.confirmedCount).toBe(4);
    expect(waitingNames(four)).toEqual(['Gale']);
    expect(four.state.flags.fiveGoing).toBe(false);
  });

  it('lets a new person turn 5 into 6 when nobody is waiting', async () => {
    const ctx = await withSeventh(await setupGroup());
    const s = await firstSession(ctx);
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) await join(ctx, name, s.id);
    await (await playerPhone(ctx, 'Alex')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const gale = await playerPhone(ctx, 'Gale');
    const view = (await gale.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === s.id);
    expect(view.joinAs).toBe('in');
    expect((await gale.call('POST', `/api/sessions/${s.id}/join`, {})).data).toEqual({ result: 'confirmed' });
    expect((await adminSession(ctx, s.id)).confirmedCount).toBe(6);
  });

  it('never lands on 5 or 7, even when everyone taps at once', async () => {
    for (let round = 0; round < 5; round++) {
      const ctx = await withSeventh(await setupGroup());
      const s = await firstSession(ctx);
      const phones = await Promise.all(['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'].map((n) => playerPhone(ctx, n)));
      await Promise.all(phones.map((p) => p.call('POST', `/api/sessions/${s.id}/join`, {})));
      const after = await adminSession(ctx, s.id);
      expect(after.confirmedCount).toBe(6);
      expect(after.waitlistCount).toBe(1);
    }
  });

  it('blocks a 7th confirmed player at the database level', async () => {
    const ctx = await withSeventh(await setupGroup());
    const s = await firstSession(ctx);
    const insert = ctx.app.db.raw.prepare(
      "INSERT INTO session_players (id, session_id, player_id, status, claimed_at, updated_at) VALUES (?, ?, ?, 'confirmed', '2026-01-01', '2026-01-01')",
    );
    ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].forEach((n, i) => insert.run(`row-${i}`, s.id, ctx.byName[n]));
    expect(() => insert.run('row-7', s.id, ctx.byName.Gale)).toThrow(/session_full/);
  });

  it('lets the organizer give spots up to 6, never more', async () => {
    const ctx = await withSeventh(await setupGroup());
    const s = await firstSession(ctx);
    const path = `/api/admin/sessions/${s.id}/roster`;
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
      expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName[name], action: 'confirm' })).status).toBe(200);
    }
    expect((await ctx.organizer.call('POST', path, { playerId: ctx.byName.Gale, action: 'confirm' })).status).toBe(409);
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

  it('really acts for the player, and logs that the organizer did it', async () => {
    const ctx = await setupGroup();
    const s = await firstSession(ctx);
    const as = { 'X-View-As': ctx.byName.Devon };
    expect((await ctx.organizer.call('POST', `/api/sessions/${s.id}/join`, {}, as)).data).toEqual({ result: 'confirmed' });
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(confirmedNames(dash.sessions.find((x: any) => x.id === s.id))).toEqual(['Devon']);
    expect(dash.audit[0]).toMatchObject({ action: 'as_player_join', actorLabel: 'organizer as Devon', details: { player: 'Devon', result: 'confirmed' } });
    await ctx.organizer.call('POST', `/api/sessions/${s.id}/withdraw`, {}, as);
    const log = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.audit;
    expect(log[0]).toMatchObject({ action: 'as_player_withdraw', actorLabel: 'organizer as Devon' });
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
