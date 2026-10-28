import { describe, expect, it } from 'vitest';
import { alertMessage, DEFAULT_ALERT_PREFS } from '../shared/alerts';
import { MAX_ALERTS_PER_HOUR } from '../server/alerts';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

// Telegram is always faked here: no test ever sends a real message.
const TOKEN = '123456:FAKE-test-token-never-real';
const CHAT = '9988776655';
const TZ = 'America/Detroit';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
interface Sent {
  url: string;
  body: { chat_id: string; text: string; reply_markup: { inline_keyboard: { text: string; url: string }[][] } };
}

/** A set-up group with Telegram connected to a fake that records every message. */
async function connectedGroup(fake?: (url: string, init: RequestInit) => Promise<Response>) {
  const app = new TestApp();
  const sent: Sent[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return fake ? fake(url, init) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  // Every answer the browser gets in these tests, to check nothing secret leaks.
  const seen: string[] = [];
  for (const c of [ctx.organizer]) {
    const call = c.call.bind(c);
    c.call = async (...args: Parameters<typeof call>) => {
      const r = await call(...args);
      const h: string[] = [];
      r.headers.forEach((value, key) => h.push(`${key}: ${value}`));
      seen.push(r.text, ...h);
      return r;
    };
  }
  return { ctx, sent, seen, texts: async () => (await app.settle(), sent.map((s) => s.body.text)) };
}

async function dash(ctx: Ctx) {
  return (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
}
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) {
    const r = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
    if (r.status !== 200) throw new Error(r.text);
  }
}
async function out(ctx: Ctx, id: string, name: string) {
  return (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/withdraw`, {});
}

describe('alert wording', () => {
  const base = {
    actor: { playerId: 'r', name: 'Ryan' },
    startsAt: '2026-11-06T01:00:00.000Z', // Thu Nov 5, 8:00 PM Eastern
    deadlineMs: Date.parse('2026-11-05T13:00:00.000Z'),
    timezone: TZ,
    prefs: DEFAULT_ALERT_PREFS,
  };
  const p = (...n: string[]) => n.map((name) => ({ playerId: name.toLowerCase(), name }));

  it('matches the example: Late drop, game time in Eastern with AM/PM, count and need', () => {
    const text = alertMessage({ ...base, before: [...p('A', 'B', 'C'), base.actor], after: p('A', 'B', 'C'), nowMs: Date.parse('2026-11-05T16:00:00.000Z') });
    expect(text).toBe('Late drop: Ryan dropped out of Thu Nov 5, 8:00 PM (9 hrs before). 3 in now, need 4 or 6.');
  });
});

describe('Telegram alerts', () => {
  it('drop alert: 35:59 before the start sends, 36:01 does not', async () => {
    const { ctx, texts } = await connectedGroup();
    const s = await on(ctx, '2026-10-29'); // Thu 8:00 PM
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // 4 in, Emery waiting
    ctx.app.now = Date.parse(s.startsAt) - 36 * HOUR - 60_000;
    await out(ctx, s.id, 'Devon'); // Emery moves up, still 4: nothing to say this early
    expect(await texts()).toEqual([]);
    await join(ctx, s.id, ['Devon']); // Devon now waits
    ctx.app.now = Date.parse(s.startsAt) - 36 * HOUR + 60_000;
    await out(ctx, s.id, 'Alex');
    expect(await texts()).toEqual(['Alex dropped out of Thu Oct 29, 8:00 PM (35 hrs before). Devon moved up from the waitlist. 4 in now.']);
  });

  it('4 to 3 alerts even days ahead; 4 to 5 and 5 to 4 do not', async () => {
    const { ctx, texts, sent } = await connectedGroup();
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']); // "4 to 5": the 5th waits
    expect(await texts()).toEqual([]);
    await out(ctx, s.id, 'Emery');
    await out(ctx, s.id, 'Devon'); // 80 hours ahead
    expect(await texts()).toEqual(['Devon dropped out of Thu Oct 29, 8:00 PM (3 days before). 3 in now, need 4 or 6.']);
    sent.length = 0;
    // 5 to 4: get to 6, drop to 5 (alerts), then 5 to 4 says nothing.
    await join(ctx, s.id, ['Devon', 'Emery', 'Frankie']);
    await out(ctx, s.id, 'Frankie');
    sent.length = 0;
    await out(ctx, s.id, 'Emery');
    expect(await texts()).toEqual([]);
  });

  it('6 to 5 alerts, and 5 to 6 or 4 to 6 alerts with who to text', async () => {
    const { ctx, texts, sent } = await connectedGroup();
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    expect(await texts()).toEqual([]);
    await join(ctx, s.id, ['Frankie']); // 4 to 6: Emery and Frankie move in together
    expect(await texts()).toEqual(['Thu Oct 29, 8:00 PM has 6 now. Text Emery and Frankie, they\'re in.']);
    sent.length = 0;
    await out(ctx, s.id, 'Blair');
    expect(await texts()).toEqual(['Blair dropped out of Thu Oct 29, 8:00 PM (3 days before). 5 in now, need 4 or 6.']);
    sent.length = 0;
    await join(ctx, s.id, ['Blair']); // 5 to 6
    expect(await texts()).toEqual(['Thu Oct 29, 8:00 PM has 6 now. Text Blair, they\'re in.']);
  });

  it('"Late drop:" only after the cancellation deadline, in one combined message', async () => {
    const { ctx, texts, sent } = await connectedGroup();
    const s = await on(ctx, '2026-10-27'); // Tue 8:00 PM, deadline 8:00 AM
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 13 * HOUR; // before the deadline
    await out(ctx, s.id, 'Devon');
    expect(await texts()).toEqual(['Devon dropped out of Tue Oct 27, 8:00 PM (13 hrs before). 3 in now, need 4 or 6.']);
    sent.length = 0;
    await join(ctx, s.id, ['Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 9 * HOUR; // after it
    await out(ctx, s.id, 'Devon'); // a drop inside 36 hours AND 4 to 3: one message
    expect(await texts()).toEqual(['Late drop: Devon dropped out of Tue Oct 27, 8:00 PM (9 hrs before). 3 in now, need 4 or 6.']);
    expect(sent[0].body.chat_id).toBe(CHAT);
    expect(sent[0].body.reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Open site', url: 'https://pickleball.juncaj.net/admin' });
  });

  it('a texted back-out link alerts like a tap, using the booking\'s own deadline', async () => {
    const { ctx, texts } = await connectedGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // A 30-hour deadline on this booking: a drop 20 hours out is already late.
    const booked = await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/booking`, {
      bookingStatus: 'booked',
      cancellationDeadlineAt: new Date(Date.parse(s.startsAt) - 30 * HOUR).toISOString(),
    });
    expect(booked.status).toBe(200);
    const links = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/links`, { kind: 'attendance' });
    const draft = links.data.drafts.find((d: any) => d.name === 'Casey');
    const token = String(draft.url).split('/t/')[1];
    ctx.app.now = Date.parse(s.startsAt) - 20 * HOUR;
    const r = await ctx.app.client().call('POST', '/api/link/act', { token, action: 'withdraw' });
    expect(r.status).toBe(200);
    expect(await texts()).toEqual(['Late drop: Casey dropped out of Tue Oct 27, 8:00 PM (20 hrs before). 3 in now, need 4 or 6.']);
  });

  it("never alerts on the organizer's own taps", async () => {
    const { ctx, texts } = await connectedGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Robin' });
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey']);
    ctx.app.now = Date.parse(s.startsAt) - 9 * HOUR;
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: false })).status).toBe(200); // 4 to 3, late
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: true });
    // The organizer's own name picked on a phone counts as the organizer too.
    const me = (await dash(ctx)).me;
    const phone = ctx.app.client();
    phone.groupKey = ctx.groupKey;
    await phone.call('POST', '/api/me', { playerId: me.id });
    expect((await phone.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    // Removing a player from the roster is the organizer's tap too.
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName.Alex, action: 'withdraw' });
    expect(await texts()).toEqual([]);
  });

  it('View as, the demo copy and Pretend it\'s... never send', async () => {
    const { ctx, texts } = await connectedGroup();
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    ctx.app.now = Date.parse(s.startsAt) - 9 * HOUR;
    const asDevon = { 'X-View-As': ctx.byName.Devon };
    expect((await ctx.organizer.call('POST', `/api/sessions/${s.id}/withdraw`, {}, asDevon)).status).toBe(403);
    const pretend = { 'X-Pretend-Now': new Date(ctx.app.now).toISOString() };
    expect((await (await playerPhone(ctx, 'Devon')).call('POST', `/api/sessions/${s.id}/withdraw`, {}, pretend)).status).toBe(401);
    expect((await ctx.organizer.call('POST', `/api/sessions/${s.id}/withdraw`, {}, { ...asDevon, ...pretend })).status).toBe(403);
    expect((await ctx.organizer.call('POST', '/api/admin/alerts/test', {}, pretend)).status).toBe(403);
    // The in-browser demo runs the same code with SANDBOX set: taps work there, alerts don't.
    ctx.app.env = { ...ctx.app.env, SANDBOX: true };
    expect((await ctx.organizer.call('POST', `/api/sessions/${s.id}/withdraw`, {}, asDevon)).status).toBe(200);
    expect((await out(ctx, s.id, 'Casey')).status).toBe(200);
    expect((await ctx.organizer.call('POST', '/api/admin/alerts/test', {})).status).toBe(403);
    expect(await texts()).toEqual([]);
  });

  it('canceled, past and hidden games never send', async () => {
    const { ctx, texts } = await connectedGroup();
    const tue = await on(ctx, '2026-10-27');
    const thu = await on(ctx, '2026-10-29');
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await out(ctx, thu.id, 'Devon')).status).toBe(409);
    // Hidden: the first session date moved past Tuesday.
    await ctx.organizer.call('PUT', '/api/admin/group', { firstSessionDate: '2026-10-28' });
    ctx.app.now = Date.parse(tue.startsAt) - 9 * HOUR;
    await out(ctx, tue.id, 'Devon');
    await ctx.organizer.call('PUT', '/api/admin/group', { firstSessionDate: null });
    // Past: after the start nobody can drop at all.
    ctx.app.now = Date.parse(tue.startsAt) + HOUR;
    expect((await out(ctx, tue.id, 'Casey')).status).toBe(409);
    expect(await texts()).toEqual([]);
  });

  it('follows the switches in Settings', async () => {
    const { ctx, texts, sent } = await connectedGroup();
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await ctx.organizer.call('PUT', '/api/admin/alerts', { belowMin: false })).status).toBe(200);
    await out(ctx, s.id, 'Devon'); // 4 to 3, days out: that switch is off
    expect(await texts()).toEqual([]);
    await join(ctx, s.id, ['Devon']);
    await ctx.organizer.call('PUT', '/api/admin/alerts', { belowMin: true, enabled: false });
    await out(ctx, s.id, 'Devon');
    expect(await texts()).toEqual([]);
    await join(ctx, s.id, ['Devon']);
    await ctx.organizer.call('PUT', '/api/admin/alerts', { enabled: true });
    await out(ctx, s.id, 'Devon');
    expect(await texts()).toHaveLength(1);
    const a = (await dash(ctx)).alerts;
    expect(a).toMatchObject({ enabled: true, drop36: true, belowMin: true, reachedSix: true, connected: true, lastOk: true });
    expect(sent).toHaveLength(1);
    expect((await ctx.organizer.call('PUT', '/api/admin/alerts', { enabled: 'yes' })).status).toBe(400);
    expect((await ctx.app.client().call('PUT', '/api/admin/alerts', { enabled: false })).status).toBe(401);
    expect((await ctx.app.client().call('POST', '/api/admin/alerts/test', {})).status).toBe(401);
  });

  it(`stops at ${MAX_ALERTS_PER_HOUR} alerts an hour`, async () => {
    const { ctx, sent } = await connectedGroup();
    for (let i = 0; i < MAX_ALERTS_PER_HOUR; i++) expect((await ctx.organizer.call('POST', '/api/admin/alerts/test', {})).status).toBe(200);
    const over = await ctx.organizer.call('POST', '/api/admin/alerts/test', {});
    expect(over.status).toBe(502);
    expect(over.data.message).toBe('Paused: more than 20 alerts in an hour.');
    // A burst of taps can't get past it either.
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await out(ctx, s.id, 'Devon');
    await ctx.app.settle();
    expect(sent).toHaveLength(MAX_ALERTS_PER_HOUR);
    expect((await dash(ctx)).alerts).toMatchObject({ lastOk: false, lastError: 'Paused: more than 20 alerts in an hour.' });
    ctx.app.advance(HOUR + 60_000);
    expect((await ctx.organizer.call('POST', '/api/admin/alerts/test', {})).status).toBe(200);
  });

  it("a broken or slow Telegram never breaks or holds up a player's tap", async () => {
    let mode: 'throw' | 'error' | 'hang' = 'throw';
    const { ctx, sent } = await connectedGroup(async () => {
      if (mode === 'throw') throw new TypeError('network down');
      if (mode === 'error') return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
      return new Promise<Response>(() => {}); // never answers
    });
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    expect((await out(ctx, s.id, 'Devon')).status).toBe(200);
    await ctx.app.settle();
    expect((await dash(ctx)).alerts).toMatchObject({ lastOk: false, lastError: "Couldn't reach Telegram." });
    mode = 'error';
    await join(ctx, s.id, ['Devon']);
    expect((await out(ctx, s.id, 'Devon')).status).toBe(200);
    await ctx.app.settle();
    expect((await dash(ctx)).alerts.lastError).toBe("The bot can't message you yet. Open the bot in Telegram and tap Start.");
    const test = await ctx.organizer.call('POST', '/api/admin/alerts/test', {});
    expect(test.status).toBe(502);
    expect(test.data.message).toBe("The bot can't message you yet. Open the bot in Telegram and tap Start.");
    // Hanging: the tap answers right away; the send is left running in the background.
    mode = 'hang';
    await join(ctx, s.id, ['Devon']);
    const res = await Promise.race([out(ctx, s.id, 'Devon'), new Promise((r) => setTimeout(() => r('held up'), 2000))]);
    expect((res as { status: number }).status).toBe(200);
    expect(sent.length).toBe(3 + 1);
  });

  it('not connected: nothing sent, Settings says so, the test button explains', async () => {
    const app = new TestApp();
    let calls = 0;
    app.env = { ...app.env, TELEGRAM_FETCH: (async () => (calls++, new Response('{}'))) as typeof fetch };
    const ctx = await setupGroup(app);
    const s = await on(ctx, '2026-10-29');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await out(ctx, s.id, 'Devon');
    await app.settle();
    expect(calls).toBe(0);
    expect((await dash(ctx)).alerts).toMatchObject({ connected: false, lastAt: null });
    const test = await ctx.organizer.call('POST', '/api/admin/alerts/test', {});
    expect(test.status).toBe(409);
    expect(test.data.message).toMatch(/^Not connected/);
  });

  it('no token or chat ID in any browser answer, and no phone numbers or money in any message', async () => {
    const { ctx, sent, seen, texts } = await connectedGroup(async () => new Response(JSON.stringify({ ok: false, description: `Unauthorized ${TOKEN}` }), { status: 401 }));
    const s = await on(ctx, '2026-10-27');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    ctx.app.now = Date.parse(s.startsAt) - 9 * HOUR;
    await out(ctx, s.id, 'Frankie');
    await out(ctx, s.id, 'Emery');
    await out(ctx, s.id, 'Devon');
    await ctx.organizer.call('POST', '/api/admin/alerts/test', {});
    await ctx.organizer.call('GET', '/api/admin/dashboard');
    await ctx.organizer.call('GET', '/api/admin/backup');
    await ctx.organizer.call('GET', '/api/admin/export');
    const player = await playerPhone(ctx, 'Alex');
    seen.push((await player.call('GET', '/api/group')).text);
    const all = seen.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('FAKE-test-token');
    expect(all).not.toContain(CHAT);
    expect((await dash(ctx)).alerts.lastError).toBe('Telegram refused the bot token. Check TELEGRAM_BOT_TOKEN on Cloudflare.');
    const messages = await texts();
    expect(messages.length).toBeGreaterThanOrEqual(4);
    for (const m of messages) {
      expect(m).not.toMatch(/\$|\d{3}\D{0,2}\d{3}\D?\d{4}|555|paid|owe|credit/i);
    }
    // Only ever the one chat.
    expect(new Set(sent.map((x) => x.body.chat_id))).toEqual(new Set([CHAT]));
  });
});
