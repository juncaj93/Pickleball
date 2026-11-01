// Fresh auditor E (Nov 1, 2026): final code-reading pass on the held drop, its note, and View as. Proofs only.
// The page logic under test is src/pages/PlayerHome.tsx look() / sendDropsBeforeJoin, which decide with the pure
// helpers from src/hold.ts against a fresh GET /api/group. These tests replay those exact decisions on the API.
import { describe, expect, it } from 'vitest';
import { noteStillApplies, pendingDropAction, type PendingDropNote } from '../src/hold';
import { firstSession, playerPhone, setupGroup, TestApp } from './harness';

async function fullGame(maxPlayers: number) {
  const ctx = await setupGroup(new TestApp());
  expect((await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex', settings: { maxPlayers } })).status).toBe(200);
  const s = await firstSession(ctx);
  return { ctx, s };
}

describe('fresh E: a Leave waitlist note is thrown away once the player is moved in', () => {
  it('Frankie leaves the waitlist with no signal (note kept), a spot opens, Frankie reopens: the note is forgotten and Frankie is in and owes', async () => {
    const { ctx, s } = await fullGame(4);
    for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) {
      expect((await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    }
    const frankie = await playerPhone(ctx, 'Frankie');
    expect((await frankie.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const before = (await frankie.call('GET', '/api/group')).data;
    const seat = before.sessions.find((x: any) => x.id === s.id).mine;
    expect(seat.status).toBe('waitlisted');
    // Exactly what dropOut writes on "Leave waitlist"; the leaving send failed (no signal), so the note stays.
    const note: PendingDropNote = { sessionId: s.id, at: Date.now() - 30_000, playerId: before.me.id, signupAt: seat.signupAt };
    ctx.app.advance(60_000);
    // Within the 2 minutes, Blair drops: Frankie is moved in (settle sets confirmed_at, so signupAt changes).
    expect((await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    const fresh = (await frankie.call('GET', '/api/group')).data;
    const now = fresh.sessions.find((x: any) => x.id === s.id).mine;
    expect(now.status).toBe('confirmed');
    expect(now.signupAt).not.toBe(seat.signupAt);
    // look() on reopen: the note no longer "applies", so it is forgotten; the leave is never sent.
    expect(noteStillApplies(note, fresh)).toBe(false);
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'forget' });
    // Frankie, who asked to leave, now holds a seat in the game (and owes once the court is booked).
    expect(now.status).toBe('confirmed');
  });
});

describe('fresh E: the note is checked before an await and sent after it', () => {
  it('look() reads the note and GETs; meanwhile I\'m in on the same game clears the note; look() still sends the drop', async () => {
    const ctx = await setupGroup(new TestApp());
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const g = (await blair.call('GET', '/api/group')).data;
    // Left-over note (the leaving send failed with no signal): the drop never reached the server.
    const note: PendingDropNote = { sessionId: s.id, at: Date.now() - 20_000, playerId: g.me.id, signupAt: g.sessions.find((x: any) => x.id === s.id).mine.signupAt };
    // look(): `note` read from storage, then GET /api/group in flight...
    const fresh = (await blair.call('GET', '/api/group')).data;
    // ...while that GET is out, Blair (screen still drawing the drop) taps I'm in on the same game:
    // sendDropsBeforeJoin removes the note (same game), the join answers "already in".
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    // look() resumes with the note it read BEFORE the await (never re-read): send.
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'send', sessionId: s.id });
    expect((await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    // Blair tapped I'm in last, and is out.
    const after = (await blair.call('GET', '/api/group')).data;
    expect(after.sessions.find((x: any) => x.id === s.id).mine.status).toBe('withdrawn');
  });
});

describe('fresh E: a shared phone drops the other name\'s left-over note', () => {
  it('Casey drops (no signal, note kept); Devon picks his name on the same phone within 2 minutes: the note is forgotten, Casey stays in', async () => {
    const ctx = await setupGroup(new TestApp());
    const s = await firstSession(ctx);
    const phone = await playerPhone(ctx, 'Casey');
    expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    const g = (await phone.call('GET', '/api/group')).data;
    const note: PendingDropNote = { sessionId: s.id, at: Date.now() - 20_000, playerId: g.me.id, signupAt: g.sessions.find((x: any) => x.id === s.id).mine.signupAt };
    expect((await phone.call('POST', '/api/me', { playerId: ctx.byName.Devon })).status).toBe(200);
    const fresh = (await phone.call('GET', '/api/group')).data;
    expect(pendingDropAction(note, Date.now(), () => noteStillApplies(note, fresh), () => false)).toEqual({ do: 'forget' });
    const casey = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data;
    expect(casey.sessions.find((x: any) => x.id === s.id).mine.status).toBe('confirmed');
  });
});
