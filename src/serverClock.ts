// Zip 77 (🎾77.reveal): the server's clock on this phone. The standings reveal runs on it, so every phone shows the same moment whatever its own
// clock says. Each "did anything change?" check (GET /api/group/version answers `t`, the server's time) is one reading (src/live.ts keeps
// them in livecore's clockReadings; this file is part of the reveal's own download): the server's time is taken as the middle of the request,
// and the reading with the shortest round trip of the recent ones wins (the least guesswork).
import { api } from './lib';
import { clockReadings } from './livecore';

interface Reading {
  /** Server time minus this phone's time, ms. */
  offset: number;
  /** The round trip, ms (shorter is surer). */
  rtt: number;
  /** When it was taken (this phone's clock). */
  at: number;
}

/** Readings older than this are dropped (a phone's clock can be changed, or drift). */
const KEEP_MS = 5 * 60_000;
const MAX_READINGS = 12;
let readings: Reading[] = [];

/** One reading: the request went out at `sent`, came back at `got` (this phone's clock), and the server said `serverMs`. */
export function noteServerTime(sent: number, got: number, serverMs: number): void {
  if (!Number.isFinite(serverMs) || got < sent) return;
  const rtt = got - sent;
  readings = [...readings.filter((r) => got - r.at < KEEP_MS), { offset: serverMs - (sent + rtt / 2), rtt, at: got }].slice(-MAX_READINGS);
}

/** The live check's readings since the last look. */
function takeChecks() {
  while (clockReadings.length) {
    const [sent, got, t] = clockReadings.shift()!;
    noteServerTime(sent, got, t);
  }
}

/** The best guess of server time minus this phone's time (0 with no reading yet). */
export function serverOffset(): number {
  takeChecks();
  if (!readings.length) return 0;
  return readings.reduce((best, r) => (r.rtt < best.rtt ? r : best)).offset;
}

/** Server time now (ms), on this phone. */
export const serverNow = (): number => Date.now() + serverOffset();

/** A reading is in hand from the last minute. */
export const clockKnown = (): boolean => {
  takeChecks();
  return readings.some((r) => Date.now() - r.at < 60_000);
};

/** Take `n` quick readings (a phone that opens in the middle of the reveal). Errors are ignored: the phone's own clock is the fallback. */
export async function syncServerClock(n = 3, path = '/api/group/version'): Promise<void> {
  for (let i = 0; i < n; i++) {
    const sent = Date.now();
    try {
      const r = await api<{ t?: number }>('GET', path);
      if (typeof r.t === 'number') noteServerTime(sent, Date.now(), r.t);
    } catch {
      return;
    }
  }
}

/** Tests only. */
export function resetServerClock(): void {
  readings = [];
  clockReadings.length = 0;
}
