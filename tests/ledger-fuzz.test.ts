// Ledger fuzz: random action sequences against the real API, on fake data with
// a fake clock, with the money invariants checked after EVERY step (straight
// from the database), and the screens (Money tab, dashboard, Players tab, each
// player's own view) checked against each other every few steps and at the end
// of each sequence.
//
// Each sequence starts from a copy of a set-up group (8 players and the
// organizer "Robin", who plays but never pays the group or has credit) at Mon
// Oct 26 2026 noon Eastern, and plays with the next 6 games (Tue Oct 27 to Thu
// Nov 12, across the Sun Nov 1 clock change). Half start "credit-rich": six
// players already have credit ($14, $5, $3, $7 and two with a cash-out request
// waiting). Steps are picked at random, mostly among things that make sense
// right then (a seat that exists, a game that is over); some are two taps at
// the same instant (Promise.all: the node:sqlite stand-in yields at every
// await, so the two requests' reads and writes really interleave).
//
// Runs (deterministic for a seed; a failure prints the seed, the steps with
// their answers, and the broken invariant):
//   npx vitest run tests/ledger-fuzz.test.ts                       (~55 s: 240 + 120 sequences, ~10,000 steps)
//   FUZZ_SEQS=5000 FUZZ_PAR_SEQS=2500 npx vitest run tests/ledger-fuzz.test.ts   (a long run; FUZZ_SEED moves the seeds)
//   FUZZ_REPLAY='<step list JSON>' or FUZZ_REPLAY=<seed>:<par share>:<steps>    (one sequence, printed)
//   FUZZ_STRICT=1    known bugs (the it.fails cases at the bottom) fail the fuzz too
//   FUZZ_EXPLORE=1   does not stop at a failure: groups them by invariant and step, shrinks one of each, prints them
//   FUZZ_STATS=1     how often each action did something, and why the rest were refused
//
// The books: `cashIn` is real cash that left players' pockets (Venmo). It goes
// up only when a seat goes from unpaid to paid through "I paid" or the
// organizer's Mark paid, by exactly what that player's own screen said they
// owed for the game just before. An Unmark ("Didn't pay?" or the organizer's)
// that takes a payment back takes back that payment's cash. `cashedOut` is
// cash the organizer sent back for credit (Mark refunded, Refund credit
// balance), by the amount on the card. Then at every step:
//   cashIn = what the group holds from players' seats + every pot + cashedOut
// where a seat holds its live payment minus what came back from it, or (unpaid)
// the credit and earlier cash put on it. Nothing created, nothing lost.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { heldCents, balanceOf } from '../src/pages/admin/todo';
import { Client, HOUR, MONDAY_NOON, PLAYER_NAMES, setupGroup, playerPhone, type TestApp } from './harness';

// ---------------------------------------------------------------------------
// Settings

const env = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
const SEQS = env('FUZZ_SEQS', 240);
const STEPS = env('FUZZ_STEPS', 30);
const PAR_SEQS = env('FUZZ_PAR_SEQS', 120);
const PAR_STEPS = env('FUZZ_PAR_STEPS', 22);
const BASE_SEED = env('FUZZ_SEED', 20261026);
/** Screens (Money, dashboard, Players, each player's view) are compared every this many steps, and at the end. */
const SCREEN_EVERY = env('FUZZ_SCREEN_EVERY', 10);
const STRICT = !!process.env.FUZZ_STRICT;
const EXPLORE = !!process.env.FUZZ_EXPLORE;
/** Print every step of every sequence (with FUZZ_SEQS=1, a readable replay). */
const PRINT = !!process.env.FUZZ_PRINT;
let lastLog: string[] = [];

const PLAYERS = [...PLAYER_NAMES, 'Gale', 'Harper'];
const ORG = 'Robin';
const PEOPLE = [...PLAYERS, ORG];
const GAMES = 6;
const MONTHS = ['2026-10', '2026-11', '2026-12'];
/** With FUZZ_PRICE=1 the organizer also changes the flat price now and then (Settings > "$14 each"). */
const PRICE_CHANGES = !!process.env.FUZZ_PRICE;

// ---------------------------------------------------------------------------
// A seeded PRNG (mulberry32)

function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof prng>;

// ---------------------------------------------------------------------------
// Actions. Plain data, so a failing list can be printed, shrunk and replayed.
// Some carry a symbolic amount ('all', 'shown', ...) read from the data when
// the step runs, the way a person reads it off the screen.

type P = string; // a player's name (Robin is the organizer)
type G = number; // game index 0..5
export type Action =
  | { t: 'join'; p: P; g: G }
  | { t: 'drop'; p: P; g: G }
  | { t: 'decline'; p: P; g: G }
  | { t: 'ipaid'; p: P; g: G; paid: boolean }
  | { t: 'usecredit'; p: P; g: G }
  | { t: 'undocredit'; p: P; g: G }
  | { t: 'cashout'; p: P; g: G; cents: 'offer' | number }
  | { t: 'refreq'; p: P; cents: 'all' | 'over' | number }
  | { t: 'refcancel'; p: P }
  | { t: 'mark'; p: P; g: G; paid: boolean }
  | { t: 'roster'; p: P; g: G; action: 'confirm' | 'withdraw' | 'waitlist' }
  | { t: 'orgme'; g: G; in: boolean }
  | { t: 'cancel'; g: G }
  | { t: 'uncancel'; g: G }
  | { t: 'resched'; g: G; hours: number }
  | { t: 'court'; g: G; action: 'booked' | 'waitlist' | 'not_opened' | 'clear' | 'not_booked' }
  | { t: 'finalize'; g: G; who: 'everyone' | number }
  | { t: 'unfinalize'; g: G }
  | { t: 'resolve'; p: P; action: 'refunded' | 'stale' | 'not_now' | 'undo' }
  | { t: 'balrefund'; p: P; refunded: boolean; stale?: boolean }
  | { t: 'max'; n: number }
  | { t: 'price'; cents: number }
  | { t: 'tick'; ms: number }
  | { t: 'to'; g: G; at: 'deadline' | 'start' | 'end'; min: number }
  | { t: 'par'; a: Action; b: Action }
  /** First step only: start from the credit-rich copy. */
  | { t: 'tpl'; rich: boolean };

const W: [Action['t'], number][] = [
  ['join', 18], ['drop', 7], ['decline', 1], ['ipaid', 6], ['usecredit', 4], ['undocredit', 2], ['cashout', 3],
  ['refreq', 4], ['refcancel', 2], ['mark', 10], ['roster', 5], ['orgme', 2], ['cancel', 2], ['uncancel', 2],
  ['resched', 2], ['court', 3], ['finalize', 5], ['unfinalize', 3], ['resolve', 3], ['balrefund', 2], ['max', 2],
  ['tick', 4], ['to', 2],
];
const W_TOTAL = W.reduce((s, [, w]) => s + w, 0);

/** What the generator looks at to pick sensible targets (most of the time; now and then anything goes). */
export interface Look {
  now: number;
  games: { start: number; end: number; canceled: boolean; finalized: boolean; courtWaiting: boolean; seats: Map<P, { status: string; paid: boolean }> }[];
  pots: Map<P, number>;
  pending: Set<P>;
  refundedReq: Set<P>;
  offers: Set<string>;
}

/** Usually a player, now and then the organizer on the player link (who must never pay, use or earn credit). */
const anyone = (r: Rng) => (r.chance(0.06) ? ORG : r.pick(PLAYERS));

