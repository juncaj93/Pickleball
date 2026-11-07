// Zip 13: Players redo, Swap to Alex, Undo on admin toasts (all three ship OFF), and the projected costs fix (live at deploy).
import { describe, expect, it, vi } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { ZIP13 } from '../shared/zip13';
import { activityText } from '../shared/activity';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';
import { SaveLine, TapQueue } from '../src/instant';
import { releaseAllHolds, startHold } from '../src/undoHold';

const rw = { [MONEY_REWORK_HEADER]: 'on' };
async function world() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const monthOf = (ms: number) => new Date(ms - 5 * HOUR).toISOString().slice(0, 7);
async function fill(w: W, id: string, names: string[], paid: string[], organizerIn = false) {
  await w.organizer.call('POST', `/api/admin/sessions/${id}/booked`, {});
  for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${id}/join`, {});
  if (organizerIn) await w.organizer.call('POST', `/api/admin/sessions/${id}/me`, { in: true });
  const sv = (await dash(w)).sessions.find((s: any) => s.id === id);
  for (const n of paid) {
    const r = sv.roster.find((x: any) => x.name === n);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(res.status, res.text).toBe(200);
  }
}
const flip = (w: W, path: string, on: boolean) => w.organizer.call('PUT', `/api/admin/${path}`, { on });
const KEYS = ['playersRedo', 'playersRedoForAll', 'playersRedoMonth', 'swapButton', 'swapButtonForAll', 'adminUndo', 'adminUndoForAll'];

describe('the three switches: off by default, a Settings row, a private link, a kill switch', () => {
  it('off: none of the new fields on the dashboard, and no monthPlayed on any player', async () => {
    const w = await world();
    const d = await dash(w);
    for (const k of KEYS) expect(d[k], k).toBeUndefined();
    expect(d.players.every((p: any) => p.monthPlayed === undefined)).toBe(true);
  });
  for (const [which, path] of [
    ['playersRedo', 'players-redo-switch'],
    ['swapButton', 'swap-button-switch'],
    ['adminUndo', 'admin-undo-switch'],
  ] as const) {
    it(`${which}: the Settings row turns it on for every organizer phone, with an Activity line; the kill switch beats it; the private link works alone`, async () => {
      const w = await world();
      expect((await flip(w, path, true)).status).toBe(200);
      let d = await dash(w);
      expect(d[which]).toBe(true);
      expect(d[`${which}ForAll`]).toBe(true);
      const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === `${ZIP13[which].task.replace(/_on$/, '')}_on`);
      expect(act).toBeDefined();
      expect(activityText(act, 'America/Detroit', 'Alex')).toContain(`switched "${ZIP13[which].name}" on`);
      (w.app.env as unknown as Record<string, unknown>)[ZIP13[which].env] = 'off';
      d = await dash(w);
      expect(d[which]).toBeUndefined();
      expect(d[`${which}ForAll`]).toBe(true);
      (w.app.env as unknown as Record<string, unknown>)[ZIP13[which].env] = undefined;
      expect((await flip(w, path, false)).status).toBe(200);
      d = await dash(w);
      expect(d[which]).toBeUndefined();
      d = await dash(w, { [ZIP13[which].header]: 'on' });
      expect(d[which]).toBe(true);
      expect(d[`${which}ForAll`]).toBeUndefined();
    });
  }
  it('a player cannot flip a switch', async () => {
    const w = await world();
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('PUT', '/api/admin/players-redo-switch', { on: true })).status).toBe(401);
  });
});

describe('Players redo: the numbers', () => {
  it('monthPlayed is this month with the old "played" rule; the summary has the month and All time, Spent as the old list counted it', async () => {
    const w = await world();
    await flip(w, 'players-redo-switch', true);
    const s0 = await firstSession(w);
    await fill(w, s0.id, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true })).status).toBe(200);
    const d = await dash(w);
    const blair = d.players.find((p: any) => p.name === 'Blair');
    expect(blair.monthPlayed).toBe(1);
    expect(blair.played).toBe(1);
    expect(d.playersRedoMonth).toMatch(/^[A-Z]{3} 2026$/);
    const sum = (await w.organizer.call('GET', `/api/admin/players/${blair.id}/summary`)).data;
    expect(sum).toEqual({ month: { label: d.playersRedoMonth, played: 1, spentCents: 1400 }, allTime: { played: 1, spentCents: 1400 }, organizer: false });
    // Next month: the month card starts again at 0, All time keeps it.
    w.app.now += 35 * DAY;
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    const later = (await w.organizer.call('GET', `/api/admin/players/${blair.id}/summary`)).data;
    expect(later.month).toMatchObject({ played: 0, spentCents: 0 });
    expect(later.allTime).toEqual({ played: 1, spentCents: 1400 });
    expect((await dash(w)).players.find((p: any) => p.name === 'Blair').monthPlayed).toBe(0);
  });
  it("the organizer's Spent is Money Totals \"Your cost so far\": 2 four-player games = $30 + 2 x ($48 - 3 x $14) = $42, every month summed for All time", async () => {
    const w = await world();
    await flip(w, 'players-redo-switch', true);
    const me = (await dash(w)).me;
    const games = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now).slice(0, 2);
    expect(monthOf(Date.parse(games[0].startsAt))).toBe(monthOf(Date.parse(games[1].startsAt)));
    for (const g of games) await fill(w, g.id, ['Blair', 'Casey', 'Devon'], ['Blair', 'Casey', 'Devon'], true);
    w.app.now = Date.parse(games[1].endsAt) + HOUR;
    for (const g of games) expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    const month = monthOf(Date.parse(games[0].startsAt));
    const money = (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, rw)).data.rework;
    expect(money.yourCostCents).toBe(4200);
    const sum = (await w.organizer.call('GET', `/api/admin/players/${me.id}/summary`)).data;
    expect(sum.organizer).toBe(true);
    expect(sum.month).toMatchObject({ played: 2, spentCents: money.yourCostCents });
    expect(sum.allTime.played).toBe(2);
    // All time = the sum of every month's "Your cost so far" from the first game to now.
    expect(sum.allTime.spentCents).toBeGreaterThanOrEqual(4200);
    // The same number whether the Money page rework is on for the phone or not (one source).
    const sum2 = (await w.organizer.call('GET', `/api/admin/players/${me.id}/summary`, undefined, rw)).data;
    expect(sum2).toEqual(sum);
  });
  it('the summary is organizer only, read only, 404 for a player who is not in the group, and does not exist with the switch off', async () => {
    const w = await world();
    const d = await dash(w);
    expect((await w.organizer.call('GET', `/api/admin/players/${d.players[1].id}/summary`)).status).toBe(404);
    await flip(w, 'players-redo-switch', true);
    expect((await w.organizer.call('GET', `/api/admin/players/${d.players[1].id}/summary`)).status).toBe(200);
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('GET', `/api/admin/players/${d.players[1].id}/summary`)).status).toBe(401);
    expect((await w.organizer.call('GET', '/api/admin/players/00000000-0000-4000-8000-000000000000/summary')).status).toBe(404);
    const before = JSON.stringify((await w.organizer.call('GET', '/api/admin/backup')).data.tables.session_players);
    await w.organizer.call('GET', `/api/admin/players/${d.players[1].id}/summary`);
    expect(JSON.stringify((await w.organizer.call('GET', '/api/admin/backup')).data.tables.session_players)).toBe(before);
  });
});

describe('Swap to Alex: the Go to Admin flag on the player page', () => {
  it('only a phone signed in as the organizer (real PIN) with the switch on; never a player, never with it off, gone after sign out', async () => {
    const w = await world();
    const d = await dash(w);
    // The organizer's own phone: signed in AND picked their own name on the player page.
    const org = w.organizer;
    org.groupKey = w.groupKey;
    expect((await org.call('POST', '/api/me', { playerId: d.me.id })).status).toBe(200);
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    await flip(w, 'swap-button-switch', true);
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBe(true);
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    expect((await ph.call('GET', '/api/group', undefined, { 'X-Swap-Button': 'on' })).data.goToAdmin).toBeUndefined();
    // A made-up admin cookie on a player phone: no.
    ph.cookies.set('pb_admin', 'not-a-real-token');
    expect((await ph.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    (w.app.env as unknown as Record<string, unknown>).SWAP_BUTTON = 'off';
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    (w.app.env as unknown as Record<string, unknown>).SWAP_BUTTON = undefined;
    await org.call('POST', '/api/admin/logout', {});
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
  });
});

describe('Projected costs (Zip 13, no switch): every game still to come counts until it is canceled', () => {
  it('a Not booked and a Waitlist game count like a Booked one; a canceled game does not; the three projected lines agree', async () => {
    const w = await world();
    const coming = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);
    // A month with at least three games still to come (the world starts late in October, so November).
    const month = [...new Set(coming.map((s: any) => monthOf(Date.parse(s.startsAt))))].find((m) => coming.filter((s: any) => monthOf(Date.parse(s.startsAt)) === m).length >= 3)!;
    const inMonth = coming.filter((s: any) => monthOf(Date.parse(s.startsAt)) === month);
    expect(inMonth.length).toBeGreaterThanOrEqual(3);
    const [a, b, c] = inMonth;
    await w.organizer.call('POST', `/api/admin/sessions/${a.id}/court-status`, { status: 'booked' });
    await w.organizer.call('POST', `/api/admin/sessions/${b.id}/court-status`, { status: 'waitlist' });
    // c stays Not booked.
    const before = (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, rw)).data;
    const upcoming = before.sessions.filter((s: any) => s.state === 'upcoming').length;
    const p = before.rework.projected;
    expect(p.addedCourts).toBe(upcoming);
    expect(p.courtCostCents).toBe(upcoming * 4800);
    expect(p.playersPayCents).toBe(upcoming * 4200);
    expect(p.yourCostCents).toBe(Math.max(0, upcoming * 4800 + p.membershipCents - upcoming * 4200));
    expect(p.totalCents).toBe(p.courtCostCents + p.membershipCents);
    // Cancel the Not booked one: one court less on all three lines.
    expect((await w.organizer.call('POST', `/api/admin/sessions/${c.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    const after = (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, rw)).data.rework.projected;
    expect(after.addedCourts).toBe(upcoming - 1);
    expect(p.courtCostCents - after.courtCostCents).toBe(4800);
    expect(p.playersPayCents - after.playersPayCents).toBe(4200);
    expect(p.yourCostCents - after.yourCostCents).toBe(600);
    // Nothing about any charge, seat or credit changed: so-far numbers are the same.
    const so = (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, rw)).data.rework;
    expect({ c: so.courtCostCents, k: so.collectedCents }).toEqual({ c: before.rework.courtCostCents, k: before.rework.collectedCents });
  });
});

