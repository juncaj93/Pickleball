import { describe, expect, it } from 'vitest';
import { playerDay, wantInSubline, wantInTitle } from '../shared/time';
import { playerPhone, setupGroup } from './harness';

const TZ = 'America/Detroit';
const at = (iso: string) => Date.parse(iso);
// Games are 8:00 PM Eastern.
const game = (date: string, offset = '-05:00') => `${date}T20:00:00${offset}`;

describe('how a player sentence names an upcoming game (Eastern days, Monday to Sunday weeks)', () => {
  it('today is tonight, the next day is tomorrow', () => {
    expect(playerDay(game('2026-11-03'), TZ, at('2026-11-03T00:00:00-05:00')).word).toBe('tonight'); // 12:00 AM game day
    expect(playerDay(game('2026-11-03'), TZ, at('2026-11-03T19:59:00-05:00')).word).toBe('tonight');
    expect(playerDay(game('2026-11-03'), TZ, at('2026-11-02T23:59:00-05:00')).word).toBe('tomorrow'); // 11:59 PM the night before
    expect(playerDay(game('2026-11-03'), TZ, at('2026-11-02T00:00:00-05:00')).word).toBe('tomorrow');
  });
  it('later in the same Monday to Sunday week: this Thursday / this Tuesday', () => {
    // Mon Nov 2: Tue is tomorrow, Thu Nov 5 is this Thursday, Tue Nov 3...
    expect(playerDay(game('2026-11-05'), TZ, at('2026-11-02T09:00:00-05:00')).word).toBe('this Thursday');
    // Sun Nov 1 belongs to the week that began Mon Oct 26: Tue Nov 3 is next week.
    expect(playerDay(game('2026-11-03'), TZ, at('2026-11-01T12:00:00-05:00')).word).toBe('next Tuesday');
    // Mon Oct 26: Tue Oct 27 is tomorrow, Thu Oct 29 is this Thursday.
    expect(playerDay(game('2026-10-29', '-04:00'), TZ, at('2026-10-26T12:00:00-04:00')).word).toBe('this Thursday');
    // Tue Nov 3 looking at Thu Nov 5, and at Sun Nov 8 (still this week).
    expect(playerDay(game('2026-11-05'), TZ, at('2026-11-03T09:00:00-05:00')).word).toBe('this Thursday');
    expect(playerDay(game('2026-11-08'), TZ, at('2026-11-04T09:00:00-05:00')).word).toBe('this Sunday');
  });
  it('the week boundary: Sunday night to Monday morning flips next to this', () => {
    // Thu Nov 12 is "next Thursday" all of Sun Nov 8, and "this Thursday" from Mon Nov 9 12:00 AM.
    expect(playerDay(game('2026-11-12'), TZ, at('2026-11-08T23:59:00-05:00')).word).toBe('next Thursday');
    expect(playerDay(game('2026-11-12'), TZ, at('2026-11-09T00:00:00-05:00')).word).toBe('this Thursday');
    expect(playerDay(game('2026-11-10'), TZ, at('2026-11-08T23:59:00-05:00')).word).toBe('next Tuesday');
    expect(playerDay(game('2026-11-10'), TZ, at('2026-11-09T00:00:00-05:00')).word).toBe('tomorrow');
  });
  it('after next week: the date', () => {
    expect(playerDay(game('2026-11-19'), TZ, at('2026-11-02T09:00:00-05:00'))).toMatchObject({ word: 'Thu, Nov 19', isDate: true });
    expect(playerDay(game('2026-11-12'), TZ, at('2026-11-01T23:59:00-05:00')).word).toBe('Thu, Nov 12'); // two weeks away
  });
  it('is not fooled by the Sun Nov 1 clock change', () => {
    // Sat Oct 31 8:00 PM EDT to Sun Nov 1 game 8:00 PM EST: still "tomorrow", by calendar days.
    expect(playerDay(game('2026-11-01'), TZ, at('2026-10-31T20:30:00-04:00')).word).toBe('tomorrow');
    expect(playerDay(game('2026-11-01'), TZ, at('2026-11-01T00:30:00-04:00')).word).toBe('tonight');
    // Sat Oct 31 looking at Tue Nov 3: next Tuesday (Sat is in the week of Mon Oct 26).
    expect(playerDay(game('2026-11-03'), TZ, at('2026-10-31T12:00:00-04:00')).word).toBe('next Tuesday');
  });
});

