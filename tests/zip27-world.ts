// Zip 27 (Audit A money fixes): one fake world of finished games of every length, a finalized past month (October 2026) and a current one
// (November 2026), with cash, credit, a late cancel with the fee kept, a late drop, a no-show and an open game ahead. It only uses API calls
// that main has too, so the SAME script builds the SAME world on main and on this branch, and `moneyDump` reads every money number the
// organizer and the players see. tests/zip27-before-after.test.ts compares the branch's dump with the one made on main
// (tests/fixtures/zip27-main-dump.json): every finalized game and every past month must read exactly the same.
import { expect } from 'vitest';
import { DAY, HOUR, playerPhone, setupGroup } from './harness';

export type World = Awaited<ReturnType<typeof setupGroup>> & { phones: Record<string, Awaited<ReturnType<typeof playerPhone>>> };

/** Six from setupGroup (Alex is the organizer and plays) plus six more: twelve names, enough for 10 in. */
export const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Lee'];
export const ALL = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];

/** The live switches (Settings rows ON for everyone on Sun Nov 8, per scripts/preview-world-small.ts), plus Booking hours when asked. */
export const LIVE_SWITCHES = ['short-games-switch', 'late-fees', 'late-fee-split', 'money-rework', 'admin-v2', 'admin-r2', 'admin-r3', 'players-redo-switch'];

const ok = (res: { status: number; text: string }, what: string) => expect(res.status, `${what}: ${res.text}`).toBe(200);

