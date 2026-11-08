// Zip 15: Second Chance, same-day games, the two Telegrams, Venmo Request (SECOND_CHANCE, ships OFF).
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, playerPhone, sentText, setupGroup, TestApp } from './harness';
import {
  duePing,
  pickTimes,
  pingInMessage,
  pingPaidMessage,
  reopenText,
  sameDayText,
  SC,
  SECOND_CHANCE,
  SECOND_CHANCE_TEST,
  secondChanceCards,
  textTime,
  unpaidText,
  type ScGame,
} from '../shared/secondChance';
import { isAdminPage, linkText, ourAddress } from '../server/telegram-links';
import { COURTRESERVE_BOOKING_URL } from '../shared/settings';

const TZ = 'America/Detroit';
const ON = { [SECOND_CHANCE.header]: 'on' };

async function world(env: Record<string, unknown> = {}) {
  const app = new TestApp();
  const sent: string[] = [];
  const all: string[] = [];
  Object.assign(app.env, {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: '12345',
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      // The older alerts ("has 4 now, it's on" for a booked game) go to the same chat; these tests count only Zip 15's two.
      const text = sentText(JSON.parse(String(init.body)));
      all.push(text);
      if (/ paid/.test(text)) sent.push(text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
    ...env,
  });
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return { ...w, sent, all };
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = ON) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const tue = async (w: W) => (await dash(w, {})).sessions.find((s: any) => s.startsAt === '2026-10-28T00:00:00.000Z');
const join = async (w: W, name: string, id: string) => {
  const r = await (await playerPhone(w, name)).call('POST', `/api/sessions/${id}/join`, {});
  await w.app.settle();
  return r;
};
const markPaid = async (w: W, id: string, name: string) => {
  const r = await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName[name], paid: true });
  await w.app.settle();
  return r;
};
const act = (w: W, id: string, body: Record<string, unknown>, headers: Record<string, string> = ON) => w.organizer.call('POST', `/api/admin/sessions/${id}/second-chance`, body, headers);
const switchOn = (w: W) => w.organizer.call('PUT', '/api/admin/second-chance-switch', { on: true });
const pot = async (w: W, name: string) => ((await dash(w, {})).creditLedger.find((p: any) => p.playerId === w.byName[name])?.balanceCents ?? 0) as number;

/** Tue Oct 27, 8:00 PM: Alex (organizer), Blair and Casey in; Blair paid $14; canceled Monday 9:00 PM (the night before). Now: Tuesday noon. */
async function canceledWithThree(w: W, extra: string[] = []) {
  const s = await tue(w);
  await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
  for (const n of ['Blair', 'Casey', ...extra]) await join(w, n, s.id);
  await markPaid(w, s.id, 'Blair');
  w.app.now = Date.parse('2026-10-27T01:00:00Z'); // Mon Oct 26, 9:00 PM Eastern
  const c = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
  expect(c.status).toBe(200);
  w.app.now = Date.parse('2026-10-27T16:00:00Z'); // Tue Oct 27, 12:00 PM Eastern
  return s;
}

