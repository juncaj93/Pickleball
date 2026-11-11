// Zip 29: the Home money cards were merged. "Who hasn't paid" (one card per game, Remind, Request) now also has Mark paid on every row and took
// over from "Mark paid tonight" / "Who owes you". Alex's rule: every player who appeared in EITHER old card must still appear in the merged
// card. Proven here on the made-up preview world (scripts/preview-world-small.ts), at several moments, against both old rules written out
// the way the old code had them (the old second card = buildTodo's 'tonight' and 'owed' rows; the old first card = games on or before today
// through unpaidRows).
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { previewPin } from '../scripts/seed-preview-world';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { localParts } from '../shared/time';
import type { AdminDashboard } from '../shared/api';
import { buildTodo } from '../src/pages/admin/todo';
import { owedHomeGames, unpaidRows } from '../src/pages/admin/moneyList';

async function dashboardAt(nowMs: number): Promise<AdminDashboard> {
  const { sql } = await buildSmallPreview(nowMs);
  const db = createNodeD1(':memory:');
  db.raw.exec(sql);
  const env: any = { DB: db };
  const call = async (method: string, path: string, cookie = '', body?: unknown) => {
    const h = new Headers();
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, nowMs, () => {});
    return { res, data: (await res.json().catch(() => null)) as any };
  };
  const login = await call('POST', '/api/admin/login', '', { pin: previewPin() });
  const cookie = login.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return (await call('GET', '/api/admin/dashboard', cookie)).data as AdminDashboard;
}

/** The old first card, as it was: games on or before today (not hidden), the people unpaidRows gives. */
function oldWhoHasntPaid(d: AdminDashboard): Set<string> {
  const tz = d.group.timezone;
  const day = (ms: number) => {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const today = day(Date.parse(d.now));
  const out = new Set<string>();
  for (const s of d.sessions) if (s.hiddenFromList !== true && day(Date.parse(s.startsAt)) <= today) for (const r of unpaidRows(s)) out.add(`${s.id}:${r.playerId}`);
  return out;
}

/** The old second card, as it was: buildTodo's Mark paid tonight and Who owes you rows. */
function oldMarkPaid(d: AdminDashboard): Set<string> {
  const out = new Set<string>();
  for (const item of buildTodo(d)) if (item.kind === 'tonight' || item.kind === 'owed') for (const r of item.rows) out.add(`${r.session.id}:${r.playerId}`);
  return out;
}

const merged = (d: AdminDashboard) => new Set(owedHomeGames(d).flatMap((g) => g.rows.map((r) => `${g.s.id}:${r.playerId}`)));

// Mon Nov 9 noon (day before game day), Tue Nov 10 7:20 PM (game night), Wed Nov 11 8 AM, Thu Nov 12 noon, Sat Nov 14 9 AM.
const MOMENTS = ['2026-11-09T17:00:00.000Z', '2026-11-11T00:20:00.000Z', '2026-11-11T13:00:00.000Z', '2026-11-12T17:00:00.000Z', '2026-11-14T14:00:00.000Z'];

describe('Home money cards merged: nobody is lost', () => {
  for (const at of MOMENTS) {
    it(`at ${at}: every player on either old card is on the merged card, and nobody else is`, async () => {
      const d = await dashboardAt(Date.parse(at));
      const a = oldWhoHasntPaid(d);
      const b = oldMarkPaid(d);
      const m = merged(d);
      const lostFromA = [...a].filter((k) => !m.has(k));
      const lostFromB = [...b].filter((k) => !m.has(k));
      const extra = [...m].filter((k) => !a.has(k) && !b.has(k));
      expect({ lostFromA, lostFromB, extra }).toEqual({ lostFromA: [], lostFromB: [], extra: [] });
      // The world has something to prove at every moment (both cards had rows).
      expect(b.size).toBeGreaterThan(0);
      expect(a.size).toBeGreaterThan(0);
    }, 60_000);
  }

  it('players in coming games (from their check-in time) are on the merged card though the old "Who hasn\'t paid" never listed them', async () => {
    let comingOnly = 0;
    for (const at of MOMENTS) {
      const d = await dashboardAt(Date.parse(at));
      const a = oldWhoHasntPaid(d);
      for (const k of oldMarkPaid(d)) if (!a.has(k)) comingOnly++;
    }
    // At least one moment had somebody who only the old second card showed: they are the reason the merged card also lists coming games.
    expect(comingOnly).toBeGreaterThan(0);
  }, 120_000);
});

// A case the fake world does not have: somebody who dropped late from a game still ahead (a later day) and owes the fee. Neither old card showed
// them before game day (the old first card started on game day, the old second card listed seats still in the game), so the merged card must not either.
describe('merged card: coming games list only the people who are in them', () => {
  const row = (playerId: string, status: string, owes: number, lateFee: boolean) => ({ playerId, name: playerId, status, isOrganizer: false, paymentStatus: 'unpaid', owesCents: owes, lateFee: lateFee ? { oweCents: owes } : null });
  const game = (id: string, startsAt: string, roster: any[]) => ({ id, startsAt, endsAt: startsAt, hiddenFromList: false, state: { flags: { canceled: false } }, roster });
  const d: any = {
    now: '2026-11-10T15:00:00.000Z', // Tue Nov 10, 10 AM Eastern
    group: { timezone: 'America/Detroit', settings: { checkInHours: 24 } },
    sessions: [
      game('tonight', '2026-11-11T00:00:00.000Z', [row('in-1', 'confirmed', 1400, false), row('left-1', 'withdrawn', 1400, true)]),
      game('tomorrow', '2026-11-11T14:00:00.000Z', [row('in-2', 'confirmed', 1400, false), row('left-2', 'withdrawn', 1400, true)]),
    ],
  };
  it('today\'s game lists the late-fee debt too (as the old first card did); tomorrow\'s game lists only the seat that is in', () => {
    const got = Object.fromEntries(owedHomeGames(d).map((g) => [g.s.id, g.rows.map((r) => r.playerId)]));
    expect(got).toEqual({ tonight: ['in-1', 'left-1'], tomorrow: ['in-2'] });
  });
});
