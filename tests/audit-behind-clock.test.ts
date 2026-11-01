// Behind-the-scenes audit (Sun Nov 1, 2026): the smart-alert clock walked
// through the real /api/cron/tick on a fake clock, checked against a SECOND,
// independent copy of the alert rules written from docs/SMART_ALERTS.md
// (not from shared/tasks.ts). Every 5 minutes for five weeks, with player
// taps, court switches, moves, cancels and finalizes between ticks.
// Telegram is a stub: nothing real is ever sent.
import { describe, expect, it } from 'vitest';
import { HOUR, playerPhone, sentText, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const MIN = 60_000;
const TOKEN = '123456:FAKE-audit-token-never-real';
const CHAT = '9988776655';
const SECRET = 'audit-cron-secret-0123456789abcdef0123456789';
const at = (iso: string) => Date.parse(iso);

// ---------- An independent clock: Eastern wall time by asking Intl, never by fixed offsets ----------
function wall(ms: number) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), mi: n('minute') };
}
/** The instant whose Eastern wall clock reads y-mo-d h:mi (first one in the repeated 1 AM hour). */
function fromWall(y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  for (const off of [4, 5]) {
    const t = guess + off * HOUR;
    const w = wall(t);
    const norm = new Date(Date.UTC(y, mo - 1, d, h, mi));
    if (w.y === norm.getUTCFullYear() && w.mo === norm.getUTCMonth() + 1 && w.d === norm.getUTCDate() && w.h === norm.getUTCHours() && w.mi === norm.getUTCMinutes()) return t;
  }
  // A wall time that never happens (2:30 AM on a spring-forward day): one hour later.
  return guess + 4 * HOUR;
}
/** Same wall clock time, moved by `minutes` on the wall clock. */
function wallMinus(ms: number, minutes: number): number {
  const w = wall(ms);
  const t = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - minutes * MIN);
  return fromWall(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes());
}
function wallDayAt(ms: number, dayOffset: number, h: number, mi: number): number {
  const w = wall(ms);
  const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + dayOffset));
  return fromWall(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), h, mi);
}

interface GameState {
  id: string;
  start: number;
  end: number;
  deadline: number;
  canceled: boolean;
  booked: boolean;
  finalized: boolean;
  confirmed: number;
  marks: Set<string>;
  bookedAt: number | null;
}

/** The alerts the spec says are due in (from, to], for one game as it is at `to`. Written from docs/SMART_ALERTS.md. */
function specDue(g: GameState, from: number, to: number): { id: string; due: number }[] {
  const out: { id: string; due: number }[] = [];
  const add = (id: string, due: number, ok: boolean) => {
    if (ok && due > from && due <= to) out.push({ id, due });
  };
  const afterBooking = (due: number) => g.bookedAt === null || due >= g.bookedAt;
  const before = to < g.start;
  if (!g.canceled) {
    // Booked games: last call 25 hours before the start (wall clock).
    const night = wallMinus(g.start, 25 * 60);
    add('night', night, g.booked && before && !g.marks.has('night_text') && afterBooking(night));
    // Booked games under 4: cancel warning 10 hours before the deadline, follow-up 30 minutes later, game-day check 45 minutes before the deadline.
    const warn = wallMinus(g.deadline, 10 * 60);
    const short = g.booked && before && g.confirmed < 4;
    add('cancel', warn, short && !g.marks.has('court_canceled') && afterBooking(warn));
    add('cancel_followup', warn + 30 * MIN, short && afterBooking(warn + 30 * MIN));
    const gd = wallMinus(g.deadline, 45);
    add('gameday', gd, short && !g.marks.has('court_canceled') && to < g.deadline && afterBooking(gd));
    // Not booked: 6:45 AM and 7:30 AM on the day the court opens (14 days before), until that day ends.
    const opens = wallDayAt(g.start, -14, 7, 0);
    add('book', opens - 15 * MIN, !g.booked && before);
    add('book_followup', opens + 30 * MIN, !g.booked && before);
    // Not booked, 4 or more in: 15 minutes after the deadline, if the game is within 24 hours of that.
    const nc = g.deadline + 15 * MIN;
    add('nocourt', nc, !g.booked && before && g.confirmed >= 4 && g.start - nc <= 24 * HOUR);
    // Played games: 5 minutes after the end, until finalized.
    add('finalize', g.end + 5 * MIN, !g.finalized && g.confirmed >= 4);
  }
  return out;
}

