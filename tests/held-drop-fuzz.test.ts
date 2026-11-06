// Drop out is held on the phone for 5 seconds (Undo); the screen shows the drop AND the credit it gives back at
// once, and the server only hears of it when the 5 seconds end, the page goes away, or another hold starts.
// This file drives the real hold code (src/hold.ts) and the real "finish a left-over drop" decision
// (pendingDropAction) against the real server, with random sequences of: drop, wait, Undo, I'm in, close the
// app, reload, lose and get back signal. Fake clock. After every sequence, once the phone is back online and
// opened again, the server must match what the player last saw, and no money may be lost or doubled.
import { describe, expect, it, vi } from 'vitest';
import { potEffect } from '../shared/credit';
import { flushHold, holdPending, pendingDropAction, PENDING_DROP_MAX_MS, settleHolds, startHold, undoHold, UNDO_MS } from '../src/hold';
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
async function world(seed: number, credit: number, paidCash: boolean, court: 'booked' | 'not_booked' | 'waitlist') {
  const app = new TestApp();
  const ctx: Ctx = await setupGroup(app);
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const old = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-10-29');
  const g = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-11-05');
  if (court === 'booked') await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
  if (court === 'waitlist') await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/court`, { action: 'waitlist' });
  if (credit)
    app.db.raw.exec(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
       SELECT 'pot-${seed}', id, '${ctx.byName.Blair}', 'kept', ${credit}, '${old.id}', '2026-10-26T13:00:00.000Z', 'canceled' FROM groups`,
    );
  // A second game to tap I'm in on right after the drop (its own kind of court).
  const g2 = d.sessions.find((x: any) => dayOf(x.startsAt) === '2026-11-10');
  const court2 = (['booked', 'not_booked', 'waitlist'] as const)[seed % 3];
  if (court2 === 'booked') await ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/booked`, {});
  if (court2 === 'waitlist') await ctx.organizer.call('POST', `/api/admin/sessions/${g2.id}/court`, { action: 'waitlist' });
  const phone = await playerPhone(ctx, 'Blair');
  expect((await phone.call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
  // (On a waitlist court the join is standby: nothing to pay yet.)
  if (paidCash && court !== 'waitlist') await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  return { app, ctx, g, g2, court2, phone };
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
  if (!s) return potOf(ctx);
  const used = (ctx.app.db.raw.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(sid, ctx.byName.Blair) as any).c;
  const onSeat = s.payment_status === 'paid' && !s.refunded_at ? Math.max(s.payment_amount_cents ?? 0, used) : used;
  return potOf(ctx) + onSeat;
}

async function runSequence(seed: number) {
  const r = prng(seed);
  const credit = r.pick([0, 300, 1400]);
  const paidCash = credit < 1400 && r.next() < 0.5;
  const court = r.pick(['booked', 'booked', 'not_booked', 'waitlist'] as const);
  const { app, ctx, g, g2, court2, phone } = await world(seed, credit, paidCash, court);
  const seatOf2 = () => ctx.app.db.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(g2.id, ctx.byName.Blair) as any;
  const total = () => worth(ctx, g.id) + worth(ctx, g2.id) - potOf(ctx);
  const before = total();
  const storage = new Map<string, string>();
  let signal = true;
  let alive = true; // the page is open (not closed)
  // What the screen shows: in (true) or out (false), and whether the credit overlay is drawn.
  // On a court the venue has not given yet, standby (waitlisted) is shown as in.
  const serverIn = () => ['confirmed', 'waitlisted'].includes(seatOf(ctx, g.id).status);
  let shownIn = true;
  const log: string[] = [];
  // Requests on their way: a reloaded page reads the server once they have landed (its live refresh, every 5 s).
  const inflight: Promise<unknown>[] = [];
  const landed = async () => {
    while (inflight.length) await Promise.allSettled(inflight.splice(0));
  };
  const post = async (path: string, sid = g.id) => {
    if (!signal) throw new Offline('No signal, try again');
    const call = phone.call('POST', `/api/sessions/${sid}/${path}`, {});
    inflight.push(call);
    const res = await call;
    if (res.status !== 200) throw Object.assign(new Error(res.text), { code: 'server' });
    return res;
  };
  /** The real look at a left-over note (PlayerHome): wait, send, or forget. */
  const look = async (): Promise<void> => {
    const raw = storage.get('note');
    const note = raw ? JSON.parse(raw) : null;
    // As PlayerHome: no signal to ask the server whether they are still in, so decide nothing and keep the note.
    if (note && !signal) return;
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
  let joinedAfterDrop = false;
  const steps = r.int(2, 9);
  for (let i = 0; i < steps; i++) {
    const a = r.pick(['drop', 'drop', 'undo', 'in', 'wait', 'wait', 'close', 'reload', 'offline', 'online', 'book', 'in2', 'in2']);
    log.push(a);
    if (process.env.HELD_DEBUG) console.log(seed, a, { shownIn, serverIn: serverIn(), held: holdPending(g.id), note: storage.get('note'), signal, alive, now: app.now });
    if (a === 'drop' && alive && shownIn && serverIn()) drop();
    else if (a === 'undo' && alive) undoHold(g.id);
    else if (a === 'in' && alive && !shownIn) {
      // I'm in while the drop is still held just takes it back; otherwise a real join.
      if (!undoHold(g.id)) {
        try {
          // As PlayerHome join (sendDropsBeforeJoin): a drop already on its way lands first, and the join goes after it.
          // Without this the two requests raced, and which one the server saw first depended on the machine's real speed
          // (each request does real SHA-256 work on the thread pool, which the fake clock does not control): seed 136
          // (drop, wait, I'm in) failed that way on a busy machine.
          await settleHolds();
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
      await landed();
      alive = true;
      shownIn = serverIn();
      await look();
      shownIn = serverIn();
    } else if (a === 'in2' && alive) {
      // I'm in on the other game: as PlayerHome sendDropsBeforeJoin, a held or left-over drop goes first.
      const droppedFirst = !shownIn;
      const wasIn2 = ['confirmed', 'waitlisted'].includes(seatOf2()?.status ?? '');
      await settleHolds();
      const raw2 = storage.get('note');
      const note = raw2 ? JSON.parse(raw2) : null;
      if (note?.sessionId && note.sessionId !== g2.id && !holdPending(note.sessionId)) {
        try {
          await post('withdraw');
          storage.delete('note');
          shownIn = serverIn();
        } catch (err: any) {
          if (err?.code !== 'offline') storage.delete('note');
        }
      }
      let joined = false;
      try {
        await post('join', g2.id);
        joined = true;
      } catch {
        /* no signal: the error banner */
      }
      // Dropped game 1, then I'm in on game 2: checked at the end, once everything landed.
      if (joined && !wasIn2 && droppedFirst) joinedAfterDrop = true;
    } else if (a === 'book') {
      // The organizer marks the court booked (on a waitlist court: "Court opened", standby moves in).
      await landed();
      await ctx.organizer.call('POST', `/api/admin/sessions/${g.id}/booked`, {});
    } else if (a === 'offline') signal = false;
    else if (a === 'online') signal = true;
  }
  // The end: let the hold run out, signal comes back, the phone is opened (again), the left-over note is finished.
  await advance(UNDO_MS + 100);
  await landed();
  signal = true;
  alive = true;
  await look();
  await advance(UNDO_MS + 3_000);
  await look();
  const out = !serverIn();
  // What the player last saw (or decided): the server agrees.
  const intendedOut = !shownIn;
  if (out !== intendedOut || storage.has('note')) throw new Error(`seed ${seed} [${log.join(' ')}]: server ${out ? 'out' : 'in'}, screen ${intendedOut ? 'out' : 'in'}, note ${storage.get('note') ?? 'none'}`);
  // Money: nothing lost or doubled (checked across both games below).
  const liveUsed = (ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'used' AND ended_at IS NULL AND player_id = ?").get(ctx.byName.Blair) as any).n;
  expect(liveUsed, `seed ${seed}: credit used at most once`).toBeLessThanOrEqual(1);
  if (out && !seatOf2()) expect(potOf(ctx), `seed ${seed}: all money back`).toBe(before);
  // In and owing on a game that has its seat (booked or not booked yet): their credit is on it, never left unused.
  const seat = seatOf(ctx, g.id);
  if (seat.status === 'confirmed' && seat.payment_status === 'unpaid') expect(potOf(ctx), `seed ${seed} [${log.join(' ')}]: credit left unused on an owing seat`).toBe(0);
  expect(total(), `seed ${seed} [${log.join(' ')}]: worth across both games`).toBe(before);
  // Dropped game 1, then I'm in on game 2, and game 1 stayed dropped: the drop's credit is on the new seat, never
  // left unused beside a seat that owes (court booked or not booked; a venue-waitlist court is standby, owing nothing).
  const s2 = seatOf2();
  if (joinedAfterDrop && out && court2 !== 'waitlist' && s2?.status === 'confirmed' && s2.payment_status === 'unpaid' && !log.slice(log.lastIndexOf('in2') + 1).includes('book'))
    expect(potOf(ctx), `seed ${seed} [${log.join(' ')}]: game 2 owes while the drop's credit sits unused`).toBe(0);
  flushHold(false);
}

describe('held drop: close, reload, signal and Undo in any order', () => {
  it('2,000 random sequences: the server ends as the screen last showed, nothing lost or doubled', async () => {
    vi.useFakeTimers();
    try {
      const n = Number(process.env.HELD_SEQS ?? 2000);
      const from = Number(process.env.HELD_FROM ?? 1);
      for (let seed = from; seed < from + n; seed++) await runSequence(seed);
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