describe('the rules (shared/secondChance.ts)', () => {
  const base: ScGame = {
    id: 'g1',
    startsAt: '2026-11-12T00:30:00.000Z', // Wed Nov 11, 7:30 PM EST
    endsAt: '2026-11-12T02:30:00.000Z',
    canceled: true,
    booked: false,
    canceledAt: '2026-11-11T02:00:00.000Z', // Tue Nov 10, 9:00 PM EST: the night before
    canceledBy: 'organizer',
    createdAt: '2026-10-01T00:00:00.000Z',
    extra: false,
    inCount: 3,
    paidCount: 1,
    unpaid: [],
    marks: new Set(),
    reopenedFrom: null,
  };
  const noon = Date.parse('2026-11-11T17:00:00.000Z');
  it('exactly 3 in, canceled the night before: step 1, then 2 after Book a court; 2 in, 4 in, a same-day cancel, booked, fee kept, dismissed: nothing', () => {
    expect(secondChanceCards([base], noon, TZ, 'site')).toMatchObject([{ kind: 'chance', step: 1 }]);
    expect(secondChanceCards([{ ...base, marks: new Set([SC.booking]) }], noon, TZ, 'site')).toMatchObject([{ kind: 'chance', step: 2 }]);
    for (const g of [
      { ...base, inCount: 2 },
      { ...base, inCount: 4 },
      { ...base, canceledAt: '2026-11-11T14:00:00.000Z' }, // the morning of
      { ...base, canceledAt: '2026-11-10T02:00:00.000Z' }, // two nights before
      { ...base, booked: true },
      { ...base, canceledBy: 'organizer_fee_kept' },
      { ...base, marks: new Set([SC.dismissed]) },
    ])
      expect(secondChanceCards([g], noon, TZ, 'site')).toEqual([]);
    // Not today, or already started: nothing.
    expect(secondChanceCards([base], noon - DAY, TZ, 'site')).toEqual([]);
    expect(secondChanceCards([base], Date.parse(base.startsAt) + 60_000, TZ, 'site')).toEqual([]);
  });
  it('after reopen: step 3, step 4 at 4 in AND 4 paid, cutoff 2 hours before when short; booked: gone', () => {
    const open = { ...base, canceled: false, marks: new Set([SC.reopened]), reopenedFrom: base.startsAt };
    expect(secondChanceCards([open], noon, TZ, 'site')).toMatchObject([{ kind: 'open', origin: 'reopened', step: 3 }]);
    expect(secondChanceCards([{ ...open, inCount: 4, paidCount: 3 }], noon, TZ, 'site')).toMatchObject([{ step: 3 }]);
    expect(secondChanceCards([{ ...open, inCount: 4, paidCount: 4 }], noon, TZ, 'site')).toMatchObject([{ step: 4 }]);
    expect(secondChanceCards([{ ...open, inCount: 6, paidCount: 4 }], noon, TZ, 'site')).toMatchObject([{ step: 4 }]);
    const late = Date.parse(base.startsAt) - 2 * HOUR;
    expect(secondChanceCards([open], late - 60_000, TZ, 'site')).toMatchObject([{ step: 3 }]);
    expect(secondChanceCards([open], late, TZ, 'site')).toMatchObject([{ step: 'cutoff' }]);
    expect(secondChanceCards([{ ...open, booked: true }], noon, TZ, 'site')).toEqual([]);
  });
  it('same-day add: a game made on its own day; a normal game (made earlier) gets no card', () => {
    const add = { ...base, canceled: false, canceledAt: null, inCount: 1, createdAt: '2026-11-11T15:00:00.000Z', extra: true };
    const [c] = secondChanceCards([add], noon, TZ, 'pickleball.juncaj.net');
    expect(c).toMatchObject({ kind: 'open', origin: 'sameday', step: 3, inCount: 1 });
    expect(c.kind === 'open' && c.groupText).toBe("Hey guys, anyone want to play tonight at 7:30? I added it to the site. If 4 sign up and pay, I'll book a court.\n\npickleball.juncaj.net");
    expect(secondChanceCards([{ ...add, createdAt: '2026-11-01T15:00:00.000Z' }], noon, TZ, 'site')).toEqual([]);
    // A regular game the site made that same day (first session date set to today, new usual days): not a same-day add.
    expect(secondChanceCards([{ ...add, extra: false }], noon, TZ, 'site')).toEqual([]);
  });
  it('TEXT 1 and TEXT 2, exactly, with the line breaks and the site time style', () => {
    expect(reopenText(base.startsAt, base.startsAt, TZ, noon, '[link]')).toBe(
      "Hey guys, we canceled to avoid fees since we were down 1. A few courts are open tonight at 7:30, so I reopened signups.\n\nIf 4 sign up and pay, I'll book a court for tonight.\n\nAlready paid for the canceled game? Tap Use Credit.\n\n[link]",
    );
    const eight = '2026-11-12T01:00:00.000Z';
    expect(reopenText(eight, base.startsAt, TZ, noon, '[link]')).toBe(
      "Hey guys, we canceled to avoid fees since we were down 1. A few courts are open tonight at 8:00 (instead of 7:30), so I reopened signups for 8:00.\n\nIf 4 sign up and pay, I'll book a court for tonight.\n\nAlready paid for the canceled game? Tap Use Credit.\n\n[link]",
    );
    expect(sameDayText(eight, TZ, noon, '[link]')).toBe("Hey guys, anyone want to play tonight at 8:00? I added it to the site. If 4 sign up and pay, I'll book a court.\n\n[link]");
    expect(unpaidText(base.startsAt, 4, TZ, noon, '[link]')).toBe("Hey, we have 4 in for tonight at 7:30. Please pay on the site and I'll book the court.\n\n[link]");
    expect(textTime(base.startsAt, TZ)).toBe('7:30');
  });
  it('the Telegrams: wording, time always in it, phone-less players named', () => {
    const unpaid = [
      { playerId: 'a', name: 'Joe', owesCents: 1400, phone: '313-555-0101' },
      { playerId: 'b', name: 'Nathan', owesCents: 1400, phone: null },
    ];
    expect(pingInMessage(base.startsAt, 4, 2, unpaid, TZ, noon, 'https://x/admin?unpaid=1')).toBe(
      "Tonight 7:30 PM: 4 in, 2 of 4 paid.\nText the 1 who hasn't paid: https://x/admin?unpaid=1\nNo phone saved for Nathan.",
    );
    expect(pingInMessage(base.startsAt, 4, 2, [unpaid[0], { ...unpaid[0], name: 'Sam' }], TZ, noon, 'L')).toContain("Text the 2 who haven't paid: L");
    expect(pingPaidMessage(base.startsAt, 4, 4, TZ, noon, COURTRESERVE_BOOKING_URL)).toBe(`4 paid for tonight 7:30 PM. Book it now: ${COURTRESERVE_BOOKING_URL}`);
    expect(pingPaidMessage(base.startsAt, 6, 4, TZ, noon, 'B')).toBe('4 paid, 6 in for tonight 7:30 PM. Book it now: B');
  });
  it('which Telegram is due: 1 at 4 in not all paid, 2 at 4 paid, each once, 1 never after 2; booked or canceled: none', () => {
    const g = { startsAt: base.startsAt, canceled: false, booked: false, inCount: 4, paidCount: 2 };
    const none = { in: false, paid: false };
    expect(duePing({ ...g, inCount: 3 }, none, noon, TZ)).toBeNull();
    expect(duePing(g, none, noon, TZ)).toBe('in');
    expect(duePing(g, { in: true, paid: false }, noon, TZ)).toBeNull();
    expect(duePing({ ...g, paidCount: 4 }, none, noon, TZ)).toBe('paid'); // 4 paid before 4 in was ever seen: only Telegram 2
    expect(duePing({ ...g, paidCount: 4 }, { in: true, paid: true }, noon, TZ)).toBeNull();
    expect(duePing({ ...g, paidCount: 3 }, { in: false, paid: true }, noon, TZ)).toBeNull(); // someone unmarked after 2: no Telegram 1
    expect(duePing({ ...g, booked: true }, none, noon, TZ)).toBeNull();
    expect(duePing({ ...g, canceled: true }, none, noon, TZ)).toBeNull();
  });
  it('step 2 times: half hours from 4:00 to 9:30 PM still ahead, plus the game time', () => {
    const t = pickTimes(base.startsAt, TZ, noon);
    expect(t[0]).toBe(16 * 60);
    expect(t.at(-1)).toBe(21 * 60 + 30);
    expect(t).toContain(19 * 60 + 30);
    expect(pickTimes(base.startsAt, TZ, Date.parse('2026-11-11T23:10:00.000Z')) /* 6:10 PM */[0]).toBe(18 * 60 + 30);
  });
  it('Telegram 1 link: only the exact /admin?unpaid=<game id> address becomes a link; the plain /admin stays plain words', () => {
    const site = 'https://pickleball.juncaj.net';
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const ok = ourAddress(site, [COURTRESERVE_BOOKING_URL]);
    expect(isAdminPage(`${site}/admin`)).toBe(true);
    expect(isAdminPage(`${site}/admin?unpaid=${id}`)).toBe(false);
    expect(ok(`${site}/admin?unpaid=${id}`)).toBe(true);
    expect(ok(`${site}/admin?unpaid=${id}&x=1`)).toBe(false);
    expect(ok(`https://evil.example/admin?unpaid=${id}`)).toBe(false);
    const linked = linkText(`Tonight 7:30 PM: 4 in, 2 of 4 paid.\nText the 2 who haven't paid: ${site}/admin?unpaid=${id}`, isAdminPage, ok);
    expect(linked.text).toBe("Tonight 7:30 PM: 4 in, 2 of 4 paid.\nText the 2 who haven't paid");
    expect(linked.entities).toHaveLength(1);
  });
});

