import { describe, expect, it } from 'vitest';
import { DAY, HOUR, playerPhone, setupGroup } from './harness';

// Zip 53: the "needs people" card at the top of the player Home is the same for every player (no Tuesday/Thursday preference).
//   1. the soonest game that still needs players (fewer than 4 in);
//   2. else the soonest game with room for one more ("Thursday has 4 in, You'd make it 5");
//   a game the player is already in (or said No to) is skipped; a canceled game never shows.
// The clock is Monday Oct 26, 12 PM: Tuesday Oct 27 8 PM and Thursday Oct 29 7:30 PM are the first two games.

type Ctx = Awaited<ReturnType<typeof setupGroup>>;

const EXTRA = ['Gale', 'Harper', 'Indy'];

async function world() {
  const ctx = await setupGroup();
  for (const name of EXTRA) ctx.byName[name] = (await ctx.organizer.call('POST', '/api/admin/players', { name })).data.id;
  const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const upcoming = dash.sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now).sort((a: any, b: any) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const [tue, thu] = upcoming;
  expect(new Date(tue.startsAt).toISOString()).toBe('2026-10-28T00:00:00.000Z'); // Tue Oct 27, 8 PM EDT
  expect(new Date(thu.startsAt).toISOString()).toBe('2026-10-30T00:00:00.000Z'); // Thu Oct 29, 8 PM EDT
  return { ctx, tue, thu };
}

