// 🎾91.dry run (AUDIT, never merged): whole fake Cold Open nights on the real server code, start to finish, the way Alex runs them.
// Sign-ups with votes, lock-ins at $18 (Venmo I paid + confirm, credit, part credit, cash Mark paid), Pay by, the style rule, 1 court for 7,
// prizes from the suggestion, game day (draft, publish, court numbers), the start (or Start now), scoring from phones and from Alex's card,
// the Time check, bonus offers (accept all or decline all), breaks, playoffs, End / Reveal, the prize claim, money to the cent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { ORIGIN, PIN, playerPhone, setupGroup } from '../harness';
import { WARM_UP, nightPlan } from '../../shared/tournamentPlan';
import { suggestedBoxes } from '../../shared/tournamentMoney';

export const DATE = '2026-12-01';
const DATES = ['2026-11-24', DATE, '2026-12-08'];
export const PAY_BY_MS = Date.parse('2026-12-01T00:00:00.000Z'); // Mon Nov 30, 7:00 PM EST (the default: the night before)
export const START_MS = Date.parse('2026-12-02T00:30:00.000Z'); // Tue Dec 1, 7:30 PM EST
export const END_MS = START_MS + 150 * 60_000; // 10:00 PM
const OTHERS = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan'];
const MORE = OTHERS.slice(5);
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250, 340, 320, 300, 275];

export const clock = (ms: number) => {
  const d = new Date(ms - 5 * 3_600_000);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const minsLeft = (ms: number) => Math.round((END_MS - ms) / 60_000);

/** Seeded random (mulberry32): every run is the same run again. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PaceName = 'fast' | 'normal' | 'slow' | 'mixed';
/** Minutes a game to 11 takes on a court (score entry and walking included), for the n-th game started that night. */
export function paceModel(name: PaceName, seed: number) {
  const r = rng(seed);
  let started = 0;
  let overtimeAt = -1;
  return {
    /** Returns minutes for a game to 11 and whether it is the 12-10 overtime game. */
    next(court: number): { mins: number; overtime: boolean } {
      started++;
      if (name === 'fast') return { mins: 12 + r() * 1, overtime: false };
      if (name === 'normal') return { mins: 18 + r() * 2, overtime: false };
      if (name === 'slow') return { mins: 24 + r() * 2, overtime: false };
      // Mixed: Court 1 consistently faster (about 14), Court 2 slower (about 20), each game 10 to 25; the 5th game started is a 12-10 overtime.
      if (overtimeAt < 0 && started === 5) {
        overtimeAt = started;
        return { mins: 27, overtime: true };
      }
      const base = court === 1 ? 14 : 20;
      return { mins: Math.min(25, Math.max(10, base + (r() * 12 - 6))), overtime: false };
    },
  };
}

export type World = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string>; names: string[] };

export interface Setup {
  n: number;
  /** What Alex runs: 'vote' (the real Cold Open: Locked doubles by vote; an odd count switches to Americano at Pay by) or 'americano' (Alex
   *  switched it by hand before Pay by). */
  style: 'vote' | 'americano';
  courts: 1 | 2;
  log: string[];
  /** Stop right after the lock-ins (before Pay by). */
  stopAfterPay?: boolean;
}

