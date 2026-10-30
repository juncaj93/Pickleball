// Small per-device memories for one-time moments. Every read and write is
// wrapped, so with storage blocked the page still works (the memory then lasts
// until the page is closed).

import type { CreditEntryView, PlayerSessionView } from '../shared/api';
import { MIN_PLAYERS } from '../shared/spots';

const CELEBRATED = 'pb_celebrated';
const CASHOUT_SEEN = 'pb_cashout_seen';
/** A cash out older than this is not news. */
const CASHOUT_FRESH_MS = 14 * 86_400_000;

const memory = new Map<string, string[]>();

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
    }
  } catch {
    /* blocked or broken: use the in-page memory */
  }
  return memory.get(key) ?? [];
}

function write(key: string, ids: string[]) {
  memory.set(key, ids);
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* blocked: the in-page memory still stops repeats until the page closes */
  }
}

export const celebratedIds = () => new Set(read(CELEBRATED));

export function rememberCelebrated(ids: Set<string>, keep?: Set<string>) {
  // Only games still on the schedule need remembering.
  write(CELEBRATED, [...ids].filter((id) => !keep || keep.has(id)));
}

/**
 * Which games should celebrate now. A game celebrates once when this person is
 * in and the game is at 4 or more. Dropping under 4 resets it, so reaching 4
 * again may celebrate again. Returns the new memory too.
 */
export function planCelebration(sessions: PlayerSessionView[], celebrated: Set<string>): { now: PlayerSessionView[]; next: Set<string> } {
  const next = new Set(celebrated);
  const now: PlayerSessionView[] = [];
  for (const s of sessions) {
    if (s.canceled || s.started) continue;
    const n = s.confirmed.length;
    if (n < MIN_PLAYERS) {
      next.delete(s.id);
      continue;
    }
    if (s.mine?.status === 'confirmed' && !next.has(s.id)) {
      next.add(s.id);
      now.push(s);
    }
  }
  return { now, next };
}

export const cashOutSeen = () => new Set(read(CASHOUT_SEEN));

/** Cash outs the organizer marked sent that this device has not announced yet (newest last). */
export function planCashOut(history: CreditEntryView[], seen: Set<string>, nowMs: number): { show: CreditEntryView | null; next: Set<string> } {
  const fresh = history
    .filter((e) => e.kind === 'refunded' && !e.endedAt && !seen.has(e.id) && nowMs - Date.parse(e.at) < CASHOUT_FRESH_MS)
    .sort((a, b) => a.at.localeCompare(b.at));
  const next = new Set(seen);
  for (const e of fresh) next.add(e.id);
  return { show: fresh.length ? fresh[fresh.length - 1] : null, next };
}

export function rememberCashOuts(ids: Set<string>) {
  write(CASHOUT_SEEN, [...ids].slice(-40));
}
