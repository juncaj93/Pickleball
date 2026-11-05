// "Money page rework" (MONEY_REWORK): the pieces of the new screens that are plain logic, tested without a browser: which game sits where
// on the Games tab, the month dropdown, the credit-per-player footer, and the quieter History list (no-op moves hidden, only truly
// identical entries collapsed, names filled in, green only for NEW activity by someone else). The screens are in e2e/money-rework.cjs.
import { describe, expect, it } from 'vitest';
import { activityText, cleanActivity, highlightNew } from '../shared/activity';
import type { ActivityEntry, AdminSessionView } from '../shared/api';
import { zonedTimeToUtc } from '../shared/time';
import { smsHref } from '../shared/messages';
import { applyOps } from '../src/pages/admin/reworkOptimistic';
import { canTextAll, creditPerPlayerCents, fullyPaid, groupRemindText, missingNumberNote, textAllRecipients, monthBoxLabel, monthChoices, monthOf, monthRows, monthRowLabel, shiftMonthKey, splitGames } from '../src/pages/admin/moneyRework';

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
  it('G1 current month: today and the next 7 days are the list, games farther out are not shown, earlier games are Previous', () => {
    const today = game(at(11, 4));
    const in7 = game(at(11, 11, 12)); // Wed Nov 11 noon: inside the 7-day window (ends before Nov 12 0:00)
    const later = game(at(11, 12));
    // Fully paid AND finalized (Alex, Nov 5: a fully paid game moves to Previous only once it is finalized).
    const past = game(at(11, 3), { finalized: { priceCents: 1400 } }, [paidSeat(), paidSeat()]);
    const v = splitGames([today, in7, later, past], '2026-11', NOW, TZ);
    expect(ids(v.main)).toEqual([today.id, in7.id]);
    expect([...v.main, ...v.previous].map((g) => g.s.id)).not.toContain(later.id);
    expect(ids(v.previous)).toEqual([past.id]);
  });
  it('G2 a fully paid game goes to Previous only once it is finalized (Alex, Nov 5); not finalized it stays in the list, after the unpaid and partly paid', () => {
    const paid = game(at(11, 5), {}, [paidSeat(), paidSeat()]);
    const part = game(at(11, 6), {}, [paidSeat(), seat()]);
    const none = game(at(11, 7), {}, [seat(), seat()]);
    const v = splitGames([paid, part, none], '2026-11', NOW, TZ);
    expect(v.previous).toHaveLength(0);
    expect(ids(v.main)).toEqual([part.id, none.id, paid.id]);
    const done = game(at(11, 3), { finalized: { priceCents: 1400 } }, [paidSeat(), paidSeat()]);
    expect(ids(splitGames([done, paid], '2026-11', NOW, TZ).previous)).toEqual([done.id]);
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
    expect([...v.main, ...v.previous]).toHaveLength(1);
  });
  it('G6 any other month: every game is in the list unless fully paid and finalized', () => {
    const oct = game(at(10, 20), {}, [seat(), paidSeat()]);
    const octPaid = game(at(10, 22), { finalized: { priceCents: 1400 } }, [paidSeat(), paidSeat()]);
    const octPaidOpen = game(at(10, 23), {}, [paidSeat(), paidSeat()]);
    const v = splitGames([oct, octPaid, octPaidOpen], '2026-10', NOW, TZ);
    expect(ids(v.main)).toEqual([oct.id, octPaidOpen.id]);
    expect(ids(v.previous)).toEqual([octPaid.id]);
    const dec = game(at(12, 8));
    expect(ids(splitGames([dec], '2026-12', NOW, TZ).main)).toEqual([dec.id]);
  });
  it('G7 a coming game with no court and nobody in has no money to show, so it is not listed', () => {
    const empty = game(at(11, 5), { court: null, payableCount: 0, paidCount: 0, confirmedCount: 0 }, []);
    expect([...splitGames([empty], '2026-11', NOW, TZ).main]).toHaveLength(0);
  });
});

