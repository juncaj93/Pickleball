// Zip 34: "Check-in pay line" (CHECKIN_PAY_LINE, shared/checkInPay.ts). The night-before Check-in text (4 or more in) adds a soft pay line
// while somebody signed up (not the organizer) still owes, and is byte for byte what it was when everyone has paid or the switch is off.
// ONE builder (checkInBody) feeds the gear menu, the Home card and the Telegram link, so the words can never differ between them.
import { describe, expect, it } from 'vitest';
import { makeGoToken } from '../server/go';
import { ADJUST_CREDIT_HEADER } from '../shared/adjustCredit';
import { CHECKIN_PAY_LINE, checkInBody, checkInPayAllowed, checkInTextPayLine, signedUpOwe, type PayRow } from '../shared/checkInPay';
import { checkInMessage } from '../shared/messages';
import { checkInTextR2 } from '../shared/textsR2';
import { checkInTextLastCall } from '../shared/lastCall';
import { fillTexts, sessionTexts } from '../src/pages/admin/textMenu';
import { unpaidRows } from '../src/pages/admin/moneyList';
import { DAY, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const LINK = 'pickleball.juncaj.net';
const thu730 = { startsAt: '2026-11-13T00:30:00.000Z', endsAt: '2026-11-13T02:30:00.000Z' }; // Thu Nov 12, 7:30 PM Eastern
const tue8 = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' }; // Tue Nov 3, 8:00 PM Eastern
const wedNoon = Date.parse('2026-11-11T17:00:00Z'); // the day before Thu Nov 12
const thuNoon = Date.parse('2026-11-12T17:00:00Z'); // game day

describe('the words', () => {
  it("Alex's wording, line for line: 5 in, tomorrow, 7:30pm, $14", () => {
    expect(checkInTextPayLine(thu730, TZ, wedNoon, 5, 1400, LINK)).toBe(
      'Pickleball tomorrow @ 7:30pm!\n5 in. Still in? Pay $14 to confirm.\nNeed out? Tell me tonight.\n\npickleball.juncaj.net',
    );
  });
  it('4, 5 and 10 players: the real count', () => {
    for (const n of [4, 5, 10]) {
      expect(checkInTextPayLine(thu730, TZ, wedNoon, n, 1400, LINK).split('\n')[1]).toBe(`${n} in. Still in? Pay $14 to confirm.`);
    }
  });
  it('the price is the one the game shows: a 1.5 hour game says $11, a 2.5 hour game $18', () => {
    expect(checkInTextPayLine(thu730, TZ, wedNoon, 4, 1100, LINK).split('\n')[1]).toBe('4 in. Still in? Pay $11 to confirm.');
    expect(checkInTextPayLine(thu730, TZ, wedNoon, 4, 1800, LINK).split('\n')[1]).toBe('4 in. Still in? Pay $18 to confirm.');
  });
  it('uses the day word the other Check-in texts use: tonight, today, a date', () => {
    expect(checkInTextPayLine(thu730, TZ, thuNoon, 5, 1400, LINK).split('\n')[0]).toBe('Pickleball tonight @ 7:30pm!');
    expect(checkInTextPayLine({ startsAt: '2026-11-12T15:00:00.000Z', endsAt: '2026-11-12T17:00:00.000Z' }, TZ, Date.parse('2026-11-12T11:00:00Z'), 5, 1400, LINK).split('\n')[0]).toBe('Pickleball today @ 10am!');
    const far = checkInTextPayLine(thu730, TZ, Date.parse('2026-11-06T17:00:00Z'), 5, 1400, LINK).split('\n');
    expect(far[0]).toBe('Pickleball Thu Nov 12 @ 7:30pm!');
    expect(far[2]).toBe('Need out? Tell me early.'); // "tonight" would be wrong a week out
    // A daytime game today: "tonight" would be wrong, so it says now.
    expect(checkInTextPayLine({ startsAt: '2026-11-12T15:00:00.000Z', endsAt: '2026-11-12T17:00:00.000Z' }, TZ, Date.parse('2026-11-12T11:00:00Z'), 5, 1400, LINK).split('\n')[2]).toBe('Need out? Tell me now.');
  });
  it('is soft: no dashes, no threat, never says anyone is dropped, the address alone on the last line', () => {
    for (const t of [checkInTextPayLine(thu730, TZ, wedNoon, 6, 1400, LINK), checkInTextPayLine(thu730, TZ, Date.parse('2026-11-06T17:00:00Z'), 6, 1100, LINK)]) {
      expect(t).not.toMatch(/[–—]/);
      expect(t).not.toMatch(/drop|remove|cancel|lose|kicked|fee|unpaid|owe/i);
      expect(t.endsWith('\n\npickleball.juncaj.net')).toBe(true);
      expect(t.split('\n').length).toBe(5);
    }
  });
});

describe('the one builder (checkInBody)', () => {
  const base = { s: tue8, tz: TZ, nowMs: Date.parse('2026-11-02T23:00:00Z'), signedUp: 5, link: LINK, priceCents: 1400 };
  it('switch off: exactly the old words, whoever owes (every wording: oldest, round 2, last call)', () => {
    expect(checkInBody({ ...base, r2: false, lastCall: false, payLine: false, someoneOwes: true })).toBe(checkInMessage(tue8, TZ, base.nowMs, LINK));
    expect(checkInBody({ ...base, r2: true, lastCall: false, payLine: false, someoneOwes: true })).toBe(checkInTextR2(tue8, TZ, base.nowMs, 5, LINK));
    expect(checkInBody({ ...base, r2: true, lastCall: true, payLine: false, someoneOwes: true })).toBe(checkInTextLastCall(tue8, TZ, base.nowMs, 5, LINK));
  });
  it('switch on but everyone has paid: the same bytes as switch off', () => {
    expect(checkInBody({ ...base, r2: true, lastCall: false, payLine: true, someoneOwes: false })).toBe(checkInTextR2(tue8, TZ, base.nowMs, 5, LINK));
    expect(checkInBody({ ...base, r2: true, lastCall: true, payLine: true, someoneOwes: false })).toBe(checkInTextLastCall(tue8, TZ, base.nowMs, 5, LINK));
  });
  it('switch on and somebody owes: the pay line, over round 2 and over last call alike', () => {
    const want = 'Pickleball tomorrow @ 8pm!\n5 in. Still in? Pay $14 to confirm.\nNeed out? Tell me tonight.\n\npickleball.juncaj.net';
    expect(checkInBody({ ...base, r2: true, lastCall: false, payLine: true, someoneOwes: true })).toBe(want);
    expect(checkInBody({ ...base, r2: true, lastCall: true, payLine: true, someoneOwes: true })).toBe(want);
  });
  it('needs Texts round 2: with it off the oldest words stay, nobody is added', () => {
    expect(checkInBody({ ...base, r2: false, lastCall: false, payLine: true, someoneOwes: true })).toBe(checkInMessage(tue8, TZ, base.nowMs, LINK));
  });
  it('the kill switch reads "off" only', () => {
    expect(checkInPayAllowed(undefined)).toBe(true);
    expect(checkInPayAllowed('on')).toBe(true);
    expect(checkInPayAllowed('')).toBe(true);
    expect(checkInPayAllowed(' OFF ')).toBe(false);
  });
});

describe('who counts as owing (the money card meaning, signed-up players only)', () => {
  const row = (o: Partial<PayRow> = {}): PayRow => ({ status: 'confirmed', isOrganizer: false, paymentStatus: 'unpaid', owesCents: 1400, ...o });
  it('one unpaid player in: yes', () => expect(signedUpOwe([row({ paymentStatus: 'paid', owesCents: 0 }), row()])).toBe(true));
  it('several unpaid: yes', () => expect(signedUpOwe([row(), row(), row()])).toBe(true));
  it('everyone paid: no', () => expect(signedUpOwe([row({ paymentStatus: 'paid', owesCents: 0 }), row({ paymentStatus: 'paid', owesCents: 0 })])).toBe(false));
  it('the organizer owing nothing to the group: no', () => expect(signedUpOwe([row({ isOrganizer: true }), row({ paymentStatus: 'paid', owesCents: 0 })])).toBe(false));
  it('credit that covers the price (owes $0): no', () => expect(signedUpOwe([row({ owesCents: 0 })])).toBe(false));
  it('a waitlisted player who has not paid: no', () => expect(signedUpOwe([row({ status: 'waitlisted' }), row({ paymentStatus: 'paid', owesCents: 0 })])).toBe(false));
  it('a player who left owing a late fee is not signed up: no', () => expect(signedUpOwe([row({ status: 'dropped' })])).toBe(false));
  it('one in and one out: when the unpaid player drops out the line goes away', () => {
    expect(signedUpOwe([row({ paymentStatus: 'paid', owesCents: 0 }), row()])).toBe(true);
    expect(signedUpOwe([row({ paymentStatus: 'paid', owesCents: 0 }), row({ status: 'dropped' })])).toBe(false);
  });
  it('part credit: still owes the rest', () => expect(signedUpOwe([row({ owesCents: 900 })])).toBe(true));
});

// ---------------------------------------------------------------- through the API ----

type W = Awaited<ReturnType<typeof world>>;
const ADJ = { [ADJUST_CREDIT_HEADER]: 'on' };
const ON = { [CHECKIN_PAY_LINE.header]: 'on' };

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  app.env = { ...app.env, CRON_SECRET: SECRET, GO_LINKS: 'on', SITE_URL: 'https://pickleball.juncaj.net', ...env };
  const ctx = await setupGroup(app);
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  app.now = Date.parse('2026-11-02T17:00:00Z'); // Mon noon
  await ctx.organizer.call('PUT', '/api/admin/texts-r2', { on: true });
  const dash = async (h: Record<string, string> = {}) => (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, h)).data;
  const tue = (await dash()).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03');
  await ctx.organizer.call('PUT', `/api/admin/sessions/${tue.id}/booking`, { bookingStatus: 'booked' });
  return { ...ctx, dash, tue };
}
const join = async (w: W, id: string, names: string[]) => {
  for (const n of names) expect((await (await playerPhone(w, n)).call('POST', `/api/sessions/${id}/join`, {})).status).toBe(200);
};
const pay = (w: W, id: string, n: string) => w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: w.byName[n], paid: true });

