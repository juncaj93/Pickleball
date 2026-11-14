// Zip 43: the date and amount logic of the "Venue charge alert" (shared/venueAlert.ts), with a fake clock. Eastern time, not UTC.
import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../shared/time';
import {
  addDays,
  chargeDatesOf,
  courtLine,
  courtPeriod,
  dayIn,
  dayLabel,
  daysInMonth,
  DEFAULT_VENUE_DAYS,
  dueAlerts,
  localYmd,
  markedPaidText,
  normalizeVenueDays,
  periodGames,
  scanMonths,
  venueDaysOf,
  type VenueGame,
} from '../shared/venueAlert';

const TZ = 'America/Detroit';
/** A wall-clock Eastern moment, as an instant. */
const et = (y: number, m: number, d: number, h = 12, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);
const game = (y: number, m: number, d: number, h = 20, over: Partial<VenueGame> = {}): VenueGame => ({ startsAt: new Date(et(y, m, d, h)).toISOString(), booked: true, canceled: false, costCents: 4800, ...over });
const localDay = (g: VenueGame) => localYmd(Date.parse(g.startsAt), TZ);
const LAST = DEFAULT_VENUE_DAYS; // membership 26th, courts Last day

describe('the days: defaults, limits, short months', () => {
  it('defaults are the 26th and Last day; junk falls back to them', () => {
    expect(DEFAULT_VENUE_DAYS).toEqual({ membershipDay: 26, courtDay: 0 });
    expect(venueDaysOf(undefined)).toEqual(DEFAULT_VENUE_DAYS);
    expect(venueDaysOf('not json')).toEqual(DEFAULT_VENUE_DAYS);
    expect(normalizeVenueDays({ membershipDay: 32, courtDay: 29 })).toEqual(DEFAULT_VENUE_DAYS);
    expect(normalizeVenueDays({ membershipDay: 0, courtDay: -1 })).toEqual(DEFAULT_VENUE_DAYS);
    expect(normalizeVenueDays({ membershipDay: 'x', courtDay: 1.5 })).toEqual(DEFAULT_VENUE_DAYS);
    expect(normalizeVenueDays({ membershipDay: 31, courtDay: 28 })).toEqual({ membershipDay: 31, courtDay: 28 });
    expect(normalizeVenueDays({ membershipDay: 1, courtDay: 0 })).toEqual({ membershipDay: 1, courtDay: 0 });
    expect(venueDaysOf(JSON.stringify({ venueDays: { membershipDay: 5, courtDay: 15 } }))).toEqual({ membershipDay: 5, courtDay: 15 });
  });
  it('Last day is the 30th in a 30 day month, the 31st in a 31 day month, the 28th or 29th in February (2028 is a leap year)', () => {
    expect(chargeDatesOf(LAST, 2026, 11).court).toBe('2026-11-30');
    expect(chargeDatesOf(LAST, 2026, 12).court).toBe('2026-12-31');
    expect(chargeDatesOf(LAST, 2027, 2).court).toBe('2027-02-28');
    expect(chargeDatesOf(LAST, 2028, 2).court).toBe('2028-02-29');
    expect(chargeDatesOf(LAST, 2100, 2).court).toBe('2100-02-28');
    expect(daysInMonth(2028, 2)).toBe(29);
  });
  it('membership day 31 in a 30 day month (and in February) means the last day of that month', () => {
    const d31 = { membershipDay: 31, courtDay: 0 };
    expect(chargeDatesOf(d31, 2026, 11).membership).toBe('2026-11-30');
    expect(chargeDatesOf(d31, 2026, 12).membership).toBe('2026-12-31');
    expect(chargeDatesOf(d31, 2027, 2).membership).toBe('2027-02-28');
    expect(chargeDatesOf(d31, 2028, 2).membership).toBe('2028-02-29');
    expect(dayIn(30, 2027, 2)).toBe(28);
    expect(dayIn(26, 2027, 2)).toBe(26);
  });
  it('labels read like the dropdowns', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 26, 31].map(dayLabel)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '26th', '31st']);
    expect(dayLabel(0)).toBe('Last day');
  });
});

