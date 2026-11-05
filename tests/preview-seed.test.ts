// The fake-data preview (docs/PREVIEW_FAKE_DB.md): the seed builder must produce a database that is
// consistent (the live health checks read zero), covers every game and money state, holds only made-up
// people, and can be loaded again over itself. This tests the builder only; nothing here touches Cloudflare.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { buildSeed, FAKE_GROUP_NAME, previewPin } from '../scripts/seed-preview-world';

const HEALTH = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
// A Sunday afternoon, like the day this was built: Tue Nov 3 is the next game.
const NOW = Date.parse('2026-11-01T20:00:00.000Z');

async function loaded() {
  const { sql, summary } = await buildSeed(NOW);
  const db = createNodeD1(':memory:');
  db.raw.exec(sql);
  const env: any = { DB: db };
  const call = async (method: string, path: string, cookie = '', body?: unknown, at = NOW) => {
    const h = new Headers();
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
    return { res, data: await res.json().catch(() => null) as any };
  };
  const login = await call('POST', '/api/admin/login', '', { pin: previewPin() });
  const cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const dash = (await call('GET', '/api/admin/dashboard', cookie)).data;
  return { sql, summary, db, call, cookie, dash, login };
}

describe('fake-data preview seed', () => {
  it('signs in with the fake PIN and names the group as fake', async () => {
    const { login, dash } = await loaded();
    expect(login.res.status).toBe(200);
    expect(dash.group.name).toBe(FAKE_GROUP_NAME);
  });

  it('passes every live health check (all zeros)', async () => {
    const { db } = await loaded();
    const row = db.raw.prepare(HEALTH).get() as Record<string, number>;
    const bad = Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && Number(n) !== 0);
    expect(bad).toEqual([]);
  });

  it('holds only made-up people: 313-555-01xx phones, no live names', async () => {
    const { db, sql } = await loaded();
    const players = db.raw.prepare('SELECT display_name, phone_number FROM players').all() as { display_name: string; phone_number: string }[];
    expect(players.length).toBeGreaterThanOrEqual(8);
    // Every made-up player has a 313-555-01xx number, except the one saved with no number on purpose (for Text all).
    for (const p of players) if (p.display_name !== 'Reese') expect(p.phone_number).toMatch(/^\(313\) 555-01\d\d$/);
    expect(players.find((p) => p.display_name === 'Reese')?.phone_number ?? null).toBeNull();
    expect(sql).not.toMatch(/juncaj|mitchell/i);
    expect(sql).not.toMatch(/TELEGRAM|bot\d+:/i);
  });

  it('covers every game state', async () => {
    const { dash } = await loaded();
    const games = dash.sessions as any[];
    const past = games.filter((g) => Date.parse(g.endsAt) <= NOW);
    const next = games.filter((g) => Date.parse(g.startsAt) > NOW);
    // a booked, finalized past game, and a past game never booked that still waits for "Did you guys play?"
    expect(past.some((g) => g.finalized && g.bookingStatus === 'booked')).toBe(true);
    expect(past.some((g) => g.needsFinalize && g.bookingStatus === 'needs_booking' && g.roster.length >= 4)).toBe(true);
    // the three-way court switch
    expect(next.some((g) => g.bookingStatus === 'booked' && g.status !== 'canceled')).toBe(true);
    expect(next.some((g) => g.bookingStatus === 'unavailable' && g.courtState === 'waitlist')).toBe(true);
    expect(next.some((g) => g.bookingStatus === 'needs_booking' && g.confirmedCount === 3)).toBe(true);
    // full with a real standby
    expect(next.some((g) => g.confirmedCount === 10 && g.waitlistCount === 1)).toBe(true);
    // canceled, with a reason
    expect(next.some((g) => g.status === 'canceled' && g.cancelReason === 'Court closed')).toBe(true);
  });

  it('has the live-ON switches on from the seed, plus the one being built (PREVIEW SWITCHES RULE)', async () => {
    const { dash } = await loaded();
    for (const k of ['adminV2ForAll', 'adminR2ForAll', 'adminR3ForAll', 'payAlwaysForAll', 'payNoteForAll', 'timeShiftForAll', 'lateFeesForAll', 'playerFix1ForAll', 'paySheetForAll', 'textsR2ForAll', 'lateFeeSplitForAll', 'moneyReworkForAll', 'instantTapsForAll', 'adjustCreditForAll', 'venmoRequestForAll', 'homeCollapseForAll'])
      expect(dash[k], k).toBe(true);
    // Late-cancel fee split went live on Wed Nov 4 (Alex), so it is on in the preview too.
    // The "Fee split test" game: booked, inside its 12-hour cancel-by, 6 in, three paid.
    const g = (dash.sessions as any[]).find((x) => x.note === 'Fee split test');
    expect(g).toMatchObject({ bookingStatus: 'booked', confirmedCount: 6 });
    expect(Date.parse(g.startsAt) - NOW).toBeLessThan(12 * 3_600_000);
    expect(g.roster.filter((r: any) => r.paymentStatus === 'paid' && !r.isOrganizer)).toHaveLength(3);
  });

  it('covers every money state', async () => {
    const { dash } = await loaded();
    const seats = (dash.sessions as any[]).flatMap((g) => g.roster.map((r: any) => ({ ...r, game: g })));
    const live = seats.filter((r) => r.status === 'confirmed' && r.game.status !== 'canceled' && !r.isOrganizer);
    expect(live.some((r) => r.paymentStatus === 'paid' && r.creditCents === 0 && r.paymentAmountCents === 1400)).toBe(true); // paid cash
    expect(live.some((r) => r.paymentStatus === 'paid' && r.creditCents === 1400)).toBe(true); // paid with credit
    expect(live.some((r) => r.paymentStatus === 'unpaid' && r.owesCents === 1400)).toBe(true); // owes $14
    expect(live.some((r) => r.paymentStatus === 'unpaid' && r.creditCents === 300 && r.owesCents === 1100)).toBe(true); // part credit
    const left = (dash.creditLedger as any[]).filter((l) => l.balanceCents > 0).map((l) => l.balanceCents).sort((a, b) => a - b);
    expect(left).toEqual([300, 300, 300, 1400, 1400]); // Casey $3, Harper $14, Gray $14 (Gray's is reserved by the cash-out), Lane $3 and Morgan $3 (back from the late-canceled "Fee split $11" game)
    expect((dash.refundRequests as any[]).map((r) => r.cents)).toEqual([1400]); // cash-out pending
    expect((dash.paymentClaims as any[]).length).toBe(1); // an "I paid" the organizer has not answered
  });

  it('players see the right thing through the real player screen', async () => {
    const { call, dash, db } = await loaded();
    const idOf = (name: string) => (dash.players as any[]).find((p) => p.name === name).id;
    const key = String(dash.group.privateLink).split('/g/')[1];
    // Pick a name the way a phone does: POST /api/me with the group key, keep the cookie.
    async function asPlayer(name: string) {
      const h = new Headers({ 'X-Group-Key': key, 'Content-Type': 'application/json' });
      const pick = await handleApi(new Request('https://preview.example/api/me', { method: 'POST', headers: h, body: JSON.stringify({ playerId: idOf(name) }) }), { DB: db } as any, NOW, () => {});
      const cookie = pick.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const view = await handleApi(new Request('https://preview.example/api/group', { headers: { 'X-Group-Key': key, Cookie: cookie } }), { DB: db } as any, NOW, () => {});
      return (await view.json()) as any;
    }
    void call;
    const harper = await asPlayer('Harper');
    expect(JSON.stringify(harper)).toContain('1400'); // Harper's $14 credit shows
    const kai = await asPlayer('Kai');
    expect(kai.sessions.length).toBeGreaterThan(3);
    // Players never see other players' money or phone numbers.
    expect(JSON.stringify(kai)).not.toMatch(/555-01\d\d/);
  });

  it('can be loaded again over a database that already holds the seed (and leftovers)', async () => {
    const { sql, db } = await loaded();
    db.raw.exec("INSERT INTO login_attempts (id, client_key, succeeded, attempted_at) VALUES ('x', 'phone', 0, '2026-11-01T00:00:00.000Z')");
    const before = db.raw.prepare('SELECT (SELECT COUNT(*) FROM players) p, (SELECT COUNT(*) FROM sessions) s, (SELECT COUNT(*) FROM session_players) sp, (SELECT COUNT(*) FROM credit_ledger) c').get();
    db.raw.exec(sql);
    const after = db.raw.prepare('SELECT (SELECT COUNT(*) FROM players) p, (SELECT COUNT(*) FROM sessions) s, (SELECT COUNT(*) FROM session_players) sp, (SELECT COUNT(*) FROM credit_ledger) c').get();
    expect({ ...after }).toEqual({ ...before });
    expect((db.raw.prepare('SELECT COUNT(*) n FROM login_attempts').get() as { n: number }).n).toBe(0); // a PIN lockout never carries over
    expect((db.raw.prepare('SELECT COUNT(*) n FROM groups').get() as { n: number }).n).toBe(1);
  });

  // The day this was built: Wed Nov 4, 2026, 6:00 PM Eastern. The Money page rework needs room for old games between the last two
  // played games (Thu to Tue), which a Sunday seed does not have, so this is checked on the real seed day.
  it('on a Wednesday seed it has the Money rework games: a test game to hide, two fully paid previous games, mixed payments, and an all-paid game', async () => {
    const wed = Date.parse('2026-11-04T23:00:00.000Z');
    const { sql } = await buildSeed(wed);
    const db = createNodeD1(':memory:');
    db.raw.exec(sql);
    const env: any = { DB: db };
    const get = async (path: string, cookie = '') => {
      const h = new Headers();
      if (cookie) h.set('Cookie', cookie);
      const res = await handleApi(new Request('https://preview.example' + path, { headers: h }), env, wed, () => {});
      return { res, data: (await res.json().catch(() => null)) as any };
    };
    const login = await handleApi(new Request('https://preview.example/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: previewPin() }) }), env, wed, () => {});
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const dash = (await get('/api/admin/dashboard', cookie)).data;
    const games = dash.sessions as any[];
    const by = (note: string) => games.find((g) => g.note === note);
    // The old test game: canceled early, nobody in, no money (so it can be hidden).
    expect(by('Test game')).toMatchObject({ confirmedCount: 0, status: 'canceled', roster: [], chargedCents: null });
    expect(Date.parse(by('Test game').endsAt)).toBeLessThan(wed);
    // Two previous games, played and finalized, everyone paid.
    for (const note of ['Sunday run', 'Monday run']) expect(by(note), note).toMatchObject({ payableCount: expect.any(Number), finalized: expect.anything() });
    for (const note of ['Sunday run', 'Monday run']) expect(by(note).paidCount).toBe(by(note).payableCount);
    // Mixed payments: 5 in (Christopher Vanderberg, the long name, is the fifth), 2 paid. All paid: 4 of 4.
    expect(by('Mixed payments')).toMatchObject({ confirmedCount: 5, paidCount: 2, payableCount: 5 });
    expect(by('All paid')).toMatchObject({ confirmedCount: 4, paidCount: 4, payableCount: 4 });
    // A game with 5 in (credit comes back at 5): the first coming game, and a canceled one.
    expect(games.some((g) => Date.parse(g.startsAt) > wed && g.status !== 'canceled' && g.confirmedCount === 5)).toBe(true);
    expect(games.some((g) => g.status === 'canceled' && g.cancelReason === 'Court closed')).toBe(true);
    // Text all: a game with three owing players who have numbers and one owing player with none (Reese), and one who paid.
    const chase = by('Owes, one no number');
    const owing = chase.roster.filter((r: any) => r.status === 'confirmed' && r.paymentStatus === 'unpaid' && !r.isOrganizer);
    expect(owing.filter((r: any) => r.phone).map((r: any) => r.name).sort()).toEqual(['Kai', 'Lane', 'Morgan']);
    expect(owing.filter((r: any) => !r.phone).map((r: any) => r.name)).toEqual(['Reese']);
    expect(chase.paidCount).toBe(1);
    // Ten older months (Dec 2025 to Sep 2026), 2 to 4 played games each, so the Money page's month list scrolls well past four months.
    const counts = dash.gameMonthCounts as Record<string, number>;
    const old = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    for (const m of old) expect(counts[m], m).toBeGreaterThanOrEqual(2);
    for (const m of old) expect(counts[m], m).toBeLessThanOrEqual(4);
    expect(Object.keys(counts).sort()[0]).toBe('2025-12');
    // Credit left is unchanged by the extra games, except the $3 Lane and Morgan got back from the late-canceled "Fee split $11" game.
    expect((dash.creditLedger as any[]).filter((l) => l.balanceCents > 0).map((l) => l.balanceCents).sort((a, b) => a - b)).toEqual([300, 300, 300, 1400, 1400]);
    // Still passes every live health check.
    const row = db.raw.prepare(HEALTH).get() as Record<string, number>;
    expect(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && Number(n) !== 0)).toEqual([]);
  });
});