const EXTRA = ['Gale', 'Harper', 'Indy', 'Jules', 'Kai', 'Lane', 'Morgan', 'Noel'];

async function auditGroup(opts: { fail?: (n: number) => Response | 'timeout' | 'throw' | null } = {}) {
  const app = new TestApp();
  const sent: { at: number; text: string }[] = [];
  let calls = 0;
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    CRON_SECRET: SECRET,
    GO_LINKS: 'on',
    TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
      expect(url).toContain('api.telegram.org');
      calls++;
      const f = opts.fail?.(calls) ?? null;
      if (f === 'timeout') {
        const e = new Error('The operation was aborted due to timeout');
        e.name = 'TimeoutError';
        throw e;
      }
      if (f === 'throw') throw new TypeError(`fetch failed for ${url}`);
      if (f) return f;
      sent.push({ at: app.now, text: sentText(JSON.parse(String(init.body))) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  for (const name of EXTRA) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null, isRegular: true, isActive: true });
    expect(r.status).toBe(200);
    ctx.byName[name] = r.data.id;
  }
  const tick = async () => {
    const r = await ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    await app.settle();
    return r;
  };
  const phones = new Map<string, Awaited<ReturnType<typeof playerPhone>>>();
  const phone = async (name: string) => {
    if (!phones.has(name)) phones.set(name, await playerPhone(ctx, name));
    return phones.get(name)!;
  };
  return { app, ctx, sent, tick, phone, calls: () => calls };
}

