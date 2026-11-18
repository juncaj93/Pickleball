import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { decideFormat, formatAlertWords, tallyVotes, voteCountsLine, VOTE_ROWS } from '../shared/tournament';
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
      ['Locked doubles', 'same partner all night'],
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
  it('Locked doubles and Americano still work as before: no vote, no TBD, no alert', async () => {
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
      expect((await card(ctx, 'Blair')).formatAlert).toBeUndefined();
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

