import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { decideFormat, formatAlertWords, planFit, tallyVotes, voteCountsLine, VOTE_ROWS, winnerWords } from '../shared/tournament';
import { activityText } from '../shared/activity';

// Zip 60 (🎾60.formatvote): the players vote the format when they sign up; the organizer's date pick decides it.
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament nights are Nov 5 and Nov 12 (Thursdays).

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const DATE = '2026-11-12';
const OTHER = '2026-11-05';
const DATES = ['2026-11-03', OTHER, '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'The Cold Open', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };

async function world(extra: Record<string, unknown> = {}) {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  const created = await ctx.organizer.call('POST', '/api/admin/tournament', { ...BASE, ...extra });
  expect(created.status, created.text).toBe(200);
  return { ctx, tid: created.data.id as string };
}

const raw = (ctx: Ctx) => ctx.app.db.raw;
const row = (ctx: Ctx, tid: string) => raw(ctx).prepare('SELECT format, format_source, final_date FROM tournaments WHERE id = ?').get(tid) as { format: string; format_source: string | null; final_date: string | null };
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const signUp = async (ctx: Ctx, tid: string, name: string, vote?: string, dates: string[] = [DATE]) => {
  const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: tid, level: 320, dates, ...(vote ? { formatVote: vote } : {}) });
  expect(res.status, res.text).toBe(200);
};
const pick = async (ctx: Ctx, tid: string, date: string | null = DATE) => {
  const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}/date`, { date });
  expect(res.status, res.text).toBe(200);
};

describe('the rule (a pure function)', () => {
  const c = (locked: number, americano: number, either = 0) => ({ locked, americano, either });
  it('a clear majority wins, both ways, whatever came before', () => {
    expect(decideFormat(c(3, 1), null)).toEqual({ format: 'doubles', rule: 'majority' });
    expect(decideFormat(c(1, 3), null)).toEqual({ format: 'americano', rule: 'majority' });
    expect(decideFormat(c(3, 1), 'doubles')).toEqual({ format: 'doubles', rule: 'majority' });
    expect(decideFormat(c(1, 3), 'americano')).toEqual({ format: 'americano', rule: 'majority' });
    // One vote against none is a majority; Either counts for neither side.
    expect(decideFormat(c(0, 1, 9), 'americano')).toEqual({ format: 'americano', rule: 'majority' });
  });
  it('a tie goes by the tie rule: Locked doubles for the first ever, else the opposite of the last one', () => {
    expect(decideFormat(c(2, 2), null)).toEqual({ format: 'doubles', rule: 'tie' });
    expect(decideFormat(c(2, 2), 'doubles')).toEqual({ format: 'americano', rule: 'tie' });
    expect(decideFormat(c(2, 2), 'americano')).toEqual({ format: 'doubles', rule: 'tie' });
  });
  it('all Either, and no votes at all, are ties too', () => {
    expect(decideFormat(c(0, 0, 5), null)).toEqual({ format: 'doubles', rule: 'tie' });
    expect(decideFormat(c(0, 0, 5), 'doubles')).toEqual({ format: 'americano', rule: 'tie' });
    expect(decideFormat(c(0, 0), null)).toEqual({ format: 'doubles', rule: 'tie' });
    expect(decideFormat(c(0, 0), 'americano')).toEqual({ format: 'doubles', rule: 'tie' });
  });
  it('counts: no vote and odd values are Either; the words', () => {
    expect(tallyVotes(['locked', 'americano', 'americano', null, undefined, 'either', 'nonsense'])).toEqual({ locked: 1, americano: 2, either: 4 });
    expect(voteCountsLine({ locked: 3, americano: 6, either: 2 })).toBe('Locked 3, Americano 6, Either 2');
    expect(VOTE_ROWS.map((r) => [r.name, r.line])).toEqual([
      ['Locked doubles', 'teams balanced by skill, same partner all night'],
      ['Americano', 'new partner every round'],
      ['Either is fine', ''],
    ]);
    expect(formatAlertWords('The Cold Open', '2026-12-17', 'americano', 'vote')).toEqual({ title: 'The Cold Open is scheduled for Thu Dec 17.', sub: 'Most players voted Americano.' });
    expect(formatAlertWords('The Cold Open', '2026-12-17', 'doubles', 'vote').sub).toBe('Most players voted Locked doubles.');
    expect(formatAlertWords('The Cold Open', '2026-12-17', 'doubles', 'tie').sub).toBe('Format: Locked doubles');
    expect(formatAlertWords('The Cold Open', '2026-12-17', 'americano', 'admin').sub).toBe('Format: Americano');
  });
  it('no em dashes in the new words', () => {
    const all = JSON.stringify([VOTE_ROWS, formatAlertWords('X', '2026-12-17', 'doubles', 'vote'), formatAlertWords('X', '2026-12-17', 'doubles', 'tie')]);
    expect(all).not.toContain('\u2014');
  });
});

describe('Create and Edit', () => {
  it('Let players vote is the default: the format is to be decided, the card says so', async () => {
    const { ctx, tid } = await world();
    expect(row(ctx, tid)).toMatchObject({ format_source: 'vote', final_date: null });
    const d = await dash(ctx);
    expect(d).toMatchObject({ formatPending: true, formatSource: 'vote', votes: { locked: 0, americano: 0, either: 0 } });
    expect((await card(ctx, 'Blair')) as { formatTbd?: boolean }).toMatchObject({ formatTbd: true });
  });
  it('Locked doubles and Americano still work as before: no vote, no TBD; the date alert shows the date and the format only', async () => {
    for (const format of ['doubles', 'americano'] as const) {
      const { ctx, tid } = await world({ format });
      expect(row(ctx, tid)).toMatchObject({ format, format_source: null });
      const d = await dash(ctx);
      expect(d.formatPending).toBeUndefined();
      expect(d.format).toBe(format);
      await signUp(ctx, tid, 'Blair');
      expect((await card(ctx, 'Blair')).formatTbd).toBeUndefined();
      await pick(ctx, tid);
      expect(row(ctx, tid)).toMatchObject({ format, format_source: null });
      expect((await card(ctx, 'Blair')).formatAlert).toMatchObject({ title: 'The Cold Open is scheduled for Thu Nov 12.', sub: `Format: ${format === 'doubles' ? 'Locked doubles' : 'Americano'}` });
    }
  });
  it('the organizer can switch to a format by hand while the vote is open (source admin), and back to a vote', async () => {
    const { ctx, tid } = await world();
    const body = { ...BASE, ticketCents: 1600 };
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...body, format: 'americano' })).status).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'admin' });
    expect((await dash(ctx)).formatPending).toBeUndefined();
    expect((await card(ctx, 'Blair')).formatTbd).toBeUndefined();
    // Back to a vote (no date locked yet).
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...body, format: 'vote' })).status).toBe(200);
    expect(row(ctx, tid).format_source).toBe('vote');
    expect((await dash(ctx)).formatPending).toBe(true);
    // A save that leaves the format out keeps everything.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, body)).status).toBe(200);
    expect(row(ctx, tid).format_source).toBe('vote');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...body, format: 'bogus' })).status).toBe(400);
  });
});

describe('sign-up and Edit sign-up carry the vote', () => {
  it('stores the vote (Either when none is sent), Edit changes it, a bad value is refused', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey');
    const votes = () => Object.fromEntries((raw(ctx).prepare('SELECT p.display_name AS n, s.format_vote AS v FROM tournament_signups s JOIN players p ON p.id = s.player_id').all() as { n: string; v: string | null }[]).map((r) => [r.n, r.v]));
    expect(votes()).toEqual({ Blair: 'americano', Casey: null });
    // Their own vote comes back to them, Either for no vote.
    expect((await card(ctx, 'Blair')).me.formatVote).toBe('americano');
    expect((await card(ctx, 'Casey')).me.formatVote).toBe('either');
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: tid, formatVote: 'locked' })).status).toBe(200);
    expect(votes().Blair).toBe('locked');
    expect((await blair.call('PUT', '/api/tournament/signup', { tournamentId: tid, formatVote: 'both' })).status).toBe(400);
    expect(votes().Blair).toBe('locked');
    // Backing out and signing up again with no vote keeps the old one; with a vote, changes it.
    await blair.call('POST', '/api/tournament/back-out', { tournamentId: tid });
    await signUp(ctx, tid, 'Blair');
    expect(votes().Blair).toBe('locked');
    await signUp(ctx, tid, 'Blair', 'either');
    expect(votes().Blair).toBe('either');
  });
  it('NO player ever receives another player\'s vote (nor any count) from the server', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey', 'locked');
    await signUp(ctx, tid, 'Devon', 'locked');
    for (const name of ['Blair', 'Casey', 'Devon', 'Emery']) {
      const res = await (await playerPhone(ctx, name)).call('GET', '/api/group');
      const text = res.text;
      expect(text).not.toMatch(/"votes"/);
      expect(text).not.toMatch(/format_vote/);
      // Only their own vote, and only as `formatVote` inside their own `me`.
      const own = (text.match(/"formatVote":"[a-z]+"/g) ?? []).length;
      expect(own).toBe(name === 'Emery' ? 0 : 1);
    }
    // The organizer's screen has the counts.
    expect((await dash(ctx)).votes).toEqual({ locked: 2, americano: 1, either: 0 });
  });
  it('a player who may not see the tournament gets no tournament data at all (Only me), and the routes say not open', async () => {
    const { ctx, tid } = await world({ visibility: 'me' });
    const res = await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group');
    expect(res.text).not.toMatch(/tournament|formatVote|formatTbd|formatAlert|Cold Open/i);
    const r = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: tid, level: 320, dates: [DATE], formatVote: 'locked' });
    expect(r.status).toBe(404);
    expect(raw(ctx).prepare('SELECT COUNT(*) AS c FROM tournament_signups').get()).toEqual({ c: 0 });
  });
});

describe('Pick date decides the format', () => {
  it('a clear majority wins, counting only players on the list who picked THAT date; Either counts for neither', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'locked');
    await signUp(ctx, tid, 'Casey', 'americano');
    await signUp(ctx, tid, 'Devon', 'americano');
    await signUp(ctx, tid, 'Emery', 'either');
    // Frankie votes Locked but cannot make the date; Alex backs out after voting Locked: neither counts.
    await signUp(ctx, tid, 'Frankie', 'locked', [OTHER]);
    await signUp(ctx, tid, 'Alex', 'locked');
    await (await playerPhone(ctx, 'Alex')).call('POST', '/api/tournament/back-out', { tournamentId: tid });
    expect((await dash(ctx)).votes).toEqual({ locked: 2, americano: 2, either: 1 });
    await pick(ctx, tid);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote', final_date: DATE });
    const d = await dash(ctx);
    expect(d).toMatchObject({ format: 'americano', formatSource: 'vote', votes: { locked: 1, americano: 2, either: 1 } });
    expect(d.formatPending).toBeUndefined();
  });
  it('the alert: real name and date, the vote claim only for a real majority', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey', 'americano');
    await signUp(ctx, tid, 'Devon', 'locked');
    await pick(ctx, tid);
    for (const name of ['Blair', 'Devon']) {
      const t = await card(ctx, name);
      expect(t.format).toBe('americano');
      expect(t.formatTbd).toBeUndefined();
      expect(t.formatAlert).toMatchObject({ title: 'The Cold Open is scheduled for Thu Nov 12.', sub: 'Most players voted Americano.' });
    }
    // A player who never signed up sees it too (every player who can see the tournament).
    expect((await card(ctx, 'Frankie')).formatAlert.sub).toBe('Most players voted Americano.');
    // No counts anywhere in a player's answer.
    expect(JSON.stringify(await card(ctx, 'Blair'))).not.toMatch(/votes|locked":\d/);
  });
  it('a tie, or nobody picking a side: the first tournament ever is Locked doubles and the alert makes no vote claim', async () => {
    for (const votes of [['locked', 'americano'], ['either', 'either'], []] as string[][]) {
      const { ctx, tid } = await world();
      const names = ['Blair', 'Casey'];
      for (let i = 0; i < votes.length; i++) await signUp(ctx, tid, names[i], votes[i]);
      await pick(ctx, tid);
      expect(row(ctx, tid)).toMatchObject({ format: 'doubles', format_source: 'tie' });
      expect((await card(ctx, 'Frankie')).formatAlert).toMatchObject({ title: 'The Cold Open is scheduled for Thu Nov 12.', sub: 'Format: Locked doubles' });
      expect((await dash(ctx)).formatSource).toBe('tie');
    }
  });
  it('a tie after an earlier tournament is the OPPOSITE of it; canceled ones and undecided ones do not count', async () => {
    for (const [earlier, expected] of [['doubles', 'americano'], ['americano', 'doubles']] as const) {
      const ctx = await setupGroup();
      await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
      await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true });
      const groupId = (raw(ctx).prepare('SELECT id FROM groups LIMIT 1').get() as { id: string }).id;
      const old = (id: string, status: string, format: string, source: string | null, created: string, finalDate: string | null) =>
        raw(ctx)
          .prepare(
            `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status, visibility, created_at, updated_at, format, second_credit_cents, format_source)
             VALUES (?, ?, ?, 12, 2, 180, 1140, 1600, 1400, '[]', ?, ?, 'all', ?, ?, ?, 0, ?)`,
          )
          .run(id, groupId, `Old ${id}`, finalDate, status, created, created, format, source);
      // The one that counts: the most recent earlier tournament that was not canceled and had a decided format.
      old('a', 'ended', earlier === 'doubles' ? 'americano' : 'doubles', null, '2026-01-01T00:00:00.000Z', '2026-01-15');
      old('b', 'ended', earlier, 'vote', '2026-02-01T00:00:00.000Z', '2026-02-15');
      // After it, a canceled one (any format) and a vote that was never decided: neither counts.
      old('c', 'canceled', earlier === 'doubles' ? 'americano' : 'doubles', null, '2026-03-01T00:00:00.000Z', null);
      old('d', 'ended', earlier === 'doubles' ? 'americano' : 'doubles', 'vote', '2026-04-01T00:00:00.000Z', null);
      const created = await ctx.organizer.call('POST', '/api/admin/tournament', BASE);
      const tid = created.data.id as string;
      await signUp(ctx, tid, 'Blair', 'locked');
      await signUp(ctx, tid, 'Casey', 'americano');
      await pick(ctx, tid);
      expect(row(ctx, tid)).toMatchObject({ format: expected, format_source: 'tie' });
    }
  });
  it('the organizer changing the format by hand sets source admin; the alert (same key, so a dismissed one stays dismissed) says only the format', async () => {
    const { ctx, tid } = await world({ visibility: 'me' });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}/visibility`, { visibility: 'all' });
    await signUp(ctx, tid, 'Blair', 'americano');
    await pick(ctx, tid);
    const before = (await card(ctx, 'Blair')).formatAlert;
    expect(before.sub).toBe('Most players voted Americano.');
    // The organizer's own edit: tickets are open on Everyone, so the format is locked (Zip 56): a hand change is refused.
    const edit = await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, format: 'doubles' });
    expect(edit.status).toBe(409);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote' });
  });
  it('on Only me nobody holds a ticket, so the organizer may still change the format by hand: source admin, the alert keeps its key and says only the format', async () => {
    const { ctx, tid } = await world({ visibility: 'me' });
    await ctx.organizer.call('POST', '/api/me', { playerId: ctx.byName.Alex });
    ctx.organizer.groupKey = ctx.groupKey;
    await signUp(ctx, tid, 'Blair', 'americano').catch(() => undefined);
    // Only me: sign-ups from players are refused (404), so the organizer's own phone signs up.
    const alex = ctx.organizer;
    expect((await alex.call('POST', '/api/tournament/signup', { tournamentId: tid, level: 320, dates: [DATE], formatVote: 'americano' })).status).toBe(200);
    await pick(ctx, tid);
    const first = (await alex.call('GET', '/api/group')).data.tournament.formatAlert;
    expect(first.sub).toBe('Most players voted Americano.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, visibility: 'me', format: 'doubles' })).status).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'doubles', format_source: 'admin' });
    const second = (await alex.call('GET', '/api/group')).data.tournament.formatAlert;
    expect(second.key).toBe(first.key);
    expect(second.sub).toBe('Format: Locked doubles');
    expect((await dash(ctx)).formatSource).toBe('admin');
  });
  it('after the date is locked the vote is closed: a sent vote is ignored, the vote option cannot come back, and the card shows the format', async () => {
    const { ctx, tid } = await world({ visibility: 'me' });
    await ctx.organizer.call('POST', '/api/me', { playerId: ctx.byName.Alex });
    ctx.organizer.groupKey = ctx.groupKey;
    expect((await ctx.organizer.call('POST', '/api/tournament/signup', { tournamentId: tid, level: 320, dates: [DATE], formatVote: 'locked' })).status).toBe(200);
    await pick(ctx, tid);
    expect(row(ctx, tid)).toMatchObject({ format: 'doubles', format_source: 'vote' });
    await ctx.organizer.call('PUT', '/api/tournament/signup', { tournamentId: tid, formatVote: 'americano' });
    expect(raw(ctx).prepare('SELECT format_vote AS v FROM tournament_signups').get()).toEqual({ v: 'locked' });
    // Sending "vote" again changes nothing: it stays decided.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, visibility: 'me', format: 'vote' })).status).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'doubles', format_source: 'vote' });
    const t = (await ctx.organizer.call('GET', '/api/group')).data.tournament;
    expect(t.formatTbd).toBeUndefined();
    expect(t.me.formatVote).toBeUndefined();
  });
  it('Reschedule and pick again recounts, and shows a fresh alert (a new key); players who hold tickets keep the format they bought', async () => {
    const { ctx, tid } = await world({ visibility: 'me' });
    await ctx.organizer.call('POST', '/api/me', { playerId: ctx.byName.Alex });
    ctx.organizer.groupKey = ctx.groupKey;
    const alex = ctx.organizer;
    expect((await alex.call('POST', '/api/tournament/signup', { tournamentId: tid, level: 320, dates: [DATE, OTHER], formatVote: 'locked' })).status).toBe(200);
    await pick(ctx, tid);
    const k1 = (await alex.call('GET', '/api/group')).data.tournament.formatAlert.key;
    expect(row(ctx, tid).format).toBe('doubles');
    // Back to picking (tickets only ever held by the organizer's own seat: nothing a player bought). Change the vote, pick the other date: counted again.
    const re = await ctx.organizer.call('POST', `/api/admin/tournament/${tid}/reschedule`, {});
    expect(re.status, re.text).toBe(200);
    const mid = (await alex.call('GET', '/api/group')).data.tournament;
    expect(mid.formatTbd).toBe(true);
    expect(mid.formatAlert).toBeUndefined();
    expect((await alex.call('PUT', '/api/tournament/signup', { tournamentId: tid, dates: [OTHER], formatVote: 'americano' })).status).toBe(200);
    ctx.app.advance(60_000);
    await pick(ctx, tid, OTHER);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote', final_date: OTHER });
    const k2 = (await alex.call('GET', '/api/group')).data.tournament.formatAlert;
    expect(k2.key).not.toBe(k1);
    expect(k2.sub).toBe('Most players voted Americano.');
  });
});

