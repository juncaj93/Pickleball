// Zip 47 audit probes (read-only audit): every date claim of the Venue charge alert's shared logic (shared/venueAlert.ts), fake clock, Eastern.
import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../../../shared/time';
import { addDays, chargeDatesOf, courtPeriod, dueAlerts, localYmd, periodGames, scanMonths, startOfDayMs, type VenueGame } from '../../../shared/venueAlert';

const TZ = 'America/Detroit';
const et = (y: number, m: number, d: number, h = 12, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);
const g = (iso: string, over: Partial<VenueGame> = {}): VenueGame => ({ startsAt: iso, booked: true, canceled: false, costCents: 4800, ...over });
const gEt = (y: number, m: number, d: number, h = 20, min = 0, over: Partial<VenueGame> = {}) => g(new Date(et(y, m, d, h, min)).toISOString(), over);
const keys = (a: { keys: string[] }[]) => a.map((x) => x.keys.join('+'));
const base = { membershipCents: 3000, tz: TZ, paid: new Set<string>() as ReadonlySet<string> };

describe('P-V01 month ends: membership 31st in every 30-day month, courts Last day', () => {
  it('Apr, Jun, Sep, Nov 2027 -> 30th; Jan, Mar, Dec -> 31st', () => {
    const d = { membershipDay: 31, courtDay: 0 };
    for (const m of [4, 6, 9, 11]) expect(chargeDatesOf(d, 2027, m)).toEqual({ membership: `2027-${String(m).padStart(2, '0')}-30`, court: `2027-${String(m).padStart(2, '0')}-30` });
    for (const m of [1, 3, 12]) expect(chargeDatesOf(d, 2027, m).membership).toBe(`2027-${String(m).padStart(2, '0')}-31`);
  });
  it('membership 30 and 29 in Feb 2027 (normal) -> 28th; Feb 2028 (leap) -> 29th', () => {
    for (const day of [29, 30, 31]) {
      expect(chargeDatesOf({ membershipDay: day, courtDay: 0 }, 2027, 2).membership).toBe('2027-02-28');
      expect(chargeDatesOf({ membershipDay: day, courtDay: 0 }, 2028, 2).membership).toBe('2028-02-29');
    }
  });
  it('Nov 30 2026, membership 31 + Last day: one combined card at 12:00 AM Eastern, nothing at 11:59 PM Nov 29', () => {
    const days = { membershipDay: 31, courtDay: 0 };
    const games = [gEt(2026, 11, 3)];
    const onAtMs = et(2026, 11, 14, 9);
    expect(dueAlerts({ ...base, days, games, onAtMs, nowMs: et(2026, 11, 29, 23, 59) })).toEqual([]);
    const a = dueAlerts({ ...base, days, games, onAtMs, nowMs: et(2026, 11, 30, 0, 0) });
    expect(keys(a)).toEqual(['court:2026-11+membership:2026-11']);
    expect(a[0].cents).toBe(7800);
  });
});