function stateOf(app: TestApp): GameState[] {
  const raw = app.db.raw;
  const rows = raw
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM session_players p WHERE p.session_id = s.id AND p.status = 'confirmed') AS n FROM sessions s`,
    )
    .all() as any[];
  const marks = raw.prepare("SELECT session_id, task, at FROM task_log WHERE kind = 'mark'").all() as any[];
  return rows.map((s) => {
    const m = marks.filter((x) => x.session_id === s.id);
    const booked = s.booking_status === 'booked';
    const ba = m.find((x) => x.task === 'court_booked');
    return {
      id: s.id,
      start: Date.parse(s.starts_at),
      end: Date.parse(s.ends_at),
      deadline: s.cancellation_deadline_at ? Date.parse(s.cancellation_deadline_at) : Date.parse(s.starts_at) - 12 * HOUR,
      canceled: s.status === 'canceled',
      booked,
      finalized: !!s.finalized_at,
      confirmed: Number(s.n),
      marks: new Set(m.map((x) => x.task)),
      bookedAt: booked && ba ? Date.parse(ba.at) : null,
    };
  });
}

/** Seeded random numbers, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const EASTERN_TIME = /\b(1[0-2]|[1-9]):[0-5]\d (AM|PM)\b/;

describe('five weeks of 5-minute ticks against an independent copy of the alert rules', () => {
  for (const seed of [11]) {
    it(`seed ${seed}: every smart alert once, on its first tick, matching the spec; nothing extra`, async () => {
      const g = await auditGroup();
      const rand = rng(seed);
      const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA];
      // Mon Oct 26, 7:00 AM Eastern, through Thu Dec 3 (crosses the Sun Nov 1 clock change and Thanksgiving week).
      g.app.now = at('2026-10-26T11:00:00Z');
      g.app.db.raw.prepare("UPDATE groups SET first_session_date = '2026-10-27'").run();
      const end = at('2026-12-04T05:00:00Z');
      let prev = g.app.now - 5 * MIN;
      const expected: string[] = [];
      const sentKeys = new Map<string, number>();
      const moved = new Set<string>();
      let tickNo = 0;
      while (g.app.now < end) {
        // Between ticks: now and then someone does something (about 4 things a day).
        if (rand() < 0.014) {
          const games = stateOf(g.app).filter((s) => !s.canceled && s.start > g.app.now);
          if (games.length) {
            const s = games[Math.floor(rand() * Math.min(games.length, 6))];
            const r = rand();
            const who = names[Math.floor(rand() * names.length)];
            const save = g.app.now;
            g.app.now += Math.floor(rand() * 4 + 1) * MIN; // 1 to 4 minutes after the tick
            if (r < 0.45) await (await g.phone(who)).call('POST', `/api/sessions/${s.id}/join`, {});
            else if (r < 0.7) await (await g.phone(who)).call('POST', `/api/sessions/${s.id}/withdraw`, {});
            else if (r < 0.8) await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: (['booked', 'not_booked', 'waitlist'] as const)[Math.floor(rand() * 3)] });
            else if (r < 0.85 && s.start - g.app.now > 30 * HOUR) {
              // Move it: half the time the same day an hour earlier, else to the next day.
              const sameDay = rand() < 0.5;
              const shift = sameDay ? -HOUR : 24 * HOUR;
              const res = await g.ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: new Date(s.start + shift).toISOString(), endsAt: new Date(s.end + shift).toISOString() });
              if (res.status === 200 && !sameDay) moved.add(s.id);
            } else if (r < 0.88) {
              await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true });
            } else if (r < 0.94) {
              await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/task-mark`, { mark: rand() < 0.5 ? 'night_text' : 'court_canceled' });
            }
            await g.app.settle();
            // Player-tap alerts are checked in their own tests; here only the clock's alerts are counted.
            g.sent.length = 0;
            g.app.now = save;
          }
        }
        // Once a day the organizer opens Home (this makes the games 3 weeks ahead); finalize games that ended.
        if (tickNo % 288 === 0) {
          await g.ctx.organizer.call('GET', '/api/admin/dashboard');
          for (const s of stateOf(g.app)) {
            if (!s.canceled && !s.finalized && s.confirmed >= 4 && s.end + 2 * HOUR < g.app.now && rand() < 0.5) {
              await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
            }
          }
          await g.app.settle();
          g.sent.length = 0;
        }
        const games = stateOf(g.app);
        for (const s of games) for (const a of specDue(s, prev, g.app.now)) expected.push(`${s.id}:${a.id}`);
        const r = await g.tick();
        expect(r.status).toBe(200);
        // What the tick wrote down as sent, matched against Telegram.
        const rows = g.app.db.raw.prepare("SELECT session_id, task FROM task_log WHERE kind = 'sent' AND at = ?").all(new Date(g.app.now).toISOString()) as any[];
        expect(rows.length).toBe(g.sent.length);
        for (const row of rows) {
          const key = `${row.session_id}:${row.task}`;
          sentKeys.set(key, (sentKeys.get(key) ?? 0) + 1);
        }
        for (const m of g.sent) {
          expect(m.text).not.toMatch(/\bUTC\b|\d{2}:\d{2}:\d{2}|T\d{2}:\d{2}|555|\(313\)|\$|venmo/i);
          expect(m.text.length).toBeLessThan(4096);
          if (/\d:\d\d/.test(m.text)) expect(m.text).toMatch(EASTERN_TIME);
        }
        g.sent.length = 0;
        prev = g.app.now;
        g.app.now += 5 * MIN;
        tickNo++;
      }
      const got = [...sentKeys.keys()].sort();
      // A game moved to another day may legally send its alerts again (the move resets them); nothing else repeats.
      for (const [k, n] of sentKeys) if (!moved.has(k.split(':')[0])) expect(n, k).toBe(1);
      expect(got).toEqual([...new Set(expected)].sort());
      expect(got.length).toBeGreaterThan(20);
    }, 240_000);
  }
});

