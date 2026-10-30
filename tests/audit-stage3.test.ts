// Independent audit (stage 3): the credit chip and sheet, refund requests,
// the "Refund requested" Telegram alert, the organizer's refund card and Home
// order, the Text menu and Home suggestion cards, Settings, privacy of every
// player-facing answer, and the Nov 1 2026 clock change.
//
// Written by an auditor that did not write the code. Its first run found
// seven bugs (reopen or unmark taking credit a refund request holds, the
// post-game note following a later price change, a stale "Request refund"
// line, a refund-request alert flood, half-dollar credit); each test below
// now checks the fix. Everything else is a check that held up.
//
// Telegram is always a fake (TELEGRAM_FETCH); nothing leaves this process.
import { describe, expect, it } from 'vitest';
import { venmoRefundUrl } from '../shared/money';
import { finalPrice } from '../shared/pricing';
import { sessionTexts, reminderText } from '../src/pages/admin/textMenu';
import { suggestions, visibleSuggestions } from '../src/pages/admin/suggestions';
import { buildTodo } from '../src/pages/admin/todo';
import { DAY, HOUR, PLAYER_NAMES, playerPhone, setupGroup, TestApp } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
type Phone = Awaited<ReturnType<typeof playerPhone>>;

const TZ = 'America/Detroit';
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
const ALL = [...PLAYER_NAMES, ...MORE];
const LINK = 'pickleball.juncaj.net';
const TOKEN = '123456:FAKE-audit-token-never-real';
const CHAT = '4242424242';

interface Sent {
  url: string;
  body: { chat_id: string; text: string; reply_markup?: { inline_keyboard: { text: string; url: string }[][] } };
}

