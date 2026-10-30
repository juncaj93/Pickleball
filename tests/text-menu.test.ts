import { describe, expect, it } from 'vitest';
import { smsHref } from '../shared/messages';
import { fillTexts, owedGames, reminderText, sessionTexts, unpaidPeople } from '../src/pages/admin/textMenu';
import { DAY, HOUR, playerPhone, PLAYER_NAMES, setupGroup, withoutIds } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const LINK = 'pickleball.juncaj.net';

/** A set-up group whose plain site address is pickleball.juncaj.net, like the live site. */
async function group() {
  const ctx = await setupGroup();
  ctx.app.env.SITE_URL = 'https://pickleball.juncaj.net';
  return ctx;
}
const ME = 'Alex';

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
const pay = async (ctx: Ctx, id: string, n: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[n], paid: true });
/** The Text menu for one game as it is right now. */
async function menu(ctx: Ctx, id: string) {
  const d = await dash(ctx);
  const s = d.sessions.find((x: any) => x.id === id);
  return { d, s, items: sessionTexts(d, s, Date.parse(d.now)) };
}
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const phoneOf = (ctx: Ctx, d: any, name: string) => d.players.find((p: any) => p.name === name).phone;

describe('the Text menu shows only the texts that fit', () => {
  it('2 in: Share and Need players (need 2), both to a group chat I pick', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Blair', 'Casey']);
    const { items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['share', 'need']);
    expect(items[0].body).toBe(`Pickleball Tue Nov 3, 8:00 PM. In or out here: ${LINK}`);
    expect(items[1].body).toBe(`Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? ${LINK}`);
    for (const i of items) expect([i.chat, i.phones, i.who]).toEqual([true, [], 'Group chat, you pick']);
  });
  it('3 in: Need players says need 1', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    const { items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['share', 'need']);
    expect(items[1].body).toBe(`Need 1 more for pickleball Tue Nov 3, 8:00 PM. In? ${LINK}`);
  });
  it('exactly 4 in: Share and Check-in, Check-in to the 4 saved numbers (never the organizer), Missing numbers named', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    const devon = (await dash(ctx)).players.find((p: any) => p.name === 'Devon');
    await ctx.organizer.call('PUT', `/api/admin/players/${devon.id}`, { name: 'Devon', phone: null, isRegular: true, isActive: true, canReceiveSubstituteInvites: true });
    const { d, items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['share', 'checkin']);
    const c = items[1];
    expect(c.chat).toBe(false);
    expect(c.phones).toEqual([phoneOf(ctx, d, 'Blair'), phoneOf(ctx, d, 'Casey')]);
    expect(c.missing).toEqual(['Devon']);
    expect(c.who).toBe('Everyone signed up');
    expect(c.body).toMatch(/^Pickleball (tomorrow|Tue Nov 3), 8:00 PM\. Can\'t make it\? Update here: pickleball\.juncaj\.net$/);
    // It opens one group text to those numbers.
    expect(smsHref(c.phones, c.body, true)).toContain('sms://open?addresses=');
  });
  it('Check-in words follow the time left: the night before, and tonight', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-11-02T14:00:00Z'); // Mon 9:00 AM
    expect((await menu(ctx, s.id)).items.find((i) => i.id === 'checkin')!.body).toBe(`Pickleball tomorrow, 8:00 PM. Can\'t make it? Update here: ${LINK}`);
    ctx.app.now = Date.parse('2026-11-03T14:00:00Z'); // Tue 9:00 AM
    expect((await menu(ctx, s.id)).items.find((i) => i.id === 'checkin')!.body).toBe(`Pickleball tonight, 8:00 PM. Can\'t make it? Update here: ${LINK}`);
  });
  it('Check-in goes to everyone signed up, the waitlist too, with the new words', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Emery waits
    ctx.app.now = Date.parse('2026-11-02T14:00:00Z'); // Mon 9:00 AM
    const { d, items } = await menu(ctx, s.id);
    const c = items.find((i) => i.id === 'checkin')!;
    expect(c.who).toBe('Everyone signed up');
    expect(c.phones.sort()).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Emery'].map((n) => phoneOf(ctx, d, n)).sort());
    expect(c.body).toBe(`Pickleball tomorrow, 8:00 PM. Can\'t make it? Update here: ${LINK}`);
  });
  it('under 4 in: no Check-in, Need players instead', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey']);
    expect(ids((await menu(ctx, s.id)).items)).toEqual(['share', 'need']);
  });
  it('5 in (not from 6): Share the game and the Check-in (4 or more in)', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Emery, action: 'confirm' });
    const { s: x, items } = await menu(ctx, s.id);
    expect(x.confirmedCount).toBe(5);
    expect(ids(items)).toEqual(['share', 'checkin']);
  });
  it('exactly 6 in by sign-ups: Check-in only (nobody was moved up from the waitlist)', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName[n], action: 'confirm' });
    for (const n of ['Emery', 'Frankie']) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName[n], action: 'confirm' });
    const { s: x, items } = await menu(ctx, s.id);
    expect(x.confirmedCount).toBe(6);
    expect(ids(items)).toEqual(['share', 'checkin']);
  });
  it('6 in by sign-ups, the 5th and 6th simply in: Share and the Check-in to all 6, no extra text', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    const { s: x, items } = await menu(ctx, s.id);
    expect(x.confirmedCount).toBe(6);
    expect(x.waitlistCount).toBe(0);
    expect(ids(items)).toEqual(['share', 'checkin']);
    expect(items[1].phones).toHaveLength(6);
    expect(x.roster.every((r: any) => r.promotionReason === null)).toBe(true);
  });
  it('at the max (6 here): the 7th waits, and the Check-in goes to them too', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } });
    await ctx.organizer.call('POST', '/api/admin/players', { name: 'Gale', phone: '(313) 555-0177' });
    ctx.byName.Gale = (await dash(ctx)).players.find((p: any) => p.name === 'Gale').id;
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [...PLAYER_NAMES, 'Gale']); // Gale waits
    const { d, s: x, items } = await menu(ctx, s.id);
    expect([x.confirmedCount, x.waitlistCount]).toEqual([6, 1]);
    expect(ids(items)).toEqual(['share', 'checkin']);
    expect(items[1].phones).toHaveLength(7);
    expect(items[1].phones).toContain(phoneOf(ctx, d, 'Gale'));
  });
  it('6 dropped to 5: still just Share and the Check-in (no Down to 5)', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, PLAYER_NAMES);
    await out(ctx, s.id, 'Frankie');
    const { s: x, items } = await menu(ctx, s.id);
    expect(x.confirmedCount).toBe(5);
    expect(ids(items)).toEqual(['share', 'checkin']);
    expect(items[1].phones).toHaveLength(5);
    for (const i of items) expect(i.body).not.toMatch(/Down to 5|4 or 6/);
  });
  it('a waitlist player moves in after a drop (above the max): "Spot opened" to that one player', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Emery waits
    expect(ids((await menu(ctx, s.id)).items)).toEqual(['share', 'checkin']);
    await out(ctx, s.id, 'Devon');
    const { d, items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['share', 'checkin', 'promoted']);
    const p = items[2];
    expect(p.label).toBe('Spot opened: Emery');
    expect(p.body).toBe(`A spot opened and you're in for pickleball Tue Nov 3, 8:00 PM. ${LINK}`);
    expect(p.phones).toEqual([phoneOf(ctx, d, 'Emery')]);
    expect(p.who).toBe('Emery · 1');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/told`, { playerId: ctx.byName.Emery });
    expect(ids((await menu(ctx, s.id)).items)).toEqual(['share', 'checkin']);
  });
  it('a canceled game: just Canceled, with the credit words, to everyone signed up and on the waitlist', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Emery waits
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    const { d, items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['canceled']);
    expect(items[0].body).toBe(`Pickleball Tue Nov 3 is canceled. If you paid, it's now your credit. You can request a cash out on the site. ${LINK}`);
    expect(items[0].phones).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Emery'].map((n) => phoneOf(ctx, d, n)));
  });
  it('after finalizing: the one Final price text to the group chat; nothing while the game is over but not finalized', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, PLAYER_NAMES);
    for (const n of PLAYER_NAMES) await pay(ctx, s.id, n);
    ctx.app.now = Date.parse(s.endsAt) + 5 * 60_000;
    expect((await menu(ctx, s.id)).items).toEqual([]);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    const { items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['final']);
    expect(items[0].label).toBe('Final price');
    expect(items[0].body).toBe(`Pickleball Tue, Nov 3 is final: 6 played, $9 each. If you paid $14, the extra $5 is now credit on your account. ${LINK}`);
    expect([items[0].chat, items[0].phones, items[0].who]).toEqual([true, [], 'Group chat, you pick']);
    // At 4 played there is no credit line. Days later the text is still offered.
    const t = await on(ctx, '2026-11-05');
    await join(ctx, t.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(t.endsAt) + 5 * 60_000;
    await ctx.organizer.call('POST', `/api/admin/sessions/${t.id}/finalize`, { everyone: true });
    ctx.app.now += 3 * DAY;
    expect((await menu(ctx, t.id)).items.map((i) => i.body)).toEqual([`Pickleball Thu, Nov 5 is final: 4 played, $14 each. ${LINK}`]);
    // A reopened game offers nothing again until it is finalized.
    await ctx.organizer.call('POST', `/api/admin/sessions/${t.id}/reopen`, {});
    expect((await menu(ctx, t.id)).items).toEqual([]);
  });
  it('a moved game: Moved (to everyone signed up and waiting) plus the usual ones', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: '2026-11-05T01:00:00.000Z', endsAt: '2026-11-05T03:00:00.000Z' })).status).toBeLessThan(300);
    const { d, items } = await menu(ctx, s.id);
    expect(ids(items)).toEqual(['moved', 'share', 'checkin']);
    expect(items[0].body).toBe(`Pickleball Tue Nov 3 is moved to Wed Nov 4, 8:00 PM. ${LINK}`);
    expect(items[0].phones).toHaveLength(5);
    expect(items[0].phones).toContain(phoneOf(ctx, d, 'Emery'));
  });
  it('no game that already started offers anything', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair']);
    ctx.app.now = Date.parse(s.startsAt) + HOUR;
    expect((await menu(ctx, s.id)).items).toEqual([]);
  });
  it('the cards that ask to fill a game use the same texts, with no "text me ASAP"', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Blair', 'Casey']);
    const d = await dash(ctx);
    const t = fillTexts(d, d.sessions.find((x: any) => x.id === s.id), Date.parse(d.now));
    expect(ids(t)).toEqual(['need']);
    for (const i of t) expect(i.body).not.toMatch(/ASAP|text me|\bsent\b/i);
  });
});

