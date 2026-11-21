import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstSession, HOUR, playerPhone, setupGroup } from './harness';
import { world } from './zip58-world';

// Zip 80 (🎾80.leftovers, the 🎾75 audit's LATER item): none of the three integrity files could see credit given back twice on the same seat
// (pots stay above $0, so every column read 0). Now: credit_back_twice (scripts/integrity-checks.sql), tour_credit_back_twice
// (scripts/integrity-checks-tournament.sql), and the extra time file's ext_credit_not_ledger already catches it on a share (proved here).
// Real flows read 0; a seeded double reads 1 and nothing else moves.

const read = (f: string) => readFileSync(join(process.cwd(), 'scripts', f), 'utf8');
const SQL = read('integrity-checks.sql');
const TOUR = read('integrity-checks-tournament.sql');
const EXT = read('integrity-checks-extension.sql');
const run = (raw: any, sql: string) => Object.fromEntries(Object.entries(raw.prepare(sql).get() as Record<string, number>).map(([k, v]) => [k, Number(v)]));
const problems = (raw: any, sql: string) => Object.entries(run(raw, sql)).filter(([k, n]) => n !== 0 && !k.startsWith('info_'));

describe('zip 80: credit given back twice on the same seat (scripts/integrity-checks.sql credit_back_twice)', () => {
  it('real flows read 0: pay, drop, rejoin with credit, drop; pay cash again after spending it, drop again; a cancel', async () => {
    const ctx = await setupGroup();
    const raw = ctx.app.db.raw;
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    const pay = (id: string) => ctx.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await pay(s.id)).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect(problems(raw, SQL)).toEqual([]);
    // Rejoin: the $14 credit pays (no cash); drop again: the credit goes back to the pot. Still one money-back row.
    ctx.app.advance(HOUR);
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    expect(problems(raw, SQL)).toEqual([]);
    // Spend the credit on another game, come back, pay cash again, drop again: a second, real money-back row on the same seat.
    const games = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions;
    const other = games.find((g: any) => g.id !== s.id);
    expect((await blair.call('POST', `/api/sessions/${other.id}/join`, {})).status).toBe(200);
    ctx.app.advance(HOUR);
    expect((await blair.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
    expect((await pay(s.id)).status).toBe(200);
    ctx.app.advance(HOUR);
    expect((await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {})).status).toBe(200);
    const backs = raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ? AND ended_at IS NULL").get(s.id, ctx.byName.Blair) as { n: number };
    expect(backs.n).toBe(2);
    expect(run(raw, SQL).credit_back_twice).toBe(0);
    // A cancel of the other game (credit on it goes back) still reads 0.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${other.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    expect(problems(raw, SQL)).toEqual([]);
  });

  it('a seeded second money-back row after the one that settled the payment reads 1 (every other check stays 0)', async () => {
    const ctx = await setupGroup();
    const raw = ctx.app.db.raw;
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    await blair.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    const row = raw.prepare("SELECT * FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ?").get(s.id, ctx.byName.Blair) as any;
    expect(row).toMatchObject({ reason: 'dropped', amount_cents: 1400 });
    raw.prepare('INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'double-1', row.group_id, row.player_id, 'kept', 1400, s.id, new Date(ctx.app.now + 60_000).toISOString(), 'dropped');
    expect(problems(raw, SQL)).toEqual([['credit_back_twice', 1]]);
    // A second 'canceled' row the same way.
    raw.prepare("UPDATE credit_ledger SET reason = 'canceled' WHERE id = 'double-1'").run();
    expect(problems(raw, SQL)).toEqual([['credit_back_twice', 1]]);
  });

  it('a live payment: more back since it was paid than the payment itself reads 1', async () => {
    const ctx = await setupGroup();
    const raw = ctx.app.db.raw;
    const s = await firstSession(ctx);
    const blair = await playerPhone(ctx, 'Blair');
    await blair.call('POST', `/api/sessions/${s.id}/join`, {});
    await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
    const g = (raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    const later = new Date(ctx.app.now + 60_000).toISOString();
    const back = (id: string, cents: number) =>
      raw.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'kept', ?, ?, ?, 'finalized')").run(id, g, ctx.byName.Blair, cents, s.id, later);
    back('part-1', 500);
    expect(run(raw, SQL).credit_back_twice).toBe(0); // $5 of $14 back: fine
    back('part-2', 1000);
    expect(problems(raw, SQL)).toEqual([['credit_back_twice', 1]]); // $15 back from a $14 payment
    // The review: the same small part back twice ($4 and $4 of $14) is a double too: one live 'finalized' row per payment at most.
    raw.prepare("DELETE FROM credit_ledger WHERE id IN ('part-1', 'part-2')").run();
    back('fin-1', 400);
    expect(run(raw, SQL).credit_back_twice).toBe(0);
    back('fin-2', 400);
    expect(problems(raw, SQL)).toEqual([['credit_back_twice', 1]]);
  });
});

describe('zip 80: credit given back twice on a ticket (scripts/integrity-checks-tournament.sql tour_credit_back_twice)', () => {
  it('a real drop reads 0; a seeded money-back row while the ticket still holds its money reads 1', async () => {
    const ctx = await world(10);
    const raw = ctx.app.db.raw;
    expect(problems(raw, TOUR)).toEqual([]);
    const name = 'Casey';
    const k = raw.prepare('SELECT * FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as any;
    expect(k.paid_at).not.toBeNull();
    const g = (raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    raw.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) VALUES ('tour-double', ?, ?, 'kept', 1600, 0, NULL, ?, ?)").run(
      g, ctx.byName[name], new Date(ctx.app.now).toISOString(), `tour:${ctx.tid}:back`);
    expect(problems(raw, TOUR)).toEqual([['tour_credit_back_twice', 1]]);
    raw.prepare("DELETE FROM credit_ledger WHERE id = 'tour-double'").run();
    // A real drop (10 locked in on 2 courts, so the money comes back): the ticket empties in the same step; 0.
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
    expect(r.status, r.text).toBe(200);
    const after = raw.prepare('SELECT credit_cents, paid_cents, paid_at FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]);
    expect(after).toEqual({ credit_cents: 0, paid_cents: 0, paid_at: null });
    expect(problems(raw, TOUR)).toEqual([]);
  });
});

describe('zip 80: the extra time file already catches a share given back twice (ext_credit_not_ledger)', () => {
  it('a seeded second money-back row on a share reads 1', async () => {
    const ctx = await setupGroup();
    const raw = ctx.app.db.raw;
    const s = await firstSession(ctx);
    await (await playerPhone(ctx, 'Blair')).call('POST', `/api/sessions/${s.id}/join`, {});
    const g = (raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    const now = new Date(ctx.app.now).toISOString();
    // A $6 share: $10 of credit put on it, $4 given back as credit (a lower share): ext_credit_cents 6, the ledger 10 used - 4 kept.
    raw.prepare('UPDATE sessions SET extra_minutes = 30, extra_cost_cents = 1200 WHERE id = ?').run(s.id);
    raw.prepare('UPDATE session_players SET ext_cents = 600, ext_credit_cents = 600 WHERE session_id = ? AND player_id = ?').run(s.id, ctx.byName.Blair);
    raw.prepare("UPDATE sessions SET finalized_at = ?, final_price_cents = 1400, final_played_count = 1 WHERE id = ?").run(now, s.id);
    raw.prepare('UPDATE session_players SET played = 1 WHERE session_id = ? AND player_id = ?').run(s.id, ctx.byName.Blair);
    const ledger = (id: string, kind: string, cents: number) =>
      raw.prepare('INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(id, g, ctx.byName.Blair, kind, cents, now, `ext:${s.id}`);
    ledger('ext-used', 'used', 1000);
    ledger('ext-back', 'kept', 400);
    raw.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES ('pot', ?, ?, 'kept', 2000, NULL, ?, 'adjusted')").run(g, ctx.byName.Blair, now);
    expect(run(raw, EXT).ext_credit_not_ledger).toBe(0);
    ledger('ext-back-2', 'kept', 400);
    expect(run(raw, EXT).ext_credit_not_ledger).toBe(1);
  });
});