describe('the billing period', () => {
  it('Last day: the whole calendar month (30, 31 days, February, leap February)', () => {
    expect(courtPeriod(LAST, 2026, 11)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(courtPeriod(LAST, 2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(courtPeriod(LAST, 2027, 2)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(courtPeriod(LAST, 2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(courtPeriod(LAST, 2027, 1)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });
  it('a mid-month charge day: the day after last month\'s through this one, across a year end and a short month', () => {
    const d15 = { membershipDay: 26, courtDay: 15 };
    expect(courtPeriod(d15, 2026, 11)).toEqual({ from: '2026-10-16', to: '2026-11-15' });
    expect(courtPeriod(d15, 2027, 1)).toEqual({ from: '2026-12-16', to: '2027-01-15' });
    const d28 = { membershipDay: 26, courtDay: 28 };
    expect(courtPeriod(d28, 2027, 3)).toEqual({ from: '2027-03-01', to: '2027-03-28' });
    expect(courtPeriod(d28, 2028, 3)).toEqual({ from: '2028-02-29', to: '2028-03-28' }); // leap year: Feb 29 is the day after Feb 28
    expect(courtPeriod({ membershipDay: 26, courtDay: 1 }, 2026, 11)).toEqual({ from: '2026-10-02', to: '2026-11-01' });
  });
  it('addDays crosses months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});

describe('which games count', () => {
  const period = { from: '2026-11-01', to: '2026-11-30' };
  it('only Booked, not canceled games in the period count', () => {
    const games = [
      game(2026, 11, 3),
      game(2026, 11, 5, 20, { booked: false }), // Not booked or Waitlist
      game(2026, 11, 10, 20, { canceled: true }), // a canceled game, or a canceled court
      game(2026, 11, 12),
      game(2026, 10, 29), // last month
      game(2026, 12, 1), // next month
    ];
    expect(periodGames(games, period, TZ)).toHaveLength(2);
  });
  it('a game on the charge day itself counts; one on the day after does not', () => {
    expect(periodGames([game(2026, 11, 30)], period, TZ)).toHaveLength(1);
    expect(periodGames([game(2026, 12, 1, 0)], period, TZ)).toHaveLength(0);
  });
  it('midnight edges are Eastern, not UTC: 11:30 PM on the 30th (04:30 UTC the 1st) is November; 12:30 AM on the 1st (05:30 UTC) is December', () => {
    const late = { startsAt: '2026-12-01T04:30:00.000Z', booked: true, canceled: false, costCents: 4800 };
    expect(periodGames([late], period, TZ)).toHaveLength(1);
    const early = { ...late, startsAt: '2026-12-01T05:30:00.000Z' };
    expect(periodGames([early], period, TZ)).toHaveLength(0);
    // and the other end: 11:30 PM Oct 31 (03:30 UTC Nov 1) is October, not November
    const oct = { ...late, startsAt: '2026-11-01T03:30:00.000Z' };
    expect(periodGames([oct], period, TZ)).toHaveLength(0);
    const nov1 = { ...late, startsAt: '2026-11-01T05:30:00.000Z' }; // 1:30 AM EDT on Nov 1 (the clock change is at 2 AM)
    expect(periodGames([nov1], period, TZ)).toHaveLength(1);
  });
  it('a mid-month period starts the day after last month\'s charge day', () => {
    const p = courtPeriod({ membershipDay: 26, courtDay: 15 }, 2026, 11); // Oct 16 to Nov 15
    const games = [game(2026, 10, 15), game(2026, 10, 16), game(2026, 11, 15), game(2026, 11, 16)];
    // Oct 16 and Nov 15 are inside (8 PM Eastern is the next day in UTC, which must not matter); Oct 15 and Nov 16 are outside.
    expect(periodGames(games, p, TZ).map((g) => localDay(g))).toEqual(['2026-10-16', '2026-11-15']);
  });
});

describe('the words on the card', () => {
  it('same cost: "4 games x $48 = $192"; one game says "1 game"', () => {
    expect(courtLine([4800, 4800, 4800, 4800])).toBe('4 games x $48 = $192');
    expect(courtLine([4800])).toBe('1 game x $48 = $48');
  });
  it('mixed costs: "N games = $X" (no "x $48")', () => {
    expect(courtLine([4800, 3600, 4800])).toBe('3 games = $132');
    expect(courtLine([4850, 4850])).toBe('2 games x $48.50 = $97');
    expect(courtLine([4850, 4800])).toBe('2 games = $96.50');
  });
  it('the History line', () => {
    expect(markedPaidText(19200)).toBe('Venue charge marked paid: $192');
    expect(markedPaidText(22200)).toBe('Venue charge marked paid: $222');
  });
});

const four = (y: number, m: number): VenueGame[] => [3, 5, 10, 12].map((d) => game(y, m, d));
const base = { days: LAST, membershipCents: 3000, tz: TZ, paid: new Set<string>() };

describe('when an alert shows (fake clock)', () => {
  const onAt = et(2026, 11, 14, 9); // switch turned on Sat Nov 14, 9 AM
  const games = four(2026, 11);

  it('before the charge day: nothing. The membership 26th shows from 12:00 AM Eastern, courts on the last day', () => {
    expect(dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 25, 23, 59) })).toEqual([]);
    const m = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 26, 0, 0) });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kinds: ['membership'], cents: 3000, title: 'Membership should have been charged: $30', line: 'Monthly membership, Northville Pickleball', date: '2026-11-26' });
    const c = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 0, 0) });
    expect(c.map((a) => a.kinds)).toEqual([['membership'], ['court']]);
    expect(c[1]).toMatchObject({ cents: 19200, title: 'Northville Pickleball should have charged you $192', line: '4 games x $48 = $192' });
  });
  it('one minute before midnight Eastern on the charge day is still "yesterday" (not UTC midnight, which is 7 or 8 PM Eastern)', () => {
    // 11:59 PM Nov 29 Eastern = 04:59 UTC Nov 30: UTC says it is already the 30th. Eastern says not yet.
    expect(dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 29, 23, 59) }).map((a) => a.kinds)).toEqual([['membership']]);
    expect(dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 0, 0) }).map((a) => a.kinds)).toEqual([['membership'], ['court']]);
    // 8:00 PM Nov 30 Eastern = 01:00 UTC Dec 1: UTC says December; Eastern is still the 30th (nothing new yet for December).
    const evening = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 20, 0) });
    expect(evening.map((a) => a.date)).toEqual(['2026-11-26', '2026-11-30']);
  });
  it('charge day today vs yesterday vs a missed day: the card stays until Mark paid', () => {
    const today = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 8) });
    const yesterdayLater = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 12, 1, 8) });
    const missed = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 12, 20, 8) });
    expect(today.map((a) => a.date)).toEqual(['2026-11-26', '2026-11-30']);
    expect(yesterdayLater.map((a) => a.date)).toEqual(['2026-11-26', '2026-11-30']);
    expect(missed.slice(0, 2).map((a) => a.date)).toEqual(['2026-11-26', '2026-11-30']);
  });
  it('marked paid months are gone, the others stay', () => {
    const left = dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 8), paid: new Set(['court:2026-11']) });
    expect(left.map((a) => a.kinds)).toEqual([['membership']]);
    expect(dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 8), paid: new Set(['court:2026-11', 'membership:2026-11']) })).toEqual([]);
  });
  it('both on the same day: ONE combined card, $222 and "4 games x $48 = $192, plus membership $30"', () => {
    const days = { membershipDay: 28, courtDay: 28 };
    const g = four(2026, 11);
    const a = dueAlerts({ ...base, days, games: g, onAtMs: onAt, nowMs: et(2026, 11, 28, 6) });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ keys: ['court:2026-11', 'membership:2026-11'], kinds: ['court', 'membership'], cents: 22200, title: 'Northville Pickleball should have charged you $222', line: '4 games x $48 = $192, plus membership $30' });
  });
  it('both on the same day by "last day" rounding (membership 31, courts Last day in November)', () => {
    const days = { membershipDay: 31, courtDay: 0 };
    const a = dueAlerts({ ...base, days, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 0, 1) });
    expect(a).toHaveLength(1);
    expect(a[0].cents).toBe(22200);
  });
  it('combined card with one of the two already marked paid: the other shows alone', () => {
    const days = { membershipDay: 28, courtDay: 28 };
    const a = dueAlerts({ ...base, days, games, onAtMs: onAt, nowMs: et(2026, 11, 28, 6), paid: new Set(['membership:2026-11']) });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kinds: ['court'], cents: 19200 });
  });
  it('a month with zero booked games has no court alert (the membership one is still there)', () => {
    const none = [game(2026, 11, 3, 20, { booked: false }), game(2026, 11, 5, 20, { canceled: true })];
    const a = dueAlerts({ ...base, games: none, onAtMs: onAt, nowMs: et(2026, 11, 30, 8) });
    expect(a.map((x) => x.kinds)).toEqual([['membership']]);
    expect(dueAlerts({ ...base, days: { membershipDay: 5, courtDay: 0 }, games: none, onAtMs: et(2026, 11, 1), nowMs: et(2026, 11, 30, 8) }).map((x) => x.kinds)).toEqual([['membership']]);
  });
});