describe('SECOND_CHANCE ships off: every answer exactly as before', () => {
  it('off: no Second Chance in the dashboard, the card taps answer Not found, and no Telegram goes', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    const d = await dash(w, {});
    expect(d.secondChance).toBeUndefined();
    expect(d.secondChanceForAll).toBeUndefined();
    expect((await act(w, s.id, { action: 'booking' }, {})).status).toBe(404);
    expect(w.sent).toEqual([]);
  });
  it('the private link turns it on for one phone (cards), but never sends a Telegram; the kill switch beats both', async () => {
    const w = await world();
    const s = await canceledWithThree(w);
    expect((await dash(w)).secondChance.cards).toMatchObject([{ kind: 'chance', step: 1, sessionId: s.id }]);
    const k = await world({ SECOND_CHANCE: 'off' });
    await canceledWithThree(k);
    await switchOn(k);
    expect((await dash(k)).secondChance).toBeUndefined();
  });
});

describe('Second Chance from start to booked (the live flow, with the real money rules)', () => {
  it('reopen at a new time: the same game, its people still in, credit applies to the cent, TEXT 2, then Telegrams 1 and 2 once each', async () => {
    const w = await world();
    await switchOn(w);
    const s = await canceledWithThree(w);
    expect(await pot(w, 'Blair')).toBe(1400); // the cancel turned Blair's $14 into credit
    // Step 1 -> 2 -> reopen at 8:30 PM (the game was 8:00 PM).
    expect((await dash(w)).secondChance.cards).toMatchObject([{ kind: 'chance', step: 1 }]);
    expect((await act(w, s.id, { action: 'booking' })).status).toBe(200);
    expect((await dash(w)).secondChance.cards).toMatchObject([{ kind: 'chance', step: 2 }]);
    const r = await act(w, s.id, { action: 'reopen', minutes: 20 * 60 + 30 });
    expect(r.status).toBe(200);
    await w.app.settle();
    const after = (await dash(w)).sessions.find((x: any) => x.id === s.id);
    expect(after.status).not.toBe('canceled');
    expect(after.startsAt).toBe('2026-10-28T00:30:00.000Z'); // 8:30 PM EDT, the same game row
    expect(after.confirmedCount).toBe(3);
    const [card] = (await dash(w)).secondChance.cards;
    expect(card).toMatchObject({ kind: 'open', origin: 'reopened', step: 3, inCount: 3, paidCount: 1 }); // Alex counts as covered
    expect(card.groupText).toContain('open tonight at 8:30 (instead of 8:00), so I reopened signups for 8:30.');
    // Blair owes again and her credit pays it exactly: $14 seat, $14 pot -> $0 pot, paid.
    const blair = await playerPhone(w, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${s.id}/use-credit`, {})).status).toBe(200);
    await w.app.settle();
    expect(await pot(w, 'Blair')).toBe(0);
    const seat = w.app.db.raw.prepare('SELECT payment_status, payment_amount_cents FROM session_players WHERE session_id = ? AND player_id = ?').get(s.id, w.byName.Blair) as any;
    expect(seat).toEqual({ payment_status: 'paid', payment_amount_cents: 1400 });
    expect(w.sent).toEqual([]);
    // Devon joins: 4 in, 2 of 4 paid -> Telegram 1, naming the time, with the unpaid-only link.
    await join(w, 'Devon', s.id);
    expect(w.sent).toHaveLength(1);
    expect(w.all.filter((t) => /it's on/.test(t))).toEqual([]); // Telegram 1 stands in for "has 4 now, it's on" (not booked yet)
    expect(w.sent[0]).toMatch(/^Tonight 8:30 PM: 4 in, 2 of 4 paid\.\nText the 2 who haven't paid: https:\/\/club\.example\/admin\?unpaid=/);
    // More taps: nothing again. Casey pays, then Devon: 4 paid -> Telegram 2 once.
    await markPaid(w, s.id, 'Casey');
    expect(w.sent).toHaveLength(1);
    await markPaid(w, s.id, 'Devon');
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1]).toBe(`4 paid for tonight 8:30 PM. Book it now: ${COURTRESERVE_BOOKING_URL}`);
    expect((await dash(w)).secondChance.cards).toMatchObject([{ step: 4, inCount: 4, paidCount: 4 }]);
    // A dropout after the pings: no ping. Tick: nothing more.
    await (await playerPhone(w, 'Devon')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await w.app.settle();
    await join(w, 'Emery', s.id);
    await markPaid(w, s.id, 'Emery');
    expect(w.sent).toHaveLength(2);
    // Booked: the card goes.
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    expect((await dash(w)).secondChance.cards).toEqual([]);
  });
  it('2 in the night before: no card at all', async () => {
    const w = await world();
    await switchOn(w);
    const s = await tue(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    await join(w, 'Blair', s.id);
    w.app.now = Date.parse('2026-10-27T01:00:00Z');
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
    w.app.now = Date.parse('2026-10-27T16:00:00Z');
    expect((await dash(w)).secondChance.cards).toEqual([]);
    expect((await act(w, s.id, { action: 'reopen' })).status).toBe(409);
  });
  it('the X hides it for the day; reopen refuses a time that is taken and a time not offered', async () => {
    const w = await world();
    await switchOn(w);
    const s = await canceledWithThree(w);
    expect((await act(w, s.id, { action: 'reopen', minutes: 19 * 60 + 7 })).status).toBe(400);
    await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-10-27T22:00:00.000Z', endsAt: '2026-10-28T00:00:00.000Z' });
    expect((await act(w, s.id, { action: 'reopen', minutes: 18 * 60 })).status).toBe(409); // 6:00 PM is taken
    expect((await dash(w)).sessions.find((x: any) => x.id === s.id).status).toBe('canceled'); // nothing moved
    await act(w, s.id, { action: 'dismiss' });
    expect((await dash(w)).secondChance.cards.filter((c: any) => c.kind === 'chance')).toEqual([]);
  });
});

describe('Telegrams on normal and same-day games', () => {
  it('4 paid before 4 in (organizer counts as covered): only Telegram 2; 6 in and 4 paid says so', async () => {
    const w = await world();
    await switchOn(w);
    w.app.now = Date.parse('2026-10-27T16:00:00Z'); // Tue noon
    const s = await tue(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    // Joins and payments made while 3 are in: no Telegram.
    for (const n of ['Blair', 'Casey']) {
      await join(w, n, s.id);
      await markPaid(w, s.id, n);
    }
    expect(w.sent).toEqual([]);
    // The 4th joins already paid (marked right away): 4 in, 3 of 4 paid -> Telegram 1 at the join.
    await join(w, 'Devon', s.id);
    expect(w.sent).toHaveLength(1);
    await join(w, 'Emery', s.id);
    await join(w, 'Frankie', s.id);
    await markPaid(w, s.id, 'Devon');
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1]).toMatch(/^4 paid, 6 in for tonight 8:00 PM\. Book it now: /);
  });
  it('booked or canceled: never a ping; alerts switched off in Settings: none', async () => {
    const w = await world();
    await switchOn(w);
    w.app.now = Date.parse('2026-10-27T16:00:00Z');
    const s = await tue(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey', 'Devon']) await join(w, n, s.id);
    expect(w.sent).toEqual([]);
    expect(w.all.filter((t) => /it's on/.test(t))).toHaveLength(1); // a booked game keeps the old "it's on" alert
    const q = await world();
    await switchOn(q);
    await q.organizer.call('PUT', '/api/admin/alerts', { enabled: false });
    q.app.now = Date.parse('2026-10-27T16:00:00Z');
    const t = await tue(q);
    await q.organizer.call('POST', `/api/admin/sessions/${t.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey', 'Devon']) await join(q, n, t.id);
    expect(q.sent).toEqual([]);
  });
  it('same-day add: the card, the cutoff, and the one-tap cancel gives money back as credit with no fee question', async () => {
    const w = await world({ LATE_FEES: 'on' });
    await switchOn(w);
    await w.organizer.call('PUT', '/api/admin/late-fees', { on: true });
    w.app.now = Date.parse('2026-10-27T16:00:00Z');
    const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-10-27T23:00:00.000Z', endsAt: '2026-10-28T01:00:00.000Z' });
    expect(add.status).toBe(200);
    const s = (await dash(w)).sessions.find((x: any) => x.startsAt === '2026-10-27T23:00:00.000Z');
    await join(w, 'Blair', s.id);
    await markPaid(w, s.id, 'Blair');
    const c = (await dash(w)).secondChance.cards.find((x: any) => x.sessionId === s.id);
    expect(c).toMatchObject({ origin: 'sameday', step: 3, inCount: 1 });
    w.app.now = Date.parse('2026-10-27T21:00:00Z'); // 5:00 PM, 2 hours before 7:00
    expect((await dash(w)).secondChance.cards.find((x: any) => x.sessionId === s.id)).toMatchObject({ step: 'cutoff' });
    const r = await act(w, s.id, { action: 'cancel' });
    expect(r.status).toBe(200);
    expect(await pot(w, 'Blair')).toBe(1400);
    expect((await dash(w)).sessions.find((x: any) => x.id === s.id).status).toBe('canceled');
    expect((await dash(w)).secondChance.cards.find((x: any) => x.sessionId === s.id)).toBeUndefined();
  });
});

describe('the preview: pretend noon and the fake Telegrams', () => {
  it('SECOND_CHANCE_TEST: the Telegrams are recorded and shown, never sent; ?noontest=on moves only these features to noon on game day', async () => {
    const w = await world({ SECOND_CHANCE_TEST: 'on' });
    await switchOn(w);
    const s = await canceledWithThree(w);
    w.app.now = Date.parse('2026-10-26T14:00:00Z'); // back to Monday 10:00 AM (before the cancel, real clock)
    w.app.db.raw.prepare('UPDATE sessions SET canceled_at = ? WHERE id = ?').run('2026-10-27T01:00:00.000Z', s.id);
    expect((await dash(w)).secondChance.cards).toEqual([]);
    const noon = { ...ON, [SECOND_CHANCE_TEST.header]: 'on' };
    const d = await dash(w, noon);
    expect(d.secondChance.now).toBe('2026-10-27T16:00:00.000Z');
    expect(d.secondChance.pretendNoon).toBe(true);
    expect(d.secondChance.cards).toMatchObject([{ kind: 'chance', step: 1 }]);
    expect((await act(w, s.id, { action: 'reopen' }, noon)).status).toBe(200);
    await w.app.settle();
    // A 4th in with the pretend clock: Telegram 1 recorded, not sent.
    const devon = await playerPhone(w, 'Devon');
    await devon.call('POST', `/api/sessions/${s.id}/join`, {}, { [SECOND_CHANCE_TEST.header]: 'on' });
    await w.app.settle();
    expect(w.sent).toEqual([]);
    const fake = (await dash(w, noon)).secondChance.fakeTelegrams;
    expect(fake).toHaveLength(1);
    expect(fake[0].text).toMatch(/^Tonight 8:00 PM: 4 in, 1 of 4 paid\./);
  });
  it('live never pretends: the header does nothing without SECOND_CHANCE_TEST', async () => {
    const w = await world();
    const d = await dash(w, { ...ON, [SECOND_CHANCE_TEST.header]: 'on' });
    expect(d.secondChance.pretendNoon).toBeUndefined();
    expect(d.secondChance.preview).toBeUndefined();
    expect(d.secondChance.now).toBe(new Date(w.app.now).toISOString());
  });
});

describe('who can use it', () => {
  it('a player gets nothing: no admin card data in their answer, and the card taps answer 401', async () => {
    const w = await world();
    await switchOn(w);
    const s = await canceledWithThree(w);
    const blair = await playerPhone(w, 'Blair');
    const g = (await blair.call('GET', '/api/group', undefined, ON)).data;
    expect(JSON.stringify(g)).not.toMatch(/secondChance|sc_/);
    expect((await blair.call('POST', `/api/admin/sessions/${s.id}/second-chance`, { action: 'booking' }, ON)).status).toBe(401);
    expect((await blair.call('PUT', '/api/admin/second-chance-switch', { on: false })).status).toBe(401);
  });
});

describe('fixes from the fresh review', () => {
  it('the cutoff cancel: refused unless the card is at its cutoff step now, and refused once 4 had paid (court may be booked)', async () => {
    const w = await world();
    await switchOn(w);
    w.app.now = Date.parse('2026-10-27T16:00:00Z');
    await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-10-27T23:00:00.000Z', endsAt: '2026-10-28T01:00:00.000Z' });
    const s = (await dash(w)).sessions.find((x: any) => x.startsAt === '2026-10-27T23:00:00.000Z');
    await join(w, 'Blair', s.id);
    // Noon: not inside the two hours yet.
    expect((await act(w, s.id, { action: 'cancel' })).status).toBe(409);
    // 4 in and paid (Telegram 2 went), then one drops back to 3 inside the two hours: the fee question path, not the one-tap cancel.
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Casey', 'Devon']) await join(w, n, s.id);
    for (const n of ['Blair', 'Casey', 'Devon']) await markPaid(w, s.id, n);
    expect(w.sent.some((t) => /^4 paid/.test(t))).toBe(true);
    await (await playerPhone(w, 'Devon')).call('POST', `/api/sessions/${s.id}/withdraw`, {});
    w.app.now = Date.parse('2026-10-27T21:30:00Z');
    expect((await dash(w)).secondChance.cards.find((c: any) => c.sessionId === s.id)).toMatchObject({ step: 'cutoff' });
    const r = await act(w, s.id, { action: 'cancel' });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('maybe_booked');
    expect((await dash(w)).sessions.find((x: any) => x.id === s.id).status).not.toBe('canceled');
  });
  it('reopen again with a time: finishes a time change that did not save (the game is already reopened from the card)', async () => {
    const w = await world();
    await switchOn(w);
    const s = await canceledWithThree(w);
    expect((await act(w, s.id, { action: 'reopen' })).status).toBe(200);
    const again = await act(w, s.id, { action: 'reopen', minutes: 21 * 60 });
    expect(again.status).toBe(200);
    expect((await dash(w)).sessions.find((x: any) => x.id === s.id).startsAt).toBe('2026-10-28T01:00:00.000Z');
    expect((await dash(w)).secondChance.cards[0].groupText).toContain('at 9:00 (instead of 8:00)');
  });
  it('Telegram too slow to answer: the claim stays (never sent twice); the hour limit is not a try', async () => {
    let calls = 0;
    const w = await world({
      TELEGRAM_FETCH: (async () => {
        calls++;
        throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
      }) as typeof fetch,
    });
    await switchOn(w);
    w.app.now = Date.parse('2026-10-27T16:00:00Z');
    const s = await tue(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey', 'Devon']) await join(w, n, s.id);
    const after4 = calls;
    await join(w, 'Emery', s.id);
    await markPaid(w, s.id, 'Blair');
    const rows = w.app.db.raw.prepare("SELECT kind FROM task_log WHERE session_id = ? AND task = 'sc_ping_in'").all(s.id) as any[];
    expect(rows.map((r) => r.kind).sort()).toEqual(['failed', 'sent']);
    expect(calls).toBe(after4); // no second try of Telegram 1
  });
  it('nothing before 7:00 AM; the 7:00 AM clock sends what came due overnight', async () => {
    const w = await world({ CRON_SECRET: 'c'.repeat(40) });
    await switchOn(w);
    w.app.now = Date.parse('2026-10-27T09:00:00Z'); // Tue 5:00 AM
    const s = await tue(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    for (const n of ['Blair', 'Casey', 'Devon']) await join(w, n, s.id);
    expect(w.sent).toEqual([]);
    w.app.now = Date.parse('2026-10-27T11:05:00Z'); // 7:05 AM
    await w.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': 'c'.repeat(40) });
    await w.app.settle();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatch(/^Tonight 8:00 PM: 4 in, 1 of 4 paid\./);
  });
});