const ok = (r: { status: number; text: string }, what: string) => expect(r.status, `${what}: ${r.text.slice(0, 300)}`).toBe(200);
export const dash = async (ctx: World) => {
  let r = await ctx.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    // The organizer's sign-in lasts 30 days; the dry run's clock jumps further: sign in again (as Alex would).
    ok(await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN }, { Origin: ORIGIN }), 'sign in again');
    r = await ctx.organizer.call('GET', '/api/admin/dashboard');
  }
  return r.data;
};
export const adminTour = async (ctx: World) => (await dash(ctx)).tournament;
const phone = (ctx: World, name: string) => (name === 'Alex' ? organizerPhone(ctx) : playerPhone(ctx, name));
async function organizerPhone(ctx: World) {
  const c = ctx.organizer;
  c.groupKey = ctx.groupKey;
  ok(await c.call('POST', '/api/me', { playerId: ctx.byName.Alex }), 'organizer picks Alex');
  return c;
}
export function potOf(ctx: World, name: string): number {
  return Number(
    (
      ctx.app.db.raw
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
}

export interface Before {
  formatAtClose: string;
  /** What players see about the style after Pay by (the date card's alert / banner). */
  playerSees: string;
  /** What Alex sees (his card: the style line, the Telegram-style note in history). */
  alexSees: string;
  courts: number;
  courtCents: number;
  ticketsCents: number;
  suggested: { doubles: { first: number; second: number }; americano: { first: number; second: number } };
  plan: { rounds: number; gameTo: number; minutesUsed: number; fits: boolean; style: string; breaks: number };
  serverPlan: unknown;
  paidCents: number;
}

/** Sign-ups to the moment the night may start (game day, 7:00 PM). */
export async function coldOpen(s: Setup): Promise<{ ctx: World; before: Before }> {
  const base = await setupGroup();
  ok(await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' }), 'organizer name');
  for (const [i, name] of MORE.entries()) ok(await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` }), `add ${name}`);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  ok(await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true }), 'tournaments on');
  ok(await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true }), 'adjust credit on');
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: DATES,
    ticketCents: 1800,
    creditCents: 1400,
    secondCreditCents: 700,
    visibility: 'all',
    format: s.style === 'vote' ? 'vote' : 'americano',
  });
  ok(created, 'create');
  const names = ['Alex', ...OTHERS.slice(0, s.n - 1)];
  const ctx: World = { ...base, byName, tid: created.data.id, names };
  // Sign-ups: most vote Locked doubles (the real Cold Open), a few Either / Americano.
  for (const [i, name] of names.entries()) {
    const vote = i % 5 === 3 ? 'americano' : i % 5 === 4 ? 'either' : 'locked';
    ok(await (await phone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE], formatVote: vote }), `signup ${name}`);
  }
  ctx.app.now = Date.parse('2026-11-20T17:00:00.000Z');
  ok(await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 }), 'pick the date');
  // Lock-ins: Venmo (I paid, Alex confirms), full credit, part credit + Venmo, cash (Alex marks paid). Alex plays free.
  let paidCents = 0;
  for (const [i, name] of names.entries()) {
    const p = await phone(ctx, name);
    if (name === 'Alex') {
      ok(await p.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 0 }), 'Alex locks in');
      continue;
    }
    const kind = i % 4;
    if (kind === 1 || kind === 2) {
      const give = kind === 1 ? 1800 : 500;
      ok(await ctx.organizer.call('POST', `/api/admin/players/${byName[name]}/credit-adjust`, { direction: 'add', cents: give, reason: 'Dry run credit', seen: potOf(ctx, name) }), `credit ${name}`);
    }
    const lock = await p.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1800 });
    ok(lock, `lock ${name}`);
    const due = lock.data.dueCents ?? 0;
    if (due > 0 && kind !== 3) {
      ok(await p.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: due }), `I paid ${name}`);
      ok(await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: byName[name], action: 'confirm' }), `confirm ${name}`);
    } else if (due > 0) {
      ok(await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: byName[name], action: 'mark_paid', cents: due }), `mark paid ${name}`);
    }
    paidCents += due;
    ctx.app.now += 60 * 60_000;
  }
  if (s.stopAfterPay) return { ctx, before: { paidCents } as unknown as Before };
  // Pay by passes (Mon Nov 30, 7:00 PM): the style rule runs on the first read.
  ctx.app.now = PAY_BY_MS + 5 * 60_000;
  let t = await adminTour(ctx);
  const card = (await (await phone(ctx, names[1])).call('GET', '/api/group')).data.tournament;
  const playerSees = JSON.stringify({ alert: card?.formatAlert ?? null, banner: card?.styleBanner ?? card?.banner ?? null, format: card?.format ?? null }).slice(0, 300);
  const alexSees = JSON.stringify({ format: t.format, oddSwitch: t.oddSwitch, switchBack: t.switchBack, styleDecided: t.styleDecided }).slice(0, 300);
  const formatAtClose = t.format;
  // Alex sets the plan: the headcount he expects, and (7 players) cancels the second court.
  ok(await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: s.n, courts: s.courts }), 'plan');
  t = await adminTour(ctx);
  // Prizes: the suggestion for both styles (Use these), saved.
  const left = t.money.ticketsCents - t.money.courtCents;
  const suggested = suggestedBoxes(left);
  ok(await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { name: t.name, dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: suggested.doubles.first, visibility: t.visibility, prizes: suggested }), 'prizes');
  t = await adminTour(ctx);
  // Game day: 9 AM, teams drafted and published (Locked doubles), the venue's court numbers.
  ctx.app.now = Date.parse('2026-12-01T14:00:00.000Z');
  t = await adminTour(ctx);
  if (t.format === 'doubles') {
    ok(await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'draft' }), 'draft');
    ok(await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'publish' }), 'publish');
  }
  ok(await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'courts', numbers: s.courts === 1 ? [4] : [4, 5] }), 'court numbers');
  t = await adminTour(ctx);
  const style = t.format === 'americano' ? 'americano' : 'doubles';
  const p = nightPlan(s.n, s.courts, 150, style);
  const v = style === 'americano' ? t.rounds : t.day;
  return {
    ctx,
    before: {
      formatAtClose,
      playerSees,
      alexSees,
      courts: t.courts,
      courtCents: t.money.courtCents,
      ticketsCents: t.money.ticketsCents,
      suggested,
      plan: { rounds: p.rounds, gameTo: p.gameTo, minutesUsed: p.minutesUsed, fits: p.fits, style: p.style, breaks: p.breaks },
      serverPlan: v?.plan ?? null,
      paidCents,
    },
  };
}

export const sc = (o: { a: { names?: string[]; players?: string[] } | null; b: { names?: string[]; players?: string[] } | null }) => ({
  a: o.a?.names ?? o.a?.players ?? [],
  b: o.b?.names ?? o.b?.players ?? [],
});
async function night(ctx: World) {
  const t = await adminTour(ctx);
  const v = t.format === 'americano' ? t.rounds : t.day;
  return { t, v, games: (v?.games ?? []) as any[], courts: (v?.courtsNow ?? []) as { court: number; num: number | null; last: number | null }[] };
}
const call = async (ctx: World, body: Record<string, unknown>) => {
  await dash(ctx);
  return ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
};

export interface Run {
  offers: { kind: string; at: number; afterRound: number; plannedLeft: number; accepted: boolean }[];
  timeChecks: { at: number; fromRound: number; to: number }[];
  breaks: { at: number; mins: number }[];
  finish: number;
  roundsPlayed: number;
  games: Map<string, number>;
  sits: Map<string, number>;
  sitStreak: number;
  idle: string[];
  idleCourtMin: number;
  overlap: string[];
  overtime: string;
  byAlex: number;
  byPhone: number;
  stuck?: string;
  end: { status: number; text: string } | null;
  claim: string;
  money: string;
}

/** The whole night. `accept`: Alex taps Add a round on every offer (else he never does). `startNow`: the minute Alex taps Start now (else 7:30). */
export async function playNight(ctx: World, pace: PaceName, seed: number, accept: boolean, startNow?: number): Promise<Run> {
  const model = paceModel(pace, seed);
  const r = rng(seed * 31 + 7);
  const run: Run = { offers: [], timeChecks: [], breaks: [], finish: START_MS, roundsPlayed: 0, games: new Map(), sits: new Map(), sitStreak: 0, idle: [], idleCourtMin: 0, overlap: [], overtime: '', byAlex: 0, byPhone: 0, end: null, claim: '', money: '' };
  if (startNow !== undefined) {
    ctx.app.now = startNow;
    const t = await adminTour(ctx);
    expect(t.startNow, 'Start now shows').toBe(true);
    ok(await call(ctx, { action: 'start' }), 'Start now');
  } else ctx.app.now = START_MS;
  const realStart = ctx.app.now;
  const ends = new Map<number, number>();
  const otGame = new Set<number>();
  const seen = new Set<string>();
  let scored = 0;
  let lastNow = ctx.app.now;
  let busyLast: number[] = [];
  for (let step = 0; step < 600; step++) {
    const { t, v, games, courts } = await night(ctx);
    // Idle court time (one court free while the other plays, not on a break): measured between steps.
    if (v.breakNow == null && busyLast.length === 1 && courts.length === 2) run.idleCourtMin += (ctx.app.now - lastNow) / 60_000;
    lastNow = ctx.app.now;
    if (v.timeCheck) {
      run.timeChecks.push({ at: ctx.app.now, fromRound: v.timeCheck.fromRound, to: v.timeCheck.to });
      if (process.env.DRYRUN_DEBUG) console.log('[tc]', clock(ctx.app.now), JSON.stringify(v.timeCheck), 'courts', JSON.stringify(courts), 'done', games.filter((g) => g.status === 'done' || g.winner).map((g) => g.num).join(','));
      ok(await call(ctx, { action: 'apply', fromRound: v.timeCheck.fromRound, to: v.timeCheck.to }), 'apply time check');
      continue;
    }
    if (v.bonus && !seen.has(v.bonus.key)) {
      seen.add(v.bonus.key);
      const isAm = t.format === 'americano';
      const plannedLeft = isAm
        ? new Set(games.filter((g) => g.round <= v.plannedRounds && g.status !== 'done' && g.status !== 'skipped').map((g) => g.round)).size
        : new Set(games.filter((g) => g.stage === 'pool' && !g.winner && !g.skipped).map((g) => g.round)).size;
      const doneRounds = isAm
        ? [...new Set(games.map((g) => g.round))].filter((x) => games.filter((g) => g.round === x).every((g) => g.status === 'done' || g.status === 'skipped')).length
        : [...new Set(games.filter((g) => g.stage === 'pool').map((g) => g.round))].filter((x) => games.filter((g) => g.round === x).every((g) => g.winner || g.skipped)).length;
      run.offers.push({ kind: v.bonus.kind, at: ctx.app.now, afterRound: doneRounds, plannedLeft, accepted: accept });
      if (accept) {
        ok(await call(ctx, { action: 'bonus', key: v.bonus.key }), 'add a round');
        continue;
      }
    }
    if (t.end && courts.every((c) => c.num === null)) break;
    const tie = (v.ties ?? []).find((x: any) => (x.mode === 'wheel' && !x.bye) || (x.mode === 'pick' && x.needPicks > 0));
    if (tie) {
      const body = tie.mode === 'wheel' ? { action: 'spin', key: tie.key } : { action: 'pick', key: tie.key, seat: tie.teams.find((x: any) => !tie.picks.includes(x.seat)).seat, picks: tie.picks };
      ok(await call(ctx, body), 'tie');
      continue;
    }
    const live = courts.filter((c) => c.num !== null).map((c) => ({ court: c.court, g: games.find((x) => x.num === c.num) }));
    busyLast = live.map((l) => l.court);
    // Nobody on two courts at once.
    const onNow = live.flatMap(({ g }) => [...sc(g).a, ...sc(g).b]);
    if (new Set(onNow).size !== onNow.length) run.overlap.push(`${clock(ctx.app.now)}: ${onNow.join(',')}`);
    // A court free (no break) while a regular-round game whose four players are all free and due next could start.
    if (!v.breakNow && live.length < courts.length) {
      const busy = new Set(onNow);
      const open = games.filter((g) => {
        const done = g.status === 'done' || g.status === 'skipped' || g.winner || g.skipped;
        return !done && !live.some((l) => l.g.num === g.num) && (g.stage === undefined || g.stage === 'pool') && sc(g).a.length && sc(g).b.length;
      });
      for (const g of open) {
        const ps = [...sc(g).a, ...sc(g).b];
        if (ps.some((x) => busy.has(x))) continue;
        // Each player's earlier games done (it is their next game).
        const earlier = games.some((h) => h.num !== g.num && h.round < g.round && !(h.status === 'done' || h.status === 'skipped' || h.winner || h.skipped) && [...sc(h).a, ...sc(h).b].some((x) => ps.includes(x)));
        if (!earlier) {
          run.idle.push(`${clock(ctx.app.now)} RD${g.round} #${g.num} could start (${live.length}/${courts.length} courts busy)`);
          break;
        }
      }
    }
    if (v.breakNow && !live.length) {
      const until = Date.parse(v.breakNow.until);
      run.breaks.push({ at: ctx.app.now, mins: Math.round((until - ctx.app.now) / 60_000) });
      expect(v.bonus ?? undefined, 'no offer during a break').toBeUndefined();
      ctx.app.now = until + 1000;
      continue;
    }
    if (!live.length) {
      if (t.format === 'americano' && games.every((g) => g.status === 'done' || g.status === 'skipped')) break;
      run.stuck = `step ${step} ${clock(ctx.app.now)}: nothing on a court`;
      break;
    }
    for (const { court, g } of live) {
      if (ends.has(g.num)) continue;
      const to = g.playTo ?? 11;
      const m = model.next(court);
      if (m.overtime) otGame.add(g.num);
      const warm = g.round === 1 && ctx.app.now - realStart < 5 * 60_000 ? WARM_UP : 0;
      ends.set(g.num, ctx.app.now + Math.round(((m.mins * to) / 11 + warm) * 60_000));
    }
    const next = Math.min(...live.map(({ g }) => ends.get(g.num)!));
    ctx.app.now = Math.max(ctx.app.now, next);
    for (const { g } of live) {
      if (ends.get(g.num)! > ctx.app.now) continue;
      const to = g.playTo ?? 11;
      const winA = r() < 0.55;
      let w = to;
      let l = Math.min(to - 2, 3 + Math.floor(r() * (to - 4)));
      if (otGame.has(g.num)) {
        w = 12;
        l = 10;
        run.overtime = `#${g.num} ${g.stage && g.stage !== 'pool' ? g.stage : `RD${g.round}`} 12-10 (${clock(ctx.app.now)})`;
      }
      scored++;
      let res;
      if (scored % 4 === 0) {
        // Alex enters it from his night card.
        res = await call(ctx, t.format === 'americano' ? { action: 'score', num: g.num, a: winA ? w : l, b: winA ? l : w, seen: g.stamp } : { action: 'result', num: g.num, a: winA ? w : l, b: winA ? l : w });
        run.byAlex++;
      } else {
        const who = sc(g).a[Math.floor(r() * 2)] ?? sc(g).a[0];
        const ph = await phone(ctx, who);
        const mine = (await ph.call('GET', '/api/group')).data.tournament;
        const key = mine?.day?.rounds?.find((x: any) => x.num === g.num)?.key;
        res = await ph.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g.num, action: 'score', mine: winA ? w : l, theirs: winA ? l : w, ...(key ? { key } : {}) });
        run.byPhone++;
      }
      ok(res, `score #${g.num}`);
      run.finish = Math.max(run.finish, ctx.app.now);
    }
  }
  const { t, games } = await night(ctx);
  const isAm = t.format === 'americano';
  const regular = games.filter((g) => (isAm ? true : g.stage === 'pool'));
  const doneG = (g: any) => g.status === 'done' || (!!g.winner && !g.skipped);
  const playedRounds = new Set(regular.filter(doneG).map((g) => g.round));
  run.roundsPlayed = new Set(games.filter(doneG).map((g) => g.round)).size;
  for (const n of ctx.names) {
    run.games.set(n, 0);
    run.sits.set(n, 0);
  }
  for (const g of games.filter(doneG)) for (const n of [...sc(g).a, ...sc(g).b]) run.games.set(n, (run.games.get(n) ?? 0) + 1);
  const streak = new Map<string, number>();
  for (const rd of [...playedRounds].sort((a, b) => a - b)) {
    const inRd = new Set(regular.filter((g) => g.round === rd && doneG(g)).flatMap((g) => [...sc(g).a, ...sc(g).b]));
    for (const n of ctx.names) {
      if (!inRd.has(n)) {
        run.sits.set(n, (run.sits.get(n) ?? 0) + 1);
        streak.set(n, (streak.get(n) ?? 0) + 1);
        run.sitStreak = Math.max(run.sitStreak, streak.get(n)!);
      } else streak.set(n, 0);
    }
  }
  // End / Reveal, then the winners claim their prize cards (Nice).
  const tt = await adminTour(ctx);
  if (tt.end) {
    const e = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/awards`, { action: 'end', seen: tt.end.seen });
    run.end = { status: e.status, text: e.text.slice(0, 200) };
    ctx.app.now += 60 * 60_000;
    const claims: string[] = [];
    for (const n of ctx.names) {
      const before = potOf(ctx, n);
      const g = (await (await phone(ctx, n)).call('GET', '/api/group')).data;
      const c = g.tourAwards?.congrats;
      if (!c) continue;
      const seenRes = await (await phone(ctx, n)).call('POST', '/api/tournament/award-seen', { tournamentId: ctx.tid });
      claims.push(`${n}:${c.award}${c.creditCents ? ` $${c.creditCents / 100}` : ''}${c.medal ? ' medal' : ''}${seenRes.status === 200 && potOf(ctx, n) === before ? '' : ' MONEY-MOVED-ON-NICE'}`);
    }
    run.claim = claims.join(' ');
  } else run.end = null;
  run.money = moneyCheck(ctx);
  return run;
}

const THREE = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);
/** All three integrity files (every column but info_ must be 0), plus the night's own books: tickets in, courts, prizes out. */
export function moneyCheck(ctx: World): string {
  const bad: string[] = [];
  for (const [file, sql] of THREE) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_') && Number(v) !== 0) bad.push(`${file}:${k}=${v}`);
  }
  const tk = ctx.app.db.raw.prepare('SELECT COALESCE(SUM(credit_cents + paid_cents), 0) AS c, COUNT(*) AS n FROM tournament_tickets WHERE tournament_id = ? AND price_cents > 0').get(ctx.tid) as { c: number; n: number };
  const expect = (ctx.names.length - 1) * 1800;
  if (Number(tk.c) !== expect) bad.push(`tickets ${tk.c} != ${expect}`);
  return bad.length ? `FAIL ${bad.join(' ')}` : `0 (tickets $${Number(tk.c) / 100})`;
}

export const span = (m: Map<string, number>) => {
  const v = [...m.values()];
  return v.length ? `${Math.min(...v)}-${Math.max(...v)}` : '-';
};
export const fmtLeft = minsLeft;
