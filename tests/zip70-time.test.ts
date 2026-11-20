import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { shortClock } from '../shared/tournament';
import { expectedPlayers, moneyLine, moneyRowLabel, savedExpect, timeMoveWords } from '../shared/tournamentMoney';
import { fitWords, nightPlan } from '../shared/tournamentPlan';
import { activityText } from '../shared/activity';
import { PAY_SHEET_HEADER } from '../shared/paySheet';

// Zip 70 (🎾70.time): the late drop rule (dry run fix 1), payment details only to a phone with a name (fix 4), the Plan's expected players in the
// money line (fix 5), THE money line, moving the start and the end after Finalize, the Plan box, and the players' time card.
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is Thu Nov 12, finalized with the usual Plays 7:30 to
// 10:00 PM on 2 courts; Pay by is Wed Nov 11, 7:00 PM (the night before).

const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all', format: 'doubles' };
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery'];
const AFTER_PAY_BY = Date.parse('2026-11-12T00:30:00.000Z'); // Wed Nov 11, 7:30 PM EST
const CUTOFF_MS = Date.parse('2026-11-12T21:30:00.000Z'); // Thu Nov 12, 4:30 PM EST: 3 hours before 7:30 PM
const START_MS = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const NAMES = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

async function world(opts: { signUp?: string[]; finalize?: Record<string, unknown> | false } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', BASE);
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id };
  for (const name of opts.signUp ?? []) await signUp(ctx, name);
  if (opts.finalize !== false) {
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, ...(opts.finalize ?? {}) });
    expect(res.status, res.text).toBe(200);
  }
  return ctx;
}

async function signUp(ctx: Ctx, name: string) {
  const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
  expect(res.status, res.text).toBe(200);
}

