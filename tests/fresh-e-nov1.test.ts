// Fresh auditor E (Nov 1, 2026): final code-reading pass on the held drop, its note, and View as. Proofs only.
// The page logic under test is src/pages/PlayerHome.tsx look() / sendDropsBeforeJoin, which decide with the pure
// helpers from src/hold.ts against a fresh GET /api/group. These tests replay those exact decisions on the API.
import { describe, expect, it } from 'vitest';
import { noteStillApplies, pendingDropAction, type PendingDropNote } from '../src/hold';
import { firstSession, playerPhone, setupGroup, TestApp } from './harness';

// Checked and NOT a finding: a waitlisted seat's signupAt changes when it is moved in, but "Leave waitlist" is sent at
// once (run('withdraw'), PlayerHome.tsx ~1527), never held, so it never leaves a note.

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
