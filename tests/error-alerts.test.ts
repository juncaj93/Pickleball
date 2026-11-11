// Zip 21: Error alerts (ERROR_ALERTS, ships OFF). The box's rule book, the words, each of the 4 triggers through the real routes,
// the anti-spam limits, a Telegram failure never breaking a tick, OFF equals main, and no private data in any message.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { boxStep, easternDay, emptyBox, errorClass, ERROR_ALERTS, errorText, extraLine, LIMITS, limitResetMs, type BoxState } from '../shared/errorAlerts';
import { noteServerError, resetErrorMemory, resetTestTimer, tickWork } from '../server/errorAlerts';
import { handleBox, parseOp } from '../worker/box';
import { backupFailure, backupTick, knock, report, siteDidNotAnswer } from '../worker/cron';
import { makeCtx } from '../server/context';
import { activityText } from '../shared/activity';
import { HOUR, PLAYER_NAMES, setupGroup, TestApp, withoutIds } from './harness';

const TOKEN = '123456:FAKE-test-token-never-real';
const CHAT = '9988776655';
const SECRET = 'cron-secret-for-tests-0123456789abcdef';
const SITE = 'https://pickleball.juncaj.net';
const ADMIN = `${SITE}/admin`;
const MIN = 60_000;
// Sun Nov 8, 2026, 3:00 AM Eastern (EST).
const SUN_3AM = Date.parse('2026-11-08T08:00:00Z');

// ---------- a stand-in error box (the real handler, an in-memory store) ----------

function fakeBox() {
  const store = new Map<string, unknown>();
  const storage = {
    get: async <T,>(k: string) => store.get(k) as T | undefined,
    put: async <T,>(k: string, v: T) => void store.set(k, structuredClone(v)),
  };
  const box = { calls: 0, broken: false, store };
  const ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (req: Request) => {
        box.calls++;
        if (box.broken) throw new Error('box down');
        return handleBox(storage, req);
      },
    }),
  };
  return { box, ns };
}

/** A database that fails every query with this error (the database being down or over its limit). */
function failingDb(db: any, err: Error) {
  return new Proxy(db, {
    get(t, k) {
      if (k === 'prepare' || k === 'batch') return () => { throw err; };
      return Reflect.get(t, k);
    },
  });
}