describe('History and the words', () => {
  it('History says how the format was decided, with the counts (organizer only)', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey', 'locked');
    await signUp(ctx, tid, 'Devon', 'either');
    await pick(ctx, tid);
    const rows = raw(ctx).prepare("SELECT action, details_json FROM admin_audit_log WHERE action = 'tournament_format'").all() as { action: string; details_json: string }[];
    expect(rows).toHaveLength(1);
    const d = JSON.parse(rows[0].details_json);
    expect(d).toMatchObject({ format: 'doubles', how: 'tie', locked: 1, americano: 1, either: 1 });
    const text = activityText({ id: 'x', actorLabel: 'organizer', action: 'tournament_format', details: d, createdAt: '2026-10-26T16:00:00.000Z', sessionStartsAt: null }, 'America/Detroit', 'Alex');
    expect(text).toContain('tie rule');
    expect(text).toContain('Locked 1, Americano 1, Either 1');
    expect(text).not.toContain('\u2014');
  });
});

describe('Edit rules and the preview test stages', () => {
  it('a tournament created on a format cannot go back to a vote once its date is locked, but can before', async () => {
    const { ctx, tid } = await world({ format: 'americano', visibility: 'me' });
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, visibility: 'me', format: 'vote' })).status).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote' });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, visibility: 'me', format: 'americano' });
    expect(row(ctx, tid).format_source).toBe('admin');
    await pick(ctx, tid);
    // Not a vote tournament any more once the organizer chose by hand: stays Americano whatever the votes.
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'admin' });
  });

  it('the three stages: vote open (mixed votes), clear majority with the alert, tie with the alert', async () => {
    const { ctx } = await world();
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of ['Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn', 'Zoe', 'Reese', 'Vic']) {
      ctx.byName[n] = (await ctx.organizer.call('POST', '/api/admin/players', { name: n })).data.id;
    }
    const run = async (stage: string) => {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage });
      expect(r.status, r.text).toBe(200);
      return dash(ctx);
    };
    let t = await run('vote_open');
    expect(t).toMatchObject({ name: 'The Cold Open', status: 'signup', formatPending: true, votes: { locked: 1, americano: 1, either: 1 } });
    const vic = (await card(ctx, 'Vic')) as { formatTbd?: boolean; me: unknown };
    expect(vic).toMatchObject({ formatTbd: true, me: null });
    t = await run('vote_majority');
    expect(t).toMatchObject({ status: 'tickets', format: 'americano', formatSource: 'vote', votes: { locked: 1, americano: 2, either: 2 } });
    expect((await card(ctx, 'Vic')).formatAlert.sub).toBe('Most players voted Americano.');
    t = await run('vote_tie');
    expect(t).toMatchObject({ status: 'tickets', format: 'doubles', formatSource: 'tie', votes: { locked: 1, americano: 1, either: 2 } });
    expect((await card(ctx, 'Vic')).formatAlert.sub).toBe('Format: Locked doubles');
    await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'none' });
    expect(await dash(ctx)).toBeUndefined();
  });
});