/** The Check-in from the gear menu / Home card as the organizer sees it (the same sessionTexts the Home card reads), and the Telegram link's. */
async function gear(w: W, id: string, h: Record<string, string> = {}) {
  const d = await w.dash(h);
  const s = d.sessions.find((x: any) => x.id === id);
  const item = sessionTexts(d, s, w.app.now).find((i) => i.id === 'checkin');
  const card = fillTexts(d, s, w.app.now).find((i) => i.id === 'checkin');
  return { d, s, body: item?.body, card: card?.body, item };
}
async function go(w: W, id: string, startsAt: string, h: Record<string, string> = {}) {
  const token = await makeGoToken(SECRET, id, startsAt, w.app.now);
  const res = await w.app.client().call('POST', '/api/go', { token }, h);
  expect(res.status, res.text).toBe(200);
  return res.data as { body: string; kind: string };
}
const PAY_LINE = 'Pickleball tomorrow @ 8pm!\n5 in. Still in? Pay $14 to confirm.\nNeed out? Tell me tonight.\n\npickleball.juncaj.net';
const PLAIN = 'Pickleball tomorrow @ 8pm!\n5 in so far. Want in? Join now.\nNeed to back out? Do it tonight to avoid cancel fees.\n\npickleball.juncaj.net';
const LAST = 'Pickleball tomorrow @ 8pm!\n5 in so far. Is everyone still in? Anyone else in?\nNeed to back out? Do it tonight to avoid cancel fees.\n\npickleball.juncaj.net';