async function world(opts: { box?: boolean; on?: boolean; telegram?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
  const app = new TestApp();
  app.now = SUN_3AM;
  const sent: string[] = [];
  const sentAt: number[] = [];
  const { box, ns } = fakeBox();
  app.env = {
    ...app.env,
    SITE_URL: SITE,
    CRON_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    ...(opts.box === false ? {} : { ERROR_BOX: ns }),
    TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // The address leaves the visible text and becomes the link on the last words: put it back to compare whole messages.
      sent.push(body.entities?.length ? `${body.text}: ${body.entities[0].url}` : body.text);
      sentAt.push(app.now);
      return opts.telegram ? opts.telegram(url, init) : new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
  };
  const g = await setupGroup(app);
  const realDb = app.env.DB;
  if (opts.on) expect((await g.organizer.call('PUT', '/api/admin/error-alerts-switch', { on: true })).status).toBe(200);
  await app.settle();
  sent.length = 0;
  const tick = async () => {
    const r = await g.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await app.settle();
    return r;
  };
  const failTick = async (err = new Error('D1_ERROR: boom')) => {
    app.env.DB = failingDb(realDb, err);
    try {
      return await tick();
    } finally {
      app.env.DB = realDb;
    }
  };
  const cronReport = async (what: string, secret = SECRET) => {
    const r = await g.organizer.call('POST', '/api/cron/report', { what }, { 'X-Cron-Secret': secret });
    await app.settle();
    return r;
  };
  return { app, g, sent, sentAt, box, tick, failTick, cronReport, realDb };
}

beforeEach(() => {
  resetErrorMemory();
  resetTestTimer();
});
afterEach(() => resetErrorMemory());

// ---------- the box's rule book ----------

describe("the error box's rules (shared/errorAlerts.ts boxStep)", () => {
  const on = (): BoxState => boxStep(emptyBox(), { op: 'sync', on: true }, SUN_3AM).state;
  const ask = (s: BoxState, at: number, kind: 'clock' | 'backup' | 'database' | 'server_errors' = 'clock') => boxStep(s, { op: 'ask', kind }, at);

  it('off: nothing is ever sent', () => {
    const r = ask(emptyBox(), SUN_3AM);
    expect(r.out).toMatchObject({ send: false, off: true });
  });
  it('one message per kind an hour; the ones held back ride along on the next one', () => {
    let s = on();
    let r = ask(s, SUN_3AM);
    expect(r.out).toMatchObject({ send: true, extra: null });
    s = r.state;
    for (let i = 1; i <= 3; i++) {
      r = ask(s, SUN_3AM + i * 5 * MIN);
      expect(r.out).toMatchObject({ send: false });
      s = r.state;
    }
    // Another kind in the same hour is its own slot.
    r = ask(s, SUN_3AM + 20 * MIN, 'backup');
    expect(r.out).toMatchObject({ send: true, extra: { n: 3, since: SUN_3AM + 5 * MIN } });
    s = r.state;
    r = ask(s, SUN_3AM + 59 * MIN);
    expect(r.out).toMatchObject({ send: false });
    r = ask(r.state, SUN_3AM + HOUR);
    expect(r.out).toMatchObject({ send: true, extra: { n: 1 } });
  });
  it('at most 6 a day (Eastern), then everything waits for the next Eastern day', () => {
    let s = on();
    const kinds = ['clock', 'backup', 'database', 'server_errors'] as const;
    let sentCount = 0;
    for (let i = 0; i < 40; i++) {
      const r = ask(s, SUN_3AM + i * 20 * MIN, kinds[i % 4]);
      if ((r.out as any).send) sentCount++;
      s = r.state;
    }
    expect(sentCount).toBe(LIMITS.perDay);
    // Sun 11:59 PM Eastern is still Sunday; 12:00 AM Monday is a new day.
    expect(ask(s, Date.parse('2026-11-09T04:59:00Z')).out).toMatchObject({ send: false });
    const monday = ask(s, Date.parse('2026-11-09T05:00:00Z'));
    expect(monday.out).toMatchObject({ send: true });
    expect((monday.out as any).extra.n).toBeGreaterThan(0);
  });
  it('the clock watch: a gap of 20 minutes or more is reported once; 5 to 15 minutes is normal', () => {
    let s = on();
    for (let t = 5; t <= 15; t += 5) {
      const r = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + t * MIN);
      expect(r.out).toMatchObject({ gap: null, summary: null });
      s = r.state;
    }
    const r = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 50 * MIN);
    expect(r.out).toMatchObject({ gap: { from: SUN_3AM + 15 * MIN, to: SUN_3AM + 50 * MIN } });
    expect(boxStep(r.state, { op: 'tick', seen: true }, SUN_3AM + 55 * MIN).out).toMatchObject({ gap: null });
  });
  it('a gap over 12 hours is not reported (the alerts were paused, not the clock): the watch starts fresh', () => {
    let s = on();
    s = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 5 * MIN).state;
    const r = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 26 * HOUR);
    expect(r.out).toMatchObject({ gap: null });
    expect(boxStep(r.state, { op: 'tick', seen: true }, SUN_3AM + 26 * HOUR + 5 * MIN).out).toMatchObject({ gap: null });
    // 12 hours exactly is still said.
    const r2 = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 5 * MIN + 12 * HOUR);
    expect(r2.out).toMatchObject({ gap: { from: SUN_3AM + 5 * MIN } });
  });
  it('the weekly backup: one message a day at most (it is retried every hour on Sunday)', () => {
    let s = on();
    let n = 0;
    for (let h = 0; h < 20; h++) {
      const r = ask(s, SUN_3AM + h * HOUR, 'backup');
      if ((r.out as any).send) n++;
      s = r.state;
    }
    expect(n).toBe(1);
    // The day's other kinds are not used up by it.
    expect(ask(s, SUN_3AM + 20 * HOUR, 'clock').out).toMatchObject({ send: true });
  });
  it('setting the switch on again, even when the box already had it on, starts fresh', () => {
    let s = on();
    s = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 5 * MIN).state;
    s = ask(s, SUN_3AM + 6 * MIN).state;
    s = ask(s, SUN_3AM + 7 * MIN).state; // held back
    s = boxStep(s, { op: 'sync', on: true }, SUN_3AM + 3 * HOUR).state;
    expect(s.pending).toBe(0);
    expect(boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 3 * HOUR + 5 * MIN).out).toMatchObject({ gap: null, summary: null });
  });
  it('turning the switch on starts fresh: no gap from before, nothing held back from before', () => {
    let s = on();
    s = ask(s, SUN_3AM).state;
    s = ask(s, SUN_3AM + MIN).state; // held back
    s = boxStep(s, { op: 'sync', on: false }, SUN_3AM + 2 * MIN).state;
    s = boxStep(s, { op: 'sync', on: true }, SUN_3AM + 5 * HOUR).state;
    expect(s.pending).toBe(0);
    expect(boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 5 * HOUR + 5 * MIN).out).toMatchObject({ gap: null, summary: null });
  });
  it('a tick that did not read the switch (database down) never turns the box on', () => {
    const r = boxStep(emptyBox(), { op: 'tick' }, SUN_3AM);
    expect(r.state.on).toBe(false);
    // A tick that read it on does (the box missed the switch going on), fresh.
    const r2 = boxStep(emptyBox(), { op: 'tick', seen: true }, SUN_3AM);
    expect(r2.state.on).toBe(true);
    expect(r2.out).toMatchObject({ gap: null });
  });
  it('held-back errors are said on their own an hour after the last message', () => {
    let s = on();
    s = ask(s, SUN_3AM).state;
    s = ask(s, SUN_3AM + 10 * MIN).state;
    s = ask(s, SUN_3AM + 20 * MIN).state;
    let r = boxStep(s, { op: 'tick', seen: true }, SUN_3AM + 5 * MIN);
    for (let t = 10; t < 60; t += 5) {
      r = boxStep(r.state, { op: 'tick', seen: true }, SUN_3AM + t * MIN);
      expect(r.out).toMatchObject({ gap: null, summary: null });
    }
    r = boxStep(r.state, { op: 'tick', seen: true }, SUN_3AM + HOUR);
    expect(r.out).toMatchObject({ summary: { n: 2, since: SUN_3AM + 10 * MIN } });
    expect(boxStep(r.state, { op: 'tick', seen: true }, SUN_3AM + HOUR + 5 * MIN).out).toMatchObject({ summary: null });
  });
  it('the box refuses anything that is not one of its three steps', () => {
    expect(parseOp({ op: 'ask', kind: 'nope', nowMs: SUN_3AM })).toBeNull();
    expect(parseOp({ op: 'drop', nowMs: SUN_3AM })).toBeNull();
    expect(parseOp({ op: 'tick' })).toBeNull();
    expect(parseOp({ op: 'sync', on: 'yes', nowMs: SUN_3AM })).toBeNull();
    expect(parseOp({ op: 'ask', kind: 'backup', nowMs: SUN_3AM })).toEqual({ op: { op: 'ask', kind: 'backup' }, nowMs: SUN_3AM });
  });
});

