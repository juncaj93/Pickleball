import { describe, expect, it } from 'vitest';
import { DAY, PIN, playerPhone, setupGroup, withoutIds } from './harness';
import { routeList } from '../server/app';
import { LEVELS, PLANS, planLine, planRange, planTitle, prizeLine, levelLabel, levelShort, dayLong, stubParts, monthSpan, monthsBetween, isDayKey, cleanDays } from '../shared/tournament';
import { testDates } from '../server/tournamentTest';

// Zip 55, Tournaments piece 1 (server/tournament.ts): Create, the player's sign-up, Edit sign-up, back out, the level list, pick the date, the
// switch, and the Only me rule: while Only me is on, a normal player's phone gets NOTHING about the tournament from the server.
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts).

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17'];
const BASE = { name: 'Winter Classic', dates: DATES, size: 8, courts: 2, minutes: 120, start: 1170, ticketCents: 1600, creditCents: 1400, visibility: 'me' };

async function world(opts: { on?: boolean } = {}) {
  const ctx = await setupGroup();
  // The organizer's own player is Alex (the first name), as on the preview.
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  if (opts.on !== false) expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  return ctx;
}

async function create(ctx: Ctx, extra: Record<string, unknown> = {}) {
  const res = await ctx.organizer.call('POST', '/api/admin/tournament', { ...BASE, ...extra });
  expect(res.status, res.text).toBe(200);
  return res.data.id as string;
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const group = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;

/** The organizer's own phone: signed in as the organizer AND the organizer's own name picked on the player page. */
async function organizerPhone(ctx: Ctx) {
  const c = ctx.organizer;
  c.groupKey = ctx.groupKey;
  expect((await c.call('POST', '/api/me', { playerId: ctx.byName.Alex })).status).toBe(200);
  return c;
}

describe('the shared rules (words from the pictures)', () => {
  it('levels copied word for word from mock 05, 3.6+ shown as 3.6 on the level list', () => {
    expect(LEVELS.map((l) => l.label)).toEqual(['2.5', '2.75', '3.0', '3.2', '3.4', '3.5', '3.6+']);
    expect(LEVELS[0].text).toBe('Learning the rules and serve. Short rallies.');
    expect(LEVELS[6].text).toBe('Dinks and drop shots are reliable. Smart about speed. Almost no easy misses.');
    expect(levelLabel(360)).toBe('3.6+');
    expect(levelShort(360)).toBe('3.6');
    expect(levelShort(300)).toBe('3.0');
  });

  it('court plans per player count (mocks 01, 02, 03), best first, times as the pictures write them', () => {
    expect(PLANS[6].map(planTitle)).toEqual(['1 court · 2.5 hours', '1 court · 2 hours']);
    expect(PLANS[8].map(planTitle)).toEqual(['2 courts · 2 hours', '2 courts · 2.5 hours', '1 court · 3 hours']);
    expect(PLANS[10].map(planTitle)).toEqual(['2 courts · 2.5 hours', '2 courts · 2 hours']);
    expect(PLANS[12].map(planTitle)).toEqual(['2 courts · 3 hours', '2 courts · 2 hours']);
    expect(planRange(1170, 150)).toBe('7:30 to 10 PM');
    expect(planRange(1200, 120)).toBe('8 to 10 PM');
    expect(planRange(1170, 120)).toBe('7:30 to 9:30 PM');
    expect(planRange(1140, 180)).toBe('7 to 10 PM');
    expect(planLine(PLANS[8][0])).toBe('7:30 to 9:30 PM. Everyone plays every round. Room to run over, then awards.');
    expect(planLine(PLANS[6][0])).toBe('7:30 to 10 PM. Every team plays twice, then the top 2 play the final. With 3 teams, someone always plays back to back.');
    for (const size of [6, 8, 10, 12] as const) expect(PLANS[size].filter((p) => p.best)).toHaveLength(1);
  });

  it('prize line, dates and the stub', () => {
    expect(prizeLine(1400)).toBe('Winners each get a medal and a $14 game credit.');
    expect(prizeLine(0)).toBe('Winners each get a medal.');
    expect(dayLong('2026-12-17')).toBe('Thu, Dec 17');
    expect(stubParts('2026-12-17')).toEqual({ weekday: 'THU', day: '17', month: 'DEC' });
    expect(monthSpan(['2027-01-07', '2026-12-03'])).toBe('DEC–JAN');
    expect(monthSpan(['2026-12-03', '2026-12-30'])).toBe('DEC');
    const months = monthsBetween('2026-12-03', '2027-01-14');
    expect(months.map((m) => [m.year, m.month, m.lead, m.days.length])).toEqual([
      [2026, 12, 2, 31],
      [2027, 1, 5, 31],
    ]);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(cleanDays(['2026-12-04', '2026-12-03', '2026-12-04'])).toEqual(['2026-12-03', '2026-12-04']);
    expect(cleanDays(['2026-12-04', 'soon'])).toBeNull();
  });
});

describe('the switch', () => {
  it('ships OFF: no tournament data anywhere, the routes refuse, nothing is written', async () => {
    const ctx = await world({ on: false });
    const d = await dash(ctx);
    expect(d.tournaments).toBeUndefined();
    expect(d.tournament).toBeUndefined();
    expect(d.tournamentsForAll).toBeUndefined();
    const res = await ctx.organizer.call('POST', '/api/admin/tournament', BASE);
    expect(res.status).toBe(403);
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournaments').get()).toEqual({ n: 0 });
    expect((await group(ctx, 'Blair')).tournament).toBeUndefined();
  });

  it('the private link (X-Tournaments: on) turns it on for that phone only; the kill switch beats everything', async () => {
    const ctx = await world({ on: false });
    const link = { 'X-Tournaments': 'on' };
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, link)).data.tournaments).toBe(true);
    expect((await dash(ctx)).tournaments).toBeUndefined();
    ctx.app.env.TOURNAMENTS = 'off';
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, link)).data.tournaments).toBeUndefined();
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true });
    expect((await dash(ctx)).tournaments).toBeUndefined();
    expect((await dash(ctx)).tournamentsForAll).toBe(true);
  });

  it('the Settings row on and off writes one History line each', async () => {
    const ctx = await world();
    expect((await dash(ctx)).tournamentsForAll).toBe(true);
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    expect((await dash(ctx)).tournamentsForAll).toBeUndefined();
    const acts = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => e.action);
    expect(acts).toContain('tournaments_on');
    expect(acts).toContain('tournaments_off');
  });
});

