// Dry run: games moved off the 8:00 to 10:00 PM default. Tue Nov 3 to 7:00 to
// 9:00 PM (EST), Thu Nov 5 to 7:30 to 9:30 PM (EST), Thu Oct 29 to 7:00 to
// 9:00 PM (EDT, before the Sun Nov 1 clock change), all through the existing
// PUT /api/admin/sessions/:id/time. Every deadline, window, card, word, text
// and calendar file must follow the game's real start and end, not 8 PM.
// Telegram is faked (TELEGRAM_FETCH); nothing is ever sent.
import { describe, expect, it } from 'vitest';
import { alertWhen } from '../shared/alerts';
import { checkInMessage, confirmationMessage, dayWord, deadlineAlertMessage, needPlayersMessage, pollMessage, replacementMessage, shareMessage, textWhen, textWhenAt } from '../shared/messages';
import { formatTime, formatTimeRange, formatTimeShort, localParts, playerDay, suggestDay, weekLabel, weekTier } from '../shared/time';
import { suggestions } from '../src/pages/admin/suggestions';
import { buildTodo } from '../src/pages/admin/todo';
import { playerPhone, setupGroup, TestApp } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const at = (s: string) => Date.parse(s);
const plain = (s: string) => s.replace(/[  ]/g, ' ');

// The moved games (UTC).
const OCT29 = { date: '2026-10-29', startsAt: '2026-10-29T23:00:00.000Z', endsAt: '2026-10-30T01:00:00.000Z' }; // 7:00 to 9:00 PM EDT
const NOV3 = { date: '2026-11-03', startsAt: '2026-11-04T00:00:00.000Z', endsAt: '2026-11-04T02:00:00.000Z' }; // 7:00 to 9:00 PM EST
const NOV5 = { date: '2026-11-05', startsAt: '2026-11-06T00:30:00.000Z', endsAt: '2026-11-06T02:30:00.000Z' }; // 7:30 to 9:30 PM EST

async function dash(ctx: Ctx) {
  const r = await ctx.organizer.call('GET', '/api/admin/dashboard');
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const easternDate = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: TZ });
async function on(ctx: Ctx, date: string) {
  const all = (await dash(ctx)).sessions.filter((x: any) => easternDate(x.startsAt) === date);
  expect(all.length, `games on ${date}`).toBe(1); // moving never leaves a second 8 PM game behind
  return all[0];
}
async function move(ctx: Ctx, g: { date: string; startsAt: string; endsAt: string }) {
  const s = await on(ctx, g.date);
  const r = await ctx.organizer.call('PUT', `/api/admin/sessions/${s.id}/time`, { startsAt: g.startsAt, endsAt: g.endsAt });
  expect(r.status, r.text).toBe(200);
  return on(ctx, g.date);
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) {
    const r = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
    expect(r.status, r.text).toBe(200);
  }
}
const out = async (ctx: Ctx, id: string, name: string) => (await playerPhone(ctx, name)).call('POST', `/api/sessions/${id}/withdraw`, {});

/** A group (clock: Mon Oct 26 noon) with the three games moved. */
async function movedGroup(app?: TestApp) {
  const ctx = await setupGroup(app);
  await move(ctx, OCT29);
  await move(ctx, NOV3);
  await move(ctx, NOV5);
  return ctx;
}