// ---------- the words ----------

describe('the messages (short, Eastern 12-hour, no em dashes, the admin link)', () => {
  const at = SUN_3AM + 5 * MIN; // 3:05 AM
  it('the 4 triggers, word for word', () => {
    expect(errorText.clock('smart alerts', at, null, ADMIN)).toBe(`Site error: the clock's smart alerts job failed at 3:05 AM. Tap to open Admin: ${ADMIN}`);
    expect(errorText.clock('game check', at, null, ADMIN, true)).toBe(`Site error: the clock's game check job failed (a database error) at 3:05 AM. Tap to open Admin: ${ADMIN}`);
    expect(errorText.backup(false, SUN_3AM, null, ADMIN)).toBe(`Site error: the weekly backup failed at 3:00 AM. It tries again in an hour. Tap to open Admin: ${ADMIN}`);
    expect(errorText.backup(true, SUN_3AM, null, ADMIN)).toBe(`Site error: the weekly backup ended INCOMPLETE at 3:00 AM. It tries again in an hour. Tap to open Admin: ${ADMIN}`);
    expect(errorText.database(true, Date.parse('2026-11-08T19:15:00Z'), null, ADMIN)).toBe(`Site error: the database hit its free daily limit at 2:15 PM. The site is down until about 7:00 PM. Tap to open Admin: ${ADMIN}`);
    expect(errorText.database(false, at, null, ADMIN)).toBe(`Site error: database errors on the site at 3:05 AM. Tap to open Admin: ${ADMIN}`);
    expect(errorText.serverErrors(5, at, null, ADMIN)).toBe(`Site error: 5 server errors in 10 minutes at 3:05 AM. Tap to open Admin: ${ADMIN}`);
    expect(errorText.clockStopped(SUN_3AM + 5 * MIN, SUN_3AM + 40 * MIN, null, ADMIN)).toBe(`Site error: the clock stopped for 35 minutes (3:05 AM to 3:40 AM). It is running again. Tap to open Admin: ${ADMIN}`);
    expect(errorText.clockStopped(SUN_3AM, SUN_3AM + 2 * HOUR, null, ADMIN)).toContain('stopped for 2 hours (3:00 AM to 5:00 AM)');
    expect(errorText.clockStopped(SUN_3AM, SUN_3AM + 3 * HOUR + 10 * MIN, null, ADMIN)).toContain('stopped for 3 hours 10 minutes');
    expect(errorText.summary({ n: 4, since: at }, at + 30 * MIN, ADMIN)).toBe(`4 more errors in the last hour. Tap to open Admin: ${ADMIN}`);
    expect(errorText.test(ADMIN)).toMatch(/^TEST error alert from Pickleball\. Nothing is wrong\./);
  });
  it('the held-back count rides along; over an hour old it says since when', () => {
    expect(errorText.backup(false, SUN_3AM + HOUR, { n: 2, since: SUN_3AM + 20 * MIN }, ADMIN)).toBe(
      `Site error: the weekly backup failed at 4:00 AM. It tries again in an hour. 2 more errors in the last hour. Tap to open Admin: ${ADMIN}`,
    );
    expect(extraLine({ n: 1, since: SUN_3AM - 10 * HOUR }, SUN_3AM)).toBe('1 more error since Sat 5:00 PM.');
  });
  it('the database limit resets at midnight UTC: 7:00 PM in winter, 8:00 PM in summer', () => {
    expect(errorText.database(true, Date.parse('2026-07-01T15:00:00Z'), null, ADMIN)).toContain('until about 8:00 PM');
    expect(limitResetMs(Date.parse('2026-11-08T23:59:00Z'))).toBe(Date.parse('2026-11-09T00:00:00Z'));
  });
  it('no em dashes anywhere in the wording file', () => {
    expect(readFileSync('shared/errorAlerts.ts', 'utf8')).not.toContain('—');
    expect(readFileSync('server/errorAlerts.ts', 'utf8')).not.toContain('—');
  });
  it('error words: the free daily limit, other database errors, everything else', () => {
    expect(errorClass(new Error('D1_ERROR: Exceeded daily limit for rows written'))).toBe('db_limit');
    expect(errorClass(new Error('Your account has exceeded the D1 daily rows read limit'))).toBe('db_limit');
    expect(errorClass(new Error('D1_ERROR: Network connection lost.'))).toBe('db');
    expect(errorClass(new Error('SQLITE_BUSY: database is locked'))).toBe('db');
    expect(errorClass(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe('other');
    expect(errorClass(new Error('rate limit exceeded for Telegram'))).toBe('other');
  });
});

// ---------- the 4 triggers through the real routes ----------

describe('trigger 1: the clock tick fails (which job)', () => {
  it('one message, the job named; the tick still answers 500 as before', async () => {
    const w = await world({ on: true });
    expect((await w.tick()).status).toBe(200);
    const r = await w.failTick();
    expect(r.status).toBe(500);
    expect(w.sent).toEqual([`Site error: the clock's game check job failed (a database error) at 3:00 AM. Tap to open Admin: ${ADMIN}`]);
  });
  it('the job is the one running: a failure after the first read is the smart alerts job', async () => {
    const w = await world({ on: true });
    const ctx = makeCtx(new Request(`${SITE}/api/cron/tick`, { method: 'POST' }), w.app.env, w.app.now, (p) => w.app.background.push(p));
    const { tickFailed } = await import('../server/errorAlerts');
    tickFailed(ctx, { ready: true, on: true, job: 'smart alerts' }, new Error('x is undefined'));
    await w.app.settle();
    expect(w.sent).toEqual([`Site error: the clock's smart alerts job failed at 3:00 AM. Tap to open Admin: ${ADMIN}`]);
  });
  it('the clock Worker: no answer at all from the site is told once; the site\'s own 500 is not (it reports that itself)', async () => {
    expect(siteDidNotAnswer(0, null)).toBe(true);
    expect(siteDidNotAnswer(502, 'text/html')).toBe(true);
    expect(siteDidNotAnswer(500, 'application/json; charset=utf-8')).toBe(false);
    expect(siteDidNotAnswer(200, 'application/json')).toBe(false);
    const calls: string[] = [];
    const env = { SITE_URL: SITE, CRON_SECRET: SECRET };
    const fetchDown = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith('/tick')) throw new Error('timeout');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    expect(await knock(env, fetchDown)).toBe(0);
    expect(calls).toEqual([`${SITE}/api/cron/tick`, `${SITE}/api/cron/report`]);
    calls.length = 0;
    const fetchOk = (async (url: string) => (calls.push(String(url)), new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))) as typeof fetch;
    expect(await knock(env, fetchOk)).toBe(200);
    expect(calls).toEqual([`${SITE}/api/cron/tick`]);
    const w = await world({ on: true });
    await w.cronReport('tick_no_answer');
    expect(w.sent).toEqual([`Site error: the clock could not reach the site at 3:00 AM. Tap to open Admin: ${ADMIN}`]);
  });
});

