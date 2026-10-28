import { describe, expect, it } from 'vitest';
import {
  checkInOpensMs,
  daysSince,
  pruneTapped,
  readTapped,
  type Suggestion,
  suggestions,
  visibleSuggestions,
  writeTapped,
} from '../src/pages/admin/suggestions';
import { smsHref } from '../shared/messages';
import { buildTodo, homeBadgeCount } from '../src/pages/admin/todo';
import { DAY, HOUR, playerPhone, PLAYER_NAMES, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const LINK = 'pickleball.juncaj.net';

async function group() {
  const ctx = await setupGroup();
  ctx.app.env.SITE_URL = 'https://pickleball.juncaj.net';
  return ctx;
}
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
const at = (ctx: Ctx, iso: string) => (ctx.app.now = Date.parse(iso));
/** The suggestions right now, as the organizer's Home would work them out. */
async function now(ctx: Ctx) {
  const d = await dash(ctx);
  return { d, all: suggestions(d, Date.parse(d.now)) };
}
const kinds = (list: Suggestion[]) => list.map((c) => c.kind);
const phoneOf = (d: any, name: string) => d.players.find((p: any) => p.name === name).phone;

describe('Need players: fewer than 4 in, game within 48 hours', () => {
  it('shows at 47 hours before and not at 49 hours', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03'); // Tue 8:00 PM EST
    await join(ctx, s.id, ['Alex', 'Blair']);
    ctx.app.now = Date.parse(s.startsAt) - 49 * HOUR;
    expect(kinds((await now(ctx)).all).filter((k) => k === 'need')).toEqual([]);
    ctx.app.now = Date.parse(s.startsAt) - 48 * HOUR;
    expect(kinds((await now(ctx)).all)).toContain('need');
    ctx.app.now = Date.parse(s.startsAt) - 47 * HOUR;
    const { all } = await now(ctx);
    const c = all.find((x) => x.kind === 'need' && x.sessionId === s.id)!;
    expect(c).toBeDefined();
    // Group chat, no numbers, the Need players words with the plain link and the day word.
    expect(c.chat).toBe(true);
    expect(c.phones).toEqual([]);
    expect(c.who).toBe('Group chat');
    expect(c.body).toBe(`Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? ${LINK}`);
    expect(smsHref(null, c.body, true)).toBe(`sms:&body=${encodeURIComponent(c.body)}`);
  });

  it('uses "tomorrow" and "tonight" in its words, and is gone with 4 in', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey']);
    ctx.app.now = Date.parse(s.startsAt) - 30 * HOUR; // Mon 2:00 PM
    expect((await now(ctx)).all.find((x) => x.kind === 'need')!.body).toBe(`Need 1 more for pickleball tomorrow, 8:00 PM. In? ${LINK}`);
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR;
    expect((await now(ctx)).all.find((x) => x.kind === 'need')!.body).toBe(`Need 1 more for pickleball tonight, 8:00 PM. In? ${LINK}`);
    await join(ctx, s.id, ['Devon']);
    expect(kinds((await now(ctx)).all)).not.toContain('need');
  });

  it('is not shown for a game that is more than 48 hours away, canceled, started, or past', async () => {
    const ctx = await group();
    const a = await on(ctx, '2026-11-03');
    const b = await on(ctx, '2026-11-05');
    ctx.app.now = Date.parse(a.startsAt) - 30 * HOUR;
    let { all } = await now(ctx);
    expect(all.some((c) => c.sessionId === b.id)).toBe(false); // Thursday is 78 hours out
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/decision`, { decision: 'cancel', confirm: true });
    all = (await now(ctx)).all;
    expect(all.some((c) => c.sessionId === a.id)).toBe(false);
    await ctx.organizer.call('POST', `/api/admin/sessions/${a.id}/decision`, { decision: 'reopen' });
    ctx.app.now = Date.parse(a.startsAt) + HOUR; // playing now
    expect((await now(ctx)).all.some((c) => c.sessionId === a.id)).toBe(false);
    ctx.app.now = Date.parse(a.endsAt) + HOUR; // over
    expect((await now(ctx)).all.some((c) => c.sessionId === a.id && c.kind !== 'pay')).toBe(false);
  });
});

describe('Check-in: exactly 4 or 6 in, from 6:00 PM the day before', () => {
  it('opens at 6:00 PM the day before, not at 5:59 PM, in Eastern time', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03'); // Tue 8:00 PM EST
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect(new Date(checkInOpensMs(s.startsAt, TZ)).toISOString()).toBe('2026-11-02T23:00:00.000Z'); // Mon 6:00 PM EST
    at(ctx, '2026-11-02T22:59:00Z'); // Mon 5:59 PM
    expect(kinds((await now(ctx)).all)).not.toContain('checkin');
    at(ctx, '2026-11-02T23:00:00Z'); // Mon 6:00 PM
    const { d, all } = await now(ctx);
    const c = all.find((x) => x.kind === 'checkin')!;
    expect(c).toBeDefined();
    expect(c.body).toBe(`Pickleball tomorrow, 8:00 PM. Still in? Update here: ${LINK}`);
    // To the players who are in (numbers), not the waitlist.
    expect(c.chat).toBe(false);
    expect(c.who).toBe('4 players');
    expect(c.phones.sort()).toEqual(['Alex', 'Blair', 'Casey', 'Devon'].map((n) => phoneOf(d, n)).sort());
    expect(c.missing).toEqual([]);
    // Still there on game day (words change to tonight), until the game starts.
    at(ctx, '2026-11-03T20:00:00Z');
    expect((await now(ctx)).all.find((x) => x.kind === 'checkin')!.body).toBe(`Pickleball tonight, 8:00 PM. Still in? Update here: ${LINK}`);
    at(ctx, '2026-11-04T01:00:00Z');
    expect(kinds((await now(ctx)).all)).not.toContain('checkin');
  });

  it('is 6:00 PM local on the calendar day before, also around the Sun Nov 1 clock change', () => {
    expect(new Date(checkInOpensMs('2026-11-08T01:00:00.000Z', TZ)).toISOString()).toBe('2026-11-06T23:00:00.000Z'); // Sat Nov 7 8 PM EST game: Fri Nov 6, 6 PM EST
    // Mon Nov 2 8:00 PM EST game: the day before is Sun Nov 1 (a 25-hour day); 6:00 PM EST is 23:00Z.
    expect(new Date(checkInOpensMs('2026-11-03T01:00:00.000Z', TZ)).toISOString()).toBe('2026-11-01T23:00:00.000Z');
    // Sun Nov 1 game at 8 PM EST: the day before is Sat Oct 31, 6:00 PM EDT is 22:00Z.
    expect(new Date(checkInOpensMs('2026-11-02T01:00:00.000Z', TZ)).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });

  it('is for exactly 4 or exactly 6 (not 3 or 5), and says who is missing a number', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Emery, action: 'confirm' }); // 5 in
    at(ctx, '2026-11-03T14:00:00Z');
    expect(kinds((await now(ctx)).all)).not.toContain('checkin');
    await out(ctx, s.id, 'Emery'); // 4
    expect(kinds((await now(ctx)).all)).toContain('checkin');
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Emery, action: 'confirm' });
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Frankie, action: 'confirm' }); // 6
    const c = (await now(ctx)).all.find((x) => x.kind === 'checkin')!;
    expect(c.who).toBe('6 players');
    // A number removed shows up as missing.
    const d = await dash(ctx);
    const blair = d.players.find((p: any) => p.name === 'Blair');
    await ctx.organizer.call('PUT', `/api/admin/players/${blair.id}`, { name: 'Blair', phone: null, isRegular: true, isActive: true, canReceiveSubstituteInvites: true, usualDays: [] });
    const c2 = (await now(ctx)).all.find((x) => x.kind === 'checkin')!;
    expect(c2.missing).toEqual(['Blair']);
    expect(c2.phones).toHaveLength(5);
  });
});

describe('Down to 5, Now 6, Spot opened: right when it happens, while it lasts', () => {
  it('Down to 5 shows after 6 drops to 5, to the group chat, and goes when it is 4 or 6 again', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-05');
    await join(ctx, s.id, PLAYER_NAMES);
    ctx.app.now = Date.parse(s.startsAt) - 100 * HOUR; // far out: no need or check-in
    expect(kinds((await now(ctx)).all)).toEqual(['now6']); // the two who moved in to make 6 are still to be told
    await out(ctx, s.id, 'Frankie');
    const c = (await now(ctx)).all.find((x) => x.kind === 'down5')!;
    expect(c.chat).toBe(true);
    expect(c.body).toBe(`Down to 5 for pickleball Thu Nov 5. Need 1 more or 1 out to make 4 or 6. ${LINK}`);
    await out(ctx, s.id, 'Emery');
    expect(kinds((await now(ctx)).all)).not.toContain('down5');
  });

  it('Now 6 goes to the 2 extra players; Spot opened goes to the one who moved in', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-05');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']); // Emery and Frankie wait, then move in together
    ctx.app.now = Date.parse(s.startsAt) - 100 * HOUR;
    const d = await dash(ctx);
    const c = suggestions(d, Date.parse(d.now)).find((x) => x.kind === 'now6')!;
    expect(c).toBeDefined();
    expect(c.who).toBe('2 players');
    expect(c.phones.sort()).toEqual([phoneOf(d, 'Emery'), phoneOf(d, 'Frankie')].sort());
    expect(c.body).toBe(`Good news, we have 6 for pickleball Thu Nov 5, 8:00 PM. You're both in. Can't make it? Update here: ${LINK}`);
    // Spot opened: a 4-game where the waitlist moves someone in after a drop.
    const t = await on(ctx, '2026-11-10');
    await join(ctx, t.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Emery waits
    await out(ctx, t.id, 'Devon'); // Emery moves in
    const d2 = await dash(ctx);
    const p = suggestions(d2, Date.parse(d2.now)).find((x) => x.kind === 'promoted' && x.sessionId === t.id)!;
    expect(p).toBeDefined();
    expect(p.who).toBe('1 player (Emery)');
    expect(p.phones).toEqual([phoneOf(d2, 'Emery')]);
    expect(p.body).toBe(`A spot opened and you're in for pickleball Tue Nov 10, 8:00 PM. ${LINK}`);
  });
});