describe('the clock at its worst moments (the tick API, Telegram stubbed)', () => {
  async function tueNov3(n: number, extra: (g: Awaited<ReturnType<typeof auditGroup>>) => Promise<void> = async () => {}) {
    const g = await auditGroup();
    g.app.now = at('2026-11-02T17:00:00Z'); // Mon Nov 2, noon
    g.app.db.raw.prepare("UPDATE groups SET first_session_date = '2026-11-03'").run();
    const dash = (await g.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z'); // Tue Nov 3, 8:00 PM
    expect(s).toBeTruthy();
    expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' })).status).toBe(200);
    for (const name of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA].slice(0, n)) {
      expect((await (await g.phone(name)).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    }
    await g.app.settle();
    g.sent.length = 0;
    await extra(g);
    return { g, s };
  }
  const LAST_CALL = at('2026-11-03T00:00:00Z'); // Mon Nov 2, 7:00 PM EST

  it('the first real alert: Mon Nov 2 at 7:00 PM, once, with the Tuesday game and a direct text link', async () => {
    const { g } = await tueNov3(3);
    g.app.now = LAST_CALL - 5 * MIN;
    await g.tick();
    expect(g.sent).toEqual([]);
    g.app.now = LAST_CALL;
    await g.tick();
    expect(g.sent.map((m) => m.text)).toEqual([expect.stringMatching(/^Tuesday: 3 players in, need a 4th\. Text the group: https:\/\/pickleball\.juncaj\.net\/go\/[\w.-]+$/)]);
    for (let i = 1; i <= 12; i++) {
      g.app.now = LAST_CALL + i * 5 * MIN;
      await g.tick();
    }
    expect(g.sent.length).toBe(1);
  });

  it('a tick 20 minutes late sends the alert once, late, with the same words', async () => {
    const { g } = await tueNov3(5);
    g.app.now = LAST_CALL + 20 * MIN;
    await g.tick();
    expect(g.sent.map((m) => m.text)).toEqual([expect.stringMatching(/^Tuesday: 5 players in\. Text the group to confirm: https:\/\/pickleball\.juncaj\.net\/go\//)]);
    g.app.now += 5 * MIN;
    await g.tick();
    expect(g.sent.length).toBe(1);
  });

  it('the clock down for 3 hours: alerts more than an hour old are dropped (by design), newer ones go once', async () => {
    const { g } = await tueNov3(3);
    // Down from 6:55 PM to 10:05 PM: the 7:00 PM last call is too old; the 10:00 PM cancel warning is fresh.
    g.app.now = at('2026-11-03T03:05:00Z');
    await g.tick();
    expect(g.sent.map((m) => m.text)).toEqual([expect.stringMatching(/^Tuesday: only 3 players in\. Cancel court: https:\/\/mobileapp\.courtreserve\.com/)]);
    // The Home card still shows the night-before task.
    const d = (await g.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(JSON.stringify(d)).not.toContain('Telegram');
  });

  it('ticks running at the same moment (the cron fired twice) send once', async () => {
    const { g } = await tueNov3(3);
    g.app.now = LAST_CALL;
    await Promise.all([g.tick(), g.tick(), g.tick(), g.tick()]);
    expect(g.sent.length).toBe(1);
  });

  it('Telegram slow (no answer in 5 seconds): the alert is kept as sent, never sent twice', async () => {
    const g0 = await auditGroup({ fail: (n) => (n === 1 ? 'timeout' : null) });
    g0.app.now = at('2026-11-02T17:00:00Z');
    const dash = (await g0.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
    await g0.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    g0.app.now = LAST_CALL;
    await g0.tick();
    for (let i = 1; i <= 12; i++) {
      g0.app.now = LAST_CALL + i * 5 * MIN;
      await g0.tick();
    }
    expect(g0.calls()).toBe(1);
    expect(g0.sent.length).toBe(0);
    const failed = g0.app.db.raw.prepare("SELECT detail FROM task_log WHERE kind = 'failed'").all() as any[];
    expect(failed.map((f) => f.detail)).toEqual(["Telegram didn't answer in time."]);
  });

  it('Telegram down (error 500 or no network): retried 15 minutes later, sent once when it is back', async () => {
    for (const kind of ['500', 'throw'] as const) {
      const g0 = await auditGroup({ fail: (n) => (n <= 2 ? (kind === '500' ? new Response('{}', { status: 500 }) : 'throw') : null) });
      g0.app.now = at('2026-11-02T17:00:00Z');
      const dash = (await g0.ctx.organizer.call('GET', '/api/admin/dashboard')).data;
      const s = dash.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
      await g0.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
      const sendTimes: number[] = [];
      for (let i = 0; i <= 12; i++) {
        g0.app.now = LAST_CALL + i * 5 * MIN;
        const before = g0.calls();
        const r = await g0.tick();
        expect(r.status).toBe(200);
        if (g0.calls() > before) sendTimes.push(i * 5);
      }
      // Tries at 7:00, 7:15 and 7:30 PM; the third gets through.
      expect(sendTimes).toEqual([0, 15, 30]);
      expect(g0.sent.length).toBe(1);
      // The site keeps working while Telegram is down.
      expect((await g0.ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
    }
  });

  it('a game edited between ticks: moved later the same day keeps the sent alert; moved to another day starts over', async () => {
    const { g, s } = await tueNov3(3);
    g.app.now = LAST_CALL;
    await g.tick();
    expect(g.sent.length).toBe(1);
    // Same day, 9:00 PM: the last call (already sent) never repeats.
    g.app.now = LAST_CALL + 10 * MIN;
    expect((await g.ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: '2026-11-04T02:00:00.000Z', endsAt: '2026-11-04T04:00:00.000Z' })).status).toBe(200);
    for (let i = 0; i < 14; i++) {
      g.app.now += 5 * MIN;
      await g.tick();
    }
    expect(g.sent.filter((m) => /Text the group/.test(m.text)).length).toBe(1);
    // To Wednesday Nov 4 at 8:00 PM: a new day, so its last call (Tue 7:00 PM) will go again.
    expect((await g.ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: '2026-11-05T01:00:00.000Z', endsAt: '2026-11-05T03:00:00.000Z' })).status).toBe(200);
    g.sent.length = 0;
    g.app.now = at('2026-11-04T00:00:00Z'); // Tue 7:00 PM
    await g.tick();
    expect(g.sent.map((m) => m.text)).toEqual([expect.stringMatching(/^Wednesday: 3 players in, need a 4th\. Text the group: /)]);
  });

  it('canceled, finalized or switched to Waitlist between ticks: the alerts for it stop', async () => {
    // Canceled after the 10:00 PM warning: no 10:30 PM follow-up, no 7:15 AM check.
    {
      const { g, s } = await tueNov3(3);
      g.app.now = at('2026-11-03T03:00:00Z');
      await g.tick();
      expect(g.sent.length).toBe(1);
      g.app.now += 2 * MIN;
      expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
      for (let t = g.app.now + 3 * MIN; t < at('2026-11-04T01:00:00Z'); t += 5 * MIN) {
        g.app.now = t;
        await g.tick();
      }
      expect(g.sent.filter((m) => !/Nov 17/.test(m.text)).length).toBe(1);
    }
    // Court switched to Waitlist after the last call: no cancel warnings for a court it does not have.
    {
      const { g, s } = await tueNov3(3);
      g.app.now = LAST_CALL;
      await g.tick();
      g.app.now += 2 * MIN;
      expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'waitlist' })).status).toBe(200);
      for (let t = g.app.now + 3 * MIN; t < at('2026-11-04T01:00:00Z'); t += 5 * MIN) {
        g.app.now = t;
        await g.tick();
      }
      expect(g.sent.filter((m) => !/Nov 17/.test(m.text)).map((m) => m.text.split(':')[0])).toEqual(['Tuesday']);
    }
    // 5 played, finalized before 10:05 PM: no finalize alert.
    {
      const { g, s } = await tueNov3(5);
      g.app.now = at('2026-11-04T03:02:00Z');
      expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
      g.sent.length = 0;
      for (let t = at('2026-11-04T03:05:00Z'); t < at('2026-11-04T05:00:00Z'); t += 5 * MIN) {
        g.app.now = t;
        await g.tick();
      }
      expect(g.sent).toEqual([]);
    }
  });
});

describe('Sun Nov 1 clock change: ticks through the repeated 1 AM hour', () => {
  it('every 5-minute tick from Sat 6 PM to Mon 6 PM is a distinct moment and nothing is sent twice', async () => {
    const g = await auditGroup();
    g.app.now = at('2026-10-31T21:00:00Z'); // Sat Oct 31, 5:00 PM EDT
    g.app.db.raw.prepare("UPDATE groups SET first_session_date = '2026-10-27'").run();
    // A game on the clock-change day itself, Sun Nov 1 at 7:00 PM EST, booked with 3 in.
    const add = await g.ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-02T02:00:00.000Z' });
    expect(add.status).toBe(200);
    const id = add.data.id ?? add.data.session?.id;
    await g.ctx.organizer.call('POST', `/api/admin/sessions/${id}/court-status`, { status: 'booked' });
    for (const n of ['Blair', 'Casey', 'Devon']) await (await g.phone(n)).call('POST', `/api/sessions/${id}/join`, {});
    await g.app.settle();
    g.sent.length = 0;
    const seen = new Set<number>();
    const hours: string[] = [];
    for (let t = at('2026-10-31T21:30:00Z'); t <= at('2026-11-02T23:00:00Z'); t += 5 * MIN) {
      g.app.now = t;
      expect(seen.has(t)).toBe(false);
      seen.add(t);
      await g.tick();
      for (const m of g.sent.splice(0)) hours.push(`${new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(t)).replace(',', '')} | ${m.text.split(':')[0]}`);
    }
    // Last call Sat 6:00 PM EDT is 25 wall-clock hours before Sun 7:00 PM EST; deadline Sun 7:00 AM EST.
    expect(hours).toEqual(['Sat 6:00 PM EDT | Sunday', 'Sat 9:00 PM EDT | Sunday', 'Sat 9:30 PM EDT | Sunday', 'Sun 6:15 AM EST | Tonight']);
  });
});
