// Drop out is held on the phone for 5 seconds (Undo); the screen shows the drop AND the credit it gives back at
// once, and the server only hears of it when the 5 seconds end, the page goes away, or another hold starts.
// This file drives the real hold code (src/hold.ts) and the real "finish a left-over drop" decision
// (pendingDropAction) against the real server, with random sequences of: drop, wait, Undo, I'm in, close the
// app, reload, lose and get back signal. Fake clock. After every sequence, once the phone is back online and
// opened again, the server must match what the player last saw, and no money may be lost or doubled.
import { describe, expect, it, vi } from 'vitest';
import { potEffect } from '../shared/credit';
import { flushHold, holdPending, pendingDropAction, PENDING_DROP_MAX_MS, startHold, undoHold, UNDO_MS } from '../src/hold';
import { playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
type Ctx = Awaited<ReturnType<typeof setupGroup>>;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { next, int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)), pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
}

class Offline extends Error {
  code = 'offline';
}

/** One phone: its storage (the drop note survives a reload or a closed app), its signal, and what its screen shows. */
async function world(seed: number, credit: number, paidCash: boolean) {
  const app = new TestApp();
  const ctx: Ctx = await setupGroup(app);
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const old = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-10-29');
  const g = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-11-05');
  await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
  if (credit)
    app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
       SELECT 'pot-${seed}', id, '${ctx.byName.Blair}', 'kept', ${credit}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
    );
  const phone = await playerPhone(ctx, 'Blair');
  expect((await phone.call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
  if (paidCash) await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  return { app, ctx, g, phone };
}

const potOf = (ctx: Ctx) =>
  (ctx.app.db.raw.prepare('SELECT * FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL').all(ctx.byName.Blair) as any[]).reduce(
    (n, r) => n + potEffect({ kind: r.kind, cents: r.amount_cents, fiveCents: r.five_cents }),
    0,
  );
const seatOf = (ctx: Ctx, sid: string) => ctx.app.db.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, ctx.byName.Blair) as any;
/** What the player is worth in this game: pot + what the seat holds (credit on it, or its unsettled payment). */
function worth(ctx: Ctx, sid: string) {
  const s = seatOf(ctx, sid);
  const used = (ctx.app.db.raw.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(sid, ctx.byName.Blair) as any).c;
  const onSeat = s.payment_status === 'paid' && !s.refunded_at ? Math.max(s.payment_amount_cents ?? 0, used) : used;
  return potOf(ctx) + onSeat;
}