describe('Create tournament', () => {
  it('stores every setting; the organizer sees it; one open at a time', async () => {
    const ctx = await world();
    const id = await create(ctx);
    const t = (await dash(ctx)).tournament;
    // Alex: no players expected or court plan any more. The organizer sees the smart plan for nobody locked in (6 players, 1 court, 2.5 hours,
    // 7:30 PM); the NOT NULL columns hold harmless defaults (the 12-spot cap and the 7:00 to 10:00 PM night).
    expect(t).toMatchObject({ id, name: 'Winter Classic', status: 'signup', visibility: 'me', size: 6, courts: 1, minutes: 150, start: 1170, ticketCents: 1600, championCreditCents: 1400, offeredDates: DATES, finalDate: null, signups: [] });
    expect(ctx.app.db.raw.prepare('SELECT size, courts, minutes, start_minutes FROM tournaments WHERE id = ?').get(id)).toEqual({ size: 12, courts: 2, minutes: 180, start_minutes: 1140 });
    const again = await ctx.organizer.call('POST', '/api/admin/tournament', BASE);
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('tournament_open');
  });

  it('refuses bad input with plain words', async () => {
    const ctx = await world();
    const bad = async (extra: Record<string, unknown>) => (await ctx.organizer.call('POST', '/api/admin/tournament', { ...BASE, ...extra })).data;
    expect((await bad({ name: '  ' })).message).toBe('Type a name.');
    expect((await bad({ name: 'x'.repeat(33) })).message).toBe('Keep the name to 32 letters.');
    expect((await bad({ dates: [] })).message).toBe('Pick at least one date.');
    expect((await bad({ dates: ['2026-10-20'] })).message).toBe('Pick dates from today on.');
    expect((await bad({ ticketCents: -1 })).error).toBe('invalid_ticket');
    expect((await bad({ creditCents: 20_001 })).error).toBe('invalid_credit');
    expect((await bad({ visibility: 'some' })).error).toBe('invalid_visibility');
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournaments').get()).toEqual({ n: 0 });
  });

  it('with Booking hours on for everyone the 2.5 and 3 hour plans are allowed; $0 credit is allowed', async () => {
    const ctx = await world();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const id = await create(ctx, { size: 6, courts: 1, minutes: 150, start: 1170, creditCents: 0 });
    expect((await dash(ctx)).tournament).toMatchObject({ id, size: 6, minutes: 150, championCreditCents: 0 });
  });
});