const pot = (ctx: Ctx, name: string): number =>
  Number(
    (
      ctx.app.db.raw
        .prepare(
          `SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c
           FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`,
        )
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
const ledgerRows = (ctx: Ctx) => Number((ctx.app.db.raw.prepare('SELECT COUNT(*) AS c FROM credit_ledger').get() as { c: number }).c);

/** Lock my spot with credit given first (the credit pays the whole ticket: locked in at once). */
async function lockIn(ctx: Ctx, names: string[]) {
  for (const n of names) {
    const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[n]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen: pot(ctx, n) });
    expect(give.status, give.text).toBe(200);
    const r = await (await playerPhone(ctx, n)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
  }
}

const backOut = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const signupStatus = (ctx: Ctx, name: string) =>
  (ctx.app.db.raw.prepare('SELECT status FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as { status: string }).status;
const ticket = (ctx: Ctx, name: string) =>
  ctx.app.db.raw.prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as Record<string, number | string>;
const history = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[];

function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}

describe('THE money line (one function everywhere)', () => {
  it('profit, zero, loss, credits', () => {
    // Picture 1: 8 players, 2 courts, 2.5 hours, $18, no credits: $126 - $120 = +$6.
    expect(moneyLine({ expected: 8, courts: 2, minutes: 150, ticketCents: 1800, prizeCents: 0 })).toEqual({ courtCents: 12000, ticketsCents: 12600, youCents: 600 });
    // Picture 2: 7:30 to 9:30 PM: Courts $96, Tickets $126, You +$30.
    expect(moneyLine({ expected: 8, courts: 2, minutes: 120, ticketCents: 1800, prizeCents: 0 })).toEqual({ courtCents: 9600, ticketsCents: 12600, youCents: 3000 });
    // Picture 4: Americano for 9: $120, $144, +$24. Picture 7: 10 expected: $120, $162, +$42.
    expect(moneyLine({ expected: 9, courts: 2, minutes: 150, ticketCents: 1800, prizeCents: 0 }).youCents).toBe(2400);
    expect(moneyLine({ expected: 10, courts: 2, minutes: 150, ticketCents: 1800, prizeCents: 0 }).youCents).toBe(4200);
    // Zero: 6 expected on 1 court for 2.5 hours at $12: $60 - $60.
    expect(moneyLine({ expected: 6, courts: 1, minutes: 150, ticketCents: 1200, prizeCents: 0 }).youCents).toBe(0);
    expect(moneyRowLabel(0)).toBe('You make if it fills');
    // A loss: 3 hours on 2 courts for 8: $126 - $144 = -$18 ("Your cost if it fills").
    expect(moneyLine({ expected: 8, courts: 2, minutes: 180, ticketCents: 1800, prizeCents: 0 }).youCents).toBe(-1800);
    expect(moneyRowLabel(-1800)).toBe('Your cost if it fills');
    // The credits now set come off: 2 x $14 champion credit turns +$6 into -$22.
    expect(moneyLine({ expected: 8, courts: 2, minutes: 150, ticketCents: 1800, prizeCents: 2800 }).youCents).toBe(-2200);
  });

  it('expected players: the saved number, else the suggestion, never below the locked in, 6 to 16', () => {
    expect(expectedPlayers({ saved: null, suggested: 8, locked: 6 })).toBe(8);
    expect(expectedPlayers({ saved: 10, suggested: 8, locked: 6 })).toBe(10);
    expect(expectedPlayers({ saved: 8, suggested: 8, locked: 9 })).toBe(9);
    expect(expectedPlayers({ saved: null, suggested: 3, locked: 0 })).toBe(6);
    expect(expectedPlayers({ saved: 20, suggested: 8, locked: 0 })).toBe(16);
    expect([savedExpect('10'), savedExpect('5'), savedExpect('17'), savedExpect('x'), savedExpect(null)]).toEqual([10, null, null, null, null]);
  });

  it('the time card words and the short clock', () => {
    expect(shortClock(22 * 60)).toBe('10 PM');
    expect(shortClock(21 * 60 + 30)).toBe('9:30 PM');
    expect(timeMoveWords('The Cold Open', { start: 1170, minutes: 150 }, { start: 1170, minutes: 120 })).toEqual({
      title: 'The Cold Open now ends at 9:30 PM (was 10 PM).',
      sub: 'Based on the number of players locked in.',
    });
    expect(timeMoveWords('The Cold Open', { start: 1170, minutes: 150 }, { start: 1200, minutes: 120 })!.title).toBe('The Cold Open now starts at 8 PM (was 7:30 PM).');
    expect(timeMoveWords('The Cold Open', { start: 1170, minutes: 150 }, { start: 1200, minutes: 150 })!.title).toBe(
      'The Cold Open now starts at 8 PM (was 7:30 PM) and ends at 10:30 PM (was 10 PM).',
    );
    expect(timeMoveWords('The Cold Open', { start: 1170, minutes: 150 }, { start: 1170, minutes: 150 })).toBeNull();
  });

  it('the fit line names the style really played (picture 4)', () => {
    expect(fitWords(nightPlan(9, 2, 150, 'doubles'), 1170).text).toBe('Americano for 9: games to 11, done about 9:50 PM.');
    expect(fitWords(nightPlan(10, 2, 150, 'doubles'), 1170).text).toBe('Locked doubles for 10: games to 11, done about 9:50 PM.');
  });
});

describe('fix 1: the late drop rule (after Pay by, below 8 on 2 courts: no credit back until someone takes the spot)', () => {
  async function lockedWorld(n: number, finalize?: Record<string, unknown>) {
    const names = NAMES.slice(0, n);
    const ctx = await world({ signUp: [...names, 'Lee', 'Lane'], finalize });
    await lockIn(ctx, names);
    ctx.app.now = AFTER_PAY_BY;
    return { ctx, names };
  }

  it('10 to 9: credit back as usual', async () => {
    const { ctx } = await lockedWorld(10);
    const r = await backOut(ctx, 'Blair');
    expect(r.status, r.text).toBe(200);
    expect(r.data.keptCents).toBeUndefined();
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(signupStatus(ctx, 'Blair')).toBe('out');
    books(ctx);
  });

  it('9 to 8: credit back as usual', async () => {
    const { ctx } = await lockedWorld(9);
    expect((await card(ctx, 'Blair')).tickets.dropKeeps).toBeUndefined();
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    books(ctx);
  });

  it('8 to 7: no credit; a new player locks in and pays: the dropped player gets $16 back once (refresh and double taps never pay twice)', async () => {
    const { ctx } = await lockedWorld(8);
    // The Drop out sheet's two lines show only when the rule applies.
    expect((await card(ctx, 'Blair')).tickets.dropKeeps).toBe(true);
    expect((await card(ctx, 'Lee')).tickets.dropKeeps).toBeUndefined();
    const rows = ledgerRows(ctx);
    const r = await backOut(ctx, 'Blair');
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ result: 'backed_out', keptCents: 1600, creditBackCents: 0, creditReturnedCents: 0 });
    expect(pot(ctx, 'Blair')).toBe(0);
    expect(ledgerRows(ctx)).toBe(rows);
    expect(signupStatus(ctx, 'Blair')).toBe('kept');
    expect(ticket(ctx, 'Blair')).toEqual({ place: 'none', credit_cents: 1600, paid_cents: 0, claim_cents: 0 });
    // A second tap moves nothing.
    expect((await backOut(ctx, 'Blair')).data.result).toBe('not_signed_up');
    expect(pot(ctx, 'Blair')).toBe(0);
    // 7 now: the next drop (7 to 6) is kept too.
    expect((await backOut(ctx, 'Casey')).data.keptCents).toBe(1600);
    books(ctx);
    // The organizer's screens and refreshes never give it back.
    for (let i = 0; i < 3; i++) await dash(ctx);
    expect(pot(ctx, 'Blair')).toBe(0);
    // Lee pays: 7 spots taken, still below 8: nothing back.
    await lockIn(ctx, ['Lee']);
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey')]).toEqual([0, 0]);
    // Lane pays: 8 again: both kept drops get their credit back, in that same step.
    await lockIn(ctx, ['Lane']);
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey')]).toEqual([1600, 1600]);
    expect([signupStatus(ctx, 'Blair'), signupStatus(ctx, 'Casey')]).toEqual(['out', 'out']);
    const after = ledgerRows(ctx);
    // Refreshes, another lock tap, the organizer's dashboard: once only.
    await (await playerPhone(ctx, 'Lane')).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    for (let i = 0; i < 3; i++) {
      await dash(ctx);
      await card(ctx, 'Blair');
    }
    expect(ledgerRows(ctx)).toBe(after);
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey')]).toEqual([1600, 1600]);
    // History: the late drop and the credit back (the usual credit history line for the player).
    const h = await history(ctx);
    const kept = h.filter((e) => e.action === 'tournament_back_out' && e.details.keptCents === 1600);
    expect(kept).toHaveLength(2);
    expect(activityText(kept[kept.length - 1] as never, 'America/Detroit', 'Alex')).toMatch(/dropped out of the The Cold Open late \(\$16 kept: no credit back unless someone takes the spot\)/);
    expect(h.filter((e) => e.action === 'tournament_kept_returned')).toHaveLength(2);
    const credit = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group')).data.credit;
    expect(credit.balanceCents).toBe(1600);
    books(ctx);
  });

  it('before Pay by: 8 to 7 gives the credit back (unchanged)', async () => {
    const names = NAMES.slice(0, 8);
    const ctx = await world({ signUp: names });
    await lockIn(ctx, names);
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
  });

  it('a 1 court night: 8 to 7 gives the credit back (there is no second court to lose)', async () => {
    const { ctx } = await lockedWorld(8, { courts: 1 });
    expect((await card(ctx, 'Blair')).tickets.dropKeeps).toBeUndefined();
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
  });

  it('from 3 hours before the start Drop out is closed (server refused, nothing moves); the card says so', async () => {
    const { ctx } = await lockedWorld(10);
    ctx.app.now = CUTOFF_MS - 60_000;
    expect((await card(ctx, 'Blair')).tickets.dropClosed).toBeUndefined();
    ctx.app.now = CUTOFF_MS;
    expect((await card(ctx, 'Blair')).tickets.dropClosed).toBe(true);
    const rows = ledgerRows(ctx);
    const r = await backOut(ctx, 'Blair');
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ error: 'drop_closed', message: 'Drop out has closed. Text Alex.' });
    expect(signupStatus(ctx, 'Blair')).toBe('in');
    expect(ledgerRows(ctx)).toBe(rows);
    expect(pot(ctx, 'Blair')).toBe(0);
  });

  it('a kept drop stays kept after the night (never an unused hold); a Cancel gives it back', async () => {
    const { ctx } = await lockedWorld(8);
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    ctx.app.now = START_MS + 5 * 3_600_000;
    await dash(ctx);
    await card(ctx, 'Casey');
    expect(pot(ctx, 'Blair')).toBe(0);
    books(ctx);
    const ctx2 = (await lockedWorld(8)).ctx;
    expect((await backOut(ctx2, 'Blair')).data.keptCents).toBe(1600);
    expect((await ctx2.organizer.call('POST', `/api/admin/tournament/${ctx2.tid}/cancel`, {})).status).toBe(200);
    expect(pot(ctx2, 'Blair')).toBe(1600);
    books(ctx2);
  });
});

