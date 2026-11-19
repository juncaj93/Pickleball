import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOUR, playerPhone, setupGroup } from './harness';
import { HEAT_RAMP, heatColors, heatStep, isBackSource, isOddSource, styleAtClose, styleBannerWords } from '../shared/tournament';
import { activityText } from '../shared/activity';

// Zip 64 (🎾64.finalize): Finalize's Plays (the real start and end in the existing columns), the style rules once tickets close (an odd count
// plays Americano; never back by itself; Switch back), "Tournament style TBD" until Pay by, late paying and late joining while a spot is open
// until 3 hours before the start, and who may see it. The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is
// Thu Nov 12; Finalize keeps the usual Pay by: Wed Nov 11, 7:00 PM (the night before).

const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z'); // Wed Nov 11, 7:00 PM EST
const START_MS = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM EST
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string>; sent: string[] };

async function world(opts: { signUp?: string[]; finalize?: Record<string, unknown> | false; visibility?: 'me' | 'all'; format?: string } = {}): Promise<Ctx> {
  const base = await setupGroup();
  const sent: string[] = [];
  Object.assign(base.app.env, { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42', SITE_URL: 'https://pickleball.juncaj.net' });
  (base.app.env as any).TELEGRAM_FETCH = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).text);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, visibility: opts.visibility ?? 'all', format: opts.format ?? 'vote' });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id, sent };
  for (const name of opts.signUp ?? []) await signUp(ctx, name);
  if (opts.finalize !== false && opts.signUp) {
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, ...(opts.finalize ?? {}) });
    expect(res.status, res.text).toBe(200);
  }
  return ctx;
}

async function signUp(ctx: Ctx, name: string, vote = 'locked') {
  const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE], formatVote: vote });
  expect(res.status, res.text).toBe(200);
}

/** Lock my spot with credit given first: locked in at once (money that counts). */
async function lockWithCredit(ctx: Ctx, name: string) {
  await ctx.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
  const seen = Number(
    (
      ctx.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
  const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1600, reason: 'Test credit', seen });
  expect(give.status, give.text).toBe(200);
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
}

const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const raw = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).text;
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const row = (ctx: Ctx) => ctx.app.db.raw.prepare('SELECT * FROM tournaments WHERE id = ?').get(ctx.tid) as Record<string, any>;
const historyOf = async (ctx: Ctx) => ((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown>; actorLabel: string }[]);

function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}

/** n players locked in with credit (the harness six first, then MORE). */
async function lockIn(ctx: Ctx, names: string[]) {
  for (const n of names) {
    const r = await lockWithCredit(ctx, n);
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
  }
}

const SIGNED = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'];

describe('the heat map ramp (mock 03)', () => {
  it('the ends are the mock colors, and the steps are even', () => {
    expect(heatColors(8, 1, 8).light.bg).toBe(HEAT_RAMP.light.bg[1]);
    expect(heatColors(1, 1, 8).light.bg).toBe(HEAT_RAMP.light.bg[0]);
    expect(heatColors(8, 1, 8).dark.bg).toBe(HEAT_RAMP.dark.bg[1]);
    expect(heatColors(1, 1, 8).dark.bg).toBe(HEAT_RAMP.dark.bg[0]);
    // The mock's middle tile (5 of 1..8) measured #7ee1af.
    const mid = heatColors(5, 1, 8).light.bg;
    for (const [i, want] of [0x7e, 0xe1, 0xaf].entries()) expect(Math.abs(parseInt(mid.slice(1 + i * 2, 3 + i * 2), 16) - want)).toBeLessThanOrEqual(1);
    expect(heatStep(3, 1, 5)).toBe(0.5);
    // All the same count: every tile the brightest (nothing to compare); nobody at all: the palest.
    expect(heatStep(4, 4, 4)).toBe(1);
    expect(heatStep(0, 0, 0)).toBe(0);
  });
});

describe('the style words and rule (shared)', () => {
  it('odd plays Americano; even keeps what is stored', () => {
    expect(styleAtClose('doubles', 9)).toBe('americano');
    expect(styleAtClose('doubles', 10)).toBe('doubles');
    expect(styleAtClose('americano', 10)).toBe('americano');
    expect(isOddSource('odd:2026-11-11T00:00:00.000Z')).toBe(true);
    expect(isBackSource('back:2026-11-11T00:00:00.000Z')).toBe(true);
    expect(styleBannerWords('odd:x')).toBe('Tournament style is now Americano.');
    expect(styleBannerWords('back:x')).toBe('Tournament style is back to Locked doubles.');
    expect(styleBannerWords('vote')).toBeNull();
  });
});