function genOne(r: Rng, L: Look): Action {
  let x = r.next() * W_TOTAL;
  let t: Action['t'] = 'join';
  for (const [k, w] of W) {
    if ((x -= w) < 0) {
      t = k;
      break;
    }
  }
  const all = [...Array(GAMES).keys()];
  const open = all.filter((i) => !L.games[i].canceled && L.now < L.games[i].start);
  const over = all.filter((i) => !L.games[i].canceled && !L.games[i].finalized && L.now >= L.games[i].end);
  const live = all.filter((i) => !L.games[i].canceled);
  /** A game from the list, mostly one that already has people in it (so games reach 4 to 8). */
  const pickG = (xs: number[]) => {
    if (!xs.length || r.chance(0.1)) return r.int(0, GAMES - 1);
    const wt = xs.map((i) => 1 + [...L.games[i].seats.values()].filter((x) => x.status === 'confirmed').length);
    let y = r.next() * wt.reduce((a, b) => a + b, 0);
    for (let k = 0; k < xs.length; k++) if ((y -= wt[k]) < 0) return xs[k];
    return xs[xs.length - 1];
  };
  /** A seat (player, game) with one of these statuses, in one of these games; else anything. */
  const pickSeat = (games: number[], statuses: string[], pred: (s: { status: string; paid: boolean }) => boolean = () => true): { p: P; g: G } => {
    const seats: { p: P; g: G }[] = [];
    for (const g of games) for (const [p, s] of L.games[g].seats) if (p !== ORG && statuses.includes(s.status) && pred(s)) seats.push({ p, g });
    return seats.length && r.chance(0.9) ? r.pick(seats) : { p: anyone(r), g: r.int(0, GAMES - 1) };
  };
  const withCredit = PLAYERS.filter((p) => (L.pots.get(p) ?? 0) > 0);
  switch (t) {
    case 'join': {
      const g = pickG(open);
      const out = PLAYERS.filter((p) => L.games[g].seats.get(p)?.status !== 'confirmed');
      // Players with credit join more often (that is when credit moves).
      const p = withCredit.length && r.chance(0.3) ? r.pick(withCredit) : out.length && r.chance(0.9) ? r.pick(out) : anyone(r);
      return { t, p, g };
    }
    case 'drop':
      return { t, ...pickSeat(open, ['confirmed', 'waitlisted']) };
    case 'decline':
      return { t, p: r.pick(PLAYERS), g: pickG(open) };
    case 'usecredit':
      return { t, ...pickSeat(live, ['confirmed'], (s) => !s.paid) };
    case 'undocredit':
      return { t, ...pickSeat(live, ['confirmed'], (s) => s.paid) };
    case 'ipaid': {
      const paid = r.chance(0.8);
      return { t, ...pickSeat(live, ['confirmed'], (s) => s.paid !== paid), paid };
    }
    case 'mark': {
      const paid = r.chance(0.7);
      if (r.chance(0.08)) return { t, p: ORG, g: pickG(live), paid };
      return { t, ...pickSeat(live, paid ? ['confirmed'] : ['confirmed', 'waitlisted', 'withdrawn'], (s) => s.paid !== paid || r.chance(0.2)), paid };
    }
    case 'cashout': {
      const offers = [...L.offers];
      if (offers.length && r.chance(0.8)) {
        const [g, p] = r.pick(offers).split(':');
        return { t, p, g: Number(g), cents: r.chance(0.85) ? 'offer' : r.int(1, 16) * 100 };
      }
      return { t, ...pickSeat(live, ['confirmed'], (s) => !s.paid), cents: r.chance(0.5) ? 'offer' : r.int(1, 16) * 100 };
    }
    case 'refreq': {
      const p = withCredit.length && r.chance(0.85) ? r.pick(withCredit) : anyone(r);
      const pot = Math.floor((L.pots.get(p) ?? 0) / 100);
      return { t, p, cents: r.chance(0.35) ? 'all' : r.chance(0.12) ? 'over' : pot > 0 && r.chance(0.8) ? r.int(1, pot) * 100 : r.int(1, 16) * 100 };
    }
    case 'refcancel': {
      const ps = [...L.pending];
      return { t, p: ps.length && r.chance(0.85) ? r.pick(ps) : r.pick(PLAYERS) };
    }
    case 'resolve': {
      const action = r.pick(['refunded', 'refunded', 'stale', 'not_now', 'undo'] as const);
      const ps = action === 'undo' ? [...L.refundedReq] : [...L.pending];
      return { t, p: ps.length && r.chance(0.9) ? r.pick(ps) : r.pick(PLAYERS), action };
    }
    case 'balrefund':
      return { t, p: withCredit.length && r.chance(0.85) ? r.pick(withCredit) : anyone(r), refunded: r.chance(0.7), stale: r.chance(0.15) };
    case 'roster': {
      const action = r.pick(['confirm', 'confirm', 'withdraw', 'waitlist'] as const);
      if (action === 'confirm') return { t, p: r.pick(PLAYERS), g: pickG(open), action };
      return { t, ...pickSeat(open, ['confirmed', 'waitlisted']), action };
    }
    case 'orgme':
      return { t, g: pickG(open), in: r.chance(0.7) };
    case 'cancel':
      return { t, g: pickG(open) };
    case 'uncancel':
      return { t, g: pickG(all.filter((i) => L.games[i].canceled && L.now < L.games[i].start)) };
    case 'unfinalize':
      return { t, g: pickG(all.filter((i) => L.games[i].finalized)) };
    case 'resched':
      return { t, g: pickG(open), hours: r.pick([-48, -24, -3, -1, 1, 2, 24, 26, 48, 120]) };
    case 'court': {
      // On the venue's waitlist: Court opened (booked, standby players move in with their credit) or Didn't open.
      const waiting = open.filter((i) => L.games[i].courtWaiting);
      if (waiting.length && r.chance(0.7)) return { t, g: r.pick(waiting), action: r.pick(['booked', 'booked', 'not_opened', 'clear'] as const) };
      return { t, g: pickG(open), action: r.pick(['booked', 'waitlist', 'waitlist', 'not_booked'] as const) };
    }
    case 'finalize': {
      // A game that is over; now and then the next one (the clock moves past its end).
      const next = all.filter((i) => !L.games[i].canceled && !L.games[i].finalized).sort((a, b) => L.games[a].end - L.games[b].end)[0];
      const g = over.length && r.chance(0.8) ? r.pick(over) : r.chance(0.6) && next !== undefined ? next : r.int(0, GAMES - 1);
      return { t, g, who: r.chance(0.5) ? 'everyone' : r.int(0, 4095) };
    }
    case 'max':
      return PRICE_CHANGES && r.chance(0.5) ? { t: 'price', cents: r.int(10, 18) * 100 } : { t, n: r.int(4, 9) };
    case 'tick':
      return { t, ms: r.chance(0.75) ? r.int(5, 240) * 60_000 : r.int(6, 36) * HOUR };
    case 'to':
      return { t, g: pickG(open), at: r.pick(['deadline', 'deadline', 'start'] as const), min: r.int(-90, 10) };
    default:
      return { t: 'tick', ms: 60_000 };
  }
}

/** The opening steps: sign-ups to the next few games, and some payments. */
function genWarm(r: Rng, L: Look): Action {
  const open = [...Array(GAMES).keys()].filter((i) => !L.games[i].canceled && L.now < L.games[i].start).slice(0, 3);
  const g = open.length ? open[Math.min(open.length - 1, Math.floor(r.next() * r.next() * open.length))] : 0;
  const x = r.next();
  const seats = (paid: boolean) => [...L.games[g].seats].filter(([p, s]) => p !== ORG && s.status === 'confirmed' && s.paid === paid).map(([p]) => p);
  const unpaid = seats(false);
  const paid = seats(true);
  const out = PLAYERS.filter((p) => L.games[g].seats.get(p)?.status !== 'confirmed');
  if (x < 0.5 || !unpaid.length) return { t: 'join', p: r.chance(0.04) || !out.length ? ORG : r.pick(out), g };
  // Paid and then out, or the game canceled: that money is credit (the usual ways credit appears before games are finalized).
  if (x > 0.9 && paid.length) return { t: 'drop', p: r.pick(paid), g };
  if (x > 0.88 && paid.length >= 2) return { t: 'cancel', g };
  const p = r.pick(unpaid);
  if (x < 0.75) return { t: 'mark', p, g, paid: true };
  if (x < 0.85) return { t: 'ipaid', p, g, paid: true };
  return { t: 'orgme', g, in: true };
}

const seatOf = (a: Action): string | null => ('p' in a && 'g' in a ? `${a.g}:${a.p}` : null);
/** Credit or payment moves on a seat (a payment tap next to one of these at the same instant is the player paying twice, not a bug). */
const MOVES_SEAT = new Set<Action['t']>(['usecredit', 'undocredit', 'cashout', 'join', 'roster', 'ipaid', 'mark']);

