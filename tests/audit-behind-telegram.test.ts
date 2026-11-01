// Behind-the-scenes audit (Sun Nov 1, 2026): what goes to Telegram. Names
// that look like formatting or links, message size, the bot token, and the
// one-tappable-link rule. Telegram is a stub: nothing real is ever sent.
import { describe, expect, it } from 'vitest';
import { linkText } from '../server/telegram-links';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

const TOKEN = '123456:FAKE-audit-token-never-real';
const CHAT = '9988776655';
const SECRET = 'audit-cron-secret-0123456789abcdef0123456789';
const at = (iso: string) => Date.parse(iso);

async function group() {
  const app = new TestApp();
  const bodies: any[] = [];
  const urls: string[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    CRON_SECRET: SECRET,
    GO_LINKS: 'on',
    TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  return { app, ctx, bodies, urls };
}

const ALLOWED_HOSTS = new Set(['pickleball.juncaj.net', 'mobileapp.courtreserve.com', 'app.courtreserve.com']);

describe('player names in Telegram alerts', () => {
  const HOSTILE = [
    'Bob: https://evil.example',
    'Al_ice *bold* _x_',
    '<b>Sam</b> & "Q"',
    "Robert'); DROP TABLE players;--",
    'Zoë 🏓 Ñandú',
    'x: http://evil.example/a?b=c',
  ];

  it('a name never becomes a tappable link, and formatting characters arrive as plain letters', async () => {
    const g = await group();
    g.app.now = at('2026-11-02T17:00:00Z'); // Mon noon: Tue Nov 3 8:00 PM is 32 hours away
    const dash = (await g.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    const ids: string[] = [];
    for (const name of HOSTILE) {
      const r = await g.ctx.organizer.call('POST', '/api/admin/players', { name, phone: null, isRegular: true, isActive: true });
      expect(r.status, name).toBe(200);
      ids.push(r.data.id);
    }
    const phones = [];
    for (const id of ids.slice(0, 4)) {
      const p = g.ctx.app.client();
      p.groupKey = g.ctx.groupKey;
      expect((await p.call('POST', '/api/me', { playerId: id })).status).toBe(200);
      phones.push(p);
      expect((await p.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    }
    await g.app.settle();
    // The 4th made it "on"; now each one drops inside 36 hours.
    for (const p of phones) await p.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    // Two more join and drop too.
    for (const id of ids.slice(4)) {
      const p = g.ctx.app.client();
      p.groupKey = g.ctx.groupKey;
      await p.call('POST', '/api/me', { playerId: id });
      await p.call('POST', `/api/sessions/${s.id}/join`, {});
      await p.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    }
    await g.app.settle();
    expect(g.bodies.length).toBeGreaterThan(4);
    for (const b of g.bodies) {
      expect(b.parse_mode).toBeUndefined(); // plain text: * _ < > can't change formatting
      for (const e of b.entities ?? []) expect(ALLOWED_HOSTS.has(new URL(e.url).host), e.url).toBe(true);
      expect(b.reply_markup.inline_keyboard[0][0].url).toBe('https://pickleball.juncaj.net/admin');
      expect(b.link_preview_options).toEqual({ is_disabled: true });
    }
    const all = g.bodies.map((b) => b.text).join('\n');
    expect(all).toContain('Al_ice *bold* _x_');
    expect(all).toContain('<b>Sam</b> & "Q"');
    expect(all).toContain('Zoë 🏓 Ñandú');
    // The hostile name is still shown, as plain words.
    expect(all).toContain('Bob: https://evil.example');
  });

  it('linkText only turns addresses into links when the caller allows them', () => {
    const allowed = (u: string) => new URL(u).host === 'pickleball.juncaj.net';
    const out = linkText('Bob: https://evil.example dropped out. Text the group: https://pickleball.juncaj.net/go/abc', () => false, allowed);
    expect(out.text).toBe('Bob: https://evil.example dropped out. Text the group');
    expect(out.entities.map((e) => e.url)).toEqual(['https://pickleball.juncaj.net/go/abc']);
  });
});

describe('message size and the bot token', () => {
  it('ten 40-letter names in one alert stay far under Telegram\'s 4,096 characters', async () => {
    const { alertMessage } = await import('../shared/alerts');
    const p = (i: number) => ({ playerId: `p${i}`, name: `${'W'.repeat(38)}${String(i).padStart(2, '0')}` });
    const before = Array.from({ length: 10 }, (_, i) => p(i));
    const after = [...before.slice(1), ...Array.from({ length: 9 }, (_, i) => p(20 + i))];
    const text = alertMessage({
      actor: p(0),
      before,
      after,
      startsAt: '2026-11-04T01:00:00.000Z',
      deadlineMs: at('2026-11-03T13:00:00Z'),
      nowMs: at('2026-11-03T20:00:00Z'),
      timezone: 'America/Detroit',
      prefs: { enabled: true, drop36: true, belowMin: true, reachedMin: true, refundRequests: true },
    })!;
    expect(text.length).toBeLessThan(1200);
    expect(text).toMatch(/Late drop: W+00 dropped out of Tue Nov 3, 8:00 PM \(5 hrs before\)\./);
  });

  it('the bot token never shows in an answer, an error, the Settings screen, or a log line', async () => {
    const g = await group();
    const logs: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    try {
      // Telegram failing in every way, including an error message that carries the request address.
      const fails: (() => Promise<Response>)[] = [
        async () => {
          throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`);
        },
        async () => new Response(JSON.stringify({ ok: false, description: `Unauthorized bot${TOKEN}` }), { status: 401 }),
        async () => new Response('<html>bad gateway</html>', { status: 502 }),
      ];
      for (const f of fails) {
        g.app.env.TELEGRAM_FETCH = f as unknown as typeof fetch;
        const r1 = await g.ctx.organizer.call('POST', '/api/admin/alerts/test', {});
        const r2 = await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {});
        const d = await g.ctx.organizer.call('GET', '/api/admin/dashboard');
        for (const r of [r1, r2, d]) expect(r.text).not.toContain(TOKEN.split(':')[1]);
        expect(r1.status).toBe(502);
      }
      g.app.now = at('2026-11-03T00:00:00Z');
      await g.ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
      await g.app.settle();
    } finally {
      Object.assign(console, orig);
    }
    expect(logs.join('\n')).not.toContain(TOKEN.split(':')[1]);
  });
});

describe('Telegram slow or down never slows or breaks a player tap', () => {
  it('a tap that triggers an alert answers at once while Telegram hangs', async () => {
    const g = await group();
    g.app.now = at('2026-11-02T17:00:00Z');
    let hung = 0;
    g.app.env.TELEGRAM_FETCH = ((_u: string, init: RequestInit) => {
      hung++;
      // Never answers until the 5-second timeout aborts it.
      return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
    }) as typeof fetch;
    const dash = (await g.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    const names = ['Blair', 'Casey', 'Devon', 'Emery'];
    for (const n of names) {
      const p = await playerPhone(g.ctx, n);
      const t0 = Date.now();
      const r = await p.call('POST', `/api/sessions/${s.id}/join`, {});
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(1000);
    }
    expect(hung).toBe(1); // "reaches 4, it's on" went to the background
    g.app.background.length = 0; // don't wait 5 seconds for the stub
  });

  it('the hour limit holds even when ticks and player taps all want to send', async () => {
    const g = await group();
    g.app.now = at('2026-11-02T17:00:00Z');
    const dash = (await g.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    const phones = [];
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) phones.push(await playerPhone(g.ctx, n));
    // 30 rounds of 4th in / 4th out inside 36 hours: each one an alert.
    for (let i = 0; i < 30; i++) {
      for (const p of phones) await p.call('POST', `/api/sessions/${s.id}/join`, {});
      await phones[3].call('POST', `/api/sessions/${s.id}/withdraw`, {});
      for (const p of phones.slice(0, 3)) await p.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    }
    await g.app.settle();
    expect(g.bodies.length).toBeLessThanOrEqual(20);
    expect(g.bodies.length).toBeGreaterThan(5);
    void HOUR;
  });
});