describe('ONLY ME: a normal player gets zero tournament data from the server', () => {
  it('Only me: players get no tournament key, no name, no count; the stamp is the same as with none; every player route says not open', async () => {
    const ctx = await world();
    const blair = await playerPhone(ctx, 'Blair');
    const before = (await blair.call('GET', '/api/group')).text;
    const stampBefore = (await blair.call('GET', '/api/group/version')).data.v;
    const id = await create(ctx, { name: 'Secret Cup' });
    const res = await blair.call('GET', '/api/group');
    expect(res.data.tournament).toBeUndefined();
    expect(res.text).not.toContain('Secret Cup');
    expect(res.text).not.toContain(id);
    expect(res.text.toLowerCase()).not.toContain('tournament');
    // The whole answer is byte for byte what it was before the tournament existed (bar the clock-free parts, which do not move).
    expect(withoutIds(res.text)).toBe(withoutIds(before));
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(stampBefore);
    for (const [method, path, body] of [
      ['POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] }],
      ['PUT', '/api/tournament/signup', { tournamentId: id, level: 300 }],
      ['POST', '/api/tournament/back-out', { tournamentId: id }],
    ] as const) {
      const r = await blair.call(method, path, body);
      expect(r.status, path).toBe(404);
      expect(r.text).not.toContain('Secret Cup');
    }
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_signups').get()).toEqual({ n: 0 });
  });

  it('a phone that only PICKED the organizer name (not signed in as the organizer) gets nothing either', async () => {
    const ctx = await world();
    await create(ctx);
    expect((await group(ctx, 'Alex')).tournament).toBeUndefined();
  });

  it("the organizer's own signed-in phone sees the card and the Only me strip; View as a player shows nothing, View as Alex shows it", async () => {
    const ctx = await world();
    const id = await create(ctx);
    const own = await organizerPhone(ctx);
    const mine = (await own.call('GET', '/api/group')).data.tournament;
    expect(mine).toMatchObject({ id, name: 'Winter Classic', status: 'signup', onlyMe: true, names: [], me: null, openDates: DATES, start: 1170 });
    const asBlair = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair })).data;
    expect(asBlair.tournament).toBeUndefined();
    const asAlex = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Alex })).data;
    expect(asAlex.tournament).toMatchObject({ id, onlyMe: true });
  });

  it('a read-only PIN helper on the player page gets nothing while Only me', async () => {
    const ctx = await world();
    await create(ctx);
    ctx.app.env.ORGANIZER_READONLY_PIN = '58302917';
    const helper = ctx.app.client();
    helper.groupKey = ctx.groupKey;
    expect((await helper.call('POST', '/api/admin/login', { pin: '58302917' })).status).toBe(200);
    await helper.call('POST', '/api/me', { playerId: ctx.byName.Alex });
    expect((await helper.call('GET', '/api/group')).data.tournament).toBeUndefined();
  });

  it('Everyone: every player sees it; back to Only me: gone again, and their stamp changes both times', async () => {
    const ctx = await world();
    const id = await create(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    const s0 = (await blair.call('GET', '/api/group/version')).data.v;
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/visibility`, { visibility: 'all' })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament).toMatchObject({ id, name: 'Winter Classic' });
    const s1 = (await blair.call('GET', '/api/group/version')).data.v;
    expect(s1).not.toBe(s0);
    expect((await blair.call('GET', '/api/group')).data.tournament.onlyMe).toBeUndefined();
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/visibility`, { visibility: 'me' });
    expect((await blair.call('GET', '/api/group')).data.tournament).toBeUndefined();
    expect((await blair.call('GET', '/api/group/version')).data.v).toBe(s0);
  });
});

describe('sign up, Edit sign-up, back out', () => {
  async function open(ctx: Ctx) {
    const id = await create(ctx, { visibility: 'all' });
    return id;
  }

  it('sign up (level, then dates): on the list; names only to everyone, your own pick only to you', async () => {
    const ctx = await world();
    const id = await open(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    const r = await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 340, dates: [DATES[1], DATES[0]] });
    expect(r.status, r.text).toBe(200);
    await (await playerPhone(ctx, 'Casey')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 275, dates: [DATES[0]] });
    const b = (await blair.call('GET', '/api/group')).data.tournament;
    expect(b.me).toEqual({ level: 340, dates: [DATES[0], DATES[1]] });
    expect(b.names).toEqual(['Blair', 'Casey']);
    const devon = (await group(ctx, 'Devon')).tournament;
    expect(devon.me).toBeNull();
    expect(devon.names).toEqual(['Blair', 'Casey']);
    // Never anyone's level to another player. (The random id is left out of the look: it can hold those digits by chance.)
    const seen = JSON.stringify({ ...devon, id: undefined });
    expect(seen).not.toContain('340');
    expect(seen).not.toContain('275');
    const t = (await dash(ctx)).tournament;
    expect(t.signups.map((s: any) => [s.name, s.pickedLevel, s.level, s.reviewed])).toEqual([
      ['Blair', 340, 340, false],
      ['Casey', 275, 275, false],
    ]);
  });

  it('refuses a level not on the list, no dates, or a date that is not offered', async () => {
    const ctx = await world();
    const id = await open(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 333, dates: [DATES[0]] })).data.message).toBe('Pick your level.');
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [] })).data.message).toBe('Pick at least one date.');
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: ['2026-11-04'] })).status).toBe(409);
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: 'nope', level: 300, dates: [DATES[0]] })).status).toBe(409);
  });

  it('Edit sign-up changes the dates only (Alex: a level is picked once); back out takes them off; signing up again keeps the FIRST level, at the end', async () => {
    const ctx = await world();
    const id = await open(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    const casey = await playerPhone(ctx, 'Casey');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 320, dates: [DATES[0]] });
    ctx.app.advance(60_000);
    await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[1]] });
    ctx.app.advance(60_000);
    // A level sent with the edit (an older screen) is ignored: only the dates change.
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 340, dates: [DATES[2], DATES[3]] })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 320, dates: [DATES[2], DATES[3]] });
    // Back out: off the list for everyone.
    ctx.app.advance(60_000);
    expect((await blair.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('backed_out');
    expect((await casey.call('GET', '/api/group')).data.tournament.names).toEqual(['Casey']);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toBeNull();
    expect((await dash(ctx)).tournament.backedOut.map((b: any) => b.name)).toEqual(['Blair']);
    // A second back out changes nothing.
    expect((await blair.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('not_signed_up');
    // Edit after backing out is refused.
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, dates: [DATES[0]] })).status).toBe(409);
    // Off the list, their card knows the level they picked first (Sign up skips the level step).
    expect((await blair.call('GET', '/api/group')).data.tournament.lockedLevel).toBe(320);
    // Sign up again: at the end of the list, with the FIRST level, whatever this tap sends (the loophole is closed).
    ctx.app.advance(60_000);
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 340, dates: [DATES[0]] });
    expect((await casey.call('GET', '/api/group')).data.tournament.names).toEqual(['Casey', 'Blair']);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 320, dates: [DATES[0]] });
    const history = ctx.app.db.raw.prepare("SELECT level, set_by FROM tournament_level_history WHERE player_id = ? ORDER BY created_at").all(ctx.byName.Blair);
    expect(history).toEqual([{ level: 320, set_by: 'player' }]);
    const lines = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: any) => e.action);
    expect(lines.filter((a: string) => a.startsWith('tournament_'))).toEqual(expect.arrayContaining(['tournament_signup', 'tournament_signup_edited', 'tournament_back_out', 'tournament_created']));
  });

  it('View as on the live server never writes (demo only)', async () => {
    const ctx = await world();
    const id = await open(ctx);
    const r = await ctx.organizer.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] }, { 'X-View-As': ctx.byName.Blair });
    expect(r.status).toBe(403);
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_signups').get()).toEqual({ n: 0 });
  });
});

