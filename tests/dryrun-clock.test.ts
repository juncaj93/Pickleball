// Pre-launch dry run of the November clock change. Daylight saving ends Sun
// Nov 1, 2026 at 2:00 AM (EDT UTC-4 -> EST UTC-5); the first real game is
// Tue Nov 3. A fake clock walks Sat Oct 31 through Wed Nov 4 and checks the
// real API (player and organizer views) plus the shared helpers the screens
// and texts use on what the API returns.
import { describe, expect, it } from 'vitest';
import { sessionCalendar } from '../shared/calendar';
import { deadlineMs } from '../shared/cards';
import { checkInMessage, dayWord, needPlayersMessage, pollMessage, shareMessage, textDay, textWhen, textWhenAt } from '../shared/messages';
import { venmoNote } from '../shared/money';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { formatDateTime, formatTime, formatTimeRange, localParts, playerDay, suggestDay, wantInTitle, weekLabel, weekTier, zonedTimeToUtc } from '../shared/time';
import { buildTodo } from '../src/pages/admin/todo';
import { HOUR, playerPhone, setupGroup } from './harness';

type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const TZ = 'America/Detroit';
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const plain = (s: string) => s.replace(/[  ]/g, ' ');

// The clock, in UTC, with its Eastern wall time.
const T = {
  satNoon: at('2026-10-31T12:00:00-04:00'), // Sat Oct 31 12:00 PM EDT
  sat9pm: at('2026-10-31T21:00:00-04:00'), // Sat 9:00 PM EDT (already Sun Nov 1 in UTC)
  sun1230: at('2026-11-01T00:30:00-04:00'), // Sun 12:30 AM EDT, before 2 AM
  sun130edt: at('2026-11-01T01:30:00-04:00'), // Sun 1:30 AM, first time (EDT) = 05:30Z
  sun130est: at('2026-11-01T01:30:00-05:00'), // Sun 1:30 AM, second time (EST) = 06:30Z
  sun3am: at('2026-11-01T03:00:00-05:00'), // after the change
  sun9pm: at('2026-11-01T21:00:00-05:00'), // Sun 9:00 PM EST = Mon 02:00Z
  mon11pm: at('2026-11-02T23:00:00-05:00'), // Mon 11:00 PM EST = Tue 04:00Z
  tue759am: at('2026-11-03T07:59:00-05:00'),
  tue8am: at('2026-11-03T08:00:00-05:00'),
  tue9am: at('2026-11-03T09:00:00-05:00'),
  tue759pm: at('2026-11-03T19:59:00-05:00'),
  tue8pm: at('2026-11-03T20:00:00-05:00'),
  tue9pm: at('2026-11-03T21:00:00-05:00'),
  tue959pm: at('2026-11-03T21:59:00-05:00'),
  tue10pm: at('2026-11-03T22:00:00-05:00'),
  tue1001pm: at('2026-11-03T22:01:00-05:00'),
  tue11pm: at('2026-11-03T23:00:00-05:00'),
  tue1130pm: at('2026-11-03T23:30:00-05:00'), // already Wed in UTC
  wed9am: at('2026-11-04T09:00:00-05:00'),
};

const ALL_TIMES = Object.entries(T);

