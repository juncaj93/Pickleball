import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { boardRows, resultsShowing } from '../shared/results';
import { changeText, levelsTable, mostImproved, trendOf, type SkillsView } from '../shared/skills';
import { countSteps, tickTimes } from '../shared/levelUp';
import { REVEAL_HOLD_MS } from '../shared/reveal';

// Zip 79 (🎾79.results skills), on the real server code with the preview's own stages and fixed names.
//   Part 1: after a tournament ends the card is one row (the name and Standings) with the final board, the night and the WHOLE next day (until
//   midnight Eastern), for everyone who can see the tournament, both styles; then gone. No money, no levels on it.
//   Part 2: Sign up starts on the level agreed at the player's last tournament (the organizer's level if he changed it); the level up counts up
//   in 0.1 steps; History > Skills (organizer only) has Most improved and the Levels table; the trend sheet's numbers.

const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
/** Thursday Nov 12, 9:00 PM Eastern (the stages' nights started earlier tonight). */
const NIGHT = Date.parse('2026-11-13T02:00:00.000Z');

async function previewWorld(extra: string[] = []) {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  ctx.app.env.PREVIEW_CALM = 'on';
  const byName: Record<string, string> = {};
  for (const n of [...NAMES, ...extra]) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
  for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
  ctx.app.now = NIGHT;
  const c = { ...ctx, byName };
  const stage = async (s: string) => {
    const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
    expect(r.status, r.text).toBe(200);
    return r.data.id as string;
  };
  const group = async (name: string) => (await (await playerPhone(c, name)).call('GET', '/api/group')).data;
  return { ctx, c, stage, group };
}