describe('trigger 2: the weekly backup fails or ends INCOMPLETE', () => {
  it('the clock Worker tells the site; the site sends one message', async () => {
    const w = await world({ on: true });
    await w.cronReport('backup_failed');
    expect(w.sent).toEqual([`Site error: the weekly backup failed at 3:00 AM. It tries again in an hour. Tap to open Admin: ${ADMIN}`]);
    w.sent.length = 0;
    // One backup message a day (it is retried every hour): the next one only a day later.
    w.app.now += HOUR;
    await w.cronReport('backup_incomplete');
    expect(w.sent).toEqual([]);
    w.app.now += 23 * HOUR;
    await w.cronReport('backup_incomplete');
    expect(w.sent).toEqual([`Site error: the weekly backup ended INCOMPLETE at 3:00 AM. It tries again in an hour. 1 more error since Sun 4:00 AM. Tap to open Admin: ${ADMIN}`]);
  });
  it('failed or INCOMPLETE, from the backup code\'s own reasons', () => {
    expect(backupFailure('failed: the data changed while copying; tried again at the next hourly look')).toBe('backup_incomplete');
    expect(backupFailure('failed: not every step was saved; tried again at the next hourly look')).toBe('backup_incomplete');
    expect(backupFailure('failed: /backup/step answered 500')).toBe('backup_incomplete');
    expect(backupFailure('failed: the copy would need 47 steps (over 45); not made')).toBe('backup_failed');
    expect(backupFailure('failed: The live database has no players table.')).toBe('backup_failed');
  });
  it('the Worker reports a failed hourly look, and never on a normal one', async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (url: string, init: RequestInit) => (calls.push({ url: String(url), body: String(init.body) }), new Response('{}'))) as typeof fetch;
    const broken = { prepare() { throw new Error('D1_ERROR: boom'); }, batch() { throw new Error('D1_ERROR: boom'); } } as any;
    await backupTick({ SITE_URL: SITE, CRON_SECRET: SECRET, DB: broken, BACKUP: broken }, SUN_3AM, f);
    expect(calls).toEqual([{ url: `${SITE}/api/cron/report`, body: '{"what":"backup_failed"}' }]);
    calls.length = 0;
    await backupTick({ SITE_URL: SITE, CRON_SECRET: SECRET, DB: broken, BACKUP: broken }, SUN_3AM + 10 * MIN, f); // not the hourly look
    await backupTick({ SITE_URL: SITE, CRON_SECRET: SECRET }, SUN_3AM, f); // not set up
    expect(calls).toEqual([]);
    await report({ SITE_URL: SITE, CRON_SECRET: SECRET, ERROR_REPORTS: 'off' }, 'backup_failed', f);
    expect(calls).toEqual([]);
  });
  it('the report route needs the clock secret, and reads nothing it does not need', async () => {
    const w = await world({ on: true });
    expect((await w.cronReport('backup_failed', 'wrong-secret-wrong-secret-wrong-secret')).status).toBe(404);
    expect((await w.cronReport('something_else')).status).toBe(400);
    expect(w.sent).toEqual([]);
  });
});