async function dash(ctx: Ctx) {
  const res = await ctx.organizer.call('GET', '/api/admin/dashboard');
  expect(res.status, res.text).toBe(200);
  return res.data;
}
/** A session by its Eastern calendar date. */
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
async function join(ctx: Ctx, id: string, names: string[]) {
  for (const n of names) {
    const res = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${id}/join`, {});
    expect(res.status, res.text).toBe(200);
  }
}

describe('session times across the change (from the API)', () => {
  it('Thu Oct 29 is 00:00Z to 02:00Z; Tue Nov 3 and Thu Nov 5 are 01:00Z to 03:00Z; all read 8:00 to 10:00 PM', async () => {
    const ctx = await setupGroup();
    for (const [name, now] of ALL_TIMES) {
      ctx.app.now = now;
      const sessions = (await dash(ctx)).sessions;
      const byDate = (d: string) => sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === d);
      expect(byDate('2026-10-29'), name).toMatchObject({ startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2026-10-30T02:00:00.000Z' });
      expect(byDate('2026-11-03'), name).toMatchObject({ startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' });
      expect(byDate('2026-11-05'), name).toMatchObject({ startsAt: '2026-11-06T01:00:00.000Z', endsAt: '2026-11-06T03:00:00.000Z' });
      // Every session, early or late in the horizon, is 8 to 10 PM Eastern on a Tue or Thu, and no duplicates were made.
      const starts = new Set<string>();
      for (const s of sessions) {
        const p = localParts(Date.parse(s.startsAt), TZ);
        const e = localParts(Date.parse(s.endsAt), TZ);
        expect([p.weekday, p.hour, p.minute, e.hour, e.minute], `${name} ${s.startsAt}`).toEqual([p.weekday === 2 ? 2 : 4, 20, 0, 22, 0]);
        expect(plain(formatTimeRange(s.startsAt, s.endsAt, TZ))).toBe('8:00 to 10:00 PM');
        expect(starts.has(s.startsAt), `duplicate ${s.startsAt} at ${name}`).toBe(false);
        starts.add(s.startsAt);
      }
    }
  });

  it('the player view shows the same times, and drops Tue Nov 3 only once it is over (10:00 PM Eastern)', async () => {
    const ctx = await setupGroup();
    const phone = await playerPhone(ctx, 'Alex');
    const tue = '2026-11-04T01:00:00.000Z';
    const has = async () => (await phone.call('GET', '/api/group')).data.sessions.some((s: any) => s.startsAt === tue);
    for (const now of [T.satNoon, T.sun130edt, T.sun130est, T.sun9pm, T.tue9am, T.tue759pm, T.tue8pm, T.tue959pm]) {
      ctx.app.now = now;
      expect(await has(), iso(now)).toBe(true);
    }
    for (const now of [T.tue10pm, T.tue1001pm, T.tue1130pm, T.wed9am]) {
      ctx.app.now = now;
      expect(await has(), iso(now)).toBe(false);
    }
    ctx.app.now = T.tue959pm;
    const g = (await phone.call('GET', '/api/group')).data;
    const s = g.sessions.find((x: any) => x.startsAt === tue);
    expect(s).toMatchObject({ endsAt: '2026-11-04T03:00:00.000Z', started: true, past: false });
  });

  it('the calendar file says 8:00 to 10:00 PM Detroit time for Tue Nov 3', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.sun130est;
    const s = await on(ctx, '2026-11-03');
    const phone = await playerPhone(ctx, 'Alex');
    const res = await phone.call('GET', `/api/sessions/${s.id}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('DTSTART;TZID=America/Detroit:20261103T200000');
    expect(res.text).toContain('DTEND;TZID=America/Detroit:20261103T220000');
    const thu = sessionCalendar({ id: 'x', startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2026-10-30T02:00:00.000Z', location: 'Club', nowIso: iso(T.satNoon) });
    expect(thu).toContain('DTSTART;TZID=America/Detroit:20261029T200000');
  });
});