describe('the "Want in?" titles', () => {
  const now = at('2026-11-02T09:00:00-05:00'); // Mon Nov 2
  it('normal titles', () => {
    expect(wantInTitle(game('2026-11-02'), TZ, now, false)).toBe('Want in tonight?');
    expect(wantInTitle(game('2026-11-03'), TZ, now, false)).toBe('Want in tomorrow?');
    expect(wantInTitle(game('2026-11-05'), TZ, now, false)).toBe('Want in Thursday?');
    expect(wantInTitle(game('2026-11-10'), TZ, now, false)).toBe('Want in next Tuesday?');
    expect(wantInTitle(game('2026-11-12'), TZ, now, false)).toBe('Want in next Thursday?');
    expect(wantInTitle(game('2026-11-19'), TZ, now, false)).toBe('Want in on Thu, Nov 19?');
    expect(wantInTitle(game('2026-11-19'), TZ, at('2026-11-02T09:00:00-05:00'), false)).toBe('Want in on Thu, Nov 19?'); // 17 days out: the date
  });
  it('waitlist titles', () => {
    expect(wantInTitle(game('2026-11-02'), TZ, now, true)).toBe("Want in on tonight's waitlist?");
    expect(wantInTitle(game('2026-11-03'), TZ, now, true)).toBe("Want in on tomorrow's waitlist?");
    expect(wantInTitle(game('2026-11-05'), TZ, now, true)).toBe("Want in on Thursday's waitlist?");
    expect(wantInTitle(game('2026-11-10'), TZ, now, true)).toBe("Want in on next Tuesday's waitlist?");
    expect(wantInTitle(game('2026-11-12'), TZ, now, true)).toBe("Want in on next Thursday's waitlist?");
    expect(wantInTitle(game('2026-11-19'), TZ, now, true)).toBe('Want in on the Nov 19 waitlist?');
    expect(wantInTitle(game('2026-11-19'), TZ, at('2026-11-02T09:00:00-05:00'), true)).toBe('Want in on the Nov 19 waitlist?');
  });
});

describe('"next" only when the game is 7 or more days away (Eastern calendar days)', () => {
  const t = (date: string, now: string, tz = TZ) => wantInTitle(game(date, date < '2026-11-01' ? '-04:00' : '-05:00'), tz, at(now), false);
  it('Friday (Oct 30): Tue Nov 3 is 4 days, Thu Nov 5 is 6 days, Tue Nov 10 is 11 days', () => {
    const now = '2026-10-30T09:00:00-04:00';
    expect(t('2026-11-03', now)).toBe('Want in Tuesday?');
    expect(t('2026-11-05', now)).toBe('Want in Thursday?'); // 6 days: no "next"
    expect(t('2026-11-10', now)).toBe('Want in next Tuesday?');
    expect(t('2026-11-12', now)).toBe('Want in next Thursday?'); // 13 days
    expect(t('2026-11-13', now)).toBe('Want in on Fri, Nov 13?'); // not a game day, shows the date rules still hold (14 days)
  });
  it('Monday (Nov 2): tomorrow, then Thursday (3 days), then next Tuesday (8 days)', () => {
    const now = '2026-11-02T09:00:00-05:00';
    expect(t('2026-11-03', now)).toBe('Want in tomorrow?');
    expect(t('2026-11-05', now)).toBe('Want in Thursday?');
    expect(t('2026-11-10', now)).toBe('Want in next Tuesday?');
  });
  it('Tuesday (Nov 3): tonight, Thursday (2 days), next Tuesday (exactly 7 days)', () => {
    const now = '2026-11-03T09:00:00-05:00';
    expect(t('2026-11-03', now)).toBe('Want in tonight?');
    expect(t('2026-11-05', now)).toBe('Want in Thursday?');
    expect(t('2026-11-10', now)).toBe('Want in next Tuesday?');
  });
  it('Thursday (Nov 5): tonight, Tuesday (5 days), next Thursday (exactly 7 days)', () => {
    const now = '2026-11-05T09:00:00-05:00';
    expect(t('2026-11-05', now)).toBe('Want in tonight?');
    expect(t('2026-11-10', now)).toBe('Want in Tuesday?');
    expect(t('2026-11-12', now)).toBe('Want in next Thursday?');
  });
  it('Sunday Nov 1, the day the clocks go back: Tuesday (2 days), Thursday (4 days), next Tuesday (9 days), at every hour of that day', () => {
    for (const now of ['2026-11-01T00:30:00-04:00', '2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00', '2026-11-01T09:00:00-05:00', '2026-11-01T23:30:00-05:00']) {
      expect(t('2026-11-03', now)).toBe('Want in Tuesday?');
      expect(t('2026-11-05', now)).toBe('Want in Thursday?');
      expect(t('2026-11-10', now)).toBe('Want in next Tuesday?');
    }
  });
  it('the Eastern date decides, not UTC: Sat 11:30 PM Eastern (already Sunday in UTC) still counts Sat as today', () => {
    expect(t('2026-11-03', '2026-10-31T23:30:00-04:00')).toBe('Want in Tuesday?'); // Tue Nov 3 is 3 days from Sat Oct 31
    expect(t('2026-11-05', '2026-10-30T23:30:00-04:00')).toBe('Want in Thursday?'); // Fri night: still 6 days
  });
  it('the waitlist title follows the same rule', () => {
    expect(wantInTitle(game('2026-11-05'), TZ, at('2026-10-30T09:00:00-04:00'), true)).toBe("Want in on Thursday's waitlist?");
    expect(wantInTitle(game('2026-11-12'), TZ, at('2026-10-30T09:00:00-04:00'), true)).toBe("Want in on next Thursday's waitlist?");
  });
});

