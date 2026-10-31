// Money audit part C (Oct 31, 2026): nothing happens to a player's money
// without the screen saying so. The drop-out banner says what comes back, the
// sign-up banner says what credit was used, and the credit sheet lists the
// last 10 changes in plain words, returns included.
import { describe, expect, it, vi } from 'vitest';

// The player screen module touches window when it loads; a tiny stand-in is enough here.
vi.hoisted(() => {
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, location: { pathname: '/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
});

import { creditChanges, droppedText, joinedCreditText } from '../shared/credit';
import { cashOutUsedMessage, refundRequestMessage } from '../shared/alerts';
import type { CreditEntryView } from '../shared/api';
// @ts-ignore (the player screen is checked by the app's own typecheck; this file only needs joinedText)
import { joinedText } from '../src/pages/PlayerHome';
import { playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;

async function group() {
  const ctx = await setupGroup(new TestApp());
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' })).status).toBe(200);
  return ctx;
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
async function on(ctx: Ctx, date: string) {
  const s = (await dash(ctx)).sessions.find((x: any) => dayOf(x.startsAt) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}
function givePot(ctx: Ctx, name: string, cents: number, oldId: string) {
  ctx.app.db.raw.exec(
    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
     SELECT 'pot-${name}-${cents}', id, '${ctx.byName[name]}', 'kept', ${cents}, '${oldId}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
  );
}
const card = async (phone: any, sid: string) => (await phone.call('GET', '/api/group')).data.sessions.find((s: any) => s.id === sid).mine;

describe('the words', () => {
  it('drop out: says what comes back, and nothing when nothing was paid', () => {
    expect(droppedText(0, 0)).toBe('You dropped out.');
    expect(droppedText(1400, 0)).toBe('You dropped out. $14 credit returned.');
    expect(droppedText(0, 1400)).toBe('You dropped out. $14 back as credit.');
    expect(droppedText(300, 1100)).toBe('You dropped out. $14 back as credit.');
    expect(droppedText(1400, 0, "You're out.")).toBe("You're out. $14 credit returned.");
  });

  it('sign up: says the credit used, and what is still due only once the court is booked', () => {
    expect(joinedCreditText("You're in", 0, 1400, true)).toBe("You're in");
    expect(joinedCreditText("You're in", 1400, 1400, true)).toBe("You're in. $14 credit used.");
    expect(joinedCreditText("You're in", 300, 1400, true)).toBe("You're in. $3 credit used, $11 due.");
    expect(joinedCreditText("You're in", 300, 1400, false)).toBe("You're in. $3 credit used.");
    expect(joinedCreditText('Game on!', 1400, 1400, true)).toBe('Game on! $14 credit used.');
    expect(joinedText({ result: 'confirmed', creditCents: 1400, paidWithCredit: true }, false, 1400)).toBe("You're in. $14 credit used.");
    expect(joinedText({ result: 'confirmed', creditCents: 300 }, false, 1400)).toBe("You're in. $3 credit used, $11 due.");
    expect(joinedText({ result: 'confirmed', creditCents: 300 }, true, 1400)).toBe("You're in. $3 credit used.");
    expect(joinedText({ result: 'confirmed' }, false, 1400)).toBe("You're in");
    // Waitlist and standby wording is unchanged, and a no-court game never says it.
    expect(joinedText({ result: 'waitlisted', position: 2 }, false, 1400)).toBe("You're #2 on the waitlist");
    expect(joinedText({ result: 'standby', position: 1 }, true, 1400)).toBe("You're in");
  });

  it('the credit sheet: newest first, plain words, returns included, at most 10, no em dashes', () => {
    const e = (over: Partial<CreditEntryView>): CreditEntryView => ({
      id: Math.random().toString(36),
      kind: 'kept',
      cents: 1400,
      sessionId: 's',
      sessionStartsAt: '2026-11-06T00:00:00.000Z', // Thu Nov 5, 8 PM Eastern
      at: '2026-10-30T16:00:00.000Z',
      endedAt: null,
      endedReason: null,
      reason: null,
      playedCount: null,
      ...over,
    });
    const history = [
      e({ reason: 'canceled', sessionStartsAt: '2026-10-30T00:00:00.000Z', at: '2026-10-29T20:00:00.000Z' }),
      e({ kind: 'used', reason: 'auto' as any, at: '2026-10-31T14:00:00.000Z', endedAt: '2026-10-31T15:00:00.000Z', endedReason: 'dropped' }),
      e({ kind: 'used', reason: 'auto' as any, sessionStartsAt: '2026-11-11T01:00:00.000Z', at: '2026-10-31T16:00:00.000Z' }),
      e({ kind: 'kept', reason: 'cash', at: '2026-10-31T17:00:00.000Z' }),
    ];
    expect(creditChanges(history, TZ, 'Alex').map((c) => c.text)).toEqual([
      'Oct 31: $14 used for Nov 10',
      'Oct 31: $14 returned from Nov 5 (you dropped)',
      'Oct 31: $14 used for Nov 5',
      'Oct 29: $14 back from Oct 29 (canceled)',
    ]);
    const more = [
      e({ reason: 'finalized', cents: 500, playedCount: 6 }),
      e({ reason: 'not_played' }),
      e({ reason: 'dropped' }),
      e({ kind: 'refunded', sessionId: null, sessionStartsAt: null }),
      e({ kind: 'refunded', sessionId: null, sessionStartsAt: null, endedAt: '2026-10-30T17:00:00.000Z', endedReason: 'undone' }),
      e({ kind: 'used', endedAt: '2026-10-30T17:00:00.000Z', endedReason: 'canceled' }),
      e({ kind: 'used', endedAt: '2026-10-30T17:00:00.000Z', endedReason: 'unmarked' }),
      e({ kind: 'used', endedAt: '2026-10-30T17:00:00.000Z', endedReason: 'undone' }),
      e({ reason: 'finalized', cents: 500, playedCount: 6, endedAt: '2026-10-30T17:00:00.000Z', endedReason: 'undone' }),
    ];
    const texts = creditChanges(more, TZ, 'Alex', 100).map((c) => c.text);
    for (const want of [
      'Oct 30: $5 back from Nov 5 (6 played)',
      'Oct 30: $14 back from Nov 5 (did not play)',
      'Oct 30: $14 back from Nov 5 (you dropped)',
      'Oct 30: $14 cashed out',
      'Oct 30: $14 back (cash out undone)',
      'Oct 30: $14 returned from Nov 5 (canceled)',
      'Oct 30: $14 returned from Nov 5 (Alex took it off)',
      'Oct 30: $14 returned from Nov 5 (you took it back)',
      'Oct 30: $5 taken back from Nov 5 (game changed)',
    ])
      expect(texts).toContain(want);
    expect(creditChanges(more, TZ, 'Alex')).toHaveLength(10);
    expect(texts.join(' ')).not.toMatch(/—/);
  });
});

describe('Telegram money lines', () => {
  it('carry only a first name and an amount', () => {
    expect(refundRequestMessage('Ryan S.', 1400)).toBe('Refund requested: Ryan wants $14 back.');
    expect(refundRequestMessage('Mitchel', 500)).toBe('Refund requested: Mitchel wants $5 back.');
    expect(cashOutUsedMessage('Ryan S.', 1000, 1000, '2026-11-06T01:00:00.000Z', TZ)).toBe('Ryan withdrew the $10 cash out request (using it for Thu Nov 5)');
  });
});

describe('the data behind the words', () => {
  it('each card says what a drop out would give back, matching what the drop really gives back', async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Casey', 1400, old.id);
    givePot(ctx, 'Devon', 300, old.id);
    givePot(ctx, 'Frankie', 300, old.id);
    const g = await on(ctx, '2026-11-03');
    await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    const phone: Record<string, any> = {};
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
      phone[n] = await playerPhone(ctx, n);
      expect((await phone[n].call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
    }
    for (const n of ['Blair', 'Devon']) await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName[n], paid: true });
    const want: Record<string, [number, number]> = {
      Alex: [0, 0], // the organizer: never credit
      Blair: [0, 1400], // paid cash
      Casey: [1400, 0], // paid with credit
      Devon: [300, 1100], // $3 credit + $11 cash
      Emery: [0, 0], // in, unpaid
      Frankie: [300, 0], // $3 credit, still owes $11
    };
    for (const [n, [credit, cash]] of Object.entries(want)) {
      const mine = await card(phone[n], g.id);
      expect([mine.dropCreditCents, mine.dropCashCents], n).toEqual([credit, cash]);
      const res = await phone[n].call('POST', `/api/sessions/${g.id}/withdraw`, {});
      expect(res.status, n).toBe(200);
      expect([res.data.creditReturnedCents, res.data.creditBackCents], `${n}: what the drop gave back`).toEqual([credit, cash]);
    }
  });

  it("the credit sheet's history: the use and the return show, only my own", async () => {
    const ctx = await group();
    const old = await on(ctx, '2026-10-29');
    givePot(ctx, 'Casey', 1400, old.id);
    givePot(ctx, 'Devon', 900, old.id);
    const g = await on(ctx, '2026-11-05');
    const casey = await playerPhone(ctx, 'Casey');
    const devon = await playerPhone(ctx, 'Devon');
    expect((await casey.call('POST', `/api/sessions/${g.id}/join`, {})).data).toMatchObject({ result: 'confirmed', creditCents: 1400, paidWithCredit: true });
    await devon.call('POST', `/api/sessions/${g.id}/join`, {});
    expect((await casey.call('POST', `/api/sessions/${g.id}/withdraw`, {})).data).toMatchObject({ creditReturnedCents: 1400, creditBackCents: 0 });
    const view = (await casey.call('GET', '/api/group')).data;
    expect(view.credit.balanceCents).toBe(1400);
    expect(creditChanges(view.credit.history, TZ, 'Alex').map((c) => c.text)).toEqual([
      'Oct 26: $14 returned from Nov 5 (you dropped)',
      'Oct 26: $14 used for Nov 5',
      'Oct 26: $14 back from Oct 29 (canceled)',
    ]);
    // Only Casey's entries: nothing of Devon's $9.
    expect(view.credit.history.every((h: any) => h.cents === 1400)).toBe(true);
    expect(JSON.stringify(view.credit)).not.toContain('900');
  });
});