/** Two taps at the same moment: a double tap, two random taps, or one of the races that matter for money. */
function genPar(r: Rng, L: Look): Action {
  const kind = r.next();
  if (kind < 0.3) {
    for (;;) {
      const a = genOne(r, L);
      if (a.t !== 'tick' && a.t !== 'to') return { t: 'par', a, b: a };
    }
  }
  if (kind < 0.5) {
    for (;;) {
      const a = genOne(r, L);
      const b = genOne(r, L);
      if ([a, b].some((x) => x.t === 'tick' || x.t === 'to' || x.t === 'finalize')) continue;
      // A payment tap at the same instant as a credit move or the opposite payment tap on the same seat is
      // the person paying twice or changing their mind mid-tap: not something the books can judge.
      const sa = seatOf(a);
      if (sa && sa === seatOf(b) && (a.t === 'mark' || a.t === 'ipaid' || b.t === 'mark' || b.t === 'ipaid') && MOVES_SEAT.has(a.t) && MOVES_SEAT.has(b.t) && JSON.stringify(a) !== JSON.stringify(b))
        continue;
      return { t: 'par', a, b };
    }
  }
  // A race that matters for money, on a seat that exists when there is one.
  const base = genOne(r, L);
  const p = 'p' in base && base.p !== ORG ? base.p : r.pick(PLAYERS);
  const all = [...Array(GAMES).keys()];
  const open = all.filter((i) => !L.games[i].canceled && L.now < L.games[i].start);
  const inGame = open.filter((i) => L.games[i].seats.get(p)?.status === 'confirmed');
  const g = inGame.length && r.chance(0.8) ? r.pick(inGame) : open.length ? r.pick(open) : r.int(0, GAMES - 1);
  const others = open.filter((i) => i !== g);
  const g2 = others.length ? r.pick(others) : (g + 1) % GAMES;
  const q = r.pick(PLAYERS.filter((x) => x !== p));
  const over = all.filter((i) => !L.games[i].canceled && !L.games[i].finalized && L.now >= L.games[i].end);
  const fg = over.length ? r.pick(over) : g;
  const races: Action[][] = [
    [{ t: 'join', p, g }, { t: 'join', p, g: g2 }],
    [{ t: 'usecredit', p, g }, { t: 'usecredit', p, g: g2 }],
    [{ t: 'join', p, g }, { t: 'refreq', p, cents: 'all' }],
    [{ t: 'join', p, g }, { t: 'balrefund', p, refunded: true }],
    [{ t: 'join', p, g }, { t: 'resolve', p, action: 'refunded' }],
    [{ t: 'drop', p, g }, { t: 'mark', p, g, paid: true }],
    [{ t: 'drop', p, g }, { t: 'ipaid', p, g, paid: true }],
    [{ t: 'drop', p, g }, { t: 'join', p, g }],
    [{ t: 'drop', p, g }, { t: 'roster', p, g, action: 'confirm' }],
    [{ t: 'drop', p, g }, { t: 'drop', p: q, g }],
    [{ t: 'finalize', g: fg, who: 'everyone' }, { t: 'drop', p, g: g2 }],
    [{ t: 'finalize', g: fg, who: 'everyone' }, { t: 'join', p, g: g2 }],
    [{ t: 'finalize', g: fg, who: r.int(0, 4095) }, { t: 'unfinalize', g: fg }],
    [{ t: 'finalize', g: fg, who: 'everyone' }, { t: 'finalize', g: fg, who: r.int(0, 4095) }],
    [{ t: 'cancel', g }, { t: 'join', p, g }],
    [{ t: 'cancel', g }, { t: 'mark', p, g, paid: true }],
    [{ t: 'cancel', g }, { t: 'drop', p, g }],
    [{ t: 'cancel', g }, { t: 'usecredit', p, g }],
    [{ t: 'uncancel', g }, { t: 'join', p, g }],
    [{ t: 'undocredit', p, g }, { t: 'drop', p, g }],
    [{ t: 'undocredit', p, g }, { t: 'mark', p, g, paid: false }],
    [{ t: 'cashout', p, g, cents: 'offer' }, { t: 'refcancel', p }],
    [{ t: 'cashout', p, g, cents: 'offer' }, { t: 'resolve', p, action: 'refunded' }],
    [{ t: 'mark', p, g, paid: false }, { t: 'drop', p, g }],
    [{ t: 'roster', p, g, action: 'waitlist' }, { t: 'drop', p, g }],
    [{ t: 'roster', p, g, action: 'waitlist' }, { t: 'usecredit', p, g }],
    [{ t: 'roster', p, g, action: 'withdraw' }, { t: 'drop', p, g }],
    [{ t: 'court', g, action: 'booked' }, { t: 'drop', p, g }],
    [{ t: 'court', g, action: 'not_opened' }, { t: 'join', p, g }],
    [{ t: 'unfinalize', g: fg }, { t: 'usecredit', p, g: g2 }],
    [{ t: 'unfinalize', g: fg }, { t: 'refreq', p, cents: 'all' }],
    [{ t: 'refreq', p, cents: 'all' }, { t: 'usecredit', p, g }],
    [{ t: 'balrefund', p, refunded: true }, { t: 'usecredit', p, g }],
    [{ t: 'max', n: r.int(4, 6) }, { t: 'join', p, g }],
    [{ t: 'mark', p, g, paid: false }, { t: 'mark', p: q, g, paid: false }],
  ];
  const [a, b] = r.pick(races);
  return r.chance(0.5) ? { t: 'par', a, b } : { t: 'par', a: b, b: a };
}

// ---------------------------------------------------------------------------
// The world: a fresh copy of the set-up group per sequence

let tplPath = '';
let richPath = '';
let tplDir = '';
let emptyDir = '';
const tpl = { ids: {} as Record<string, string>, games: [] as string[], groupKey: '', orgCookies: new Map<string, string>(), phoneCookies: {} as Record<string, Map<string, string>> };

