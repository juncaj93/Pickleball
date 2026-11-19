import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, playerPhone, setupGroup } from './harness';
import { payByShort, payCountdown, tournamentRemindText } from '../shared/tournamentTickets';
import { MAX_SPOTS, plannedSize, planFit, smartPlan } from '../shared/tournament';
import { activityText } from '../shared/activity';

// Zip 63 (🎾63.tickets): the gold-ball card's data, the hidden cap of 16 and Standby, the pay countdown's words at every moment, and the
// organizer's Remind all unpaid text. The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is Thu Nov 12; picking
// it sets Pay by to Wed Nov 11, 7:00 PM (the night before).

const TZ = 'America/Detroit';
const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
// The harness's six (Alex, Blair, Casey, Devon, Emery, Frankie) and these: 18 players besides the organizer, enough to fill 16 spots and go to standby.
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const PAY_BY = '2026-11-12T00:00:00.000Z'; // Wed Nov 11, 7:00 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string };

async function world(opts: { signUp?: string[]; noDate?: boolean; visibility?: 'me' | 'all' } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, visibility: opts.visibility ?? 'all' });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, players, tid: created.data.id };
  for (const name of opts.signUp ?? []) await signUp(ctx, name);
  if (!opts.noDate && opts.signUp) {
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
    expect(res.status, res.text).toBe(200);
  }
  return ctx;
}

async function signUp(ctx: Ctx, name: string, dates = [DATE]) {
  const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates });
  expect(res.status, res.text).toBe(200);
}