describe('Month dropdown', () => {
  it('M1 EVERY month from the first one that had a game up to the current month, newest first, with a count each', () => {
    const counts = { '2026-07': 3, '2026-09': 2, '2026-11': 4 };
    const list = monthChoices([], NOW, TZ, counts);
    expect(list.map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
    expect(list.map((m) => m.count)).toEqual([4, 0, 2, 0, 3]);
  });
  it('M2 without server counts it counts the games on hand, never a hidden one; a later month with games is above the current one', () => {
    const list = monthChoices([game(at(11, 5)), game(at(11, 6)), game(at(10, 20)), game(at(11, 7), { hiddenFromList: true }), game(at(12, 3))], NOW, TZ);
    expect(list.map((m) => m.month)).toEqual(['2026-12', '2026-11', '2026-10']);
    expect(list.map((m) => m.count)).toEqual([1, 2, 1]);
  });
  it('M3 with no games at all, just the current month', () => {
    expect(monthChoices([], NOW, TZ, {}).map((m) => m.month)).toEqual(['2026-11']);
  });
  it('M4 a year label row appears wherever the year changes', () => {
    const now = zonedTimeToUtc(2027, 2, 10, 12, 0, TZ);
    const rows = monthRows(monthChoices([], now, TZ, { '2026-11': 2, '2027-02': 1 }));
    expect(rows.map((r) => (r.kind === 'year' ? `[${r.year}]` : r.month))).toEqual(['2027-02', '2027-01', '[2026]', '2026-12', '2026-11']);
  });
  it('M5 labels', () => {
    expect(monthBoxLabel('2026-11')).toBe('Nov 2026');
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

describe('Remind sheet: Text all', () => {
  const d = { now: new Date(NOW).toISOString(), group: { timezone: TZ, playerLink: 'https://pickleball.juncaj.net', settings: { pricePerPlayerCents: 1400 } } } as any;
  const num = (n: number) => `(313) 555-01${String(n).padStart(2, '0')}`;
  const owes = (n: number, over: Record<string, unknown> = {}) => seat({ phone: num(n), ...over });
  it('R1 "Text all" shows only when at least 2 of the people who owe have a number', () => {
    expect(canTextAll(game(at(11, 5), {}, []))).toBe(false);
    expect(canTextAll(game(at(11, 5), {}, [owes(1)]))).toBe(false);
    expect(canTextAll(game(at(11, 5), {}, [owes(1), owes(2)]))).toBe(true);
    // Paid people do not count, and neither does the organizer.
    expect(canTextAll(game(at(11, 5), {}, [owes(1), seat({ phone: num(2), paymentStatus: 'paid', owesCents: 0 }), seat({ phone: num(3), isOrganizer: true })]))).toBe(false);
    // Two owe but only one has a number: hidden (the per-person Text buttons still work).
    expect(canTextAll(game(at(11, 5), {}, [owes(1), seat(), seat({ phone: null })]))).toBe(false);
    expect(canTextAll(game(at(11, 5), {}, [owes(1), owes(2), seat()]))).toBe(true);
  });
  it('R2 the message: two lines, a blank line, the site address alone on the last line', () => {
    const t = groupRemindText(d, game(at(11, 4, 12)));
    expect(t).toBe("Hey everyone, quick reminder for today's pickleball.\nIf you haven't paid your $14 yet, please do it here:\n\npickleball.juncaj.net");
    expect(t.split('\n')).toHaveLength(4);
  });
  it('R3 the day words are the same rule as every other text: today, tonight, tomorrow, yesterday, else the date', () => {
    const say = (m: number, day: number, h: number) => groupRemindText(d, game(at(m, day, h))).split('\n')[0];
    expect(say(11, 4, 12)).toBe("Hey everyone, quick reminder for today's pickleball.");
    expect(say(11, 4, 19)).toBe("Hey everyone, quick reminder for tonight's pickleball.");
    expect(say(11, 5, 19)).toBe("Hey everyone, quick reminder for tomorrow's pickleball.");
    expect(say(11, 3, 19)).toBe("Hey everyone, quick reminder for yesterday's pickleball.");
    expect(say(11, 10, 19)).toBe("Hey everyone, quick reminder for Tue Nov 10's pickleball.");
  });
  it('R4 the price is that game\'s: the usual price, or the final price once finalized', () => {
    expect(groupRemindText(d, game(at(11, 5)))).toContain('your $14 yet');
    expect(groupRemindText(d, game(at(11, 3), { finalized: { priceCents: 900 } }))).toContain('your $9 yet');
  });
  it('R5 there are no recipients in the link: it opens the group chat, you pick', async () => {
    const { smsHref } = await import('../shared/messages');
    expect(smsHref(null, 'x', true)).toBe('sms:&body=x');
    expect(smsHref(null, 'x', false)).toBe('sms:?body=x');
  });
});

describe('Text all: who Messages opens to', () => {
  const num = (n: number) => `(313) 555-01${String(n).padStart(2, '0')}`;
  const roster = () => [
    seat({ name: 'Ann', phone: num(1) }),
    seat({ name: 'Ben', phone: num(2) }),
    seat({ name: 'Cam', phone: num(3) }),
    seat({ name: 'Kai', phone: null }),
    seat({ name: 'Paid', phone: num(4), paymentStatus: 'paid', owesCents: 0 }),
    seat({ name: 'Credit', phone: num(5), owesCents: 0, creditCents: 1400 }),
    seat({ name: 'Wait', phone: num(6), status: 'waitlisted' }),
    seat({ name: 'Gone', phone: num(7), status: 'withdrawn' }),
    seat({ name: 'Boss', phone: num(8), isOrganizer: true }),
  ];
  it('T1 the recipients are exactly the unpaid, confirmed people with numbers; the rest are never included', () => {
    const to = textAllRecipients(game(at(11, 5), {}, roster()));
    expect(to.phones).toEqual([num(1), num(2), num(3)]);
    expect(to.missing).toEqual(['Kai']);
  });
  it('T2 a player who just paid is not texted (the list is rebuilt from the newest picture)', () => {
    const d = { now: new Date(NOW).toISOString(), sessions: [game(at(11, 5), { id: 'g9' }, roster())] } as any;
    const g = d.sessions[0];
    const ben = g.roster.find((r: any) => r.name === 'Ben');
    const after = applyOps(d, [{ kind: 'paid', sessionId: 'g9', playerId: ben.playerId }]);
    expect(textAllRecipients(d.sessions[0]).phones).toContain(num(2));
    expect(textAllRecipients(after.sessions[0]).phones).toEqual([num(1), num(3)]);
  });
  it('T3 a player without a number is skipped, and the note names them', () => {
    expect(missingNumberNote(['Kai'])).toBe('No number for Kai, texted the rest.');
    expect(missingNumberNote(['Kai', 'Lee'])).toBe('No number for Kai and Lee, texted the rest.');
    expect(missingNumberNote(['Kai', 'Lee', 'Max'])).toBe('No number for Kai, Lee and Max, texted the rest.');
  });
  it('T4 waitlisted people are never included, even if something is shown as owed on their row', () => {
    const g = game(at(11, 5), {}, [owes(1), owes(2), seat({ name: 'Wait', phone: num(6), status: 'waitlisted', owesCents: 1400 })]);
    expect(textAllRecipients(g).phones).toEqual([num(1), num(2)]);
    function owes(n: number) {
      return seat({ phone: num(n) });
    }
  });
  it('T5 Messages opens with ALL the numbers in one new message (the same way the one-person Text opens it), and the agreed words', () => {
    const d = { now: new Date(NOW).toISOString(), group: { timezone: TZ, playerLink: 'https://pickleball.juncaj.net', settings: { pricePerPlayerCents: 1400 } } } as any;
    const g = game(at(11, 4, 12), {}, roster());
    const body = groupRemindText(d, g);
    const phones = textAllRecipients(g).phones;
    const ios = smsHref(phones, body, true);
    expect(ios).toBe(`sms://open?addresses=+13135550101,+13135550102,+13135550103&body=${encodeURIComponent(body)}`);
    expect(smsHref(phones, body, false)).toBe(`sms:+13135550101,+13135550102,+13135550103?body=${encodeURIComponent(body)}`);
    expect(decodeURIComponent(ios.split('&body=')[1])).toBe("Hey everyone, quick reminder for today's pickleball.\nIf you haven't paid your $14 yet, please do it here:\n\npickleball.juncaj.net");
    // One person alone keeps its own link: that number only.
    expect(smsHref(num(1), 'x', true)).toBe('sms:+13135550101&body=x');
  });
});
