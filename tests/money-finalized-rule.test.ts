// Money page rule (Alex, Thu Nov 5, MONEY_REWORK): a fully paid game moves to "Previous games" only once it is FINALIZED. Until then it
// stays in the main Games list (after the games somebody owes for). Within a card, unpaid players stay above paid players.
// Finalize moves it at once with instant taps on (the screen-only `finalizing` mark), and back if the save fails.
import { describe, expect, it } from 'vitest';
import { finalizedForList, splitGames } from '../src/pages/admin/moneyRework';
import { drawPatches } from '../src/instant';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const ids = (v: { s: { id: string } }[]) => v.map((g) => g.s.id);

describe('Money: fully paid games go to Previous only once finalized (real server data)', () => {
  it('F1 tonight, everyone paid, not played yet: in the main list; finalized after the game: Previous games', async () => {
    const app = new TestApp();
    const w = await setupGroup(app);
    const s = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const dash = async () => {
      let r = await w.organizer.call('GET', '/api/admin/dashboard');
      if (r.status === 401) {
        await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
        r = await w.organizer.call('GET', '/api/admin/dashboard');
      }
      return r.data;
    };
    let d = await dash();
    for (const r of d.sessions.find((x: any) => x.id === s.id).roster.filter((x: any) => x.status === 'confirmed' && x.owesCents > 0))
      expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents })).status).toBe(200);
    // Game day, a few hours before it starts: everyone paid.
    app.now = Date.parse(s.startsAt) - 3 * HOUR;
    d = await dash();
    const month = (iso: string) => new Date(Date.parse(iso) - 5 * HOUR).toISOString().slice(0, 7);
    let v = splitGames(d.sessions, month(s.startsAt), app.now, TZ);
    const game = d.sessions.find((x: any) => x.id === s.id);
    expect(game.paidCount).toBe(game.payableCount);
    expect(ids(v.main)).toContain(s.id);
    expect(ids(v.previous)).not.toContain(s.id);
    // After the game, still not finalized: still in the main list (it needs finalizing).
    app.now = Date.parse(s.endsAt) + HOUR;
    d = await dash();
    v = splitGames(d.sessions, month(s.startsAt), app.now, TZ);
    expect(ids(v.main)).toContain(s.id);
    // Finalized (4 played, $14 each, everyone paid): Previous games.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status).toBe(200);
    d = await dash();
    v = splitGames(d.sessions, month(s.startsAt), app.now, TZ);
    expect(ids(v.previous)).toContain(s.id);
    expect(ids(v.main)).not.toContain(s.id);
    // Finalize the instant way: the screen-only mark files it as finalized at once; drop the mark (a failed save) and it is back.
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    d = await dash();
    expect(ids(splitGames(d.sessions, month(s.startsAt), app.now, TZ).main)).toContain(s.id);
    const tapped = drawPatches(d, [(x: any) => ({ ...x, sessions: x.sessions.map((y: any) => (y.id === s.id ? { ...y, finalizing: true } : y)) })]);
    expect(ids(splitGames(tapped.sessions, month(s.startsAt), app.now, TZ).previous)).toContain(s.id);
    expect(ids(splitGames(drawPatches(d, []).sessions, month(s.startsAt), app.now, TZ).main)).toContain(s.id);
  });
});

describe('Money: the finalized rule on its own', () => {
  const base = (over: Record<string, unknown>) => ({ finalized: null, finalizing: undefined, ...over }) as any;
  it('F2 finalizedForList: finalized, or a Finalize tap still saving; nothing else', () => {
    expect(finalizedForList(base({}))).toBe(false);
    expect(finalizedForList(base({ finalized: { priceCents: 1400 } }))).toBe(true);
    expect(finalizedForList(base({ finalizing: true }))).toBe(true);
  });
});
