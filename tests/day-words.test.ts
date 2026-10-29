import { describe, expect, it } from 'vitest';
import {
  canceledMessage,
  checkInMessage,
  dayWord,
  finalMessage,
  movedMessage,
  needPlayersMessage,
  paymentMessage,
  promotedMessage,
  shareMessage,
} from '../shared/messages';

// "tomorrow" and "tonight" in the texts, counted in calendar days in Eastern
// time, never in blocks of 24 hours.

const TZ = 'America/Detroit';
const L = 'pickleball.juncaj.net';
const game = (startsAt: string) => ({ startsAt, endsAt: new Date(Date.parse(startsAt) + 2 * 3600_000).toISOString() });
const at = (iso: string) => Date.parse(iso);

// Tue Nov 3, 8:00 PM EST (clocks went back Sun Nov 1).
const TUE = game('2026-11-04T01:00:00.000Z');
// Thu Oct 29, 8:00 PM EDT.
const THU = game('2026-10-30T00:00:00.000Z');

describe('the day word follows calendar days in Eastern time', () => {
  it('says tonight on game day, from 12:00 AM to the start', () => {
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-03T05:00:00Z'))).toBe('tonight'); // Tue 12:00 AM EST
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-03T14:00:00Z'))).toBe('tonight'); // Tue 9:00 AM
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-04T00:59:00Z'))).toBe('tonight'); // Tue 7:59 PM
  });
  it('says tomorrow the whole day before, including 11:59 PM and 12:00 AM', () => {
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-02T05:00:00Z'))).toBe('tomorrow'); // Mon 12:00 AM EST
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-03T04:59:00Z'))).toBe('tomorrow'); // Mon 11:59 PM EST
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-03T05:00:00Z'))).toBe('tonight'); // Tue 12:00 AM EST: the day changed
  });
  it('keeps the date two or more days out', () => {
    expect(dayWord(TUE.startsAt, TZ, at('2026-11-02T04:59:00Z'))).toBe('Tue Nov 3'); // Sun 11:59 PM EST
    expect(dayWord(TUE.startsAt, TZ, at('2026-10-20T16:00:00Z'))).toBe('Tue Nov 3');
  });
  it('is not fooled by the Sun Nov 1 clock change (a 25-hour day)', () => {
    // A game on Mon Nov 2. Sun Nov 1 is 25 hours long: 12:00 AM EDT is 04:00Z, and 11:59 PM EST is 05:00Z Mon.
    const mon = game('2026-11-03T01:00:00.000Z'); // Mon Nov 2, 8:00 PM EST
    expect(dayWord(mon.startsAt, TZ, at('2026-11-01T04:00:00Z'))).toBe('tomorrow'); // Sun Nov 1, 12:00 AM EDT
    expect(dayWord(mon.startsAt, TZ, at('2026-11-02T04:59:00Z'))).toBe('tomorrow'); // Sun 11:59 PM EST
    expect(dayWord(mon.startsAt, TZ, at('2026-11-02T05:00:00Z'))).toBe('tonight'); // Mon 12:00 AM EST
    // 24 hours before Mon 8 PM is Sun 8 PM... still "tomorrow", but 24 hours + a bit before a Sat game across the change:
    const sun = game('2026-11-02T01:00:00.000Z'); // Sun Nov 1, 8:00 PM EST (after the change)
    expect(dayWord(sun.startsAt, TZ, at('2026-10-31T23:30:00Z'))).toBe('tomorrow'); // Sat Oct 31 7:30 PM EDT
    expect(dayWord(sun.startsAt, TZ, at('2026-11-01T03:30:00Z'))).toBe('tomorrow'); // Sat Oct 31 11:30 PM EDT
    expect(dayWord(sun.startsAt, TZ, at('2026-11-01T04:30:00Z'))).toBe('tonight'); // Sun 12:30 AM EDT
  });
  it('says today for a daytime game and tonight from 5:00 PM on', () => {
    const morning = game('2026-11-07T15:00:00.000Z'); // Sat 10:00 AM
    const evening = game('2026-11-07T22:00:00.000Z'); // Sat 5:00 PM
    expect(dayWord(morning.startsAt, TZ, at('2026-11-07T11:00:00Z'))).toBe('today');
    expect(dayWord(evening.startsAt, TZ, at('2026-11-07T11:00:00Z'))).toBe('tonight');
  });
});

