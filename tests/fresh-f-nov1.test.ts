// Fresh auditor F (Nov 1, 2026) found that the drop note had one slot: a drop on game A that never reached the
// server (app switched with no signal) was wiped out by Drop out on game B, so A was never sent. FIXED: one note per
// game (src/dropNotes.ts). These tests use the real note list against the API.
import { beforeEach, describe, expect, it } from 'vitest';
import { addNote, forgetGame, readNotes, removeNote } from '../src/dropNotes';
import { noteStillApplies, pendingDropAction, type PendingDropNote } from '../src/hold';
import { playerPhone, setupGroup, TestApp } from './harness';

const KEY = 'pb_pending_drop';
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('drop notes: one per game (FIXED Nov 1)', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = fakeStorage();
  });

  it('Drop out on B never wipes out the unsent drop on A; A is still sent later and lands', async () => {
    const ctx = await setupGroup(new TestApp());
    const dash = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const [a, b] = dash.data.sessions.filter((s: any) => Date.parse(s.startsAt) > ctx.app.now);
    const blair = await playerPhone(ctx, 'Blair');
    expect((await blair.call('POST', `/api/sessions/${a.id}/join`, {})).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${b.id}/join`, {})).status).toBe(200);
    const g = (await blair.call('GET', '/api/group')).data;
    const mineOf = (id: string) => g.sessions.find((x: any) => x.id === id).mine;
    const t0 = Date.now();
    // 1. Drop out on A; the app is switched away with no signal: the send fails, note A stays.
    const noteA: PendingDropNote = { sessionId: a.id, at: t0, playerId: g.me.id, signupAt: mineOf(a.id).signupAt };
    addNote(noteA);
    // 2. Back on the page, Drop out on B: its own note, A's is kept. B lands and removes only its own note.
    const noteB: PendingDropNote = { sessionId: b.id, at: t0 + 9_000, playerId: g.me.id, signupAt: mineOf(b.id).signupAt };
    addNote(noteB);
    expect(readNotes().map((n) => n.sessionId).sort()).toEqual([a.id, b.id].sort());
    expect((await blair.call('POST', `/api/sessions/${b.id}/withdraw`, {})).status).toBe(200);
    removeNote(noteB);
    expect(readNotes()).toEqual([noteA]);
    // 3. Once old enough, A applies (same name, same seat) and is sent: Blair is out of A, as she asked.
    const fresh = (await blair.call('GET', '/api/group')).data;
    expect(pendingDropAction(noteA, t0 + 20_000, () => noteStillApplies(noteA, fresh), () => false)).toEqual({ do: 'send', sessionId: a.id });
    expect((await blair.call('POST', `/api/sessions/${a.id}/withdraw`, {})).status).toBe(200);
    removeNote(noteA);
    expect(readNotes()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    const after = (await blair.call('GET', '/api/group')).data;
    expect(after.sessions.find((x: any) => x.id === a.id).mine?.status).toBe('withdrawn');
  });

  it('removing a note removes only that exact tap; a newer note for the same game stays', () => {
    const old: PendingDropNote = { sessionId: 'g1', at: 1 };
    const newer: PendingDropNote = { sessionId: 'g1', at: 2 };
    addNote(old);
    addNote(newer); // same game: replaces
    removeNote(old);
    expect(readNotes()).toEqual([newer]);
  });

  it('I\'m in on a game forgets that game\'s note only', () => {
    addNote({ sessionId: 'g1', at: 1 });
    addNote({ sessionId: 'g2', at: 2 });
    forgetGame('g1');
    expect(readNotes().map((n) => n.sessionId)).toEqual(['g2']);
  });

  it('a note written by the page before Nov 1 (one object) is read as a list of one; a broken value is cleared', () => {
    localStorage.setItem(KEY, JSON.stringify({ sessionId: 'old', at: 5 }));
    expect(readNotes()).toEqual([{ sessionId: 'old', at: 5 }]);
    localStorage.setItem(KEY, '{broken');
    expect(readNotes()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('storage blocked: no crash, nothing kept', () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    addNote({ sessionId: 'g1', at: 1 });
    expect(readNotes()).toEqual([]);
    removeNote({ sessionId: 'g1', at: 1 });
    forgetGame('g1');
  });
});