export async function buildWorld(opts: { bookingHours: boolean; extraSwitches?: string[] }): Promise<World> {
  const ctx = (await setupGroup()) as World;
  ctx.app.now = Date.parse('2026-10-05T16:00:00.000Z'); // Mon Oct 5, 12:00 PM Eastern
  for (const name of MORE) ok(await ctx.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${MORE.indexOf(name)}0` }), `add ${name}`);
  ok(await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' }), 'organizer name');
  for (const sw of [...LIVE_SWITCHES, ...(opts.bookingHours ? ['booking-hours-switch'] : []), ...(opts.extraSwitches ?? [])]) ok(await ctx.organizer.call('PUT', `/api/admin/${sw}`, { on: true }), sw);
  const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  ctx.byName = Object.fromEntries(dash.players.map((p: { name: string; id: string }) => [p.name, p.id]));
  ctx.phones = {};
  for (const n of ALL) if (n !== 'Alex') ctx.phones[n] = await playerPhone(ctx, n);

  // October (the finalized past month). Every game is an extra game at 6:00 PM Eastern (22:00 UTC in October, 23:00 UTC in November).
  await play(ctx, { day: '2026-10-07', utc: '22:00', minutes: 90, inn: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], pay: ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'] });
  await play(ctx, { day: '2026-10-08', utc: '22:00', minutes: 120, inn: ['Blair', 'Casey', 'Gale', 'Harper', 'Indy'], pay: ['Gale', 'Harper', 'Indy'] });
  await play(ctx, { day: '2026-10-09', utc: '22:00', minutes: 150, inn: ['Alex', 'Blair', 'Devon', 'Gale', 'Jules', 'Kit', 'Lee'], pay: ['Devon', 'Gale', 'Jules', 'Kit', 'Lee'] });
  await play(ctx, { day: '2026-10-10', utc: '22:00', minutes: 180, inn: ['Casey', 'Emery', 'Harper', 'Indy'], pay: ['Casey', 'Emery', 'Harper', 'Indy'], played: ['Casey', 'Emery', 'Harper'] });
  await play(ctx, { day: '2026-10-12', utc: '22:00', minutes: 120, inn: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper'], pay: ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper'] });
  // A late cancel with the fee kept (6 in: the fee split prices it like a played game).
  await play(ctx, { day: '2026-10-14', utc: '22:00', minutes: 90, inn: ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Jules'], pay: ['Blair', 'Casey', 'Devon'], cancelLate: true });
  // A late drop that leaves the game short (4 in, Kit drops 3 hours before: 3 left), then finalized with the 3.
  await play(ctx, { day: '2026-10-15', utc: '22:00', minutes: 120, inn: ['Gale', 'Indy', 'Jules', 'Kit'], pay: ['Gale', 'Kit'], lateDrop: 'Kit' });
  await play(ctx, { day: '2026-10-17', utc: '22:00', minutes: 150, inn: ['Alex', 'Lee', 'Kit', 'Indy', 'Harper'], pay: ['Lee', 'Kit', 'Indy', 'Harper'] });
  // November (the current month when the dump is read on Mon Nov 9).
  await play(ctx, { day: '2026-11-02', utc: '23:00', minutes: 120, inn: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'], pay: ['Blair', 'Casey', 'Devon', 'Emery'] });
  await play(ctx, { day: '2026-11-04', utc: '23:00', minutes: 90, inn: ['Blair', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'], pay: ['Blair', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'] });
  await play(ctx, { day: '2026-11-06', utc: '23:00', minutes: 180, inn: ['Alex', 'Casey', 'Devon', 'Emery', 'Lee'], pay: ['Casey', 'Devon', 'Emery', 'Lee'] });
  // Ahead: Wed Nov 11, 2 hours, 4 in, two paid (credit used where they have it). Not finalized, so Projected counts it.
  ctx.app.now = Date.parse('2026-11-08T17:00:00.000Z');
  const ahead = await addGame(ctx, '2026-11-11', '23:00', 120);
  for (const n of ['Blair', 'Casey', 'Gale', 'Lee']) ok(await ctx.phones[n].call('POST', `/api/sessions/${ahead}/join`, {}), `join ${n}`);
  for (const n of ['Blair', 'Gale']) await markPaid(ctx, ahead, n);
  ctx.app.now = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern: the dump's moment
  return ctx;
}

async function addGame(ctx: World, day: string, utc: string, minutes: number): Promise<string> {
  const startsAt = `${day}T${utc}:00.000Z`;
  const endsAt = new Date(Date.parse(startsAt) + minutes * 60_000).toISOString();
  const res = await ctx.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt, note: null });
  ok(res, `add game ${day}`);
  return res.data.id as string;
}

/** Mark a seat paid for what it owes right now (the server's own number). Nothing when it owes nothing. */
async function markPaid(ctx: World, id: string, name: string) {
  const s = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: { id: string }) => x.id === id);
  const r = s.roster.find((x: { name: string }) => x.name === name);
  if (r.paymentStatus === 'paid') return;
  ok(await ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName[name], paid: true }), `pay ${name}`);
}

async function play(
  ctx: World,
  g: { day: string; utc: string; minutes: number; inn: string[]; pay: string[]; played?: string[]; cancelLate?: boolean; lateDrop?: string },
) {
  const start = Date.parse(`${g.day}T${g.utc}:00.000Z`);
  ctx.app.now = start - 2 * DAY;
  const id = await addGame(ctx, g.day, g.utc, g.minutes);
  for (const n of g.inn) {
    if (n === 'Alex') ok(await ctx.organizer.call('POST', `/api/admin/sessions/${id}/me`, { in: true }), 'Alex in');
    else ok(await ctx.phones[n].call('POST', `/api/sessions/${id}/join`, {}), `join ${n}`);
  }
  for (const n of g.pay) await markPaid(ctx, id, n);
  if (g.cancelLate) {
    ctx.app.now = start - 3 * HOUR;
    ok(await ctx.organizer.call('POST', `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }), 'cancel late');
    return id;
  }
  if (g.lateDrop) {
    ctx.app.now = start - 3 * HOUR;
    ok(await ctx.phones[g.lateDrop].call('POST', `/api/sessions/${id}/withdraw`, {}), `late drop ${g.lateDrop}`);
  }
  ctx.app.now = start + g.minutes * 60_000 + 30 * 60_000;
  const body = g.played ? { played: g.played.map((n) => ctx.byName[n]) } : { everyone: true };
  ok(await ctx.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, body), `finalize ${g.day}`);
  return id;
}