describe('payment reminders', () => {
  it('one unpaid player: their number and "you owe $14 for pickleball Tue Nov 3"', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 3 * HOUR;
    for (const n of ['Alex', 'Casey', 'Devon']) await pay(ctx, s.id, n);
    const d = await dash(ctx);
    const x = d.sessions.find((v: any) => v.id === s.id);
    expect(reminderText(d, ctx.byName.Blair, 'Blair', x)).toBe(`Hey Blair, you owe $14 for pickleball Tue Nov 3. Pay here: ${LINK}`);
    expect(unpaidPeople(d).count).toBe(1); // no "Remind all" for one
  });
  it('someone who owes for more than one game gets the total', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    const thu = await on(ctx, '2026-10-29');
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(thu.startsAt) - 3 * HOUR;
    const d = await dash(ctx);
    expect(owedGames(d, ctx.byName.Blair).map((g) => g.cents)).toEqual([1400, 1400]);
    expect(reminderText(d, ctx.byName.Blair, 'Blair', d.sessions.find((v: any) => v.id === thu.id))).toBe(`Hey Blair, you owe $28 for pickleball. Pay here: ${LINK}`);
  });
  it('two or more unpaid: "Remind all unpaid" goes to just those numbers, with Missing numbers named', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 3 * HOUR;
    await pay(ctx, s.id, 'Alex');
    const devon = (await dash(ctx)).players.find((p: any) => p.name === 'Devon');
    await ctx.organizer.call('PUT', `/api/admin/players/${devon.id}`, { name: 'Devon', phone: null, isRegular: true, isActive: true, canReceiveSubstituteInvites: true });
    const d = await dash(ctx);
    const u = unpaidPeople(d);
    expect(u.count).toBe(3);
    expect(u.phones).toEqual([phoneOf(ctx, d, 'Blair'), phoneOf(ctx, d, 'Casey')]);
    expect(u.missing).toEqual(['Devon']);
    expect(u.body).toBe(`Hey, looks like you haven't paid for pickleball yet. Pay here: ${LINK}`);
  });
  it("the organizer is never in the unpaid list, and a canceled game owes nothing", async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 3 * HOUR;
    let d = await dash(ctx);
    expect(unpaidPeople(d).count).toBe(3);
    expect(owedGames(d, ctx.byName[ME])).toEqual([]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    d = await dash(ctx);
    expect(unpaidPeople(d).count).toBe(0);
  });
});