describe('Finalize: Plays and Pay by on one screen (mock 04)', () => {
  it('the screen starts on 7:30 PM to 10:00 PM and the usual Pay by; no plan line, no price row', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'], finalize: false });
    const v = (await ctx.organizer.call('GET', `/api/admin/tournament/${ctx.tid}/finalize?date=${DATE}`)).data;
    expect(v.start).toBe(19 * 60 + 30);
    expect(v.minutes).toBe(150);
    expect(v.payBy).toBe(new Date(PAY_BY_MS).toISOString());
    expect(v.players).toEqual(['Blair', 'Casey']);
  });
  it('Finalize saves the real start and length in the existing columns; the card drops the "~"; the price stays', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'], finalize: { start: 19 * 60, minutes: 180 } });
    const r = row(ctx);
    expect([r.start_minutes, r.minutes, r.ticket_cents]).toEqual([19 * 60, 180, 1600]);
    const c = await card(ctx, 'Blair');
    expect(c.startSet).toBe(true);
    expect(c.start).toBe(19 * 60);
    expect(c.minutes).toBe(180);
    const d = await dash(ctx);
    expect([d.start, d.minutes, d.startSet]).toEqual([19 * 60, 180, true]);
    // The History line names the times.
    const opened = (await historyOf(ctx)).find((e) => e.action === 'tournament_tickets_opened')!;
    expect(activityText(opened as never, 'America/Detroit', 'Alex')).toMatch(/plays 7 to 10 PM/);
  });
  it('a bad Plays is refused and nothing is locked', async () => {
    const ctx = await world({ signUp: ['Blair'], finalize: false });
    for (const bad of [{ start: 19 * 60, minutes: 30 }, { start: 23 * 60, minutes: 120 }, { start: 19 * 60 + 7, minutes: 150 }, { start: '7', minutes: 150 }]) {
      const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, ...bad });
      expect(res.status).toBe(400);
    }
    expect(row(ctx).final_date).toBeNull();
  });
  it('the 3-hour cutoff follows the real start (Plays 8:00 PM: tickets close at 5:00 PM, not 4:30)', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'], finalize: { start: 20 * 60, minutes: 120 } });
    ctx.app.now = Date.parse('2026-11-12T21:45:00.000Z'); // Thu 4:45 PM
    expect((await card(ctx, 'Casey')).tickets.closed).toBe(false);
    ctx.app.now = Date.parse('2026-11-12T22:00:00.000Z'); // Thu 5:00 PM
    expect((await card(ctx, 'Casey')).tickets.closed).toBe(true);
    const res = await lockWithCredit(ctx, 'Casey');
    expect(res.status).toBe(409);
    expect(res.data.message).toBe('Tickets are closed.');
  });
});

describe('Tournament style TBD until tickets close', () => {
  it('after Finalize the card says TBD (no vote question any more); at Pay by the style shows', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon', 'Emery'] });
    const before = await card(ctx, 'Blair');
    expect(before.styleTbd).toBe(true);
    expect(before.formatTbd).toBeUndefined();
    // The date alert claims only a real vote majority (all four voted Locked doubles).
    expect(before.formatAlert.sub).toBe('Most players voted Locked doubles.');
    await lockIn(ctx, ['Blair', 'Casey', 'Devon', 'Emery']);
    ctx.app.now = PAY_BY_MS;
    const after = await card(ctx, 'Blair');
    expect(after.styleTbd).toBeUndefined();
    expect(after.format).toBe('doubles');
    expect(after.styleNote).toBeUndefined();
    books(ctx);
  });
  it("Alex's own pick says TBD in the alert too (no vote claim)", async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'], finalize: { format: 'americano' } });
    const c = await card(ctx, 'Casey');
    expect(c.styleTbd).toBe(true);
    expect(c.formatAlert.sub).toBe('Tournament style TBD');
  });
});