/** A group of 12 players, the organizer named Robin, Telegram faked (recording). */
async function group(opts: { fetch?: (url: string, init: RequestInit) => Promise<Response>; telegram?: boolean } = {}) {
  const app = new TestApp();
  const sent: Sent[] = [];
  app.env = { ...app.env, SITE_URL: `https://${LINK}` };
  if (opts.telegram !== false) {
    app.env = {
      ...app.env,
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_CHAT_ID: CHAT,
      TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return opts.fetch ? opts.fetch(url, init) : new Response('{"ok":true}', { status: 200 });
      }) as typeof fetch,
    };
  }
  const ctx = await setupGroup(app);
  for (const [i, name] of MORE.entries()) await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` });
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' })).status).toBe(200);
  await refresh(ctx);
  const texts = async () => (await app.settle(), sent.map((s) => s.body.text));
  const clear = async () => {
    await app.settle();
    sent.length = 0;
  };
  return Object.assign(ctx, { sent, texts, clear });
}
// type G = Awaited<ReturnType<typeof group>>;

const dashboard = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function refresh(ctx: Ctx) {
  const d = await dashboard(ctx);
  ctx.players = d.players;
  ctx.byName = Object.fromEntries(d.players.map((p: { name: string; id: string }) => [p.name, p.id]));
}
async function on(ctx: Ctx, date: string) {
  const s = (await dashboard(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function nextSession(ctx: Ctx, skip: string[] = []) {
  const s = (await dashboard(ctx)).sessions.find((x: any) => Date.parse(x.startsAt) > ctx.app.now && x.status !== 'canceled' && !skip.includes(x.id));
  if (!s) throw new Error('no upcoming session');
  return s;
}
async function joinAll(ctx: Ctx, sessionId: string, names: string[]) {
  const phones: Record<string, Phone> = {};
  for (const name of names) {
    phones[name] = await playerPhone(ctx, name);
    const res = await phones[name].call('POST', `/api/sessions/${sessionId}/join`, {});
    expect(res.status, res.text).toBe(200);
  }
  return phones;
}
const pay = (ctx: Ctx, sessionId: string, name: string, paid = true) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/payment`, { playerId: ctx.byName[name], paid });
const payAll = async (ctx: Ctx, sessionId: string, names: string[]) => {
  for (const n of names) expect((await pay(ctx, sessionId, n)).status).toBe(200);
};
const finalize = (ctx: Ctx, sessionId: string, body: Record<string, unknown> = { everyone: true }) =>
  ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/finalize`, body);
const reopen = (ctx: Ctx, sessionId: string) => ctx.organizer.call('POST', `/api/admin/sessions/${sessionId}/reopen`, {});
const withdraw = (phone: Phone, sessionId: string) => phone.call('POST', `/api/sessions/${sessionId}/withdraw`, {});
const useCredit = (phone: Phone, sessionId: string) => phone.call('POST', `/api/sessions/${sessionId}/use-credit`, {});
const requestRefund = (phone: Phone, cents: unknown) => phone.call('POST', '/api/me/refund-request', { cents });
const cancelRequest = (phone: Phone) => phone.call('POST', '/api/me/refund-request/cancel', {});
const resolve = (ctx: Ctx, id: string, action: 'refunded' | 'not_now' | 'undo') => ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action });
const mine = async (phone: Phone) => (await phone.call('GET', '/api/group')).data;
const endGame = (ctx: Ctx, s: any) => {
  ctx.app.now = Date.parse(s.endsAt) + 5 * 60_000;
};
async function ledgerOf(ctx: Ctx, name: string) {
  const d = await dashboard(ctx);
  return d.creditLedger.find((l: any) => l.playerId === ctx.byName[name]) ?? { balanceCents: 0, reservedCents: 0, refundCents: 0, entries: [] };
}

/** A player gets $14 credit: they pay for the next game and drop out. */
async function giveCredit(ctx: Ctx, name: string, skip: string[] = []) {
  const s = await nextSession(ctx, skip);
  const phone = await playerPhone(ctx, name);
  expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  expect((await pay(ctx, s.id, name)).status).toBe(200);
  expect((await withdraw(phone, s.id)).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
  return { session: s, phone };
}

/** Six play a game, all paid $14, finalized: everyone gets $5 back. */
async function sixPlayed(ctx: Ctx, skip: string[] = []) {
  const s = await nextSession(ctx, skip);
  const names = ALL.slice(0, 6);
  const phones = await joinAll(ctx, s.id, names);
  await payAll(ctx, s.id, names);
  const before = ctx.app.now;
  endGame(ctx, s);
  const fin = await finalize(ctx, s.id);
  expect(fin.status, fin.text).toBe(200);
  return { s, phones, before };
}

// ---------------------------------------------------------------------------
// 1. The credit sheet's Request refund amount box

describe('Request refund: the amount box', () => {
  it('zero, negative, cents, over $10k, over the balance, a string, null, true and a float are refused and reserve nothing', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    for (const bad of [0, -100, -1400, 1450, 50, 1_000_001, 99_999_00, '14', '1400', null, true, 1400.5, 'abc', [1400], { cents: 1400 }]) {
      const r = await requestRefund(alex, bad);
      expect([400, 409], `${JSON.stringify(bad)} -> ${r.status} ${r.text}`).toContain(r.status);
    }
    // Just above the balance.
    expect((await requestRefund(alex, 1500)).status).toBe(409);
    const g = await mine(alex);
    expect(g.credit).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await dashboard(ctx)).refundRequests).toEqual([]);
    // The sheet prefills the usable balance in whole dollars and the server takes exactly that.
    expect(String(Math.floor(g.credit.usableCents / 100))).toBe('14');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
  });

  it('a double submit makes one request and one Telegram message', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    await ctx.clear();
    const [a, b] = await Promise.all([requestRefund(alex, 1400), requestRefund(alex, 1400)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await dashboard(ctx)).refundRequests).toHaveLength(1);
    expect(await ctx.texts()).toEqual(['Refund requested: Alex wants $14 back.']);
  });

  it('a request for less than the balance: only the rest is usable on a game; cancel frees the reserved part', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 500)).status).toBe(200);
    let g = await mine(alex);
    expect(g.credit).toMatchObject({ balanceCents: 1400, usableCents: 900, pending: { cents: 500 } });
    const s = await nextSession(ctx, [s0.id]);
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    g = await mine(alex);
    expect(g.sessions.find((x: any) => x.id === s.id).mine.useCreditCents).toBe(900);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ usedCents: 900, paid: false });
    expect((await useCredit(alex, s.id)).status).toBe(409);
    // A second request while one waits, even smaller, is refused.
    expect((await requestRefund(alex, 100)).status).toBe(409);
    expect((await cancelRequest(alex)).data).toMatchObject({ changed: true });
    expect((await useCredit(alex, s.id)).data).toMatchObject({ usedCents: 500, paid: true });
    g = await mine(alex);
    expect(g.credit).toMatchObject({ balanceCents: 0, usableCents: 0, pending: null });
  });

  it('races in both orders: Use credit first leaves nothing to request; request first leaves nothing to use', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    expect((await requestRefund(alex, 1400)).status).toBe(409);
    expect((await requestRefund(alex, 100)).status).toBe(409);
    // Undo the credit use, then request first: Use credit has nothing left.
    expect((await alex.call('POST', `/api/sessions/${s.id}/undo-credit`, {})).status).toBe(200);
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    expect((await useCredit(alex, s.id)).status).toBe(409);
    // The Players-tab refund has nothing usable either.
    expect((await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName.Alex}/credit-refund`, { refunded: true, cents: 1400 })).status).toBe(409);
  });

  it('history is newest first and holds every live entry (the sheet shows 8, then More)', async () => {
    const ctx = await group();
    let skip: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { session } = await giveCredit(ctx, 'Alex', skip);
      skip = [...skip, session.id];
    }
    const g = await mine(await playerPhone(ctx, 'Alex'));
    expect(g.credit.balanceCents).toBe(14000);
    expect(g.credit.history).toHaveLength(10);
    const ats = g.credit.history.map((h: any) => h.sessionStartsAt);
    expect([...ats].sort().reverse()).toEqual(ats);
  });
});

// ---------------------------------------------------------------------------
// 2. Reserved amounts against everything that can take credit back

