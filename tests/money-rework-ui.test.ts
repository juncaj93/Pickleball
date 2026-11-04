// "Money page rework" (MONEY_REWORK): the pieces of the new screens that are plain logic, tested without a browser: which game sits where
// on the Games tab, the month dropdown, the credit-per-player footer, and the quieter History list (no-op moves hidden, only truly
// identical entries collapsed, names filled in, green only for NEW activity by someone else). The screens are in e2e/money-rework.cjs.
import { describe, expect, it } from 'vitest';
import { activityText, cleanActivity, highlightNew } from '../shared/activity';
import type { ActivityEntry, AdminSessionView } from '../shared/api';
import { zonedTimeToUtc } from '../shared/time';
import { creditPerPlayerCents, fullyPaid, monthBoxLabel, monthChoices, monthOf, monthRowLabel, shiftMonthKey, splitGames } from '../src/pages/admin/moneyRework';

const TZ = 'America/Detroit';
// Wed Nov 4, 2026, 6:00 PM Eastern: the day this was built.
const NOW = zonedTimeToUtc(2026, 11, 4, 18, 0, TZ);
const at = (m: number, d: number, h = 19) => new Date(zonedTimeToUtc(2026, m, d, h, 0, TZ)).toISOString();

let n = 0;
function seat(over: Record<string, unknown> = {}) {
  n++;
  return { playerId: `p${n}`, name: `P${n}`, status: 'confirmed', paymentStatus: 'unpaid', owesCents: 1400, isOrganizer: false, lateFee: null, creditCents: 0, ...over };
}
function game(startsAt: string, over: Record<string, unknown> = {}, roster = [seat(), seat()]): AdminSessionView {
  n++;
  const payers = roster.filter((r: any) => !r.isOrganizer);
  const paid = payers.filter((r: any) => r.paymentStatus === 'paid').length;
  return {
    id: `g${n}`,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 2 * 3600_000).toISOString(),
    state: { flags: { canceled: false } },
    court: { costCents: 4800 },
    roster,
    payableCount: payers.length,
    paidCount: paid,
    needsFinalize: false,
    confirmedCount: payers.length,
    finalized: null,
    ...over,
  } as unknown as AdminSessionView;
}
const paidSeat = () => seat({ paymentStatus: 'paid', owesCents: 0 });
const ids = (xs: { s: AdminSessionView }[]) => xs.map((g) => g.s.id);

describe('Games tab: where each game sits', () => {
  it('G1 current month: today and the next 7 days are the list, farther games wait in Later, earlier games are Previous', () => {
    const today = game(at(11, 4));
    const in7 = game(at(11, 11, 12)); // Wed Nov 11 noon: inside the 7-day window (ends before Nov 12 0:00)
    const later = game(at(11, 12));
    const past = game(at(11, 3), {}, [paidSeat(), paidSeat()]);
    const v = splitGames([today, in7, later, past], '2026-11', NOW, TZ);
    expect(ids(v.main)).toEqual([today.id, in7.id]);
    expect(ids(v.later)).toEqual([later.id]);
    expect(ids(v.previous)).toEqual([past.id]);
  });
  it('G2 a fully paid game always goes to Previous, even if it is today; unpaid and partly paid stay on top', () => {
    const paid = game(at(11, 5), {}, [paidSeat(), paidSeat()]);
    const part = game(at(11, 6), {}, [paidSeat(), seat()]);
    const none = game(at(11, 7), {}, [seat(), seat()]);
    const v = splitGames([paid, part, none], '2026-11', NOW, TZ);
    expect(ids(v.previous)).toEqual([paid.id]);
    expect(ids(v.main)).toEqual([part.id, none.id]);
    expect(fullyPaid(paid)).toBe(true);
    expect(fullyPaid(part)).toBe(false);
  });
  it('G3 an older game somebody still owes for stays on top so nobody is forgotten', () => {
    const owed = game(at(11, 3), {}, [seat(), paidSeat()]);
    const today = game(at(11, 4));
    const v = splitGames([today, owed], '2026-11', NOW, TZ);
    expect(ids(v.main)).toEqual([owed.id, today.id]);
    expect(v.previous).toHaveLength(0);
  });
  it('G4 a canceled game with nobody owing: today it is in the list, before today it is Previous', () => {
    const closedToday = game(at(11, 4), { state: { flags: { canceled: true } }, court: null, payableCount: 0, paidCount: 0 }, [seat({ status: 'withdrawn', owesCents: 0 })]);
    const closedOld = game(at(11, 2), { state: { flags: { canceled: true } }, court: null, payableCount: 0, paidCount: 0 }, [seat({ status: 'withdrawn', owesCents: 0 })]);
    const v = splitGames([closedToday, closedOld], '2026-11', NOW, TZ);
    expect(ids(v.main)).toEqual([closedToday.id]);
    expect(ids(v.previous)).toEqual([closedOld.id]);
    expect(fullyPaid(closedToday)).toBe(false);
  });
  it('G5 a hidden game is in none of the three places', () => {
    const hidden = game(at(11, 5), { hiddenFromList: true });
    const v = splitGames([hidden, game(at(11, 6))], '2026-11', NOW, TZ);
    expect(ids(v.main)).not.toContain(hidden.id);
    expect([...v.main, ...v.previous, ...v.later]).toHaveLength(1);
  });
  it('G6 any other month: every game is in the list unless fully paid; nothing is "later"', () => {
    const oct = game(at(10, 20), {}, [seat(), paidSeat()]);
    const octPaid = game(at(10, 22), {}, [paidSeat(), paidSeat()]);
    const v = splitGames([oct, octPaid], '2026-10', NOW, TZ);
    expect(ids(v.main)).toEqual([oct.id]);
    expect(ids(v.previous)).toEqual([octPaid.id]);
    expect(v.later).toHaveLength(0);
    const dec = game(at(12, 8));
    expect(ids(splitGames([dec], '2026-12', NOW, TZ).main)).toEqual([dec.id]);
  });
  it('G7 a coming game with no court and nobody in has no money to show, so it is not listed', () => {
    const empty = game(at(11, 5), { court: null, payableCount: 0, paidCount: 0, confirmedCount: 0 }, []);
    expect([...splitGames([empty], '2026-11', NOW, TZ).main]).toHaveLength(0);
  });
});

