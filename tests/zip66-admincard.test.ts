import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { recentFrom, shortClock, signupCloseDefault, signupReminderText } from '../shared/tournamentNudge';
import { missedDate } from '../shared/tournamentNudge';
import type { PlayerTournamentView } from '../shared/tournament';

// Zip 66 (🎾66.admincard): the organizer's card gets each player's vote (the Votes row lists names) and the "Not signed up" row (before the date:
// active players who played a game in the last 3 months and are not on the list; after it: players on the list who did not pick that date and
// have not answered). Players never get either. The player's in-or-out alert is decided from their own sign-up only (missedDate).
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts).

const TZ = 'America/Detroit';
const DATE = '2026-11-12';
const OTHER = '2026-11-10';
const DATES = ['2026-11-03', '2026-11-05', OTHER, DATE, '2026-11-17'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400 };
const NOW_MS = Date.parse('2026-10-26T16:00:00.000Z');
const PAY_BY_ISO = '2026-11-12T00:00:00.000Z'; // Wed Nov 11, 7:00 PM EST
const CUT_ISO = '2026-11-12T21:30:00.000Z'; // Thu Nov 12, 4:30 PM EST (3 hours before the 7:30 PM start)

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

async function world(opts: { visibility?: 'me' | 'all'; format?: string } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, visibility: opts.visibility ?? 'all', format: opts.format ?? 'vote' });
  expect(created.status, created.text).toBe(200);
  return { ...base, byName, tid: created.data.id };
}

async function signUp(ctx: Ctx, name: string, dates: string[], vote = 'locked') {
  const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates, formatVote: vote });
  expect(res.status, res.text).toBe(200);
}

/** A game that is over, `daysAgo` days back, with these players in (played unless `notPlayed`). Written straight into the test database. */
let gameN = 0;
function playedGame(ctx: Ctx, daysAgo: number, names: string[], notPlayed: string[] = []) {
  const db = ctx.app.db.raw;
  const group = (db.prepare('SELECT id FROM groups').get() as { id: string }).id;
  const id = `test-game-${++gameN}`;
  const start = new Date(NOW_MS - daysAgo * 86_400_000 + gameN * 60_000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 3_600_000).toISOString();
  db.prepare("INSERT INTO sessions (id, group_id, starts_at, ends_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'completed', ?, ?)").run(id, group, start, end, start, start);
  for (const [i, n] of names.entries()) {
    db.prepare("INSERT INTO session_players (id, session_id, player_id, status, claimed_at, claim_seq, confirmed_at, confirm_seq, updated_at, played) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)").run(
      `${id}-${i}`,
      id,
      ctx.byName[n],
      start,
      i,
      start,
      i,
      start,
      notPlayed.includes(n) ? 0 : 1,
    );
  }
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const groupOf = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).text;

describe('the reminder words (shared)', () => {
  it('3 calendar months back, the short day and clock, the copied text', () => {
    expect(recentFrom(Date.parse('2026-11-19T15:00:00.000Z'))).toBe('2026-08-19T15:00:00.000Z');
    // A shorter month keeps its last day.
    expect(recentFrom(Date.parse('2026-05-31T12:00:00.000Z'))).toBe('2026-02-28T12:00:00.000Z');
    expect(shortClock('2026-11-25T01:00:00.000Z', TZ)).toBe('8 PM');
    expect(shortClock('2026-11-25T00:30:00.000Z', TZ)).toBe('7:30 PM');
    expect(signupReminderText(['Vic', 'Reese'], 'The Cold Open', '2026-11-25T01:00:00.000Z', TZ, 'pickleball.juncaj.net')).toBe(
      'Vic, Reese: sign-ups for The Cold Open close Tue Nov 24 at 8 PM. pickleball.juncaj.net',
    );
  });
  it('no close stored before the date: the next Tuesday at 8:00 PM Eastern', () => {
    // Thu Nov 19, 10 AM: Tue Nov 24, 8 PM.
    expect(signupCloseDefault(Date.parse('2026-11-19T15:00:00.000Z'), TZ)).toBe('2026-11-25T01:00:00.000Z');
    // Tue Nov 24, 7 PM: that evening. Tue Nov 24, 9 PM: the Tuesday after.
    expect(signupCloseDefault(Date.parse('2026-11-25T00:00:00.000Z'), TZ)).toBe('2026-11-25T01:00:00.000Z');
    expect(signupCloseDefault(Date.parse('2026-11-25T02:00:00.000Z'), TZ)).toBe('2026-12-02T01:00:00.000Z');
  });
});