describe('a pending request stays covered by the pot', () => {
  it('Reopen on the Money tab waits while a pending request holds credit that game gave back (the request always stays covered)', async () => {
    const ctx = await group();
    const { s, phones } = await sixPlayed(ctx);
    expect((await ledgerOf(ctx, 'Alex')).balanceCents).toBe(500);
    expect((await requestRefund(phones.Alex, 500)).status).toBe(200);
    const req = (await dashboard(ctx)).refundRequests[0];
    const r = await reopen(ctx, s.id);
    const l = await ledgerOf(ctx, 'Alex');
    // Either the reopen is refused (the credit is spoken for), or what is reserved still fits in the pot.
    if (r.status === 200) {
      expect(l.reservedCents, `pot ${l.balanceCents}, reserved ${l.reservedCents}`).toBeLessThanOrEqual(l.balanceCents);
      // If the card is still on Home, Mark refunded must work (the organizer may already have sent the Venmo).
      const cards = (await dashboard(ctx)).refundRequests;
      if (cards.length) expect((await resolve(ctx, req.id, 'refunded')).status).toBe(200);
    } else {
      expect(r.status).toBe(409);
    }
  });

  it('the organizer unmarking a paid seat after finalize never takes back credit a pending request has reserved', async () => {
    const ctx = await group();
    const { s, phones } = await sixPlayed(ctx);
    expect((await requestRefund(phones.Blair, 500)).status).toBe(200);
    const req = (await dashboard(ctx)).refundRequests[0];
    const un = await pay(ctx, s.id, 'Blair', false);
    const l = await ledgerOf(ctx, 'Blair');
    if (un.status === 200) {
      expect(l.reservedCents, `pot ${l.balanceCents}, reserved ${l.reservedCents}`).toBeLessThanOrEqual(l.balanceCents);
      if ((await dashboard(ctx)).refundRequests.length) expect((await resolve(ctx, req.id, 'refunded')).status).toBe(200);
    } else {
      expect(un.status).toBe(409);
    }
  });

  it('Not now gives the amount back; Mark refunded then undo returns the request; one open request at a time', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    let d = await dashboard(ctx);
    expect(d.refundRequests).toEqual([expect.objectContaining({ name: 'Alex', cents: 1400 })]);
    expect((await resolve(ctx, d.refundRequests[0].id, 'not_now')).status).toBe(200);
    expect((await mine(alex)).credit).toMatchObject({ balanceCents: 1400, usableCents: 1400, pending: null });
    expect((await requestRefund(alex, 600)).status).toBe(200);
    d = await dashboard(ctx);
    const id = d.refundRequests[0].id;
    expect((await resolve(ctx, id, 'refunded')).status).toBe(200);
    expect((await mine(alex)).credit).toMatchObject({ balanceCents: 800, usableCents: 800, pending: null });
    expect((await mine(alex)).credit.history[0]).toMatchObject({ kind: 'refunded', cents: 600 });
    expect((await resolve(ctx, id, 'undo')).data).toMatchObject({ changed: true });
    expect((await mine(alex)).credit).toMatchObject({ balanceCents: 1400, usableCents: 800, pending: { cents: 600 } });
    expect((await dashboard(ctx)).refundRequests).toEqual([expect.objectContaining({ id, cents: 600 })]);
  });

  it('a player canceling after the organizer answered changes nothing', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    const id = (await dashboard(ctx)).refundRequests[0].id;
    expect((await resolve(ctx, id, 'refunded')).status).toBe(200);
    expect((await cancelRequest(alex)).data).toMatchObject({ changed: false });
    expect((await ledgerOf(ctx, 'Alex')).balanceCents).toBe(0);
    expect((await resolve(ctx, id, 'not_now')).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// 3. The "Refund requested" Telegram alert

describe('Telegram: Refund requested', () => {
  it('exact words, an Open site button to /admin, no phone, Venmo name or other money', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}`, { name: 'Alex', phone: '(313) 555-0100', venmo: '@AlexVenmoSecret' });
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    await ctx.clear();
    expect((await requestRefund(alex, 900)).status).toBe(200);
    await ctx.app.settle();
    expect(ctx.sent).toHaveLength(1);
    const m = ctx.sent[0];
    expect(m.body.text).toBe('Refund requested: Alex wants $9 back.');
    expect(m.body.chat_id).toBe(CHAT);
    expect(m.body.reply_markup!.inline_keyboard).toEqual([[{ text: 'Open site', url: `https://${LINK}/admin` }]]);
    expect(JSON.stringify(m.body)).not.toMatch(/555|VenmoSecret|\$14|1400/);
  });

  it('respects the Refund requests switch and the master switch; Not now, Mark refunded, cancel and undo are quiet', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    await ctx.clear();
    await ctx.organizer.call('PUT', '/api/admin/alerts', { refundRequests: false });
    expect((await requestRefund(alex, 100)).status).toBe(200);
    expect(await ctx.texts()).toEqual([]);
    await cancelRequest(alex);
    await ctx.organizer.call('PUT', '/api/admin/alerts', { refundRequests: true, enabled: false });
    expect((await requestRefund(alex, 200)).status).toBe(200);
    expect(await ctx.texts()).toEqual([]);
    await cancelRequest(alex);
    await ctx.organizer.call('PUT', '/api/admin/alerts', { enabled: true });
    expect((await requestRefund(alex, 300)).status).toBe(200);
    expect(await ctx.texts()).toEqual(['Refund requested: Alex wants $3 back.']);
    await ctx.clear();
    const id = (await dashboard(ctx)).refundRequests[0].id;
    await resolve(ctx, id, 'refunded');
    await resolve(ctx, id, 'undo');
    await resolve(ctx, id, 'not_now');
    await cancelRequest(alex);
    expect(await ctx.texts()).toEqual([]);
  });

  it('a Telegram that throws, times out or answers 500 never breaks the tap', async () => {
    for (const fail of [
      async () => {
        throw new Error('network down');
      },
      async () => new Response('{"ok":false,"description":"boom"}', { status: 500 }),
      async () => {
        const e = new Error('slow');
        e.name = 'TimeoutError';
        throw e;
      },
    ]) {
      const ctx = await group({ fetch: fail as any });
      const { phone: alex } = await giveCredit(ctx, 'Alex');
      const r = await requestRefund(alex, 1400);
      expect(r.status, r.text).toBe(200);
      await ctx.app.settle();
      expect((await mine(alex)).credit.pending).toMatchObject({ cents: 1400 });
      const a = (await dashboard(ctx)).alerts;
      expect(a.lastOk).toBe(false);
      expect(String(a.lastError)).not.toContain(TOKEN);
    }
  });

  it('View as and Pretend never send (and never save)', async () => {
    const ctx = await group();
    await giveCredit(ctx, 'Alex');
    await ctx.clear();
    const asAlex = { 'X-View-As': ctx.byName.Alex };
    expect((await ctx.organizer.call('POST', '/api/me/refund-request', { cents: 1400 }, asAlex)).status).toBe(403);
    expect((await ctx.organizer.call('POST', '/api/me/refund-request', { cents: 1400 }, { ...asAlex, 'X-Pretend-Now': '2026-11-02T12:00:00.000Z' })).status).toBe(403);
    expect(await ctx.texts()).toEqual([]);
    expect((await dashboard(ctx)).refundRequests).toEqual([]);
  });

  it('one "Refund requested" message per player an hour: asking again and again sends one; another player still gets theirs; an hour later it sends again', async () => {
    const ctx = await group();
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    const { phone: blair } = await giveCredit(ctx, 'Blair');
    await ctx.clear();
    for (let i = 0; i < 25; i++) {
      expect((await requestRefund(alex, 100)).status).toBe(200);
      await ctx.app.settle();
      expect((await cancelRequest(alex)).status).toBe(200);
    }
    expect(await ctx.texts()).toEqual(['Refund requested: Alex wants $1 back.']);
    await ctx.clear();
    expect((await requestRefund(blair, 700)).status).toBe(200);
    expect(await ctx.texts()).toEqual(['Refund requested: Blair wants $7 back.']);
    await ctx.clear();
    ctx.app.now += 61 * 60_000;
    expect((await requestRefund(alex, 200)).status).toBe(200);
    expect(await ctx.texts()).toEqual(['Refund requested: Alex wants $2 back.']);
    // The Home card always shows the latest request, sent or not.
    expect((await dashboard(ctx)).refundRequests.map((r: any) => [r.name, r.cents])).toEqual(expect.arrayContaining([['Alex', 200], ['Blair', 700]]));
  });

  it('one player tapping Request refund / Cancel request over and over does not use up the hour\'s alerts: a late drop still reaches the organizer', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    const phones = await joinAll(ctx, s.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    ctx.app.now = Date.parse(s.startsAt) - 5 * HOUR;
    await ctx.clear();
    for (let i = 0; i < 21; i++) {
      await requestRefund(alex, 100);
      await ctx.app.settle();
      await cancelRequest(alex);
    }
    const flood = (await ctx.texts()).filter((t) => t.startsWith('Refund requested'));
    await ctx.clear();
    // Twenty minutes later Blair drops, 4h40m before: a late drop that leaves 3. This must reach the organizer.
    ctx.app.now += 20 * 60_000;
    expect((await withdraw(phones.Blair, s.id)).status).toBe(200);
    const after = await ctx.texts();
    expect(after.some((t) => /Blair dropped out/.test(t)), `drop alert after ${flood.length} refund messages from Alex: ${JSON.stringify(after)}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The organizer's refund card and Home order

describe('the refund request card and Home order', () => {
  it('Venmo link: app first, %20, exact amount, the note, addressed to the saved Venmo or not; opening it marks nothing', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName.Alex}`, { name: 'Alex', venmo: '@Alex-K' });
    const { phone: alex } = await giveCredit(ctx, 'Alex');
    const { phone: blair } = await giveCredit(ctx, 'Blair');
    expect((await requestRefund(alex, 1400)).status).toBe(200);
    expect((await requestRefund(blair, 700)).status).toBe(200);
    const d = await dashboard(ctx);
    const a = d.refundRequests.find((r: any) => r.name === 'Alex');
    const b = d.refundRequests.find((r: any) => r.name === 'Blair');
    expect(venmoRefundUrl(a.venmo, a.cents, 'Pickleball credit refund')).toEqual({
      url: 'https://venmo.com/?txn=pay&recipients=Alex-K&amount=14&note=Pickleball%20credit%20refund',
      appUrl: 'venmo://paycharge?txn=pay&recipients=Alex-K&amount=14&note=Pickleball%20credit%20refund',
      addressed: true,
    });
    expect(venmoRefundUrl(b.venmo, b.cents, 'Pickleball credit refund')).toEqual({
      url: 'https://venmo.com/?txn=pay&amount=7&note=Pickleball%20credit%20refund',
      appUrl: 'venmo://paycharge?txn=pay&amount=7&note=Pickleball%20credit%20refund',
      addressed: false,
    });
    // Nothing on the server moved (the link is built in the browser).
    expect((await ledgerOf(ctx, 'Alex'))).toMatchObject({ balanceCents: 1400, reservedCents: 1400, refundCents: 0 });
  });

  it('Home order: refund requests, then Finalize cards, then the rest (Who owes)', async () => {
    const ctx = await group();
    const { session: s0, phone: gale } = await giveCredit(ctx, 'Gale');
    expect((await requestRefund(gale, 1400)).status).toBe(200);
    const s = await nextSession(ctx, [s0.id]);
    await joinAll(ctx, s.id, ALL.slice(0, 5));
    endGame(ctx, s);
    const d = await dashboard(ctx);
    const kinds = buildTodo(d).map((i) => i.kind);
    expect(kinds.slice(0, 2), kinds.join(',')).toEqual(['refund_request', 'finalize']);
    expect(kinds.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Texts and Home suggestion cards

describe('the Text menu and Home suggestion cards', () => {
  it('no Down to 5 or Now 6 anywhere; Need players under 4; Check-in at 4+; every group text ends with the plain link', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    ctx.app.now = Date.parse(s.startsAt) - 30 * HOUR;
    for (const n of [0, 3, 4, 5, 6, 7]) {
      const d = await dashboard(ctx);
      const cur = d.sessions.find((x: any) => x.id === s.id);
      const have = cur.confirmedCount;
      if (n > have) await joinAll(ctx, s.id, ALL.slice(have, n));
      const d2 = await dashboard(ctx);
      const ss = d2.sessions.find((x: any) => x.id === s.id);
      const items = sessionTexts(d2, ss, ctx.app.now);
      const ids = items.map((i) => i.id);
      expect(ids.some((i: string) => /down|now6|five|six/i.test(i))).toBe(false);
      expect(ids.includes('need')).toBe(n < 4);
      expect(ids.includes('checkin')).toBe(n >= 4);
      for (const i of items) {
        expect(i.body.endsWith(` ${LINK}`), i.body).toBe(true);
        expect(i.body).not.toMatch(/\bsent\b|ASAP|Down to 5|Now 6/i);
      }
      if (n < 4) expect(items.find((i) => i.id === 'need')!.body).toBe(`Need ${4 - n} more for pickleball tomorrow, 8:00 PM. In? ${LINK}`);
    }
  });

  it('the Check-in card: from 6:00 PM the day before, to everyone signed up including the waitlist', async () => {
    const ctx = await group();
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } })).status).toBe(200);
    const s = await on(ctx, '2026-11-03');
    await joinAll(ctx, s.id, ALL.slice(0, 6)); // 4 in, 2 waiting
    const at = async (iso: string) => {
      ctx.app.now = Date.parse(iso);
      const d = await dashboard(ctx);
      return { d, all: suggestions(d, ctx.app.now).filter((c) => c.sessionId === s.id) };
    };
    expect((await at('2026-11-02T17:59:00-05:00')).all.map((c) => c.kind)).not.toContain('checkin');
    const { d, all } = await at('2026-11-02T18:00:00-05:00');
    const c = all.find((x) => x.kind === 'checkin')!;
    expect(c).toBeDefined();
    expect(c.body).toBe(`Pickleball tomorrow, 8:00 PM. Can't make it? Update here: ${LINK}`);
    const phonesOf = (names: string[]) => names.map((n) => d.players.find((p: any) => p.name === n).phone);
    expect([...c.phones].sort()).toEqual(phonesOf(ALL.slice(0, 6)).sort());
    // Still there right before the game; gone once it starts.
    expect((await at('2026-11-03T19:59:00-05:00')).all.map((x) => x.kind)).toContain('checkin');
    expect((await at('2026-11-03T20:00:00-05:00')).all.map((x) => x.kind)).not.toContain('checkin');
  });

  it('the Canceled text wording, with the day words', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-05');
    await joinAll(ctx, s.id, ['Alex', 'Blair']);
    ctx.app.now = Date.parse('2026-11-04T12:00:00-05:00');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    const d = await dashboard(ctx);
    const item = sessionTexts(d, d.sessions.find((x: any) => x.id === s.id), ctx.app.now).find((i) => i.id === 'canceled')!;
    expect(item.body).toBe(`Pickleball tomorrow is canceled. If you paid, it's now your credit. You can request a cash out on the site. ${LINK}`);
    ctx.app.now = Date.parse('2026-11-01T12:00:00-05:00');
    const d2 = await dashboard(ctx);
    expect(sessionTexts(d2, d2.sessions.find((x: any) => x.id === s.id), ctx.app.now).find((i) => i.id === 'canceled')!.body).toBe(
      `Pickleball Thu Nov 5 is canceled. If you paid, it's now your credit. You can request a cash out on the site. ${LINK}`,
    );
  });

  it('Payment reminder: $14 before finalize, the remainder after (unpaid owes $9 at 6 played; $3 after using $5 credit at 7 played)', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    const names = ALL.slice(0, 7);
    const phones = await joinAll(ctx, s.id, names);
    phones.Alex = alex;
    // Alex keeps $5 of credit usable by requesting $9 back first.
    expect((await requestRefund(alex, 900)).status).toBe(200);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ usedCents: 500, paid: false });
    await payAll(ctx, s.id, names.filter((n) => n !== 'Alex' && n !== 'Blair'));
    ctx.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    let d = await dashboard(ctx);
    expect(reminderText(d, ctx.byName.Blair, 'Blair')).toMatch(/you owe \$14 for pickleball/);
    expect(reminderText(d, ctx.byName.Alex, 'Alex')).toMatch(/you owe \$9 for pickleball/);
    endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    d = await dashboard(ctx);
    expect(finalPrice(1400, 7)).toBe(800);
    expect(reminderText(d, ctx.byName.Blair, 'Blair')).toMatch(/you owe \$8 for pickleball/);
    expect(reminderText(d, ctx.byName.Alex, 'Alex')).toMatch(/you owe \$3 for pickleball/);
    for (const n of ['Alex', 'Blair']) expect(reminderText(d, ctx.byName[n], n).endsWith(` ${LINK}`)).toBe(true);
  });

  it('the post-game note: exact words at 6 and at 4, a group chat card that hides after the tap and never says "sent"', async () => {
    for (const [n, words] of [
      [6, (day: string) => `Pickleball ${day} is final: 6 played, $9 each. If you paid $14, the extra $5 is now credit on your account. ${LINK}`],
      [4, (day: string) => `Pickleball ${day} is final: 4 played, $14 each. ${LINK}`],
    ] as const) {
      const ctx = await group();
      const s = await nextSession(ctx);
      await joinAll(ctx, s.id, ALL.slice(0, n));
      await payAll(ctx, s.id, ALL.slice(0, n));
      endGame(ctx, s);
      expect((await finalize(ctx, s.id)).status).toBe(200);
      const d = await dashboard(ctx);
      const day = new Date(s.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
      const all = suggestions(d, ctx.app.now);
      const card = all.find((c) => c.kind === 'final' && c.sessionId === s.id)!;
      expect(card.body).toBe(words(day));
      expect(card.chat).toBe(true);
      expect(card.body).not.toMatch(/sent/i);
      expect(visibleSuggestions(all, {}).some((c) => c.key === card.key)).toBe(true);
      expect(visibleSuggestions(all, { [card.key]: card.token }).some((c) => c.key === card.key)).toBe(false);
    }
  });

  it('raising "$14 each" after a game was finalized does not rewrite that game\'s post-game note ("If you paid $16, the extra $7")', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 6));
    await payAll(ctx, s.id, ALL.slice(0, 6));
    endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1600 } })).status).toBe(200);
    const d = await dashboard(ctx);
    const ss = d.sessions.find((x: any) => x.id === s.id);
    expect(ss.finalized).toMatchObject({ playedCount: 6, priceCents: 900 });
    const body = sessionTexts(d, ss, ctx.app.now).find((i) => i.id === 'final')!.body;
    // Everyone paid $14 and got $5 back; that is what the note must say.
    expect(body).toContain('If you paid $14, the extra $5 is now credit');
  });

  it('at 4 played the note has no credit sentence, even after the flat price is raised later', async () => {
    const ctx = await group();
    const s = await nextSession(ctx);
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ALL.slice(0, 4));
    endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1500 } })).status).toBe(200);
    const d = await dashboard(ctx);
    const body = sessionTexts(d, d.sessions.find((x: any) => x.id === s.id), ctx.app.now).find((i) => i.id === 'final')!.body;
    expect(body).not.toMatch(/credit/);
  });
});