async function buildTemplate() {
  tplDir = mkdtempSync(join(tmpdir(), 'ledger-fuzz-'));
  emptyDir = join(tplDir, 'no-migrations');
  rmSync(emptyDir, { recursive: true, force: true });
  (await import('node:fs')).mkdirSync(emptyDir);
  tplPath = join(tplDir, 'template.db');
  const ctx = await setupGroup();
  for (const name of ['Gale', 'Harper', ORG]) {
    const r = await ctx.organizer.call('POST', '/api/admin/players', { name, phone: null });
    if (r.status !== 200) throw new Error(r.text);
  }
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: ORG });
  const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  ctx.byName = Object.fromEntries(dash.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  tpl.ids = { ...ctx.byName };
  tpl.groupKey = ctx.groupKey;
  tpl.games = dash.sessions
    .filter((s: any) => Date.parse(s.startsAt) > MONDAY_NOON)
    .sort((a: any, b: any) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, GAMES)
    .map((s: any) => s.id);
  if (tpl.games.length !== GAMES) throw new Error('not enough games');
  tpl.orgCookies = new Map(ctx.organizer.cookies);
  for (const name of PEOPLE) tpl.phoneCookies[name] = new Map((await playerPhone(ctx, name)).cookies);
  ctx.app.db.raw.exec(`VACUUM INTO '${tplPath.replace(/'/g, "''")}'`);

  // The credit-rich start: six players paid for the last game (Thu Nov 12) and dropped out, so each has $14
  // of credit; three then cashed part of it out, two have a cash-out request waiting.
  richPath = join(tplDir, 'rich.db');
  const g5 = tpl.games[GAMES - 1];
  const ok = (r: { status: number; text: string }) => {
    if (r.status !== 200) throw new Error(r.text);
    return r;
  };
  const phones: Record<string, Client> = {};
  for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Gale']) {
    const c = (phones[name] = new Client(ctx.app));
    c.groupKey = tpl.groupKey;
    c.cookies = new Map(tpl.phoneCookies[name]);
    ok(await c.call('POST', `/api/sessions/${g5}/join`, {}));
    ok(await ctx.organizer.call('POST', `/api/admin/sessions/${g5}/payment`, { playerId: tpl.ids[name], paid: true }));
    ok(await c.call('POST', `/api/sessions/${g5}/withdraw`, {}));
    ctx.app.advance(1000);
  }
  for (const [name, cents] of [['Blair', 900], ['Casey', 1100], ['Gale', 700]] as const) {
    const id = ok(await phones[name].call('POST', '/api/me/refund-request', { cents })) && ((await phones[name].call('GET', '/api/group')).data.credit.pending.id as string);
    ok(await ctx.organizer.call('POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents }));
    ctx.app.advance(1000);
  }
  ok(await phones.Devon.call('POST', '/api/me/refund-request', { cents: 1000 }));
  ok(await phones.Emery.call('POST', '/api/me/refund-request', { cents: 1400 }));
  ctx.app.db.raw.exec(`VACUUM INTO '${richPath.replace(/'/g, "''")}'`);
}
/** The books of the credit-rich start: 6 x $14 paid in, $9 + $11 + $7 paid back out. */
const RICH_BOOK = { cashIn: 6 * 1400, cashedOut: 900 + 1100 + 700 };

/** A copy of the template database in memory (much faster than running the migrations and setup again). */
function cloneDb(rich: boolean) {
  const d = createNodeD1(':memory:', emptyDir);
  const raw = d.raw;
  raw.exec('PRAGMA foreign_keys = OFF; DROP TABLE _migrations;');
  raw.exec(`ATTACH '${(rich ? richPath : tplPath).replace(/'/g, "''")}' AS tpl`);
  const objs = raw.prepare("SELECT type, name, sql FROM tpl.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all() as { type: string; name: string; sql: string }[];
  raw.exec('BEGIN');
  for (const o of objs.filter((x) => x.type === 'table')) {
    raw.exec(o.sql);
    raw.exec(`INSERT INTO main."${o.name}" SELECT * FROM tpl."${o.name}"`);
  }
  for (const o of objs.filter((x) => x.type !== 'table')) raw.exec(o.sql);
  raw.exec('COMMIT');
  raw.exec('DETACH tpl; PRAGMA foreign_keys = ON;');
  return d;
}

class FuzzApp {
  db: ReturnType<typeof cloneDb>;
  env: { DB: ReturnType<typeof cloneDb>; SETUP_TOKEN: string };
  now: number;
  constructor(rich: boolean) {
    this.db = cloneDb(rich);
    this.env = { DB: this.db, SETUP_TOKEN: 'unused' };
    // The rich start's own steps took a few seconds.
    this.now = MONDAY_NOON + (rich ? 60_000 : 0);
  }
  background: Promise<unknown>[] = [];
  async settle() {
    while (this.background.length) await Promise.allSettled(this.background.splice(0));
  }
}

interface Violation {
  code: string;
  msg: string;
}

class World {
  app: FuzzApp;
  org: Client;
  phones: Record<string, Client> = {};
  ids = tpl.ids;
  games = tpl.games;
  book = { cashIn: 0, cashedOut: 0 };
  /** Cash in each seat's current live payment, as the books know it (`g:Name`). */
  curCash = new Map<string, { cents: number; paidAt: string | null }>();
  screenTurn = 0;
  /** The flat price was changed in this sequence: a seat paid before keeps its payment until Finalize settles the difference. */
  priceChanged = false;
  /** The last cash-out offer a join returned, per seat. */
  offers = new Map<string, number>();
  constructor(rich = false) {
    this.app = new FuzzApp(rich);
    if (rich) this.book = { ...RICH_BOOK };
    const app = this.app as unknown as TestApp;
    this.org = new Client(app);
    this.org.cookies = new Map(tpl.orgCookies);
    for (const n of PEOPLE) {
      const c = new Client(app);
      c.groupKey = tpl.groupKey;
      c.cookies = new Map(tpl.phoneCookies[n]);
      this.phones[n] = c;
    }
  }
  nameOf(id: string) {
    return Object.keys(this.ids).find((n) => this.ids[n] === id) ?? id.slice(0, 8);
  }
  gameOf(id: string) {
    const i = this.games.indexOf(id);
    return i >= 0 ? `g${i}` : `s:${id.slice(0, 8)}`;
  }
  get raw() {
    return this.app.db.raw;
  }
  row(g: G, p: P) {
    return this.raw.prepare('SELECT * FROM session_players WHERE session_id = ? AND player_id = ?').get(this.games[g], this.ids[p]) as any;
  }
  session(g: G) {
    return this.raw.prepare('SELECT * FROM sessions WHERE id = ?').get(this.games[g]) as any;
  }
  pot(p: P) {
    const r = this.raw
      .prepare(
        "SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS n FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL",
      )
      .get(this.ids[p]) as { n: number };
    return Number(r.n);
  }
  pending(p: P) {
    return this.raw.prepare("SELECT * FROM refund_requests WHERE player_id = ? AND status = 'pending'").get(this.ids[p]) as any;
  }
  /** A quick look at the data for the generator. */
  look(): Look {
    const raw = this.raw;
    const games = this.games.map((id) => {
      const s = raw.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
      const seats = new Map<P, { status: string; paid: boolean }>();
      for (const r of raw.prepare('SELECT player_id, status, payment_status, refunded_at FROM session_players WHERE session_id = ?').all(id) as any[])
        seats.set(this.nameOf(r.player_id), { status: r.status, paid: r.payment_status === 'paid' && !r.refunded_at });
      return { start: Date.parse(s.starts_at), end: Date.parse(s.ends_at), canceled: s.status === 'canceled', finalized: !!s.finalized_at, courtWaiting: s.court_state === 'waitlist', seats };
    });
    const pots = new Map<P, number>();
    for (const p of PLAYERS) pots.set(p, this.pot(p));
    const pending = new Set<P>();
    for (const r of raw.prepare("SELECT player_id FROM refund_requests WHERE status = 'pending'").all() as any[]) pending.add(this.nameOf(r.player_id));
    const refundedReq = new Set<P>();
    for (const r of raw.prepare("SELECT player_id FROM refund_requests WHERE status = 'refunded'").all() as any[]) refundedReq.add(this.nameOf(r.player_id));
    return { now: this.app.now, games, pots, pending, refundedReq, offers: new Set(this.offers.keys()) };
  }
  /** What the player's own screen says they owe for this game (what Venmo would open for). */
  async owedOnScreen(p: P, g: G) {
    const v = await this.phones[p].call('GET', '/api/group');
    return (v.data.owed ?? []).find((o: any) => o.sessionId === this.games[g])?.amountCents ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Running one action

interface Res {
  status: number;
  data: any;
}
interface Prepared {
  run: () => Promise<Res>;
  /** Book-keeping after the response; `seen` holds seats a payment already counted in this step (a double tap pays once). */
  post: (res: Res, seen: Set<string>) => void;
}
const NOOP_POST = () => {};

/** "Mark refunded" taken back: that Venmo never went out. The refund rows this step ended, counted once per step. */
function undoneRefund(w: World, p: P, res: Res, seen: Set<string>) {
  if (res.status !== 200 || !res.data?.changed || seen.has(`undo:${p}`)) return;
  seen.add(`undo:${p}`);
  const row = w.raw
    .prepare("SELECT COALESCE(SUM(amount_cents - five_cents), 0) AS n FROM credit_ledger WHERE kind = 'refunded' AND player_id = ? AND ended_at = ? AND ended_reason = 'undone'")
    .get(w.ids[p], new Date(w.app.now).toISOString()) as { n: number };
  w.book.cashedOut -= Number(row.n);
}

async function prepare(w: World, a: Action): Promise<Prepared> {
  const sid = 'g' in a ? w.games[a.g] : '';
  const phone = 'p' in a ? w.phones[a.p] : w.org;
  const call = (c: Client, method: string, path: string, body?: unknown) => () => c.call(method, path, body) as Promise<Res>;
  switch (a.t) {
    case 'join':
      return {
        run: call(phone, 'POST', `/api/sessions/${sid}/join`, {}),
        post: (res) => {
          if (res.data?.cashOutOffer) w.offers.set(`${a.g}:${a.p}`, res.data.cashOutOffer.cents);
        },
      };
    case 'drop':
      return { run: call(phone, 'POST', `/api/sessions/${sid}/withdraw`, {}), post: NOOP_POST };
    case 'decline':
      return { run: call(phone, 'POST', `/api/sessions/${sid}/decline`, {}), post: NOOP_POST };
    case 'usecredit':
      return { run: call(phone, 'POST', `/api/sessions/${sid}/use-credit`, {}), post: NOOP_POST };
    case 'undocredit':
      return { run: call(phone, 'POST', `/api/sessions/${sid}/undo-credit`, {}), post: NOOP_POST };
    case 'cashout': {
      const cents = a.cents === 'offer' ? (w.offers.get(`${a.g}:${a.p}`) ?? 100) : a.cents;
      return { run: call(phone, 'POST', `/api/sessions/${sid}/use-cash-out`, { cents }), post: NOOP_POST };
    }
    case 'refreq': {
      const usable = Math.max(0, w.pot(a.p) - (w.pending(a.p)?.amount_cents ?? 0));
      const cents = a.cents === 'all' ? usable : a.cents === 'over' ? usable + 100 : a.cents;
      return { run: call(phone, 'POST', '/api/me/refund-request', { cents }), post: NOOP_POST };
    }
    case 'refcancel':
      return { run: call(phone, 'POST', '/api/me/refund-request/cancel', {}), post: NOOP_POST };
    case 'ipaid':
    case 'mark': {
      const key = `${a.g}:${a.p}`;
      const before = w.row(a.g, a.p);
      const owed = a.paid && a.p !== ORG ? await w.owedOnScreen(a.p, a.g) : 0;
      const run =
        a.t === 'ipaid'
          ? // Like the app since Oct 31: "I paid" sends the amount the screen showed.
            call(phone, 'POST', `/api/sessions/${sid}/paid`, a.paid ? { paid: a.paid, cents: owed } : { paid: a.paid })
          : call(w.org, 'POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.ids[a.p], paid: a.paid });
      return {
        run,
        post: (res, seen) => {
          if (a.p === ORG || res.status !== 200 || !res.data?.changed || seen.has(key)) return;
          const wasPaid = before?.payment_status === 'paid';
          if (a.paid && !wasPaid) {
            // The Venmo they sent: what their screen said.
            w.book.cashIn += owed;
            w.curCash.set(key, { cents: owed, paidAt: w.row(a.g, a.p)?.paid_at ?? null });
            seen.add(key);
          } else if (!a.paid && wasPaid) {
            // The payment never happened: its cash is taken back.
            w.book.cashIn -= w.curCash.get(key)?.cents ?? 0;
            w.curCash.delete(key);
            seen.add(key);
          }
        },
      };
    }
    case 'roster':
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.ids[a.p], action: a.action }), post: NOOP_POST };
    case 'orgme':
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/me`, { in: a.in }), post: NOOP_POST };
    case 'cancel':
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/decision`, { decision: 'cancel', confirm: true, reason: 'rain' }), post: NOOP_POST };
    case 'uncancel':
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/decision`, { decision: 'reopen' }), post: NOOP_POST };
    case 'resched': {
      const s = w.session(a.g);
      const startsAt = new Date(Date.parse(s.starts_at) + a.hours * HOUR).toISOString();
      const endsAt = new Date(Date.parse(s.ends_at) + a.hours * HOUR).toISOString();
      return { run: call(w.org, 'PUT', `/api/admin/sessions/${sid}/time`, { startsAt, endsAt }), post: NOOP_POST };
    }
    case 'court': {
      if (a.action === 'booked') return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/booked`, {}), post: NOOP_POST };
      if (a.action === 'not_booked') return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/court-answer`, { booked: false }), post: NOOP_POST };
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/court`, { action: a.action }), post: NOOP_POST };
    }
    case 'finalize': {
      // After the game: move the clock past its end first (never back).
      const s = w.session(a.g);
      w.app.now = Math.max(w.app.now, Date.parse(s.ends_at) + 5 * 60_000);
      let body: Record<string, unknown> = { everyone: true };
      if (a.who !== 'everyone') {
        const confirmed = (w.raw.prepare("SELECT player_id FROM session_players WHERE session_id = ? AND status = 'confirmed' ORDER BY confirm_seq").all(sid) as { player_id: string }[]).map(
          (x) => x.player_id,
        );
        const mask = a.who;
        body = { played: confirmed.filter((_, i) => (mask >> i) & 1) };
      }
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/finalize`, body), post: NOOP_POST };
    }
    case 'unfinalize':
      return { run: call(w.org, 'POST', `/api/admin/sessions/${sid}/reopen`, {}), post: NOOP_POST };
    case 'resolve': {
      const pend = w.pending(a.p);
      if (a.action === 'undo') {
        const last = w.raw.prepare("SELECT * FROM refund_requests WHERE player_id = ? AND status = 'refunded' ORDER BY resolved_at DESC, rowid DESC").get(w.ids[a.p]) as any;
        return {
          run: call(w.org, 'POST', `/api/admin/refund-requests/${last?.id ?? '00000000-0000-4000-8000-000000000000'}`, { action: 'undo' }),
          post: (res, seen) => undoneRefund(w, a.p, res, seen),
        };
      }
      const id = pend?.id ?? '00000000-0000-4000-8000-000000000000';
      if (a.action === 'not_now') return { run: call(w.org, 'POST', `/api/admin/refund-requests/${id}`, { action: 'not_now' }), post: NOOP_POST };
      // Mark refunded: the organizer sent the card's amount on Venmo (or a stale card's amount).
      const shown = (pend?.amount_cents ?? 100) + (a.action === 'stale' ? 100 : 0);
      return {
        run: call(w.org, 'POST', `/api/admin/refund-requests/${id}`, { action: 'refunded', cents: shown }),
        post: (res) => {
          if (res.status === 200 && res.data?.changed) w.book.cashedOut += shown;
        },
      };
    }
    case 'balrefund': {
      const path = `/api/admin/players/${w.ids[a.p]}/credit-refund`;
      if (!a.refunded) {
        return { run: call(w.org, 'POST', path, { refunded: false }), post: (res, seen) => undoneRefund(w, a.p, res, seen) };
      }
      const usable = Math.max(0, w.pot(a.p) - (w.pending(a.p)?.amount_cents ?? 0));
      const cents = a.stale ? Math.max(100, usable - 100) : usable;
      return {
        run: call(w.org, 'POST', path, { refunded: true, cents }),
        post: (res) => {
          if (res.status === 200 && res.data?.changed) w.book.cashedOut += cents;
        },
      };
    }
    case 'max':
      return { run: call(w.org, 'PUT', '/api/admin/group', { settings: { maxPlayers: a.n } }), post: NOOP_POST };
    case 'price':
      w.priceChanged = true;
      return { run: call(w.org, 'PUT', '/api/admin/group', { settings: { pricePerPlayerCents: a.cents } }), post: NOOP_POST };
    case 'tick':
      w.app.now += a.ms;
      return { run: async () => ({ status: 0, data: null }), post: NOOP_POST };
    case 'to': {
      const s = w.session(a.g);
      const base = a.at === 'start' ? Date.parse(s.starts_at) : a.at === 'end' ? Date.parse(s.ends_at) : Date.parse(s.cancellation_deadline_at ?? s.starts_at);
      w.app.now = Math.max(w.app.now, base + a.min * 60_000);
      return { run: async () => ({ status: 0, data: null }), post: NOOP_POST };
    }
    case 'par':
    case 'tpl':
      throw new Error(`not a single action: ${a.t}`);
  }
}

const short = (res: Res) => (res.status === 0 ? '' : `${res.status} ${typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 140) : String(res.data).slice(0, 80)}`);

/**
 * After a step: a seat whose payment is gone (back to unpaid by itself, or a
 * rejoin after it became credit) no longer carries book cash; the books then
 * show whether that cash went somewhere. A settled payment keeps it: Reopen
 * can make it live again, and an Unmark then takes that cash back.
 */
function reconcile(w: World) {
  for (const [key, c] of [...w.curCash]) {
    const [g, p] = key.split(':');
    const r = w.row(Number(g), p);
    // Gone, or a different payment now (paid again later, by credit or by the organizer).
    if (!r || r.payment_status !== 'paid' || r.paid_at !== c.paidAt) w.curCash.delete(key);
  }
}

/** One step: one action, or two at the same instant. Returns a log line. */
/** Per action, how often it did something (2xx) or was refused: shows whether the fuzz reaches real states. */
const stats = new Map<string, { ok: number; no: number }>();
const why = new Map<string, number>();
function count(a: Action, res: Res) {
  if (res.status === 0) return;
  const k = a.t === 'mark' || a.t === 'ipaid' ? `${a.t}:${a.paid}` : a.t === 'court' || a.t === 'roster' || a.t === 'resolve' ? `${a.t}:${a.action}` : a.t;
  const x = stats.get(k) ?? { ok: 0, no: 0 };
  if (res.status === 200 && res.data?.changed !== false && res.data?.result !== 'not_in_session') x.ok++;
  else {
    x.no++;
    const e = `${k}:${res.data?.error ?? res.data?.result ?? (res.data?.changed === false ? 'unchanged' : res.status)}`;
    why.set(e, (why.get(e) ?? 0) + 1);
  }
  stats.set(k, x);
}

async function step(w: World, a: Action): Promise<string> {
  if (a.t === 'tpl') return '';
  // Taps a person makes one after another are a second or two apart; the two halves of a race are not.
  w.app.now += 1000;
  if (a.t === 'par') {
    const pa = await prepare(w, a.a);
    const pb = await prepare(w, a.b);
    const [ra, rb] = await Promise.all([pa.run(), pb.run()]);
    count(a.a, ra);
    count(a.b, rb);
    const seen = new Set<string>();
    pa.post(ra, seen);
    pb.post(rb, seen);
    await w.app.settle();
    reconcile(w);
    return `${short(ra)} || ${short(rb)}`;
  }
  const p = await prepare(w, a);
  const res = await p.run();
  count(a, res);
  p.post(res, new Set());
  await w.app.settle();
  reconcile(w);
  return short(res);
}

// ---------------------------------------------------------------------------
// The invariants, read straight from the database

interface Snapshot {
  pots: Map<string, number>;
  holds: number;
}

const effect = (r: any) => (r.kind === 'kept' ? r.amount_cents : r.kind === 'used' ? -r.amount_cents : -(r.amount_cents - r.five_cents));

function checkDb(w: World, out: Violation[]): Snapshot {
  const add = (code: string, msg: string) => out.push({ code, msg });
  const raw = w.raw;
  const orgId = w.ids[ORG];
  const flat = Number(JSON.parse((raw.prepare('SELECT settings_json FROM groups').get() as { settings_json: string }).settings_json).pricePerPlayerCents ?? 1400);
  const ledger = raw.prepare('SELECT * FROM credit_ledger ORDER BY created_at, rowid').all() as any[];
  const live = ledger.filter((r) => !r.ended_at);
  const pots = new Map<string, number>();
  for (const r of live) pots.set(r.player_id, (pots.get(r.player_id) ?? 0) + effect(r));

  // 1. No pot below $0.
  for (const [pid, n] of pots) if (n < 0) add('I1.pot-negative', `${w.nameOf(pid)}'s pot is ${n}`);

  // 4. The organizer never has credit: no ledger row of any kind, no refund request.
  for (const r of ledger) if (r.player_id === orgId) add('I4.organizer-ledger', `organizer has a ${r.kind}/${r.reason} row of ${r.amount_cents} on ${r.session_id ? w.gameOf(r.session_id) : '-'}${r.ended_at ? ' (ended)' : ''}`);

  // 7. Refund requests: one pending at most, never above the pot.
  const pend = raw.prepare("SELECT * FROM refund_requests WHERE status = 'pending'").all() as any[];
  const byP = new Map<string, any[]>();
  for (const q of pend) byP.set(q.player_id, [...(byP.get(q.player_id) ?? []), q]);
  for (const [pid, qs] of byP) {
    if (pid === orgId) add('I4.organizer-request', 'organizer has a pending refund request');
    if (qs.length > 1) add('I7.two-pending', `${w.nameOf(pid)} has ${qs.length} pending requests`);
    const total = qs.reduce((s, q) => s + q.amount_cents, 0);
    if (total > (pots.get(pid) ?? 0)) add('I7.pending-above-pot', `${w.nameOf(pid)} asks ${total}, pot ${pots.get(pid) ?? 0}`);
  }

  // Cash pairs are matched (+kept cash = -used cash) per seat; ledger rows are sane.
  const seat = new Map<string, { usedNC: number; usedCash: number; keptCash: number; keptFin: number; usedAll: number }>();
  const S = (sid: string, pid: string) => {
    const k = `${sid}:${pid}`;
    let x = seat.get(k);
    if (!x) seat.set(k, (x = { usedNC: 0, usedCash: 0, keptCash: 0, keptFin: 0, usedAll: 0 }));
    return x;
  };
  for (const r of live) {
    if (!r.session_id) {
      if (r.kind !== 'refunded') add('I2.row-without-game', `${w.nameOf(r.player_id)} ${r.kind} ${r.amount_cents} with no game`);
      continue;
    }
    const x = S(r.session_id, r.player_id);
    if (r.kind === 'used') {
      x.usedAll += r.amount_cents;
      if (r.reason === 'cash') x.usedCash += r.amount_cents;
      else x.usedNC += r.amount_cents;
    } else if (r.kind === 'kept') {
      if (r.reason === 'cash') x.keptCash += r.amount_cents;
      if (r.reason === 'finalized') x.keptFin += r.amount_cents;
    }
  }
  for (const [k, x] of seat) if (x.usedCash !== x.keptCash) add('I2.cash-pair-unmatched', `${k}: used cash ${x.usedCash}, kept cash ${x.keptCash}`);

  // Seats.
  const seats = raw
    .prepare('SELECT sp.*, s.status AS s_status, s.finalized_at AS s_fin, s.final_price_cents AS s_price, s.ends_at AS s_ends FROM session_players sp JOIN sessions s ON s.id = sp.session_id')
    .all() as any[];
  let holds = 0;
  for (const sp of seats) {
    const who = `${w.nameOf(sp.player_id)}@${w.gameOf(sp.session_id)}`;
    const x = seat.get(`${sp.session_id}:${sp.player_id}`) ?? { usedNC: 0, usedCash: 0, keptCash: 0, keptFin: 0, usedAll: 0 };
    const paid = sp.payment_status === 'paid';
    const settled = paid && !!sp.refunded_at;
    const live = paid && !sp.refunded_at;
    const pay = sp.payment_amount_cents ?? 0;
    if (sp.player_id === orgId) continue; // the court payment row
    if (paid && pay <= 0 && !settled) add('I3.paid-nothing', `${who} paid with amount ${sp.payment_amount_cents}`);
    // What the group holds from this seat (2).
    const h = settled ? 0 : live ? pay - x.keptFin : x.usedNC + x.usedCash;
    if (live && pay - x.keptFin < 0) add('I3.back-above-payment', `${who}: paid ${pay}, came back ${x.keptFin}`);
    holds += h;
    const canceled = sp.s_status === 'canceled';
    // 6. A withdrawn or declined seat, or any seat in a canceled game, holds nothing.
    if (canceled || sp.status === 'withdrawn' || sp.status === 'declined') {
      const where = canceled ? 'canceled game' : sp.status;
      if (x.usedAll > 0 && !settled) add('I6.credit-on-dead-seat', `${who} (${where}): ${x.usedAll} credit still used on it`);
      if (live) add('I6.cash-on-dead-seat', `${who} (${where}): payment ${pay} still held (not settled)`);
      continue;
    }
    if (sp.status === 'waitlisted') {
      // A seat paid in full stays paid on the waitlist (by design); credit on an unpaid one goes back.
      if (!paid && x.usedAll > 0) add('I6.credit-on-waitlist', `${who}: ${x.usedAll} credit on an unpaid waitlist spot`);
      continue;
    }
    if (settled) continue;
    // 3. Confirmed seats: the pieces add up to the price.
    const fin = !!sp.s_fin;
    const price = fin ? (sp.played === 1 ? sp.s_price : 0) : flat;
    if (live) {
      if (fin && sp.played === 0) add('I3.not-played-still-paid', `${who}: did not play, payment ${pay} kept`);
      else if (fin && pay - x.keptFin !== price) add('I3.final-pieces', `${who}: paid ${pay} - back ${x.keptFin} != final price ${price}`);
      // Weakened: after the game ends, a seat paid at an earlier final price and then reopened shows paid below the flat
      // price until the redo of Finalize (which holds that cash and asks the rest, checked exactly above).
      else if (!fin && pay < price && w.app.now < Date.parse(sp.s_ends) && !w.priceChanged) add('I3.paid-below-price', `${who}: paid ${pay} < price ${price}`);
      if (pay < x.usedNC + x.usedCash) add('I3.credit-above-payment', `${who}: payment ${pay} < credit ${x.usedNC} + earlier cash ${x.usedCash}`);
    } else {
      if (x.usedNC + x.usedCash > price) add('I3.credit-above-price', `${who}: unpaid, credit ${x.usedNC} + earlier cash ${x.usedCash} > price ${price}`);
      else if (price > 0 && x.usedNC + x.usedCash === price) add('I3.unpaid-but-covered', `${who}: unpaid with ${x.usedNC} credit + ${x.usedCash} cash = price ${price}`);
    }
  }

  // 2. The books.
  const potSum = [...pots.values()].reduce((s, n) => s + n, 0);
  const refunded = live.filter((r) => r.kind === 'refunded').reduce((s, r) => s + r.amount_cents - r.five_cents, 0);
  if (refunded !== w.book.cashedOut) add('I2.cashed-out', `ledger refunded ${refunded} != cash sent back ${w.book.cashedOut}`);
  const sum = holds + potSum + w.book.cashedOut;
  if (sum !== w.book.cashIn)
    add('I2.books', `cash in ${w.book.cashIn} != held/kept by group ${holds} + pots ${potSum} + cashed out ${w.book.cashedOut} (= ${sum}): ${sum > w.book.cashIn ? 'created' : 'lost'} ${Math.abs(sum - w.book.cashIn)}`);
  return { pots, holds };
}