describe('the unpaid card on the player screen stays until they pay', () => {
  const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
  it('shows from 8:00 AM on game day and stays through the night and the following days, including after the game', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-10-27T11:59:00Z'); // 7:59 AM
    expect((await card(ctx, 'Blair')).payDue).toEqual([]);
    for (const at of ['2026-10-27T12:00:00Z', '2026-10-27T23:00:00Z', '2026-10-28T13:00:00Z', '2026-10-30T13:00:00Z', '2026-11-20T13:00:00Z']) {
      ctx.app.now = Date.parse(at);
      expect((await card(ctx, 'Blair')).payDue.map((o: any) => [o.sessionId, o.amountCents]), at).toEqual([[s.id, 1400]]);
    }
    await pay(ctx, s.id, 'Blair');
    expect((await card(ctx, 'Blair')).payDue).toEqual([]);
  });
  it('is hidden for a canceled game, for the organizer, and for anyone who owes nothing', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ME });
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, [ME, 'Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, 'Casey');
    ctx.app.now = Date.parse('2026-10-28T13:00:00Z');
    expect((await card(ctx, ME)).payDue).toEqual([]); // organizer
    expect((await card(ctx, 'Casey')).payDue).toEqual([]); // paid
    expect((await card(ctx, 'Emery')).payDue).toEqual([]); // not playing
    expect((await card(ctx, 'Blair')).payDue).toHaveLength(1);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await card(ctx, 'Blair')).payDue).toEqual([]); // canceled
  });
  it('someone who owes for several games gets one list for the one card; Pay, I paid and Didn’t pay work as before', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    const thu = await on(ctx, '2026-10-29');
    const nov3 = await on(ctx, '2026-11-03');
    for (const s of [tue, thu, nov3]) await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse('2026-10-31T13:00:00Z'); // Tue and Thu are past, Nov 3 is ahead
    const g = await card(ctx, 'Blair');
    expect(g.payDue.map((o: any) => o.sessionId)).toEqual([tue.id, thu.id]);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${tue.id}/paid`, { paid: true })).status).toBe(200);
    expect((await card(ctx, 'Blair')).payDue.map((o: any) => o.sessionId)).toEqual([thu.id]);
    expect((await blair.call('POST', `/api/sessions/${tue.id}/paid`, { paid: false })).status).toBe(200);
    expect((await card(ctx, 'Blair')).payDue).toHaveLength(2);
  });
  it('never carries court costs, other people’s money or phone numbers', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, { courtCostCents: 4567 });
    ctx.app.now = Date.parse('2026-10-28T13:00:00Z');
    const text = withoutIds((await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).text);
    expect(text).not.toMatch(/4567|45\.67|courtCost|\(313\)|\+1313|555-01/);
    expect(DAY).toBeGreaterThan(0);
  });
});