describe('Month dropdown', () => {
  it('M1 newest first, the current month and four before it even with 0 games, with a count per month', () => {
    const list = monthChoices([game(at(11, 5)), game(at(11, 6)), game(at(10, 20)), game(at(11, 7), { hiddenFromList: true })], NOW, TZ);
    expect(list.map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
    expect(list.map((m) => m.count)).toEqual([2, 1, 0, 0, 0]);
  });
  it('M2 a later month with games is listed above the current one', () => {
    expect(monthChoices([game(at(12, 3))], NOW, TZ)[0]).toEqual({ month: '2026-12', count: 1 });
  });
  it('M3 labels', () => {
    expect(monthBoxLabel('2026-11')).toBe('NOV 26');
    expect(monthRowLabel('2026-11')).toBe('Nov 2026');
    expect(monthOf(NOW, TZ)).toBe('2026-11');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
  });
});

describe('Card footer', () => {
  it('F1 credit per player at the number in now: nothing at 4, $3 at 5, $5 at 6; nothing once finalized', () => {
    expect(creditPerPlayerCents(game(at(11, 5), { confirmedCount: 4 }), 1400)).toBe(0);
    expect(creditPerPlayerCents(game(at(11, 5), { confirmedCount: 5 }), 1400)).toBe(300);
    expect(creditPerPlayerCents(game(at(11, 5), { confirmedCount: 6 }), 1400)).toBe(500);
    expect(creditPerPlayerCents(game(at(11, 5), { confirmedCount: 6, finalized: { priceCents: 900 } }), 1400)).toBe(0);
  });
});

let id = 0;
function entry(action: string, details: Record<string, unknown> = {}, over: Partial<ActivityEntry> = {}): ActivityEntry {
  id++;
  return { id: `e${id}`, actorLabel: 'organizer', action, details, createdAt: new Date(NOW - id * 5 * 60_000).toISOString(), sessionStartsAt: at(11, 5), ...over };
}

describe('History: a quieter list', () => {
  it('A1 a move that changed nothing is hidden (server says so)', () => {
    const real = entry('roster_confirm', { player: 'Casey', result: 'confirmed' });
    const noop = entry('roster_confirm', { player: 'Casey', result: 'already_confirmed' });
    const gone = entry('roster_withdraw', { player: 'Casey', result: 'not_in_session' });
    expect(cleanActivity([noop, gone, real]).map((e) => e.id)).toEqual([real.id]);
  });
  it('A2 moving someone to the waitlist twice: the second move is hidden, the first stays (oldest first in time, newest first in the list)', () => {
    const second = entry('roster_waitlist', { player: 'Casey', result: 'waitlisted' });
    const first = entry('roster_waitlist', { player: 'Casey', result: 'waitlisted' }, { createdAt: new Date(NOW - 3_600_000).toISOString() });
    expect(cleanActivity([second, first]).map((e) => e.id)).toEqual([first.id]);
  });
  it('A3 a move that really changes the seat is kept: waitlist, then in, then waitlist again', () => {
    const t = (m: number) => new Date(NOW - m * 60_000).toISOString();
    const e3 = entry('roster_waitlist', { player: 'Casey', result: 'waitlisted' }, { createdAt: t(1) });
    const e2 = entry('roster_confirm', { player: 'Casey', result: 'confirmed' }, { createdAt: t(2) });
    const e1 = entry('roster_waitlist', { player: 'Casey', result: 'waitlisted' }, { createdAt: t(3) });
    expect(cleanActivity([e3, e2, e1]).map((e) => e.id)).toEqual([e3.id, e2.id, e1.id]);
  });
  it('A4 a seat the log has not shown yet is never guessed at (first move on a page stays)', () => {
    const only = entry('roster_waitlist', { player: 'Casey', result: 'waitlisted' });
    expect(cleanActivity([only])).toHaveLength(1);
  });
  it('A5 two entries that are truly identical (same hands, action, game, details, a minute apart) show once', () => {
    const a = entry('marked_paid', { player: 'Casey', amountCents: 1400 }, { createdAt: new Date(NOW).toISOString() });
    const b = entry('marked_paid', { player: 'Casey', amountCents: 1400 }, { createdAt: new Date(NOW - 20_000).toISOString() });
    expect(cleanActivity([a, b]).map((e) => e.id)).toEqual([a.id]);
  });
  it('A6 anything that differs is kept: another player, another amount, another game, another actor, an hour apart', () => {
    const base = { player: 'Casey', amountCents: 1400 };
    const a = entry('marked_paid', base, { createdAt: new Date(NOW).toISOString() });
    const others = [
      entry('marked_paid', { ...base, player: 'Blair' }, { createdAt: new Date(NOW - 10_000).toISOString() }),
      entry('marked_paid', { ...base, amountCents: 1100 }, { createdAt: new Date(NOW - 11_000).toISOString() }),
      entry('marked_paid', base, { createdAt: new Date(NOW - 12_000).toISOString(), sessionStartsAt: at(11, 6) }),
      entry('marked_paid', base, { createdAt: new Date(NOW - 13_000).toISOString(), actorLabel: 'Casey' }),
      entry('marked_paid', base, { createdAt: new Date(NOW - 3_600_000).toISOString() }),
    ];
    expect(cleanActivity([a, ...others])).toHaveLength(6);
  });
  it('A7 cleaning only hides: the list it is given is not changed and no entry is rewritten', () => {
    const list = [entry('roster_confirm', { player: 'Casey', result: 'already_confirmed' }), entry('marked_paid', { player: 'Casey' })];
    const copy = JSON.stringify(list);
    cleanActivity(list);
    expect(JSON.stringify(list)).toBe(copy);
  });
  it('H1 green only for NEW activity by someone other than the organizer', () => {
    const byPlayer = entry('player_join', { player: 'Casey', result: 'confirmed' }, { actorLabel: 'Casey' });
    const byOrganizer = entry('marked_paid', { player: 'Casey' });
    const asPlayer = entry('player_join', { player: 'Casey' }, { actorLabel: 'organizer as Casey' });
    const ownRow = entry('player_join', { player: 'Orla', organizer: true }, { actorLabel: 'Orla' });
    expect(highlightNew(byPlayer, true)).toBe(true);
    expect(highlightNew(byPlayer, false)).toBe(false); // already viewed
    expect(highlightNew(byOrganizer, true)).toBe(false);
    expect(highlightNew(asPlayer, true)).toBe(false);
    expect(highlightNew(ownRow, true)).toBe(false);
  });
  it('N1 names: a line says who it was about, from the id when the entry kept no name', () => {
    const names = (pid: string) => (pid === 'abc' ? 'Casey' : null);
    const claim = entry('payment_claim_confirmed', { playerId: 'abc' });
    expect(activityText(claim, TZ, 'Alex', { names })).toContain("Casey's I paid");
    expect(activityText(claim, TZ, 'Alex')).toMatch(/^Alex: payment claim confirmed/); // off: the line it always was
    const done = entry('late_drop_done', { player: 'Blair', playerId: 'x' });
    expect(activityText(done, TZ, 'Alex', { names })).toContain("Blair's late drop");
    expect(activityText(entry('late_drop_done', {}), TZ, 'Alex', { names })).toContain('handled a late drop');
    // Without the option the old line is unchanged.
    expect(activityText(done, TZ, 'Alex')).toBe(`Alex handled a late drop for ${activityText(done, TZ, 'Alex').split(' for ')[1]}`);
  });
  it('N2 the new actions read as plain sentences', () => {
    expect(activityText(entry('charge_edited', { chargedCents: 4800 }), TZ, 'Alex')).toMatch(/changed the venue charge.* to \$48/);
    expect(activityText(entry('charge_edited', { chargedCents: 0 }), TZ, 'Alex')).toMatch(/to none/);
    expect(activityText(entry('session_hidden_from_list'), TZ, 'Alex')).toMatch(/hid .* from the lists/);
    expect(activityText(entry('session_shown_in_list'), TZ, 'Alex')).toMatch(/restored .* to the lists/);
    expect(activityText(entry('money_rework_on', {}, { sessionStartsAt: null }), TZ, 'Alex')).toBe('Alex switched the Money page rework on');
  });
});
