// "Instant taps" (INSTANT_TAPS, Nov 2026): the switch, and that every guess the player screen draws ahead equals what the server says
// next (src/playerPatches.ts). The helper itself is tested in instant-taps.test.ts; the screens in e2e/instant-taps.cjs.
// The server does exactly the same work with the switch on or off: it only tells the screen how to draw a tap.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSTANT_TAPS_HEADER, instantTapsAllowed } from '../shared/instantTaps';
import { activityText } from '../shared/activity';
import { declinePatch, iPaidPatch, leaveWaitlistPatch } from '../src/playerPatches';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [INSTANT_TAPS_HEADER]: 'on' };

async function world(env: Record<string, string> = {}) {
  const app = new TestApp();
  Object.assign(app.env, env);
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W, headers: Record<string, string> = {}) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const books = (w: W) =>
  JSON.stringify([
    // By name and game time (the two worlds have different random ids).
    w.app.db.raw.prepare('SELECT s.starts_at, p.display_name, sp.status, sp.payment_status, sp.self_paid_at IS NOT NULL AS self_paid, sp.payment_amount_cents FROM session_players sp JOIN players p ON p.id = sp.player_id JOIN sessions s ON s.id = sp.session_id ORDER BY s.starts_at, p.display_name').all(),
    w.app.db.raw.prepare('SELECT c.kind, c.amount_cents, c.reason, c.ended_at IS NOT NULL AS ended, p.display_name FROM credit_ledger c JOIN players p ON p.id = c.player_id ORDER BY p.display_name, c.kind, c.amount_cents').all(),
  ]);
/** The parts of a player's view a pay or seat tap can change. */
const seat = (g: any, sid: string) => {
  const s = g.sessions.find((x: any) => x.id === sid);
  return {
    mine: s.mine ? { status: s.mine.status, paymentStatus: s.mine.paymentStatus, selfPaid: s.mine.selfPaid, oweCents: s.mine.oweCents } : null,
    waitlist: s.waitlist.map((x: any) => x.name),
    payDue: g.payDue.filter((o: any) => o.sessionId === sid).length,
    owed: g.owed.filter((o: any) => o.sessionId === sid).length,
  };
};

describe('INSTANT_TAPS switch', () => {
  it('I1 the var is allowed unless it says off', () => {
    expect(instantTapsAllowed(undefined)).toBe(true);
    expect(instantTapsAllowed('on')).toBe(true);
    expect(instantTapsAllowed(' Off ')).toBe(false);
  });

  it('I2 ship state: off for everyone; the player view carries nothing new, the dashboard only the Settings row value', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.instantTaps).toBeUndefined();
    expect(d.instantTapsForAll).toBe(false);
    const alex = await playerPhone(w, 'Alex');
    const g = (await alex.call('GET', '/api/group')).data;
    expect('instantTaps' in g).toBe(false);
  });

  it('I3 the private header turns it on for that phone only, on the player and the organizer screens', async () => {
    const w = await world();
    const alex = await playerPhone(w, 'Alex');
    expect((await alex.call('GET', '/api/group', undefined, on)).data.instantTaps).toBe(true);
    expect('instantTaps' in (await alex.call('GET', '/api/group')).data).toBe(false);
    expect((await dash(w, on)).instantTaps).toBe(true);
    expect((await dash(w, { [INSTANT_TAPS_HEADER]: 'yes' })).instantTaps).toBeUndefined();
  });

  it('I4 the Settings switch turns it on for everyone and off again (no deploy), one row, logged, organizer only', async () => {
    const w = await world();
    const alex = await playerPhone(w, 'Alex');
    const v0 = (await alex.call('GET', '/api/group/version')).data.v;
    expect((await w.organizer.call('PUT', '/api/admin/instant-taps', { on: true })).status).toBe(200);
    await w.organizer.call('PUT', '/api/admin/instant-taps', { on: true });
    expect((await w.app.db.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'instant_taps_on'").first<{ n: number }>())?.n).toBe(1);
    const d = await dash(w);
    expect(d.instantTaps).toBe(true);
    expect(d.instantTapsForAll).toBe(true);
    expect((await alex.call('GET', '/api/group')).data.instantTaps).toBe(true);
    // Players' screens notice the change on their next 5-second check.
    expect((await alex.call('GET', '/api/group/version')).data.v).not.toBe(v0);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries;
    expect(act.some((e: { action: string }) => e.action === 'instant_taps_on')).toBe(true);
    expect(activityText({ ...act.find((e: { action: string }) => e.action === 'instant_taps_on') }, 'America/Detroit', 'Alex')).toMatch(/"Instant taps" on/);
    expect((await w.app.client().call('PUT', '/api/admin/instant-taps', { on: true })).status).toBe(401);
    expect((await alex.call('PUT', '/api/admin/instant-taps', { on: false })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/instant-taps', { on: false });
    expect((await dash(w)).instantTaps).toBeUndefined();
    expect('instantTaps' in (await alex.call('GET', '/api/group')).data).toBe(false);
  });

  it('I5 the kill switch beats both the header and Settings', async () => {
    const w = await world({ INSTANT_TAPS: 'off' });
    await w.organizer.call('PUT', '/api/admin/instant-taps', { on: true });
    const alex = await playerPhone(w, 'Alex');
    expect('instantTaps' in (await alex.call('GET', '/api/group', undefined, on)).data).toBe(false);
    expect((await dash(w, on)).instantTaps).toBeUndefined();
  });

  it('I6 no migration was added for it', () => {
    const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.at(-1)).toBe('0017_court.sql'); // Zip 14 added 0017 (the court column); this feature itself still adds none
  });

  it('I7 the server saves exactly the same with the switch on or off (join, I paid, Didn\'t pay, drop, Mark paid)', async () => {
    const run = async (headers: Record<string, string>) => {
      const w = await world();
      const s = await firstSession(w);
      await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {}, headers);
      const alex = await playerPhone(w, 'Alex');
      const blair = await playerPhone(w, 'Blair');
      await alex.call('POST', `/api/sessions/${s.id}/join`, {}, headers);
      await blair.call('POST', `/api/sessions/${s.id}/join`, {}, headers);
      await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: true, cents: 1400 }, headers);
      await alex.call('POST', `/api/sessions/${s.id}/paid`, { paid: false }, headers);
      const r = (await dash(w, headers)).sessions.find((x: any) => x.id === s.id).roster.find((x: any) => x.name === 'Blair');
      await w.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents }, headers);
      await alex.call('POST', `/api/sessions/${s.id}/withdraw`, {}, headers);
      return books(w);
    };
    expect(await run(on)).toBe(await run({}));
  });
});

