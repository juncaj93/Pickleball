import { describe, expect, it } from 'vitest';
import type { CreditEntryView, PlayerSessionView } from '../shared/api';
import { planCashOut, planCelebration } from '../src/celebrate';
import { applyOverlay, canJoinInstantly } from '../src/optimistic';

// Game on, the cash out notice and the instant I'm in / Drop out: the pure rules.

const session = (id: string, names: string[], mine: 'confirmed' | 'waitlisted' | null, extra: Partial<PlayerSessionView> = {}): PlayerSessionView =>
  ({
    id,
    startsAt: '2026-11-03T01:00:00.000Z',
    endsAt: '2026-11-03T03:00:00.000Z',
    canceled: false,
    started: false,
    confirmed: names.map((name) => ({ name, attendanceConfirmed: false })),
    waitlist: [],
    countText: '',
    full: names.length >= 10,
    joinAs: names.length >= 10 ? 'waitlist' : 'in',
    courtState: null,
    openSpots: Math.max(0, 10 - names.length),
    mine: mine
      ? { status: mine, waitlistPosition: null, attendanceConfirmed: false, promotion: null, shareCents: 1400, paymentStatus: 'unpaid', selfPaid: false, signupAt: 'x', oweCents: 1400, creditCents: 0, paidEarlierCents: 0, paidWithCredit: false, useCreditCents: 0, creditBackCents: 0 }
      : null,
    ...extra,
  }) as unknown as PlayerSessionView;

describe('game on celebration', () => {
  it('celebrates a game I am in at 4 or more, once', () => {
    const s = [session('a', ['Me', 'B', 'C', 'D'], 'confirmed')];
    const first = planCelebration(s, new Set());
    expect(first.now.map((x) => x.id)).toEqual(['a']);
    const again = planCelebration(s, first.next);
    expect(again.now).toEqual([]);
  });
  it('is only for games I am in', () => {
    expect(planCelebration([session('a', ['B', 'C', 'D', 'E'], null)], new Set()).now).toEqual([]);
    expect(planCelebration([session('a', ['B', 'C', 'D', 'E'], 'waitlisted')], new Set()).now).toEqual([]);
  });
  it('not under 4, not canceled, not started', () => {
    expect(planCelebration([session('a', ['Me', 'B', 'C'], 'confirmed')], new Set()).now).toEqual([]);
    expect(planCelebration([session('a', ['Me', 'B', 'C', 'D'], 'confirmed', { canceled: true })], new Set()).now).toEqual([]);
    expect(planCelebration([session('a', ['Me', 'B', 'C', 'D'], 'confirmed', { started: true })], new Set()).now).toEqual([]);
  });
  it('dropping under 4 and reaching 4 again may celebrate again', () => {
    const four = [session('a', ['Me', 'B', 'C', 'D'], 'confirmed')];
    const three = [session('a', ['Me', 'B', 'C'], 'confirmed')];
    const p1 = planCelebration(four, new Set());
    const p2 = planCelebration(three, p1.next);
    expect(p2.next.has('a')).toBe(false);
    expect(planCelebration(four, p2.next).now).toHaveLength(1);
  });
  it('5th, 6th person joining a game already celebrated stays quiet', () => {
    const p1 = planCelebration([session('a', ['Me', 'B', 'C', 'D'], 'confirmed')], new Set());
    expect(planCelebration([session('a', ['Me', 'B', 'C', 'D', 'E'], 'confirmed')], p1.next).now).toEqual([]);
  });
});

const entry = (id: string, kind: CreditEntryView['kind'], at: string, extra: Partial<CreditEntryView> = {}): CreditEntryView =>
  ({ id, kind, cents: 1400, sessionId: null, sessionStartsAt: null, at, endedAt: null, endedReason: null, reason: null, playedCount: null, ...extra }) as CreditEntryView;
const NOW = Date.parse('2026-11-03T15:00:00.000Z');

describe('cash out sent notice', () => {
  it('shows a fresh cash out once', () => {
    const h = [entry('r1', 'refunded', '2026-11-03T14:00:00.000Z')];
    const a = planCashOut(h, new Set(), NOW);
    expect(a.show?.id).toBe('r1');
    expect(planCashOut(h, a.next, NOW).show).toBeNull();
  });
  it('ignores old ones, undone ones, and entries that are not cash outs', () => {
    expect(planCashOut([entry('r1', 'refunded', '2026-09-01T00:00:00.000Z')], new Set(), NOW).show).toBeNull();
    expect(planCashOut([entry('r2', 'refunded', '2026-11-03T14:00:00.000Z', { endedAt: '2026-11-03T14:30:00.000Z' })], new Set(), NOW).show).toBeNull();
    expect(planCashOut([entry('k', 'kept', '2026-11-03T14:00:00.000Z'), entry('u', 'used', '2026-11-03T14:00:00.000Z')], new Set(), NOW).show).toBeNull();
  });
  it('a second cash out later is a new notice', () => {
    const a = planCashOut([entry('r1', 'refunded', '2026-11-03T10:00:00.000Z')], new Set(), NOW);
    const h2 = [entry('r1', 'refunded', '2026-11-03T10:00:00.000Z'), entry('r2', 'refunded', '2026-11-03T14:00:00.000Z', { cents: 900 })];
    expect(planCashOut(h2, a.next, NOW).show?.id).toBe('r2');
  });
});

describe('instant I\'m in and held Drop out', () => {
  const g = (sessions: PlayerSessionView[]) => ({ me: { id: 'p', name: 'Me' }, group: { maxPlayers: 10 }, sessions, payDue: [{ sessionId: 'a' }], owed: [{ sessionId: 'a' }] }) as never;

  it('I\'m in adds me to the count and circles but shows no money yet', () => {
    const out = applyOverlay(g([session('a', ['B', 'C', 'D'], null)]), { a: 'join' });
    const s = out.sessions[0];
    expect(s.confirmed.map((c) => c.name)).toEqual(['B', 'C', 'D', 'Me']);
    expect(s.countText).toBe('4 in');
    expect(s.mine?.status).toBe('confirmed');
    expect(s.mine?.oweCents).toBe(0);
    expect(s.mine?.useCreditCents).toBe(0);
  });
  it('a held drop removes me and the pay card for that game', () => {
    const out = applyOverlay(g([session('a', ['Me', 'B', 'C', 'D'], 'confirmed')]), { a: 'drop' });
    expect(out.sessions[0].confirmed.map((c) => c.name)).toEqual(['B', 'C', 'D']);
    expect(out.sessions[0].countText).toBe('3 of 4 in');
    expect(out.sessions[0].mine).toBeNull();
    expect(out.payDue).toEqual([]);
  });
  it('only a plain open spot is instant', () => {
    expect(canJoinInstantly(session('a', ['B'], null))).toBe(true);
    expect(canJoinInstantly(session('a', ['B'], null, { courtState: 'waitlist' }))).toBe(false);
    expect(canJoinInstantly(session('a', Array.from({ length: 10 }, (_, i) => `P${i}`), null))).toBe(false);
    expect(canJoinInstantly(session('a', ['B'], null, { canceled: true }))).toBe(false);
    expect(canJoinInstantly(session('a', ['B'], 'confirmed'))).toBe(false);
  });
  it('does nothing without an overlay', () => {
    const base = g([session('a', ['B'], null)]);
    expect(applyOverlay(base, {})).toBe(base);
  });
});
