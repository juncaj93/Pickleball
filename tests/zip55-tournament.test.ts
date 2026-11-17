import { describe, expect, it } from 'vitest';
import { DAY, playerPhone, setupGroup, withoutIds } from './harness';
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
    expect(LEVELS[0].text).toBe('Just starting. Still learning the rules and how to serve.');
    expect(LEVELS[6].text).toBe('Rarely makes a mistake. A level none of us have reached yet.');
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
    expect(t).toMatchObject({ id, name: 'Winter Classic', status: 'signup', visibility: 'me', size: 8, courts: 2, minutes: 120, start: 1170, ticketCents: 1600, championCreditCents: 1400, offeredDates: DATES, finalDate: null, signups: [] });
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
    expect((await bad({ size: 7 })).message).toBe('Pick 6, 8, 10 or 12 players.');
    expect((await bad({ courts: 3 })).message).toBe('Pick a court plan.');
    // 2.5 and 3 hour plans need Booking hours ON for everyone.
    expect((await bad({ minutes: 150 })).message).toBe('2.5 and 3 hour games need Booking hours turned on.');
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
    expect(mine).toMatchObject({ id, name: 'Winter Classic', status: 'signup', onlyMe: true, names: [], me: null, openDates: DATES, start: 1170, prize: 'Winners each get a medal and a $14 game credit.' });
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
    // Never anyone's level to another player.
    expect(JSON.stringify(devon)).not.toContain('340');
    expect(JSON.stringify(devon)).not.toContain('275');
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

  it('Edit sign-up changes the level and dates; the level history keeps every pick; back out takes them off; signing up again puts them at the end', async () => {
    const ctx = await world();
    const id = await open(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    const casey = await playerPhone(ctx, 'Casey');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 320, dates: [DATES[0]] });
    ctx.app.advance(60_000);
    await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[1]] });
    ctx.app.advance(60_000);
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 340, dates: [DATES[2], DATES[3]] })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 340, dates: [DATES[2], DATES[3]] });
    // Back out: off the list for everyone.
    ctx.app.advance(60_000);
    expect((await blair.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('backed_out');
    expect((await casey.call('GET', '/api/group')).data.tournament.names).toEqual(['Casey']);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toBeNull();
    expect((await dash(ctx)).tournament.backedOut.map((b: any) => b.name)).toEqual(['Blair']);
    // A second back out changes nothing.
    expect((await blair.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('not_signed_up');
    // Edit after backing out is refused.
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 300 })).status).toBe(409);
    // Sign up again: at the end of the list.
    ctx.app.advance(60_000);
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 340, dates: [DATES[0]] });
    expect((await casey.call('GET', '/api/group')).data.tournament.names).toEqual(['Casey', 'Blair']);
    const history = ctx.app.db.raw.prepare("SELECT level, set_by FROM tournament_level_history WHERE player_id = ? ORDER BY created_at").all(ctx.byName.Blair);
    expect(history).toEqual([
      { level: 320, set_by: 'player' },
      { level: 340, set_by: 'player' },
      { level: 340, set_by: 'player' },
    ]);
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

  it('pick the date: the card shows it, sign-up then only offers that date, changes after the date is picked still work, and the date can be taken back', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[2]] });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: '2026-11-04' })).status).toBe(400);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[2] })).status).toBe(200);
    const b = (await blair.call('GET', '/api/group')).data.tournament;
    expect(b).toMatchObject({ status: 'date_picked', finalDate: DATES[2], openDates: [DATES[2]] });
    // A new sign-up after the date is picked: only the picked date can be picked.
    const casey = await playerPhone(ctx, 'Casey');
    expect((await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 275, dates: [DATES[0]] })).status).toBe(409);
    expect((await casey.call('POST', '/api/tournament/signup', { tournamentId: id, level: 275, dates: [DATES[2]] })).status).toBe(200);
    // Edit after the date is picked: the level alone; then the dates (only the picked one); back out still works.
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320 })).status).toBe(200);
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320, dates: [DATES[2]] })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 320, dates: [DATES[2]] });
    expect((await casey.call('POST', '/api/tournament/back-out', { tournamentId: id })).data.result).toBe('backed_out');
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'date_picked', finalDate: DATES[2] });
    expect((await dash(ctx)).tournament.signups.map((s: any) => s.name)).toEqual(['Blair']);
    // Taken back: sign-up open again, every offered date open again.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: null })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament).toMatchObject({ status: 'signup', finalDate: null, openDates: DATES });
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
    expect((await blair.call('GET', '/api/group')).data.tournament).toBeUndefined();
    expect((await dash(ctx)).tournament).toBeUndefined();
    // A new one can be made; the old list stays in the database with its levels.
    await create(ctx, { name: 'Spring Fling' });
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
    expect(t).toMatchObject({ name: 'Winter Classic', status: 'signup', visibility: 'all', size: 8 });
    expect(t.signups.map((s: any) => s.name)).toEqual(['Parker', 'Rowan', 'Sage', 'Wren', 'Quinn']);
    const b = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'date_picked' });
    t = (await dash(ctx)).tournament;
    expect(t.status).toBe('date_picked');
    expect(t.finalDate).toBe(b.data.date);
    expect(t.signups).toHaveLength(7);
    expect(t.signups.every((s: any) => s.dates.includes(t.finalDate))).toBe(true);
    expect(t.signups.find((s: any) => s.name === 'Sage')).toMatchObject({ pickedLevel: 300, level: 340, reviewed: true });
    expect((await group(ctx, 'Vic')).tournament).toMatchObject({ status: 'date_picked', me: null });
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

  it("a new pick of the player's own level goes back to be reviewed; the same pick keeps the organizer's level", async () => {
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
    // A new pick: back to be reviewed.
    await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320 });
    expect(await row()).toMatchObject({ pickedLevel: 320, level: 320, reviewed: false });
    // Back out and sign up again with the same pick after a review: the review stands; a different pick: reviewed again.
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/level`, { playerId: ctx.byName.Blair, level: 350 });
    await blair.call('POST', '/api/tournament/back-out', { tournamentId: id });
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 320, dates: [DATES[0]] });
    expect(await row()).toMatchObject({ pickedLevel: 320, level: 350, reviewed: true });
    await blair.call('POST', '/api/tournament/back-out', { tournamentId: id });
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 250, dates: [DATES[0]] });
    expect(await row()).toMatchObject({ pickedLevel: 250, level: 250, reviewed: false });
    // The level history kept every step.
    const h = ctx.app.db.raw.prepare('SELECT level, set_by FROM tournament_level_history WHERE player_id = ? ORDER BY rowid').all(ctx.byName.Blair);
    expect(h).toEqual([
      { level: 300, set_by: 'player' },
      { level: 340, set_by: 'organizer' },
      { level: 320, set_by: 'player' },
      { level: 350, set_by: 'organizer' },
      { level: 320, set_by: 'player' },
      { level: 250, set_by: 'player' },
    ]);
  });

  it('after the date is picked, a level-only edit keeps dates that do not include it (nobody has to tick a date they cannot make)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', '/api/tournament/signup', { tournamentId: id, level: 300, dates: [DATES[0], DATES[1]] });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: DATES[3] });
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: id, level: 320 })).status).toBe(200);
    expect((await blair.call('GET', '/api/group')).data.tournament.me).toEqual({ level: 320, dates: [DATES[0], DATES[1]] });
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

  it('Edit settings keeps a 2.5 hour plan after Booking hours is turned off (only a NEW long plan needs it); a new one is still refused', async () => {
    const ctx = await world();
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const id = await create(ctx, { size: 6, courts: 1, minutes: 150, start: 1170 });
    await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false });
    const renamed = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, size: 6, courts: 1, minutes: 150, start: 1170, name: 'Renamed Cup' });
    expect(renamed.status, renamed.text).toBe(200);
    const other = await ctx.organizer.call('PUT', `/api/admin/tournament/${id}`, { ...BASE, size: 8, courts: 2, minutes: 150, start: 1170 });
    expect(other.status).toBe(400);
  });

  it('a save that lands just after a Cancel changes nothing (the canceled tournament never comes back)', async () => {
    const ctx = await world();
    const id = await create(ctx, { visibility: 'all' });
    // Every write from here: the Cancel lands right before the date pick's own statement runs (the race the reviewer described).
    const inner = ctx.app.env.DB;
    ctx.app.env.DB = {
      ...inner,
      prepare(sql: string) {
        if (/SET status = 'date_picked'/.test(sql)) ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'canceled' WHERE id = ?").run(id);
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