describe('trigger 3: database errors and bursts of server errors on the live site', () => {
  it('the free daily limit: one message at the first one', async () => {
    const w = await world({ on: true });
    w.app.env.DB = failingDb(w.realDb, new Error('D1_ERROR: Exceeded daily limit for rows read'));
    for (let i = 0; i < 4; i++) expect((await w.g.organizer.call('GET', '/api/admin/dashboard')).status).toBe(500);
    await w.app.settle();
    w.app.env.DB = w.realDb;
    expect(w.sent).toEqual([`Site error: the database hit its free daily limit at 3:00 AM. The site is down until about 7:00 PM. Tap to open Admin: ${ADMIN}`]);
  });
  it('the free daily limit hit during a tick: the box (not the database) decides, and it says so once', async () => {
    const w = await world({ on: true });
    await w.failTick(new Error('D1_ERROR: Exceeded daily limit for rows written'));
    w.app.now += 5 * MIN;
    await w.failTick(new Error('D1_ERROR: Exceeded daily limit for rows written'));
    expect(w.sent).toEqual([`Site error: the database hit its free daily limit at 3:00 AM. The site is down until about 7:00 PM. Tap to open Admin: ${ADMIN}`]);
  });
  it('other database errors: 3 in 10 minutes (one is never a message)', async () => {
    const w = await world({ on: true });
    w.app.env.DB = failingDb(w.realDb, new Error('D1_ERROR: Network connection lost.'));
    await w.g.organizer.call('GET', '/api/admin/dashboard');
    await w.g.organizer.call('GET', '/api/admin/dashboard');
    await w.app.settle();
    expect(w.sent).toEqual([]);
    await w.g.organizer.call('GET', '/api/admin/dashboard');
    await w.app.settle();
    w.app.env.DB = w.realDb;
    expect(w.sent).toEqual([`Site error: database errors on the site at 3:00 AM. Tap to open Admin: ${ADMIN}`]);
  });
  it('a burst: 5 server errors in 10 minutes is one message; a single error is nothing', async () => {
    const w = await world({ on: true });
    const ctx = () => makeCtx(new Request(`${SITE}/api/x`), w.app.env, w.app.now, (p) => w.app.background.push(p));
    noteServerError(ctx(), new TypeError('oops'));
    await w.app.settle();
    expect(w.sent).toEqual([]);
    for (let i = 0; i < 4; i++) {
      w.app.now += MIN;
      noteServerError(ctx(), new TypeError('oops'));
    }
    for (let i = 0; i < 10; i++) noteServerError(ctx(), new TypeError('oops'));
    await w.app.settle();
    expect(w.sent).toEqual([`Site error: 5 server errors in 10 minutes at 3:04 AM. Tap to open Admin: ${ADMIN}`]);
  });
  it("the clock's own routes are never counted as a burst (the tick reports its own errors)", async () => {
    const w = await world({ on: true });
    for (let i = 0; i < 6; i++) noteServerError(makeCtx(new Request(`${SITE}/api/cron/tick`), w.app.env, w.app.now, (p) => w.app.background.push(p)), new TypeError('x'));
    await w.app.settle();
    expect(w.sent).toEqual([]);
  });
});

describe('trigger 4: the clock stopped', () => {
  it('no tick for 20 minutes or more: said on the next tick that runs, with how long', async () => {
    const w = await world({ on: true });
    await w.tick();
    w.app.now += 5 * MIN;
    await w.tick();
    expect(w.sent).toEqual([]);
    w.app.now += 35 * MIN;
    await w.tick();
    expect(w.sent).toEqual([`Site error: the clock stopped for 35 minutes (3:05 AM to 3:40 AM). It is running again. Tap to open Admin: ${ADMIN}`]);
    w.app.now += 5 * MIN;
    await w.tick();
    expect(w.sent).toHaveLength(1);
  });
  it('a tick that failed still reached the site: it is not "stopped"', async () => {
    const w = await world({ on: true });
    await w.tick();
    for (let i = 1; i <= 6; i++) {
      w.app.now += 5 * MIN;
      await w.failTick();
    }
    w.app.now += 5 * MIN;
    await w.tick();
    expect(w.sent.filter((t) => t.includes('stopped'))).toEqual([]);
  });
});

