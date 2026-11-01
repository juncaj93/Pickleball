// Fresh auditor C (Nov 1, 2026): a code-reading pass on today's player-side changes. Scratch proofs only.
// Findings are fixed (Nov 1); the tests now check the fixed behavior.
import { describe, expect, it } from 'vitest';
import { courtDisplay } from '../src/courtDisplay';
import { noteStillApplies, pendingDropAction } from '../src/hold';
import { applyOverlay } from '../src/optimistic';
import { playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';

async function group(opts: { maxPlayers?: number } = {}) {
  const ctx = await setupGroup(new TestApp());
  const body: Record<string, unknown> = { organizerName: 'Alex' };
  if (opts.maxPlayers) body.settings = { maxPlayers: opts.maxPlayers };
  expect((await ctx.organizer.call('PUT', '/api/admin/group', body)).status).toBe(200);
  return ctx;
}
type Ctx = Awaited<ReturnType<typeof group>>;
async function on(ctx: Ctx, date: string) {
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const s = d.sessions.find((x: any) => new Date(x.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === date);
  if (!s) throw new Error(`no session on ${date}`);
  return s;
}

describe('fresh C: I\'m in on another game drops a held drop that never reached the server', () => {
  // ScheduleRow passes the SCREEN's data (g={view!}: courtDisplay(applyOverlay(g, overlay))) to sendDropsBeforeJoin.
  // After a leaving send that failed with no signal, the 'drop' overlay stays on that game, so the screen's copy
  // has mine = null there: the note is judged "already out" and forgotten, and the join goes ahead.
  // FIXED Nov 1: sendDropsBeforeJoin now asks the server (GET /api/group) instead of reading the screen's copy.
  it('the screen copy would forget the note (why the screen copy is no longer used)', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const g = (await blair.call('GET', '/api/group')).data;
    const note = { sessionId: tue.id, at: Date.now() - 30_000, playerId: g.me.id, signupAt: g.sessions.find((x: any) => x.id === tue.id).mine.signupAt };
    const screen = courtDisplay(applyOverlay(g, { [tue.id]: 'drop' }));
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, screen), () => false)).toEqual({ do: 'forget' });
  });

  it('FIXED: checked against the server\'s data, the note is sent when the player taps I\'m in on another game', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const g = (await blair.call('GET', '/api/group')).data;
    const note = { sessionId: tue.id, at: Date.now() - 30_000, playerId: g.me.id, signupAt: g.sessions.find((x: any) => x.id === tue.id).mine.signupAt };
    const fresh = (await blair.call('GET', '/api/group')).data;
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'send', sessionId: tue.id });
  });
});

// Not reachable on the screen: Leave the waitlist is sent at once (never held for Undo), so it never leaves a note.
describe('fresh C: Leave the waitlist, then moved in before the note is finished', () => {
  it('the promotion changes the sign-up time, so the note is forgotten and the player stays IN (owing)', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const tue = await on(ctx, '2026-10-27');
    const phones = await Promise.all(['Alex', 'Blair', 'Casey', 'Devon', 'Emery'].map((n) => playerPhone(ctx, n)));
    for (const p of phones) expect((await p.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const emery = phones[4];
    const before = (await emery.call('GET', '/api/group')).data;
    const seat = before.sessions.find((x: any) => x.id === tue.id).mine;
    expect(seat.status).toBe('waitlisted');
    // Emery taps Leave the waitlist; the send fails with no signal while the page goes away, the note stays.
    const note = { sessionId: tue.id, at: Date.now() - 30_000, playerId: before.me.id, signupAt: seat.signupAt };
    // Meanwhile Devon drops: Emery moves in (confirmed_at = now, so signupAt changes).
    ctx.app.advance(1_000);
    expect((await phones[3].call('POST', `/api/sessions/${tue.id}/withdraw`, {})).status).toBe(200);
    const fresh = (await emery.call('GET', '/api/group')).data;
    expect(fresh.sessions.find((x: any) => x.id === tue.id).mine.status).toBe('confirmed');
    // Before today the note was sent (they were still "in or waiting"). Now: forgotten.
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'forget' });
  });
});

describe('fresh C: Add my name with accent folding', () => {
  // NFD + removing every \p{M} also strips vowel signs that are letters' meaning in Indic scripts.
  it('FIXED: two different Hindi names (Ram, Rama) are both allowed; Jose still finds José', async () => {
    const ctx = await group();
    const add = (name: string) => {
      const c = ctx.app.client();
      c.groupKey = ctx.groupKey;
      return c.call('POST', '/api/players/self', { name, confirmNew: true });
    };
    expect((await add('राम')).status).toBe(200);
    const second = await add('रमा');
    expect(second.status, second.text).toBe(200);
    ctx.app.advance(3600_000 + 1_000);
    expect((await add('José')).status).toBe(200);
    const jose = await add('Jose');
    expect(jose.status).toBe(409);
    for (const [a, b] of [['Дима', 'Саша'], ['李明', '王芳'], ['민수', '민지']]) {
      ctx.app.advance(3600_000 + 1_000); // the 3-new-names-an-hour guard
      expect((await add(a)).status, a).toBe(200);
      expect((await add(b)).status, b).toBe(200);
    }
  });
});
