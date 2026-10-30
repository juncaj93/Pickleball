import { describe, expect, it } from 'vitest';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { CATCH_UP_MS, countLine, dayAt, dueAlerts, markKey, nextTasks, type Task, type TaskOptions, type TaskSession } from '../shared/tasks';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

// "Do this now" and smart Telegram alerts. A fake clock throughout; Telegram
// is always a stand-in, so no test ever sends a real message.

const TZ = 'America/Detroit';
const ADMIN = 'https://pickleball.juncaj.net/admin';
const OPTS: TaskOptions = { tz: TZ, bookingLeadDays: 14, defaultDeadlineHours: 12, links: { admin: ADMIN, book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL } };
const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);

/** A game at 8:00 to 10:00 PM Eastern on a date like "2026-11-03". */
function game(date: string, over: Partial<TaskSession> = {}): TaskSession {
  const [y, m, d] = date.split('-').map(Number);
  const start = dayAt(new Date(Date.UTC(y, m - 1, d, 17)).toISOString(), TZ, 0, 20);
  return {
    id: `s-${date}`,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * HOUR).toISOString(),
    canceled: false,
    canceledAt: null,
    confirmedCount: 3,
    booked: true,
    needsBooking: false,
    cancellationDeadlineAt: new Date(start - 12 * HOUR).toISOString(),
    finalized: false,
    holiday: null,
    ...over,
  };
}

const tasksAt = (iso: string, sessions: TaskSession[], marks: string[] = []) => nextTasks(at(iso), sessions, new Set(marks), OPTS);
const texts = (list: Task[]) => list.map((t) => t.text);