/** Lock my spot with credit given first: locked in at once (money that counts). */
async function lockWithCredit(ctx: Ctx, name: string) {
  const adj = await ctx.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
  expect(adj.status).toBe(200);
  const seen = Number((ctx.app.db.raw.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`).get(ctx.byName[name]) as { c: number }).c);
  const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen });
  expect(give.status, give.text).toBe(200);
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
}

const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const raw = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).text;

function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const row = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(row)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}

describe('the pay countdown words (mocks 08 to 13)', () => {
  const at = (iso: string) => Date.parse(iso);
  it('nothing until 3 days before Pay by (Eastern calendar days)', () => {
    expect(payCountdown(PAY_BY, at('2026-11-07T17:00:00.000Z'), TZ, 'The Cold Open')).toBeNull(); // Sat Nov 7: 4 days
    expect(payCountdown(PAY_BY, at('2026-10-26T16:00:00.000Z'), TZ, 'The Cold Open')).toBeNull();
  });
  it('3 days, 2 days and tomorrow: amber, with the Pay by time', () => {
    const three = payCountdown(PAY_BY, at('2026-11-08T05:30:00.000Z'), TZ, 'The Cold Open')!; // Sun Nov 8, 12:30 AM
    expect(three).toMatchObject({ tone: 'amber', icon: 'owe', title: '3 days left to pay', late: false });
    expect(three.sub.replace(/\s/g, ' ')).toBe('Pay by Wed 7:00 PM');
    expect(payCountdown(PAY_BY, at('2026-11-10T04:59:00.000Z'), TZ, 'The Cold Open')!.title).toBe('2 days left to pay'); // Mon 11:59 PM
    const one = payCountdown(PAY_BY, at('2026-11-10T15:00:00.000Z'), TZ, 'The Cold Open')!; // Tue 10 AM
    expect(one).toMatchObject({ tone: 'amber', title: 'Payment due tomorrow' });
    expect(one.sub.replace(/\s/g, ' ')).toBe('Pay by 7:00 PM');
  });
  it('the day: Payment due today, then Due in 5 hours, then minutes (red)', () => {
    const today = payCountdown(PAY_BY, at('2026-11-11T14:00:00.000Z'), TZ, 'The Cold Open')!; // Wed 9 AM: 10 hours left
    expect(today).toMatchObject({ tone: 'red', icon: 'clock', title: 'Payment due today' });
    expect(today.sub.replace(/\s/g, ' ')).toBe('Pay by 7:00 PM tonight');
    expect(payCountdown(PAY_BY, PAY_BY_MS - 6 * HOUR, TZ, 'X')!.title).toBe('Payment due today');
    expect(payCountdown(PAY_BY, PAY_BY_MS - 6 * HOUR + 1000, TZ, 'X')!.title).toBe('Due in 5 hours');
    expect(payCountdown(PAY_BY, PAY_BY_MS - 5 * HOUR - 20 * 60_000, TZ, 'X')!.title).toBe('Due in 5 hours');
    expect(payCountdown(PAY_BY, PAY_BY_MS - HOUR - 1, TZ, 'X')!.title).toBe('Due in 1 hour');
    expect(payCountdown(PAY_BY, PAY_BY_MS - 42 * 60_000 - 30_000, TZ, 'X')!.title).toBe('Due in 42 minutes');
    expect(payCountdown(PAY_BY, PAY_BY_MS - 20_000, TZ, 'X')!.title).toBe('Due in 1 minute');
    // A Pay by in the afternoon says "today", not "tonight".
    expect(payCountdown('2026-11-11T20:00:00.000Z', at('2026-11-11T14:00:00.000Z'), TZ, 'X')!.sub.replace(/\s/g, ' ')).toBe('Pay by 3:00 PM today');
  });
  it('after Pay by: Your payment is late, with the real name', () => {
    expect(payCountdown(PAY_BY, PAY_BY_MS, TZ, 'The Cold Open')).toEqual({ tone: 'red', icon: 'stop', title: 'Your payment is late', sub: 'Pay now to stay in The Cold Open', late: true });
  });
  it('a bad Pay by gives no card', () => {
    expect(payCountdown('nope', 0, TZ, 'X')).toBeNull();
  });
});
const PAY_BY_MS = Date.parse(PAY_BY);

describe('Remind all unpaid text (mock 14)', () => {
  const link = 'pickleball.juncaj.net';
  it('the night before: tonight and tomorrow, ending with the plain address', () => {
    expect(tournamentRemindText('The Cold Open', PAY_BY, DATE, Date.parse('2026-11-11T15:00:00.000Z'), TZ, link)).toBe(
      'Hey, please pay for The Cold Open tonight so the courts are locked in for tomorrow. pickleball.juncaj.net',
    );
  });
  it('earlier days follow the clock', () => {
    expect(tournamentRemindText('The Cold Open', PAY_BY, DATE, Date.parse('2026-11-10T15:00:00.000Z'), TZ, link)).toBe(
      'Hey, please pay for The Cold Open by tomorrow night so the courts are locked in for Thursday. pickleball.juncaj.net',
    );
    expect(tournamentRemindText('The Cold Open', PAY_BY, DATE, Date.parse('2026-11-08T15:00:00.000Z'), TZ, link)).toBe(
      'Hey, please pay for The Cold Open by Wednesday so the courts are locked in for Thursday. pickleball.juncaj.net',
    );
    expect(tournamentRemindText('The Cold Open', PAY_BY, DATE, Date.parse('2026-11-01T15:00:00.000Z'), TZ, link)).toMatch(/by Wednesday so the courts are locked in for Thu, Nov 12\. /);
    // Pay by on the day itself (4:00 PM): "today" and "tonight".
    expect(tournamentRemindText('The Cold Open', '2026-11-12T21:00:00.000Z', DATE, Date.parse('2026-11-12T14:00:00.000Z'), TZ, link)).toBe(
      'Hey, please pay for The Cold Open today so the courts are locked in tonight. pickleball.juncaj.net',
    );
  });
  it('no em dashes in any of it', () => {
    expect(tournamentRemindText('A', PAY_BY, DATE, 0, TZ, link)).not.toContain('—');
    expect(JSON.stringify(payCountdown(PAY_BY, PAY_BY_MS - HOUR * 3, TZ, 'A'))).not.toContain('—');
  });
});

describe('the hidden cap of 16 (was 12)', () => {
  it('the shared numbers: 16 spots, the planned size grows to 16, the court plan stays the 12 one', () => {
    expect(MAX_SPOTS).toBe(16);
    expect([0, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(plannedSize)).toEqual([6, 6, 8, 12, 12, 14, 14, 16, 16, 16, 16, 16]);
    expect(smartPlan(14)).toEqual({ size: 16, courts: 2, minutes: 180, start: 19 * 60 });
    expect(smartPlan(10)).toEqual({ size: 12, courts: 2, minutes: 180, start: 19 * 60 });
    expect(planFit(18)).toEqual({ fits: 16, over: 2 });
    expect(planFit(16)).toEqual({ fits: 16, over: 0 });
    expect(payByShort(PAY_BY, TZ)).toBe('11/11');
  });

  it('the migration swaps both triggers for 16 and nothing else', () => {
    const sql = readFileSync(join(process.cwd(), 'migrations/0026_tournament_cap_16.sql'), 'utf8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code.match(/>= 16/g)).toHaveLength(2);
    expect(code).not.toMatch(/>= 12/);
    expect(code).not.toMatch(/ALTER TABLE|CREATE TABLE|DELETE FROM|UPDATE tournament_tickets SET|INSERT INTO/i);
  });

  it('16 lock in, the 17th sees Join standby and joins it; the database refuses a 17th spot whatever writes it', async () => {
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
    const ctx = await world({ signUp: names });
    for (const n of names.slice(0, 16)) {
      const r = await lockWithCredit(ctx, n);
      expect(r.status, `${n}: ${r.text}`).toBe(200);
      expect(r.data.result).toBe('locked');
    }
    books(ctx);
    const rory = await card(ctx, 'Rory');
    expect(rory.tickets).toMatchObject({ full: true, size: 16 });
    expect(rory.tickets.locked).toHaveLength(16);
    // A lock that races the last spot: the hidden cap's own words (no number, no waitlist).
    const late = await lockWithCredit(ctx, 'Shay');
    expect(late.status).toBe(409);
    expect(late.data.message).toBe('Every spot just filled. Join standby.');
    expect((await (await playerPhone(ctx, 'Rory')).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).data.result).toBe('waitlist');
    expect((await card(ctx, 'Rory')).tickets.line).toEqual([{ name: 'Rory', me: true }]);
    // The trigger: a 17th spot written straight into the table.
    const rid = ctx.byName.Rory;
    expect(() => ctx.app.db.raw.prepare("UPDATE tournament_tickets SET place = 'spot', credit_cents = 1600 WHERE tournament_id = ? AND player_id = ?").run(ctx.tid, rid)).toThrow(/tournament_full/);
    // History says standby.
    // History (the organizer's screen draws each line with activityText): the standby join reads "joined standby".
    const entries = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string }[];
    const join = entries.find((e) => e.action === 'tournament_waitlist')!;
    expect(activityText(join as never, TZ, 'Alex')).toMatch(/Rory joined standby for The Cold Open$/);
  }, 60_000);

  it('the History words say standby', () => {
    const line = (action: string, details: Record<string, unknown>) => activityText({ action, details, actorLabel: 'Vic', createdAt: '2026-10-26T16:00:00.000Z' } as never, TZ, 'Alex');
    expect(line('tournament_waitlist', { tournament: 'The Cold Open', player: 'Vic' })).toMatch(/joined standby for The Cold Open$/);
    expect(line('tournament_ticket', { tournament: 'The Cold Open', player: 'Vic', result: 'held' })).toMatch(/paid to hold a standby spot for The Cold Open$/);
  });
});

describe('the card data (mocks 00 to 07)', () => {
  it('before a date: no going list (one ball per sign-up); after: who can make it, names only, their own row marked', async () => {
    const ctx = await world({ noDate: true, signUp: [] });
    await signUp(ctx, 'Blair', [DATE]);
    await signUp(ctx, 'Casey', ['2026-11-03']);
    await signUp(ctx, 'Devon', [DATE, '2026-11-17']);
    let c = await card(ctx, 'Emery');
    expect(c.names).toEqual(['Blair', 'Casey', 'Devon']);
    expect(c.going).toBeUndefined();
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    c = await card(ctx, 'Emery');
    expect(c.going).toEqual([{ name: 'Blair' }, { name: 'Devon' }]);
    expect((await card(ctx, 'Devon')).going).toEqual([{ name: 'Blair' }, { name: 'Devon', me: true }]);
    // Never who: nothing about Casey's dates or anyone's money in the answer.
    const text = JSON.stringify(c);
    expect(text).not.toContain('2026-11-03');
    expect(text).not.toMatch(/creditCents":\d+,"paidCents":\d+,"claimCents":\d+,"owedCents":\d+.*creditCents/);
  });

  it('gold follows the locked-in count, in the order people pay (the card is not tied to anyone)', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon', 'Emery'] });
    expect((await card(ctx, 'Devon')).tickets.locked).toEqual([]);
    await lockWithCredit(ctx, 'Emery');
    await lockWithCredit(ctx, 'Blair');
    const c = await card(ctx, 'Devon');
    expect(c.tickets.locked.map((x: { name: string }) => x.name)).toEqual(['Emery', 'Blair']);
    expect(c.going.map((g: { name: string }) => g.name)).toEqual(['Blair', 'Casey', 'Devon', 'Emery']);
    books(ctx);
  });

  it('round 2, the trust rule: an I paid counts as locked in on every player screen at once, in the order people paid; spots and money do not move until Alex answers', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon', 'Emery'] });
    await lockWithCredit(ctx, 'Emery');
    ctx.app.advance(60_000);
    // Casey: Lock my spot with no credit (the Pay sheet), then I paid for the whole $16.
    const casey = await playerPhone(ctx, 'Casey');
    expect((await casey.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 })).data.result).toBe('due');
    expect((await casey.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 })).data.result).toBe('waiting');
    ctx.app.advance(60_000);
    await lockWithCredit(ctx, 'Blair');
    // Every player sees Emery, Casey (I paid), Blair as locked in; nobody sees a "waiting" or anyone's money.
    for (const who of ['Devon', 'Casey']) {
      const c = await card(ctx, who);
      expect(c.tickets.locked.map((x: { name: string }) => x.name)).toEqual(['Emery', 'Casey', 'Blair']);
    }
    expect((await card(ctx, 'Casey')).tickets.locked[1]).toEqual({ name: 'Casey', me: true });
    // The money and the spot are exactly as before: Casey's I paid waits for Alex, no spot yet, the plan counts 2 spots.
    const t = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
    expect(t.tickets.find((k: { name: string }) => k.name === 'Casey')).toMatchObject({ place: 'none', claimCents: 1600, paidCents: 0 });
    expect(t.tickets.filter((k: { place: string }) => k.place === 'spot').map((k: { name: string }) => k.name)).toEqual(['Emery', 'Blair']);
    expect(t.size).toBe(6);
    books(ctx);
    // Alex undoes it (Didn't pay): Casey is no longer locked in on any screen.
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Casey, action: 'reject' })).status).toBe(200);
    expect((await card(ctx, 'Devon')).tickets.locked.map((x: { name: string }) => x.name)).toEqual(['Emery', 'Blair']);
    books(ctx);
  });
});

describe('who can see it: a player who may not see the tournament gets nothing at all', () => {
  it('Only me: another player and a phone with no name get no tournament key, no count, no Pay by', async () => {
    const ctx = await world({ visibility: 'me', signUp: [], noDate: true });
    for (const n of ['Blair', 'Casey']) {
      const text = await raw(ctx, n);
      expect(text).not.toContain('"tournament"');
      expect(text).not.toContain('The Cold Open');
      expect(text).not.toContain('going');
      expect(text).not.toContain('payBy');
    }
    expect((await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] })).status).toBe(404);
  });

  it('the switch off: no tournament data for anyone, the Pay by countdown included', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    expect((await card(ctx, 'Blair')).tickets.payBy).toBe(PAY_BY);
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const text = await raw(ctx, 'Blair');
    expect(text).not.toContain('"tournament"');
    expect(text).not.toContain('payBy');
    expect(text).not.toContain('going');
  });
});

describe('the preview test page: the countdown stages', () => {
  it('each stage puts Pay by where its words say, the tournament the day after; late has a freed spot, closed has none', async () => {
    const ctx = await world();
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of ['Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn', 'Zoe', 'Reese', 'Vic']) ctx.byName[n] = (await ctx.organizer.call('POST', '/api/admin/players', { name: n })).data.id;
    const words: Record<string, string | null> = {
      pay_3d: '3 days left to pay',
      pay_2d: '2 days left to pay',
      pay_1d: 'Payment due tomorrow',
      pay_today: 'Payment due today',
      pay_hours: 'Due in 5 hours',
      pay_minutes: 'Due in 42 minutes',
      pay_late: 'Your payment is late',
    };
    for (const [stage, title] of Object.entries(words)) {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage });
      expect(r.status, r.text).toBe(200);
      const vic = await card(ctx, 'Vic');
      expect(vic.status).toBe('tickets');
      expect(vic.tickets.mine).toBeNull();
      expect(vic.tickets.closed, stage).toBe(false);
      expect(payCountdown(vic.tickets.payBy, ctx.app.now, TZ, vic.name)?.title, stage).toBe(title);
      if (stage === 'pay_late') expect(vic.tickets.freed).toBe(1);
      books(ctx);
    }
    expect((await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'pay_closed' })).status).toBe(200);
    const closed = await card(ctx, 'Vic');
    // Zip 64 (late paying): after Pay by with spots open the late payer can still pay: not closed.
    expect(closed.tickets).toMatchObject({ closed: false, freed: 0 });
  }, 60_000);
});

void DAY;