describe('zip 79 part 1: the results row', () => {
  it('Americano, the night after the reveal: the row with the final board for everyone; Vic (in it) keeps Your rounds and the reveal clock', async () => {
    const { ctx, stage, group } = await previewWorld(['Kai']);
    await stage('zip79_night');
    const vic = (await group('Vic')).tournament;
    expect(vic.status).toBe('ended');
    expect(vic.results.night).toBe(true);
    expect(vic.results.rows).toHaveLength(10);
    expect(vic.results.rows.filter((r: any) => r.medal)).toEqual([vic.results.rows[0]]);
    expect(vic.results.rows.every((r: any) => typeof r.points === 'number' && /^\d+-\d+$/.test(r.record))).toBe(true);
    expect(vic.day.kind).toBe('americano');
    expect(vic.reveal.tapMs).toBeLessThan(ctx.app.now);
    // Kai did not play: the same row and board, nothing of the night (no rounds, no reveal), no YOU.
    const kai = (await group('Kai')).tournament;
    expect(kai.results.rows.map((r: any) => r.name)).toEqual(vic.results.rows.map((r: any) => r.name));
    expect(kai.day).toBeUndefined();
    expect(kai.reveal).toBeUndefined();
    expect(kai.results.rows.some((r: any) => r.me)).toBe(false);
    // No money and no levels anywhere on it.
    const text = JSON.stringify(kai);
    expect(text).not.toMatch(/level|Cents|credit|price/i);
  });

  it('Americano: someone who was not in the night gets nothing until the reveal’s hold is over (the board tells the winner first)', async () => {
    const { ctx, stage, group } = await previewWorld(['Kai']);
    await stage('zip77_running');
    expect((await group('Kai')).tournament).toBeUndefined();
    const vic = (await group('Vic')).tournament;
    expect(vic.reveal).toBeTruthy();
    ctx.app.now += REVEAL_HOLD_MS + 10_000;
    expect((await group('Kai')).tournament.results.rows.length).toBe(10);
  });

  it('Locked doubles after End: the teams in final order, the Final’s winners first with the only medal; Vic keeps Your games; Reese (not in it) sees the row', async () => {
    const { stage, group } = await previewWorld();
    await stage('zip79_night_ld');
    const vic = (await group('Vic')).tournament;
    expect(vic.results.night).toBe(true);
    expect(vic.results.rows.map((r: any) => r.name)).toEqual(['Net Ninjas', 'Third Shot Gang', 'Dill With It', 'Kitchen Crew']);
    expect(vic.results.rows[0]).toMatchObject({ rank: 1, players: ['Vic', 'Wren'], medal: true, me: true });
    expect(vic.results.rows.filter((r: any) => r.medal)).toHaveLength(1);
    expect(vic.results.rows.every((r: any) => r.points === undefined && r.players.length === 2)).toBe(true);
    expect(vic.day.games.length).toBeGreaterThan(0);
    const reese = (await group('Reese')).tournament;
    expect(reese.results.rows).toEqual(vic.results.rows.map(({ me: _me, ...r }: any) => r));
    expect(reese.day).toBeUndefined();
  });

  it('the day after: the row alone (no rounds, no reveal), both styles; two days after: gone, while the ticker keeps its week', async () => {
    for (const [s, gone] of [
      ['zip79_next_day', 'zip79_gone'],
      ['zip79_next_day_ld', null],
    ] as const) {
      const { stage, group } = await previewWorld();
      await stage(s);
      const vic = (await group('Vic')).tournament;
      expect(vic.status).toBe('ended');
      expect(vic.results.night).toBe(false);
      expect(vic.day).toBeUndefined();
      expect(vic.reveal).toBeUndefined();
      if (gone) {
        await stage(gone);
        const g = await group('Vic');
        expect(g.tournament).toBeUndefined();
        expect(g.tourAwards.ticker).toBeTruthy();
      }
    }
  });

  it('the fake clock: the night of, the next day at 11:59 PM (still there), midnight after it (gone)', async () => {
    const { ctx, stage, group } = await previewWorld();
    await stage('zip79_night_ld');
    // Fri Nov 13, 11:59 PM Eastern (EST, UTC-5).
    ctx.app.now = Date.parse('2026-11-14T04:59:00.000Z');
    const late = (await group('Vic')).tournament;
    expect(late.results.night).toBe(false);
    expect(late.day).toBeUndefined();
    // Sat Nov 14, 12:00 AM Eastern.
    ctx.app.now = Date.parse('2026-11-14T05:00:30.000Z');
    expect((await group('Vic')).tournament).toBeUndefined();
  });

  it('Only me: a player gets nothing of an ended tournament (no row, nothing in the answer)', async () => {
    const { ctx, stage, group } = await previewWorld();
    const id = await stage('zip79_night_ld');
    ctx.app.db.raw.prepare("UPDATE tournaments SET visibility = 'me' WHERE id = ?").run(id);
    const vic = await group('Vic');
    expect(vic.tournament).toBeUndefined();
    expect(JSON.stringify(vic)).not.toMatch(/Net Ninjas|Third Shot Gang|Final standings/);
  });

  it('boardRows and resultsShowing (pure)', () => {
    expect(resultsShowing('2026-11-12', '2026-11-12')).toBe(true);
    expect(resultsShowing('2026-11-12', '2026-11-13')).toBe(true);
    expect(resultsShowing('2026-11-12', '2026-11-14')).toBe(false);
    expect(resultsShowing('2026-12-31', '2027-01-01')).toBe(true);
    expect(resultsShowing(null, '2026-11-12')).toBe(false);
    const rows = boardRows(
      'doubles',
      [
        { player_id: 'a', finish: 2, wins: 2, losses: 1, points: null, display_name: 'A', team_name: 'Two', partner_id: 'b' },
        { player_id: 'b', finish: 2, wins: 2, losses: 1, points: null, display_name: 'B', team_name: 'Two', partner_id: 'a' },
        { player_id: 'c', finish: 1, wins: 3, losses: 0, points: null, display_name: 'C', team_name: 'One', partner_id: 'd' },
        { player_id: 'd', finish: 1, wins: 3, losses: 0, points: null, display_name: 'D', team_name: 'One', partner_id: 'c' },
      ],
      'b',
    );
    expect(rows).toEqual([
      { rank: 1, name: 'One', players: ['C', 'D'], record: '3-0', medal: true },
      { rank: 2, name: 'Two', players: ['A', 'B'], record: '2-1', me: true },
    ]);
  });
});

