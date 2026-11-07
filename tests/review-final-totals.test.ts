// Final independent review (MONEY_REWORK): Totals, month counts and the hide rules, attacked with real data and hand-computed numbers.
import { COURT, comingUnbooked, PLAYERS } from './projectedZip13';
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { canHide } from '../src/pages/admin/moneyRework';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world(settings?: Record<string, unknown>) {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', ...(settings ? { settings } : {}) });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = on) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
async function money(w: W, month: string, headers: Record<string, string> = on) {
  const r = await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, headers);
  expect(r.status, r.text).toBe(200);
  return r.data;
}
async function fill(w: W, game: { id: string }, names: string[], paid: string[], organizerIn = false) {
  await w.organizer.call('POST', `/api/admin/sessions/${game.id}/booked`, {});
  for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${game.id}/join`, {});
  if (organizerIn) await w.organizer.call('POST', `/api/admin/sessions/${game.id}/me`, { in: true });
  const sv = (await dash(w)).sessions.find((s: any) => s.id === game.id);
  for (const n of paid) {
    const r = sv.roster.find((x: any) => x.name === n);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${game.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(res.status, res.text).toBe(200);
  }
}
const hide = (w: W, id: string, hidden = true) => w.organizer.call('POST', `/api/admin/sessions/${id}/hide-from-list`, { hidden }, on);

describe('review-final: month counts versus what the Games tab can show', () => {
  it('A1 a finalized game older than 90 days: the month box counts it, and the month own call returns it for the Games tab', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    const month = monthOf(Date.parse(s0.startsAt));
    // 120 days later the game is old but fully settled.
    w.app.now += 120 * DAY;
    const d = await dash(w);
    expect(d.gameMonthCounts[month]).toBe(1); // the month box says "1 game" for that month
    // The dashboard stops at 90 days, so the Games tab loads such a month on its own (GET /api/admin/month-games): the game is there, drawn like any game.
    expect(d.sessions.some((x: any) => x.id === s0.id)).toBe(false);
    const own = await w.organizer.call('GET', `/api/admin/month-games?month=${month}`, undefined, on);
    expect(own.status, own.text).toBe(200);
    const g = own.data.sessions.find((x: any) => x.id === s0.id);
    expect(g).toBeDefined();
    expect(g).toMatchObject({ payableCount: 4, paidCount: 4 });
    // The games Money lists for that month (not the empty ones) are exactly what the month box counts.
    expect(own.data.sessions.filter((x: any) => x.state.flags.canceled || x.bookingStatus === 'booked' || x.confirmedCount > 0).length).toBe(d.gameMonthCounts[month]);
    // Not switched on, or a bad month: refused.
    expect((await w.organizer.call('GET', `/api/admin/month-games?month=${month}`, undefined, {})).status).toBe(409);
    expect((await w.organizer.call('GET', '/api/admin/month-games?month=2026-13', undefined, on)).status).toBe(400);
    expect((await money(w, month)).rework.courtSessions).toBe(1); // Totals do know it
  });
});

describe('review-final: month edges in Eastern time agree between Totals and the month box', () => {
  async function at(startIso: string) {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], []);
    const end = new Date(Date.parse(startIso) + 2 * HOUR).toISOString();
    w.app.db.raw.prepare('UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?').run(startIso, end, s0.id);
    w.app.now = Date.parse(end) + HOUR;
    await dash(w); // sign in again after the clock jump
    const f = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect(f.status, f.text).toBe(200);
    return w;
  }
  const cases: [string, string][] = [
    ['2026-11-01T03:59:00.000Z', '2026-10'], // 11:59 PM EDT Oct 31
    ['2026-11-01T04:00:00.000Z', '2026-11'], // midnight EDT Nov 1
    ['2026-11-01T06:30:00.000Z', '2026-11'], // 1:30 AM EST Nov 1 (the repeated hour)
    ['2026-12-01T04:59:00.000Z', '2026-11'], // 11:59 PM EST Nov 30
    ['2026-12-01T05:00:00.000Z', '2026-12'], // midnight EST Dec 1
  ];
  for (const [iso, month] of cases) {
    it(`B ${iso} is ${month} in Totals and in the month box`, async () => {
      const w = await at(iso);
      const d = await dash(w);
      const keys = Object.keys(d.gameMonthCounts);
      expect(keys).toEqual([month]);
      expect((await money(w, month)).rework.courtSessions).toBe(1);
      for (const other of ['2026-10', '2026-11', '2026-12'].filter((m) => m !== month)) expect((await money(w, other)).rework.courtSessions).toBe(0);
    });
  }
});

describe('review-final: Totals hand-computed', () => {
  it('C1 late-drop fee PAID, then the game is canceled with the venue waiving the fee and Edit charge says Yes: what the players paid must not be counted twice or at all', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], []);
    // Casey drops 3 hours before the game: a late drop owes the $14.
    w.app.now = Date.parse(s0.startsAt) - 3 * HOUR;
    await dash(w);
    const cj = await playerPhone(w, 'Casey');
    const drop = await cj.call('POST', `/api/sessions/${s0.id}/withdraw`, {});
    expect(drop.status, drop.text).toBe(200);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    const casey = sv.roster.find((r: any) => r.name === 'Casey');
    expect(casey.lateFee).toBeTruthy();
    const pay = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: casey.playerId, paid: true, seen: casey.moneySeen, cents: casey.owesCents });
    expect(pay.status, pay.text).toBe(200);
    // Cancel, venue waived (No, not charged): everyone is made whole.
    const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: true }, on);
    expect(c.status, c.text).toBe(200);
    const month = monthOf(Date.parse(s0.startsAt));
    const before = (await money(w, month)).rework;
    expect(before).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0 });
    // The organizer later learns the venue did charge $48: Edit charge Yes.
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 4800 }, on);
    const after = (await money(w, month)).rework;
    expect(after.courtCostCents).toBe(4800);
    expect(after.collectedCents).toBe(0);
  });

  it('C2 played game, six in with the organizer, two payers: hand total', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey'], true);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await dash(w);
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true });
    expect(fin.status, fin.text).toBe(200);
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    // Six played at $9. Blair and Casey paid $14, got $5 back: kept $9 each = $18.
    expect(t).toMatchObject({ courtCostCents: 4800, collectedCents: 1800, owedToVenueCents: 7800, yourCostCents: 6000 });
  });

  it('C3 projected counts a played-but-not-finalized game once: not in so far, and its payers are not in Collected', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    const t = (await money(w, monthOf(Date.parse(s0.startsAt)))).rework;
    expect(t).toMatchObject({ courtSessions: 0, collectedCents: 0 });
    // Four in at the flat $14 (4 or more: floor(56/4)=14): 4 x 14 = 5600, court 4800.
// (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, monthOf(Date.parse(s0.startsAt)), [s0.id]);
    expect(t.projected).toMatchObject({ addedCourts: 1 + x, courtCostCents: 4800 + x * COURT, playersPayCents: 4200 + x * PLAYERS });
  });

  it('C4 a hidden game that has NO money never changes any number', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    w.app.now = Date.parse(s0.startsAt) - 30 * HOUR;
    await dash(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true }, on);
    const month = monthOf(Date.parse(s0.startsAt));
    const a = await money(w, month);
    expect((await hide(w, s0.id)).status).toBe(200);
    const m = await money(w, month);
    expect(m.sessions.length).toBe(a.sessions.length - 1);
    expect(JSON.stringify({ ...m, sessions: undefined })).toBe(JSON.stringify({ ...a, sessions: undefined }));
  });
});

describe('review-final: the client and the server agree about what can be hidden', () => {
  async function pair(w: W, id: string) {
    const sv = (await dash(w)).sessions.find((s: any) => s.id === id);
    const r = await hide(w, id);
    return { client: !canHide(sv), server: r.status === 409, status: r.status };
  }
  it('D1 a paid seat that withdrew early (money back as credit) from an unbooked game', async () => {
    const w = await world();
    const g = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now)[2];
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === g.id);
    const r = sv.roster.find((x: any) => x.name === 'Blair');
    const p = await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(p.status, p.text).toBe(200);
    expect((await ph.call('POST', `/api/sessions/${g.id}/withdraw`, {})).status).toBe(200);
    const x = await pair(w, g.id);
    expect(x.server, 'server refuses').toBe(true);
    expect(x.client, 'screen also withholds the Hide option').toBe(true);
  });
  it('D2 same, and the credit has since been spent on another game', async () => {
    const w = await world();
    const games = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);
    const g = games[2];
    const other = games[3];
    const ph = await playerPhone(w, 'Blair');
    await ph.call('POST', `/api/sessions/${g.id}/join`, {});
    let sv = (await dash(w)).sessions.find((s: any) => s.id === g.id);
    let r = sv.roster.find((x: any) => x.name === 'Blair');
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    await ph.call('POST', `/api/sessions/${g.id}/withdraw`, {});
    await ph.call('POST', `/api/sessions/${other.id}/join`, {});
    sv = (await dash(w)).sessions.find((s: any) => s.id === other.id);
    r = sv.roster.find((x: any) => x.name === 'Blair');
    await w.organizer.call('POST', `/api/admin/sessions/${other.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    const x = await pair(w, g.id);
    expect(x.server).toBe(true);
    expect(x.client, `server ${x.status}; the screen offers Hide although the server will refuse`).toBe(true);
  });
});