describe('the late drop rule: the independent review\'s cases', () => {
  async function kept8() {
    const names = NAMES.slice(0, 8);
    const ctx = await world({ signUp: [...names, 'Lee', 'Lane'] });
    await lockIn(ctx, names);
    ctx.app.now = AFTER_PAY_BY;
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    return ctx;
  }

  it('a kept player who signs up again takes their own paid spot back; dropping again keeps it again (never a refund by dropping twice)', async () => {
    const ctx = await kept8();
    await signUp(ctx, 'Blair');
    expect(signupStatus(ctx, 'Blair')).toBe('in');
    expect(ticket(ctx, 'Blair')).toMatchObject({ place: 'spot', credit_cents: 1600 });
    expect(pot(ctx, 'Blair')).toBe(0);
    // 8 again: the second drop is kept again.
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    expect(pot(ctx, 'Blair')).toBe(0);
    // The night ends: still kept.
    ctx.app.now = START_MS + 5 * 3_600_000;
    await dash(ctx);
    expect(pot(ctx, 'Blair')).toBe(0);
    books(ctx);
  });

  it('the sheet said "credit back" but the rule now keeps it (someone else dropped first): refused, nothing moves', async () => {
    const names = NAMES.slice(0, 9);
    const ctx = await world({ signUp: names });
    await lockIn(ctx, names);
    ctx.app.now = AFTER_PAY_BY;
    expect((await card(ctx, 'Casey')).tickets.dropKeeps).toBeUndefined();
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBeUndefined(); // 9 to 8: credit back
    const r = await (await playerPhone(ctx, 'Casey')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: 1600, keeps: false });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('drop_changed');
    expect(signupStatus(ctx, 'Casey')).toBe('in');
    // The sheet now says it (two lines), and the drop with what it showed lands, kept.
    expect((await card(ctx, 'Casey')).tickets.dropKeeps).toBe(true);
    const ok = await (await playerPhone(ctx, 'Casey')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: 1600, keeps: true });
    expect(ok.data.keptCents).toBe(1600);
  });

  it('after the 3 hour cutoff a kept player cannot sign up again (the money stays kept)', async () => {
    const ctx = await kept8();
    ctx.app.now = CUTOFF_MS;
    const r = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
    expect(r.status).toBe(409);
    expect(signupStatus(ctx, 'Blair')).toBe('kept');
    ctx.app.now = START_MS + 5 * 3_600_000;
    await dash(ctx);
    expect(pot(ctx, 'Blair')).toBe(0);
  });

  it('a Reschedule gives kept money back (the new date is not the night they paid for)', async () => {
    const ctx = await kept8();
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/reschedule`, {})).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(signupStatus(ctx, 'Blair')).toBe('out');
    books(ctx);
  });

  it('down to 1 court (the Plan box): no second court to lose, so kept drops get their credit back', async () => {
    const ctx = await kept8();
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 8, courts: 1 })).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(signupStatus(ctx, 'Blair')).toBe('out');
    books(ctx);
  });

  it('an I paid still waiting is not a paid spot: the keep test and the release test count the same paid spots', async () => {
    const names = NAMES.slice(0, 7);
    const ctx = await world({ signUp: [...names, 'Lee', 'Lane'] });
    await lockIn(ctx, names);
    // Lee taps I paid (waiting): players see 8 locked in, paid spots are 7.
    const lee = await playerPhone(ctx, 'Lee');
    await lee.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    expect((await lee.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 })).status).toBe(200);
    ctx.app.now = AFTER_PAY_BY;
    // 7 paid spots: Blair's drop is kept; Lane pays: 7 paid spots again (not 8): still kept; the organizer confirms Lee: 8: back.
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    await lockIn(ctx, ['Lane']);
    expect(pot(ctx, 'Blair')).toBe(0);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Lee, action: 'confirm', cents: 1600 })).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    books(ctx);
  });
});

describe('Time and Plan (pictures 1, 2, 3, 6, 7)', () => {
  it('the card: Time, the money row for the expected players, the spots players see', async () => {
    const ctx = await world({ signUp: NAMES.slice(0, 8) });
    await lockIn(ctx, NAMES.slice(0, 6));
    const t = await dash(ctx);
    // 8 can make the date: the Plan expects 8 (the real count), 2 courts, the real 2.5 hours. $16 tickets, $28 of credits: 7 x $16 - $120 - $28.
    expect(t).toMatchObject({ expected: 8, suggested: 8, expectSaved: false, spots: 8, courts: 2, minutes: 150, start: 1170, timeOpen: true, planOpen: true });
    expect(t.money).toEqual({ courtCents: 12000, ticketsCents: 11200, youCents: 11200 - 12000 - 2800 });
    expect(t.cost.ifFillsCents).toBe(-t.money.youCents);
  });

  it('moving the end: everything follows, Pay by stays, players on the list get one card (picture 6); a second move keeps the first "was"', async () => {
    const ctx = await world({ signUp: NAMES.slice(0, 8) });
    const payBy = (await dash(ctx)).payBy;
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 1170, minutes: 120 });
    expect(r.status, r.text).toBe(200);
    const t = await dash(ctx);
    expect(t).toMatchObject({ start: 1170, minutes: 120, payBy });
    expect(t.money.courtCents).toBe(9600);
    const c = await card(ctx, 'Blair');
    expect(c).toMatchObject({ start: 1170, minutes: 120, startSet: true });
    expect(c.timeNote).toMatchObject({ title: 'The Cold Open now ends at 9:30 PM (was 10 PM).', sub: 'Based on the number of players locked in.' });
    // Not on the list: no card.
    expect((await card(ctx, 'Morgan')).timeNote).toBeUndefined();
    // The start moves too: the card says both, "was" is still the time players were told first.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 1200, minutes: 90 })).status).toBe(200);
    const c2 = await card(ctx, 'Blair');
    expect(c2.timeNote.title).toBe('The Cold Open now starts at 8 PM (was 7:30 PM) and ends at 9:30 PM (was 10 PM).');
    expect(c2.timeNote.key).not.toBe(c.timeNote.key);
    // The 3 hour cutoff follows the new start (8 PM: 5 PM).
    ctx.app.now = CUTOFF_MS + 15 * 60_000;
    expect((await card(ctx, 'Blair')).tickets.dropClosed).toBeUndefined();
    ctx.app.now = CUTOFF_MS + 30 * 60_000;
    expect((await card(ctx, 'Blair')).tickets.dropClosed).toBe(true);
    // Back to the first time: no card.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 1170, minutes: 150 })).status).toBe(200);
    expect((await card(ctx, 'Blair')).timeNote).toBeUndefined();
    const h = await history(ctx);
    expect(activityText(h.find((e) => e.action === 'tournament_time') as never, 'America/Detroit', 'Alex')).toMatch(/moved the The Cold Open to 7:30 to 10 PM \(was 8 to 9:30 PM\)/);
  });

  it('the time stays once the night window opens or the teams are published; a start too soon and a Pay by after the new cutoff are refused', async () => {
    const ctx = await world({ signUp: NAMES.slice(0, 8) });
    // Pay by is Wed 7 PM; a 9 PM Wednesday start... is another day. On the day: a 6 PM start closes tickets at 3 PM, before Pay by? No, Pay by is the night before. Make Pay by Thursday 3 PM.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-12T20:00:00.000Z' })).status).toBe(200);
    const late = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 17 * 60 + 30, minutes: 150 });
    expect(late.status).toBe(409);
    expect(late.data.error).toBe('pay_by_late');
    // Thursday 3:30 PM (before the 4:30 PM cutoff): a 6 PM start would close tickets and Drop out right now (its cutoff is 3 PM): refused.
    ctx.app.now = CUTOFF_MS - 60 * 60_000;
    const instant = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 18 * 60, minutes: 150 });
    expect(instant.status).toBe(400);
    expect(instant.data.message).toBe('That start would close tickets and Drop out right now. Pick a later one.');
    ctx.app.now = START_MS - 31 * 60_000;
    const soon = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 19 * 60, minutes: 150 });
    expect(soon.status).toBe(400);
    expect(soon.data.error).toBe('too_soon');
    ctx.app.now = START_MS - 30 * 60_000;
    const shut = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 1170, minutes: 120 });
    expect(shut.status).toBe(409);
    expect(shut.data.error).toBe('time_locked');
    expect((await dash(ctx)).timeOpen).toBe(false);
  });

  it('the Plan box: Expect and Courts saved; the money follows; never below the locked in', async () => {
    const ctx = await world({ signUp: NAMES.slice(0, 8) });
    await lockIn(ctx, NAMES.slice(0, 7));
    const low = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 6, courts: 2 });
    expect(low.status).toBe(409);
    expect(low.data.message).toBe('7 are locked in. Expect at least 7.');
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 10, courts: 1 });
    expect(r.status, r.text).toBe(200);
    const t = await dash(ctx);
    expect(t).toMatchObject({ expected: 10, suggested: 8, expectSaved: true, courts: 1, spots: 10 });
    // 1 court x 2.5 hours = $60; 9 x $16 = $144; $28 credits: +$56.
    expect(t.money).toEqual({ courtCents: 6000, ticketsCents: 14400, youCents: 5600 });
    expect((ctx.app.db.raw.prepare('SELECT courts FROM tournaments WHERE id = ?').get(ctx.tid) as { courts: number }).courts).toBe(1);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 17, courts: 2 })).status).toBe(400);
    // The same numbers again (a double tap): nothing written.
    const lines = (await history(ctx)).filter((e) => e.action === 'tournament_plan').length;
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 10, courts: 1 })).data.changed).toBe(false);
    expect((await history(ctx)).filter((e) => e.action === 'tournament_plan').length).toBe(lines);
    expect(activityText((await history(ctx)).find((e) => e.action === 'tournament_plan') as never, 'America/Detroit', 'Alex')).toMatch(/set the The Cold Open plan to 10 players on 1 court/);
  });
});

describe('fix 4: payment details only to a phone that picked a name', () => {
  it('no name: no Venmo link and no Zelle number; a name: both', async () => {
    const ctx = await world({ signUp: [], finalize: false });
    const ON = { [PAY_SHEET_HEADER]: 'on' };
    const anon = ctx.app.client();
    anon.groupKey = ctx.groupKey;
    const g = (await anon.call('GET', '/api/group', undefined, ON)).data;
    expect(g.me).toBeNull();
    expect(g.group.venmoUrl).toBeNull();
    expect('zelleNumber' in g.group).toBe(false);
    const named = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group', undefined, ON)).data;
    expect(named.group.venmoUrl).toBe('https://venmo.com/u/organizer');
    expect('zelleNumber' in named.group).toBe(true);
  });
});

// ---------- Zip 76 (🎾76.money fixes, the 🎾75 audit): the late drop rule counts a waiting I paid the way players see it; Pay by moved later ----------

describe('Zip 76: the late drop rule and a waiting I paid; Pay by moved later', () => {
  async function withWaiting(paidSpots: number, waiter: string) {
    const names = NAMES.slice(0, paidSpots);
    const ctx = await world({ signUp: [...names, waiter, 'Lane'] });
    await lockIn(ctx, names);
    const w = await playerPhone(ctx, waiter);
    await w.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    expect((await w.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 })).status).toBe(200);
    ctx.app.now = AFTER_PAY_BY;
    return ctx;
  }

  it('7 paid spots + Lee whose $16 I paid waits (players see 8): Lee drops and is held to the rule like a credit payer (kept)', async () => {
    const ctx = await withWaiting(7, 'Lee');
    expect((await card(ctx, 'Lee')).tickets.dropKeeps).toBe(true);
    const r = await backOut(ctx, 'Lee');
    expect(r.status, r.text).toBe(200);
    expect(r.data.keptCents).toBe(1600);
    expect(signupStatus(ctx, 'Lee')).toBe('kept');
    // The organizer confirms the I paid: still kept (no credit back), as for a credit payer.
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Lee, action: 'confirm', cents: 1600 })).status).toBe(200);
    expect(pot(ctx, 'Lee')).toBe(0);
    // Blair (a credit spot) dropping next is kept too: the same rule for both.
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    books(ctx);
  });

  it('8 paid spots + Lee waiting (players see 9): a drop takes it to 8, so it is NOT kept (credit back at once)', async () => {
    const ctx = await withWaiting(8, 'Lee');
    expect((await card(ctx, 'Blair')).tickets.dropKeeps).toBeUndefined();
    const r = await backOut(ctx, 'Blair');
    expect(r.status, r.text).toBe(200);
    expect(r.data.keptCents).toBeUndefined();
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(signupStatus(ctx, 'Blair')).toBe('out');
    books(ctx);
  });

  it('Pay by moved later: a drop kept under the old Pay by comes back at once (once), and a drop before the new Pay by gets credit back', async () => {
    const names = NAMES.slice(0, 8);
    const ctx = await world({ signUp: [...names, 'Lee', 'Lane'] });
    await lockIn(ctx, names);
    ctx.app.now = AFTER_PAY_BY;
    expect((await backOut(ctx, 'Blair')).data.keptCents).toBe(1600);
    expect(pot(ctx, 'Blair')).toBe(0);
    // Moved EARLIER than now (still past): nothing kept moves. (Refused: Pay by must be in the future; nothing written either way.)
    // Moved to Thu Nov 12, 10:00 AM (later than now): Blair's $16 comes back in the same step.
    const moved = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-12T15:00:00.000Z' });
    expect(moved.status, moved.text).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(signupStatus(ctx, 'Blair')).toBe('out');
    expect((await history(ctx)).filter((e) => e.action === 'tournament_kept_returned')).toHaveLength(1);
    // Moving it again gives nothing more.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-12T16:00:00.000Z' })).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1600);
    // Before the new Pay by: Casey's drop (7 to 6) gets credit back, the same as Blair's now.
    expect((await backOut(ctx, 'Casey')).data.keptCents).toBeUndefined();
    expect(pot(ctx, 'Casey')).toBe(1600);
    books(ctx);
  });
});
