// Behind-the-scenes audit (Sun Nov 1, 2026): the read-only consistency
// checks in scripts/integrity-checks.sql. A busy seeded copy (random taps by
// players and the organizer, money moving every way) must read all zeros,
// and each check must catch the exact problem it names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY, HOUR, playerPhone, setupGroup } from './harness';

const SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

function run(raw: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(raw.prepare(SQL).get() as Record<string, number>)) out[k] = Number(n);
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function busyCopy(seed: number) {
  const ctx = await setupGroup();
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
  const phones = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await playerPhone(ctx, n)] as const)));
  for (let step = 0; step < 500; step++) {
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const games = dash.sessions.filter((s: any) => Date.parse(s.endsAt) > ctx.app.now - 2 * DAY).slice(0, 4);
    if (!games.length) break;
    const s = pick(games);
    const who = pick(names);
    const p = phones[who];
    const r = rand();
    if (r < 0.25) await p.call('POST', `/api/sessions/${s.id}/join`, {});
    else if (r < 0.37) await p.call('POST', `/api/sessions/${s.id}/withdraw`, {});
    else if (r < 0.45) await p.call('POST', `/api/sessions/${s.id}/paid`, { paid: true });
    else if (r < 0.52) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName[who], paid: rand() < 0.8 });
    else if (r < 0.57) await p.call('POST', `/api/sessions/${s.id}/use-credit`, {});
    else if (r < 0.6) await p.call('POST', `/api/sessions/${s.id}/undo-credit`, {});
    else if (r < 0.65) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/court-status`, { status: pick(['booked', 'not_booked', 'waitlist']) });
    else if (r < 0.68) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/decision`, { decision: rand() < 0.7 ? 'cancel' : 'reopen', confirm: true });
    else if (r < 0.73) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: rand() < 0.6, played: games.length ? [ctx.byName[who]] : [] });
    else if (r < 0.75) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/reopen`, {});
    else if (r < 0.79) await p.call('POST', '/api/me/refund-request', { cents: 1400 });
    else if (r < 0.81) await p.call('POST', '/api/me/refund-request/cancel', {});
    else if (r < 0.84) {
      const req = dash.refundRequests?.[0];
      if (req) await ctx.organizer.call('POST', `/api/admin/refund-requests/${req.id}`, { action: pick(['refunded', 'not_now', 'undo']), cents: req.cents ?? req.amountCents });
    } else if (r < 0.88) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/roster`, { playerId: ctx.byName[who], action: pick(['confirm', 'waitlist', 'withdraw']) });
    else if (r < 0.9) await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/me`, { in: rand() < 0.5 });
    else ctx.app.advance(Math.floor(rand() * 10) * HOUR);
    await ctx.app.settle();
  }
  return ctx;
}

describe('consistency checks (scripts/integrity-checks.sql)', () => {
  it('a busy seeded copy reads all zeros, and money really moved', async () => {
    for (const seed of [3, 77]) {
      const ctx = await busyCopy(seed);
      const raw = ctx.app.db.raw;
      const problems = Object.entries(run(raw)).filter(([k, n]) => n !== 0 && !k.startsWith('info_'));
      expect(problems, `seed ${seed}`).toEqual([]);
      const moved = raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as any;
      const paid = raw.prepare("SELECT COUNT(*) AS n FROM session_players WHERE payment_status = 'paid'").get() as any;
      expect(moved.n + paid.n, `seed ${seed}: something to check`).toBeGreaterThan(5);
    }
  }, 120_000);

  it('each check catches the problem it names', async () => {
    const ctx = await setupGroup();
    const raw = ctx.app.db.raw;
    const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const [s1, s2] = dash.sessions;
    const blair = ctx.byName.Blair;
    const g = (raw.prepare('SELECT id FROM groups').get() as any).id;
    raw.exec('PRAGMA foreign_keys = OFF');
    const now = new Date(ctx.app.now).toISOString();
    let i = 0;
    const id = () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`;
    const seat = (session: string, player: string, extra = '') =>
      raw.prepare(`INSERT INTO session_players (id, session_id, player_id, status, claimed_at, updated_at${extra ? ', payment_status, payment_amount_cents, refunded_at' : ''}) VALUES (?, ?, ?, 'confirmed', ?, ?${extra})`).run(id(), session, player, now, now);
    const ledger = (player: string, kind: string, cents: number, session: string | null) =>
      raw.prepare('INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id(), g, player, kind, cents, session, now);
    const before = run(raw);
    expect(Object.entries(before).filter(([k, n]) => n !== 0 && !k.startsWith('info_'))).toEqual([]);
    const expectOnly = (name: string) => {
      const r = run(raw);
      expect(r[name], name).toBeGreaterThan(0);
      raw.exec('ROLLBACK TO t');
      raw.exec('RELEASE t');
    };
    const cases: [string, () => void][] = [
      ['seat_without_game', () => seat('11111111-1111-4111-8111-111111111111', blair)],
      ['seat_without_player', () => seat(s1.id, '22222222-2222-4222-8222-222222222222')],
      ['credit_row_without_player', () => ledger('33333333-3333-4333-8333-333333333333', 'kept', 100, null)],
      ['credit_row_without_game', () => ledger(blair, 'kept', 100, '44444444-4444-4444-8444-444444444444')],
      ['pot_below_zero', () => ledger(blair, 'used', 500, null)],
      ['pending_cash_out_over_pot', () => raw.prepare("INSERT INTO refund_requests (id, group_id, player_id, amount_cents, status, created_at) VALUES (?, ?, ?, 1400, 'pending', ?)").run(id(), g, blair, now)],
      ['credit_used_on_canceled_game', () => {
        seat(s1.id, blair);
        ledger(blair, 'kept', 1400, null);
        ledger(blair, 'used', 1400, s1.id);
        raw.prepare("UPDATE sessions SET status = 'canceled' WHERE id = ?").run(s1.id);
      }],
      ['credit_used_on_left_seat', () => {
        ledger(blair, 'kept', 1400, null);
        ledger(blair, 'used', 1400, s1.id);
      }],
      ['credit_on_seat_over_14', () => {
        seat(s1.id, blair);
        ledger(blair, 'kept', 3000, null);
        ledger(blair, 'used', 1400, s1.id);
        ledger(blair, 'used', 1400, s1.id);
      }],
      ['paid_seat_without_amount', () => seat(s1.id, blair, ", 'paid', NULL, NULL")],
      ['cash_still_on_canceled_game', () => {
        seat(s2.id, ctx.byName.Casey, ", 'paid', 1400, NULL");
        raw.prepare("UPDATE sessions SET status = 'canceled' WHERE id = ?").run(s2.id);
      }],
      ['finalized_without_price', () => raw.prepare('UPDATE sessions SET finalized_at = ? WHERE id = ?').run(now, s1.id)],
      ['game_ends_before_start', () => raw.prepare('UPDATE sessions SET ends_at = starts_at WHERE id = ?').run(s1.id)],
      ['alert_log_without_game', () => raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, '55555555-5555-4555-8555-555555555555', 'night', 'failed', ?)").run(id(), g, now)],
    ];
    for (const [name, make] of cases) {
      raw.exec('SAVEPOINT t');
      make();
      expectOnly(name);
    }
    raw.exec('PRAGMA foreign_keys = ON');
  });
});