// ---------- anti-spam ----------

describe('anti-spam', () => {
  it('a broken tick every 5 minutes for 3 hours: one message an hour, each with the count held back', async () => {
    const w = await world({ on: true });
    for (let i = 0; i < 36; i++) {
      await w.failTick();
      w.app.now += 5 * MIN;
    }
    expect(w.sent).toHaveLength(3);
    expect(w.sent[0]).toMatch(/^Site error: the clock's game check job failed/);
    expect(w.sent[1]).toContain('11 more errors in the last hour.');
    expect(w.sent[2]).toContain('11 more errors in the last hour.');
  });
  it('never more than 6 a day, whatever happens; the rest is one line the next day', async () => {
    const w = await world({ on: true });
    const kinds = ['backup_failed', 'backup_incomplete', 'tick_no_answer'];
    for (let i = 0; i < 60; i++) {
      await w.cronReport(kinds[i % 3]);
      await w.failTick();
      w.app.now += 10 * MIN;
    }
    // Sun 3:00 AM to Mon 1:00 AM (10 hours of a report and a broken tick every 10 minutes): Sunday gets exactly 6.
    const perDay = new Map<string, number>();
    for (const t of w.sentAt) perDay.set(easternDay(t), (perDay.get(easternDay(t)) ?? 0) + 1);
    expect(perDay.get('2026-11-08')).toBe(6);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(LIMITS.perDay);
  });
  it('the summary on its own once things are quiet for an hour', async () => {
    const w = await world({ on: true });
    await w.cronReport('backup_failed');
    await w.tick();
    w.app.now += 5 * MIN;
    await w.tick();
    w.app.now += 5 * MIN;
    await w.cronReport('backup_failed');
    await w.cronReport('backup_failed');
    for (let i = 0; i < 10; i++) {
      w.app.now += 5 * MIN;
      await w.tick();
    }
    expect(w.sent).toEqual([expect.stringContaining('weekly backup failed'), `2 more errors in the last hour. Tap to open Admin: ${ADMIN}`]);
  });
});

// ---------- never slower, never broken ----------

describe('a Telegram or box failure never breaks a tick, and is never itself an alert', () => {
  it('Telegram down: the tick answers the same; the failure is swallowed (one log line), no loop', async () => {
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      const w = await world({ on: true, telegram: async () => { throw new Error('ECONNRESET'); } });
      const ok = await w.tick();
      expect(ok.status).toBe(200);
      for (let i = 0; i < 36; i++) {
        w.app.now += 5 * MIN;
        expect((await w.failTick()).status).toBe(500);
      }
      expect(w.sent).toHaveLength(3); // one try an hour, nothing more
      expect(logs.filter((l) => l.startsWith('error alerts:'))).toEqual(['error alerts: a Telegram send failed (ECONNRESET)']);
    } finally {
      console.log = log;
    }
  });
  it('the box down: the tick answers the same; nothing is sent', async () => {
    const w = await world({ on: true });
    w.box.broken = true;
    expect((await w.tick()).status).toBe(200);
    expect((await w.failTick()).status).toBe(500);
    expect(w.sent).toEqual([]);
  });
  it('the tick never waits for the box or Telegram: a box that never answers still leaves the tick answering at once', async () => {
    const w = await world({ on: true });
    const ns = w.app.env.ERROR_BOX!;
    w.app.env.ERROR_BOX = { idFromName: ns.idFromName, get: () => ({ fetch: () => new Promise<Response>(() => {}) }) };
    const r = await w.g.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    expect(r.status).toBe(200);
    expect(w.app.background.length).toBeGreaterThan(0); // still waiting, after the answer
    w.app.background.length = 0;
  });
});

// ---------- OFF equals main ----------

