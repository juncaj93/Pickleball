import { describe, expect, it } from 'vitest';
import {
  ALL, CUTOFF_MS, DATE, HOUR, MIN, PAY_BY_MS, START_MS, adminTour, allPots, answer, backOut, booksBad, card, coldOpen, finalize, giveCredit, group, history, iPaid, lock, moneyTotals,
  phone, pot, signUp, signupStatus, teams, ticket, type W,
} from './audit73-world';

// 🎾73.audit, Part A 4 to 6: time and money after Finalize, the drop-out money rule, edge cases. Money to the cent everywhere.
const soft = expect.soft;
const log = (label: string, x: unknown) => console.log(`\n=== ${label}\n${typeof x === 'string' ? x : JSON.stringify(x, null, 1).slice(0, 4000)}`);
const timeBox = (w: W, start: number, minutes: number) => w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/time`, { start, minutes });
const planBox = (w: W, expected: number, courts: 1 | 2) => w.organizer.call('PUT', `/api/admin/tournament/${w.tid}/plan`, { expected, courts });

/** n on the list for Dec 1 and locked in: Alex's $0 seat, the rest pay with credit given first (whole ticket). */
async function lockedN(w: W, n: number, extra: string[] = []) {
  const names = ALL.slice(0, n);
  for (const x of [...names, ...extra]) await signUp(w, x, [DATE]);
  await finalize(w);
  for (const x of names.slice(1)) {
    await giveCredit(w, x, 1800);
    soft((await lock(w, x)).data.result, `${x} locks`).toBe('locked');
  }
  return names;
}

describe('Part A 4: time and money', () => {
  it('end to 9:30 PM, then start to 8 PM, after Finalize: card, alert, cutoff, night window, cost and plan follow', async () => {
    const w = await coldOpen();
    await lockedN(w, 10);
    const t0 = await adminTour(w);
    log('before: money, expected, cost, timeOpen', { money: t0.money, expected: t0.expected, cost: t0.cost, timeOpen: t0.timeOpen, start: t0.start, minutes: t0.minutes });
    // End to 9:30 PM.
    const r1 = await timeBox(w, 1170, 120);
    soft(r1.status, r1.text).toBe(200);
    const c1 = await card(w, 'Blair');
    log('player after end moved: start/minutes + time alert', { start: c1.start, minutes: c1.minutes, timeMove: c1.timeMove ?? c1.timeAlert ?? null });
    // Start to 8 PM (end stays 9:30): 90 minutes.
    const r2 = await timeBox(w, 1200, 90);
    soft(r2.status, r2.text).toBe(200);
    const c2 = await card(w, 'Blair');
    log('player after start moved too', { start: c2.start, minutes: c2.minutes, timeMove: c2.timeMove ?? c2.timeAlert ?? null });
    const t2 = await adminTour(w);
    log('organizer after both moves', { money: t2.money, cost: t2.cost, start: t2.start, minutes: t2.minutes, expected: t2.expected, closeCheck: t2.closeCheck });
    // Courts $24 x 2 x 1.5 h = $72; tickets 9 x $18 = $162; you +$90.
    soft(t2.money, 'money follows the 1.5 hours').toEqual({ courtCents: 7200, ticketsCents: 16200, youCents: 9000 });
    // The cutoff follows: 3 hours before 8 PM = 5 PM. At 4:45 PM a drop still works (before), at 5:01 PM refused.
    w.app.now = Date.parse('2026-12-01T21:45:00Z'); // Tue 4:45 PM
    const pre = await card(w, 'Casey');
    log('Casey 4:45 PM: tickets.closed / dropOpen', { closed: pre.tickets?.closed, dropKeeps: pre.tickets?.dropKeeps, dropClosed: pre.tickets?.dropClosed ?? null });
    w.app.now = Date.parse('2026-12-01T22:01:00Z'); // Tue 5:01 PM
    const late = await backOut(w, 'Casey');
    soft(late.status, `drop after the new cutoff: ${late.text}`).toBe(409);
    // The night window: on Home 30 minutes before 8 PM, results open 15 minutes before 8 PM, not before.
    await teams(w, { action: 'draft' }).then((r) => soft(r.status, r.text).toBe(200));
    await teams(w, { action: 'publish' }).then((r) => soft(r.status, r.text).toBe(200));
    w.app.now = Date.parse('2026-12-02T00:44:00Z'); // 7:44 PM
    const g1 = (await adminTour(w)).day.games[0];
    const tooSoon = await (await phone(w, g1.a.players?.[0]?.name ?? (await adminTour(w)).day.teams.find((x: any) => x.seat === g1.a.seat).players[0].name)).call('POST', '/api/tournament/game', { tournamentId: w.tid, num: g1.num, action: 'score', mine: 11, theirs: 5 });
    log('score at 7:44 PM (start 8 PM)', `${tooSoon.status} ${tooSoon.text}`);
    soft(tooSoon.status, 'results open 15 min before the NEW start').toBe(409);
    const plan = (await adminTour(w)).day.plan;
    log('night plan for 10 in 90 minutes', plan);
    soft(booksBad(w)).toEqual({});
  });

  it('Plan Expect and Courts; green and red money', async () => {
    const w = await coldOpen();
    await lockedN(w, 6);
    const e1 = await planBox(w, 12, 2);
    soft(e1.status, e1.text).toBe(200);
    const t1 = await adminTour(w);
    log('Expect 12, 2 courts', { money: t1.money, expected: t1.expected, cost: t1.cost });
    soft(t1.money.youCents, '11 x $18 - $120 = +$78').toBe(7800);
    soft((await planBox(w, 5, 2)).status, 'below 6 refused').toBe(400);
    const below = await planBox(w, 6, 2);
    log('Expect 6 with 6 locked', `${below.status} ${below.text}`);
    const t2 = await adminTour(w);
    soft(t2.money.youCents, '5 x $18 - $120 = -$30 (red)').toBe(-3000);
    const one = await planBox(w, 6, 1);
    soft(one.status, one.text).toBe(200);
    soft((await adminTour(w)).money, '1 court: $60').toMatchObject({ courtCents: 6000, youCents: 3000 });
    soft((await planBox(w, 17, 2)).status, 'above 16 refused').toBe(400);
  });
});

describe('Part A 5: the drop-out money rule', () => {
  it('before Pay by credit; 10 to 9 credit; 9 to 8 credit; 8 to 7 kept; the spot retaken and paid gives it back once; after the cutoff refused', async () => {
    const w = await coldOpen();
    const names = await lockedN(w, 11, ['Lee']);
    const pots0 = allPots(w);
    // Before Pay by: 11 to 10, credit back.
    const b0 = await backOut(w, 'Kit', { backCents: 1800 });
    soft(b0.status, b0.text).toBe(200);
    log('before Pay by: Kit back out answer', b0.data);
    soft(pot(w, 'Kit') - pots0.Kit, 'Kit +$18').toBe(1800);
    // After Pay by.
    w.app.now = PAY_BY_MS + HOUR;
    soft((await adminTour(w)).format).toBe('doubles');
    const sheet = await card(w, 'Jules');
    log('Jules card after Pay by at 10 (dropKeeps?)', { dropKeeps: sheet.tickets?.dropKeeps });
    const b1 = await backOut(w, 'Jules', { backCents: 1800, keeps: false });
    soft(b1.status, b1.text).toBe(200);
    soft(b1.data.creditReturnedCents + b1.data.creditBackCents, '10 to 9: $18 back').toBe(1800);
    const fmt9 = (await adminTour(w)).format;
    log('format at 9 after the drop', fmt9);
    const s9 = await card(w, 'Indy');
    log('Indy card at 9 (dropKeeps?)', { dropKeeps: s9.tickets?.dropKeeps });
    const b2 = await backOut(w, 'Indy', { backCents: 1800, keeps: false });
    soft(b2.status, b2.text).toBe(200);
    soft(b2.data.creditReturnedCents + b2.data.creditBackCents, '9 to 8: $18 back').toBe(1800);
    const s8 = await card(w, 'Harper');
    log('Harper card at 8 (dropKeeps?)', { dropKeeps: s8.tickets?.dropKeeps });
    soft(s8.tickets?.dropKeeps, 'the two lines show at 8').toBe(true);
    // A stale sheet (keeps: false while the rule says keep) is refused.
    const stale = await backOut(w, 'Harper', { backCents: 1800, keeps: false });
    soft(stale.status, 'a stale sheet is refused').toBe(409);
    const harperPot = pot(w, 'Harper');
    const b3 = await backOut(w, 'Harper', { backCents: 1800, keeps: true });
    soft(b3.status, b3.text).toBe(200);
    log('8 to 7: Harper answer', b3.data);
    soft(b3.data.keptCents, 'kept $18').toBe(1800);
    soft(pot(w, 'Harper'), 'no credit back').toBe(harperPot);
    soft(signupStatus(w, 'Harper')).toBe('kept');
    log('format at 7', (await adminTour(w)).format);
    log('History: kept line', (await history(w)).filter((e) => /back_out|kept/.test(e.action)).map((e) => `${e.action} ${JSON.stringify(e.details)}`));
    // A second tap of Drop out (another phone) changes nothing.
    const again = await backOut(w, 'Harper', { backCents: 1800, keeps: true });
    soft(again.data?.result, 'second drop').toBe('not_signed_up');
    // Harper tries to sign up again and drop again to get the money: signs up, is back on her own paid spot.
    // (Left out here; covered by tests/zip70-time.test.ts.) The spot is retaken: Lee (on the list, never paid) pays by I paid, Alex confirms.
    const lp = await lock(w, 'Lee');
    log('Lee lock after Pay by', lp.data ?? lp.text);
    const pl = await iPaid(w, 'Lee', 1800);
    soft(pl.status, pl.text).toBe(200);
    soft(pot(w, 'Harper'), 'nothing back while the I paid waits').toBe(harperPot);
    const cf = await answer(w, 'Lee', 'confirm', 1800);
    soft(cf.status, cf.text).toBe(200);
    soft(pot(w, 'Harper') - harperPot, 'back once: +$18').toBe(1800);
    soft(signupStatus(w, 'Harper')).toBe('out');
    // A double confirm and more taps never pay twice.
    await answer(w, 'Lee', 'confirm', 1800);
    await lock(w, 'Lee');
    soft(pot(w, 'Harper') - harperPot, 'still +$18 once').toBe(1800);
    soft(booksBad(w), 'books after the release').toEqual({});
    // After the 3 hour cutoff: refused.
    w.app.now = CUTOFF_MS + MIN;
    const cut = await backOut(w, 'Gale', { backCents: 1800 });
    soft(cut.status, `after the cutoff: ${cut.text}`).toBe(409);
    log('after cutoff message', cut.data?.message);
    const m = moneyTotals(w);
    log('money at the end', m);
    void names;
  });

  it('8 to 7 kept, then Cancel gives it back once; Reschedule gives it back once', async () => {
    for (const how of ['cancel', 'reschedule'] as const) {
      const w = await coldOpen();
      await lockedN(w, 8);
      w.app.now = PAY_BY_MS + HOUR;
      const p0 = pot(w, 'Harper');
      const r = await backOut(w, 'Harper', { backCents: 1800, keeps: true });
      soft(r.data.keptCents, `${how}: kept`).toBe(1800);
      const act = await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/${how}`, {});
      soft(act.status, act.text).toBe(200);
      soft(pot(w, 'Harper') - p0, `${how}: Harper +$18 once`).toBe(1800);
      await w.organizer.call('POST', `/api/admin/tournament/${w.tid}/${how}`, {});
      soft(pot(w, 'Harper') - p0, `${how}: a second tap pays nothing more`).toBe(1800);
      // Every other paid player: Cancel gives $18 back; Reschedule keeps tickets.
      log(`${how}: Blair pot, Harper status, books`, { blair: pot(w, 'Blair'), harper: signupStatus(w, 'Harper'), books: booksBad(w) });
      soft(booksBad(w), `${how}: books`).toEqual({});
    }
  });
});