describe('the switch', () => {
  it('ships off: no flag on the dashboard, and an unpaid game gives the old words in the gear menu, the Home card and the Telegram link', async () => {
    const w = await world();
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // Blair to Emery owe
    const g = await gear(w, w.tue.id);
    expect(g.d.checkInPay).toBeUndefined();
    expect(g.d.checkInPayForAll).toBeUndefined();
    expect(g.body).toBe(PLAIN);
    expect(g.card).toBe(PLAIN);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PLAIN);
  });

  it('this phone only (header): somebody owes -> the same pay line from every place; other phones keep the old words', async () => {
    const w = await world();
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    await pay(w, w.tue.id, 'Casey');
    const g = await gear(w, w.tue.id, ON);
    expect(g.d.checkInPay).toBe(true);
    expect(g.body).toBe(PAY_LINE);
    expect(g.card).toBe(PAY_LINE); // the Home card
    expect(g.item!.chat).toBe(true); // still the group chat, never a recipient
    expect(g.item!.phones).toEqual([]);
    const telegram = await go(w, w.tue.id, w.tue.startsAt, ON);
    expect(telegram.kind).toBe('checkin');
    expect(telegram.body).toBe(g.body); // same bytes from both builders
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PLAIN);
    expect((await gear(w, w.tue.id)).body).toBe(PLAIN);
  });

  it('everyone signed up has paid (the organizer owes the group nothing): the text is byte for byte the switch-off text, everywhere', async () => {
    const w = await world();
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    const off = await gear(w, w.tue.id);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await pay(w, w.tue.id, n);
    const on = await gear(w, w.tue.id, ON);
    expect(on.body).toBe(off.body);
    expect(on.card).toBe(off.card);
    expect((await go(w, w.tue.id, w.tue.startsAt, ON)).body).toBe(PLAIN);
  });

  it('one unpaid player pays and the line disappears; the Settings row stays on', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true })).status).toBe(200);
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    for (const n of ['Blair', 'Casey', 'Devon']) await pay(w, w.tue.id, n);
    expect((await gear(w, w.tue.id)).body).toBe(PAY_LINE);
    await pay(w, w.tue.id, 'Emery');
    expect((await gear(w, w.tue.id)).body).toBe(PLAIN);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PLAIN);
  });

  it('several unpaid and the count is the real count (4, then 6 in)', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await join(w, w.tue.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await gear(w, w.tue.id)).body).toBe('Pickleball tomorrow @ 8pm!\n4 in. Still in? Pay $14 to confirm.\nNeed out? Tell me tonight.\n\npickleball.juncaj.net');
    await join(w, w.tue.id, ['Frankie', 'Alex']);
    const six = await gear(w, w.tue.id);
    expect(six.body!.split('\n')[1]).toBe('6 in. Still in? Pay $14 to confirm.');
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(six.body);
  });

  it('one in and one out: when the only unpaid player drops out the line goes away; under 4 in it is Need players, untouched', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await join(w, w.tue.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await pay(w, w.tue.id, n);
    expect((await gear(w, w.tue.id)).body).toContain('Pay $14 to confirm');
    expect((await (await playerPhone(w, 'Frankie')).call('POST', `/api/sessions/${w.tue.id}/withdraw`, {})).status).toBe(200);
    w.app.now += 10_000; // Drop out holds for a moment so Undo can take it back
    const after = await gear(w, w.tue.id);
    expect(after.body).toBe(PLAIN.replace('5 in', '4 in'));
    // Down to 3 in: the Need players text, no pay line anywhere.
    await (await playerPhone(w, 'Emery')).call('POST', `/api/sessions/${w.tue.id}/withdraw`, {});
    w.app.now += 10_000;
    const three = await gear(w, w.tue.id);
    expect(three.item).toBeUndefined();
    const need = sessionTexts(three.d, three.s, w.app.now).find((i) => i.id === 'need')!;
    expect(need.body).not.toContain('Pay $');
    expect((await go(w, w.tue.id, w.tue.startsAt)).kind).toBe('need');
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).not.toContain('Pay $');
  });

  it('credit that covers the price is not owing: no pay line while only credit-covered players are unpaid', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    const adj = await w.organizer.call('POST', `/api/admin/players/${w.byName.Blair}/credit-adjust`, { direction: 'add', cents: 1400, reason: 'Test credit', seen: 0 }, ADJ);
    expect(adj.status, adj.text).toBe(200);
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    for (const n of ['Casey', 'Devon', 'Emery']) await pay(w, w.tue.id, n);
    const g = await gear(w, w.tue.id);
    const blair = g.s.roster.find((r: any) => r.name === 'Blair');
    expect(blair.owesCents).toBe(0); // credit covered it
    expect(g.body).toBe(PLAIN);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PLAIN);
  });

  it('part credit: still owes the rest, and the text names the standard price ($14), not the part left', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await w.organizer.call('POST', `/api/admin/players/${w.byName.Blair}/credit-adjust`, { direction: 'add', cents: 500, reason: 'Test credit', seen: 0 }, ADJ);
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    for (const n of ['Casey', 'Devon', 'Emery']) await pay(w, w.tue.id, n);
    const g = await gear(w, w.tue.id);
    expect(g.s.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(900);
    expect(g.body).toBe(PAY_LINE);
  });

  it('the same people the money card lists, once the waitlist and the organizer are set aside (a check across a mixed game)', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    await pay(w, w.tue.id, 'Blair');
    const g = await gear(w, w.tue.id);
    const money = unpaidRows(g.s).filter((r: any) => r.status === 'confirmed');
    expect(money.length).toBeGreaterThan(0);
    expect(signedUpOwe(g.s.roster)).toBe(money.length > 0);
    expect(g.body).toBe(PAY_LINE);
  });

  it('a 1.5 hour game with Short games on says $11 in the gear menu and in the Telegram link', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    expect((await w.organizer.call('PUT', '/api/admin/short-games-switch', { on: true })).status).toBe(200);
    w.app.now = Date.parse('2026-11-06T15:00:00Z');
    const day = new Date(w.app.now + 3 * DAY).toISOString().slice(0, 10);
    const startsAt = new Date(Date.parse(`${day}T00:30:00.000Z`) + DAY).toISOString(); // 7:30 PM Eastern, 3 days out
    const endsAt = new Date(Date.parse(startsAt) + 90 * 60_000).toISOString();
    expect((await w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: null })).status).toBe(200);
    const s = (await w.dash()).sessions.find((x: any) => x.startsAt === startsAt);
    await join(w, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    const g = await gear(w, s.id);
    expect(g.s.roster.find((r: any) => r.name === 'Blair').owesCents).toBe(1100);
    expect(g.body!.split('\n')[1]).toBe('4 in. Still in? Pay $11 to confirm.');
    const telegram = await go(w, s.id, s.startsAt);
    expect(telegram.body).toBe(g.body);
  });

  it('Texts round 2 off: the oldest words stay, with or without the switch', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await w.organizer.call('PUT', '/api/admin/texts-r2', { on: false });
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toMatch(/^Pickleball tomorrow, 8:00 PM\. Can't make it\?/);
    expect((await gear(w, w.tue.id)).body).toMatch(/^Pickleball tomorrow, 8:00 PM\. Can't make it\?/);
  });

  it('Last call texts on: unpaid -> the pay line; everyone paid -> the last call words as before', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await w.organizer.call('PUT', '/api/admin/last-call-switch', { on: true });
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await gear(w, w.tue.id)).body).toBe(PAY_LINE);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PAY_LINE);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await pay(w, w.tue.id, n);
    expect((await gear(w, w.tue.id)).body).toBe(LAST);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(LAST);
  });

  it('Settings row: on for everyone with no deploy, logged in Activity; off again gives the old words', async () => {
    const w = await world();
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect((await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true })).status).toBe(200);
    const g = await gear(w, w.tue.id);
    expect(g.d.checkInPayForAll).toBe(true);
    expect(g.body).toBe(PAY_LINE);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PAY_LINE);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => e.action);
    expect(act).toContain('checkin_pay_line_on');
    expect((await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: false })).status).toBe(200);
    expect((await gear(w, w.tue.id)).body).toBe(PLAIN);
    expect((await go(w, w.tue.id, w.tue.startsAt)).body).toBe(PLAIN);
  });

  it('only the organizer can flip it', async () => {
    const w = await world();
    const blair = await playerPhone(w, 'Blair');
    const res = await blair.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    expect([401, 403]).toContain(res.status);
    expect((await w.dash()).checkInPayForAll).toBeUndefined();
  });

  it('the kill switch (CHECKIN_PAY_LINE = "off") wins over the Settings row and the private link', async () => {
    const w = await world({ CHECKIN_PAY_LINE: 'off' });
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    const g = await gear(w, w.tue.id, ON);
    expect(g.d.checkInPay).toBeUndefined();
    expect(g.body).toBe(PLAIN);
    expect((await go(w, w.tue.id, w.tue.startsAt, ON)).body).toBe(PLAIN);
  });

  it('the switch changes no money and writes nothing but its own row: seats, payments and credit are identical on and off', async () => {
    const w = await world();
    await join(w, w.tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    await pay(w, w.tue.id, 'Casey');
    const snap = () => JSON.stringify({
      roster: w.app.db.raw.prepare('SELECT player_id, status, payment_status, payment_amount_cents FROM session_players ORDER BY player_id').all(),
      ledger: w.app.db.raw.prepare('SELECT player_id, kind, amount_cents FROM credit_ledger ORDER BY rowid').all(),
    });
    const before = snap();
    await gear(w, w.tue.id, ON);
    await go(w, w.tue.id, w.tue.startsAt, ON);
    await w.organizer.call('PUT', '/api/admin/checkin-pay-switch', { on: true });
    await gear(w, w.tue.id);
    await go(w, w.tue.id, w.tue.startsAt);
    expect(snap()).toBe(before);
  });
});