describe('zip 79 part 2: previous level and the level up', () => {
  it('Sign up starts on the level agreed at the last tournament: the organizer’s level when he changed it; nothing for a first-timer or someone on the list', async () => {
    const { stage, group } = await previewWorld(['Kai']);
    await stage('zip79_prev');
    const vic = (await group('Vic')).tournament;
    expect(vic.status).toBe('signup');
    expect(vic.me).toBeNull();
    // Vic picked 3.2 last time and the organizer set 3.0: 3.0.
    expect(vic.previousLevel).toBe(300);
    expect((await group('Reese')).tournament.previousLevel).toBe(275);
    expect((await group('Kai')).tournament.previousLevel).toBeUndefined();
    // Parker is on the list (his own pick stands): no previous level.
    expect((await group('Parker')).tournament.previousLevel).toBeUndefined();
    // Nobody else's level is in anyone's answer.
    expect(JSON.stringify(vic)).not.toMatch(/approved|picked_level|"level":3[0-9]{2}/);
  });

  it('the count: 0.1 steps from the previous level, the last on the new level’s own label; big jumps skip steps; the ticks speed up and land at 1.8 s', () => {
    expect(countSteps(300, 340)).toEqual(['3.0', '3.1', '3.2', '3.3', '3.4']);
    expect(countSteps(275, 300)).toEqual(['2.7', '2.8', '2.9', '3.0']);
    expect(countSteps(340, 360)).toEqual(['3.4', '3.5', '3.6+']);
    const big = countSteps(250, 360);
    expect(big[0]).toBe('2.5');
    expect(big[big.length - 1]).toBe('3.6+');
    expect(big.length).toBeLessThanOrEqual(7);
    const t = tickTimes(4);
    expect(t[t.length - 1]).toBeCloseTo(1800, 5);
    const gaps = t.map((x, i) => x - (i ? t[i - 1] : 400));
    expect(gaps.every((g, i) => i === 0 || g < gaps[i - 1])).toBe(true);
  });
});

describe('zip 79 part 2: History > Skills', () => {
  it('the organizer’s skills history: Most improved Sage +0.7, Quinn +0.5, Wren +0.2; the Levels table; a player cannot read it', async () => {
    const { ctx, c, stage } = await previewWorld();
    await stage('zip79_skills');
    const r = await ctx.organizer.call('GET', '/api/admin/skills');
    expect(r.status, r.text).toBe(200);
    const v = r.data as SkillsView;
    expect(v.tournaments).toHaveLength(5);
    expect(mostImproved(v).map((x) => [x.name, changeText(x.change)])).toEqual([
      ['Sage', '+0.7'],
      ['Quinn', '+0.5'],
      ['Wren', '+0.2'],
    ]);
    const t = levelsTable(v, 'level');
    expect(t.columns).toHaveLength(3);
    const row = (n: string) => t.rows.find((x) => x.name === n)!;
    expect(row('Christopher Vanderberg').cells[0].level).toBeNull();
    expect(row('Zoe').cells[0]).toEqual({ level: 275, tone: 'down' });
    expect(changeText(row('Zoe').change)).toBe('−0.3');
    expect(changeText(row('Parker').change)).toBe('same');
    expect(row('Sage').cells.map((x) => x.tone)).toEqual(['same', 'up', 'up']);
    // Vic: the organizer's 3.0 (his own 3.2 pick does not count).
    expect(row('Vic').current).toBe(300);
    expect(levelsTable(v, 'name').rows.map((x) => x.name)).toEqual([...t.rows.map((x) => x.name)].sort((a, b) => a.localeCompare(b)));
    expect(levelsTable(v, 'improved').rows[0].name).toBe('Sage');
    const sage = trendOf(v.players.find((p) => p.name === 'Sage')!, v.today);
    expect(sage.pill?.text).toMatch(/^\+0\.7 past \d+mo$/);
    expect(sage.list[0].level).toBe(340);
    expect(sage.list[sage.list.length - 1].change).toBeNull();
    // Players never read it.
    const p = await (await playerPhone(c, 'Vic')).call('GET', '/api/admin/skills');
    expect([401, 403]).toContain(p.status);
  });
});