// ---------------------------------------------------------------------------
// 6. Settings

describe('Settings', () => {
  it('Max players: default 10, kept to 4..12; lowering it below the count moves nobody, joins wait, a drop promotes nobody until under the max', async () => {
    const ctx = await group();
    expect((await dashboard(ctx)).group.settings.maxPlayers).toBe(10);
    for (const [ask, got] of [
      [3, 4],
      [13, 12],
      [0, 4],
      [7.6, 8],
    ] as const) {
      expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: ask } })).status).toBe(200);
      expect((await dashboard(ctx)).group.settings.maxPlayers).toBe(got);
    }
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 10 } })).status).toBe(200);
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 8));
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } })).status).toBe(200);
    let d = await dashboard(ctx);
    let ss = d.sessions.find((x: any) => x.id === s.id);
    expect(ss.confirmedCount).toBe(8);
    const indy = await playerPhone(ctx, 'Indy');
    expect((await indy.call('POST', `/api/sessions/${s.id}/join`, {})).data).toMatchObject({ result: 'waitlisted', position: 1 });
    const view = (await mine(indy)).sessions.find((x: any) => x.id === s.id);
    expect(view).toMatchObject({ countText: '8 in, full', full: true, openSpots: 0, joinAs: 'waitlist' });
    await withdraw(phones.Alex, s.id);
    await withdraw(phones.Blair, s.id);
    d = await dashboard(ctx);
    ss = d.sessions.find((x: any) => x.id === s.id);
    expect(ss.confirmedCount).toBe(6);
    expect(ss.waitlistCount).toBe(1);
    await withdraw(phones.Casey, s.id);
    d = await dashboard(ctx);
    ss = d.sessions.find((x: any) => x.id === s.id);
    expect(ss.confirmedCount).toBe(6);
    expect(ss.roster.find((r: any) => r.name === 'Indy').status).toBe('confirmed');
  });

  it('Refund requests switch defaults on and saves by itself', async () => {
    const ctx = await group();
    expect((await dashboard(ctx)).alerts).toMatchObject({ refundRequests: true, enabled: true });
    const r = await ctx.organizer.call('PUT', '/api/admin/alerts', { refundRequests: false });
    expect(r.data.alerts).toMatchObject({ refundRequests: false, enabled: true, drop36: true, belowMin: true, reachedMin: true });
    expect((await ctx.organizer.call('PUT', '/api/admin/alerts', { refundRequests: 'no' })).status).toBe(400);
  });

  it('a "$14.50 each" price is kept to whole dollars, so no credit is ever a part-dollar that cannot be asked back', async () => {
    const ctx = await group();
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1450 } })).status).toBe(200);
    const s = await nextSession(ctx);
    const phones = await joinAll(ctx, s.id, ALL.slice(0, 4));
    await payAll(ctx, s.id, ALL.slice(0, 4));
    endGame(ctx, s);
    expect((await finalize(ctx, s.id)).status).toBe(200);
    const g = await mine(phones.Alex);
    // Amounts are whole dollars: either no half-dollar credit, or it can be requested back.
    if (g.credit.usableCents > 0) {
      const prefill = Math.floor(g.credit.usableCents / 100) * 100;
      const r = await requestRefund(phones.Alex, prefill);
      expect(r.status, `credit ${g.credit.usableCents} cents, prefilled $${prefill / 100}: ${r.text}`).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Privacy: every player-facing answer, not just GET /api/group

describe('privacy of every player-facing answer', () => {
  it('join, I\'m out, I paid, Use credit, Undo, Request refund, Cancel, name pick, the link page and errors carry no one else\'s money, phones, Venmo names, court cost or membership', async () => {
    const ctx = await group();
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { typicalCourtCostCents: 4321, monthlyMembershipCents: 3579 } });
    for (const name of ALL) {
      expect((await ctx.organizer.call('PUT', `/api/admin/players/${ctx.byName[name]}`, { name, phone: `(313) 555-07${String(ALL.indexOf(name)).padStart(2, '0')}`, venmo: `@${name}VenmoSecret` })).status).toBe(200);
    }
    const texts: { what: string; text: string }[] = [];
    const watch = (who: string, c: Phone) => {
      const call = c.call.bind(c);
      c.call = async (...args: Parameters<typeof call>) => {
        const r = await call(...args);
        texts.push({ what: `${who} ${args[0]} ${args[1]} -> ${r.status}`, text: r.text });
        return r;
      };
      return c;
    };
    // Blair has $23 of credit (odd amount) and a pending $7 request; Casey $14 with $14 pending.
    const { session: g1 } = await giveCredit(ctx, 'Blair');
    const { session: g2 } = await giveCredit(ctx, 'Casey', [g1.id]);
    const fin = await sixPlayed(ctx, [g1.id, g2.id]);
    ctx.app.now = fin.before;
    expect((await requestRefund(fin.phones.Blair, 700)).status).toBe(200);
    expect((await requestRefund(fin.phones.Casey, 1400)).status).toBe(200);
    // Alex: the watched phone, does everything.
    const alex = watch('Alex', await playerPhone(ctx, 'Alex'));
    const s = await nextSession(ctx, [g1.id, g2.id, fin.s.id]);
    await joinAll(ctx, s.id, ['Blair', 'Casey', 'Devon']);
    await pay(ctx, s.id, 'Devon');
    await alex.call('POST', '/api/me', { playerId: ctx.byName.Alex });
    await alex.call('GET', '/api/group');
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    await alex.call('POST', `/api/sessions/${s.id}/use-credit`, {});
    await alex.call('POST', `/api/sessions/${s.id}/undo-credit`, {});
    await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: false });
    await alex.call('POST', '/api/me/refund-request', { cents: 99_00 });
    await alex.call('POST', '/api/me/refund-request', { cents: 500 });
    await alex.call('POST', '/api/me/refund-request', { cents: 500 });
    await alex.call('POST', '/api/me/refund-request/cancel', {});
    await alex.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    await alex.call('GET', '/api/group');
    await alex.call('POST', '/api/link', { token: 'x'.repeat(40) });
    await alex.call('GET', `/api/sessions/${s.id}/calendar.ics`);
    await alex.call('GET', '/api/admin/dashboard');
    await alex.call('GET', '/api/admin/money?month=2026-11');
    await alex.call('POST', `/api/admin/refund-requests/${(await dashboard(ctx)).refundRequests[0].id}`, { action: 'refunded' });
    expect(texts.length).toBeGreaterThan(15);
    for (const { what, text } of texts) {
      expect(text, `${what}: phone`).not.toMatch(/\) 555-|\(313\)|313555/);
      expect(text, `${what}: venmo`).not.toMatch(/VenmoSecret/);
      expect(text, `${what}: court cost / membership`).not.toMatch(/4321|3579|43\.21|35\.79/);
      expect(text, `${what}: someone else's credit or request`).not.toMatch(/2300|\$23\b|"reservedCents"|refundRequests|creditLedger/);
      expect(text, `${what}: other players' money`).not.toMatch(/Blair[^"]*\$|Casey[^"]*\$/);
    }
    // The pending part of the answer is Alex's own (nothing pending after his cancel).
    const last = JSON.parse(texts.filter((t) => /GET \/api\/group/.test(t.what)).pop()!.text);
    expect(last.credit.pending).toBeNull();
    expect(last.credit.balanceCents).toBe((await ledgerOf(ctx, 'Alex')).balanceCents);
  });

  it('View as shows only that player\'s chip money; Blair\'s pending request is invisible to everyone else, including View as Alex', async () => {
    const ctx = await group();
    const { phone: blair } = await giveCredit(ctx, 'Blair');
    expect((await requestRefund(blair, 1400)).status).toBe(200);
    const asAlex = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Alex });
    expect(asAlex.data.credit).toEqual({ balanceCents: 0, usableCents: 0, pending: null, history: [] });
    const asBlair = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair });
    expect(asBlair.data.credit).toMatchObject({ balanceCents: 1400, usableCents: 0, pending: { cents: 1400 } });
    expect(asAlex.text).not.toContain(ctx.byName.Blair + '"' + ',"cents"');
  });
});