describe('moving the games', () => {
  it('saves the new times and resets the deadline to 12 hours before the new start', async () => {
    const ctx = await setupGroup();
    // Tue Nov 3 starts with the 8 PM default: deadline 8:00 AM EST.
    expect((await on(ctx, NOV3.date)).cancellationDeadlineAt).toBe('2026-11-03T13:00:00.000Z');
    // To 7:30 first, then 7:00: the deadline follows each time.
    let s = await move(ctx, { date: NOV3.date, startsAt: '2026-11-04T00:30:00.000Z', endsAt: '2026-11-04T02:30:00.000Z' });
    expect(s.cancellationDeadlineAt).toBe('2026-11-03T12:30:00.000Z'); // 7:30 AM EST
    s = await move(ctx, NOV3);
    expect(s).toMatchObject({ startsAt: NOV3.startsAt, endsAt: NOV3.endsAt, cancellationDeadlineAt: '2026-11-03T12:00:00.000Z', moved: true });
    expect(plain(formatTime(s.cancellationDeadlineAt, TZ))).toBe('7:00 AM');
    s = await move(ctx, NOV5);
    expect(s).toMatchObject({ startsAt: NOV5.startsAt, endsAt: NOV5.endsAt, cancellationDeadlineAt: '2026-11-05T12:30:00.000Z' });
    s = await move(ctx, OCT29);
    expect(s).toMatchObject({ startsAt: OCT29.startsAt, endsAt: OCT29.endsAt, cancellationDeadlineAt: '2026-10-29T11:00:00.000Z' }); // 7:00 AM EDT
  });

  it('a booked game keeps its deadline on "I booked it", and a move resets it to the new start', async () => {
    const ctx = await setupGroup();
    let s = await on(ctx, NOV3.date);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {})).status).toBe(200);
    s = await move(ctx, NOV3);
    expect(s.cancellationDeadlineAt).toBe('2026-11-03T12:00:00.000Z');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {})).status).toBe(200);
    expect((await on(ctx, NOV3.date)).cancellationDeadlineAt).toBe('2026-11-03T12:00:00.000Z');
  });

  it('the moved games stay put (no 8 PM copy comes back) as the clock crosses Sun Nov 1', async () => {
    const ctx = await movedGroup();
    for (const now of ['2026-10-31T12:00:00-04:00', '2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00', '2026-11-01T21:00:00-05:00', '2026-11-03T09:00:00-05:00']) {
      ctx.app.now = at(now);
      expect((await on(ctx, NOV3.date)).startsAt, now).toBe(NOV3.startsAt);
      expect((await on(ctx, NOV5.date)).startsAt, now).toBe(NOV5.startsAt);
    }
  });

  it('DST: Thu Oct 29 (EDT) and Tue Nov 3 (EST) both read 7:00 PM local', async () => {
    const ctx = await movedGroup();
    for (const g of [OCT29, NOV3]) {
      const s = await on(ctx, g.date);
      expect(localParts(Date.parse(s.startsAt), TZ)).toMatchObject({ hour: 19, minute: 0 });
      expect(plain(formatTimeRange(s.startsAt, s.endsAt, TZ))).toBe('7:00 to 9:00 PM');
      expect(plain(formatTimeShort(s.startsAt, s.endsAt, TZ))).toBe('7–9 PM');
    }
    const thu = await on(ctx, NOV5.date);
    expect(plain(formatTimeRange(thu.startsAt, thu.endsAt, TZ))).toBe('7:30 to 9:30 PM');
    expect(plain(formatTimeShort(thu.startsAt, thu.endsAt, TZ))).toBe('7:30–9:30 PM');
  });
});