describe('OFF equals main', () => {
  it('off: ticks, failing ticks, reports and server errors send nothing; the box is only asked or told "off"', async () => {
    const w = await world({ on: false });
    await w.tick();
    w.app.now += HOUR;
    await w.tick();
    await w.failTick(new Error('D1_ERROR: Exceeded daily limit for rows read'));
    await w.cronReport('backup_failed');
    for (let i = 0; i < 6; i++) noteServerError(makeCtx(new Request(`${SITE}/api/x`), w.app.env, w.app.now, (p) => w.app.background.push(p)), new TypeError('x'));
    await w.app.settle();
    expect(w.sent).toEqual([]);
    // The failing tick could not read the switch (the database was down), so it asked the box once, and the box said off. The
    // report route asked once more; the burst asked at most once, then this run remembers "off" for 10 minutes.
    // Tick 1 tells the box "off" (once an hour per Worker run), tick 2 an hour later again; the failing tick asks once; the report
    // once; the burst once, then this run remembers "off" for 10 minutes.
    expect(w.box.calls).toBeLessThanOrEqual(5);
    expect((w.box.store.get('state') as BoxState).on).toBe(false);
  });
  it('off (the shipped setup: box bound, Telegram connected): a tick answers exactly as with no error alerts; the box hears "off" at most once an hour', async () => {
    const a = await world({ on: false });
    const b = await world({ box: false });
    const calls = a.box.calls;
    const batches: number[] = [];
    const inner = a.app.env.DB as any;
    a.app.env.DB = new Proxy(inner, { get: (t, k) => (k === 'batch' ? (list: any[]) => (batches.push(list.length), t.batch(list)) : Reflect.get(t, k)) });
    for (let i = 0; i < 3; i++) {
      const [ra, rb] = [await a.tick(), await b.tick()];
      expect(ra.status).toBe(rb.status);
      expect(withoutIds(ra.text)).toBe(withoutIds(rb.text));
      a.app.now += 5 * MIN;
      b.app.now += 5 * MIN;
    }
    expect(a.box.calls).toBe(calls + 1);
    expect(a.sent).toEqual([]);
    // The one difference from main while off, accepted: the switch row is read in the tick's same single trip (7 questions, not 6).
    expect(batches).toEqual([7, 7, 7]);
  });
  it('a restore empties the switch row while the box still says on: the next tick tells the box, and nothing is sent', async () => {
    const w = await world({ on: true });
    await w.tick();
    (w.realDb as any).prepare("DELETE FROM task_log WHERE task = 'error_alerts_on'").run();
    resetErrorMemory();
    await w.tick();
    expect((w.box.store.get('state') as BoxState).on).toBe(false);
    await w.cronReport('backup_failed');
    const ctx = () => makeCtx(new Request(`${SITE}/api/x`), w.app.env, w.app.now, (p) => w.app.background.push(p));
    for (let i = 0; i < 6; i++) noteServerError(ctx(), new Error('D1_ERROR: Exceeded daily limit for rows read'));
    await w.app.settle();
    expect(w.sent).toEqual([]);
  });
  it('"Pretend it\'s..." errors are never counted (a made-up time would fill the slots)', async () => {
    const w = await world({ on: true });
    const { readOnly } = await import('../server/pretend');
    const ctx = makeCtx(new Request(`${SITE}/api/x`), { ...w.app.env, DB: readOnly(w.realDb) as any }, Date.parse('2099-01-01T00:00:00Z'), (p) => w.app.background.push(p));
    for (let i = 0; i < 6; i++) noteServerError(ctx, new Error('D1_ERROR: Exceeded daily limit for rows read'));
    await w.app.settle();
    expect(w.sent).toEqual([]);
    expect((w.box.store.get('state') as BoxState).lastAny).toBeNull();
  });
  it('not set up (no box, or the kill switch "off"): the tick asks the database exactly what main asks', async () => {
    for (const env of [{ box: false }, { kill: true }]) {
      const w = await world(env.box === false ? { box: false } : { on: true });
      if (env.kill) w.app.env.ERROR_ALERTS = 'off';
      const seen: string[] = [];
      const db = w.app.env.DB as any;
      w.app.env.DB = new Proxy(db, {
        get(t, k) {
          if (k === 'batch') return (list: any[]) => (seen.push(String(list.length)), t.batch(list));
          return Reflect.get(t, k);
        },
      });
      await w.tick();
      expect(seen).toEqual(['6']);
      expect(w.sent).toEqual([]);
    }
  });
  it('off: the answer to a failing tick is the same 500 as main', async () => {
    const a = await world({ on: false });
    const b = await world({ box: false });
    const [ra, rb] = [await a.failTick(), await b.failTick()];
    expect(ra.status).toBe(500);
    expect(ra.text).toBe(rb.text);
  });
});

// ---------- no private data ----------

describe('no private data in any message', () => {
  it('no names, phone numbers, error words, secrets or stack lines; every message is short', async () => {
    const w = await world({ on: true });
    await w.failTick(new Error('D1_ERROR: boom at Casey 5550142 TOKEN'));
    w.app.now += HOUR;
    await w.cronReport('backup_failed');
    w.app.now += HOUR;
    await w.cronReport('tick_no_answer');
    w.app.now += HOUR;
    w.app.env.DB = failingDb(w.realDb, new Error('D1_ERROR: Exceeded daily limit for rows read by Blair'));
    await w.g.organizer.call('GET', '/api/admin/dashboard');
    await w.app.settle();
    w.app.env.DB = w.realDb;
    w.app.now += 2 * HOUR;
    await w.tick();
    expect(w.sent.length).toBeGreaterThanOrEqual(4);
    for (const t of w.sent) {
      for (const name of PLAYER_NAMES) expect(t).not.toContain(name);
      expect(t).not.toMatch(/\d{3}[-. ]?\d{4}/);
      expect(t).not.toMatch(/boom|D1_|TOKEN|at .*\.ts|Error:/);
      expect(t).not.toContain(TOKEN);
      expect(t).not.toContain(SECRET);
      expect(t).not.toContain('—');
      expect(t.length).toBeLessThan(200);
      expect(t).toMatch(/^Site error: .* Tap to open Admin: https:\/\/pickleball\.juncaj\.net\/admin$/);
    }
  });
  it('the link: "Tap to open Admin" is the tappable words, the address is not shown', async () => {
    const bodies: any[] = [];
    const w = await world({ on: true, telegram: async (_u, init) => (bodies.push(JSON.parse(String(init.body))), new Response('{"ok":true}')) });
    await w.cronReport('backup_failed');
    expect(bodies[0].text).toBe('Site error: the weekly backup failed at 3:00 AM. It tries again in an hour. Tap to open Admin');
    expect(bodies[0].entities).toEqual([{ type: 'text_link', offset: bodies[0].text.length - 'Tap to open Admin'.length, length: 'Tap to open Admin'.length, url: ADMIN }]);
    expect(bodies[0].chat_id).toBe(CHAT);
  });
});