describe('Payment reminder: a played game, someone unpaid, 7 or more days ago', () => {
  async function played(ctx: Ctx, names: string[]) {
    const s = await on(ctx, '2026-10-29'); // Thu Oct 29, 8:00 PM EDT
    await join(ctx, s.id, names);
    return s;
  }
  it('shows on the 7th calendar day, not the 6th', async () => {
    const ctx = await group();
    const s = await played(ctx, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect(daysSince(s.startsAt, Date.parse('2026-11-05T04:59:00Z'), TZ)).toBe(6); // Wed Nov 4 11:59 PM EST
    expect(daysSince(s.startsAt, Date.parse('2026-11-05T05:00:00Z'), TZ)).toBe(7); // Thu Nov 5 12:00 AM EST
    at(ctx, '2026-11-05T04:59:00Z');
    expect(kinds((await now(ctx)).all)).not.toContain('pay');
    at(ctx, '2026-11-05T05:00:00Z');
    expect(kinds((await now(ctx)).all).filter((k) => k === 'pay')).toHaveLength(1);
  });
  it('one unpaid player: a one-person text to them; two or more: the Remind all unpaid text', async () => {
    const ctx = await group();
    const s = await played(ctx, ['Alex', 'Blair', 'Casey', 'Devon']);
    for (const n of ['Alex', 'Blair', 'Casey']) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true });
    at(ctx, '2026-11-06T14:00:00Z');
    let { d, all } = await now(ctx);
    let c = all.find((x) => x.kind === 'pay')!;
    expect(c.who).toBe('1 player (Devon)');
    expect(c.phones).toEqual([phoneOf(d, 'Devon')]);
    expect(c.body).toBe(`Hey Devon, you owe $14 for pickleball Thu Oct 29. Pay here: ${LINK}`); // past games keep their dates
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: false });
    ({ d, all } = await now(ctx));
    c = all.find((x) => x.kind === 'pay')!;
    expect(c.who).toBe('2 players');
    expect(c.phones.sort()).toEqual([phoneOf(d, 'Casey'), phoneOf(d, 'Devon')].sort());
    expect(c.body).toBe(`Hey, looks like you haven't paid for pickleball yet. Pay here: ${LINK}`);
    // Everyone paid: nothing.
    for (const n of ['Casey', 'Devon']) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[n], paid: true });
    expect(kinds((await now(ctx)).all)).not.toContain('pay');
  });
  it('never for a canceled game, and never for the organizer', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    const s = await played(ctx, ['Alex', 'Blair', 'Casey', 'Devon']);
    at(ctx, '2026-11-06T14:00:00Z');
    const { all } = await now(ctx);
    expect(all.find((x) => x.kind === 'pay')!.who).toBe('3 players'); // not Alex
    void s;
    const t = await on(ctx, '2026-10-27');
    await join(ctx, t.id, ['Blair']);
    ctx.app.now = Date.parse(t.startsAt) - 5 * HOUR;
    await ctx.organizer.call('POST', `/api/admin/sessions/${t.id}/decision`, { decision: 'cancel', confirm: true });
    ctx.app.now = Date.parse('2026-11-06T14:00:00Z');
    expect((await now(ctx)).all.some((c) => c.sessionId === t.id)).toBe(false);
  });
});

