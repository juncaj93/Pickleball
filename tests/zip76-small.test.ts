import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import { dropMoneyLine } from '../shared/credit';
import { hostDropText } from '../shared/guestSpot';
import { lateDropDialogText } from '../shared/lateFees';
import { formatPrice, venmoPayUrl, venmoRefundUrl } from '../shared/money';
import { dbLimitMessage } from '../shared/zip10';
import { PIN, setupGroup } from './harness';

// Zip 76 (🎾76.money fixes): the small rules and words from the 🎾75 audit.

describe('Venmo: the page-word guard on the Pay link and the cash-out link', () => {
  it('a saved /u/ or bare handle pays that person; /code, /pay and an id link never pay a page word', () => {
    expect(venmoPayUrl('https://venmo.com/u/Alex-J', 1400, 'note')).toMatchObject({ prefilled: true, appUrl: expect.stringContaining('recipients=Alex-J&') });
    expect(venmoPayUrl('https://venmo.com/Alex-J', 1400, 'note').prefilled).toBe(true);
    for (const link of ['https://venmo.com/code?user_id=1234567', 'https://www.venmo.com/pay', 'https://venmo.com/account', 'https://venmo.com/U/']) {
      const r = venmoPayUrl(link, 1400, 'note');
      expect(r.prefilled, link).toBe(false);
      expect(r.url, link).toBe(link);
      expect(String(r.appUrl), link).not.toMatch(/recipients=(code|pay|account|u)\b/);
    }
  });
  it('the cash-out link: an id handle is treated like no handle (pick them in Venmo)', () => {
    expect(venmoRefundUrl('id:1234567', 700, 'Pickleball credit refund')).toMatchObject({ addressed: false });
    expect(venmoRefundUrl('id:1234567', 700, 'x').url).not.toContain('recipients=');
    expect(venmoRefundUrl('Rowan-K', 700, 'x')).toMatchObject({ addressed: true, url: expect.stringContaining('recipients=Rowan-K&') });
    expect(venmoRefundUrl(null, 700, 'x').addressed).toBe(false);
  });
});

describe('Drop out words (MUST 2)', () => {
  it('late, already paid: the money stays on the game, never "you still owe"', () => {
    expect(lateDropDialogText('7:00 AM', true, '$14', null, true)).toBe("It's past the 7:00 AM cancel-by. Your $14 stays on this game unless someone takes your spot.");
    expect(lateDropDialogText('7:00 AM', true, '$14', null, false)).toBe("It's past the 7:00 AM cancel-by. If no one takes your spot, you still owe $14.");
    expect(hostDropText('Sam', { cancelBy: '7:00 AM', spots: 2, owesCents: 2800, paid: true }, formatPrice)).toBe(
      "It's past the 7:00 AM cancel-by. Your guest Sam drops out too. Your $28 stays on this game unless someone takes your 2 spots.",
    );
    expect(hostDropText('Sam', { cancelBy: '7:00 AM', spots: 1, owesCents: 1400, paid: true }, formatPrice)).toContain('Your $14 stays on this game unless someone takes your spot.');
  });
  it('a plain drop says what happens to money already paid, in the toast words', () => {
    expect(dropMoneyLine(0, 1400)).toBe(' $14 comes back as credit.');
    expect(dropMoneyLine(1300, 0)).toBe(' $13 comes back as credit.');
    expect(dropMoneyLine(0, 0)).toBe('');
    expect(dropMoneyLine(0, 0, 1400, 'Alex')).toBe(' Your $14 comes back as credit once Alex confirms your payment.');
    expect(hostDropText('Sam', null, formatPrice, dropMoneyLine(0, 2800))).toBe('Your guest Sam drops out too. Both spots open up for someone else. $28 comes back as credit.');
  });
});

describe('Words', () => {
  it('Activity never says "the The Cold Open"; "the Winter Classic" keeps its "the"', () => {
    const line = (tournament: string, action = 'tournament_created') => activityText({ action, details: { tournament, visibility: 'all' }, actor: 'organizer', createdAt: '2026-11-20T15:00:00.000Z' } as never, 'America/Detroit', 'Alex');
    expect(line('The Cold Open')).toContain('opened sign-up for The Cold Open');
    expect(line('The Cold Open')).not.toMatch(/the The/);
    expect(line('Winter Classic')).toContain('opened sign-up for the Winter Classic');
  });
  it('the 12 limit names the organizer', () => {
    expect(dbLimitMessage('Alex')).toBe('12 is the most one game can hold right now. Ask Alex.');
    expect(dbLimitMessage(null)).toBe('12 is the most one game can hold right now.');
  });
});

describe('An extra game far ahead on a Tue counts as that day game', () => {
  it('no second game when the schedule reaches the day', async () => {
    const ctx = await setupGroup();
    const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    // Tue Jan 26, 2027, 5:00 PM Eastern: far beyond the horizon.
    const add = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt: '2027-01-26T22:00:00.000Z', endsAt: '2027-01-27T00:00:00.000Z' });
    expect(add.status, add.text).toBe(200);
    ctx.app.now = Date.parse('2027-01-20T15:00:00.000Z');
    // Weeks later the organizer signs in again; the dashboard plans the games up to the horizon.
    expect((await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect((await dash()).sessions.length).toBeGreaterThan(0);
    const rows = ctx.app.db.raw.prepare("SELECT starts_at, is_extra FROM sessions WHERE starts_at >= '2027-01-26T05:00:00.000Z' AND starts_at < '2027-01-27T05:00:00.000Z'").all() as { starts_at: string; is_extra: number }[];
    expect(rows).toEqual([{ starts_at: '2027-01-26T22:00:00.000Z', is_extra: 1 }]);
    // The Thursday after still gets its usual game.
    const thu = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE starts_at >= '2027-01-28T05:00:00.000Z' AND starts_at < '2027-01-29T05:00:00.000Z'").get() as { n: number };
    expect(thu.n).toBe(1);
  });
});
