import { describe, expect, it } from 'vitest';
import {
  canceledMessage,
  checkInMessage,
  finalMessage,
  movedMessage,
  needPlayersMessage,
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
/** A week before the sample game, so texts name the date. */
const LONG_BEFORE = Date.parse('2026-10-26T16:00:00Z');

describe('links straight to a session', () => {
  it('adds ?s=<id> to the plain address or the private link', () => {
    expect(sessionLink('https://pickleball.juncaj.net', 'abc')).toBe('https://pickleball.juncaj.net/?s=abc');
    expect(sessionLink('https://pickleball.juncaj.net/', 'abc')).toBe('https://pickleball.juncaj.net/?s=abc');
    expect(sessionLink('https://club.example/g/KEY123', 'abc')).toBe('https://club.example/g/KEY123?s=abc');
  });
});

describe('the Text menu wording', () => {
  const link = 'pickleball.juncaj.net';
  it('Share, Need players, Check-in, Spot opened, Canceled and Final price read exactly as written', () => {
    expect(shareMessage(s, TZ, LONG_BEFORE, link)).toBe('Pickleball Tue Nov 3, 8:00 PM. In or out here: pickleball.juncaj.net');
    expect(needPlayersMessage(s, TZ, LONG_BEFORE, 2, link)).toBe('Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? pickleball.juncaj.net');
    expect(promotedMessage(s, TZ, LONG_BEFORE, link)).toBe("A spot opened and you're in for pickleball Tue Nov 3, 8:00 PM. pickleball.juncaj.net");
    expect(checkInMessage(s, TZ, Date.parse('2026-11-02T17:00:00Z'), link)).toBe('Pickleball tomorrow, 8:00 PM. Can\'t make it? Update here: pickleball.juncaj.net');
    expect(canceledMessage(s, TZ, LONG_BEFORE, link)).toBe("Pickleball Tue Nov 3 is canceled. If you paid, it's now your credit. You can request a refund on the site. pickleball.juncaj.net");
    expect(canceledMessage(s, TZ, LONG_BEFORE, link, 'Court flooded')).toBe("Pickleball Tue Nov 3 is canceled. Court flooded. If you paid, it's now your credit. You can request a refund on the site. pickleball.juncaj.net");
  });
  it('Final price: played count and price each, the credit line only when something comes back', () => {
    const thu = { startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2026-10-30T02:00:00.000Z' }; // Thu Oct 29, 8 PM EDT
    expect(finalMessage(thu, TZ, 6, 900, 1400, link)).toBe('Pickleball Thu, Oct 29 is final: 6 played, $9 each. If you paid $14, the extra $5 is now credit on your account. pickleball.juncaj.net');
    expect(finalMessage(thu, TZ, 5, 1100, 1400, link)).toBe('Pickleball Thu, Oct 29 is final: 5 played, $11 each. If you paid $14, the extra $3 is now credit on your account. pickleball.juncaj.net');
    expect(finalMessage(thu, TZ, 10, 500, 1400, link)).toBe('Pickleball Thu, Oct 29 is final: 10 played, $5 each. If you paid $14, the extra $9 is now credit on your account. pickleball.juncaj.net');
    expect(finalMessage(thu, TZ, 4, 1400, 1400, link)).toBe('Pickleball Thu, Oct 29 is final: 4 played, $14 each. pickleball.juncaj.net');
    expect(finalMessage(s, TZ, 3, 1400, 1400, link)).toBe('Pickleball Tue, Nov 3 is final: 3 played, $14 each. pickleball.juncaj.net');
  });
  it('Check-in says tonight, today, tomorrow or the date, whichever fits the time left', () => {
    const at = (iso: string) => checkInMessage(s, TZ, Date.parse(iso), link);
    expect(at('2026-11-03T15:00:00Z')).toBe('Pickleball tonight, 8:00 PM. Can\'t make it? Update here: pickleball.juncaj.net'); // Tue 10:00 AM Eastern
    expect(at('2026-11-02T05:00:00Z')).toBe('Pickleball tomorrow, 8:00 PM. Can\'t make it? Update here: pickleball.juncaj.net'); // Mon 12:00 AM
    expect(at('2026-10-30T16:00:00Z')).toBe('Pickleball Tue Nov 3, 8:00 PM. Can\'t make it? Update here: pickleball.juncaj.net');
    const morning = { startsAt: '2026-11-07T15:00:00.000Z', endsAt: '2026-11-07T17:00:00.000Z' };
    expect(checkInMessage(morning, TZ, Date.parse('2026-11-07T11:00:00Z'), link)).toBe('Pickleball today, 10:00 AM. Can\'t make it? Update here: pickleball.juncaj.net');
  });
  it('payment reminders: one game names it, several games give the total', () => {
    expect(paymentMessage('Ryan', 1400, [s], TZ, link)).toBe('Hey Ryan, you owe $14 for pickleball Tue Nov 3. Pay here: pickleball.juncaj.net');
    expect(paymentMessage('Ryan', 2800, [s, s], TZ, link)).toBe('Hey Ryan, you owe $28 for pickleball. Pay here: pickleball.juncaj.net');
    expect(remindAllMessage(link)).toBe("Hey, looks like you haven't paid for pickleball yet. Pay here: pickleball.juncaj.net");
  });
  it('nothing ever says "sent" or "text me ASAP"', () => {
    const all = [
      shareMessage(s, TZ, LONG_BEFORE, link), needPlayersMessage(s, TZ, LONG_BEFORE, 1, link), promotedMessage(s, TZ, LONG_BEFORE, link),
      checkInMessage(s, TZ, 0, link), canceledMessage(s, TZ, LONG_BEFORE, link), movedMessage(s, s.startsAt, TZ, LONG_BEFORE, link), paymentMessage('A', 1400, [s], TZ, link), remindAllMessage(link),
      finalMessage(s, TZ, 6, 900, 1400, link), finalMessage(s, TZ, 4, 1400, 1400, link), pollMessage(s, TZ, 1400, LINK),
    ];
    for (const m of all) {
      expect(m).not.toMatch(/\bsent\b|ASAP/i);
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