describe('the task brain: times (Eastern, America/Detroit)', () => {
  const tue = game('2026-11-03');

  it('night before: card from 6:00 PM Monday, Telegram due 8:00 PM, gone at the start', () => {
    expect(tasksAt('2026-11-02T22:59:00Z', [tue])).toEqual([]); // 5:59 PM EST
    const t = tasksAt('2026-11-02T23:00:00Z', [tue]); // 6:00 PM
    expect(texts(t)).toEqual(['Tuesday: 3 players in, need a 4th.']);
    expect(t[0].alerts[0]).toMatchObject({ id: 'night', dueMs: at('2026-11-03T01:00:00Z') }); // 8:00 PM Monday
    expect(tasksAt('2026-11-04T01:00:00Z', [tue]).filter((x) => x.kind === 'night')).toEqual([]);
  });

  it('the count words', () => {
    expect(countLine(3)).toBe('3 players in, need a 4th.');
    expect(countLine(2)).toBe('2 players in, need 2 more.');
    expect(countLine(1)).toBe('1 player in, need 3 more.');
    expect(countLine(0)).toBe('No one in yet, need 4.');
    expect(countLine(5)).toBe('5 players in.');
    const t = tasksAt('2026-11-03T01:00:00Z', [game('2026-11-03', { confirmedCount: 5 })]);
    expect(t[0].alerts[0].text).toBe(`Tuesday: 5 players in. Text the group to confirm: ${ADMIN}`);
    expect(t[0].buttons[0]).toMatchObject({ label: 'Text the group to confirm', action: { type: 'text', text: 'checkin' } });
  });

  it('10:00 PM under 4: the cancel checklist and its alert; 10:30 PM follow-up only while not canceled', () => {
    expect(tasksAt('2026-11-03T02:59:00Z', [tue]).map((x) => x.kind)).toEqual(['night']);
    const t = tasksAt('2026-11-03T03:00:00Z', [tue]);
    expect(t.map((x) => x.kind)).toEqual(['cancel', 'night']);
    expect(t[0].text).toBe('Tuesday: only 3 players in.');
    expect(t[0].steps.map((s) => [s.label, s.done, s.enabled])).toEqual([
      ['Cancel the court', false, true],
      ['Cancel the session', false, true],
      ["Text everyone it's canceled", false, false],
    ]);
    const alerts = Object.fromEntries(t[0].alerts.map((a) => [a.id, a]));
    expect(alerts.cancel.text).toBe(`Tuesday: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`);
    expect(alerts.cancel_followup).toMatchObject({ dueMs: at('2026-11-03T03:30:00Z'), text: `Tuesday: court canceled? Now cancel the session and text everyone: ${ADMIN}` });
    // Canceled on the site at 10:20 PM: the follow-up has nothing left to say; the text step opens.
    const canceled = { ...tue, canceled: true, canceledAt: '2026-11-03T03:20:00Z' };
    const c = tasksAt('2026-11-03T03:30:00Z', [canceled], [markKey(tue.id, 'court_canceled')]);
    expect(c.map((x) => x.kind)).toEqual(['cancel']);
    expect(c[0].alerts).toEqual([]);
    expect(c[0].steps.map((s) => s.done)).toEqual([true, true, false]);
    expect(c[0].steps[2].enabled).toBe(true);
    // Texted: the card is done.
    expect(tasksAt('2026-11-03T03:40:00Z', [canceled], [markKey(tue.id, 'court_canceled'), markKey(tue.id, 'canceled_text')])).toEqual([]);
  });

  it('4 or more at 10:00 PM: no cancel checklist', () => {
    expect(tasksAt('2026-11-03T03:00:00Z', [game('2026-11-03', { confirmedCount: 4 })]).map((x) => x.kind)).toEqual(['night']);
  });

  it('game day 7:15 AM: uses the real deadline, silent once it passed or the court is marked canceled', () => {
    const t = tasksAt('2026-11-03T12:15:00Z', [tue]);
    expect(t[0].text).toBe('Tonight: only 3 players in. Cancel court before 8:00 AM.');
    const g = t[0].alerts.find((a) => a.id === 'gameday')!;
    expect(g).toMatchObject({ dueMs: at('2026-11-03T12:15:00Z'), text: `Tonight: only 3 players in. Cancel court before 8:00 AM: ${COURTRESERVE_CANCEL_URL}` });
    // Its own deadline, not a fixed 8:00 AM.
    const early = game('2026-11-03', { cancellationDeadlineAt: '2026-11-03T14:30:00Z' }); // 9:30 AM
    expect(tasksAt('2026-11-03T12:15:00Z', [early])[0].text).toBe('Tonight: only 3 players in. Cancel court before 9:30 AM.');
    const passed = game('2026-11-03', { cancellationDeadlineAt: '2026-11-03T12:00:00Z' }); // 7:00 AM
    expect(tasksAt('2026-11-03T12:15:00Z', [passed])[0].alerts.find((a) => a.id === 'gameday')).toBeUndefined();
    expect(tasksAt('2026-11-03T12:15:00Z', [tue], [markKey(tue.id, 'court_canceled')])[0].alerts.find((a) => a.id === 'gameday')).toBeUndefined();
  });

  it('booking day 8:30 AM: "Tue Nov 17 opened.", one follow-up at 10:30 AM, nothing once booked', () => {
    const nov17 = game('2026-11-17', { booked: false, needsBooking: true, confirmedCount: 0 });
    expect(tasksAt('2026-11-03T13:29:00Z', [nov17])).toEqual([]);
    const t = tasksAt('2026-11-03T13:30:00Z', [nov17]); // Tue Nov 3, 8:30 AM EST
    expect(t[0].text).toBe('Tue Nov 17 opened.');
    expect(t[0].buttons.map((b) => b.label)).toEqual(['Book on CourtReserve', 'I booked it']);
    expect(t[0].alerts[0].text).toBe(`Tue Nov 17 opened. Book now: ${COURTRESERVE_BOOKING_URL}\nThen tap I booked it: ${ADMIN}`);
    expect(t[0].alerts[1]).toMatchObject({ id: 'book_followup', dueMs: at('2026-11-03T15:30:00Z') });
    expect(t[0].alerts[1].text.startsWith('Reminder: Tue Nov 17 opened.')).toBe(true);
    expect(tasksAt('2026-11-03T13:30:00Z', [{ ...nov17, booked: true, needsBooking: false }])).toEqual([]);
  });

  it('a holiday is named: "Thu Nov 26 opened (Thanksgiving)."', () => {
    const nov26 = game('2026-11-26', { booked: false, needsBooking: true, confirmedCount: 0, holiday: 'Thanksgiving' });
    const t = tasksAt('2026-11-12T13:30:00Z', [nov26]);
    expect(t[0].text).toBe('Thu Nov 26 opened (Thanksgiving).');
  });

  it('after the game 10:05 PM: finalize, then the post-game note; only for a game that was played', () => {
    expect(tasksAt('2026-11-04T03:04:00Z', [game('2026-11-03', { confirmedCount: 5 })]).map((x) => x.kind)).toEqual([]);
    const t = tasksAt('2026-11-04T03:05:00Z', [game('2026-11-03', { confirmedCount: 5 })]);
    expect(t[0].text).toBe('Tuesday: finalize who played.');
    expect(t[0].alerts[0].text).toBe(`Tuesday: finalize who played: ${ADMIN}`);
    expect(t[0].steps.map((s) => [s.label, s.enabled])).toEqual([
      ['Finalize who played', true],
      ['Text the post-game note', false],
    ]);
    const fin = game('2026-11-03', { confirmedCount: 5, finalized: true });
    const f = tasksAt('2026-11-04T03:30:00Z', [fin]);
    expect(f[0].alerts).toEqual([]);
    expect(f[0].steps[1].enabled).toBe(true);
    expect(tasksAt('2026-11-04T03:30:00Z', [fin], [markKey(fin.id, 'postgame_text')])).toEqual([]);
    // Under 4 or canceled: nothing (the existing Finalize card handles an under-4 game).
    expect(tasksAt('2026-11-04T03:05:00Z', [game('2026-11-03', { confirmedCount: 3 })])).toEqual([]);
    expect(tasksAt('2026-11-04T03:05:00Z', [game('2026-11-03', { confirmedCount: 5, canceled: true, canceledAt: '2026-11-03T12:00:00Z' })])).toEqual([]);
  });

  it('canceled and past games get no tasks', () => {
    const canceled = game('2026-11-03', { canceled: true, canceledAt: '2026-11-01T12:00:00Z' });
    for (const iso of ['2026-11-03T01:00:00Z', '2026-11-03T03:00:00Z', '2026-11-03T12:15:00Z']) expect(tasksAt(iso, [canceled])).toEqual([]);
    expect(tasksAt('2026-11-10T03:00:00Z', [tue])).toEqual([]);
  });

  it('most urgent first: cancel, a court that opened today, night text, finalize, older courts to book', () => {
    const list = [
      game('2026-11-03'),
      game('2026-11-17', { booked: false, needsBooking: true, confirmedCount: 0 }),
      game('2026-10-29', { confirmedCount: 6 }),
      game('2026-11-12', { booked: false, needsBooking: true, confirmedCount: 2 }),
    ];
    expect(tasksAt('2026-11-03T13:30:00Z', list).map((t) => `${t.kind}:${t.sessionId}`)).toEqual([
      'cancel:s-2026-11-03',
      'book:s-2026-11-17',
      'night:s-2026-11-03',
      'finalize:s-2026-10-29',
      'book:s-2026-11-12',
    ]);
  });

  it('the card and the Telegram message always say the same thing', () => {
    const sessions = [
      game('2026-11-03'),
      game('2026-11-05', { confirmedCount: 6 }),
      game('2026-11-17', { booked: false, needsBooking: true, confirmedCount: 0 }),
      game('2026-11-19', { booked: false, needsBooking: true, confirmedCount: 0 }),
      game('2026-10-29', { confirmedCount: 7 }),
      game('2026-11-10', { confirmedCount: 1, booked: false, needsBooking: true }),
    ];
    let checked = 0;
    for (let ms = at('2026-11-01T12:00:00Z'); ms < at('2026-11-12T12:00:00Z'); ms += 5 * MIN) {
      for (const t of nextTasks(ms, sessions, new Set(), OPTS)) {
        for (const a of t.alerts) {
          checked++;
          const lead = t.text.replace(/\.$/, '');
          if (a.id === 'cancel_followup') expect(a.text.startsWith(`${lead.split(':')[0]}: court canceled?`)).toBe(true);
          else if (a.id === 'book_followup') expect(a.text.startsWith(`Reminder: ${t.text}`)).toBe(true);
          else if (a.id === 'cancel' || a.id === 'gameday') expect(a.text.startsWith(a.id === 'gameday' ? lead : t.text.split(' Cancel court before')[0])).toBe(true);
          else expect(a.text.startsWith(lead)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

/** Every 5-minute tick from `fromIso` for `hours`, sending what dueAlerts says; returns [time, key] per send. */
function simulate(fromIso: string, hours: number, sessions: (ms: number) => TaskSession[], marks: (ms: number) => string[] = () => []) {
  const sent = new Set<string>();
  const log: { ms: number; key: string; text: string }[] = [];
  for (let ms = at(fromIso); ms <= at(fromIso) + hours * HOUR; ms += 5 * MIN) {
    for (const a of dueAlerts(nextTasks(ms, sessions(ms), new Set(marks(ms)), OPTS), ms, sent)) {
      sent.add(a.key);
      log.push({ ms, key: a.key, text: a.text });
    }
  }
  return log;
}

describe('ticks every 5 minutes', () => {
  it('48 hours, Mon noon to Wed noon: each alert exactly once, at its time', () => {
    const sessions = () => [game('2026-11-03'), game('2026-11-05', { confirmedCount: 5 }), game('2026-11-17', { booked: false, needsBooking: true, confirmedCount: 0 })];
    const log = simulate('2026-11-02T17:00:00Z', 48, sessions);
    expect(log.map((l) => [new Date(l.ms).toISOString(), l.key])).toEqual([
      ['2026-11-03T01:00:00.000Z', 's-2026-11-03:night'], // Mon 8:00 PM
      ['2026-11-03T03:00:00.000Z', 's-2026-11-03:cancel'], // Mon 10:00 PM
      ['2026-11-03T03:30:00.000Z', 's-2026-11-03:cancel_followup'], // Mon 10:30 PM
      ['2026-11-03T12:15:00.000Z', 's-2026-11-03:gameday'], // Tue 7:15 AM
      ['2026-11-03T13:30:00.000Z', 's-2026-11-17:book'], // Tue 8:30 AM
      ['2026-11-03T15:30:00.000Z', 's-2026-11-17:book_followup'], // Tue 10:30 AM
    ]);
    expect(new Set(log.map((l) => l.key)).size).toBe(log.length);
  });

  it('across the Sun Nov 1 clock change: Sunday and Monday games alert at the right Eastern times', () => {
    const sun = { ...game('2026-11-01'), id: 'sun' };
    const mon = { ...game('2026-11-02', { confirmedCount: 5 }), id: 'mon' };
    expect(sun.startsAt).toBe('2026-11-02T01:00:00.000Z'); // 8:00 PM EST
    const log = simulate('2026-10-31T12:00:00Z', 60, () => [sun, mon]);
    expect(log.map((l) => [new Date(l.ms).toISOString(), l.key])).toEqual([
      ['2026-11-01T00:00:00.000Z', 'sun:night'], // Sat Oct 31, 8:00 PM EDT
      ['2026-11-01T02:00:00.000Z', 'sun:cancel'], // Sat 10:00 PM EDT
      ['2026-11-01T02:30:00.000Z', 'sun:cancel_followup'],
      ['2026-11-01T12:15:00.000Z', 'sun:gameday'], // Sun 7:15 AM EST (after the change)
      ['2026-11-02T01:00:00.000Z', 'mon:night'], // Sun 8:00 PM EST
    ]);
  });

  it('a missed tick is caught up within the hour; after an hour it is dropped, never sent late twice', () => {
    const sessions = () => [game('2026-11-03')];
    const night = (ms: number) => dueAlerts(nextTasks(ms, sessions(), new Set(), OPTS), ms, new Set()).map((a) => a.id);
    expect(night(at('2026-11-03T01:55:00Z'))).toContain('night');
    expect(night(at('2026-11-03T01:00:00Z') + CATCH_UP_MS)).not.toContain('night');
  });

  it('silent once Alex taps the button, even before the alert time', () => {
    const log = simulate('2026-11-02T17:00:00Z', 12, () => [game('2026-11-03', { confirmedCount: 5 })], (ms) => (ms >= at('2026-11-02T23:30:00Z') ? [markKey('s-2026-11-03', 'night_text')] : []));
    expect(log).toEqual([]);
  });

  it('nothing for canceled games', () => {
    expect(simulate('2026-11-02T17:00:00Z', 48, () => [game('2026-11-03', { canceled: true, canceledAt: '2026-11-01T15:00:00Z' })])).toEqual([]);
  });
});

// ---------- Through the real API: the tick, marks, the switch ----------

const TOKEN = '123456:FAKE-test-token-never-real';
const CHAT = '9988776655';
const SECRET = 'test-cron-secret-0123456789abcdef0123456789';

async function smartGroup(failFirst = 0) {
  const app = new TestApp();
  const sent: string[] = [];
  let fails = failFirst;
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT,
    CRON_SECRET: SECRET,
    TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
      if (fails > 0) {
        fails--;
        return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 });
      }
      sent.push(JSON.parse(String(init.body)).text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  const tick = async (secret = SECRET) => {
    const r = await ctx.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': secret });
    await app.settle();
    return r;
  };
  const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const sessionOn = async (date: string) => (await dash()).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  return { app, ctx, sent, tick, dash, sessionOn };
}

/** Put n players into a game, book its court, then forget the "it's on" style tap alerts. */
async function fill(g: Awaited<ReturnType<typeof smartGroup>>, date: string, n: number) {
  const s = await g.sessionOn(date);
  await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  for (const name of ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'].slice(0, n)) {
    const phone = await playerPhone(g.ctx, name);
    const r = await phone.call('POST', `/api/sessions/${s.id}/join`, {});
    expect(r.status).toBe(200);
  }
  await g.app.settle();
  g.sent.length = 0;
  return s;
}

describe('the tick endpoint', () => {
  it('48 hours of ticks through the API: the same six alerts, once each, with no phone numbers or money', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z'); // Mon Nov 2, noon EST
    await g.dash(); // makes the games up to six weeks out
    await fill(g, '2026-11-03', 3);
    await fill(g, '2026-11-05', 5);
    const end = g.app.now + 48 * HOUR;
    while (g.app.now <= end) {
      const r = await g.tick();
      expect(r.status).toBe(200);
      g.app.now += 5 * MIN;
    }
    expect(g.sent).toEqual([
      `Tuesday: 3 players in, need a 4th. Text the group: ${ADMIN}`,
      `Tuesday: only 3 players in. Cancel court: ${COURTRESERVE_CANCEL_URL}`,
      `Tuesday: court canceled? Now cancel the session and text everyone: ${ADMIN}`,
      `Tonight: only 3 players in. Cancel court before 8:00 AM: ${COURTRESERVE_CANCEL_URL}`,
      `Tue Nov 17 opened. Book now: ${COURTRESERVE_BOOKING_URL}\nThen tap I booked it: ${ADMIN}`,
      `Reminder: Tue Nov 17 opened. Book now: ${COURTRESERVE_BOOKING_URL}\nThen tap I booked it: ${ADMIN}`,
    ]);
    for (const t of g.sent) {
      expect(t).not.toMatch(/555|\(313\)|\$|venmo/i);
    }
  });

  it('the card on Home lists the same task as the alert, and a tap there keeps Telegram quiet', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T23:30:00Z'); // Mon 6:30 PM
    await g.dash();
    const s = await fill(g, '2026-11-03', 5);
    const d = await g.dash();
    const { dashboardTasks } = await import('../src/pages/admin/doNow');
    const cards = dashboardTasks(d, g.app.now, ADMIN);
    expect(cards.find((t) => t.kind === 'night')?.text).toBe('Tuesday: 5 players in.');
    const r = await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/task-mark`, { mark: 'night_text' });
    expect(r.status).toBe(200);
    expect((await g.dash()).taskMarks).toContain(`${s.id}:night_text`);
    g.app.now = at('2026-11-03T01:00:00Z'); // 8:00 PM
    await g.tick();
    expect(g.sent).toEqual([]);
    // A second tap is harmless.
    expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/task-mark`, { mark: 'night_text' })).status).toBe(200);
    expect((await g.ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/task-mark`, { mark: 'not_a_mark' })).status).toBe(400);
  });

  it('a mark needs the organizer', async () => {
    const g = await smartGroup();
    const s = await g.sessionOn('2026-10-27');
    const player = await playerPhone(g.ctx, 'Blair');
    expect((await player.call('POST', `/api/admin/sessions/${s.id}/task-mark`, { mark: 'night_text' })).status).toBe(401);
  });

  it('a wrong or missing secret gets Not found and sends nothing', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dash();
    await fill(g, '2026-11-03', 3);
    g.app.now = at('2026-11-03T01:00:00Z');
    expect((await g.tick('wrong')).status).toBe(404);
    expect((await g.tick('')).status).toBe(404);
    expect((await g.tick(SECRET.slice(0, -1) + 'x')).status).toBe(404);
    expect(g.sent).toEqual([]);
    const noSecret = await smartGroup();
    noSecret.app.env = { ...noSecret.app.env, CRON_SECRET: undefined };
    expect((await noSecret.tick()).status).toBe(404);
  });

  it('the Smart alerts switch (and the main Telegram switch) silence the tick', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dash();
    await fill(g, '2026-11-03', 3);
    expect((await g.dash()).alerts.smartAlerts).toBe(true);
    await g.ctx.organizer.call('PUT', '/api/admin/alerts', { smartAlerts: false });
    expect((await g.dash()).alerts.smartAlerts).toBe(false);
    g.app.now = at('2026-11-03T01:00:00Z');
    expect((await g.tick()).data.skipped).toBe('smart_off');
    await g.ctx.organizer.call('PUT', '/api/admin/alerts', { smartAlerts: true, enabled: false });
    expect((await g.tick()).data.skipped).toBe('alerts_off');
    await g.ctx.organizer.call('PUT', '/api/admin/alerts', { enabled: true });
    await g.tick();
    expect(g.sent).toEqual([`Tuesday: 3 players in, need a 4th. Text the group: ${ADMIN}`]);
  });

  it('a failed Telegram send is written down and retried on the next tick, and the site keeps working', async () => {
    const g = await smartGroup(2);
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dash();
    const s = await fill(g, '2026-11-03', 3);
    g.app.now = at('2026-11-03T01:00:00Z');
    const first = await g.tick();
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ sent: 0, failed: 1 });
    const failed = await g.app.db.prepare("SELECT task, detail FROM task_log WHERE kind = 'failed'").all<{ task: string; detail: string }>();
    expect(failed.results).toEqual([{ task: 'night', detail: 'Telegram asked us to slow down. Try again in a minute.' }]);
    // A player's tap is unaffected.
    const phone = await playerPhone(g.ctx, 'Frankie');
    expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    await g.app.settle();
    g.sent.length = 0;
    // (The join's own "it's on" alert used up the second fake failure.) Now 4 are in, and the retry says so.
    g.app.now += 5 * MIN;
    expect((await g.tick()).data).toMatchObject({ sent: 1 });
    expect(g.sent).toEqual([`Tuesday: 4 players in. Text the group to confirm: ${ADMIN}`]);
    g.app.now += 5 * MIN;
    expect((await g.tick()).data).toMatchObject({ sent: 0, failed: 0 });
  });

  it('a broken Telegram (network error) never breaks the tick', async () => {
    const g = await smartGroup();
    g.app.env = { ...g.app.env, TELEGRAM_FETCH: (async () => { throw new Error('down'); }) as typeof fetch };
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dash();
    await fill(g, '2026-11-03', 3);
    g.app.now = at('2026-11-03T01:00:00Z');
    const r = await g.tick();
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ sent: 0, failed: 1 });
  });

  it('two ticks at the same moment send an alert once', async () => {
    const g = await smartGroup();
    g.app.now = at('2026-11-02T17:00:00Z');
    await g.dash();
    await fill(g, '2026-11-03', 3);
    g.app.now = at('2026-11-03T01:00:00Z');
    await Promise.all([g.tick(), g.tick(), g.tick()]);
    expect(g.sent).toEqual([`Tuesday: 3 players in, need a 4th. Text the group: ${ADMIN}`]);
  });

  it('the TEST smart alert is clearly labeled and refused in Pretend', async () => {
    const g = await smartGroup();
    const r = await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {});
    expect(r.status).toBe(200);
    await g.app.settle();
    expect(g.sent[0].startsWith('TEST smart alert from Pickleball Bros.')).toBe(true);
    const p = await g.ctx.organizer.call('POST', '/api/admin/alerts/smart-test', {}, { 'X-Pretend-Now': '2026-11-03T12:00' });
    expect(p.status).toBe(403);
  });
});

describe('the cron Worker', () => {
  it('only knocks on /api/cron/tick with the secret, and a failure is just a number', async () => {
    const { knock } = await import('../worker/cron');
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    expect(await knock({ SITE_URL: 'https://pickleball-club-9h0.pages.dev/', CRON_SECRET: SECRET }, ok)).toBe(200);
    expect(calls[0].url).toBe('https://pickleball-club-9h0.pages.dev/api/cron/tick');
    expect((calls[0].init.headers as Record<string, string>)['X-Cron-Secret']).toBe(SECRET);
    expect(await knock({ SITE_URL: 'https://x.example', CRON_SECRET: SECRET }, (async () => { throw new Error('down'); }) as typeof fetch)).toBe(0);
  });
});