describe('what stays off the cards', () => {
  it('Share the game and Canceled or moved are never cards', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    ctx.app.now = Date.parse(s.startsAt) - 100 * HOUR;
    expect(kinds((await now(ctx)).all)).toEqual(['now6']); // 6 in, far out: only the two who moved in
    await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: new Date(Date.parse(s.startsAt) + 2 * DAY).toISOString(), endsAt: new Date(Date.parse(s.endsAt) + 2 * DAY).toISOString() });
    expect((await now(ctx)).all.filter((c) => c.sessionId === s.id && !['checkin', 'now6'].includes(c.kind))).toEqual([]);
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await now(ctx)).all.filter((c) => c.sessionId === s.id)).toEqual([]);
  });
  it('nothing needs a text: no cards, and the Home badge is unchanged by them', async () => {
    const ctx = await group();
    at(ctx, '2026-10-31T16:00:00Z'); // Sat noon: the next game is more than 48 hours away
    const { d, all } = await now(ctx);
    expect(all).toEqual([]);
    expect(homeBadgeCount(d)).toBe(buildTodo(d).length + d.sessions.filter((s: any) => s.state.flags.bookingPromptDue).length);
  });
  it('no text says it was sent', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex']);
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    for (const c of (await now(ctx)).all) expect(c.body).not.toMatch(/\bsent\b/i);
  });
});