describe('Undo on admin toasts: the held save (src/undoHold.ts, src/instant.ts)', () => {
  it('Undo inside the window: the patch is drawn, then dropped, and the save is never called', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => 'saved');
    const q = new TapQueue<string>(() => {}, async () => {}, null, new SaveLine());
    const h = startHold(5000);
    const p = q.run({ key: 'row:1', patch: 'paid', save, hold: h.decided });
    expect(q.patches()).toEqual(['paid']);
    expect(q.busy('row:1')).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(h.undo()).toBe(true);
    expect(await p).toEqual({ status: 'undone' });
    expect(save).not.toHaveBeenCalled();
    expect(q.patches()).toEqual([]);
    expect(q.busy('row:1')).toBe(false);
    expect(h.undo()).toBe(false);
    vi.useRealTimers();
  });
  it('left alone: saved once after 5 seconds, not before; a second tap on the same thing meanwhile is ignored', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => 'saved');
    const q = new TapQueue<string>(() => {}, async () => {}, null, new SaveLine());
    const h = startHold(5000);
    const p = q.run({ key: 'row:1', patch: 'paid', save, hold: h.decided });
    expect(await q.run({ key: 'row:1', patch: 'paid', save })).toEqual({ status: 'ignored' });
    vi.advanceTimersByTime(4999);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    vi.useRealTimers();
    expect(await p).toEqual({ status: 'ok', value: 'saved' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(h.undo()).toBe(false);
  });
  it('two taps each get their own hold: undoing the first leaves the second to save; other taps do not wait behind a hold', async () => {
    vi.useFakeTimers();
    const saves: string[] = [];
    const q = new TapQueue<string>(() => {}, async () => {}, null, new SaveLine());
    const h1 = startHold(5000);
    const h2 = startHold(5000);
    const p1 = q.run({ key: 'a', patch: 'a', save: async () => void saves.push('a'), hold: h1.decided });
    const p2 = q.run({ key: 'b', patch: 'b', save: async () => void saves.push('b'), hold: h2.decided });
    const p3 = q.run({ key: 'c', patch: 'c', save: async () => void saves.push('c') });
    vi.useRealTimers();
    expect((await p3).status).toBe('ok');
    expect(saves).toEqual(['c']);
    h1.undo();
    expect((await p1).status).toBe('undone');
    h2.release();
    expect((await p2).status).toBe('ok');
    expect(saves).toEqual(['c', 'b']);
  });
  it('the page hiding lets every held save go at once (never lost)', async () => {
    const save = vi.fn(async () => 1);
    const q = new TapQueue<string>(() => {}, async () => {}, null, new SaveLine());
    const h = startHold(60_000);
    const p = q.run({ key: 'k', patch: 'x', save, hold: h.decided });
    releaseAllHolds(true);
    expect((await p).status).toBe('ok');
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('the preview seed', () => {
  it('the preview database gets the three Zip 13 rows on (npm run db:seed:preview), local test worlds only when asked', async () => {
    const { ZIP13_SWITCHES_ON } = await import('../scripts/seed-preview-world');
    expect([...ZIP13_SWITCHES_ON].sort()).toEqual(Object.values(ZIP13).map((z) => z.task).sort());
    const src = (await import('node:fs')).readFileSync('scripts/seed-preview.ts', 'utf8');
    expect(src).toContain('buildSeed(Date.now(), { zip13: true })');
  });
});