// ---------- the Settings row and the test button ----------

describe('Settings > Feature switches > "Error alerts", and the TEST button', () => {
  it('ships off; on and off save, show on the dashboard, tell the box, and read well in History', async () => {
    const w = await world({ on: false });
    const d0 = (await w.g.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d0.errorAlertsForAll).toBeUndefined();
    expect((await w.g.organizer.call('PUT', '/api/admin/error-alerts-switch', { on: true })).data).toEqual({ ok: true, on: true });
    expect((await w.g.organizer.call('GET', '/api/admin/dashboard')).data.errorAlertsForAll).toBe(true);
    expect((w.box.store.get('state') as BoxState).on).toBe(true);
    expect((await w.g.organizer.call('PUT', '/api/admin/error-alerts-switch', { on: false })).status).toBe(200);
    expect((w.box.store.get('state') as BoxState).on).toBe(false);
    expect((await w.g.organizer.call('GET', '/api/admin/dashboard')).data.errorAlertsForAll).toBeUndefined();
    const entries = (await w.g.organizer.call('GET', '/api/admin/activity')).data.entries.filter((e: any) => String(e.action).startsWith('error_alerts'));
    expect(entries.map((e: any) => activityText(e, 'America/Detroit', 'Alex')).sort()).toEqual(['Alex switched "Error alerts" off', 'Alex switched "Error alerts" on']);
  });
  it('switching off while the box cannot be reached still saves; the next tick tells the box, so nothing is sent', async () => {
    const w = await world({ on: true });
    w.box.broken = true;
    expect((await w.g.organizer.call('PUT', '/api/admin/error-alerts-switch', { on: false })).status).toBe(200);
    expect((await w.g.organizer.call('GET', '/api/admin/dashboard')).data.errorAlertsForAll).toBeUndefined();
    w.box.broken = false;
    await w.tick();
    await w.cronReport('backup_failed');
    expect(w.sent).toEqual([]);
  });
  it('the box missed the switch going on: the next tick tells it', async () => {
    const w = await world({ on: false });
    w.box.broken = true;
    await w.g.organizer.call('PUT', '/api/admin/error-alerts-switch', { on: true });
    w.box.broken = false;
    await w.tick();
    expect((w.box.store.get('state') as BoxState).on).toBe(true);
    await w.cronReport('backup_failed');
    expect(w.sent).toHaveLength(1);
  });
  it('the TEST button: one message marked TEST, switch on or off; refused in the demo; Not connected says so', async () => {
    const w = await world({ on: false });
    expect((await w.g.organizer.call('POST', '/api/admin/error-alerts/test', {})).data).toEqual({ ok: true });
    expect(w.sent).toEqual([`TEST error alert from Pickleball. Nothing is wrong. Real ones look like: "Site error: the weekly backup failed at 3:00 AM." Tap to open Admin: ${ADMIN}`]);
    expect((await w.g.organizer.call('POST', '/api/admin/error-alerts/test', {})).status).toBe(429);
    resetTestTimer();
    w.app.env.TELEGRAM_CHAT_ID = undefined;
    expect((await w.g.organizer.call('POST', '/api/admin/error-alerts/test', {})).status).toBe(409);
    const stranger = w.app.client();
    expect((await stranger.call('POST', '/api/admin/error-alerts/test', {})).status).toBe(401);
  });
  it('the switch row is one task_log row like every other switch; no new table, no migration', () => {
    expect(ERROR_ALERTS.task).toBe('error_alerts_on');
    const migrations = readFileSync('server/errorAlerts.ts', 'utf8');
    expect(migrations).not.toMatch(/CREATE TABLE|ALTER TABLE/);
  });
  it('the Settings row and test button are in both lists of Feature switches', () => {
    const tsx = readFileSync('src/pages/admin/SettingsTab.tsx', 'utf8');
    expect(tsx.match(/<ErrorAlertsRow ctx=\{ctx\} auto=\{auto\} \/>/g)).toHaveLength(2);
    expect(tsx).toContain('Send TEST error alert');
  });
});

describe('tickWork alone (the clock watch with the database down)', () => {
  it('a tick that could not read the switch notes the time only when the box already has it on', async () => {
    const w = await world({ on: false });
    expect(await tickWork(w.app.env, new URL(SITE), w.app.now, false)).toEqual([]);
    expect((w.box.store.get('state') as BoxState | undefined)?.on ?? false).toBe(false);
  });
});