describe('the level list and picking the date', () => {
  it("the organizer changes a level: the list shows the pick and the organizer's level; the player still sees only their own pick", async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const sage = await playerPhone(ctx, 'Casey');
    await sage.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Casey, level: 340 });
    expect(r.status, r.text).toBe(200);
    expect((await dash(ctx)).tournament.signups[0]).toMatchObject({ name: 'Casey', pickedLevel: 300, level: 340, reviewed: true });
    expect((await sage.call('GET', '/api/group')).data.tournament.me.level).toBe(300);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Devon, level: 340 })).status).toBe(409);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Casey, level: 310 })).status).toBe(400);
    const lines = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(lines.find((e: any) => e.action === 'tournament_level').details).toMatchObject({ player: 'Casey', level: '3.4', tournament: 'Winter Classic' });
  });

  it('pick the date: tickets open at once (Alex); sign-up then only offers that date; Edit changes dates only; the date stays (Reschedule moves it)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[2]] });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: '2026-11-04' })).status).toBe(400);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[2] })).status).toBe(200);
    const b = (await blair.call('GET', '/api/group')).data.tournament;
    // Tickets are open: Pay by is the night before at 7:00 PM (Mon Nov 9 for Tue Nov 10; Zip 59); 6 spots while nobody is locked in.
    expect(b).toMatchObject({ status: 'tickets', finalDate: DATES[2], openDates: [DATES[2]] });
    expect(b.tickets).toMatchObject({ size: 6, full: false, priceCents: 1600, payBy: '2026-11-10T00:00:00.000Z', locked: [], mine: null });
    // A new sign-up after the date is picked: only the picked date can be picked.
    const casey = await playerPhone(ctx, 'Casey');
    expect((await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 275, dates: [DATES[0]] })).status).toBe(409);
    expect((await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 275, dates: [DATES[2]] })).status).toBe(200);
    // Edit after the date is picked: the dates only (just the picked one); back out still works.
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, dates: [DATES[2]] })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 300, dates: [DATES[2]] });
    expect((await casey.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('backed_out');
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'tickets', finalDate: DATES[2] });
    expect((await dash(ctx)).tournament.signups.map((s: any) => s.name)).toEqual(['Blair']);
    // The date stays once tickets are open: Cancel or reschedule moves it.
    const back = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: null });
    expect(back.status).toBe(409);
    expect(back.data.message).toBe('Tickets are open. Reschedule to change the date.');
  });

  it('Edit settings: a date taken off comes off the picks; the picked date cannot be taken off; cancel ends it for everyone', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[1]] });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', name: 'Holiday Cup', dates: DATES.slice(1) })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament).toMatchObject({ name: 'Holiday Cup', me: { dates: [DATES[1]] } });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[1] });
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(2) });
    expect(r.status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${id}/cancel`, {})).status).toBe(200);
    // Zip 56: canceled after its date was picked, it shows a plain Canceled card (Blair was on the list; nothing was paid, so nothing comes back).
    expect((await blair.call('GET', '/api/group')).data.tournament).toMatchObject({ status: 'canceled', canceled: { backCents: 0, claimCents: 0 } });
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'canceled', name: 'Holiday Cup' });
    // A player who was not on the list sees nothing.
    expect((await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data.tournament).toBeUndefined();
    // A new one can be made (and is what both screens show); the old list stays in the database with its levels.
    await create(ctx, { name: 'Spring Fling' });
    expect((await dash(ctx)).tournament).toMatchObject({ name: 'Spring Fling', status: 'signup' });
    expect(ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM tournament_signups WHERE tournament_id = ?").get(id)).toEqual({ n: 1 });
  });

  it('a player removed by the organizer (deleted) cannot block anything: their sign-up goes with them', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const extra = (await ctx.organizer.call('POST', '/api/admin/players', { name: 'Gale' })).data.id;
    ctx.byName.Gale = extra;
    await (await playerPhone(ctx, 'Gale')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    const del = await ctx.organizer.call('DELETE', `/api/admin/players/${extra}`);
    expect(del.status, del.text).toBe(200);
    expect((await dash(ctx)).tournament.signups).toEqual([]);
  });
});

describe('preview test page server half', () => {
  it('answers Not found unless PREVIEW_CALM is on (only previews have it; live never does)', async () => {
    const ctx = await world();
    expect((await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'signup' })).status).toBe(404);
    expect(routeList().some((r) => r.path === '/api/admin/tournament-test')).toBe(true);
  });

  it('builds each stage from the names that exist, Everyone, and resets cleanly', async () => {
    const ctx = await world();
    ctx.app.env.PREVIEW_CALM = 'on';
    // The stage buttons also turn the Settings row on (a re-seed from another branch drops it).
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    for (const n of ['Parker', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Zoe', 'Reese', 'Vic']) ctx.byName[n] = (await ctx.organizer.call('POST', '/api/admin/players', { name: n })).data.id;
    const a = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'signup' });
    expect(a.status, a.text).toBe(200);
    expect((await dash(ctx)).tournamentsForAll).toBe(true);
    expect((await dash(ctx)).tournamentTest).toBe(true);
    // Switched off: no test page either (the dashboard is then exactly main's, preview or not).
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    expect((await dash(ctx)).tournamentTest).toBeUndefined();
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true });
    let t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ name: 'Winter Classic', status: 'signup', visibility: 'all', size: 6 });
    expect(t.signups.map((s: any) => s.name)).toEqual(['Parker', 'Rowan', 'Sage', 'Wren', 'Quinn']);
    const b = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'date_picked' });
    t = (await dash(ctx)).tournament;
    // Alex: picking the date opens tickets.
    expect(t.status).toBe('tickets');
    expect(t.finalDate).toBe(b.data.date);
    expect(t.signups).toHaveLength(7);
    expect(t.signups.every((s: any) => s.dates.includes(t.finalDate))).toBe(true);
    expect(t.signups.find((s: any) => s.name === 'Sage')).toMatchObject({ pickedLevel: 300, level: 340, reviewed: true });
    expect((await group(ctx, 'Vic')).tournament).toMatchObject({ status: 'tickets', me: null });
    // Americano at each stage (pass 3): its own name, the format, the 2nd place credit.
    for (const stage of ['signup', 'date_picked']) {
      expect((await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage, format: 'americano' })).status).toBe(200);
      const status = stage === 'date_picked' ? 'tickets' : stage;
      expect((await dash(ctx)).tournament).toMatchObject({ name: 'Winter Americano', format: 'americano', status, championCreditCents: 1400, secondCreditCents: 700 });
      expect((await group(ctx, 'Vic')).tournament).toMatchObject({ format: 'americano', status });
    }
    expect((await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'signup', format: 'singles' })).status).toBe(400);
    await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'none' });
    expect((await dash(ctx)).tournament).toBeUndefined();
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_signups').get()).toEqual({ n: 0 });
  });

  it('test dates: Tuesday to Friday of next month and the first two weeks after, no holidays', () => {
    const d = testDates('2026-11-17');
    expect(d[0]).toBe('2026-12-01');
    expect(d).not.toContain('2026-12-24');
    expect(d).not.toContain('2026-12-25');
    expect(d).not.toContain('2026-12-31');
    expect(d).not.toContain('2027-01-01');
    expect(d[d.length - 1] <= '2027-01-14').toBe(true);
    expect(d.length).toBeGreaterThan(20);
  });
});

describe('a later day', () => {
  it('a date offered at Create that is now in the past can stay on an Edit', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    ctx.app.advance(10 * DAY); // Thu Nov 5: Nov 3 and Nov 5 ... Nov 3 is past now
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all' });
    expect(r.status, r.text).toBe(200);
    const added = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: [...DATES, '2026-11-02'] });
    expect(added.status).toBe(400);
  });
});

describe('review fixes (fresh reviewer, Zip 55)', () => {
  it('a day that has passed is no longer a choice: players cannot pick it, the organizer cannot make it the date', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    ctx.app.advance(9 * DAY + 4 * 3_600_000); // Thu Nov 5, 4 PM Eastern: Nov 3 has passed, Nov 5 is today
    const blair = await playerPhone(ctx, 'Blair');
    const t = (await blair.call('GET', '/api/group')).data.tournament;
    expect(t.openDates).toEqual(DATES.slice(1));
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] })).status).toBe(409);
    const past = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[0] });
    expect(past.status).toBe(400);
    expect(past.data.message).toBe('That date has passed. Pick another one.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[1] })).status).toBe(200);
  });

  it("Alex: a level is picked once. Edit ignores a level; signing up again keeps the first one and the organizer's level", async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Blair, level: 340 });
    const row = async () => (await dash(ctx)).tournament.signups.find((s: any) => s.name === 'Blair');
    expect(await row()).toMatchObject({ pickedLevel: 300, level: 340, reviewed: true });
    // Dates only: the organizer's level stays.
    await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, dates: [DATES[0], DATES[1]] });
    expect(await row()).toMatchObject({ pickedLevel: 300, level: 340, reviewed: true });
    // A level sent with an edit is ignored: still the first pick, still the organizer's level.
    await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320 });
    expect(await row()).toMatchObject({ pickedLevel: 300, level: 340, reviewed: true });
    // Back out and sign up again with another level: the FIRST pick stays, and so does the organizer's level. Only the organizer changes it.
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Blair, level: 350 });
    await blair.call('POST', '/api/tournament/back-out', { tournamentId: id });
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 250, dates: [DATES[0]] });
    expect(await row()).toMatchObject({ pickedLevel: 300, level: 350, reviewed: true });
    await blair.call('POST', '/api/tournament/back-out', { tournamentId: id });
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 360, dates: [DATES[0]] });
    expect(await row()).toMatchObject({ pickedLevel: 300, level: 350, reviewed: true });
    // The level history: the one pick, and the organizer's two.
    const h = ctx.app.db.raw.prepare('SELECT level, set_by FROM tournament_level_history WHERE player_id = ? ORDER BY rowid').all(ctx.byName.Blair);
    expect(h).toEqual([
      { level: 300, set_by: 'player' },
      { level: 340, set_by: 'organizer' },
      { level: 350, set_by: 'organizer' },
    ]);
  });

  it('after the date is picked, an edit without dates keeps the dates they had (nobody has to tick a date they cannot make)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[1]] });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[3] });
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320 })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 300, dates: [DATES[0], DATES[1]] });
  });

  it('a second Sign up tap with the same answers writes nothing and one History line in all', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    for (let i = 0; i < 2; i++) expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] })).status).toBe(200);
    const lines = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.filter((e: any) => e.action.startsWith('tournament_sign'));
    expect(lines.map((e: any) => e.action)).toEqual(['tournament_signup']);
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_level_history').get()).toEqual({ n: 1 });
  });

  it('Alex: Create and Edit no longer ask for players expected or a court plan; one sent by an older screen is ignored, never stored', async () => {
    const ctx = await world();
    const id = await create(ctx, { size: 7, courts: 3, minutes: 150, start: 900 });
    const renamed = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, size: 10, courts: 2, minutes: 150, start: 1170, name: 'Renamed Cup' });
    expect(renamed.status, renamed.text).toBe(200);
    expect(ctx.app.db.raw.prepare('SELECT name, size, courts, minutes, start_minutes FROM tournaments WHERE id = ?').get(id)).toEqual({ name: 'Renamed Cup', size: 12, courts: 2, minutes: 180, start_minutes: 1140 });
  });

  it('a save that lands just after a Cancel changes nothing (the canceled tournament never comes back)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    // Every write from here: the Cancel lands right before the date pick's own statement runs (the race the reviewer described).
    const inner = ctx.app.env.DB;
    ctx.app.env.DB = {
      ...inner,
      prepare(sql: string) {
        if (/SET status = 'tickets', final_date/.test(sql)) ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'canceled' WHERE id = ?").run(id);
        return inner.prepare(sql);
      },
      batch: (st: any) => inner.batch(st),
    } as any;
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[1] });
    ctx.app.env.DB = inner;
    expect(r.status).toBe(409);
    expect(ctx.app.db.raw.prepare('SELECT status, final_date FROM tournaments WHERE id = ?').get(id)).toEqual({ status: 'canceled', final_date: null });
  });

  it('Edit settings that takes a date off says in History how many players lost a picked date', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(1) });
    const line = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'tournament_edited');
    expect(line.details).toMatchObject({ tournament: 'Winter Classic', trimmed: 1 });
  });

  it('ONLY ME costs a player exactly the database trips of "no tournament" (nothing to time)', async () => {
    const { countingDb } = await import('../dev/countingDb');
    const ctx = await world();
    const blair = await playerPhone(ctx, 'Blair');
    const inner = ctx.app.env.DB;
    const trips = async (method: string, path: string, body?: unknown) => {
      const c = { trips: 0, statements: 0, sql: [] as string[] };
      ctx.app.env.DB = countingDb(inner, c);
      await blair.call(method, path, body);
      ctx.app.env.DB = inner;
      return c.trips;
    };
    const measure = async () => [await trips('GET', '/api/group'), await trips('GET', '/api/group/version'), await trips('POST', '/api/tournament/back-out', {})];
    await trips('GET', '/api/group'); // warm: upkeep once
    const none = await measure();
    await create(ctx, { visibility: 'me' });
    const onlyMe = await measure();
    expect(onlyMe).toEqual(none);
  });

  it('the same with the organizer saved by id (not by name), and the organizer still sees it on their own signed-in phone', async () => {
    const { countingDb } = await import('../dev/countingDb');
    const ctx = await world();
    ctx.app.db.raw.prepare('UPDATE groups SET organizer_player_id = ?').run(ctx.byName.Alex);
    const blair = await playerPhone(ctx, 'Blair');
    const inner = ctx.app.env.DB;
    const trips = async (method: string, path: string, body?: unknown) => {
      const c = { trips: 0, statements: 0, sql: [] as string[] };
      ctx.app.env.DB = countingDb(inner, c);
      await blair.call(method, path, body);
      ctx.app.env.DB = inner;
      return c.trips;
    };
    const measure = async () => [await trips('GET', '/api/group'), await trips('GET', '/api/group/version'), await trips('POST', '/api/tournament/back-out', {})];
    await trips('GET', '/api/group');
    const none = await measure();
    await create(ctx, { visibility: 'me' });
    expect(await measure()).toEqual(none);
    expect((await blair.call('GET', '/api/group')).data.tournament).toBeUndefined();
    expect((await (await organizerPhone(ctx)).call('GET', '/api/group')).data.tournament).toMatchObject({ name: 'Winter Classic', onlyMe: true });
  });
});

describe('second review fixes (Zip 55)', () => {
  /** Runs `between` (plain SQL, as another phone's tap) right before the first statement matching `sql` is prepared: the race, on purpose. */
  function raceAt(ctx: Ctx, sql: RegExp, between: () => void) {
    const inner = ctx.app.env.DB;
    let done = false;
    ctx.app.env.DB = {
      ...inner,
      prepare(text: string) {
        if (!done && sql.test(text)) {
          done = true;
          between();
        }
        return inner.prepare(text);
      },
      batch: (st: any) => inner.batch(st),
    } as any;
    return () => {
      ctx.app.env.DB = inner;
    };
  }
  const row = (ctx: Ctx, id: string) => ctx.app.db.raw.prepare('SELECT status, final_date, offered_dates FROM tournaments WHERE id = ?').get(id) as any;
  const datesOf = (ctx: Ctx, name: string) => JSON.parse((ctx.app.db.raw.prepare('SELECT dates FROM tournament_signups WHERE player_id = ?').get(ctx.byName[name]) as any).dates);

  for (const how of ['by name (no saved id)', 'saved id of a removed player'] as const) {
    it(`ONLY ME: a phone that merely picked the organizer's name costs the trips of "none open" too (${how})`, async () => {
      const { countingDb } = await import('../dev/countingDb');
      const ctx = await world();
      if (how !== 'by name (no saved id)') ctx.app.db.raw.prepare("UPDATE groups SET organizer_player_id = 'gone-player'").run();
      const fake = await playerPhone(ctx, 'Alex'); // no organizer cookie
      const inner = ctx.app.env.DB;
      const trips = async (method: string, path: string, body?: unknown) => {
        const c = { trips: 0, statements: 0, sql: [] as string[] };
        ctx.app.env.DB = countingDb(inner, c);
        await fake.call(method, path, body);
        ctx.app.env.DB = inner;
        return c.trips;
      };
      const measure = async () => [await trips('GET', '/api/group'), await trips('GET', '/api/group/version'), await trips('POST', '/api/tournament/back-out', {})];
      await trips('GET', '/api/group');
      const none = await measure();
      await create(ctx, { visibility: 'me' });
      expect(await measure()).toEqual(none);
      expect((await fake.call('GET', '/api/group')).data.tournament).toBeUndefined();
      // The organizer's own signed-in phone still sees it.
      expect((await (await organizerPhone(ctx)).call('GET', '/api/group')).data.tournament).toMatchObject({ onlyMe: true });
    });
  }

  it('Edit settings that takes off a date picked a moment earlier (on another phone) changes nothing: "look again"', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[3], DATES[4]] });
    const undo = raceAt(ctx, /UPDATE tournaments SET name/, () =>
      ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ? WHERE id = ?").run(DATES[4], id),
    );
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(0, 4) });
    undo();
    expect(r.status).toBe(409);
    expect(row(ctx, id)).toMatchObject({ status: 'date_picked', final_date: DATES[4], offered_dates: JSON.stringify(DATES) });
    expect(datesOf(ctx, 'Blair')).toEqual([DATES[3], DATES[4]]);
  });

  it('a date pick that lands just after Edit settings took that date off changes nothing: "look again"', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const undo = raceAt(ctx, /SET status = 'tickets', final_date/, () =>
      ctx.app.db.raw.prepare('UPDATE tournaments SET offered_dates = ? WHERE id = ?').run(JSON.stringify(DATES.slice(0, 4)), id),
    );
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[4] });
    undo();
    expect(r.status).toBe(409);
    expect(row(ctx, id)).toMatchObject({ status: 'signup', final_date: null });
  });

  it("Edit settings trims each player's dates as they are when it lands: a player's edit in between is kept", async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[4]] });
    await (await playerPhone(ctx, 'Casey')).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[1]] });
    const undo = raceAt(ctx, /UPDATE tournaments SET name/, () =>
      ctx.app.db.raw.prepare('UPDATE tournament_signups SET dates = ? WHERE player_id = ?').run(JSON.stringify([DATES[2], DATES[4]]), ctx.byName.Blair),
    );
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(0, 4) })).status).toBe(200);
    undo();
    expect(datesOf(ctx, 'Blair')).toEqual([DATES[2]]);
    expect(datesOf(ctx, 'Casey')).toEqual([DATES[1]]); // untouched
  });

  it('a player whose last date is taken off keeps an empty list (still on the list, can pick again)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[4]] });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(0, 4) });
    expect(datesOf(ctx, 'Blair')).toEqual([]);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 300, dates: [] });
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, dates: [DATES[1]] })).status).toBe(200);
  });

  it('History counts only players still on the level list (a hidden player is left out)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    for (const n of ['Blair', 'Casey']) await (await playerPhone(ctx, n)).call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    ctx.app.db.raw.prepare('UPDATE players SET is_active = 0 WHERE id = ?').run(ctx.byName.Casey);
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: DATES.slice(1) });
    const line = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'tournament_edited');
    expect(line.details).toMatchObject({ trimmed: 1 });
  });

  it('once the picked date has passed, nobody can sign up for it (the card stays, with nothing to pick)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[1] });
    ctx.app.advance(12 * DAY); // Nov 6 or later (Eastern): Nov 5 has passed
    const blair = await playerPhone(ctx, 'Blair');
    const t = (await blair.call('GET', '/api/group')).data.tournament;
    expect(t).toMatchObject({ status: 'tickets', finalDate: DATES[1], openDates: [] });
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[1]] })).status).toBe(409);
  });

  it('once every offered date has passed with none picked: hidden from players, the date pick refuses, Edit settings with new dates shows it again', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    ctx.app.advance(30 * DAY); // past Nov 17
    await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN }); // a month later: signed in again
    const blair = await playerPhone(ctx, 'Blair');
    // Hidden from players (the same as none open): no card, and the player routes say "not open".
    expect((await blair.call('GET', '/api/group')).data.tournament).toBeUndefined();
    expect((await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[4]] })).status).toBe(404);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament).toMatchObject({ id, status: 'signup' });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[4] })).status).toBe(400);
    const later = ['2026-12-08', '2026-12-10'];
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', dates: later });
    expect(r.status, r.text).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.openDates).toEqual(later);
  });

  it('a sign-up that lands just after the date is picked (its dates read before) changes nothing: "look again"', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    const undo = raceAt(ctx, /INSERT INTO tournament_signups/, () =>
      ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ? WHERE id = ?").run(DATES[1], id),
    );
    const r = await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    undo();
    expect(r.status).toBe(409);
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_signups').get()).toEqual({ n: 0 });
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_level_history').get()).toEqual({ n: 0 });
  });

  it('an Edit sign-up that lands just after Cancel changes nothing', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0]] });
    const undo = raceAt(ctx, /UPDATE tournament_signups SET dates/, () => ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'canceled' WHERE id = ?").run(id));
    const r = await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, dates: [DATES[1]] });
    undo();
    expect(r.status).toBe(409);
    expect(ctx.app.db.raw.prepare('SELECT picked_level, dates FROM tournament_signups').get()).toEqual({ picked_level: 300, dates: JSON.stringify([DATES[0]]) });
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_level_history').get()).toEqual({ n: 1 });
  });
});

