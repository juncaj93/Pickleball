// Fresh auditor A (Nov 1, 2026): a code-reading pass on the player side. Scratch proofs only.
// A test that fails here describes a finding; see the report for the plain-English story.
import { describe, expect, it } from 'vitest';
import { noteStillApplies, pendingDropAction } from '../src/hold';
import { HOUR, playerPhone, setupGroup, TestApp } from './harness';

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

describe('fresh A: Add my name', () => {
  it('a second name written only in non-Latin letters is refused as "already used" (both fold to an empty key)', async () => {
    const ctx = await group();
    const add = (name: string) => {
      const c = ctx.app.client();
      c.groupKey = ctx.groupKey;
      return c.call('POST', '/api/players/self', { name, confirmNew: true });
    };
    expect((await add('李明')).status).toBe(200);
    const second = await add('王芳');
    // Two different people. Today: 409 name_taken "Someone already uses "王芳"".
    expect(second.status, second.text).toBe(200);
  });

  it('same for Cyrillic names', async () => {
    const ctx = await group();
    const add = (name: string) => {
      const c = ctx.app.client();
      c.groupKey = ctx.groupKey;
      return c.call('POST', '/api/players/self', { name, confirmNew: true });
    };
    expect((await add('Дима')).status).toBe(200);
    const second = await add('Саша');
    expect(second.status, second.text).toBe(200);
  });
});

describe('fresh A: a left-over drop note belongs to the name and seat that made it (FIXED Nov 1)', () => {
  it('after the phone switches to another name, the note is forgotten, never sent as the new name', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    // Blair and Casey share a phone. Both are in Tuesday.
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const casey = await playerPhone(ctx, 'Casey');
    expect((await casey.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const bv = (await blair.call('GET', '/api/group')).data;
    // Blair's held drop was left as a note (page closed, send failed offline). It now says whose, and which seat.
    const note = { sessionId: tue.id, at: Date.now() - 30_000, playerId: bv.me.id, signupAt: bv.sessions.find((x: any) => x.id === tue.id).mine.signupAt };
    // The phone now shows Casey.
    const view = (await casey.call('GET', '/api/group')).data;
    expect(noteStillApplies(note, view)).toBe(false);
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, view), () => false)).toEqual({ do: 'forget' });
    // Blair's own phone view would still send it (the drop never landed, same seat).
    expect(noteStillApplies(note, bv)).toBe(true);
    // Casey is untouched.
    expect((await casey.call('GET', '/api/group')).data.sessions.find((x: any) => x.id === tue.id).mine.status).toBe('confirmed');
  });
});

describe('fresh A: raising Max players', () => {
  it('moves the first waiting player in on a future game, never on one that started', async () => {
    const ctx = await group({ maxPlayers: 4 });
    const tue = await on(ctx, '2026-10-27');
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie']) {
      const r = await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${tue.id}/join`, {});
      expect(r.status, r.text).toBe(200);
    }
    // Game started: raising the max must not move Emery in.
    ctx.app.now = Date.parse(tue.startsAt) + HOUR / 2;
    expect((await ctx.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 6 } })).status).toBe(200);
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const s = d.sessions.find((x: any) => x.id === tue.id) ?? null;
    if (s) expect(s.roster.filter((r: any) => r.status === 'confirmed').length).toBe(4);
  });
});

describe('fresh A: rejoin while a left-over drop note is still in its "wait" window (FIXED Nov 1)', () => {
  it('Drop out, pull to reload within 5 s, tap I\'m in on the same game: the note is not sent again', async () => {
    const ctx = await group();
    const tue = await on(ctx, '2026-10-27');
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${tue.id}/join`, {})).status).toBe(200);
    const before = (await blair.call('GET', '/api/group')).data;
    const t0 = 1_000_000;
    const note = { sessionId: tue.id, at: t0, playerId: before.me.id, signupAt: before.sessions.find((x: any) => x.id === tue.id).mine.signupAt };
    // t=2 s: pull to reload: pagehide sends the drop (keepalive) and the page dies before the note is removed.
    ctx.app.now += 2_000;
    expect((await blair.call('POST', `/api/sessions/${tue.id}/withdraw`, {})).data.result).toBe('withdrawn');
    expect(pendingDropAction(note, t0 + 3_000, () => true, () => false).do).toBe('wait');
    // t=4 s: I'm in on Tuesday (the page also forgets the note for that game; here: a new seat with a new sign-up time).
    ctx.app.now += 2_000;
    expect((await blair.call('POST', `/api/sessions/${tue.id}/join`, {})).data.result).toBe('confirmed');
    // t=7 s: the waiting look: same name, but a newer seat than the note's: forget, never send.
    const view = (await blair.call('GET', '/api/group')).data;
    expect(pendingDropAction(note, t0 + 7_100, () => noteStillApplies(note, view), () => false)).toEqual({ do: 'forget' });
    expect(view.sessions.find((x: any) => x.id === tue.id).mine.status, 'Blair should still be in').toBe('confirmed');
  });
});