describe('late drops follow the real deadline', () => {
  it('Tue Nov 3 (7 PM): a drop at 6:59 AM is not late, at 7:00 AM it is, with the Late drop card', async () => {
    const ctx = await movedGroup();
    const s = await on(ctx, NOV3.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    const entry = async () => (await on(ctx, NOV3.date)).roster.find((r: any) => r.name === 'Emery');
    ctx.app.now = at('2026-11-03T06:59:00-05:00');
    expect((await on(ctx, NOV3.date)).state.flags.deadlinePassed).toBe(false);
    expect((await out(ctx, s.id, 'Emery')).status).toBe(200);
    expect((await entry()).lateDropAt).toBeNull();
    await join(ctx, s.id, ['Emery']);
    ctx.app.now = at('2026-11-03T07:00:00-05:00');
    expect((await on(ctx, NOV3.date)).state.flags.deadlinePassed).toBe(true);
    expect((await out(ctx, s.id, 'Emery')).status).toBe(200);
    expect((await entry()).lateDropAt).toBe('2026-11-03T12:00:00.000Z');
    expect(buildTodo(await dash(ctx)).some((i: any) => i.kind === 'latedrop' && i.session.id === s.id)).toBe(true);
  });

  it('Thu Oct 29 (7 PM EDT): late from 7:00 AM EDT', async () => {
    const ctx = await movedGroup();
    const s = await on(ctx, OCT29.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    ctx.app.now = at('2026-10-29T06:59:00-04:00');
    await out(ctx, s.id, 'Emery');
    expect((await on(ctx, OCT29.date)).roster.find((r: any) => r.name === 'Emery').lateDropAt).toBeNull();
    await join(ctx, s.id, ['Emery']);
    ctx.app.now = at('2026-10-29T07:00:00-04:00');
    await out(ctx, s.id, 'Emery');
    expect((await on(ctx, OCT29.date)).roster.find((r: any) => r.name === 'Emery').lateDropAt).toBe('2026-10-29T11:00:00.000Z');
  });
});

describe('Telegram drop alert (faked) follows the real start', () => {
  async function connected() {
    const app = new TestApp();
    const sent: string[] = [];
    app.env = {
      ...app.env,
      SITE_URL: 'https://pickleball.example',
      TELEGRAM_BOT_TOKEN: '123456:FAKE-test-token-never-real',
      TELEGRAM_CHAT_ID: '9988776655',
      TELEGRAM_FETCH: (async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)).text);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    };
    const ctx = await movedGroup(app);
    const texts = async () => (await app.settle(), sent.splice(0));
    return { ctx, texts };
  }

  it('Tue Nov 3 7 PM: the 36-hour window opens Mon 7:00 AM; a 7:00 AM Tue drop is a Late drop, 12 hrs before', async () => {
    const { ctx, texts } = await connected();
    const s = await on(ctx, NOV3.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await texts();
    ctx.app.now = at('2026-11-02T06:59:00-05:00'); // 36 hr 1 min before 7 PM Tue
    await out(ctx, s.id, 'Frankie');
    expect(await texts()).toEqual([]);
    ctx.app.now = at('2026-11-02T07:00:00-05:00'); // exactly 36 hours
    await out(ctx, s.id, 'Emery');
    expect(await texts()).toEqual(['Emery dropped out of Tue Nov 3, 7:00 PM (36 hrs before). 4 in now.']);
    await join(ctx, s.id, ['Emery']);
    await texts();
    ctx.app.now = at('2026-11-03T06:59:00-05:00');
    await out(ctx, s.id, 'Emery');
    expect(await texts()).toEqual(['Emery dropped out of Tue Nov 3, 7:00 PM (12 hrs before). 4 in now.']);
    await join(ctx, s.id, ['Emery']);
    await texts();
    ctx.app.now = at('2026-11-03T07:00:00-05:00');
    await out(ctx, s.id, 'Emery');
    expect(await texts()).toEqual(['Late drop: Emery dropped out of Tue Nov 3, 7:00 PM (12 hrs before). 4 in now.']);
  });

  it('Thu Nov 5 7:30 PM: the alert names 7:30 PM', async () => {
    const { ctx, texts } = await connected();
    const s = await on(ctx, NOV5.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await texts();
    ctx.app.now = at('2026-11-05T09:30:00-05:00');
    await out(ctx, s.id, 'Devon');
    expect(await texts()).toEqual(['Late drop: Devon dropped out of Thu Nov 5, 7:30 PM (10 hrs before). 3 in now, under 4.']);
    expect(plain(alertWhen(NOV5.startsAt, TZ))).toBe('Thu Nov 5, 7:30 PM');
  });
});

describe('cards and cutoffs', () => {
  it('tied to the start: day-before from Mon 7:00 PM, last call from Tue 6:00 AM, deadline 7:00 AM', async () => {
    const ctx = await movedGroup();
    const card = async (now: string) => {
      ctx.app.now = at(now);
      const s = await on(ctx, NOV3.date);
      return { dayBefore: s.cards.dayBefore, lastCall: s.cards.lastCall, inCheckIn: s.state.flags.inCheckIn };
    };
    expect(await card('2026-11-02T18:59:00-05:00')).toEqual({ dayBefore: false, lastCall: false, inCheckIn: false });
    expect(await card('2026-11-02T19:00:00-05:00')).toEqual({ dayBefore: true, lastCall: false, inCheckIn: true });
    expect(await card('2026-11-03T05:59:00-05:00')).toEqual({ dayBefore: true, lastCall: false, inCheckIn: true });
    expect(await card('2026-11-03T06:00:00-05:00')).toEqual({ dayBefore: true, lastCall: true, inCheckIn: true });
    expect(await card('2026-11-03T06:59:00-05:00')).toEqual({ dayBefore: true, lastCall: true, inCheckIn: true });
    expect(await card('2026-11-03T07:00:00-05:00')).toEqual({ dayBefore: false, lastCall: false, inCheckIn: true });
    // Player view: confirmation open from 24 hours before 7 PM.
    const phone = await playerPhone(ctx, 'Alex');
    ctx.app.now = at('2026-11-02T18:59:00-05:00');
    const v = async () => (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.startsAt === NOV3.startsAt);
    expect((await v()).confirmationOpen).toBe(false);
    ctx.app.now = at('2026-11-02T19:00:00-05:00');
    expect((await v()).confirmationOpen).toBe(true);
  });

  it('fixed clock times: pay-now from 8:00 AM game day; the check-in text suggestion from 6:00 PM the day before', async () => {
    const ctx = await movedGroup();
    const s = await on(ctx, NOV3.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const alex = await playerPhone(ctx, 'Alex');
    const due = async (now: string) => {
      ctx.app.now = at(now);
      return (await alex.call('GET', '/api/group')).data.payDue.some((o: any) => o.sessionId === s.id);
    };
    expect(await due('2026-11-03T07:59:00-05:00')).toBe(false);
    expect(await due('2026-11-03T08:00:00-05:00')).toBe(true);
    const checkin = async (now: string) => {
      ctx.app.now = at(now);
      return suggestions(await dash(ctx), ctx.app.now).some((c) => c.kind === 'checkin' && c.sessionId === s.id);
    };
    expect(await checkin('2026-11-02T17:59:00-05:00')).toBe(false);
    expect(await checkin('2026-11-02T18:00:00-05:00')).toBe(true);
  });
});

describe('started, over, Finalize, and the post-game note at the real times', () => {
  it('Tue Nov 3: started at 7:00 PM, over at 9:00 PM; Finalize from 9:00 PM, refused at 8:59 PM', async () => {
    const ctx = await movedGroup();
    const s = await on(ctx, NOV3.date);
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const phone = await playerPhone(ctx, 'Alex');
    const view = async (now: string) => {
      ctx.app.now = at(now);
      return (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.startsAt === NOV3.startsAt);
    };
    expect((await view('2026-11-03T18:59:00-05:00')).started).toBe(false);
    expect((await view('2026-11-03T19:00:00-05:00')).started).toBe(true);
    expect((await view('2026-11-03T20:59:00-05:00')).past).toBe(false);
    expect(await view('2026-11-03T21:00:00-05:00')).toBeUndefined(); // over: off the player list

    const fin = async (now: string) => {
      ctx.app.now = at(now);
      const d = await dash(ctx);
      return { needs: d.sessions.find((x: any) => x.id === s.id).needsFinalize, todo: buildTodo(d).some((i: any) => i.kind === 'finalize' && i.session.id === s.id) };
    };
    expect(await fin('2026-11-03T19:00:00-05:00')).toEqual({ needs: false, todo: false });
    expect(await fin('2026-11-03T20:59:00-05:00')).toEqual({ needs: false, todo: false });
    expect(await fin('2026-11-03T21:00:00-05:00')).toEqual({ needs: true, todo: true });
    ctx.app.now = at('2026-11-03T20:59:00-05:00');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(409);
    ctx.app.now = at('2026-11-03T21:00:00-05:00');
    const ok = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    expect(ok.status, ok.text).toBe(200);
    // The post-game note (Final price) is suggested right after finalizing.
    const d = await dash(ctx);
    const note = suggestions(d, ctx.app.now).find((c) => c.kind === 'final' && c.sessionId === s.id);
    expect(note).toBeTruthy();
    expect(plain(note!.when)).toBe('Tue, Nov 3 · 7:00 to 9:00 PM');
    expect(note!.body).toMatch(/^Pickleball Tue, Nov 3 is final: 4 played, \$14 each\./);
  });

  it('Thu Nov 5 7:30 PM: started at 7:30, Finalize from 9:30 PM not 9:29; Thu Oct 29 from 9:00 PM EDT', async () => {
    const ctx = await movedGroup();
    const thu = await on(ctx, NOV5.date);
    const oct = await on(ctx, OCT29.date);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, oct.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const phone = await playerPhone(ctx, 'Alex');
    ctx.app.now = at('2026-11-05T19:29:00-05:00');
    expect((await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === thu.id).started).toBe(false);
    ctx.app.now = at('2026-11-05T19:30:00-05:00');
    expect((await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === thu.id).started).toBe(true);
    const needs = async (id: string, now: string) => {
      ctx.app.now = at(now);
      return (await dash(ctx)).sessions.find((x: any) => x.id === id).needsFinalize;
    };
    expect(await needs(oct.id, '2026-10-29T20:59:00-04:00')).toBe(false);
    expect(await needs(oct.id, '2026-10-29T21:00:00-04:00')).toBe(true);
    expect(await needs(thu.id, '2026-11-05T21:29:00-05:00')).toBe(false);
    ctx.app.now = at('2026-11-05T21:29:00-05:00');
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/finalize`, { everyone: true })).status).toBe(409);
    expect(await needs(thu.id, '2026-11-05T21:30:00-05:00')).toBe(true);
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${thu.id}/finalize`, { everyone: true })).status).toBe(200);
  });
});