describe('deadlines and windows land on Eastern wall-clock times', () => {
  it('Tue Nov 3: deadline 8:00 AM, check-in from Mon 8:00 PM, last call from 7:00 AM, booking opened Tue Oct 20 12:00 AM EDT', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.satNoon;
    const s = await on(ctx, '2026-11-03');
    expect(s.cancellationDeadlineAt).toBe('2026-11-03T13:00:00.000Z');
    expect(plain(formatDateTime(s.cancellationDeadlineAt, TZ))).toBe('Tue, Nov 3, 8:00 AM');
    expect(s.bookingOpensAt).toBe(iso(zonedTimeToUtc(2026, 10, 20, 0, 0, TZ)));
    expect(s.bookingOpensAt).toBe('2026-10-20T04:00:00.000Z');
    const thu29 = await on(ctx, '2026-10-29');
    expect(thu29.cancellationDeadlineAt).toBe('2026-10-29T12:00:00.000Z'); // 8:00 AM EDT
    // Thu Nov 12 opens Thu Oct 29 (EDT); Tue Nov 17 opens Tue Nov 3 (EST): both 12:00 AM local.
    expect((await on(ctx, '2026-11-12')).bookingOpensAt).toBe('2026-10-29T04:00:00.000Z');
    ctx.app.now = T.sun3am;
    expect((await on(ctx, '2026-11-17')).bookingOpensAt).toBe('2026-11-03T05:00:00.000Z');

    // Day-before card and check-in: Mon Nov 2 8:00 PM EST = Tue 01:00Z.
    ctx.app.now = at('2026-11-02T19:59:00-05:00');
    let x = await on(ctx, '2026-11-03');
    expect(x.cards.dayBefore).toBe(false);
    expect(x.state.flags.inCheckIn).toBe(false);
    ctx.app.now = at('2026-11-02T20:00:00-05:00');
    x = await on(ctx, '2026-11-03');
    expect(x.cards.dayBefore).toBe(true);
    expect(x.state.flags.inCheckIn).toBe(true);
    // Last call from 7:00 AM Tue.
    ctx.app.now = at('2026-11-03T06:59:00-05:00');
    expect((await on(ctx, '2026-11-03')).cards.lastCall).toBe(false);
    ctx.app.now = at('2026-11-03T07:00:00-05:00');
    expect((await on(ctx, '2026-11-03')).cards.lastCall).toBe(true);
    // Deadline passes at 8:00 AM: cards close, the flag turns on.
    ctx.app.now = T.tue759am;
    x = await on(ctx, '2026-11-03');
    expect(x.state.flags.deadlinePassed).toBe(false);
    expect(x.cards.lastCall).toBe(true);
    ctx.app.now = T.tue8am;
    x = await on(ctx, '2026-11-03');
    expect(x.state.flags.deadlinePassed).toBe(true);
    expect(x.cards).toEqual({ dayBefore: false, lastCall: false });
  });

  it('a session first created after the change (Tue Dec 15) still gets an 8:00 AM deadline', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.wed9am;
    const s = await on(ctx, '2026-12-15');
    expect(s.startsAt).toBe('2026-12-16T01:00:00.000Z');
    expect(plain(formatTime(s.cancellationDeadlineAt, TZ))).toBe('8:00 AM');
  });

  it('late drop: Tue Nov 3 at 7:59 AM is not late, at 8:00 AM it is', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.satNoon;
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const devon = await playerPhone(ctx, 'Devon');
    const entry = async () => (await on(ctx, '2026-11-03')).roster.find((r: any) => r.name === 'Devon');
    ctx.app.now = T.tue759am;
    expect((await devon.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect((await entry()).lateDropAt).toBeNull();
    expect((await devon.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    ctx.app.now = T.tue8am;
    expect((await devon.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect((await entry()).lateDropAt).toBe('2026-11-03T13:00:00.000Z');
    expect(deadlineMs({ startsAt: s.startsAt, cancellationDeadlineAt: null }, DEFAULT_SETTINGS)).toBe(T.tue8am);
  });

  it('pay-now card: Tue Nov 3 is due from 8:00 AM Eastern, not before', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.satNoon;
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const alex = await playerPhone(ctx, 'Alex');
    const due = async () => (await alex.call('GET', '/api/group')).data.payDue.some((o: any) => o.sessionId === s.id);
    for (const now of [T.sun130edt, T.sun130est, T.sun9pm, T.mon11pm, T.tue759am]) {
      ctx.app.now = now;
      expect(await due(), iso(now)).toBe(false);
    }
    for (const now of [T.tue8am, T.tue759pm, T.tue1130pm]) {
      ctx.app.now = now;
      expect(await due(), iso(now)).toBe(true);
    }
  });
});

describe('day words computed from the API on each day', () => {
  const tue3 = '2026-11-04T01:00:00.000Z';
  const thu5 = '2026-11-06T01:00:00.000Z';
  const tue10 = '2026-11-11T01:00:00.000Z';
  const thu12 = '2026-11-13T01:00:00.000Z';

  // [clock, game, playerDay, suggestDay ("Want in"), week tier, admin week label, text dayWord]
  const cases: [keyof typeof T, string, string, string, string, string, string][] = [
    ['satNoon', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['satNoon', thu5, 'next Thursday', 'Thursday', 'next', 'Next week', 'Thu Nov 5'],
    ['satNoon', tue10, 'Tue, Nov 10', 'next Tuesday', 'later', 'Week of Nov 9', 'Tue Nov 10'],
    ['sat9pm', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['sun1230', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['sun130edt', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['sun130est', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['sun3am', thu5, 'next Thursday', 'Thursday', 'next', 'Next week', 'Thu Nov 5'],
    ['sun9pm', tue3, 'next Tuesday', 'Tuesday', 'next', 'Next week', 'Tue Nov 3'],
    ['sun9pm', thu5, 'next Thursday', 'Thursday', 'next', 'Next week', 'Thu Nov 5'],
    ['sun9pm', tue10, 'Tue, Nov 10', 'next Tuesday', 'later', 'Week of Nov 9', 'Tue Nov 10'],
    ['mon11pm', tue3, 'tomorrow', 'tomorrow', 'this', 'This week', 'tomorrow'],
    ['tue9am', tue3, 'tonight', 'tonight', 'this', 'This week', 'tonight'],
    ['tue9am', thu5, 'this Thursday', 'Thursday', 'this', 'This week', 'Thu Nov 5'],
    ['tue9am', tue10, 'next Tuesday', 'next Tuesday', 'next', 'Next week', 'Tue Nov 10'],
    ['tue759pm', tue3, 'tonight', 'tonight', 'this', 'This week', 'tonight'],
    ['tue1130pm', thu5, 'this Thursday', 'Thursday', 'this', 'This week', 'Thu Nov 5'],
    ['tue1130pm', thu12, 'next Thursday', 'next Thursday', 'next', 'Next week', 'Thu Nov 12'],
    ['wed9am', thu5, 'tomorrow', 'tomorrow', 'this', 'This week', 'tomorrow'],
  ];

  it.each(cases)('%s looking at %s', async (clock, game, pd, sd, tier, label, dw) => {
    const ctx = await setupGroup();
    ctx.app.now = T[clock];
    const phone = await playerPhone(ctx, 'Alex');
    const g = (await phone.call('GET', '/api/group')).data;
    expect(g.now).toBe(iso(T[clock]));
    const s = g.sessions.find((x: any) => x.startsAt === game);
    expect(s, `${game} in the player view`).toBeTruthy();
    const nowMs = Date.parse(g.now);
    expect(playerDay(s.startsAt, g.group.timezone, nowMs).word).toBe(pd);
    expect(suggestDay(s.startsAt, TZ, nowMs).word).toBe(sd);
    expect(weekTier(s.startsAt, nowMs, TZ)).toBe(tier);
    expect(weekLabel(s.startsAt, nowMs, TZ)).toBe(label);
    expect(dayWord(s.startsAt, TZ, nowMs)).toBe(dw);
    expect(plain(textWhenAt(s.startsAt, TZ, nowMs))).toBe(`${dw}, 8:00 PM`);
  });

  it('"Want in?" titles on Sat Oct 31 and Sun Nov 1 night', () => {
    expect(wantInTitle(tue3, TZ, T.satNoon, false)).toBe('Want in Tuesday?');
    expect(wantInTitle(tue10, TZ, T.satNoon, false)).toBe('Want in next Tuesday?');
    expect(wantInTitle(tue3, TZ, T.sun9pm, false)).toBe('Want in Tuesday?'); // 2 days, though 1 day in UTC
    expect(wantInTitle(tue3, TZ, T.sun9pm, true)).toBe("Want in on Tuesday's waitlist?");
    expect(wantInTitle(tue3, TZ, T.mon11pm, false)).toBe('Want in tomorrow?');
  });
});

describe('texts for these days say the right day and 8:00 PM', () => {
  it('drafts built from the API session', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.sun9pm;
    const s = await on(ctx, '2026-11-03');
    const link = 'pickleball.example';
    expect(plain(pollMessage(s, TZ, 1400, `https://${link}`))).toBe(`Pickleball Tue Nov 3, 8:00 to 10:00 PM. $14 each. In or out? ${link}`);
    expect(plain(textWhen(s.startsAt, TZ))).toBe('Tue Nov 3, 8:00 PM');
    expect(plain(shareMessage(s, TZ, T.sun9pm, link))).toBe(`Pickleball Tue Nov 3, 8:00 PM. In or out here: ${link}`);
    expect(plain(shareMessage(s, TZ, T.sun130est, link))).toBe(`Pickleball Tue Nov 3, 8:00 PM. In or out here: ${link}`);
    expect(plain(needPlayersMessage(s, TZ, T.mon11pm, 2, link))).toBe(`Need 2 more for pickleball tomorrow, 8:00 PM. In? ${link}`);
    expect(plain(checkInMessage(s, TZ, T.tue9am, link))).toBe(`Pickleball tonight, 8:00 PM. Can't make it? Update here: ${link}`);
    expect(plain(checkInMessage(s, TZ, T.tue759pm, link))).toBe(`Pickleball tonight, 8:00 PM. Can't make it? Update here: ${link}`);
    // Late on game night it is already Wed in UTC: the game is still "Tue Nov 3".
    expect(textDay(s.startsAt, TZ)).toBe('Tue Nov 3');
    expect(venmoNote(s.startsAt, TZ, 'Alex')).toBe('Pickleball Tue Nov 3 - Alex');
    const thu29 = await on(ctx, '2026-10-29');
    expect(plain(textWhen(thu29.startsAt, TZ))).toBe('Thu Oct 29, 8:00 PM');
  });
});

describe('the Finalize card for Tue Nov 3', () => {
  it('shows from 10:00 PM Eastern, not at 9:00 PM or 9:59 PM; finalize is refused before 10:00 PM', async () => {
    const ctx = await setupGroup();
    ctx.app.now = T.satNoon;
    const s = await on(ctx, '2026-11-03');
    await join(ctx, s.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    const card = async () => {
      const d = await dash(ctx);
      const x = d.sessions.find((y: any) => y.id === s.id);
      return { needs: x.needsFinalize, todo: buildTodo(d).some((i: any) => i.kind === 'finalize' && i.session.id === s.id) };
    };
    for (const now of [T.sun130edt, T.sun130est, T.tue9am, T.tue759pm, T.tue8pm, T.tue9pm, T.tue959pm]) {
      ctx.app.now = now;
      expect(await card(), iso(now)).toEqual({ needs: false, todo: false });
    }
    for (const now of [T.tue10pm, T.tue1001pm, T.tue11pm, T.tue1130pm, T.wed9am]) {
      ctx.app.now = now;
      expect(await card(), iso(now)).toEqual({ needs: true, todo: true });
    }
    // Refused before the end (9:00 PM is the old EDT 10:00 PM; 9:59 PM is one minute early).
    for (const now of [T.tue9pm, T.tue959pm]) {
      ctx.app.now = now;
      const res = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
      expect(res.status, iso(now)).toBe(409);
      expect(res.data.error ?? res.text).toMatch(/not_over|Finalize after the game ends/);
    }
    ctx.app.now = T.tue10pm;
    const ok = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true });
    expect(ok.status, ok.text).toBe(200);
    expect(await card()).toEqual({ needs: false, todo: false });
  });

  it('player view: started at 8:00 PM, not at 7:59 PM', async () => {
    const ctx = await setupGroup();
    const phone = await playerPhone(ctx, 'Alex');
    const view = async () => (await phone.call('GET', '/api/group')).data.sessions.find((x: any) => x.startsAt === '2026-11-04T01:00:00.000Z');
    ctx.app.now = T.tue759pm;
    expect((await view()).started).toBe(false);
    ctx.app.now = T.tue8pm;
    expect((await view()).started).toBe(true);
    ctx.app.now = T.tue759pm - HOUR; // 6:59 PM: the old EDT 8:00 PM would be 7:00 PM EST
    expect((await view()).started).toBe(false);
  });
});

describe('no fixed offsets or zone-less local time in shared/ and server/', () => {
  it('a grep finds no getHours/getDay/getDate, no toLocale* without timeZone, no -04:00/-05:00 literals', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join: pjoin } = await import('node:path');
    const root = pjoin(__dirname, '..');
    const hits: string[] = [];
    for (const dir of ['shared', 'server']) {
      for (const f of readdirSync(pjoin(root, dir)).filter((n) => n.endsWith('.ts'))) {
        readFileSync(pjoin(root, dir, f), 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const bad =
              /\.(getHours|getMinutes|getDay|getDate|getMonth|getFullYear|setHours|getTimezoneOffset)\(/.test(line) ||
              (/toLocale(Date|Time)?String\(/.test(line) && !/timeZone/.test(line)) ||
              /[-+]0[45]:00|UTC-[45]/.test(line);
            if (bad) hits.push(`${dir}/${f}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