async function join(ctx: Ctx, sessionId: string, names: string[]) {
  for (const n of names) expect((await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${sessionId}/join`, {})).status, n).toBe(200);
}

/** What this player's Home would draw as the top card (the field the screen reads), or null. */
async function card(ctx: Ctx, name: string) {
  return (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.suggestion as null | { sessionId: string; confirmedCount: number; joinAs: string };
}

const ALL = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...EXTRA];

describe("Alex's example: Tuesday has 2 in, Thursday has 4 in", () => {
  it('every player who is in neither game sees Tuesday ("Tomorrow needs 2 more"); a player already in Tuesday sees Thursday', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Alex', 'Blair']);
    await join(ctx, thu.id, ['Casey', 'Devon', 'Emery', 'Frankie']);
    // In neither game: the same card for all, Tuesday, 2 in (the screen says "needs 2 more").
    for (const n of EXTRA) expect(await card(ctx, n), n).toMatchObject({ sessionId: tue.id, confirmedCount: 2, joinAs: 'in' });
    // In Tuesday: no card for Tuesday, the next game that qualifies is Thursday ("Thursday has 4 in", "You'd make it 5").
    for (const n of ['Alex', 'Blair']) expect(await card(ctx, n), n).toMatchObject({ sessionId: thu.id, confirmedCount: 4, joinAs: 'in' });
    // In Thursday only: Tuesday still needs players.
    for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) expect(await card(ctx, n), n).toMatchObject({ sessionId: tue.id, confirmedCount: 2 });
  });

  it('View as shows each player exactly the card that player would see (the same card for everyone alike)', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Alex', 'Blair']);
    await join(ctx, thu.id, ['Casey', 'Devon', 'Emery', 'Frankie']);
    for (const [name, want] of [['Gale', tue.id], ['Harper', tue.id], ['Indy', tue.id], ['Alex', thu.id], ['Casey', tue.id]] as const) {
      const viewed = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName[name] })).data;
      expect(viewed.viewingAs).toBe(true);
      expect(viewed.suggestion?.sessionId, name).toBe(want);
      expect(viewed.suggestion).toEqual(await card(ctx, name));
    }
  });

  it('players with different old stored days and regular marks still get the same card', async () => {
    const { ctx, tue } = await world();
    const set = async (name: string, days: string, regular: number) => {
      await ctx.app.db.prepare('UPDATE players SET usual_days = ?, is_regular = ? WHERE display_name = ?').bind(days, regular, name).run();
    };
    await set('Gale', '4', 1);
    await set('Harper', '2', 1);
    await set('Indy', '2,4', 0);
    await set('Emery', '', 0);
    await set('Frankie', '', 1);
    const cards = await Promise.all(['Gale', 'Harper', 'Indy', 'Emery', 'Frankie', 'Casey'].map((n) => card(ctx, n)));
    for (const c of cards) expect(c).toMatchObject({ sessionId: tue.id, confirmedCount: 0 });
    expect(new Set(cards.map((c) => JSON.stringify(c))).size).toBe(1);
  });
});

describe('which game the card picks', () => {
  it('a game that needs players beats an earlier game that only has room (Tuesday 5 in, Thursday 3 in: Thursday)', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey']);
    expect(await card(ctx, 'Gale')).toMatchObject({ sessionId: thu.id, confirmedCount: 3 });
  });

  it('when both need players, the soonest one (Tuesday 3 in, Thursday 1 in: Tuesday)', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey']);
    await join(ctx, thu.id, ['Alex']);
    expect(await card(ctx, 'Gale')).toMatchObject({ sessionId: tue.id, confirmedCount: 3 });
  });

  it('nobody needs players: the soonest game with room for a 5th (Tuesday 4 in, Thursday 5 in: Tuesday)', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']);
    for (const n of ['Frankie', 'Gale', 'Harper']) expect(await card(ctx, n), n).toMatchObject({ sessionId: tue.id, confirmedCount: 4, joinAs: 'in' });
    // A player in Tuesday gets Thursday instead; a player in both gets nothing.
    expect(await card(ctx, 'Alex')).toBeNull();
    await join(ctx, thu.id, ['Frankie']);
    expect(await card(ctx, 'Frankie')).toMatchObject({ sessionId: tue.id });
  });

  it('nobody needs players and the soonest is full: the next game with room; all full: no card', async () => {
    const { ctx, tue, thu } = await world();
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
    await join(ctx, tue.id, ['Alex', 'Blair', 'Casey', 'Devon']); // full at 4
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey']);
    // Thursday still needs one: that is the card.
    expect(await card(ctx, 'Gale')).toMatchObject({ sessionId: thu.id, confirmedCount: 3 });
    await join(ctx, thu.id, ['Devon']); // both full at 4
    expect(await card(ctx, 'Gale')).toBeNull();
    // Two spots free up on Thursday (max 6): Tuesday and Thursday both have room, Tuesday (soonest) wins.
    await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } });
    expect(await card(ctx, 'Gale')).toMatchObject({ sessionId: tue.id, confirmedCount: 4 });
  });

  it('a game that already started, or is more than 8 days away, is never the card', async () => {
    const { ctx, tue, thu } = await world();
    const all = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now).sort((a: any, b: any) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const [, , nov3, nov5] = all; // Tue Nov 3 (inside 8 days of Tuesday Oct 27) and Thu Nov 5 (outside)
    ctx.app.now = Date.parse(tue.startsAt) + HOUR; // Tuesday is under way: it is never the card
    expect((await card(ctx, 'Gale'))!.sessionId).not.toBe(tue.id);
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(thu.id); // Thursday has 0 in: it needs players, and is the soonest
    await join(ctx, thu.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    await join(ctx, nov3.id, ['Alex', 'Blair', 'Casey', 'Devon']);
    // Everything inside 8 days has 4 in: the soonest with room is Thursday. Thu Nov 5 (0 in, but beyond 8 days) is never offered.
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(thu.id);
    expect((await card(ctx, 'Gale'))!.sessionId).not.toBe(nov5.id);
    ctx.app.now = Date.parse(thu.startsAt) + DAY; // Thursday is over: the next one inside its 8 days
    expect((await card(ctx, 'Gale'))!.sessionId).not.toBe(thu.id);
  });
});

describe('who gets no card for a game', () => {
  it('a player who said No does not see that game again and sees the next one; others still see it', async () => {
    const { ctx, tue, thu } = await world();
    const gale = await playerPhone(ctx, 'Gale');
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(tue.id);
    expect((await gale.call('POST', `/api/sessions/${tue.id}/decline`, {})).data).toEqual({ result: 'declined' });
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(thu.id);
    expect((await gale.call('POST', `/api/sessions/${thu.id}/decline`, {})).data).toEqual({ result: 'declined' });
    expect(await card(ctx, 'Gale')).toBeNull(); // said No to both
    expect((await card(ctx, 'Harper'))!.sessionId).toBe(tue.id);
  });

  it('a player who dropped out of a game is not asked about it again', async () => {
    const { ctx, tue, thu } = await world();
    await join(ctx, tue.id, ['Gale']);
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(thu.id);
    expect((await (await playerPhone(ctx, 'Gale')).call('POST', `/api/sessions/${tue.id}/withdraw`, {})).status).toBe(200);
    expect((await card(ctx, 'Gale'))!.sessionId).toBe(thu.id);
  });

  it('a canceled game never shows', async () => {
    const { ctx, tue, thu } = await world();
    const res = await ctx.organizer.call('POST', `/api/admin/sessions/${tue.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Court closed' });
    expect(res.status).toBe(200);
    for (const n of ALL) expect((await card(ctx, n))!.sessionId, n).toBe(thu.id);
  });

  it('nobody picked yet (no name on the phone): no card, and the answer has no field about preferences', async () => {
    const { ctx } = await world();
    const stranger = ctx.app.client();
    stranger.groupKey = ctx.groupKey;
    const g = (await stranger.call('GET', '/api/group')).data;
    expect(g.suggestion).toBeNull();
    expect(JSON.stringify(g)).not.toMatch(/usualDays|usual_days|preferred/i);
  });
});

describe('the preference is gone from every answer and every write', () => {
  it('the organizer dashboard no longer lists usual days; the old sign-up route is gone; the stored column is untouched', async () => {
    const { ctx } = await world();
    await ctx.app.db.prepare("UPDATE players SET usual_days = '2,4' WHERE display_name = 'Gale'").run();
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(JSON.stringify(dash)).not.toMatch(/usualDays|usual_days/);
    // An organizer save (an old screen even sends the field) changes nothing in the stored column.
    const gale = dash.players.find((p: any) => p.name === 'Gale');
    expect((await ctx.organizer.call('PUT', `/api/admin/players/${gale.id}`, { name: 'Gale', isRegular: true, isActive: true, usualDays: [4] })).status).toBe(200);
    const stored = await ctx.app.db.prepare("SELECT usual_days FROM players WHERE display_name = 'Gale'").first<{ usual_days: string }>();
    expect(stored?.usual_days).toBe('2,4');
    expect((await (await playerPhone(ctx, 'Gale')).call('PUT', '/api/me/days', { days: [2] })).status).toBe(404);
  });
});