/** Every money number the organizer and the players see, keyed by game start and player name (never a random id), sorted. */
export async function moneyDump(ctx: World): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    const m = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    out[`money ${month}`] = { ...m, sessions: m.sessions.map((s: Record<string, unknown>) => ({ ...s, id: undefined })) };
  }
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const nameOf = new Map(d.players.map((p: { id: string; name: string }) => [p.id, p.name]));
  for (const s of [...d.sessions].sort((a: { startsAt: string }, b: { startsAt: string }) => a.startsAt.localeCompare(b.startsAt))) {
    out[`game ${s.startsAt}`] = {
      finalized: s.finalized ?? null,
      shortGame: s.shortGame ?? null,
      court: s.court ?? null,
      canceled: !!s.state?.flags?.canceled,
      roster: Object.fromEntries(
        [...s.roster]
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
          .map((r: Record<string, unknown>) => [
            r.name,
            { status: r.status, pay: r.paymentStatus, amount: r.paymentAmountCents, share: r.shareCents, owes: r.owesCents, credit: r.creditCents, earlier: r.paidEarlierCents, back: r.creditBackCents, fee: r.lateFee ?? null },
          ]),
      ),
    };
  }
  out.players = Object.fromEntries([...d.players].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)).map((p: Record<string, unknown>) => [p.name, { spent: p.spentCents ?? null, played: p.played }]));
  out.pots = Object.fromEntries(
    [...d.creditLedger].map((l: { playerId: string; balanceCents: number }) => [nameOf.get(l.playerId), l.balanceCents]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  for (const n of ALL) {
    const id = ctx.byName[n];
    const sum = await ctx.organizer.call('GET', `/api/admin/players/${id}/summary`);
    out[`summary ${n}`] = sum.status === 200 ? sum.data : sum.status;
    if (n === 'Alex') continue;
    const v = (await ctx.phones[n].call('GET', '/api/group')).data;
    out[`player ${n}`] = Object.fromEntries(
      [...v.sessions]
        .filter((s: { mine: unknown }) => s.mine)
        .sort((a: { startsAt: string }, b: { startsAt: string }) => a.startsAt.localeCompare(b.startsAt))
        .map((s: { startsAt: string; mine: Record<string, unknown>; finalized: unknown; shortGame?: unknown }) => [
          s.startsAt,
          { finalized: s.finalized, shortGame: s.shortGame ?? null, owe: s.mine.oweCents, share: s.mine.shareCents, credit: s.mine.creditCents, pay: s.mine.paymentStatus, fee: s.mine.lateFee ?? null },
        ]),
    );
  }
  return JSON.parse(JSON.stringify(out));
}

/**
 * The A-01 trap: everything that can re-price a game after it was finalized, all at once. Short games OFF, Booking hours OFF (when it was
 * on), "Price per player" $15 and "Typical court cost" $50 (Settings > Money).
 */
export async function flipPriceRules(ctx: World, opts: { bookingHours: boolean }) {
  ok(await ctx.organizer.call('PUT', '/api/admin/short-games-switch', { on: false }), 'short games off');
  if (opts.bookingHours) ok(await ctx.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false }), 'booking hours off');
  const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  ok(await ctx.organizer.call('PUT', '/api/admin/group', { settings: { ...d.group.settings, pricePerPlayerCents: 1500, typicalCourtCostCents: 5000 } }), 'settings money');
}

/** The part of a dump that must never move once a game is finalized: past months whole, this month's finalized games and "so far", finalized games' rows. */
export function settledPart(dump: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out['money 2026-10'] = dump['money 2026-10'];
  const nov = dump['money 2026-11'];
  const { projected: _p, ...soFar } = nov.rework ?? {};
  out['money 2026-11 finalized games'] = nov.sessions.filter((s: { state: string }) => s.state === 'played' || s.state === 'canceled');
  out['money 2026-11 so far'] = { collectedCents: nov.collectedCents, courtCostCents: nov.courtCostCents, creditsOwedCents: nov.creditsOwedCents, ...soFar };
  for (const [k, v] of Object.entries(dump)) {
    if (k.startsWith('game ') && ((v as { finalized: unknown }).finalized || (v as { canceled: boolean }).canceled)) out[k] = v;
    if (k.startsWith('player ')) out[k] = Object.fromEntries(Object.entries(v as Record<string, { finalized: unknown }>).filter(([, x]) => x.finalized));
  }
  return out;
}