async function runSequence(seed: number) {
  const r = prng(seed);
  const credit = r.pick([0, 300, 1400]);
  const paidCash = credit < 1400 && r.next() < 0.5;
  const { app, ctx, g, phone } = await world(seed, credit, paidCash);
  const before = worth(ctx, g.id);
  const storage = new Map<string, string>();
  let signal = true;
  let alive = true; // the page is open (not closed)
  // What the screen shows: in (true) or out (false), and whether the credit overlay is drawn.
  const serverIn = () => seatOf(ctx, g.id).status === 'confirmed';
  let shownIn = true;
  const log: string[] = [];
  const post = async (path: string) => {
    if (!signal) throw new Offline('No signal, try again');
    const res = await phone.call('POST', `/api/sessions/${g.id}/${path}`, {});
    if (res.status !== 200) throw Object.assign(new Error(res.text), { code: 'server' });
    return res;
  };
  /** The real look at a left-over note (PlayerHome): wait, send, or forget. */
  const look = async (): Promise<void> => {
    const raw = storage.get('note');
    const note = raw ? JSON.parse(raw) : null;
    const next = pendingDropAction(note, app.now, () => serverIn(), holdPending);
    if (next.do === 'forget') storage.delete('note');
    else if (next.do === 'wait') {
      await advance(next.ms);
      return look();
    } else if (next.do === 'send') {
      try {
        await post('withdraw');
        storage.delete('note');
        shownIn = serverIn();
      } catch {
        /* stays for the next look */
      }
    }
  };
  const advance = async (ms: number) => {
    app.now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const drop = () => {
    shownIn = false;
    storage.set('note', JSON.stringify({ sessionId: g.id, at: app.now }));
    let leavingSend = false;
    startHold(g.id, {
      send: async (leaving) => {
        leavingSend = leaving;
        await post('withdraw');
      },
      settled: (err) => {
        // As PlayerHome: a failed send while leaving (no signal) keeps the note; any other failure shows the error
        // and the screen goes back to "in".
        if (err && leavingSend && (err as any).code === 'offline') return;
        if (storage.get('note') && JSON.parse(storage.get('note')!).sessionId === g.id) storage.delete('note');
        if (err && alive) shownIn = serverIn();
      },
      undone: () => {
        storage.delete('note');
        shownIn = true;
      },
    });
  };
  const steps = r.int(2, 9);
  for (let i = 0; i < steps; i++) {
    const a = r.pick(['drop', 'drop', 'undo', 'in', 'wait', 'wait', 'close', 'reload', 'offline', 'online']);
    log.push(a);
    if (a === 'drop' && alive && shownIn && serverIn()) drop();
    else if (a === 'undo' && alive) undoHold(g.id);
    else if (a === 'in' && alive && !shownIn) {
      // I'm in while the drop is still held just takes it back; otherwise a real join.
      if (!undoHold(g.id)) {
        try {
          await post('join');
          shownIn = serverIn();
        } catch {
          /* error banner; screen unchanged */
        }
      }
    } else if (a === 'wait') await advance(r.pick([500, 2000, 4900, 5100, 8000, 30_000]));
    else if (a === 'close' && alive) {
      // pagehide: sent at once with keepalive; the page is already gone, so the player sees no answer.
      alive = false;
      flushHold(true);
      await vi.advanceTimersByTimeAsync(0);
    } else if (a === 'reload') {
      if (alive) {
        alive = false;
        flushHold(true);
      }
      await vi.advanceTimersByTimeAsync(0);
      alive = true;
      shownIn = serverIn();
      await look();
      shownIn = serverIn();
    } else if (a === 'offline') signal = false;
    else if (a === 'online') signal = true;
  }
  // The end: let the hold run out, signal comes back, the phone is opened (again), the left-over note is finished.
  await advance(UNDO_MS + 100);
  signal = true;
  alive = true;
  await look();
  await advance(UNDO_MS + 3_000);
  await look();
  const out = !serverIn();
  // What the player last saw (or decided): the server agrees.
  const intendedOut = !shownIn;
  if (out !== intendedOut || storage.has('note')) throw new Error(`seed ${seed} [${log.join(' ')}]: server ${out ? 'out' : 'in'}, screen ${intendedOut ? 'out' : 'in'}, note ${storage.get('note') ?? 'none'}`);
  // Money: nothing lost or doubled. In: the seat holds what it held. Out: all of it is back in the pot.
  expect(worth(ctx, g.id), `seed ${seed} [${log.join(' ')}]: worth`).toBe(before);
  const liveUsed = (ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND player_id = ?").get(ctx.byName.Blair) as any).n;
  expect(liveUsed, `seed ${seed}: credit used at most once`).toBeLessThanOrEqual(1);
  if (out) expect(potOf(ctx), `seed ${seed}: all money back`).toBe(before);
  flushHold(false);
}

describe('held drop: close, reload, signal and Undo in any order', () => {
  it('2,000 random sequences: the server ends as the screen last showed, nothing lost or doubled', async () => {
    vi.useFakeTimers();
    try {
      const n = Number(process.env.HELD_SEQS ?? 2000);
      for (let seed = 1; seed <= n; seed++) await runSequence(seed);
    } finally {
      vi.useRealTimers();
    }
  }, 600_000);

  it('a left-over note is finished up to 2 minutes after the tap, and never after', () => {
    const t = 1_000_000;
    const note = { sessionId: 's', at: t };
    expect(pendingDropAction(note, t + 1000, () => true, () => false)).toMatchObject({ do: 'wait' });
    expect(pendingDropAction(note, t + UNDO_MS + 2_500, () => true, () => false)).toEqual({ do: 'send', sessionId: 's' });
    expect(pendingDropAction(note, t + UNDO_MS + 2_500, () => false, () => false)).toEqual({ do: 'forget' });
    expect(pendingDropAction(note, t + PENDING_DROP_MAX_MS, () => true, () => false)).toEqual({ do: 'forget' });
    expect(pendingDropAction(note, t + 500, () => true, () => true)).toEqual({ do: 'keep' });
  });
});