// ---------------------------------------------------------------------------
// 8. The player's "Your $14 is now credit. Request refund" line

describe('the "now credit" line on a game card', () => {
  it('after the credit was spent, the dropped game no longer says "Your $14 is now credit. Request refund" and Request refund opens nothing (the sheet only opens with credit)', async () => {
    const ctx = await group();
    const { session: s0, phone: alex } = await giveCredit(ctx, 'Alex');
    const s = await nextSession(ctx, [s0.id]);
    expect((await alex.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await useCredit(alex, s.id)).data).toMatchObject({ paid: true, usedCents: 1400 });
    const g = await mine(alex);
    const dropped = g.sessions.find((x: any) => x.id === s0.id);
    // PlayerHome.tsx shows the line when mine.creditBackCents > 0 and they are out; the sheet opens only when
    // credit.balanceCents > 0 or a request is pending (PlayerHome.tsx showChip).
    const lineShown = !!dropped && dropped.mine?.creditBackCents > 0 && dropped.mine?.status === 'withdrawn';
    const sheetCanOpen = g.credit.balanceCents > 0 || !!g.credit.pending;
    expect({ lineShown, sheetCanOpen, creditBackCents: dropped?.mine?.creditBackCents, balance: g.credit.balanceCents }).toMatchObject(
      lineShown ? { sheetCanOpen: true } : { lineShown: false },
    );
  });
});