describe('day words for a 7:00 PM game (already Wednesday in UTC)', () => {
  const cases: [string, string, string, string, string, string][] = [
    // [clock, game, playerDay, suggestDay, week label, text dayWord]
    ['2026-10-31T12:00:00-04:00', NOV3.startsAt, 'next Tuesday', 'Tuesday', 'Next week', 'Tue Nov 3'],
    ['2026-11-01T21:00:00-05:00', NOV3.startsAt, 'next Tuesday', 'Tuesday', 'Next week', 'Tue Nov 3'],
    ['2026-11-02T23:00:00-05:00', NOV3.startsAt, 'tomorrow', 'tomorrow', 'This week', 'tomorrow'],
    ['2026-11-03T09:00:00-05:00', NOV3.startsAt, 'tonight', 'tonight', 'This week', 'tonight'],
    ['2026-11-03T18:59:00-05:00', NOV3.startsAt, 'tonight', 'tonight', 'This week', 'tonight'],
    ['2026-11-03T21:30:00-05:00', NOV5.startsAt, 'this Thursday', 'Thursday', 'This week', 'Thu Nov 5'],
    ['2026-11-04T23:30:00-05:00', NOV5.startsAt, 'tomorrow', 'tomorrow', 'This week', 'tomorrow'],
    ['2026-10-26T12:00:00-04:00', OCT29.startsAt, 'this Thursday', 'Thursday', 'This week', 'Thu Oct 29'],
    ['2026-10-29T18:59:00-04:00', OCT29.startsAt, 'tonight', 'tonight', 'This week', 'tonight'],
  ];
  it.each(cases)('at %s, game %s', async (now, game, pd, sd, label, dw) => {
    const ctx = await movedGroup();
    ctx.app.now = at(now);
    const g = (await (await playerPhone(ctx, 'Alex')).call('GET', '/api/group')).data;
    const s = g.sessions.find((x: any) => x.startsAt === game);
    expect(s).toBeTruthy();
    const nowMs = Date.parse(g.now);
    expect(playerDay(s.startsAt, TZ, nowMs).word).toBe(pd);
    expect(suggestDay(s.startsAt, TZ, nowMs).word).toBe(sd);
    expect(weekLabel(s.startsAt, nowMs, TZ)).toBe(label);
    expect(weekTier(s.startsAt, nowMs, TZ)).toBe(label === 'This week' ? 'this' : 'next');
    expect(dayWord(s.startsAt, TZ, nowMs)).toBe(dw);
    const t = game === NOV5.startsAt ? '7:30 PM' : '7:00 PM';
    expect(plain(textWhenAt(s.startsAt, TZ, nowMs))).toBe(`${dw}, ${t}`);
  });
});

