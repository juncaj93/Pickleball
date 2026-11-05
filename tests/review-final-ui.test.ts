// Final independent review (MONEY_REWORK): Text all recipients and words, instant-tap patches, hide marks surviving other actions.
import { describe, expect, it } from 'vitest';
import type { AdminSessionView } from '../shared/api';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { applyOps, opKey, type ReworkOp } from '../src/pages/admin/reworkOptimistic';
import { canTextAll, groupRemindText, splitGames, textAllRecipients } from '../src/pages/admin/moneyRework';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };
async function world() {
  const w = await setupGroup(new TestApp());
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
  }
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

describe('review-final: Text all with REAL server data', () => {
  it('E1 finalized game, one player did not play and never paid: not texted; the unpaid player who played is', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair']);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await dash(w);
    const ids = w.byName;
    const played = ['Blair', 'Casey', 'Devon', 'Emery'].map((n) => ids[n]);
    const fin = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { played });
    expect(fin.status, fin.text).toBe(200);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id) as AdminSessionView;
    const to = textAllRecipients(sv);
    // Frankie did not play (owes nothing); Blair paid. Casey, Devon, Emery owe $14 each (4 played).
    expect(sv.roster.find((r) => r.name === 'Frankie')!.owesCents).toBe(0);
    expect(to.phones.length).toBe(3);
    expect(to.missing).toEqual([]);
  });

  it('E2 canceled with the fee kept and the split on (5 in, each owes $11): "Text all" says $14, not what they owe', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
    expect((await w.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], [], true);
    w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
    const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
    expect(c.status, c.text).toBe(200);
    const d = await dash(w);
    const sv = d.sessions.find((s: any) => s.id === s0.id) as AdminSessionView;
    expect(sv.feeSplit).toMatchObject({ count: 5, priceCents: 1100 });
    const owes = sv.roster.filter((r) => !r.isOrganizer && r.owesCents > 0).map((r) => r.owesCents);
    expect(owes).toEqual([1100, 1100, 1100, 1100]);
    expect(canTextAll(sv)).toBe(true);
    const text = groupRemindText(d, sv);
    expect(text).toContain("If you haven't paid your $11 yet");
  });

  it('E3 the group text on a played, finalized game uses the final price ($11) and a game from last night says yesterday', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await fill(w, s0, ['Blair', 'Casey', 'Devon', 'Emery'], [], true);
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    await dash(w);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true })).status).toBe(200);
    w.app.now += 20 * HOUR;
    const d = await dash(w);
    const sv = d.sessions.find((s: any) => s.id === s0.id) as AdminSessionView;
    const text = groupRemindText(d, sv);
    expect(text).toContain('$11');
    expect(text).toMatch(/for (yesterday|today|tonight|tomorrow|[A-Z][a-z]{2} [A-Z][a-z]{2} \d+)'s pickleball/);
  });
});

describe('review-final: hide marks survive other actions', () => {
  it('F1 moving a hidden empty game to another day keeps it hidden (the move clears every other mark on the game)', async () => {
    const w = await world();
    const g = (await dash(w)).sessions.filter((s: any) => Date.parse(s.startsAt) > w.app.now && s.confirmedCount === 0 && s.bookingStatus !== 'booked')[1];
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden: true }, on)).status).toBe(200);
    const to = new Date(Date.parse(g.startsAt) + 3 * DAY);
    const mv = await w.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: to.toISOString(), endsAt: new Date(to.getTime() + 2 * HOUR).toISOString() });
    expect(mv.status, mv.text).toBe(200);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === g.id);
    expect(sv.hiddenFromList).toBe(true);
  });
});

describe('review-final: instant taps', () => {
  const NOW = '2026-11-04T23:00:00.000Z';
  const seat = (id: string, over: Record<string, unknown> = {}) => ({ playerId: id, name: id, status: 'confirmed', paymentStatus: 'unpaid', owesCents: 1400, shareCents: 1400, creditCents: 0, paymentAmountCents: null, paidAt: null, selfPaid: false, isOrganizer: false, lateFee: null, phone: '3135550101', ...over });
  const game = (id: string, startsAt: string, roster: any[]) => {
    const payers = roster.filter((r) => !r.isOrganizer);
    return { id, startsAt, endsAt: new Date(Date.parse(startsAt) + 2 * HOUR).toISOString(), roster, payableCount: payers.length, paidCount: payers.filter((r) => r.paymentStatus === 'paid').length, confirmedCount: payers.length, finalized: null, needsFinalize: false, state: { flags: { canceled: false } }, court: { costCents: 4800 }, chargedCents: null } as unknown as AdminSessionView;
  };
  it('G1 the tap that makes a game fully paid keeps it in the list until it is finalized (Alex, Nov 5), so nothing opens under the finger', () => {
    const a = game('A', '2026-11-05T00:00:00.000Z', [seat('a1', { paymentStatus: 'paid', owesCents: 0 }), seat('a2')]);
    const b = game('B', '2026-11-06T00:00:00.000Z', [seat('b1'), seat('b2')]);
    const d: any = { now: NOW, sessions: [a, b] };
    const before = splitGames(d.sessions, '2026-11', Date.parse(NOW), 'America/Detroit');
    expect(before.main.map((g) => g.s.id)).toEqual(['A', 'B']);
    const after = splitGames(applyOps(d, [{ kind: 'paid', sessionId: 'A', playerId: 'a2' }]).sessions, '2026-11', Date.parse(NOW), 'America/Detroit');
    // A is fully paid but not finalized: it stays in the list (after B, which still owes); nothing moves to Previous.
    expect(after.main.map((g) => g.s.id)).toEqual(['B', 'A']);
    expect(after.previous).toHaveLength(0);
    // Once finalized, it goes to Previous games.
    const done = splitGames(applyOps({ ...d, sessions: d.sessions.map((s: any) => (s.id === 'A' ? { ...s, finalized: { priceCents: 1400 } } : s)) }, [{ kind: 'paid', sessionId: 'A', playerId: 'a2' }]).sessions, '2026-11', Date.parse(NOW), 'America/Detroit');
    expect(done.main.map((g) => g.s.id)).toEqual(['B']);
    expect(done.previous.map((g) => g.s.id)).toEqual(['A']);
  });

  it('G2 two taps of different kinds on one row share a key, so the second is held', () => {
    const k = (op: ReworkOp) => opKey(op);
    expect(k({ kind: 'paid', sessionId: 's', playerId: 'p' })).toBe(k({ kind: 'unpaid', sessionId: 's', playerId: 'p' }));
    expect(k({ kind: 'clear', sessionId: 's', playerId: 'p' })).toBe(k({ kind: 'creditUndo', sessionId: 's', playerId: 'p' }));
  });

  it('G3 Mark paid then (after the screen refreshed under it) the same row patched again is idempotent', () => {
    const d: any = { now: NOW, sessions: [game('A', '2026-11-05T00:00:00.000Z', [seat('a1', { paymentStatus: 'paid', owesCents: 0, paymentAmountCents: 1400 }), seat('a2')])] };
    const once = applyOps(d, [{ kind: 'paid', sessionId: 'A', playerId: 'a1' }]);
    expect(once).toBe(d); // already paid in the data underneath: nothing changes, nothing double counted
    const counts = applyOps(d, [{ kind: 'paid', sessionId: 'A', playerId: 'a2' }, { kind: 'paid', sessionId: 'A', playerId: 'a2' }]).sessions[0];
    expect(counts.paidCount).toBe(2);
  });
});