describe('one card per game, max two shown, hidden after the tap until the situation changes', () => {
  const card = (kind: Suggestion['kind'], sessionId: string, token: string, extra: Partial<Suggestion> = {}): Suggestion => ({
    key: `${kind}:${sessionId}`, kind, sessionId, token, when: 'x', body: 'b', who: 'Group chat', chat: true, phones: [], missing: [], ...extra,
  });
  it('shows the most pressing text for a game; once it is tapped the next one for that game shows', () => {
    const all = [card('promoted', 'g1', 'A'), card('need', 'g1', '3'), card('need', 'g2', '2')];
    expect(visibleSuggestions(all, {}).map((c) => c.key)).toEqual(['promoted:g1', 'need:g2']);
    expect(visibleSuggestions(all, { 'promoted:g1': 'A' }).map((c) => c.key)).toEqual(['need:g1', 'need:g2']);
  });
  it('a tapped card stays hidden for the same situation and comes back when it changes', () => {
    const tapped = { 'need:g1': '3' };
    expect(visibleSuggestions([card('need', 'g1', '3')], tapped)).toEqual([]);
    expect(visibleSuggestions([card('need', 'g1', '2')], tapped).map((c) => c.token)).toEqual(['2']); // a player left: 2 in
  });
  it('a situation that went away and came back is suggested again', () => {
    const tapped = { 'need:g1': '3' };
    const pruned = pruneTapped([card('need', 'g2', '1')], tapped); // g1 no longer needs a text
    expect(pruned).toEqual({});
    expect(visibleSuggestions([card('need', 'g1', '3')], pruned)).toHaveLength(1);
    // Still the same situation: the tap is remembered.
    expect(pruneTapped([card('need', 'g1', '3')], tapped)).toEqual(tapped);
  });
  it('is remembered on this device only, and survives storage that is off or garbled', () => {
    const store = new Map<string, string>();
    writeTapped((k, v) => store.set(k, v), { 'need:g1': '3' });
    expect(readTapped((k) => store.get(k) ?? null)).toEqual({ 'need:g1': '3' });
    expect(readTapped(() => '{not json')).toEqual({});
    expect(readTapped(() => '[1,2]')).toEqual({});
    expect(readTapped(() => null)).toEqual({});
    expect(readTapped(() => { throw new Error('blocked'); })).toEqual({});
    expect(() => writeTapped(() => { throw new Error('blocked'); }, { a: 'b' })).not.toThrow();
  });
});

describe('only the organizer', () => {
  it('the player screens and View as carry no suggestion, number or organizer-only field', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair']);
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    expect(kinds((await now(ctx)).all)).toContain('need');
    for (const n of PLAYER_NAMES) {
      const t = (await (await playerPhone(ctx, n)).call('GET', '/api/group')).text;
      expect(t, n).not.toMatch(/555-01|pb_text_tapped|"phone"/i);
      const v = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[n] })).text;
      expect(v, n).not.toMatch(/555-01|pb_text_tapped/i);
      expect((await (await playerPhone(ctx, n)).call('GET', '/api/admin/dashboard')).status).toBe(401);
    }
  });
});