describe('calendar file and texts', () => {
  it('.ics has the real start and end in Detroit time', async () => {
    const ctx = await movedGroup();
    const phone = await playerPhone(ctx, 'Alex');
    for (const [g, a, b] of [
      [OCT29, '20261029T190000', '20261029T210000'],
      [NOV3, '20261103T190000', '20261103T210000'],
      [NOV5, '20261105T193000', '20261105T213000'],
    ] as const) {
      const s = await on(ctx, g.date);
      const r = await phone.call('GET', `/api/sessions/${s.id}/calendar.ics`);
      expect(r.status).toBe(200);
      expect(r.text).toContain(`DTSTART;TZID=America/Detroit:${a}`);
      expect(r.text).toContain(`DTEND;TZID=America/Detroit:${b}`);
    }
  });

  it('no text says 8:00 PM or 10:00 PM for a moved game', async () => {
    const ctx = await movedGroup();
    ctx.app.now = at('2026-11-02T12:00:00-05:00');
    const tue = await on(ctx, NOV3.date);
    const thu = await on(ctx, NOV5.date);
    const link = 'pickleball.example';
    const nowMs = ctx.app.now;
    const texts = [
      pollMessage(tue, TZ, 1400, `https://${link}`),
      shareMessage(tue, TZ, nowMs, link),
      needPlayersMessage(tue, TZ, nowMs, 2, link),
      checkInMessage(tue, TZ, nowMs, link),
      confirmationMessage('Alex', tue, TZ, link),
      replacementMessage(tue, TZ, link),
      deadlineAlertMessage(tue, TZ, tue.cancellationDeadlineAt),
      textWhen(tue.startsAt, TZ),
      pollMessage(thu, TZ, 1400, `https://${link}`),
      shareMessage(thu, TZ, nowMs, link),
    ].map(plain);
    expect(texts[0]).toBe(`Pickleball Tue Nov 3, 7:00 to 9:00 PM. $14 each. In or out? ${link}`);
    expect(texts[1]).toBe(`Pickleball tomorrow, 7:00 PM. In or out here: ${link}`);
    expect(texts[4]).toBe(`Hey Alex! Are you still in for pickleball Tuesday, Nov 3, 7:00 to 9:00 PM? Confirm or drop out here: ${link}`);
    expect(texts[6]).toContain('The court cancellation deadline is Tue, Nov 3, 7:00 AM.');
    expect(texts[8]).toBe(`Pickleball Thu Nov 5, 7:30 to 9:30 PM. $14 each. In or out? ${link}`);
    for (const t of texts) expect(t).not.toMatch(/8:00 PM|10:00 PM|8–10|8-10/);
    // The organizer's Text menu cards for these games.
    const d = await dash(ctx);
    for (const c of suggestions(d, nowMs)) expect(plain(`${c.when} ${c.body}`)).not.toMatch(/8:00 PM|10:00 PM|8 to 10/);
  });
});