describe('the style rules once tickets close (b to e)', () => {
  it('an ODD number at Pay by plays Americano: one switch, one History line, one Telegram alert, the card and the banner', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 5) });
    await lockIn(ctx, SIGNED.slice(0, 5));
    ctx.app.now = PAY_BY_MS + HOUR;
    ctx.sent.length = 0;
    // Two screens read it at the same moment: one switch.
    const [a, b] = await Promise.all([dash(ctx), card(ctx, 'Blair')]);
    await ctx.app.settle();
    expect(a.format).toBe('americano');
    expect(b.format).toBe('americano');
    expect(a.oddSwitch).toBeTruthy();
    expect(a.switchBack).toBeNull();
    expect(isOddSource(row(ctx).format_source)).toBe(true);
    await dash(ctx);
    await ctx.app.settle();
    expect(ctx.sent).toEqual(['The Cold Open switched to Americano (odd number of players). 5 are locked in.']);
    const lines = (await historyOf(ctx)).filter((e) => e.action === 'tournament_format' && e.details.how === 'odd');
    expect(lines).toHaveLength(1);
    expect(activityText(lines[0] as never, 'America/Detroit', 'Alex')).toBe('The Cold Open switched to Americano (5 locked in, an odd number)');
    expect((await card(ctx, 'Casey')).styleNote.text).toBe('Tournament style is now Americano.');
    books(ctx);
  });
  it('an EVEN number keeps the vote winner; Alex’s pick of Americano stays Americano', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 4) });
    await lockIn(ctx, SIGNED.slice(0, 4));
    ctx.app.now = PAY_BY_MS + 1;
    expect((await dash(ctx)).format).toBe('doubles');
    const pick = await world({ signUp: SIGNED.slice(0, 4), finalize: { format: 'americano' } });
    await lockIn(pick, SIGNED.slice(0, 4));
    pick.app.now = PAY_BY_MS + 1;
    expect((await dash(pick)).format).toBe('americano');
    expect((await card(pick, 'Blair')).styleNote).toBeUndefined();
  });
  it('a back out after close makes it odd: Americano; a late join makes it even: Switch back? (never by itself), then Switch', async () => {
    const ctx = await world({ signUp: [...SIGNED.slice(0, 6), 'Harper'] });
    await lockIn(ctx, SIGNED.slice(0, 6));
    ctx.app.now = PAY_BY_MS + HOUR;
    expect((await dash(ctx)).format).toBe('doubles');
    // Devon backs out: 5.
    const t = await card(ctx, 'Devon');
    const out = await (await playerPhone(ctx, 'Devon')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: t.tickets.mine.creditCents });
    expect(out.status, out.text).toBe(200);
    expect((await dash(ctx)).format).toBe('americano');
    // Harper (on the list, never paid) pays late while a spot is open: 6 again.
    const late = await lockWithCredit(ctx, 'Harper');
    expect(late.status, late.text).toBe(200);
    expect(late.data.result).toBe('locked');
    const d = await dash(ctx);
    expect(d.format).toBe('americano');
    expect(d.lockedIn).toBe(6);
    expect(d.switchBack).toBeTruthy();
    expect(d.oddSwitch).toBeNull();
    // Reading again changes nothing (never by itself).
    expect((await dash(ctx)).format).toBe('americano');
    const sw = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
    expect(sw.status, sw.text).toBe(200);
    expect((await dash(ctx)).format).toBe('doubles');
    expect((await card(ctx, 'Blair')).styleNote.text).toBe('Tournament style is back to Locked doubles.');
    // A second tap changes nothing.
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {})).data.changed).toBe(false);
    books(ctx);
  });
  it('the Switch back card only after an odd switch (an Americano pick never asks)', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 4), finalize: { format: 'americano' } });
    await lockIn(ctx, SIGNED.slice(0, 4));
    ctx.app.now = PAY_BY_MS + 1;
    const d = await dash(ctx);
    expect(d.switchBack).toBeNull();
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {})).data.changed).toBe(false);
  });
  it('Switch back is refused while the count is odd', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 5) });
    await lockIn(ctx, SIGNED.slice(0, 5));
    ctx.app.now = PAY_BY_MS + 1;
    await dash(ctx);
    const sw = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
    expect(sw.status).toBe(409);
    expect(sw.data.message).toBe('Locked doubles needs an even number. 5 are locked in.');
  });
});

describe('the style can change until the tournament starts (Finalize or Edit)', () => {
  const edit = (ctx: Ctx, format: string) =>
    ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, format, secondCreditCents: 700 });
  it('Edit changes it while players hold tickets (the old format lock is gone); the price still stays', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 2) });
    await lockIn(ctx, SIGNED.slice(0, 2));
    const res = await edit(ctx, 'americano');
    expect(res.status, res.text).toBe(200);
    expect(row(ctx).format).toBe('americano');
    // Auto after the date: back to the vote's winner (both voted Locked doubles).
    expect((await edit(ctx, 'vote')).status).toBe(200);
    expect([row(ctx).format, row(ctx).format_source]).toEqual(['doubles', 'vote']);
    const price = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, ticketCents: 2000, format: 'vote' });
    expect(price.status).toBe(409);
  });
  it('after close, Locked doubles with an odd number is refused; from the night start nothing changes', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 5), finalize: { format: 'americano' } });
    await lockIn(ctx, SIGNED.slice(0, 5));
    ctx.app.now = PAY_BY_MS + 1;
    const odd = await edit(ctx, 'doubles');
    expect(odd.status).toBe(409);
    expect(odd.data.message).toBe('Locked doubles needs an even number. 5 are locked in.');
    ctx.app.now = START_MS;
    const late = await edit(ctx, 'doubles');
    expect(late.status).toBe(409);
    expect(late.data.message).toBe('The tournament has started. The style stays.');
  });
});