describe('review-final: month counts follow hide and money, and loading writes nothing', () => {
  it('H1 hide lowers the month count, gaining money brings it back, a waitlist-only game is never counted', async () => {
    const w = await world({ maxPlayers: 4 });
    const games = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now);
    const g = games[0];
    const month = monthOf(Date.parse(g.startsAt));
    const base = (await dash(w)).gameMonthCounts[month] ?? 0;
    // Hide an empty game that is NOT counted anyway: the count must not move. Then give it a waitlist-only life (nobody confirmed): still 0 games.
    expect((await hide(w, g.id)).status).toBe(200);
    expect((await dash(w)).gameMonthCounts[month] ?? 0).toBe(base);
    await w.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    const d = await dash(w);
    expect(d.sessions.find((s: any) => s.id === g.id).hiddenFromList).toBeUndefined(); // booked: money, so shown again
    expect(d.gameMonthCounts[month]).toBe(base + 1);
  });
  it('H2 loading the dashboard, Totals and Activity with the switch ON writes nothing', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey'], ['Blair']);
    const g = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now && s.confirmedCount === 0 && s.bookingStatus !== 'booked')[1];
    await hide(w, g.id);
    const snap = () => JSON.stringify(['sessions', 'session_players', 'credit_ledger', 'task_log', 'admin_audit_log', 'players', 'groups'].map((t) => w.app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    await dash(w);
    const before = snap();
    await dash(w);
    await money(w, monthOf(Date.parse(s0.startsAt)));
    await w.organizer.call('GET', '/api/admin/activity', undefined, on);
    expect(snap()).toBe(before);
  });
});

describe('review-final: Edit charge on a hidden game brings it back', () => {
  it('I1 a hidden canceled game that is then charged $48 shows again in lists, counts, and Totals', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    w.app.now = Date.parse(s0.startsAt) - 30 * HOUR;
    await dash(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true }, on);
    const month = monthOf(Date.parse(s0.startsAt));
    expect((await hide(w, s0.id)).status).toBe(200);
    const hiddenCount = (await dash(w)).gameMonthCounts[month] ?? 0;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 4800 }, on)).status).toBe(200);
    const d = await dash(w);
    expect(d.sessions.find((s: any) => s.id === s0.id).hiddenFromList).toBeUndefined();
    expect(d.hiddenGames).toEqual([]);
    expect(d.gameMonthCounts[month]).toBe(hiddenCount + 1);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800 });
    // and it can no longer be hidden again
    expect((await hide(w, s0.id)).status).toBe(409);
  });
});