describe('Who voted (organizer only)', () => {
  it('each sign-up carries its vote with the counts; the names add up to the counts', async () => {
    const ctx = await world();
    await signUp(ctx, 'Blair', [DATE], 'locked');
    await signUp(ctx, 'Casey', [DATE], 'americano');
    await signUp(ctx, 'Devon', [OTHER], 'either');
    const t = await dash(ctx);
    expect(t.votes).toEqual({ locked: 1, americano: 1, either: 1 });
    expect(t.signups.map((s: { name: string; vote: string }) => [s.name, s.vote])).toEqual([
      ['Blair', 'locked'],
      ['Casey', 'americano'],
      ['Devon', 'either'],
    ]);
    // After the date: the counts are of those who can make it; the screen lists the same people (votersOf: dates include it).
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    const after = await dash(ctx);
    expect(after.votes).toEqual({ locked: 1, americano: 1, either: 0 });
    const voters = after.signups.filter((s: { dates: string[] }) => s.dates.includes(DATE));
    expect(voters.map((s: { vote: string }) => s.vote).sort()).toEqual(['americano', 'locked']);
  });
  it('a style chosen at Create (no vote): no votes and no vote on any sign-up', async () => {
    const ctx = await world({ format: 'doubles' });
    await signUp(ctx, 'Blair', [DATE]);
    const t = await dash(ctx);
    expect(t.votes).toBeUndefined();
    expect(t.signups[0].vote).toBeUndefined();
  });
  it('no player ever gets a vote, a count or the Not signed up list', async () => {
    const ctx = await world();
    playedGame(ctx, 10, ['Devon', 'Emery']);
    await signUp(ctx, 'Blair', [DATE], 'americano');
    await signUp(ctx, 'Casey', [OTHER], 'locked');
    for (const who of ['Blair', 'Casey', 'Devon']) {
      const text = await groupOf(ctx, who);
      for (const word of ['notSignedUp', '"votes"', '"vote"', 'played lately']) expect(text.includes(word), `${who}: ${word}`).toBe(false);
    }
  });
});

describe('Not signed up, before the date (played in the last 3 months)', () => {
  it('active players with a played game in the last 3 months who are not on the list; never the organizer', async () => {
    const ctx = await world();
    playedGame(ctx, 14, ['Alex', 'Devon', 'Casey', 'Frankie'], ['Frankie']); // Frankie marked "did not play"
    playedGame(ctx, 120, ['Emery']); // 4 months ago: too long
    await signUp(ctx, 'Casey', [DATE]);
    const t = await dash(ctx);
    expect(t.notSignedUp.mode).toBe('recent');
    expect(t.notSignedUp.closeAt).toBeNull();
    expect(t.notSignedUp.players.map((p: { name: string }) => p.name)).toEqual(['Devon']);
    // An inactive player is left out.
    ctx.app.db.raw.prepare('UPDATE players SET is_active = 0 WHERE id = ?').run(ctx.byName.Devon);
    expect((await dash(ctx)).notSignedUp.players).toEqual([]);
  });
  it('a game in the future, or a canceled one, does not count', async () => {
    const ctx = await world();
    playedGame(ctx, -3, ['Devon']);
    playedGame(ctx, 5, ['Emery']);
    ctx.app.db.raw.prepare("UPDATE sessions SET status = 'canceled' WHERE id IN (SELECT session_id FROM session_players WHERE player_id = ?)").run(ctx.byName.Emery);
    expect((await dash(ctx)).notSignedUp.players).toEqual([]);
  });
});