// ---------------------------------------------------------------------------
// 9. The clock change on Sun Nov 1, 2026

describe('daylight saving: the Finalize card after 10:00 PM Eastern', () => {
  it('Tue Nov 3 (first EST game): no card at 9:59 PM EST, card at 10:00 PM EST; finalize refused before, works after', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-11-03');
    expect(s.startsAt).toBe('2026-11-04T01:00:00.000Z');
    expect(s.endsAt).toBe('2026-11-04T03:00:00.000Z');
    await joinAll(ctx, s.id, ALL.slice(0, 5));
    ctx.app.now = Date.parse('2026-11-03T21:59:00-05:00');
    let d = await dashboard(ctx);
    expect(d.sessions.find((x: any) => x.id === s.id).needsFinalize).toBe(false);
    expect(buildTodo(d).some((i) => i.kind === 'finalize')).toBe(false);
    expect((await finalize(ctx, s.id)).status).toBe(409);
    ctx.app.now = Date.parse('2026-11-03T22:00:00-05:00');
    d = await dashboard(ctx);
    expect(d.sessions.find((x: any) => x.id === s.id).needsFinalize).toBe(true);
    expect(buildTodo(d).filter((i) => i.kind === 'finalize').map((i: any) => i.session.id)).toEqual([s.id]);
    expect((await finalize(ctx, s.id)).status).toBe(200);
  });

  it('an extra game on Sun Nov 1, 8 to 10 PM (after the change): card at 10:00 PM EST, not at 9:00 PM EST (10 PM EDT)', async () => {
    const ctx = await group();
    const add = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-02T01:00:00.000Z', endsAt: '2026-11-02T03:00:00.000Z' });
    expect(add.status, add.text).toBe(200);
    await joinAll(ctx, add.data.id, ALL.slice(0, 4));
    ctx.app.now = Date.parse('2026-11-01T21:30:00-05:00');
    expect((await dashboard(ctx)).sessions.find((x: any) => x.id === add.data.id).needsFinalize).toBe(false);
    ctx.app.now = Date.parse('2026-11-01T22:00:00-05:00');
    expect((await dashboard(ctx)).sessions.find((x: any) => x.id === add.data.id).needsFinalize).toBe(true);
  });

  it('the Thu Oct 29 game (EDT) card appears at 10:00 PM EDT and stays days later across the change', async () => {
    const ctx = await group();
    const s = await on(ctx, '2026-10-29');
    expect(s.endsAt).toBe('2026-10-30T02:00:00.000Z');
    await joinAll(ctx, s.id, ALL.slice(0, 4));
    ctx.app.now = Date.parse('2026-10-29T21:59:00-04:00');
    expect((await dashboard(ctx)).sessions.find((x: any) => x.id === s.id).needsFinalize).toBe(false);
    ctx.app.now = Date.parse('2026-10-29T22:00:00-04:00');
    expect((await dashboard(ctx)).sessions.find((x: any) => x.id === s.id).needsFinalize).toBe(true);
    ctx.app.now = Date.parse('2026-11-02T09:00:00-05:00');
    expect((await dashboard(ctx)).sessions.find((x: any) => x.id === s.id).needsFinalize).toBe(true);
  });
});

void DAY;
