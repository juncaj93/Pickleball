// Fresh auditor G (Nov 1, 2026): a tab still running the page from before 422a7c6 (loaded before the deploy, not
// reloaded) reads the new note LIST as one note with no game, and its look() forgets it: every unsent drop is wiped.
// The old tab's logic is copied from 422a7c6^ (src/pages/PlayerHome.tsx, look + removeNoteIf).
import { beforeEach, describe, expect, it } from 'vitest';
import { addNote, readNotes } from '../src/dropNotes';
import { pendingDropAction, type PendingDropNote } from '../src/hold';

const KEY = 'pb_pending_drop';
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** look() of the page before 422a7c6, up to its decision (no note had a game, so no server call is made). */
function oldLook(): string {
  const raw = localStorage.getItem(KEY);
  let note: PendingDropNote | null = null;
  if (raw) {
    try {
      note = JSON.parse(raw);
    } catch {
      note = {};
    }
  }
  if (note?.sessionId) return 'would ask the server';
  const next = pendingDropAction(note, Date.now(), () => false, () => false);
  if (next.do === 'forget' && localStorage.getItem(KEY) === raw) localStorage.removeItem(KEY);
  return next.do;
}

describe('mixed versions: an old tab wipes the new note list', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = fakeStorage();
  });

  it('unsent drops on two games are forgotten by an old tab coming into view', () => {
    const t0 = Date.now() - 20_000;
    addNote({ sessionId: 'game-a', at: t0, playerId: 'p1', signupAt: 's1' });
    addNote({ sessionId: 'game-b', at: t0 + 1_000, playerId: 'p1', signupAt: 's2' });
    expect(readNotes()).toHaveLength(2);
    expect(oldLook()).toBe('forget');
    expect(readNotes()).toHaveLength(0);
  });

  it('an old tab that drops out overwrites the list with one object (other games lost)', () => {
    addNote({ sessionId: 'game-a', at: Date.now() - 20_000, playerId: 'p1', signupAt: 's1' });
    localStorage.setItem(KEY, JSON.stringify({ sessionId: 'game-c', at: Date.now(), playerId: 'p1', signupAt: 's3' }));
    expect(readNotes().map((n) => n.sessionId)).toEqual(['game-c']);
  });
});
