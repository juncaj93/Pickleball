// Audit 73 (privacy, proof only): one Locked doubles night and one Americano night on the harness world, the organizer's own level for every
// player set with the real pencil (different from each pick), and every player's GET /api/group dumped at each step: signed up, tickets open,
// all locked, teams DRAFTED (not published), published, game night, after the Final, ended. Also View as (the organizer showing a player's
// screen) and a phone with no name. No level other than their own pick, no draft before Publish, no other player's money.
import { describe, expect, it, vi } from 'vitest';
import { playerPhone, withoutIds } from './harness';
import { ALL, adminTour, awards, games, playPools, setWinner, START_MS, teams, world, type World } from './zip58-world';

vi.setConfig({ testTimeout: 300_000 });

// The organizer's rating for player i (valid levels, always different from the pick world() made: 360 350 340 320 320 300 275 250).
const RATED = [250, 275, 300, 350, 360, 340, 320, 300, 250, 275];

function badKeys(x: unknown, path = ''): string[] {
  if (!x || typeof x !== 'object') return [];
  return Object.entries(x as Record<string, unknown>).flatMap(([k, v]) => {
    const p = Array.isArray(x) ? `${path}[]` : path ? `${path}.${k}` : k;
    const here: string[] = [];
    if (/level|approved|rating|projected/i.test(k) && p !== 'tournament.me.level' && p !== 'tournament.lockedLevel') here.push(p);
    if (/^total$/.test(k) && p !== 'tournament.day.progress.total') here.push(p);
    if (p.startsWith('tournament') && /cents|credit|paid|owed|claim/i.test(k) && !/^tournament\.(tickets\.mine\.|tickets\.priceCents|canceled\.)/.test(p)) here.push(p);
    if (/phone|venmo/i.test(k) && p !== 'group.venmoUrl') here.push(p);
    return [...here, ...badKeys(v, p)];
  });
}

async function dumpAll(ctx: World, names: string[], step: string, out: string[], pick: Map<string, number>) {
  for (const name of names) {
    const phone = await playerPhone(ctx, name);
    const g = await phone.call('GET', '/api/group');
    for (const k of badKeys(g.data)) out.push(`${step} ${name}: ${k}`);
    const text = withoutIds(g.text);
    if (/approved|picked_level|pickedLevel/i.test(text)) out.push(`${step} ${name}: level field name in text`);
    const me = g.data.tournament?.me;
    if (me && me.level !== pick.get(name)) out.push(`${step} ${name}: me.level ${me.level} is not their pick ${pick.get(name)}`);
    // View as: the organizer's screen of this player must carry the same (no organizer level).
    const va = await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[name] });
    for (const k of badKeys(va.data)) out.push(`${step} viewAs ${name}: ${k}`);
    if (va.data.tournament?.me && va.data.tournament.me.level !== pick.get(name)) out.push(`${step} viewAs ${name}: me.level is not their pick`);
  }
  const anon = ctx.app.client();
  anon.groupKey = ctx.groupKey;
  const n = await anon.call('GET', '/api/group');
  if (n.data.group.venmoUrl || 'zelleNumber' in n.data.group || n.data.tournament || n.data.tourAwards || n.text.includes('The Cold Open')) out.push(`${step} no-name phone: payment details or tournament`);
}

async function rateAll(ctx: World, names: string[]) {
  for (const [i, name] of names.entries()) {
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/level`, { playerId: ctx.byName[name], level: RATED[i % RATED.length] });
    expect(r.status, r.text).toBe(200);
  }
}

const pickOf = (ctx: World) =>
  new Map((ctx.app.db.raw.prepare('SELECT p.display_name AS n, s.picked_level AS l FROM tournament_signups s JOIN players p ON p.id = s.player_id').all() as { n: string; l: number }[]).map((r) => [r.n, r.l]));

describe('audit 73: levels and money never reach players across a whole night', () => {
  it('Locked doubles, 8 players: every step, every phone, View as', async () => {
    const ctx = await world(8);
    const names = ALL.slice(0, 8);
    await rateAll(ctx, names);
    const pick = pickOf(ctx);
    const out: string[] = [];
    await dumpAll(ctx, names, 'locked', out, pick);
    expect((await teams(ctx, { action: 'draft' })).status).toBe(200);
    // Drafted, not published: no player sees a team, a partner or a game.
    for (const name of names) {
      const t = (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
      if (t.day) out.push(`drafted ${name}: day view before Publish`);
    }
    const draftNames = (await adminTour(ctx)).day.teams.map((x: any) => x.name).filter(Boolean);
    for (const name of names) {
      const text = (await (await playerPhone(ctx, name)).call('GET', '/api/group')).text;
      for (const dn of draftNames) if (dn && !/^Team \d+$/.test(dn) && text.includes(dn)) out.push(`drafted ${name}: draft team name ${dn}`);
    }
    await dumpAll(ctx, names, 'drafted', out, pick);
    expect((await teams(ctx, { action: 'publish' })).status).toBe(200);
    await dumpAll(ctx, names, 'published', out, pick);
    ctx.app.now = START_MS + 60_000;
    await dumpAll(ctx, names, 'night', out, pick);
    ctx.app.now = START_MS + 90 * 60_000;
    await playPools(ctx, (a, b) => Math.min(a, b));
    const d = (await adminTour(ctx)).day;
    await setWinner(ctx, d.games.find((g: any) => g.stage === 'third').num, 3);
    await setWinner(ctx, d.games.find((g: any) => g.stage === 'final').num, 1);
    await dumpAll(ctx, names, 'final', out, pick);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    await dumpAll(ctx, names, 'ended', out, pick);
    expect(out).toEqual([]);
  });

  it('Americano, 9 players (odd: the style switch), scores in: every phone, View as', async () => {
    const ctx = await world(9, { format: 'americano' });
    const names = ALL.slice(0, 9);
    await rateAll(ctx, names);
    const pick = pickOf(ctx);
    const out: string[] = [];
    await dumpAll(ctx, names, 'locked', out, pick);
    ctx.app.now = START_MS + 60_000;
    await dumpAll(ctx, names, 'night', out, pick);
    const r = await (await adminTour(ctx)).rounds;
    if (r?.games?.length) {
      const g = r.games[0];
      await games(ctx, { action: 'result', num: g.num, winner: 'a' });
    }
    await dumpAll(ctx, names, 'scored', out, pick);
    expect(out).toEqual([]);
  });
});