describe('P-V02 February, normal and leap', () => {
  it('court Last day: Feb 2027 period Feb 1-28, March from Mar 1; Feb 2028 period Feb 1-29', () => {
    const L = { membershipDay: 26, courtDay: 0 };
    expect(courtPeriod(L, 2027, 2)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(courtPeriod(L, 2027, 3)).toEqual({ from: '2027-03-01', to: '2027-03-31' });
    expect(courtPeriod(L, 2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(courtPeriod(L, 2028, 3)).toEqual({ from: '2028-03-01', to: '2028-03-31' });
  });
  it('a Feb 29 2028 game is billed on Feb 29 (Last day), not March; a game on Mar 1 2028 is March', () => {
    const L = { membershipDay: 26, courtDay: 0 };
    const games = [gEt(2028, 2, 29, 20), gEt(2028, 3, 1, 9)];
    const a = dueAlerts({ ...base, membershipCents: 0, days: L, games, onAtMs: et(2028, 2, 1, 9), nowMs: et(2028, 2, 29, 0, 0) });
    expect(keys(a)).toEqual(['court:2028-02']);
    expect(a[0].line).toBe('1 game x $48 = $48');
    // Feb 28 11:59 PM: not yet.
    expect(dueAlerts({ ...base, membershipCents: 0, days: L, games, onAtMs: et(2028, 2, 1, 9), nowMs: et(2028, 2, 28, 23, 59) })).toEqual([]);
  });
  it('Feb 2027 Last day: card at 12:00 AM Feb 28, not at 11:59 PM Feb 27', () => {
    const L = { membershipDay: 26, courtDay: 0 };
    const games = [gEt(2027, 2, 10)];
    expect(dueAlerts({ ...base, membershipCents: 0, days: L, games, onAtMs: et(2027, 2, 1, 9), nowMs: et(2027, 2, 27, 23, 59) })).toEqual([]);
    expect(keys(dueAlerts({ ...base, membershipCents: 0, days: L, games, onAtMs: et(2027, 2, 1, 9), nowMs: et(2027, 2, 28, 0, 0) }))).toEqual(['court:2027-02']);
  });
  it('court 28th: Mar 2028 period Feb 29 - Mar 28 (leap day billed once, in March); Mar 2027 Mar 1 - Mar 28', () => {
    const d28 = { membershipDay: 26, courtDay: 28 };
    expect(courtPeriod(d28, 2028, 2)).toEqual({ from: '2028-01-29', to: '2028-02-28' });
    expect(courtPeriod(d28, 2028, 3)).toEqual({ from: '2028-02-29', to: '2028-03-28' });
    expect(courtPeriod(d28, 2027, 3)).toEqual({ from: '2027-03-01', to: '2027-03-28' });
  });
});

describe('P-V03 December to January', () => {
  it('Dec 31 2026 card, then Jan 2027 cards; a game at 11:30 PM Dec 31 Eastern (04:30 UTC Jan 1) is December', () => {
    const L = { membershipDay: 26, courtDay: 0 };
    const games = [g('2027-01-01T04:30:00.000Z'), g('2027-01-01T05:30:00.000Z')]; // 11:30 PM Dec 31 EST; 12:30 AM Jan 1 EST
    const onAtMs = et(2026, 12, 1, 9);
    const dec = dueAlerts({ ...base, days: L, games, onAtMs, nowMs: et(2026, 12, 31, 0, 0) });
    expect(keys(dec)).toEqual(['membership:2026-12', 'court:2026-12']);
    expect(dec[1].line).toBe('1 game x $48 = $48');
    const jan = dueAlerts({ ...base, days: L, games, onAtMs, nowMs: et(2027, 1, 31, 0, 0), paid: new Set(['court:2026-12', 'membership:2026-12']) });
    expect(keys(jan)).toEqual(['membership:2027-01', 'court:2027-01']);
    expect(jan[1].line).toBe('1 game x $48 = $48');
    expect(scanMonths(onAtMs, et(2027, 1, 5), TZ)).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }]);
  });
  it('court 15th across the year end: Jan 15 2027 period Dec 16 - Jan 15', () => {
    expect(courtPeriod({ membershipDay: 26, courtDay: 15 }, 2027, 1)).toEqual({ from: '2026-12-16', to: '2027-01-15' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('P-V04 DST weeks: 12:00 AM Eastern is the start, on both sides of every clock change', () => {
  // [date, expected UTC instant of its 12:00 AM]
  const cases: [string, string][] = [
    ['2026-03-08', '2026-03-08T05:00:00.000Z'], // spring forward day (2 AM): midnight is still EST
    ['2026-03-09', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', '2026-11-01T04:00:00.000Z'], // fall back day: midnight is still EDT
    ['2026-11-02', '2026-11-02T05:00:00.000Z'],
    ['2027-03-14', '2027-03-14T05:00:00.000Z'],
    ['2027-03-15', '2027-03-15T04:00:00.000Z'],
    ['2027-11-07', '2027-11-07T04:00:00.000Z'],
    ['2027-11-08', '2027-11-08T05:00:00.000Z'],
    ['2028-03-12', '2028-03-12T05:00:00.000Z'],
    ['2028-03-13', '2028-03-13T04:00:00.000Z'],
  ];
  it.each(cases)('startOfDayMs(%s) = %s', (date, iso) => {
    expect(new Date(startOfDayMs(date, TZ)).toISOString()).toBe(iso);
  });
  const dstDays: [number, number, number][] = [
    [2026, 3, 8],
    [2026, 11, 1],
    [2027, 3, 14],
    [2027, 11, 7],
    [2028, 3, 12],
  ];
  it.each(dstDays)('membership day on the DST day %i-%i-%i: off 1 minute before Eastern midnight, on at it', (y, m, d) => {
    const days = { membershipDay: d, courtDay: 0 };
    const onAtMs = et(y, m, 1, 0, 0) - 60_000; // the day before the month starts
    const start = startOfDayMs(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, TZ);
    expect(dueAlerts({ ...base, days, games: [], onAtMs, nowMs: start - 60_000 })).toEqual([]);
    expect(keys(dueAlerts({ ...base, days, games: [], onAtMs, nowMs: start }))).toEqual([`membership:${y}-${String(m).padStart(2, '0')}`]);
  });
  it.each(dstDays)('court day ON the DST day %i-%i-%i: game at 11:30 PM that day counts, 12:30 AM next day does not', (y, m, d) => {
    const days = { membershipDay: 26, courtDay: d };
    const late = gEt(y, m, d, 23, 30);
    const next = gEt(y, m, d + 1, 0, 30);
    const p = courtPeriod(days, y, m);
    expect(periodGames([late, next], p, TZ)).toEqual([late]);
    expect(localYmd(Date.parse(late.startsAt), TZ)).toBe(p.to);
  });
  it('switch turned on exactly at 12:00 AM EDT on Nov 7 2027 (04:00 UTC): that day counts; 12:01 AM does not', () => {
    const days = { membershipDay: 7, courtDay: 0 };
    const at = Date.parse('2027-11-07T04:00:00.000Z');
    expect(keys(dueAlerts({ ...base, days, games: [], onAtMs: at, nowMs: at + 3_600_000 }))).toEqual(['membership:2027-11']);
    expect(dueAlerts({ ...base, days, games: [], onAtMs: at + 60_000, nowMs: at + 3_600_000 })).toEqual([]);
  });
  it('a game at 1:30 AM on the fall-back day (the hour that happens twice) lands on that Eastern day', () => {
    expect(localYmd(Date.parse('2027-11-07T05:30:00.000Z'), TZ)).toBe('2027-11-07'); // 1:30 AM EDT
    expect(localYmd(Date.parse('2027-11-07T06:30:00.000Z'), TZ)).toBe('2027-11-07'); // 1:30 AM EST
  });
});

describe('P-V05 billing-period edges and amounts', () => {
  const d15 = { membershipDay: 26, courtDay: 15 };
  it('game on the charge day itself (11:59 PM) is in, 12:00 AM the day after is next period', () => {
    const p = courtPeriod(d15, 2026, 12);
    expect(p).toEqual({ from: '2026-11-16', to: '2026-12-15' });
    const inG = gEt(2026, 12, 15, 23, 59);
    const outG = gEt(2026, 12, 16, 0, 0);
    expect(periodGames([inG, outG], p, TZ)).toEqual([inG]);
    expect(periodGames([inG, outG], courtPeriod(d15, 2027, 1), TZ)).toEqual([outG]);
  });
  it('a game later on the charge day that has not started yet still counts (booked)', () => {
    const games = [gEt(2026, 12, 15, 20)];
    const a = dueAlerts({ ...base, membershipCents: 0, days: d15, games, onAtMs: et(2026, 11, 20), nowMs: et(2026, 12, 15, 8) });
    expect(a[0].cents).toBe(4800);
  });
  it('canceled, Not booked: excluded; a canceled Booked game drops out; per-game costs differ', () => {
    const games = [gEt(2026, 12, 1), gEt(2026, 12, 2, 20, 0, { canceled: true }), gEt(2026, 12, 3, 20, 0, { booked: false }), gEt(2026, 12, 4, 20, 0, { costCents: 3600 })];
    const a = dueAlerts({ ...base, membershipCents: 0, days: d15, games, onAtMs: et(2026, 11, 20), nowMs: et(2026, 12, 15, 8) });
    expect(a[0]).toMatchObject({ cents: 8400, line: '2 games = $84' });
  });
  it('membership $0: no membership card; courts still show', () => {
    const a = dueAlerts({ ...base, membershipCents: 0, days: { membershipDay: 15, courtDay: 15 }, games: [gEt(2026, 12, 1)], onAtMs: et(2026, 11, 20), nowMs: et(2026, 12, 15, 8) });
    expect(keys(a)).toEqual(['court:2026-12']);
  });
});

describe('P-V06 courtPaidThrough is the LATEST paid court date, applied to OLDER unpaid months too', () => {
  it('Oct and Nov court cards both unpaid; Nov marked paid first -> the unpaid October card disappears (not marked paid)', () => {
    const L = { membershipDay: 26, courtDay: 0 };
    const games = [gEt(2026, 10, 27), gEt(2026, 10, 29), gEt(2026, 11, 3)];
    const input = { ...base, membershipCents: 0, days: L, games, onAtMs: et(2026, 10, 26, 12), nowMs: et(2026, 12, 1, 8) };
    expect(keys(dueAlerts(input))).toEqual(['court:2026-10', 'court:2026-11']);
    // The server feeds courtPaidThrough = the max paid court date = 2026-11-30 once November is marked.
    const after = dueAlerts({ ...input, paid: new Set(['court:2026-11']), courtPaidThrough: '2026-11-30' });
    // EXPECTED by the rules ("a card stays until Mark paid"): ['court:2026-10']. ACTUAL:
    expect(keys(after)).toEqual([]);
  });
});

describe('P-V07 moving the court day LATER after a paid charge drops the days in between from every card', () => {
  it('court 15th, Oct 15 paid; on Nov 10 moved to the 20th: Nov 20 card bills Oct 21 - Nov 20, games Oct 16-20 are on no card', () => {
    const d20 = { membershipDay: 26, courtDay: 20 };
    const games = [gEt(2026, 10, 17), gEt(2026, 10, 20), gEt(2026, 10, 22), gEt(2026, 11, 3)];
    const a = dueAlerts({ ...base, membershipCents: 0, days: d20, games, onAtMs: et(2026, 11, 10, 9), nowMs: et(2026, 11, 20, 8), paid: new Set(['court:2026-10']), courtPaidThrough: '2026-10-15' });
    expect(keys(a)).toEqual(['court:2026-11']);
    // Oct 17 and Oct 20 were after the paid Oct 15 charge and are billed nowhere: 2 games, not 4.
    expect(a[0].line).toBe('2 games x $48 = $96');
  });
});