describe('every text that names a game date uses the day word', () => {
  const tomorrowNow = at('2026-11-02T17:00:00Z'); // Mon 12:00 PM, game is Tue
  const tonightNow = at('2026-11-03T15:00:00Z'); // Tue 10:00 AM
  const farNow = at('2026-10-26T16:00:00Z');

  it('Share the game', () => {
    expect(shareMessage(TUE, TZ, tomorrowNow, L)).toBe(`Pickleball tomorrow, 8:00 PM. In or out here: ${L}`);
    expect(shareMessage(TUE, TZ, tonightNow, L)).toBe(`Pickleball tonight, 8:00 PM. In or out here: ${L}`);
    expect(shareMessage(TUE, TZ, farNow, L)).toBe(`Pickleball Tue Nov 3, 8:00 PM. In or out here: ${L}`);
  });
  it('Need players', () => {
    expect(needPlayersMessage(TUE, TZ, tomorrowNow, 2, L)).toBe(`Need 2 more for pickleball tomorrow, 8:00 PM. In? ${L}`);
    expect(needPlayersMessage(TUE, TZ, tonightNow, 1, L)).toBe(`Need 1 more for pickleball tonight, 8:00 PM. In? ${L}`);
    expect(needPlayersMessage(TUE, TZ, farNow, 3, L)).toBe(`Need 3 more for pickleball Tue Nov 3, 8:00 PM. In? ${L}`);
  });
  it('Check-in', () => {
    expect(checkInMessage(TUE, TZ, tomorrowNow, L)).toBe(`Pickleball tomorrow, 8:00 PM. Can\'t make it? Update here: ${L}`);
    expect(checkInMessage(TUE, TZ, tonightNow, L)).toBe(`Pickleball tonight, 8:00 PM. Can\'t make it? Update here: ${L}`);
    expect(checkInMessage(TUE, TZ, farNow, L)).toBe(`Pickleball Tue Nov 3, 8:00 PM. Can\'t make it? Update here: ${L}`);
  });
  it('Spot opened', () => {
    expect(promotedMessage(TUE, TZ, tomorrowNow, L)).toBe(`A spot opened and you're in for pickleball tomorrow, 8:00 PM. ${L}`);
    expect(promotedMessage(TUE, TZ, tonightNow, L)).toBe(`A spot opened and you're in for pickleball tonight, 8:00 PM. ${L}`);
    expect(promotedMessage(TUE, TZ, farNow, L)).toBe(`A spot opened and you're in for pickleball Tue Nov 3, 8:00 PM. ${L}`);
  });
  it('Canceled, with the credit wording', () => {
    const credit = "If you paid, it's now your credit. You can request a refund on the site.";
    expect(canceledMessage(TUE, TZ, tonightNow, L)).toBe(`Pickleball tonight is canceled. ${credit} ${L}`);
    expect(canceledMessage(TUE, TZ, tomorrowNow, L)).toBe(`Pickleball tomorrow is canceled. ${credit} ${L}`);
    expect(canceledMessage(TUE, TZ, farNow, L)).toBe(`Pickleball Tue Nov 3 is canceled. ${credit} ${L}`);
  });
  it('Moved names the NEW day', () => {
    const was = TUE.startsAt; // Tue Nov 3
    const newTomorrow = game('2026-11-04T01:00:00.000Z'); // Tue Nov 3 8 PM, from a Monday
    expect(movedMessage(newTomorrow, '2026-11-02T01:00:00.000Z', TZ, tomorrowNow, L)).toBe(`Pickleball Sun Nov 1 is moved to tomorrow, 8:00 PM. ${L}`);
    expect(movedMessage(game('2026-11-06T01:00:00.000Z'), was, TZ, farNow, L)).toBe(`Pickleball Tue Nov 3 is moved to Thu Nov 5, 8:00 PM. ${L}`);
    expect(movedMessage(TUE, THU.startsAt, TZ, tonightNow, L)).toBe(`Pickleball Thu Oct 29 is moved to tonight, 8:00 PM. ${L}`);
  });
  it('payment reminders and the Final price note still name the (past) game date', () => {
    expect(paymentMessage('Ryan', 1400, [THU], TZ, L)).toBe(`Hey Ryan, you owe $14 for pickleball Thu Oct 29. Pay here: ${L}`);
    expect(finalMessage(THU, TZ, 6, 900, 1400, L)).toBe(`Pickleball Thu, Oct 29 is final: 6 played, $9 each. If you paid $14, the extra $5 is now credit on your account. ${L}`);
  });
  it('never shows UTC or a 24-hour clock', () => {
    for (const now of [tomorrowNow, tonightNow, farNow]) {
      const all = [shareMessage(TUE, TZ, now, L), needPlayersMessage(TUE, TZ, now, 2, L), checkInMessage(TUE, TZ, now, L), canceledMessage(TUE, TZ, now, L), promotedMessage(TUE, TZ, now, L), finalMessage(TUE, TZ, 5, 1100, 1400, L)];
      for (const m of all) expect(m).not.toMatch(/UTC|GMT|\b2[0-3]:\d\d\b|T\d\d:\d\d/);
    }
  });
});