describe('INSTANT_TAPS: what the player screen draws ahead equals what the server says next', () => {
  it('P1 I paid: Paid (self-marked), nothing owed, the Pay card gone, on game day too', async () => {
    const w = await world();
    const s = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const casey = await playerPhone(w, 'Casey');
    await casey.call('POST', `/api/sessions/${s.id}/join`, {});
    // Game day, after the 8:00 AM cutoff: the "Tonight: you owe" card is up.
    w.app.now = Date.parse(s.startsAt) - 2 * HOUR;
    const before = (await casey.call('GET', '/api/group', undefined, on)).data;
    expect(seat(before, s.id).payDue).toBe(1);
    const cents = before.sessions.find((x: any) => x.id === s.id).mine.oweCents;
    const guess = iPaidPatch([s.id])(before);
    expect((await casey.call('POST', `/api/sessions/${s.id}/paid`, { paid: true, cents })).status).toBe(200);
    const after = (await casey.call('GET', '/api/group', undefined, on)).data;
    expect(seat(guess, s.id)).toEqual(seat(after, s.id));
  });

  it('P2 I paid on a game further out (no Pay card at the top)', async () => {
    const w = await world();
    const s = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const blair = await playerPhone(w, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    const before = (await blair.call('GET', '/api/group', undefined, on)).data;
    const cents = before.sessions.find((x: any) => x.id === s.id).mine.oweCents;
    const guess = iPaidPatch([s.id])(before);
    await blair.call('POST', `/api/sessions/${s.id}/paid`, { paid: true, cents });
    expect(seat(guess, s.id)).toEqual(seat((await blair.call('GET', '/api/group', undefined, on)).data, s.id));
  });

  it('P3 leave the waitlist: off the list, no seat, no money line', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
    const s = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
    const names = Object.keys(w.byName).filter((n) => n !== 'Robin').slice(0, 5);
    for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s.id}/join`, {});
    const last = await playerPhone(w, names[4]);
    const before = (await last.call('GET', '/api/group', undefined, on)).data;
    expect(seat(before, s.id).mine?.status).toBe('waitlisted');
    const guess = leaveWaitlistPatch(s.id, names[4])(before);
    expect((await last.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect(seat(guess, s.id)).toEqual(seat((await last.call('GET', '/api/group', undefined, on)).data, s.id));
  });

  it('P4 the guesses never touch another game, another player or the credit', async () => {
    const w = await world();
    const s = await firstSession(w);
    const alex = await playerPhone(w, 'Alex');
    await alex.call('POST', `/api/sessions/${s.id}/join`, {});
    const g = (await alex.call('GET', '/api/group', undefined, on)).data;
    for (const f of [iPaidPatch([s.id]), leaveWaitlistPatch(s.id, 'Alex'), declinePatch(s.id)]) {
      const after = f(g);
      expect(after.credit).toEqual(g.credit);
      for (const x of g.sessions.filter((x: any) => x.id !== s.id)) expect(after.sessions.find((y: any) => y.id === x.id)).toEqual(x);
      expect(after.sessions.find((y: any) => y.id === s.id)!.confirmed).toEqual(g.sessions.find((y: any) => y.id === s.id).confirmed);
    }
    // A confirmed seat is never taken off by the waitlist guess.
    expect(seat(leaveWaitlistPatch(s.id, 'Alex')(g), s.id)).toEqual(seat(g, s.id));
  });
});
