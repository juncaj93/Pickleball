// Zip 40 "Text the players wording". The organizer's back-out texts said "today's game" for any game. They now name the day:
// today (Eastern) keeps the old words, tomorrow says "tomorrow's game", any other day says the weekday ("Tuesday's game").
// A fake clock throughout: "now" is Fri Nov 13, 2026, 12:00 PM Eastern.
import { describe, expect, it } from 'vitest';
import {
  backOutDay,
  backOutGame,
  canceledFeeKeptMessage,
  canceledTodayMessage,
  courtCanceledMessage,
} from '../shared/messages';
import { canceledFeeKeptTextR2, courtStillBookedTextR2 } from '../shared/textsR2';
import { backOutTexts } from '../src/pages/admin/textMenu';

const TZ = 'America/Detroit';
const NOW = Date.parse('2026-11-13T17:00:00Z'); // Fri Nov 13, 12:00 PM EST
const TODAY = { startsAt: '2026-11-14T01:00:00.000Z' }; // Fri Nov 13, 8:00 PM
const TOMORROW = { startsAt: '2026-11-15T01:00:00.000Z' }; // Sat Nov 14, 8:00 PM
const FOUR_OUT = { startsAt: '2026-11-18T01:00:00.000Z' }; // Tue Nov 17, 8:00 PM
const LINK = 'pickleball.juncaj.net';

const cases: [string, { startsAt: string }, string][] = [
  ['today', TODAY, "today's game"],
  ['tomorrow', TOMORROW, "tomorrow's game"],
  ['4 days out', FOUR_OUT, "Tuesday's game"],
];

describe('the back-out day words', () => {
  for (const [name, g, word] of cases) {
    it(`${name}: ${word}`, () => {
      expect(backOutGame(g.startsAt, TZ, NOW)).toBe(word);
    });
  }
  it('uses the Eastern day, never UTC: a 12:30 AM game on Tuesday', () => {
    const night = '2026-11-17T05:30:00.000Z'; // Tue Nov 17, 12:30 AM EST
    expect(backOutGame(night, TZ, Date.parse('2026-11-17T04:00:00Z'))).toBe("tomorrow's game"); // Mon 11:00 PM EST (already Tuesday in UTC)
    expect(backOutGame(night, TZ, Date.parse('2026-11-17T06:00:00Z'))).toBe("today's game"); // Tue 1:00 AM EST
    expect(backOutGame(night, TZ, Date.parse('2026-11-16T03:00:00Z'))).toBe("Tuesday's game"); // Sun 10:00 PM EST
    const late = '2026-11-17T07:00:00.000Z'; // Tue Nov 17, 2:00 AM EST
    expect(backOutGame(late, TZ, Date.parse('2026-11-17T04:59:00Z'))).toBe("tomorrow's game");
    expect(backOutGame(late, TZ, Date.parse('2026-11-17T05:01:00Z'))).toBe("today's game");
  });
  it('the clock change on Sun Nov 1 cannot move the day', () => {
    const mon = '2026-11-03T00:00:00.000Z'; // Mon Nov 2, 7:00 PM EST
    expect(backOutGame(mon, TZ, Date.parse('2026-11-02T04:59:00Z'))).toBe("tomorrow's game");
    expect(backOutGame(mon, TZ, Date.parse('2026-11-02T05:01:00Z'))).toBe("today's game");
  });
  it('with no game given the old words stay', () => {
    expect(backOutGame(undefined, undefined, undefined)).toBe("today's game");
    expect(backOutDay(undefined, undefined, undefined)).toBe('today');
  });
});

describe('Text the players: both tabs, both wordings', () => {
  for (const r2 of [false, true]) {
    for (const [name, g, word] of cases) {
      it(`${r2 ? 'new' : 'old'} wording, game ${name}`, () => {
        const [a, b] = backOutTexts(r2, { startsAt: g.startsAt, tz: TZ, nowMs: NOW });
        expect(a.label).toBe('Court canceled');
        expect(b.label).toBe('Court still booked (backup)');
        for (const t of [a, b]) {
          expect(t.body).toContain(`Hey guys, sorry, I have to back out of ${word}.`);
          if (word !== "today's game") expect(t.body).not.toMatch(/today|tonight|this evening/i);
          expect(t.body).not.toMatch(/[–—]/);
        }
        expect(a.body).toContain('https://app.courtreserve.com/Online/publicbookings/13765?tab=reserve&step=initial');
        expect(b.body).toContain('810-207-5698');
      });
    }
  }
  it('a game today is word for word what it was', () => {
    const now = backOutTexts(false, { startsAt: TODAY.startsAt, tz: TZ, nowMs: NOW });
    const before = backOutTexts(false);
    expect(now.map((t) => t.body)).toEqual(before.map((t) => t.body));
    expect(backOutTexts(true, { startsAt: TODAY.startsAt, tz: TZ, nowMs: NOW }).map((t) => t.body)).toEqual(backOutTexts(true).map((t) => t.body));
    expect(courtCanceledMessage()).toBe(courtCanceledMessage(undefined, undefined, "today's game"));
    expect(courtStillBookedTextR2()).toBe(courtStillBookedTextR2(undefined, "today's game"));
  });
  it('only the day word changes: the rest of each text is identical', () => {
    const t = backOutTexts(false, { startsAt: FOUR_OUT.startsAt, tz: TZ, nowMs: NOW });
    const old = backOutTexts(false);
    expect(t[0].body.replace("Tuesday's game", "today's game")).toBe(old[0].body);
    expect(t[1].body.replace("Tuesday's game", "today's game")).toBe(old[1].body);
  });
});

describe('the cancel texts that said "today"', () => {
  it('fee kept, old wording: names the day', () => {
    expect(canceledFeeKeptMessage(1400, LINK)).toContain("Heads up: today's game is canceled");
    expect(canceledFeeKeptMessage(1400, LINK, backOutGame(TOMORROW.startsAt, TZ, NOW))).toContain("Heads up: tomorrow's game is canceled");
    expect(canceledFeeKeptMessage(1400, LINK, backOutGame(FOUR_OUT.startsAt, TZ, NOW))).toContain("Heads up: Tuesday's game is canceled");
  });
  it('fee kept, new wording: already right (today, tomorrow, the date)', () => {
    expect(canceledFeeKeptTextR2(TODAY as any, TZ, NOW, 1400, LINK)).toContain("today's game is canceled");
    expect(canceledFeeKeptTextR2(TOMORROW as any, TZ, NOW, 1400, LINK)).toContain("tomorrow's game is canceled");
    expect(canceledFeeKeptTextR2(FOUR_OUT as any, TZ, NOW, 1400, LINK)).toContain('the Tue Nov 17 game is canceled');
  });
  it('waived, old wording: Pickleball today / tomorrow / Tuesday is canceled', () => {
    expect(canceledTodayMessage(LINK)).toContain('Pickleball today is canceled.');
    expect(canceledTodayMessage(LINK, null, backOutDay(TOMORROW.startsAt, TZ, NOW))).toContain('Pickleball tomorrow is canceled.');
    expect(canceledTodayMessage(LINK, 'Rain', backOutDay(FOUR_OUT.startsAt, TZ, NOW))).toMatch(/^Pickleball Tuesday is canceled/);
  });
});