describe('the second line, by how many are in', () => {
  it('0 in nothing; 1, 2, 3 in: needs more to play; 4 up to the max: you would make it one more', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => wantInSubline(n, 10))).toEqual([
      '',
      'Needs 3 more to play',
      'Needs 2 more to play',
      'Needs 1 more to play',
      "4 are in. You'd make it 5.",
      "5 are in. You'd make it 6.",
      "6 are in. You'd make it 7.",
      "9 are in. You'd make it 10.",
    ]);
  });
  it('at the max: the waitlist, whatever the max is', () => {
    expect(wantInSubline(10, 10)).toBe("10 are in. You'd be on the waitlist.");
    expect(wantInSubline(6, 6)).toBe("6 are in. You'd be on the waitlist.");
    expect(wantInSubline(4, 4)).toBe("4 are in. You'd be on the waitlist.");
    expect(wantInSubline(3, 4)).toBe('Needs 1 more to play');
  });
});

describe('what the server sends the popup', () => {
  async function popup(inNames: string[], standby = false) {
    const ctx = await setupGroup();
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = dash.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-03'); // Election Day
    const tester = dash.players.find((p: any) => p.name === 'Frankie');
    await ctx.organizer.call('PUT', `/api/admin/players/${tester.id}`, { name: 'Frankie', isRegular: true, isActive: true, canReceiveSubstituteInvites: true, usualDays: [2] });
    for (const n of inNames) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    if (standby) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court`, { action: 'waitlist' });
    ctx.app.now = Date.parse('2026-11-02T09:00:00-05:00');
    const g = (await (await playerPhone(ctx, 'Frankie')).call('GET', '/api/group')).data;
    return g.suggestion;
  }
  it('carries the count and the holiday, so each count reads right', async () => {
    for (const [names, n] of [[[], 0], [['Alex'], 1], [['Alex', 'Blair'], 2], [['Alex', 'Blair', 'Casey'], 3], [['Alex', 'Blair', 'Casey', 'Devon'], 4]] as const) {
      const sg = await popup([...names]);
      expect(sg, `${n} in`).toMatchObject({ confirmedCount: n, holiday: 'Election Day', courtState: null });
    }
  });
  it('a game on the court waitlist is marked standby', async () => {
    expect(await popup(['Alex'], true)).toMatchObject({ courtState: 'waitlist' });
  });
});
