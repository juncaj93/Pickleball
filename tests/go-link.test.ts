import { describe, expect, it } from 'vitest';
import { GO_LINK_HOURS, makeGoToken, readGoToken } from '../server/go';
import { HOUR, playerPhone, sentText, setupGroup, TestApp } from './harness';

// The direct text link (/go/<token>) in night-before Telegram alerts.
const SECRET = 'test-cron-secret-0123456789abcdef0123456789';
const TZ = 'America/Detroit';
const at = (iso: string) => Date.parse(iso);
const START = '2026-11-04T01:00:00.000Z'; // Tue Nov 3, 8:00 PM Eastern

describe('the signed token', () => {
  it('reads back the game, and stops working after a few hours', async () => {
    const now = at('2026-11-03T01:00:00Z'); // Mon 8:00 PM
    const t = await makeGoToken(SECRET, 'game-1', START, now);
    expect(await readGoToken(SECRET, t, now)).toEqual({ sessionId: 'game-1', test: false });
    expect(await readGoToken(SECRET, t, now + GO_LINK_HOURS * HOUR - 1)).toEqual({ sessionId: 'game-1', test: false });
    expect(await readGoToken(SECRET, t, now + GO_LINK_HOURS * HOUR)).toEqual({ error: 'expired' });
  });

  it('never outlives the game', async () => {
    const now = at('2026-11-04T00:00:00Z'); // an hour before the start
    const t = await makeGoToken(SECRET, 'game-1', START, now);
    expect(await readGoToken(SECRET, t, at(START))).toEqual({ error: 'expired' });
  });

  it('a changed game id, a changed time, another secret or junk all fail', async () => {
    const now = at('2026-11-03T01:00:00Z');
    const t = await makeGoToken(SECRET, 'game-1', START, now);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'game-2', e: at(START) })).toString('base64url');
    expect(await readGoToken(SECRET, `${forged}.${sig}`, now)).toEqual({ error: 'invalid' });
    const later = Buffer.from(JSON.stringify({ s: 'game-1', e: at('2027-01-01T00:00:00Z') })).toString('base64url');
    expect(await readGoToken(SECRET, `${later}.${sig}`, now)).toEqual({ error: 'invalid' });
    expect(await readGoToken('another-secret-0123456789abcdef0123456789', t, now)).toEqual({ error: 'invalid' });
    for (const junk of ['', 'x', `${payload}.`, `.${sig}`, `${t}.x`, `${payload}.${sig.slice(0, -2)}`, 'a'.repeat(400)]) {
      expect(await readGoToken(SECRET, junk, now)).toEqual({ error: 'invalid' });
    }
  });
});