describe('review fixes', () => {
  it('Edit settings after a Reschedule works while players hold tickets: the unchanged format keeps the vote as its source', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await pick(ctx, tid);
    const lock = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/lock', { tournamentId: tid, intent: 'lock', priceCents: 1600 });
    expect(lock.status, lock.text).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${tid}/reschedule`, {})).status).toBe(200);
    const d = await dash(ctx);
    expect(d).toMatchObject({ format: 'americano', formatLocked: true });
    // The form sends the format it shows (the decided one): nothing changes, the save lands.
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, name: 'The Cold Open 2', format: 'americano' });
    expect(res.status, res.text).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote' });
    // A real change is still refused.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${tid}`, { ...BASE, format: 'doubles' })).status).toBe(409);
  });
  it('the stale-tally guard does not block a normal pick after sign-ups (the race itself is a millisecond window)', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'locked');
    const before = (raw(ctx).prepare('SELECT MAX(updated_at) AS m FROM tournament_signups').get() as { m: string }).m;
    ctx.app.advance(1000);
    await signUp(ctx, tid, 'Casey', 'americano');
    const after = (raw(ctx).prepare('SELECT MAX(updated_at) AS m FROM tournament_signups').get() as { m: string }).m;
    expect(after > before).toBe(true);
    await pick(ctx, tid);
    expect(row(ctx, tid)).toMatchObject({ final_date: DATE, format_source: 'tie' });
  });
});