describe('late paying and late joining (6f, 7)', () => {
  it('after Pay by an unpaid player on the list can still lock while a spot is open, until 3 hours before the start', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon'] });
    await lockIn(ctx, ['Blair', 'Casey']);
    ctx.app.now = PAY_BY_MS + HOUR;
    const c = await card(ctx, 'Devon');
    expect(c.tickets.closed).toBe(false);
    const r = await lockWithCredit(ctx, 'Devon');
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
    books(ctx);
  });
  it('a brand-new player (not on the list when the date was picked) can sign up and pay late, before the 3-hour cutoff', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    ctx.app.now = PAY_BY_MS + HOUR;
    await signUp(ctx, 'Gale');
    const r = await lockWithCredit(ctx, 'Gale');
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
    // 3 hours before the 7:30 PM start: closed, politely.
    ctx.app.now = START_MS - 3 * HOUR;
    await signUp(ctx, 'Harper');
    const no = await lockWithCredit(ctx, 'Harper');
    expect(no.status).toBe(409);
    expect(no.data.message).toBe('Tickets are closed.');
    expect((await card(ctx, 'Harper')).tickets.closed).toBe(true);
    books(ctx);
  });
  it('with every spot taken after Pay by: "Tickets are closed." and no money moves', async () => {
    const all = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
    const ctx = await world({ signUp: all });
    await lockIn(ctx, all.slice(0, 16));
    ctx.app.now = PAY_BY_MS + HOUR;
    const last = all[16];
    expect((await card(ctx, last)).tickets.closed).toBe(true);
    const before = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as { n: number };
    const res = await (await playerPhone(ctx, last)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    expect(res.status).toBe(409);
    expect(res.data.message).toBe('Tickets are closed.');
    expect((ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as { n: number }).n).toBe(before.n);
    // Standby does not open after Pay by either.
    expect((await (await playerPhone(ctx, last)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).status).toBe(409);
    books(ctx);
  });
});

describe('review fixes', () => {
  it('after Pay by an I paid still waiting for Alex counts as a taken spot: no 17th promise ("Tickets are closed.")', async () => {
    const all = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
    const ctx = await world({ signUp: all });
    await lockIn(ctx, all.slice(0, 15));
    // The 16th: Lock with no credit, then I paid (waits for Alex; players see it as locked in).
    const p16 = await playerPhone(ctx, all[15]);
    expect((await p16.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 })).data.result).toBe('due');
    expect((await p16.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 })).status).toBe(200);
    ctx.app.now = PAY_BY_MS + HOUR;
    const last = all[16];
    expect((await card(ctx, last)).tickets.closed).toBe(true);
    const res = await lockWithCredit(ctx, last);
    expect(res.status).toBe(409);
    expect(res.data.message).toBe('Tickets are closed.');
    books(ctx);
  });
  it('once the night starts the style shown is the stored one (no switch by a count change after the start)', async () => {
    const ctx = await world({ signUp: SIGNED.slice(0, 4) });
    await lockIn(ctx, SIGNED.slice(0, 4));
    // Nobody read it between Pay by and the start: still Locked doubles with an even count; then the night starts.
    ctx.app.now = START_MS + 60_000;
    expect((await dash(ctx)).format).toBe('doubles');
    expect((await card(ctx, 'Blair')).format).toBe('doubles');
    expect((await dash(ctx)).formatLocked).toBe(true);
  });
});

describe('who may see it', () => {
  it('Only me: another player gets no tournament data at all, even after the style switches', async () => {
    const ctx = await world({ signUp: [], visibility: 'me' });
    expect(row(ctx).final_date).toBe(DATE);
    ctx.app.now = PAY_BY_MS + HOUR;
    await dash(ctx);
    const text = await raw(ctx, 'Blair');
    expect(JSON.parse(text).tournament).toBeUndefined();
    expect(text).not.toMatch(/Cold Open|styleNote|styleTbd|startSet/);
  });
  it('switch off: no tournament data and the organizer routes refuse', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const text = await raw(ctx, 'Blair');
    expect(text).not.toMatch(/Cold Open|tournament/);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {})).status).toBe(403);
    expect((await ctx.organizer.call('GET', `/api/admin/tournament/${ctx.tid}/finalize?date=${DATE}`)).status).toBe(403);
  });
});