describe('Part A 6: edge cases', () => {
  it('missed date (I am in / Can not make it), late joiner, Only me, two phones, refresh mid-action', async () => {
    const w = await coldOpen();
    for (const x of ALL.slice(0, 8)) await signUp(w, x, [DATE]);
    await signUp(w, 'Jules', ['2026-12-08']);
    await signUp(w, 'Kit', ['2026-12-08']);
    await finalize(w);
    // Missed date: Jules I'm in (dates then lock), Kit Can't make it (back out).
    const j = await (await phone(w, 'Jules')).call('PUT', '/api/tournament/signup', { tournamentId: w.tid, dates: [DATE] });
    soft(j.status, j.text).toBe(200);
    soft((await lock(w, 'Jules')).data.dueCents, 'Jules owes $18').toBe(1800);
    const k = await backOut(w, 'Kit');
    soft(k.status, k.text).toBe(200);
    soft(signupStatus(w, 'Kit')).toBe('out');
    const at = await adminTour(w);
    log('organizer: not signed up row after the answers', at.notSignedUp);
    // Late joiner (Lee) after Finalize, before Pay by: signs up and pays.
    await signUp(w, 'Lee', [DATE]);
    await giveCredit(w, 'Lee', 1800);
    soft((await lock(w, 'Lee')).data.result).toBe('locked');
    // Late joiner after Pay by while a spot is open (16 cap).
    w.app.now = PAY_BY_MS + HOUR;
    await signUp(w, 'Lane', [DATE]);
    const ll = await lock(w, 'Lane');
    log('late joiner after Pay by: lock', ll.data ?? ll.text);
    // Two phones at once: two Lock taps and two I paid taps at the same moment.
    const [x1, x2] = await Promise.all([lock(w, 'Blair'), lock(w, 'Blair')]);
    log('two phones Lock', [x1.status, x1.data, x2.status, x2.data]);
    const [y1, y2] = await Promise.all([iPaid(w, 'Blair', 1800), iPaid(w, 'Blair', 1800)]);
    log('two phones I paid', [y1.status, y1.data, y2.status, y2.data]);
    soft(ticket(w, 'Blair')?.claim_cents, 'one claim').toBe(1800);
    const [z1, z2] = await Promise.all([answer(w, 'Blair', 'confirm', 1800), answer(w, 'Blair', 'confirm', 1800)]);
    log('two confirms at once', [z1.status, z2.status]);
    soft(ticket(w, 'Blair')?.paid_cents, 'paid once').toBe(1800);
    const [d1, d2] = await Promise.all([backOut(w, 'Casey'), backOut(w, 'Casey')]);
    log('two drops at once (Casey)', [d1.status, d1.data, d2.status, d2.data]);
    soft(booksBad(w), 'books').toEqual({});
    log('money', moneyTotals(w));
  });

  it('Only me: nobody but Alex sees it, through any player read', async () => {
    const w = await coldOpen({ visibility: 'me' });
    const g = await group(w, 'Blair');
    soft(g.tournament ?? null, 'Blair sees nothing').toBe(null);
    soft(JSON.stringify(g).includes('Cold Open'), 'no name anywhere in Blair\'s Home').toBe(false);
    const v = await (await phone(w, 'Blair')).call('GET', '/api/group/version');
    soft(JSON.stringify(v.data).includes('Cold Open')).toBe(false);
    const s = await (await phone(w, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: w.tid, level: 300, dates: [DATE] });
    soft(s.status, `Blair cannot sign up: ${s.text}`).not.toBe(200);
  });

  it('a phone with no name: no payment details, no tournament', async () => {
    const w = await coldOpen();
    await lockedN(w, 4);
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    const g = await anon.call('GET', '/api/group');
    const text = JSON.stringify(g.data);
    log('no-name /api/group keys', Object.keys(g.data));
    soft(/venmo\.com|zelle|"venmoUrl":"/i.test(text), 'no Venmo or Zelle').toBe(false);
    soft(text.includes('Cold Open'), 'no tournament').toBe(false);
  });
});
void START_MS;