describe('no backfill', () => {
  const games = [...four(2026, 9), ...four(2026, 10), ...four(2026, 11)];
  it('turned on Nov 14: October and September never appear, even a month later', () => {
    const a = dueAlerts({ ...base, games, onAtMs: et(2026, 11, 14, 9), nowMs: et(2026, 12, 20, 8) });
    expect(a.map((x) => x.date)).toEqual(['2026-11-26', '2026-11-30']);
  });
  it('a charge day that began before the switch went on does not show: turned on at 3 PM on the 30th, the 30th card is not made; December\'s is', () => {
    const onAt = et(2026, 11, 30, 15);
    expect(dueAlerts({ ...base, games, onAtMs: onAt, nowMs: et(2026, 11, 30, 16) })).toEqual([]);
    const dec = [...games, ...four(2026, 12)];
    expect(dueAlerts({ ...base, games: dec, onAtMs: onAt, nowMs: et(2026, 12, 26, 1) }).map((x) => x.date)).toEqual(['2026-12-26']);
    expect(dueAlerts({ ...base, games: dec, onAtMs: onAt, nowMs: et(2026, 12, 31, 1) }).map((x) => x.date)).toEqual(['2026-12-26', '2026-12-31']);
  });
  it('turned on exactly at 12:00 AM on the charge day counts (the card starts at midnight); one second later does not', () => {
    expect(dueAlerts({ ...base, games, onAtMs: et(2026, 11, 30, 0, 0), nowMs: et(2026, 11, 30, 9) }).map((x) => x.kinds)).toEqual([['court']]);
    expect(dueAlerts({ ...base, games, onAtMs: et(2026, 11, 30, 0, 0) + 1000, nowMs: et(2026, 11, 30, 9) })).toEqual([]);
  });
  it('different months stack separately until each is marked paid', () => {
    const all = [...four(2026, 11), ...four(2026, 12)];
    const a = dueAlerts({ ...base, games: all, onAtMs: et(2026, 11, 14, 9), nowMs: et(2027, 1, 2, 8) });
    // Jan 2 2027: November and December are both unpaid and still shown; January's days (26th, Jan 31) have not come yet.
    expect(a.map((x) => x.keys.join('+'))).toEqual(['membership:2026-11', 'court:2026-11', 'membership:2026-12', 'court:2026-12']);
    expect(a.map((x) => x.cents)).toEqual([3000, 19200, 3000, 19200]);
  });
  it('the switch "turned on" in the future makes nothing', () => {
    expect(scanMonths(et(2027, 1, 5), et(2026, 11, 30), TZ)).toEqual([]);
    expect(dueAlerts({ ...base, games, onAtMs: et(2027, 1, 5), nowMs: et(2026, 11, 30, 8) })).toEqual([]);
  });
});

describe('the amounts', () => {
  it('each game at its own cost; differing costs say "N games = $X"; the total is the sum', () => {
    const g = [game(2026, 11, 3), game(2026, 11, 5, 20, { costCents: 3600 }), game(2026, 11, 10), game(2026, 11, 12, 20, { costCents: 6000 })];
    const a = dueAlerts({ ...base, games: g, onAtMs: et(2026, 11, 14, 9), nowMs: et(2026, 11, 30, 8) });
    const court = a.find((x) => x.kinds[0] === 'court')!;
    expect(court.cents).toBe(4800 + 3600 + 4800 + 6000);
    expect(court.line).toBe('4 games = $192');
    expect(court.title).toBe('Northville Pickleball should have charged you $192');
  });
  it('a different membership amount shows in the title and the combined line', () => {
    const a = dueAlerts({ ...base, membershipCents: 4500, days: { membershipDay: 30, courtDay: 0 }, games: four(2026, 11), onAtMs: et(2026, 11, 14, 9), nowMs: et(2026, 11, 30, 8) });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ cents: 19200 + 4500, line: '4 games x $48 = $192, plus membership $45' });
  });
});