describe('pass 2: the Finalize screen (server half)', () => {
  const fin = async (ctx: Ctx, tid: string, date = DATE) => ctx.organizer.call('GET', `/api/admin/tournament/${tid}/finalize?date=${date}`);
  const lock = (ctx: Ctx, tid: string, body: Record<string, unknown>) => ctx.organizer.call('PUT', `/api/admin/tournament/${tid}/date`, { date: DATE, ...body });

  it('the plan fit and the winner words are pure', () => {
    expect(planFit(0)).toEqual({ fits: 6, over: 0 });
    expect(planFit(5)).toEqual({ fits: 8, over: 0 });
    expect(planFit(10)).toEqual({ fits: 12, over: 0 });
    // Zip 63: the hidden cap is 16 (it was 12), so the plan keeps growing and "over" starts after 16.
    expect(planFit(12)).toEqual({ fits: 14, over: 0 });
    expect(planFit(13)).toEqual({ fits: 16, over: 0 });
    expect(planFit(16)).toEqual({ fits: 16, over: 0 });
    expect(planFit(18)).toEqual({ fits: 16, over: 2 });
    const c = (locked: number, americano: number, either = 0) => ({ locked, americano, either });
    expect(winnerWords(c(4, 6), decideFormat(c(4, 6), null), null)).toBe('Americano wins, 6 to 4.');
    expect(winnerWords(c(3, 1), decideFormat(c(3, 1), 'americano'), 'americano')).toBe('Locked doubles wins, 3 to 1.');
    expect(winnerWords(c(2, 2), decideFormat(c(2, 2), null), null)).toBe('Tied 2 to 2. This is the first tournament, so Locked doubles.');
    expect(winnerWords(c(2, 2), decideFormat(c(2, 2), 'doubles'), 'doubles')).toBe('Tied 2 to 2. The last tournament was Locked doubles, so Americano.');
    expect(winnerWords(c(0, 0, 4), decideFormat(c(0, 0, 4), 'americano'), 'americano')).toBe('Nobody picked a side. The last tournament was Americano, so Locked doubles.');
    expect(JSON.stringify([winnerWords(c(2, 2), decideFormat(c(2, 2), null), null)])).not.toContain('\u2014');
  });

  it('shows who can make THAT date, what the plan fits, the votes of those same players and the winner; and writes nothing', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'locked');
    await signUp(ctx, tid, 'Casey', 'americano');
    await signUp(ctx, tid, 'Devon', 'americano');
    await signUp(ctx, tid, 'Emery', 'either');
    await signUp(ctx, tid, 'Frankie', 'locked', [OTHER]); // cannot make DATE
    const rowsBefore = JSON.stringify(raw(ctx).prepare('SELECT * FROM tournaments').all());
    const res = await fin(ctx, tid);
    expect(res.status, res.text).toBe(200);
    expect(res.data).toMatchObject({
      date: DATE,
      players: ['Blair', 'Casey', 'Devon', 'Emery'],
      fits: 6,
      over: 0,
      votes: { locked: 1, americano: 2, either: 1 },
      winner: { format: 'americano', rule: 'majority', previous: null, words: 'Americano wins, 2 to 1.' },
      format: 'doubles',
      locked: false,
      ticketCents: 1600,
    });
    expect(typeof res.data.payBy).toBe('string');
    expect(JSON.stringify(raw(ctx).prepare('SELECT * FROM tournaments').all())).toBe(rowsBefore);
    // The other date counts its own players.
    const other = await fin(ctx, tid, OTHER);
    expect(other.data.players).toEqual(['Frankie']);
    expect(other.data.votes).toEqual({ locked: 1, americano: 0, either: 0 });
  });

  it('over: more than 16 can make the date (Zip 63: the cap, 12 before): the extra start on standby once tickets open', async () => {
    const { ctx, tid } = await world();
    const names: string[] = Object.keys(ctx.byName);
    for (let i = 0; i < 14; i++) {
      const r = await ctx.organizer.call('POST', '/api/admin/players', { name: `Extra${i}` });
      ctx.byName[`Extra${i}`] = r.data.id;
      names.push(`Extra${i}`);
    }
    for (const n of names.filter((x) => x !== 'Alex').slice(0, 18)) await signUp(ctx, tid, n, 'americano');
    const res = await fin(ctx, tid);
    expect(res.data).toMatchObject({ fits: 16, over: 2 });
    expect(res.data.players).toHaveLength(18);
  });

  it('a tournament created on a format has no vote to count; the chooser starts on its format', async () => {
    const { ctx, tid } = await world({ format: 'americano' });
    await signUp(ctx, tid, 'Blair');
    const res = await fin(ctx, tid);
    expect(res.data).toMatchObject({ votes: null, winner: null, format: 'americano', players: ['Blair'] });
  });

  it('only the organizer reads it; a player, and the switch off, get nothing', async () => {
    const { ctx, tid } = await world();
    const blair = await playerPhone(ctx, 'Blair');
    expect([401, 403, 404]).toContain((await blair.call('GET', `/api/admin/tournament/${tid}/finalize?date=${DATE}`)).status);
    expect((await fin(ctx, tid, '2026-12-25')).status).toBe(400);
    expect((await fin(ctx, tid, '2020-01-01')).status).toBe(400);
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    expect((await fin(ctx, tid)).status).toBe(403);
  });

  it('overriding the winner by hand: the format is the organizer\'s (source admin), the alert shows only the format, History says so', async () => {
    const { ctx, tid } = await world();
    for (const [n, v] of [['Blair', 'americano'], ['Casey', 'americano'], ['Devon', 'americano'], ['Emery', 'locked']] as const) await signUp(ctx, tid, n, v);
    const res = await lock(ctx, tid, { format: 'doubles', seenWinner: 'americano' });
    expect(res.status, res.text).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'doubles', format_source: 'admin', final_date: DATE });
    const alert = (await card(ctx, 'Blair')).formatAlert;
    expect(alert).toMatchObject({ title: 'The Cold Open is scheduled for Thu Nov 12.', sub: 'Format: Locked doubles' });
    expect(JSON.stringify(await card(ctx, 'Blair'))).not.toMatch(/voted/);
    const line = raw(ctx).prepare("SELECT details_json FROM admin_audit_log WHERE action = 'tournament_format'").get() as { details_json: string };
    expect(JSON.parse(line.details_json)).toMatchObject({ format: 'doubles', how: 'admin', americano: 3, locked: 1 });
    expect((await dash(ctx)).formatSource).toBe('admin');
  });

  it('choosing the winner itself, or Let players vote, or nothing, keeps the vote as the source', async () => {
    for (const body of [{ format: 'americano' }, { format: 'vote' }, {}] as Record<string, unknown>[]) {
      const { ctx, tid } = await world();
      await signUp(ctx, tid, 'Blair', 'americano');
      await signUp(ctx, tid, 'Casey', 'americano');
      await signUp(ctx, tid, 'Devon', 'locked');
      expect((await lock(ctx, tid, body)).status).toBe(200);
      expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote' });
      expect((await card(ctx, 'Blair')).formatAlert.sub).toBe('Most players voted Americano.');
    }
  });

  it('the votes changed while the sheet was open and the winner moved: nothing is locked, and it says so; then Finalize again works', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey', 'locked');
    await signUp(ctx, tid, 'Devon', 'locked');
    expect((await fin(ctx, tid)).data.winner.format).toBe('doubles');
    // Two players change to Americano after the sheet opened: Americano now wins.
    for (const n of ['Casey', 'Devon']) expect((await (await playerPhone(ctx, n)).call('PUT', '/api/tournament/signup', { tournamentId: tid, formatVote: 'americano' })).status).toBe(200);
    const res = await lock(ctx, tid, { seenWinner: 'doubles' });
    expect(res.status).toBe(409);
    expect(res.data.error).toBe('votes_changed');
    expect(res.data.message).toContain('Americano wins now');
    expect(row(ctx, tid)).toMatchObject({ final_date: null, format_source: 'vote' });
    // Counts that moved without moving the winner do not stop it.
    expect((await lock(ctx, tid, { seenWinner: 'americano' })).status).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ final_date: DATE, format: 'americano', format_source: 'vote' });
  });

  it('Pay by and the ticket price from the sheet are saved with the lock; a bad Pay by is refused; the price stays once players hold tickets', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'locked');
    const payBy = '2026-11-11T22:00:00.000Z'; // Wed Nov 11, 5:00 PM Eastern
    expect((await lock(ctx, tid, { payBy: '2026-10-01T00:00:00.000Z' })).status).toBe(400);
    expect((await lock(ctx, tid, { payBy: '2026-11-12T22:00:00.000Z' })).status).toBe(400); // after the 3 hour cutoff
    expect((await lock(ctx, tid, { ticketCents: -5 })).status).toBe(400);
    expect(row(ctx, tid).final_date).toBeNull();
    const ok = await lock(ctx, tid, { payBy, ticketCents: 2000 });
    expect(ok.status, ok.text).toBe(200);
    expect(raw(ctx).prepare('SELECT pay_by, ticket_cents FROM tournaments WHERE id = ?').get(tid)).toEqual({ pay_by: payBy, ticket_cents: 2000 });
    // A plain pick keeps today's defaults.
    const b = await world();
    await signUp(b.ctx, b.tid, 'Blair', 'locked');
    expect((await lock(b.ctx, b.tid, {})).status).toBe(200);
    expect(raw(b.ctx).prepare('SELECT pay_by, ticket_cents FROM tournaments WHERE id = ?').get(b.tid)).toMatchObject({ pay_by: '2026-11-12T00:00:00.000Z', ticket_cents: 1600 });
    // Players hold tickets (Lock my spot), then Reschedule: the price and the format cannot change on the next lock.
    const lk = await (await playerPhone(b.ctx, 'Blair')).call('POST', '/api/tournament/lock', { tournamentId: b.tid, intent: 'lock', priceCents: 1600 });
    expect(lk.status, lk.text).toBe(200);
    await b.ctx.organizer.call('POST', `/api/admin/tournament/${b.tid}/reschedule`, {});
    await (await playerPhone(b.ctx, 'Blair')).call('PUT', '/api/tournament/signup', { tournamentId: b.tid, dates: [DATE] });
    const f = await fin(b.ctx, b.tid);
    expect(f.data).toMatchObject({ locked: true, votes: null, winner: null });
    expect((await lock(b.ctx, b.tid, { ticketCents: 900 })).status).toBe(409);
    expect((await lock(b.ctx, b.tid, { format: 'americano' })).status).toBe(409);
    expect((await lock(b.ctx, b.tid, { ticketCents: 1600, format: 'doubles' })).status).toBe(200);
  });

  it('counts that move without moving the winner do not stop the lock; the read writes nothing in any table', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'americano');
    await signUp(ctx, tid, 'Casey', 'americano');
    await signUp(ctx, tid, 'Devon', 'locked');
    const dump = () => JSON.stringify(['tournaments', 'tournament_signups', 'tournament_tickets', 'admin_audit_log', 'credit_ledger'].map((t) => raw(ctx).prepare(`SELECT * FROM ${t}`).all()));
    const before = dump();
    expect((await fin(ctx, tid)).data.winner.format).toBe('americano');
    expect(dump()).toBe(before);
    // Another player joins for Americano after the sheet opened: the counts moved, the winner did not.
    await signUp(ctx, tid, 'Emery', 'americano');
    const res = await lock(ctx, tid, { seenWinner: 'americano' });
    expect(res.status, res.text).toBe(200);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'vote' });
  });

  it('overriding a tie result, and a format picked at Create, both end as the organizer\'s (admin)', async () => {
    const a = await world();
    await signUp(a.ctx, a.tid, 'Blair', 'locked');
    await signUp(a.ctx, a.tid, 'Casey', 'americano');
    expect((await fin(a.ctx, a.tid)).data.winner).toMatchObject({ format: 'doubles', rule: 'tie' });
    expect((await lock(a.ctx, a.tid, { format: 'americano' })).status).toBe(200);
    expect(row(a.ctx, a.tid)).toMatchObject({ format: 'americano', format_source: 'admin' });
    expect((await card(a.ctx, 'Blair')).formatAlert.sub).toBe('Format: Americano');
    const b = await world({ format: 'doubles' });
    await signUp(b.ctx, b.tid, 'Blair');
    expect((await lock(b.ctx, b.tid, { format: 'americano' })).status).toBe(200);
    expect(row(b.ctx, b.tid)).toMatchObject({ format: 'americano', format_source: 'admin' });
  });

  it('a second Finalize tap after the date is locked changes nothing (tickets are open)', async () => {
    const { ctx, tid } = await world();
    await signUp(ctx, tid, 'Blair', 'locked');
    expect((await lock(ctx, tid, { format: 'americano' })).status).toBe(200);
    const again = await lock(ctx, tid, { format: 'doubles' });
    expect(again.status).toBe(409);
    expect(row(ctx, tid)).toMatchObject({ format: 'americano', format_source: 'admin' });
  });
});