/** 5 and 1b: what the screens say, against each other and against the ledger. */
async function checkScreens(w: World, snap: Snapshot, out: Violation[], full = true) {
  const add = (code: string, msg: string) => out.push({ code, msg });
  const d = (await w.org.call('GET', '/api/admin/dashboard')).data;
  const months = [];
  for (const m of MONTHS) months.push((await w.org.call('GET', `/api/admin/money?month=${m}`)).data);
  const sumHeld = months.reduce((s, m) => s + m.heldCents, 0);
  const sumCollected = months.reduce((s, m) => s + m.collectedCents, 0);
  const sumOwed = months.reduce((s, m) => s + m.creditsOwedCents, 0);
  const potTotal = [...snap.pots].filter(([id]) => id !== w.ids[ORG]).reduce((s, [, n]) => s + Math.max(0, n), 0);
  if (sumHeld + sumCollected !== snap.holds) add('I5.money-total', `Money held ${sumHeld} + collected ${sumCollected} != what the group holds ${snap.holds}`);
  if (heldCents(d) !== sumHeld) add('I5.players-held', `Players tab held ${heldCents(d)} != Money held ${sumHeld}`);
  if (sumOwed !== potTotal) add('I5.credits-owed', `Money credits owed ${sumOwed} != pots ${potTotal}`);
  for (const m of months) {
    const c = m.sessions.reduce((s: number, x: any) => s + x.collectedCents, 0);
    if (c !== m.collectedCents) add('I5.month-sum', `${m.month}: games ${c} != collected ${m.collectedCents}`);
    if (m.netCents !== m.collectedCents - m.courtCostCents) add('I5.month-net', `${m.month}: net`);
  }
  if (d.creditLedger.some((l: any) => l.playerId === w.ids[ORG])) add('I4.organizer-on-players-tab', 'organizer has a credit row on Players');
  for (const p of PLAYERS) {
    const id = w.ids[p];
    const pot = Math.max(0, snap.pots.get(id) ?? 0);
    const shown = d.creditLedger.find((l: any) => l.playerId === id)?.balanceCents ?? 0;
    if (shown !== pot) add('I1.players-tab-pot', `${p}: Players tab ${shown} != ledger ${pot}`);
    if (balanceOf(d, id).creditCents !== pot) add('I1.balance-of', `${p}: balanceOf ${balanceOf(d, id).creditCents} != ledger ${pot}`);
  }
  // Per game, as audit-money's agree(): Collected = what the roster kept; the court row adds up.
  const rows = months.flatMap((m) => m.sessions);
  const dashSeat = new Map<string, any>();
  for (const s of d.sessions) {
    const others = s.roster.filter((r: any) => !r.isOrganizer);
    for (const r of others) dashSeat.set(`${s.id}:${r.playerId}`, r);
    if (s.status === 'canceled') continue;
    const kept = others.reduce((sum: number, r: any) => sum + (r.paymentStatus === 'paid' && !r.refundedAt ? Math.max(0, r.paymentAmountCents - r.creditBackCents) : (r.paidEarlierCents ?? 0)), 0);
    const unpaidOwes = others.reduce((sum: number, r: any) => sum + r.owesCents, 0);
    const creditOnUnpaid = others.reduce((sum: number, r: any) => sum + (r.status === 'confirmed' && r.paymentStatus === 'unpaid' ? r.creditCents : 0), 0);
    const row = rows.find((x: any) => x.id === s.id);
    if (s.finalized && row && row.collectedCents !== kept) add('I5.game-collected', `${w.gameOf(s.id)}: Money collected ${row.collectedCents} != roster kept ${kept}`);
    if (s.court && s.court.playersCoverCents !== kept + unpaidOwes + creditOnUnpaid)
      add('I5.court-row', `${w.gameOf(s.id)}: court row covers ${s.court.playersCoverCents} != kept ${kept} + owed ${unpaidOwes} + credit on unpaid ${creditOnUnpaid}`);
    // 3 as shown: an unpaid seat's credit + earlier cash + due = its price.
    for (const r of others) {
      if (r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null) continue;
      if (r.creditCents + r.paidEarlierCents + r.owesCents !== r.shareCents)
        add('I3.seat-pieces-shown', `${r.name}@${w.gameOf(s.id)}: credit ${r.creditCents} + earlier ${r.paidEarlierCents} + due ${r.owesCents} != price ${r.shareCents}`);
    }
  }
  // Each player's own screen (mid-sequence: three of them, in turn).
  const who = full ? PEOPLE : [0, 1, 2].map((k) => PEOPLE[(w.screenTurn++ * 3 + k) % PEOPLE.length]);
  for (const p of who) {
    const id = w.ids[p];
    const v = (await w.phones[p].call('GET', '/api/group')).data;
    const pot = Math.max(0, snap.pots.get(id) ?? 0);
    const reserved = w.pending(p)?.amount_cents ?? 0;
    if (v.credit.balanceCents !== (p === ORG ? 0 : pot)) add('I1.own-pot', `${p} sees ${v.credit.balanceCents}, ledger ${pot}`);
    if (p !== ORG && v.credit.usableCents !== Math.max(0, pot - reserved)) add('I1.own-usable', `${p} sees usable ${v.credit.usableCents}, ledger ${pot} - ${reserved}`);
    if (p === ORG && v.owed.length) add('I4.organizer-owes', `organizer sees ${v.owed.length} owed`);
    for (const o of v.owed) {
      const r = dashSeat.get(`${o.sessionId}:${id}`);
      if (r && r.owesCents !== o.amountCents) add('I5.owed-vs-dashboard', `${p}@${w.gameOf(o.sessionId)}: own screen owes ${o.amountCents}, dashboard ${r.owesCents}`);
      const card = v.sessions.find((s: any) => s.id === o.sessionId);
      if (card?.mine && card.mine.oweCents !== o.amountCents) add('I5.card-vs-owed', `${p}@${w.gameOf(o.sessionId)}: card ${card.mine.oweCents} != owed ${o.amountCents}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Running sequences

interface Failure {
  seed: number | null;
  /** How to run it again from the seed (FUZZ_REPLAY). */
  replay?: string;
  stepIndex: number;
  steps: Action[];
  log: string[];
  violations: Violation[];
}

/**
 * Bugs this file found that are not fixed yet: each has a named it.fails case
 * below. The fuzz still counts them and prints a summary, but only fails on
 * them with FUZZ_STRICT=1, so it stays useful for finding new ones.
 */
const KNOWN: { code: string; test: string; at?: Action['t'][]; match?: RegExp; line?: RegExp; priceChanged?: true }[] = [
  // The price changed under a payment tap that carries no amount (Reopen, Finalize, un-cancel at the same moment).
  { code: 'I2.books', at: ['price'], match: /created|lost/, line: / \|\| /, test: 'D. "I paid" or Mark paid at the same moment as Reopen or Finalize records the new price' },
  // Shows at whichever step the screens are next compared.
  { code: 'I5.players-held', test: 'H. Players tab Held leaves out cash held against an unpaid seat' },
  // Only with FUZZ_PRICE (the flat price changed in the sequence).
  ...(['I3.credit-above-price', 'I3.unpaid-but-covered', 'I3.seat-pieces-shown', 'I5.court-row', 'I3.credit-above-payment'] as const).map((code) => ({
    code,
    priceChanged: true as const,
    test: 'G. The price lowered below the credit on an unpaid seat',
  })),
];

const typesOf = (a: Action): Action['t'][] => (a.t === 'par' ? [a.a.t, a.b.t] : [a.t]);
const knownOf = (v: Violation, a: Action, line: string, priceChanged: boolean) =>
  KNOWN.find(
    (k) =>
      k.code === v.code &&
      (!k.at || typesOf(a).some((t) => k.at!.includes(t))) &&
      (!k.match || k.match.test(v.msg)) &&
      (!k.line || k.line.test(line)) &&
      (!k.priceChanged || priceChanged),
  );

type Source = { steps: Action[] } | { seed: number; n: number; par: number };

/** Run a fixed step list, or generate one step at a time from a seed (looking at the data, like a person would). */
export async function runSteps(src: Source | Action[], opts: { screens?: boolean; stopOnKnown?: boolean } = {}): Promise<Failure | null> {
  const source: Source = Array.isArray(src) ? { steps: src } : src;
  const rng = 'seed' in source ? prng(source.seed) : null;
  const rich = rng ? rng.chance(0.5) : 'steps' in source && source.steps[0]?.t === 'tpl' && source.steps[0].rich;
  const w = new World(rich);
  const log: string[] = [];
  lastLog = log;
  const steps: Action[] = 'steps' in source ? source.steps : [{ t: 'tpl', rich }];
  const n = 'steps' in source ? source.steps.length : source.n + 1;
  const seed = 'seed' in source ? source.seed : null;
  // Generated runs start with a few sign-ups and payments, so games have 4 to 8 players and money moves.
  const warm = rng ? rng.int(Math.min(6, n), Math.floor(n * 0.5)) : 0;
  for (let i = 0; i < n; i++) {
    if (rng && 'par' in source && i > 0) {
      const L = w.look();
      steps.push(i <= warm ? genWarm(rng, L) : rng.chance(source.par) ? genPar(rng, L) : genOne(rng, L));
    }
    let line: string;
    try {
      line = await step(w, steps[i]);
    } catch (err) {
      return { seed, stepIndex: i, steps, log, violations: [{ code: 'X.harness', msg: String(err instanceof Error ? err.stack : err) }] };
    }
    log.push(`${String(i).padStart(2)} ${new Date(w.app.now).toISOString().slice(5, 16)} ${JSON.stringify(steps[i])} -> ${line}`);
    const v: Violation[] = [];
    const snap = checkDb(w, v);
    if ((opts.screens ?? true) && (i === n - 1 || (i + 1) % SCREEN_EVERY === 0)) await checkScreens(w, snap, v, i === n - 1);
    // A 500 from the server is a bug too.
    if (/^500 /.test(line) || / \|\| 500 /.test(line)) v.push({ code: 'X.server-error', msg: line });
    const counted = STRICT || opts.stopOnKnown ? v : v.filter((x) => !knownOf(x, steps[i], line, w.priceChanged));
    if (counted.length) return { seed, stepIndex: i, steps, log, violations: counted };
    // Only known bugs: counted, and the sequence ends there (what follows would be judged on broken books).
    if (v.length) {
      const which = new Set(v.map((x) => knownOf(x, steps[i], line, w.priceChanged)!.test.split('.')[0]));
      for (const k of which) knownSeen.set(k, (knownSeen.get(k) ?? 0) + 1);
      break;
    }
  }
  return null;
}
/** Sequences that ran into each known bug, by its letter (they end there). */
const knownSeen = new Map<string, number>();


function report(f: Failure): string {
  const how = f.replay ? `seed ${f.seed}: FUZZ_REPLAY=${f.replay}, or the step list below as FUZZ_REPLAY='[...]'` : `FUZZ_REPLAY='<the step list below>'`;
  const head = `ledger fuzz failure (replay with ${how})\nat step ${f.stepIndex}:\n`;
  const vs = f.violations.map((v) => `  [${v.code}] ${v.msg}`).join('\n');
  return `${head}${vs}\nsteps run:\n${f.log.join('\n')}\nstep list (JSON):\n${JSON.stringify(f.steps.slice(0, f.stepIndex + 1))}`;
}

/** Shorter list that still breaks the same invariant: drop chunks, then single steps, then simplify pairs. */
async function shrink(f: Failure): Promise<Failure> {
  const code = f.violations[0].code;
  const at = typesOf(f.steps[f.stepIndex]).sort().join('+');
  const fails = async (steps: Action[]) => {
    const r = await runSteps(steps.slice(), { screens: true });
    return r && r.violations.some((v) => v.code === code) && typesOf(r.steps[r.stepIndex]).sort().join('+') === at ? r : null;
  };
  let best = f.steps.slice(0, f.stepIndex + 1);
  let bestF = f;
  for (let size = Math.ceil(best.length / 2); size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i + size <= best.length; ) {
      const cand = [...best.slice(0, i), ...best.slice(i + size)];
      const r = cand.length ? await fails(cand) : null;
      if (r) {
        best = cand.slice(0, r.stepIndex + 1);
        bestF = r;
      } else i += size;
    }
  }
  // A race that still fails as two plain steps is not a race.
  for (let i = 0; i < best.length; i++) {
    const a = best[i];
    if (a.t !== 'par') continue;
    for (const cand of [[...best.slice(0, i), a.a, ...best.slice(i + 1)], [...best.slice(0, i), a.a, a.b, ...best.slice(i + 1)], [...best.slice(0, i), a.b, a.a, ...best.slice(i + 1)]]) {
      const r = await fails(cand);
      if (r && r.steps.length <= best.length + 1) {
        best = cand.slice(0, r.stepIndex + 1);
        bestF = r;
        break;
      }
    }
  }
  return { ...bestF, seed: null, replay: undefined };
}

async function fuzz(label: string, seqs: number, steps: number, parShare: number, seedOffset: number) {
  const t0 = performance.now();
  const found = new Map<string, Failure>();
  const counts = new Map<string, number>();
  let ran = 0;
  for (let i = 0; i < seqs; i++) {
    const seed = BASE_SEED + seedOffset + i;
    const f = await runSteps({ seed, n: steps, par: parShare });
    if (f) f.replay = `${seed}:${parShare}:${steps}`;
    ran++;
    if (PRINT && lastLog.length) console.log(`seed ${seed}\n${lastLog.join('\n')}`);
    if (!f) continue;
    if (!EXPLORE) throw new Error(report(f));
    const code = `${f.violations[0].code} @ ${typesOf(f.steps[f.stepIndex]).join('+')}`;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    const prev = found.get(code);
    if (!prev || f.stepIndex < prev.stepIndex) found.set(code, f);
  }
  const ms = performance.now() - t0;
  if (process.env.FUZZ_STATS) {
    console.log([...stats].sort().map(([k, x]) => `${k} ${x.ok}/${x.ok + x.no}`).join('  '));
    console.log([...why].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${k} ${n}`).join('  '));
  }
  console.log(`[ledger-fuzz] ${label}: ${ran} sequences x ${steps} steps in ${(ms / 1000).toFixed(1)} s${knownSeen.size ? `; known bugs seen: ${JSON.stringify(Object.fromEntries(knownSeen))}` : ''}`);
  if (EXPLORE && found.size) {
    for (const [code, f] of found) {
      const s = await shrink(f);
      console.log(`\n===== ${code} (${counts.get(code)} sequences) =====\n${report(s)}`);
    }
    throw new Error(`explore: ${[...found.keys()].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await buildTemplate();
}, 60_000);
afterAll(() => {
  if (tplDir) rmSync(tplDir, { recursive: true, force: true });
});

describe('ledger fuzz: random sequences, invariants after every step', () => {
  it(`${SEQS} sequences of ${STEPS} steps (some with two taps at once)`, async () => {
    await fuzz('mixed', SEQS, STEPS, 0.1, 0);
  }, 600_000);

  it(`${PAR_SEQS} sequences of ${PAR_STEPS} steps, mostly two taps at once`, async () => {
    await fuzz('concurrent', PAR_SEQS, PAR_STEPS, 0.6, 10_000_000);
  }, 600_000);

  it.runIf(!!process.env.FUZZ_REPLAY)('replay one sequence (FUZZ_REPLAY=seed:par:steps, or a JSON step list)', async () => {
    const spec = process.env.FUZZ_REPLAY!;
    const f = spec.trim().startsWith('[')
      ? await runSteps(JSON.parse(spec) as Action[], { stopOnKnown: true })
      : await runSteps({ seed: Number(spec.split(':')[0]), par: Number(spec.split(':')[1] ?? 0.1), n: Number(spec.split(':')[2] ?? STEPS) }, { stopOnKnown: true });
    console.log(lastLog.join('\n'));
    expect(f ? report(f) : null).toBeNull();
  });

  it('the replay helper itself: a plain story balances', async () => {
    const steps: Action[] = [
      { t: 'join', p: 'Alex', g: 0 },
      { t: 'mark', p: 'Alex', g: 0, paid: true },
      { t: 'drop', p: 'Alex', g: 0 },
      { t: 'join', p: 'Alex', g: 1 },
      { t: 'refreq', p: 'Blair', cents: 'all' },
    ];
    const f = await runSteps(steps, { stopOnKnown: true });
    expect(f ? report(f) : null).toBeNull();
  });
});

// Regression cases found by this fuzz (step lists from the shrinker). Each
// one is `it.fails` while the bug is there; when it is fixed, the case starts
// "failing" here (it passes), so flip it to `it` and drop its KNOWN entry.
describe('ledger fuzz: regression cases', () => {
  const expectClean = async (steps: Action[]) => {
    const f = await runSteps(steps, { stopOnKnown: true });
    expect(f ? report(f) : null).toBeNull();
  };

  // A. Alex's $14 credit pays for Tue Oct 27 at sign-up. Five play, so $11 each and $3 comes back as credit. Alex
  // then taps Undo under "Paid with credit" (a stale screen: the card is gone once the game is over, but the
  // server takes it): all $14 goes back to the pot while the $3 that came back from it stays. $3 created; the seat
  // owes $11 again. undoCreditUse (server/creditActions.ts) neither refuses a finalized game nor takes the
  // finalize credit back, as the organizer's Unmark does (undoCreditBack(['finalized']) in applyPayment).
  it('A. Undo of "Paid with credit" after Finalize creates the credit that came back from it', async () => {
    await expectClean([
      { t: 'tpl', rich: true },
      { t: 'join', p: 'Alex', g: 0 },
      { t: 'join', p: 'Frankie', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'join', p: 'Gale', g: 0 },
      { t: 'join', p: 'Casey', g: 0 },
      { t: 'finalize', g: 0, who: 'everyone' },
      { t: 'undocredit', p: 'Alex', g: 0 },
    ]);
  });

  // B. Gale's $7 credit goes on Tue Oct 27 at sign-up. Five play ($11 each), so she owes $4, sends it, and the
  // organizer marks her paid ($11: $7 credit + $4 cash). Reopen: repriceStatements (server/credit.ts) sees a
  // paid seat with credit on it paying less than $14 and makes it unpaid with no payment, without holding the $4
  // the way Finalize does for cash (holdCash / the 'cash' pair). Her screen now says $7 due; the $4 is gone.
  // Fixed Oct 31 (the cash part is held against the seat on Reopen). The money is right; the Players tab's Held
  // still leaves that held cash out (H, organizer screen, waits for the admin cleanup), so only H may show here.
  it('B. Reopen drops the cash part of a seat paid at the final price with some credit', async () => {
    const f = await runSteps([
      { t: 'tpl', rich: true },
      { t: 'join', p: 'Gale', g: 0 },
      { t: 'join', p: 'Frankie', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'join', p: 'Casey', g: 0 },
      { t: 'join', p: 'Blair', g: 0 },
      { t: 'finalize', g: 0, who: 'everyone' },
      { t: 'mark', p: 'Gale', g: 0, paid: true },
      { t: 'unfinalize', g: 0 },
    ], { stopOnKnown: true });
    expect(f ? f.violations.filter((x) => x.code !== 'I5.players-held').map((x) => x.code) : []).toEqual([]);
  });

  // C. Gale's $7 credit goes on Tue Oct 27 and she pays the other $7; the organizer marks her paid ($14). Five
  // play ($11), so $3 comes back as credit, and joining Thu Oct 29 spends it. The organizer's Unmark on Oct 27 is
  // refused ("Gale already used the credit from this game") - but the batch in applyPayment (server/admin.ts) still
  // runs returnSeatCreditStatements (server/credit.ts), whose first statement shrinks a still-paid seat's payment
  // by the credit on it: the payment drops from $14 to $7 while the $7 credit stays used. $7 vanishes from the
  // Money tab (Collected), nothing tells the organizer, and a second tap on Unmark would make the seat unpaid.
  it('C. A refused Unmark (credit from the game already spent) still shrinks the payment', async () => {
    await expectClean([
      { t: 'tpl', rich: true },
      { t: 'join', p: 'Gale', g: 0 },
      { t: 'mark', p: 'Gale', g: 0, paid: true },
      { t: 'join', p: 'Frankie', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'join', p: 'Casey', g: 0 },
      { t: 'join', p: 'Blair', g: 0 },
      { t: 'finalize', g: 0, who: 'everyone' },
      { t: 'join', p: 'Gale', g: 1 },
      { t: 'mark', p: 'Gale', g: 0, paid: false },
    ]);
  });

  // D. Five play Tue Oct 27, so Harper's screen says $11 due. She sends $11 and taps "I paid" at the moment the
  // organizer taps Reopen: the payment is recorded at the price the server sees then ($14), so she shows paid in
  // full and a redo of Finalize at 5 gives her $3 credit she never paid. "I paid" and Mark paid carry no amount
  // (applyPayment in server/admin.ts records sharesFor() at that moment), unlike Use it / Mark refunded, which
  // send the amount shown and are refused when it changed. Same with a stale screen and no race at all.
  it('D. "I paid" at the same moment as Reopen records $14 for an $11 payment', async () => {
    await expectClean([
      { t: 'join', p: 'Blair', g: 0 },
      { t: 'join', p: 'Devon', g: 0 },
      { t: 'join', p: 'Gale', g: 0 },
      { t: 'join', p: 'Casey', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'finalize', g: 0, who: 'everyone' },
      { t: 'par', a: { t: 'unfinalize', g: 0 }, b: { t: 'ipaid', p: 'Harper', g: 0, paid: true } },
    ]);
  });

  // H. (Display, low.) Five play Tue Oct 27 ($11); Blair is marked paid $11; Reopen; four play this time ($14):
  // Finalize holds her $11 against the seat (a 'cash' pair) and she owes $3; Reopen again. Money says $11 held
  // for that game (seatCredit cashCents, server/money.ts), the Players tab says $0 held: heldCents in
  // src/pages/admin/todo.ts adds only creditCents for an unpaid seat, not paidEarlierCents.
  it.fails('H. Players tab Held leaves out cash held against an unpaid seat in a reopened game', async () => {
    await expectClean([
      { t: 'join', p: 'Blair', g: 0 },
      { t: 'join', p: 'Devon', g: 0 },
      { t: 'join', p: 'Gale', g: 0 },
      { t: 'join', p: 'Casey', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'finalize', g: 0, who: 'everyone' },
      { t: 'mark', p: 'Blair', g: 0, paid: true },
      { t: 'unfinalize', g: 0 },
      { t: 'finalize', g: 0, who: 15 },
      { t: 'unfinalize', g: 0 },
    ]);
  });

  // E. (Settings change, outside the usual flow.) Blair's $5 credit goes on Tue Oct 27; she pays the other $9 and is
  // marked paid ($14). The organizer raises the price to $16; four play, so the final price is $16. applyFinalize
  // (server/finalize.ts) sees paid $14 < $16 and holds the WHOLE payment as cash (holdCashStatements with
  // cents = payment_amount_cents) although $5 of it is credit still used on the seat; repriceStatements then counts
  // $5 credit + $14 "cash" = $19 >= $16 and marks the seat paid $19. $5 created: the seat shows $3 more than the
  // price, which comes back as credit at the next redo. It should hold only the cash part ($9) and ask $2.
  it('E. Finalize after the price went up holds the credit part of a payment as cash too', async () => {
    await expectClean([
      { t: 'tpl', rich: true },
      { t: 'join', p: 'Blair', g: 0 },
      { t: 'mark', p: 'Blair', g: 0, paid: true },
      { t: 'join', p: 'Frankie', g: 0 },
      { t: 'join', p: 'Harper', g: 0 },
      { t: 'orgme', g: 0, in: true },
      { t: 'price', cents: 1600 },
      { t: 'finalize', g: 0, who: 'everyone' },
    ]);
  });

  // G. (Settings change, low.) Gale's $7 credit goes on Tue Oct 27 and she owes $7. The organizer lowers the
  // price to $6: the seat stays unpaid with $7 of credit on a $6 seat until Finalize. Her screen and Who paid say
  // $0 due, the court row counts the $6 price, Held counts the $7 credit, and Mark paid would record $6 with $7
  // credit inside it. Nothing reprices seats when the price setting changes (updateGroup in server/admin.ts).
  it.fails('G. Price lowered below the credit already on an unpaid seat leaves it unpaid with credit above its price', async () => {
    await expectClean([{ t: 'tpl', rich: true }, { t: 'join', p: 'Gale', g: 0 }, { t: 'price', cents: 600 }]);
  });
});
