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
    expect(wantInTitle(game('2026-11-05'), TZ, now, false)).toBe('Want in this Thursday?');
    expect(wantInTitle(game('2026-11-10'), TZ, now, false)).toBe('Want in next Tuesday?');
    expect(wantInTitle(game('2026-11-12'), TZ, now, false)).toBe('Want in next Thursday?');
    expect(wantInTitle(game('2026-11-19'), TZ, now, false)).toBe('Want in on Thu, Nov 19?');
    expect(wantInTitle(game('2026-11-12'), TZ, at('2026-11-01T09:00:00-05:00'), false)).toBe('Want in on Thu, Nov 12?'); // two weeks out
  });
  it('waitlist titles', () => {
    expect(wantInTitle(game('2026-11-02'), TZ, now, true)).toBe("Want in on tonight's waitlist?");
    expect(wantInTitle(game('2026-11-03'), TZ, now, true)).toBe("Want in on tomorrow's waitlist?");
    expect(wantInTitle(game('2026-11-05'), TZ, now, true)).toBe("Want in on this Thursday's waitlist?");
    expect(wantInTitle(game('2026-11-10'), TZ, now, true)).toBe("Want in on next Tuesday's waitlist?");
    expect(wantInTitle(game('2026-11-12'), TZ, now, true)).toBe("Want in on next Thursday's waitlist?");
    expect(wantInTitle(game('2026-11-19'), TZ, now, true)).toBe('Want in on the Nov 19 waitlist?');
    expect(wantInTitle(game('2026-11-12'), TZ, at('2026-11-01T09:00:00-05:00'), true)).toBe('Want in on the Nov 12 waitlist?');
  });
});

describe('the second line, by how many are in', () => {
  it('0 in nothing; 1, 2, 3 in: spots left; 4, 5, 6 in: where they would be', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(wantInSubline)).toEqual([
      '',
      '3 spots left',
      '2 spots left',
      '1 spot left',
      "4 are in. You'd be on the waitlist until a 6th joins.",
      "5 are in. You'd make it 6 and everyone plays.",
      "6 are in. You'd be on the waitlist.",
    ]);
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
