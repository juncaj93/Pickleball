import { describe, expect, it } from 'vitest';
import {
  canceledMessage,
  checkInMessage,
  downToFiveMessage,
  movedMessage,
  needPlayersMessage,
  nowSixMessage,
  paymentMessage,
  pollMessage,
  promotedMessage,
  remindAllMessage,
  sessionLink,
  shareMessage,
  smsHref,
} from '../shared/messages';
import { playersIn } from '../src/pages/admin/todo';
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

describe('the Text menu wording', () => {
  const link = 'pickleball.juncaj.net';
  it('Share, Need players, Down to 5, Check-in, Now 6 and Spot opened read exactly as written', () => {
    expect(shareMessage(s, TZ, link)).toBe('Pickleball Tue Nov 3, 8:00 PM. In or out here: pickleball.juncaj.net');
    expect(needPlayersMessage(s, TZ, 2, link)).toBe('Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? pickleball.juncaj.net');
    expect(downToFiveMessage(s, TZ, link)).toBe('Down to 5 for pickleball Tue Nov 3. Need 1 more or 1 out to make 4 or 6. pickleball.juncaj.net');
    expect(nowSixMessage(s, TZ, link)).toBe("Good news, we have 6 for pickleball Tue Nov 3, 8:00 PM. You're both in. Can't make it? Update here: pickleball.juncaj.net");
    expect(promotedMessage(s, TZ, link)).toBe("A spot opened and you're in for pickleball Tue Nov 3, 8:00 PM. pickleball.juncaj.net");
    expect(checkInMessage(s, TZ, Date.parse('2026-11-02T17:00:00Z'), link)).toBe('Pickleball tomorrow (Tue), 8:00 PM. Still in? Update here: pickleball.juncaj.net');
  });
  it('Check-in says tonight, today, tomorrow (Weekday) or the date, whichever fits the time left', () => {
    const at = (iso: string) => checkInMessage(s, TZ, Date.parse(iso), link);
    expect(at('2026-11-03T15:00:00Z')).toBe('Pickleball tonight, 8:00 PM. Still in? Update here: pickleball.juncaj.net'); // Tue 10:00 AM Eastern
    expect(at('2026-11-02T05:00:00Z')).toBe('Pickleball tomorrow (Tue), 8:00 PM. Still in? Update here: pickleball.juncaj.net'); // Mon 12:00 AM
    expect(at('2026-10-30T16:00:00Z')).toBe('Pickleball Tue Nov 3, 8:00 PM. Still in? Update here: pickleball.juncaj.net');
    const morning = { startsAt: '2026-11-07T15:00:00.000Z', endsAt: '2026-11-07T17:00:00.000Z' };
    expect(checkInMessage(morning, TZ, Date.parse('2026-11-07T11:00:00Z'), link)).toBe('Pickleball today, 10:00 AM. Still in? Update here: pickleball.juncaj.net');
  });
  it('payment reminders: one game names it, several games give the total', () => {
    expect(paymentMessage('Ryan', 1400, [s], TZ, link)).toBe('Hey Ryan, you owe $14 for pickleball Tue Nov 3. Pay here: pickleball.juncaj.net');
    expect(paymentMessage('Ryan', 2800, [s, s], TZ, link)).toBe('Hey Ryan, you owe $28 for pickleball. Pay here: pickleball.juncaj.net');
    expect(remindAllMessage(link)).toBe("Hey, looks like you haven't paid for pickleball yet. Pay here: pickleball.juncaj.net");
  });
  it('nothing ever says "sent" or "text me ASAP"', () => {
    const all = [
      shareMessage(s, TZ, link), needPlayersMessage(s, TZ, 1, link), downToFiveMessage(s, TZ, link), nowSixMessage(s, TZ, link), promotedMessage(s, TZ, link),
      checkInMessage(s, TZ, 0, link), canceledMessage(s, TZ, link), movedMessage(s, s.startsAt, TZ, link), paymentMessage('A', 1400, [s], TZ, link), remindAllMessage(link),
      pollMessage(s, TZ, 1400, LINK),
    ];
    for (const m of all) {
      expect(m).not.toMatch(/\bsent\b|ASAP|text me/i);
      expect(m).toContain('pickleball.juncaj.net');
    }
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

describe('who each choice goes to', () => {
  it('"Pick the chat" means no numbers and no missing names', async () => {
    const { recipients, audienceLine } = await import('../src/pages/admin/todo');
    const d = { me: null, players: [{ id: 'a', name: 'A', phone: null, isActive: true }] } as any;
    expect(recipients(d, { roster: [] } as any, 'chat')).toEqual({ phones: [], missing: [], count: 0 });
    expect(audienceLine('chat', 0)).toBe('Pick the chat');
    expect(audienceLine('in', 5)).toBe('5 who are in');
  });
});
