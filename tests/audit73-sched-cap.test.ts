// Audit 73 (CAP 16): try to get a 17th (and 18th) player into The Cold Open through the real server code. Read-only audit test.
// Path: before Pay by, 15 spots are taken. Lock my spot checks only "spots < 16", and a Lock with no credit takes no spot (it makes a 'none'
// ticket that owes the price). I paid has no spot check before Pay by. Every whole-ticket I paid waiting counts as "locked in"
// (lockedInIds / lockedInCount), so 15 spots + 3 I paid waiting = 18 locked in, and the night is built from that count.
import { describe, expect, it } from 'vitest';
import { playerPhone, DAY } from './harness';
import { ALL, DATE, PAY_BY_MS, START_MS, adminTour, teams, world } from './zip58-world';

const spotsInDb = (ctx: any) => (ctx.app.db.raw.prepare("SELECT COUNT(*) AS c FROM tournament_tickets WHERE tournament_id = ? AND place = 'spot'").get(ctx.tid) as { c: number }).c;

async function lateBuyer(ctx: any, name: string) {
  const p = await playerPhone(ctx, name);
  const s = await p.call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 300, dates: [DATE] });
  expect(s.status, s.text).toBe(200);
  const lock = await p.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
  expect(lock.status, lock.text).toBe(200);
  const paid = await p.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 });
  expect(paid.status, paid.text).toBe(200);
  return { lock: lock.data, paid: paid.data };
}

describe('audit 73: the cap of 16 through the real server', () => {
  it('17 locked in (15 spots + 2 I paid waiting) before Pay by: the odd switch fires and the Americano night is built for 17', async () => {
    const ctx = await world(15);
    ctx.app.now = PAY_BY_MS - 2 * DAY; // back before Pay by (world() left the clock after it; nothing read in between)
    const a = await lateBuyer(ctx, ALL[15]);
    const b = await lateBuyer(ctx, ALL[16]);
    console.log('lock answers', JSON.stringify(a.lock), JSON.stringify(b.lock), 'paid', JSON.stringify(a.paid), JSON.stringify(b.paid));
    expect(spotsInDb(ctx)).toBe(15);
    const before = await adminTour(ctx);
    console.log('before Pay by: lockedIn', before.lockedIn, 'spots', before.spots, 'format', before.format);
    // Past Pay by: the style is decided from "locked in".
    ctx.app.now = PAY_BY_MS + 60_000;
    const after = await adminTour(ctx);
    console.log('after Pay by: lockedIn', after.lockedIn, 'format', after.format, 'oddSwitch', !!after.oddSwitch, 'rounds.lockedIn', after.rounds?.lockedIn, 'rounds players', after.rounds?.players?.length, 'plan', JSON.stringify(after.rounds?.plan));
    expect(after.lockedIn).toBe(17);
    expect(after.format).toBe('americano');
    expect(after.rounds.players.length).toBe(17);
    // The night itself (30 minutes before the start): still 17 in the rounds if the organizer has not answered the two I paid.
    ctx.app.now = START_MS - 10 * 60_000;
    const night = await adminTour(ctx);
    const ids = new Set<string>();
    for (const g of night.rounds.games) for (const id of [...g.a.ids, ...g.b.ids]) ids.add(id);
    console.log('night: players in games', ids.size, 'spots in db', spotsInDb(ctx));
    expect(ids.size).toBe(17);
    expect(spotsInDb(ctx)).toBe(15);
    const card = (await (await playerPhone(ctx, ALL[16])).call('GET', '/api/group')).data.tournament;
    const tk = card?.tickets ?? {};
    console.log('17th player card: size', tk.size, 'full', tk.full, 'locked names', tk.locked?.length, 'mine', JSON.stringify(tk.mine ?? tk.me ?? null), 'keys', Object.keys(tk).join(','));
  });

  it('18 locked in (15 spots + 3 I paid waiting): even, stays Locked doubles, and Draft teams crashes with a 500 (9 teams, seat CHECK 1..8)', async () => {
    const ctx = await world(15);
    ctx.app.now = PAY_BY_MS - 2 * DAY;
    for (const name of ALL.slice(15, 18)) await lateBuyer(ctx, name);
    ctx.app.now = PAY_BY_MS + 60_000;
    const t = await adminTour(ctx);
    console.log('18 case: lockedIn', t.lockedIn, 'format', t.format, 'canDraft', t.day?.canDraft, t.day?.why ?? '');
    expect(t.lockedIn).toBe(18);
    expect(t.format).toBe('doubles');
    const d = await teams(ctx, { action: 'draft' });
    console.log('draft', d.status, d.text);
    expect(d.status).toBe(500);
    expect(spotsInDb(ctx)).toBe(15);
  });

  it('the organizer answering the I paids never makes a 17th spot (the trigger and fillSpots hold)', async () => {
    const ctx = await world(15);
    ctx.app.now = PAY_BY_MS - 2 * DAY;
    for (const name of ALL.slice(15, 17)) await lateBuyer(ctx, name);
    for (const name of ALL.slice(15, 17)) {
      const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[name], action: 'confirm' });
      expect(r.status, r.text).toBe(200);
      console.log('confirm', name, JSON.stringify(r.data));
    }
    expect(spotsInDb(ctx)).toBe(16);
    const t = await adminTour(ctx);
    console.log('after confirms: lockedIn', t.lockedIn);
    expect(t.lockedIn).toBe(16);
    // A direct 17th spot write is refused by the database (migration 0026).
    expect(() => ctx.app.db.raw.prepare("UPDATE tournament_tickets SET place = 'spot' WHERE tournament_id = ? AND place = 'line'").run(ctx.tid)).toThrow(/tournament_full/);
  });
});