describe('Not signed up, after the date (did not pick it)', () => {
  it('lists who did not pick the date until they answer; closeAt is Pay by, then the 3-hour cutoff, then none', async () => {
    const ctx = await world();
    await signUp(ctx, 'Blair', [DATE]);
    await signUp(ctx, 'Casey', [OTHER]);
    await signUp(ctx, 'Devon', [OTHER]);
    await signUp(ctx, 'Emery', [OTHER]);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    let t = await dash(ctx);
    expect(t.notSignedUp).toEqual({
      mode: 'missed',
      players: ['Casey', 'Devon', 'Emery'].map((n) => ({ playerId: ctx.byName[n], name: n })),
      closeAt: PAY_BY_ISO,
    });
    // I'm in (the alert): the picked date goes on Casey's sign-up. Can't make it: Devon backs out.
    expect((await (await playerPhone(ctx, 'Casey')).call('PUT', '/api/tournament/signup', { tournamentId: ctx.tid, dates: [DATE] })).status).toBe(200);
    expect((await (await playerPhone(ctx, 'Devon')).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: 0 })).status).toBe(200);
    t = await dash(ctx);
    expect(t.notSignedUp.players.map((p: { name: string }) => p.name)).toEqual(['Emery']);
    // After Pay by (a spot still open): the text's close is the 3-hour cutoff.
    ctx.app.now = Date.parse(PAY_BY_ISO) + 3_600_000;
    t = await dash(ctx);
    expect(t.notSignedUp.closeAt).toBe(CUT_ISO);
    // Inside the last 3 hours: tickets are closed for them, the row goes.
    ctx.app.now = Date.parse(CUT_ISO) + 60_000;
    expect((await dash(ctx)).notSignedUp).toBeUndefined();
  });
  it('someone who paid or tapped I paid is not asked again', async () => {
    const ctx = await world();
    await signUp(ctx, 'Blair', [DATE]);
    await signUp(ctx, 'Casey', [OTHER]);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    // Lock my spot on the card (it stays as before for them), then I paid.
    const casey = await playerPhone(ctx, 'Casey');
    const lock = await casey.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
    expect(lock.status, lock.text).toBe(200);
    expect((await casey.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: lock.data.dueCents })).status).toBe(200);
    expect((await dash(ctx)).notSignedUp.players).toEqual([]);
  });
  it('a tournament on Only me sends players nothing at all', async () => {
    const ctx = await world({ visibility: 'me' });
    const text = await groupOf(ctx, 'Blair');
    expect(text.includes('"tournament"')).toBe(false);
    expect(text.includes('The Cold Open')).toBe(false);
  });
});

describe('the in-or-out alert (missedDate, from their own sign-up only)', () => {
  const base = (over: Partial<PlayerTournamentView>): PlayerTournamentView =>
    ({
      id: 't',
      name: 'The Cold Open',
      format: 'doubles',
      status: 'tickets',
      start: 1170,
      minutes: 150,
      openDates: [DATE],
      finalDate: DATE,
      names: ['Blair', 'Casey'],
      me: { level: 320, dates: [OTHER] },
      tickets: { size: 6, full: false, priceCents: 1600, payBy: PAY_BY_ISO, closed: false, started: false, freed: 0, locked: [], line: [], mine: null },
      ...over,
    }) as PlayerTournamentView;
  it('asks only a player on the list who did not pick the date and can still lock a spot', () => {
    expect(missedDate(base({}))).toBe(true);
    expect(missedDate(base({ me: { level: 320, dates: [DATE] } }))).toBe(false);
    expect(missedDate(base({ me: null }))).toBe(false);
    expect(missedDate(base({ tickets: { ...base({}).tickets!, closed: true } }))).toBe(false);
    expect(missedDate(base({ tickets: { ...base({}).tickets!, mine: { place: 'spot', creditCents: 0, paidCents: 1600, claimCents: 0, owedCents: 0 } } }))).toBe(false);
    expect(missedDate(base({ tickets: { ...base({}).tickets!, mine: { place: 'none', creditCents: 0, paidCents: 0, claimCents: 1600, owedCents: 0 } } }))).toBe(false);
    expect(missedDate(base({ status: 'signup', finalDate: null }))).toBe(false);
  });
  it('the server: a player who did not pick the date gets their own dates and the date, nothing else new', async () => {
    const ctx = await world();
    await signUp(ctx, 'Blair', [DATE]);
    await signUp(ctx, 'Casey', [OTHER]);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    const view = JSON.parse(await groupOf(ctx, 'Casey')).tournament as PlayerTournamentView;
    expect(view.me!.dates).toEqual([OTHER]);
    expect(view.finalDate).toBe(DATE);
    expect(missedDate(view)).toBe(true);
    // Blair (picked it) is not asked.
    expect(missedDate(JSON.parse(await groupOf(ctx, 'Blair')).tournament)).toBe(false);
  });
});
