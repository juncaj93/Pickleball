import { describe, expect, it } from 'vitest';
import {
  canceledMessage,
  dayBeforeMessage,
  dayBeforePlayersMessage,
  lastCallMessage,
  movedMessage,
  pollMessage,
  sessionLink,
  shareGameMessage,
  smsHref,
  spotOpenMessage,
} from '../shared/messages';
import { playersIn, shortOfPlayers } from '../src/pages/admin/todo';
import { playerPhone, setupGroup } from './harness';

const TZ = 'America/Detroit';
const s = { startsAt: '2026-11-04T01:00:00.000Z', endsAt: '2026-11-04T03:00:00.000Z' }; // Tue Nov 3, 8 PM
const LINK = 'https://pickleball.juncaj.net/?s=abc';

describe('links straight to a session', () => {
  it('adds ?s=<id> to the plain address or the private link', () => {
    expect(sessionLink('https://pickleball.juncaj.net', 'abc')).toBe('https://pickleball.juncaj.net/?s=abc');
    expect(sessionLink('https://pickleball.juncaj.net/', 'abc')).toBe('https://pickleball.juncaj.net/?s=abc');
    expect(sessionLink('https://club.example/g/KEY123', 'abc')).toBe('https://club.example/g/KEY123?s=abc');
  });
});

describe('Share the game', () => {
  it('says the right thing for each court state', () => {
    expect(shareGameMessage(s, TZ, 'booked', LINK)).toBe(`We booked a court for Tue, Nov 3 at 8:00 PM. Tap here to reserve your spot: ${LINK}`);
    expect(shareGameMessage(s, TZ, 'open', LINK)).toBe(`Thinking of playing Tue, Nov 3 at 8:00 PM. Tap here to say if you're in: ${LINK}`);
    expect(shareGameMessage(s, TZ, 'waitlist', LINK)).toBe(`I'm on the court waitlist for Tue, Nov 3 at 8:00 PM. Tap here to join the standby list: ${LINK}`);
  });
});

describe('day-before and last-call texts', () => {
  it('the players who are in hear the date, time, place and a link to back out', () => {
    expect(dayBeforePlayersMessage(s, TZ, 'Northville Pickleball Club', LINK)).toBe(
      `Pickleball tomorrow, Tue, Nov 3, 8:00 to 10:00 PM at Northville Pickleball Club. You're in! If anything comes up and you need to back out, tap here so we can find a replacement: ${LINK}`,
    );
  });
  it('last call points to the session link', () => {
    expect(lastCallMessage(s, TZ, 4, LINK)).toBe(`Last call for pickleball tonight, 8:00 to 10:00 PM. We have 4 in. If you can't make it, tell me now or tap here: ${LINK}`);
  });
  it('the main button is "need more players" only when short of 4 or 6', () => {
    const at = (n: number) => ({ confirmedCount: n }) as any;
    expect([3, 4, 5, 6].map((n) => shortOfPlayers(at(n)))).toEqual([true, false, true, false]);
  });
  it('nothing ever says "sent"', () => {
    const all = [
      shareGameMessage(s, TZ, 'booked', LINK),
      shareGameMessage(s, TZ, 'open', LINK),
      shareGameMessage(s, TZ, 'waitlist', LINK),
      dayBeforePlayersMessage(s, TZ, 'Northville Pickleball Club', LINK),
      dayBeforeMessage(s, TZ, 3, LINK),
      lastCallMessage(s, TZ, 4, LINK),
      pollMessage(s, TZ, 'Northville Pickleball Club', 1400),
      spotOpenMessage(s, TZ, 'https://pickleball.juncaj.net'),
      canceledMessage(s, TZ),
      movedMessage(s, TZ),
    ];
    for (const m of all) expect(m).not.toMatch(/\bsent\b/i);
  });
});

describe('texting several people at once', () => {
  it('addresses everyone in one message on iPhone and Android', () => {
    expect(smsHref(['(313) 555-0101', '313-555-0102'], 'Hi', true)).toBe('sms://open?addresses=+13135550101,+13135550102&body=Hi');
    expect(smsHref(['(313) 555-0101', '313-555-0102'], 'Hi', false)).toBe('sms:+13135550101,+13135550102?body=Hi');
    expect(smsHref(['(313) 555-0101'], 'Hi', true)).toBe('sms:+13135550101&body=Hi');
    expect(smsHref([], 'Hi', true)).toBe('sms:&body=Hi');
  });

  it('uses the numbers saved and names the ones missing', async () => {
    const ctx = await setupGroup();
    const d0 = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const sid = d0.sessions[0].id;
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sid}/join`, {});
    let x = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((v: any) => v.id === sid);
    expect(playersIn(x).phones).toHaveLength(4);
    expect(playersIn(x).missing).toEqual([]);
    // Remove two numbers.
    for (const n of ['Blair', 'Devon']) {
      const p = d0.players.find((q: any) => q.name === n);
      await ctx.organizer.call('PUT', `/api/admin/players/${p.id}`, { name: n, phone: null, isRegular: p.isRegular, usualDays: p.usualDays, isActive: true });
    }
    x = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((v: any) => v.id === sid);
    expect(playersIn(x).phones).toHaveLength(2);
    expect(playersIn(x).missing.sort()).toEqual(['Blair', 'Devon']);
  });

  it('marks a session as moved once rescheduled', async () => {
    const ctx = await setupGroup();
    const d0 = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const sx = d0.sessions[1];
    expect(sx.moved).toBe(false);
    await ctx.organizer.call('PUT', `/api/admin/sessions/${sx.id}/time`, { startsAt: new Date(Date.parse(sx.startsAt) - 30 * 60_000).toISOString(), endsAt: sx.endsAt });
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((v: any) => v.id === sx.id).moved).toBe(true);
  });
});
