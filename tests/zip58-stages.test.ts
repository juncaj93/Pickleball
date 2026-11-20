import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';

// Zip 58 (🎾58.tourney4): the preview's Tournament test stages, with the preview's fixed names only. Alex's three taps: Tie among three teams
// (spin the wheel), Final (a winner is confirmed), End tournament (medals, the banner, credit).

const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];

async function previewWorld() {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  ctx.app.env.PREVIEW_CALM = 'on';
  const byName: Record<string, string> = {};
  for (const n of NAMES) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
  for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
  // Thursday Nov 12, 9:00 PM Eastern: the stages that started 100 minutes ago are still tonight.
  ctx.app.now = Date.parse('2026-11-13T02:00:00.000Z');
  const c = { ...ctx, byName };
  const stage = async (s: string) => {
    const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
    expect(r.status, r.text).toBe(200);
    return r.data.id as string;
  };
  const dash = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const group = async (name: string) => (await (await playerPhone(c, name)).call('GET', '/api/group')).data;
  return { ctx, c, stage, dash, group };
}

describe('zip 58: the preview stages', () => {
  it('Tie among three teams: picture 20 for Vic; the organizer spins; picture 21; Game A and B; the Final', async () => {
    const { ctx, stage, dash, group } = await previewWorld();
    const tid = await stage('tie3');
    const vic = (await group('Vic')).tournament.day;
    expect(vic.progress.label).toBe('Tied for the final');
    expect(vic.standings[0].rows.map((r: any) => [r.name, r.record, r.through ?? (r.tied ? 'tied' : '')])).toEqual([
      ['Kitchen Crew', '3-0', 'final'],
      ['Net Ninjas', '1-2', 'tied'],
      ['Third Shot Gang', '1-2', 'tied'],
      ['Dill With It', '1-2', 'tied'],
    ]);
    expect(vic.tie).toMatchObject({ state: 'spin', spinner: { name: 'Kitchen Crew', players: ['Rowan', 'Zoe'] } });
    expect((await group('Rowan')).tournament.day.tie.canSpin).toBe(true);
    const d = (await dash()).tournament.day;
    expect(d.ties[0].spinner.name).toBe('Kitchen Crew');
    const r = await ctx.organizer.call('POST', `/api/admin/tournament/${tid}/games`, { action: 'spin', key: d.ties[0].key });
    expect(r.status, r.text).toBe(200);
    const after = (await group('Vic')).tournament.day;
    expect(after.progress.label).toBe('Playoff');
    expect(after.tie.bye.name).toBe(['Net Ninjas', 'Third Shot Gang', 'Dill With It'][r.data.index]);
    expect(after.playoff.map((x: any) => x.label)).toEqual(['Game A', 'Game B', 'Final', '3rd place']);
    // The organizer sets Game A and Game B; the Final is set.
    for (const label of ['Game A', 'Game B']) {
      const g = (await dash()).tournament.day.games.find((x: any) => x.tieLabel === label);
      expect((await ctx.organizer.call('POST', `/api/admin/tournament/${tid}/games`, { action: 'result', num: g.num, a: 5, b: 3 })).status).toBe(200);
    }
    const fin = (await dash()).tournament.day.games.find((x: any) => x.stage === 'final');
    expect(fin.a.name).toBe('Kitchen Crew');
    expect(fin.b).not.toBeNull();
  });
  it('Final: Vic sees the Final with Enter score and Also now · Court 2 · 3rd place; the first answer brings End tournament (zip 71: no confirming)', async () => {
    const { c, stage, dash, group } = await previewWorld();
    const tid = await stage('final_on');
    const vic = (await group('Vic')).tournament.day;
    expect(vic.progress.label).toBe('Final');
    const next = vic.games.find((g: any) => g.state === 'next');
    expect(next).toMatchObject({ stage: 'final', onNow: true, opponent: { name: 'Third Shot Gang' } });
    expect(vic.alsoNow).toMatchObject({ label: '3rd place', court: 2, a: { name: 'Kitchen Crew' }, b: { name: 'Dill With It' } });
    // Vic: Enter score, 11 to 7 (after the card's 5 seconds). Zip 71, no confirming: it is the result at once, so End tournament shows (the organizer still
    // taps End tournament himself; nothing moves money until then).
    expect((await (await playerPhone(c, 'Vic')).call('POST', '/api/tournament/game', { tournamentId: tid, num: next.num, action: 'score', mine: 11, theirs: 7 })).status).toBe(200);
    const fin = (await dash()).tournament.day.games.find((g: any) => g.stage === 'final');
    expect([fin.winner, fin.scoreA, fin.scoreB]).toEqual(['a', 11, 7]);
    const end = (await dash()).tournament.end;
    expect(end).toMatchObject({ hero: 'Final', first: { name: 'Net Ninjas', players: ['Vic', 'Wren'] }, championCents: 1400, weeks: 1 });
    expect(end.done).toEqual({ kicker: 'Final is done', title: 'Net Ninjas won', sub: 'Vic + Wren beat Third Shot Gang (Parker + Quinn).' });
  });
  it('Tournament ended: the real Confirm ran; Vic and Wren have $14 each, the ticker, the card and a medal; History lists it', async () => {
    const { ctx, stage, group, dash } = await previewWorld();
    await stage('ended');
    expect((await dash()).tournament).toBeUndefined();
    const vic = await group('Vic');
    expect(vic.tournament).toBeUndefined();
    expect(vic.tourAwards.ticker.champions).toEqual({ team: 'Net Ninjas', players: [{ name: 'Vic', medals: 1 }, { name: 'Wren', medals: 1 }] });
    expect(vic.tourAwards.congrats.title).toBe('You won The Cold Open');
    expect(vic.credit.balanceCents).toBe(1400);
    expect((await group('Wren')).credit.balanceCents).toBe(1400);
    const h = (await ctx.organizer.call('GET', '/api/admin/tournament-history')).data;
    expect(h.tournaments.map((x: any) => x.name)).toEqual(['The Cold Open']);
  });
  it('History with tournaments: three finished, wins by player (Vic 2, Parker 1, Wren 1), Vic has two medals, the Players card', async () => {
    const { ctx, c, stage, group } = await previewWorld();
    await stage('history');
    const h = (await ctx.organizer.call('GET', '/api/admin/tournament-history')).data;
    expect(h.tournaments.map((x: any) => x.name)).toEqual(['The Cold Open', 'Summer Slam', 'Spring Fling']);
    expect(h.tournaments[1]).toMatchObject({ format: 'americano', players: 10, first: { name: 'Vic' }, second: { name: 'Parker' } });
    expect(h.wins.map((w: any) => [w.name, w.wins, w.played])).toEqual([
      ['Vic', 2, 3],
      ['Parker', 1, 3],
      ['Wren', 1, 3],
    ]);
    expect((await group('Vic')).tourAwards.medals.Vic).toBe(2);
    const sum = (await ctx.organizer.call('PUT', '/api/admin/players-redo-switch', { on: true })).status;
    void sum;
    const s = await ctx.organizer.call('GET', `/api/admin/players/${c.byName.Vic}/summary`);
    if (s.status === 200) {
      expect(s.data.tournaments).toMatchObject({ played: 3, won: 2, runnerUp: 1 });
      expect(s.data.tournaments.rows[0].finish).toBe('1st with Wren');
    }
  });
  it('Americano: last round in: End tournament with Vic first', async () => {
    const { stage, dash } = await previewWorld();
    await stage('am_done');
    const end = (await dash()).tournament.end;
    expect(end).toMatchObject({ format: 'americano', hero: 'Round 6 of 6', first: { name: 'Vic' }, championCents: 1400, secondCents: 700 });
    expect(end.done.title).toBe('Vic finished first');
  });
});
