// Drop notes: one per game, a list in browser storage (key pb_pending_drop). A drop held for Undo writes its note at
// once; the note is removed when the drop has landed, was undone, or is no longer needed. A note left behind (the
// page closed or had no signal before the drop got through) is finished later by the player page. One per game, so a
// second Drop out on another game never wipes out a first drop that has not reached the server yet. Pages before
// Nov 1, 2026 wrote one object; it is read as a list of one. Every read and write is wrapped (storage can be blocked).
import type { PendingDropNote } from './hold';

export const PENDING_DROP_KEY = 'pb_pending_drop';

function get(): string | null {
  try {
    return localStorage.getItem(PENDING_DROP_KEY);
  } catch {
    return null;
  }
}
function set(v: string | null) {
  try {
    if (v === null) localStorage.removeItem(PENDING_DROP_KEY);
    else localStorage.setItem(PENDING_DROP_KEY, v);
  } catch {
    /* blocked: nothing is kept (the drop is still sent while the page is open) */
  }
}

export function readNotes(): PendingDropNote[] {
  const raw = get();
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((n) => n && typeof n === 'object');
    if (v && typeof v === 'object') return [v];
  } catch {
    /* broken: removed below */
  }
  set(null);
  return [];
}

function writeNotes(list: PendingDropNote[]) {
  set(list.length ? JSON.stringify(list) : null);
}

/** Add (or replace) the note for this game. */
export function addNote(n: PendingDropNote) {
  writeNotes([...readNotes().filter((x) => x.sessionId !== n.sessionId), n]);
}

export const sameNote = (a: PendingDropNote, b: PendingDropNote) => a.sessionId === b.sessionId && a.at === b.at;

/** Remove exactly this note (same game, same tap), if it is still there: a newer note is never removed by mistake. */
export function removeNote(n: PendingDropNote) {
  const list = readNotes();
  if (list.some((x) => sameNote(x, n))) writeNotes(list.filter((x) => !sameNote(x, n)));
}

/** Remove any note for this game (I'm in on it: that old drop must never be sent after this). */
export function forgetGame(sessionId: string) {
  const list = readNotes();
  if (list.some((x) => x.sessionId === sessionId)) writeNotes(list.filter((x) => x.sessionId !== sessionId));
}