async function group() {
  const app = new TestApp();
  const sent: string[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: '123456:FAKE-test-token-never-real',
    TELEGRAM_CHAT_ID: '9988776655',
    CRON_SECRET: SECRET,
    GO_LINKS: 'on',
    TELEGRAM_FETCH: (async (_u: string, init: RequestInit) => {
      sent.push(sentText(JSON.parse(String(init.body))));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  app.now = at('2026-11-02T17:00:00Z');
  const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const sessions = (await dash()).sessions;
  const tue = sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03');
  await ctx.organizer.call('POST', `/api/admin/sessions/${tue.id}/booked`, {});
  for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${tue.id}/join`, {});
  await app.settle();
  sent.length = 0;
  const visitor = app.client(); // no admin sign-in, no name picked
  const open = (token: string) => visitor.call('POST', '/api/go', { token });
  return { app, ctx, sent, tue, dash, open };
}

describe('the /api/go endpoint', () => {
  it('the 8:00 PM alert carries the link; opening it gives the Need players text with no numbers and quiets the card', async () => {
    const g = await group();
    g.app.now = at('2026-11-03T00:00:00Z'); // Mon 7:00 PM, the last call
    await g.ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await g.app.settle();
    expect(g.sent).toHaveLength(1);
    const m = /^Tuesday: 3 players in, need a 4th\. Text the group: https:\/\/pickleball\.juncaj\.net\/go\/([A-Za-z0-9_.-]+)$/.exec(g.sent[0]);
    expect(m).not.toBeNull();
    const r = await g.open(m![1]);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, kind: 'need', body: 'Need 1 more for pickleball tomorrow, 8:00 PM. In? pickleball.juncaj.net', test: false });
    expect(r.text).not.toMatch(/555|\(313\)|\$|venmo|\/g\//i);
    expect((await g.dash()).taskMarks).toContain(`${g.tue.id}:night_text`);
  });

  it('with the direct link switched off, the night alert has no link in its words (Open site is the way in)', async () => {
    const g = await group();
    g.app.env = { ...g.app.env, GO_LINKS: 'off' };
    g.app.now = at('2026-11-03T00:00:00Z');
    await g.ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await g.app.settle();
    expect(g.sent).toEqual(['Tuesday: 3 players in, need a 4th. Text the group']);
  });

  it('the TEST smart alert carries a TEST direct link that opens the text but never marks it done', async () => {
    const g = await group();
    expect((await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {})).status).toBe(200);
    await g.app.settle();
    const m = /^TEST smart alert from Pickleball Bros\. Nothing to do\. Real ones look like: "Tuesday: 3 players in, need a 4th\. Text the group: https:\/\/pickleball\.juncaj\.net\/go\/([A-Za-z0-9_.-]+)"$/.exec(g.sent[0]);
    expect(m).not.toBeNull();
    const r = await g.open(m![1]);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ kind: 'need', test: true });
    expect((await g.dash()).taskMarks).toEqual([]);
    // Switched off: no TEST link.
    g.app.env = { ...g.app.env, GO_LINKS: 'off' };
    g.sent.length = 0;
    await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {});
    await g.app.settle();
    expect(g.sent[0]).not.toMatch(/\/go\//);
    expect(g.sent[0]).toBe('TEST smart alert from Pickleball Bros. Nothing to do. Real ones look like: "Tuesday: 3 players in, need a 4th. Text the group"');
  });

  it('4 or more: the Check-in text', async () => {
    const g = await group();
    await (await playerPhone(g.ctx, 'Emery')).call('POST', `/api/sessions/${g.tue.id}/join`, {});
    const t = await makeGoToken(SECRET, g.tue.id, g.tue.startsAt, g.app.now);
    expect((await g.open(t)).data).toMatchObject({ kind: 'checkin', body: "Pickleball tomorrow, 8:00 PM. Can't make it? Update here: pickleball.juncaj.net" });
  });

  it('expired, canceled, unknown or forged links say so and save nothing', async () => {
    const g = await group();
    const t = await makeGoToken(SECRET, g.tue.id, g.tue.startsAt, g.app.now);
    g.app.now += GO_LINK_HOURS * HOUR;
    expect((await g.open(t)).status).toBe(410);
    g.app.now -= GO_LINK_HOURS * HOUR;
    expect((await g.open(await makeGoToken(SECRET, 'no-such-game', g.tue.startsAt, g.app.now))).status).toBe(404);
    expect((await g.open(await makeGoToken('wrong-secret-0123456789abcdef0123456789', g.tue.id, g.tue.startsAt, g.app.now))).status).toBe(404);
    expect((await g.open('nonsense')).status).toBe(404);
    expect((await g.dash()).taskMarks).toEqual([]);
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${g.tue.id}/decision`, { decision: 'cancel', confirm: true });
    expect((await g.open(t)).status).toBe(410);
    // Switched off (GO_LINKS not "on"), no link works and alerts use the admin link.
    g.app.env = { ...g.app.env, GO_LINKS: 'off' };
    expect((await g.open(await makeGoToken(SECRET, g.tue.id, g.tue.startsAt, g.app.now))).status).toBe(404);
    g.app.env = { ...g.app.env, GO_LINKS: 'on' };
    // Without the secret on the site, no link works at all.
    g.app.env = { ...g.app.env, CRON_SECRET: undefined };
    expect((await g.open(t)).status).toBe(404);
  });
});
