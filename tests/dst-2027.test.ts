// Zip 47 audit: the two 2027 clock changes, on a fake clock.
// Spring: Sun Mar 14, 2027 at 2:00 AM the clock jumps to 3:00 AM (EST UTC-5 -> EDT UTC-4).
// Fall:   Sun Nov 7, 2027 at 2:00 AM the clock goes back to 1:00 AM (EDT UTC-4 -> EST UTC-5).
// Checks, in Eastern time, the days around both: game start times, the cancel-by time and the late window, "tonight" and
// "tomorrow", the real 5-minute clock (/api/cron/tick with a stub Telegram: nothing is ever sent), the reminders it sends, and
// the venue charge alert dates. The quick check that lets the clock skip games is swept across these same changes in
// tests/tick-fast.test.ts; this file goes through the real server instead.
import { describe, expect, it } from 'vitest';
import { LATE_FEES_HEADER } from '../shared/lateFees';
import { dayWord } from '../shared/messages';
import { dayLabelR2 } from '../shared/textsR2';
import { cancelByCardLine, cancelByShort, formatDateTime, formatTimeRange, localParts, playerDay, suggestDay, weekTier } from '../shared/time';
import { nightLastCallMs } from '../shared/tasks';
import { courtPeriod, dueAlerts, periodGames, startOfDayMs, type VenueGame } from '../shared/venueAlert';
import { type Client, HOUR, PIN, sentText, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const MIN = 60_000;
const SECRET = 'dst-2027-cron-secret-0123456789abcdef01234567';
const at = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const eastern = (ms: number) => plain(formatDateTime(iso(ms), TZ));
const dateOf = (isoStr: string) => new Date(isoStr).toLocaleDateString('en-CA', { timeZone: TZ });

interface Season {
  name: string;
  /** Eastern wall times (with their real UTC offsets) to walk the clock through. */
  walk: Record<string, string>;
  /** The Tuesday and Thursday games of the week before and the week of the change, and their UTC starts. */
  games: Record<string, string>;
  /** The Tuesday right after the change: its cancel-by moments. */
  tue: string;
  tueCutoff: { before: string; at: string };
  /** The 5-minute clock walk (Tue before the change through Thu after) and the games it plays with. */
  tick: { from: string; to: string; booked4: string; booked3: string };
}

const SPRING: Season = {
  name: 'spring (Sun Mar 14, 2027)',
  walk: {
    'Sat Mar 13 12:00 PM EST': '2027-03-13T12:00:00-05:00',
    'Sat Mar 13 11:59 PM EST': '2027-03-13T23:59:00-05:00',
    'Sun Mar 14 12:00 AM EST': '2027-03-14T00:00:00-05:00',
    'Sun Mar 14 1:59 AM EST': '2027-03-14T01:59:00-05:00',
    'Sun Mar 14 3:00 AM EDT': '2027-03-14T03:00:00-04:00', // one minute after 1:59 AM
    'Sun Mar 14 9:00 PM EDT': '2027-03-14T21:00:00-04:00',
    'Mon Mar 15 8:00 PM EDT': '2027-03-15T20:00:00-04:00', // already Tue in UTC
    'Mon Mar 15 11:59 PM EDT': '2027-03-15T23:59:00-04:00',
    'Tue Mar 16 12:00 AM EDT': '2027-03-16T00:00:00-04:00',
    'Tue Mar 16 9:00 AM EDT': '2027-03-16T09:00:00-04:00',
  },
  games: {
    '2027-03-09': '2027-03-10T01:00:00.000Z', // Tue 8:00 PM EST
    '2027-03-11': '2027-03-12T01:00:00.000Z', // Thu 8:00 PM EST
    '2027-03-16': '2027-03-17T00:00:00.000Z', // Tue 8:00 PM EDT
    '2027-03-18': '2027-03-19T00:00:00.000Z', // Thu 8:00 PM EDT
  },
  tue: '2027-03-16',
  tueCutoff: { before: '2027-03-16T07:59:00-04:00', at: '2027-03-16T08:00:00-04:00' },
  tick: { from: '2027-03-09T00:00:00-05:00', to: '2027-03-18T12:00:00-04:00', booked4: '2027-03-16', booked3: '2027-03-18' },
};

const FALL: Season = {
  name: 'fall (Sun Nov 7, 2027)',
  walk: {
    'Sat Nov 6 12:00 PM EDT': '2027-11-06T12:00:00-04:00',
    'Sat Nov 6 11:59 PM EDT': '2027-11-06T23:59:00-04:00',
    'Sun Nov 7 12:00 AM EDT': '2027-11-07T00:00:00-04:00',
    'Sun Nov 7 1:30 AM EDT (first time)': '2027-11-07T01:30:00-04:00',
    'Sun Nov 7 1:30 AM EST (second time)': '2027-11-07T01:30:00-05:00',
    'Sun Nov 7 3:00 AM EST': '2027-11-07T03:00:00-05:00',
    'Sun Nov 7 9:00 PM EST': '2027-11-07T21:00:00-05:00', // already Mon in UTC
    'Mon Nov 8 7:00 PM EST': '2027-11-08T19:00:00-05:00', // already Tue in UTC
    'Mon Nov 8 11:59 PM EST': '2027-11-08T23:59:00-05:00',
    'Tue Nov 9 12:00 AM EST': '2027-11-09T00:00:00-05:00',
    'Tue Nov 9 9:00 AM EST': '2027-11-09T09:00:00-05:00',
  },
  games: {
    '2027-11-02': '2027-11-03T00:00:00.000Z', // Tue 8:00 PM EDT
    '2027-11-04': '2027-11-05T00:00:00.000Z', // Thu 8:00 PM EDT
    '2027-11-09': '2027-11-10T01:00:00.000Z', // Tue 8:00 PM EST
    '2027-11-11': '2027-11-12T01:00:00.000Z', // Thu 8:00 PM EST
  },
  tue: '2027-11-09',
  tueCutoff: { before: '2027-11-09T07:59:00-05:00', at: '2027-11-09T08:00:00-05:00' },
  tick: { from: '2027-11-02T00:00:00-04:00', to: '2027-11-11T12:00:00-05:00', booked4: '2027-11-09', booked3: '2027-11-11' },
};

/** A fake group whose clock starts a week before `startIso`. Telegram is a stub that only records. */
async function world(startIso: string) {
  const app = new TestApp();
  const sent: { at: number; text: string }[] = [];
  app.env = {
    ...app.env,
    SITE_URL: 'https://pickleball.juncaj.net',
    TELEGRAM_BOT_TOKEN: '123456:FAKE-dst-token-never-real',
    TELEGRAM_CHAT_ID: '1',
    CRON_SECRET: SECRET,
    TELEGRAM_FETCH: (async (url: string, init: RequestInit) => {
      expect(url).toContain('api.telegram.org');
      sent.push({ at: app.now, text: sentText(JSON.parse(String(init.body))) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
  };
  const ctx = await setupGroup(app);
  app.now = at(startIso) - 7 * 24 * HOUR;
  const phones = new Map<string, Client>();
  const phone = async (name: string) => {
    let c = phones.get(name);
    if (!c) {
      c = app.client();
      c.groupKey = ctx.groupKey;
      const r = await c.call('POST', '/api/me', { playerId: ctx.byName[name] });
      expect(r.status, r.text).toBe(200);
      phones.set(name, c);
    }
    return c;
  };
  const admin = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    let r = await ctx.organizer.call(method, path, body, headers);
    if (r.status === 401) {
      await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN });
      r = await ctx.organizer.call(method, path, body, headers);
    }
    return r;
  };
  const dash = async (headers?: Record<string, string>) => {
    const r = await admin('GET', '/api/admin/dashboard', undefined, headers);
    expect(r.status, r.text).toBe(200);
    return r.data;
  };
  const on = async (date: string, headers?: Record<string, string>) => {
    const s = (await dash(headers)).sessions.find((x: any) => dateOf(x.startsAt) === date);
    if (!s) throw new Error(`no game on ${date}`);
    return s;
  };
  const tick = async () => {
    const r = await admin('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': SECRET });
    expect(r.status, r.text).toBe(200);
    await app.settle();
  };
  return { app, ctx, sent, phone, admin, dash, on, tick };
}

for (const season of [SPRING, FALL]) {
  describe(`clock change ${season.name}`, () => {
    it('every game stays 8:00 to 10:00 PM Eastern on a Tue or Thu at every moment, none doubled; the UTC start moves by the hour', async () => {
      const w = await world(Object.values(season.walk)[0]);
      for (const [label, when] of Object.entries(season.walk)) {
        w.app.now = at(when);
        const sessions = (await w.dash()).sessions;
        for (const [date, start] of Object.entries(season.games)) {
          const s = sessions.find((x: any) => dateOf(x.startsAt) === date);
          if (Date.parse(start) + 2 * HOUR <= w.app.now) continue; // over: may have left the list
          expect(s?.startsAt, `${label}: ${date}`).toBe(start);
          expect(s.endsAt, `${label}: ${date}`).toBe(iso(Date.parse(start) + 2 * HOUR));
        }
        const starts = new Set<string>();
        for (const s of sessions) {
          const p = localParts(Date.parse(s.startsAt), TZ);
          const e = localParts(Date.parse(s.endsAt), TZ);
          expect([p.weekday === 2 || p.weekday === 4, p.hour, p.minute, e.hour, e.minute], `${label} ${s.startsAt}`).toEqual([true, 20, 0, 22, 0]);
          expect(plain(formatTimeRange(s.startsAt, s.endsAt, TZ))).toBe('8:00 to 10:00 PM');
          expect(starts.has(s.startsAt), `duplicate ${s.startsAt} at ${label}`).toBe(false);
          starts.add(s.startsAt);
        }
        // The player screen gives the same times.
        const view = (await (await w.phone('Blair')).call('GET', '/api/group')).data;
        for (const s of view.sessions) {
          const p = localParts(Date.parse(s.startsAt), TZ);
          expect([p.hour, p.minute], `${label} player ${s.startsAt}`).toEqual([20, 0]);
        }
      }
    });

    it('the calendar file says 8:00 to 10:00 PM Detroit time for the Tuesday after the change', async () => {
      const w = await world(Object.values(season.walk)[0]);
      w.app.now = at(Object.values(season.walk)[0]);
      const s = await w.on(season.tue);
      const r = await (await w.phone('Blair')).call('GET', `/api/sessions/${s.id}/calendar.ics`);
      expect(r.status).toBe(200);
      const ymd = season.tue.replace(/-/g, '');
      expect(r.text).toContain(`DTSTART;TZID=America/Detroit:${ymd}T200000`);
      expect(r.text).toContain(`DTEND;TZID=America/Detroit:${ymd}T220000`);
    });

    it('cancel-by is 8:00 AM on game day; the red card line reads "tomorrow" then "today"; a drop at 7:59 AM is not late and at 8:00 AM it is', async () => {
      const w = await world(Object.values(season.walk)[0]);
      w.app.now = at(Object.values(season.walk)[0]);
      const s = await w.on(season.tue);
      expect(plain(formatDateTime(s.cancellationDeadlineAt, TZ))).toMatch(/, 8:00 AM$/);
      expect(s.cancellationDeadlineAt).toBe(iso(at(season.tueCutoff.at)));
      expect(plain(cancelByShort(s.startsAt, TZ))).toBe('Tue 8:00 AM');
      const cut = at(season.tueCutoff.at);
      expect(cancelByCardLine(s.startsAt, cut - 24 * HOUR - MIN, TZ)).toBeNull();
      expect(plain(cancelByCardLine(s.startsAt, cut - 24 * HOUR + MIN, TZ) ?? '')).toBe('Cancel by 8:00 AM tomorrow');
      expect(plain(cancelByCardLine(s.startsAt, cut - 8 * HOUR - MIN, TZ) ?? '')).toBe('Cancel by 8:00 AM tomorrow'); // 11:59 PM the night before
      expect(plain(cancelByCardLine(s.startsAt, cut - 8 * HOUR, TZ) ?? '')).toBe('Cancel by 8:00 AM today'); // 12:00 AM game day
      expect(cancelByCardLine(s.startsAt, cut, TZ)).toBeNull();

      for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) expect((await (await w.phone(n)).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
      const devon = await w.phone('Devon');
      const entry = async () => (await w.on(season.tue)).roster.find((r: any) => r.name === 'Devon');
      w.app.now = at(season.tueCutoff.before);
      expect((await devon.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
      expect((await entry()).lateDropAt).toBeNull();
      expect((await devon.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
      w.app.now = cut;
      expect((await devon.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
      expect((await entry()).lateDropAt).toBe(iso(cut));
    });

    it('with Late fees on: the drop window opens at 8:00 AM Eastern; 7:59 AM owes nothing, 8:00 AM owes $14 (3 left)', async () => {
      const w = await world(Object.values(season.walk)[0]);
      w.app.now = at(Object.values(season.walk)[0]);
      expect((await w.admin('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
      const h = { [LATE_FEES_HEADER]: 'on' };
      const s = await w.on(season.tue, h);
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) expect((await (await w.phone(n)).call('POST', `/api/sessions/${s.id}/join`, {}, h)).status).toBe(200);
      const view = async (n: string) => (await (await w.phone(n)).call('GET', '/api/group', undefined, h)).data;
      const mine = async (n: string) => (await view(n)).sessions.find((x: any) => x.id === s.id);
      expect((await mine('Emery')).dropCutoffAt).toBe(iso(at(season.tueCutoff.at)));
      // 7:59 AM: Emery drops (4 left) and Devon drops (3 left): neither is inside the window.
      w.app.now = at(season.tueCutoff.before);
      expect((await mine('Devon')).mine.lateDrop).toBeUndefined();
      for (const n of ['Emery', 'Devon']) {
        const r = await (await w.phone(n)).call('POST', `/api/sessions/${s.id}/withdraw`, {}, h);
        expect(r.status, r.text).toBe(200);
        expect(r.data.lateFee, n).toBeUndefined();
      }
      // Devon back in (4), then at 8:00 AM Devon drops again: the game is left with 3, so Devon owes $14.
      expect((await (await w.phone('Devon')).call('POST', `/api/sessions/${s.id}/join`, {}, h)).status).toBe(200);
      w.app.now = at(season.tueCutoff.at);
      expect((await mine('Devon')).mine.lateDrop).toMatchObject({ owes: true });
      const r = await (await w.phone('Devon')).call('POST', `/api/sessions/${s.id}/withdraw`, {}, h);
      expect(r.data.lateFee).toEqual({ cents: 1400, paid: false });
    });

    it('"tonight", "tomorrow" and the week words go by the Eastern calendar day at every moment around the change', () => {
      const tue = season.games[season.tue];
      const sun = Object.keys(season.walk).find((k) => k.startsWith('Sun') && k.includes('12:00 AM'))!;
      const satLate = Object.keys(season.walk).find((k) => k.startsWith('Sat') && k.includes('11:59 PM'))!;
      const monLate = Object.keys(season.walk).find((k) => k.startsWith('Mon') && k.includes('11:59 PM'))!;
      const tueMidnight = Object.keys(season.walk).find((k) => k.startsWith('Tue') && k.includes('12:00 AM'))!;
      const monEvening = Object.keys(season.walk).find((k) => k.startsWith('Mon') && !k.includes('11:59'))!;
      const now = (k: string) => at(season.walk[k]);
      // The night before the game: Mon evening (already Tue in UTC) and Mon 11:59 PM still say tomorrow.
      for (const k of [monEvening, monLate]) {
        expect(playerDay(tue, TZ, now(k)).word, k).toBe('tomorrow');
        expect(suggestDay(tue, TZ, now(k)).word, k).toBe('tomorrow');
        expect(dayWord(tue, TZ, now(k)), k).toBe('tomorrow');
        expect(dayLabelR2(tue, TZ, now(k)), k).toBe('Tomorrow');
      }
      // From 12:00 AM on game day: tonight.
      for (const k of [tueMidnight]) {
        expect(playerDay(tue, TZ, now(k)).word, k).toBe('tonight');
        expect(suggestDay(tue, TZ, now(k)).word, k).toBe('tonight');
        expect(dayWord(tue, TZ, now(k)), k).toBe('tonight');
        expect(dayLabelR2(tue, TZ, now(k)), k).toBe('Tonight');
      }
      // Two days out on the change day itself: the weekday (the "Want in?" words), and "next Tuesday" in Monday-to-Sunday weeks.
      for (const k of Object.keys(season.walk).filter((x) => x.startsWith('Sun'))) {
        expect(suggestDay(tue, TZ, now(k)).word, k).toBe('Tuesday');
        expect(playerDay(tue, TZ, now(k)).word, k).toBe('next Tuesday');
        // The player screen's weeks start on Sunday: from 12:00 AM Sunday the coming Tuesday is THIS WEEK.
        expect(weekTier(tue, now(k), TZ), k).toBe('this');
      }
      expect(weekTier(tue, now(satLate), TZ)).toBe('next');
      expect(weekTier(tue, now(sun), TZ)).toBe('this');
    });

    it('the real 5-minute clock: every alert once, on its Eastern wall-clock time, across the change', { timeout: 60_000 }, async () => {
      const w = await world(season.tick.from);
      expect((await w.admin('PUT', '/api/admin/game-day-text-switch', { on: true })).status).toBe(200);
      const b4 = await w.on(season.tick.booked4);
      const b3 = await w.on(season.tick.booked3);
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) expect((await (await w.phone(n)).call('POST', `/api/sessions/${b4.id}/join`, {})).status).toBe(200);
      for (const n of ['Alex', 'Blair', 'Casey']) expect((await (await w.phone(n)).call('POST', `/api/sessions/${b3.id}/join`, {})).status).toBe(200);
      for (const s of [b4, b3]) expect((await w.admin('POST', `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' })).status).toBe(200);
      w.sent.length = 0;
      for (let t = at(season.tick.from); t < at(season.tick.to); t += 5 * MIN) {
        w.app.now = t;
        await w.tick();
      }
      const lines = w.sent.map((s) => `${eastern(s.at)} | ${s.text.split('\n')[0].replace(/https:\/\/\S+/g, '<link>')}`);
      // Booking reminders: 6:45 AM and 7:30 AM on each Tue and Thu, for the game 14 days later (whose court opens at 7:00 AM),
      // including the ones whose game falls on the other side of the change. Never a duplicate, never an hour off.
      const bookings = lines.filter((l) => / opens at 7:00 AM| opened at 7:00 AM/.test(l));
      for (const l of bookings) expect(l, l).toMatch(/^(Tue|Thu), [A-Z][a-z]{2} \d{1,2}, (6:45|7:30) AM \| /);
      expect(bookings.length).toBe(8); // Tue, Thu, Tue, Thu of the two weeks: 4 days x 2
      expect(new Set(bookings).size).toBe(bookings.length);
      // The two booked games (4 in on the Tuesday after the change, 3 in on the Thursday).
      const others = lines.filter((l) => !bookings.includes(l));
      const d4 = localParts(Date.parse(b4.startsAt), TZ);
      const d3 = localParts(Date.parse(b3.startsAt), TZ);
      const md = (p: { month: number; day: number }, plus = 0) => {
        const x = new Date(Date.UTC(2027, p.month - 1, p.day + plus));
        return `${x.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${x.getUTCDate()}`;
      };
      expect(others).toEqual([
        `Mon, ${md(d4, -1)}, 7:00 PM | Tuesday: 4 players in. Text the group to confirm`,
        `Tue, ${md(d4)}, 7:00 PM | Tonight 8pm game starts in about an hour, 4 in. Text the players: <link>`,
        `Tue, ${md(d4)}, 10:30 PM | Tuesday: finalize who played`,
        `Wed, ${md(d3, -1)}, 7:00 PM | Thursday: 3 players in, need a 4th. Text the group`,
        `Wed, ${md(d3, -1)}, 10:00 PM | Thursday: only 3 players in. Cancel court: <link>`,
        `Wed, ${md(d3, -1)}, 10:30 PM | Thursday: court canceled? Now cancel the game and text everyone`,
      ]);
      // No Telegram in the night (12:00 to 6:44 AM), including the hour that is skipped or repeated.
      for (const s of w.sent) {
        const p = localParts(s.at, TZ);
        expect(p.hour * 60 + p.minute, eastern(s.at)).toBeGreaterThanOrEqual(6 * 60 + 45);
      }
    });

    it('venue charge days start at 12:00 AM Eastern on the change day, and a game counts by its Eastern date', () => {
      const spring = season === SPRING;
      const changeDay = spring ? '2027-03-14' : '2027-11-07';
      const [y, m, d] = changeDay.split('-').map(Number);
      // 12:00 AM Eastern on the change day is still before 2:00 AM, so it uses the offset from before the change.
      expect(iso(startOfDayMs(changeDay, TZ))).toBe(spring ? '2027-03-14T05:00:00.000Z' : '2027-11-07T04:00:00.000Z');
      // The day after uses the new offset.
      const next = `${changeDay.slice(0, 8)}${String(d + 1).padStart(2, '0')}`;
      expect(iso(startOfDayMs(next, TZ))).toBe(spring ? '2027-03-15T04:00:00.000Z' : '2027-11-08T05:00:00.000Z');
      const days = { membershipDay: d, courtDay: d };
      const period = courtPeriod(days, y, m);
      const prev = spring ? { from: '2027-02-15', to: '2027-03-14' } : { from: '2027-10-08', to: '2027-11-07' };
      expect(period).toEqual(prev);
      const g = (startsAt: string): VenueGame => ({ startsAt, booked: true, canceled: false, costCents: 4800 });
      const games = spring
        ? [
            g('2027-02-15T01:00:00.000Z'), // Sun Feb 14, 8:00 PM EST: last month's period (UTC says Feb 15)
            g('2027-02-16T01:00:00.000Z'), // Mon Feb 15, 8:00 PM EST: in
            g('2027-03-14T14:00:00.000Z'), // Sun Mar 14, 10:00 AM EDT: in
            g('2027-03-15T00:00:00.000Z'), // Sun Mar 14, 8:00 PM EDT: in (UTC says Mar 15)
            g('2027-03-15T23:00:00.000Z'), // Mon Mar 15, 7:00 PM EDT: next period
          ]
        : [
            g('2027-10-08T00:00:00.000Z'), // Thu Oct 7, 8:00 PM EDT: last month's period (UTC says Oct 8)
            g('2027-10-09T00:00:00.000Z'), // Fri Oct 8, 8:00 PM EDT: in
            g('2027-11-07T06:30:00.000Z'), // Sun Nov 7, 1:30 AM EST (the second 1:30): in
            g('2027-11-08T01:00:00.000Z'), // Sun Nov 7, 8:00 PM EST: in (UTC says Nov 8)
            g('2027-11-09T01:00:00.000Z'), // Mon Nov 8, 8:00 PM EST: next period
          ];
      expect(periodGames(games, period, TZ).length).toBe(3);
      const input = { days, membershipCents: 3000, games, tz: TZ, onAtMs: at(spring ? '2027-02-01T05:00:00Z' : '2027-10-01T04:00:00Z'), paid: new Set<string>() };
      const cards = (nowMs: number) => dueAlerts({ ...input, nowMs }).filter((c) => c.date === changeDay);
      // 11:59 PM the night before (already the change day in UTC): no card yet.
      expect(cards(startOfDayMs(changeDay, TZ) - MIN)).toEqual([]);
      // 12:00 AM Eastern: one combined card, 3 games x $48 = $144 plus membership $30.
      const c = cards(startOfDayMs(changeDay, TZ));
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({ kinds: ['court', 'membership'], cents: 3 * 4800 + 3000, line: '3 games x $48 = $144, plus membership $30' });
      // Still there all day, through the skipped or repeated hour and after midnight.
      for (const h of [1, 2, 3, 12, 24, 30]) expect(cards(startOfDayMs(changeDay, TZ) + h * HOUR), `+${h}h`).toHaveLength(1);
    });

    it('a Sunday game on the change day: cancel-by is 12 real hours before the start, so its wall clock moves by the hour; the last call keeps its wall clock', () => {
      // Only a game that starts on the change day before about 2:00 PM has its 12 hours cross the change. Tue and Thu games never do.
      const start = season === SPRING ? '2027-03-14T14:00:00.000Z' : '2027-11-07T15:00:00.000Z'; // 10:00 AM Eastern either way
      expect(eastern(Date.parse(start))).toBe(season === SPRING ? 'Sun, Mar 14, 10:00 AM' : 'Sun, Nov 7, 10:00 AM');
      expect(plain(cancelByShort(start, TZ))).toBe(season === SPRING ? 'Sat 9:00 PM' : 'Sat 11:00 PM');
      // The night-before last call is counted on the wall clock: 25 hours before reads 9:00 AM the day before, either way.
      expect(eastern(nightLastCallMs(start, TZ))).toBe(season === SPRING ? 'Sat, Mar 13, 9:00 AM' : 'Sat, Nov 6, 9:00 AM');
    });
  });
}