describe('format: Doubles or Americano (Alex, before shipping)', () => {
  it('Create defaults to Doubles; the format and the 2nd place credit are stored, sent to both screens, and editable', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    expect((await dash(ctx)).tournament).toMatchObject({ format: 'doubles', formatLocked: false, secondCreditCents: 0 });
    expect((await group(ctx, 'Blair')).tournament.format).toBe('doubles');
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', format: 'americano', creditCents: 1400, secondCreditCents: 700 });
    expect(r.status, r.text).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ format: 'americano', championCreditCents: 1400, secondCreditCents: 700 });
    expect((await group(ctx, 'Blair')).tournament.format).toBe('americano');
    // Both credits can be $0.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', format: 'americano', creditCents: 0, secondCreditCents: 0 })).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ championCreditCents: 0, secondCreditCents: 0 });
    // Back to Doubles before the date is picked; once it is picked tickets are open (Alex), so the format stays.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', format: 'doubles' })).status).toBe(200);
    expect((await dash(ctx)).tournament.format).toBe('doubles');
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[2] });
    const locked = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, visibility: 'all', format: 'americano' });
    expect(locked.status).toBe(409);
    expect(locked.data.message).toBe('Tickets are open. The format cannot change now.');
  });

  it('an Edit that leaves out the format and the 2nd place credit keeps them (it never turns an Americano back into Locked doubles)', async () => {
    const ctx = await world();
    const id = await create(ctx, { format: 'americano', secondCreditCents: 700 });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, name: 'Renamed' })).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ name: 'Renamed', format: 'americano', secondCreditCents: 700 });
  });

  it('Create an Americano; a bad format or a negative 2nd place credit is refused', async () => {
    const ctx = await world();
    expect((await ctx.organizer.call('POST', '/api/admin/tournament', { ...BASE, format: 'singles' })).status).toBe(400);
    expect((await ctx.organizer.call('POST', '/api/admin/tournament', { ...BASE, format: 'americano', secondCreditCents: -100 })).status).toBe(400);
    await create(ctx, { format: 'americano', secondCreditCents: 700 });
    expect((await dash(ctx)).tournament).toMatchObject({ format: 'americano', secondCreditCents: 700, visibility: 'me' });
    expect(ctx.app.db.raw.prepare('SELECT format, second_credit_cents FROM tournaments').get()).toEqual({ format: 'americano', second_credit_cents: 700 });
  });

  it('the database refuses any other format, and an old row reads as Doubles with no 2nd place credit', async () => {
    const ctx = await world();
    const id = await create(ctx);
    expect(() => ctx.app.db.raw.prepare("UPDATE tournaments SET format = 'singles' WHERE id = ?").run(id)).toThrow();
    expect(ctx.app.db.raw.prepare('SELECT format, second_credit_cents FROM tournaments WHERE id = ?').get(id)).toEqual({ format: 'doubles', second_credit_cents: 0 });
  });

  it('the format locks once tickets open (piece 2); piece 1 stages never lock it; the steps follow the format', async () => {
    const { formatLocked, stepsFor, formatName, formatRule } = await import('../shared/tournament');
    expect(formatLocked('signup')).toBe(false);
    expect(formatLocked('date_picked')).toBe(false);
    expect(formatLocked('tickets')).toBe(true);
    expect(stepsFor('doubles')).toEqual(['Vote', 'Tickets', 'Teams', 'Games', 'Final']);
    expect(stepsFor('americano')).toEqual(['Vote', 'Tickets', 'Games', 'Winners']);
    expect([formatName('doubles'), formatName('americano')]).toEqual(['Locked doubles', 'Americano']);
    expect([formatRule('doubles'), formatRule('americano')]).toEqual(['Same partner all night', 'New partner every round']);
    // Alex: the cards' one-line subtitle.
    const { formatLine } = await import('../shared/tournament');
    expect([formatLine('doubles'), formatLine('americano')]).toEqual(['Locked doubles (same partner all night)', 'Americano (new partner every round)']);
  });
});
