// Zip 27 deploy step (scripts/lock-finalized.ts): the one-time lock of games finalized before Zip 27 writes exactly the locks the site itself
// would write right before a price switch changes (lockFinalizedGames), only price_lock rows, and running it twice changes nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { lockSql, planLocks, wranglerVars } from '../scripts/lock-finalized';
import { getGroup, type SessionRow, UNLOCKED_GAMES_SQL } from '../server/repo';
import { buildWorld, moneyDump } from './zip27-world';

vi.setConfig({ testTimeout: 120_000 });

const TOML = readFileSync(join(process.cwd(), 'wrangler.toml'), 'utf8');

describe('scripts/lock-finalized.ts', () => {
  it('reads the kill switches of the right wrangler.toml section', () => {
    const live = wranglerVars(TOML, '[vars]');
    const preview = wranglerVars(TOML, '[env.preview.vars]');
    expect(live.SHORT_GAMES).toBe('on');
    expect(live.BOOKING_HOURS).toBe('on');
    expect(preview.SHORT_GAMES).toBe('on');
    expect(live.PREVIEW_CALM).toBeUndefined(); // preview-only values never leak into the live section
    expect(preview.PREVIEW_CALM).toBe('on');
  });

  for (const bookingHours of [false, true]) {
    it(`writes the same locks as the site, only price_lock rows, twice = once, and nothing anyone sees changes${bookingHours ? ' (Booking hours on)' : ''}`, async () => {
      const w = await buildWorld({ bookingHours });
      const raw = (w.app.db as any).raw;
      // As on live before Zip 27: games finalized without a lock.
      raw.prepare("DELETE FROM task_log WHERE task = 'price_lock'").run();
      const before = await moneyDump(w);
      const count = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;
      const others = count("SELECT COUNT(*) AS n FROM task_log WHERE task <> 'price_lock'");
      const ledger = count('SELECT COUNT(*) AS n FROM credit_ledger');
      const group = (await getGroup(w.app.db))!;
      const on = (task: string) => !!raw.prepare("SELECT 1 FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task = ?").get(task);
      const games = raw.prepare(UNLOCKED_GAMES_SQL).all(group.id) as SessionRow[];
      expect(games.length).toBeGreaterThan(10);
      const plan = planLocks(group, { shortGames: on('short_games_on'), bookingHours: on('booking_hours_on') }, wranglerVars(TOML, '[vars]'), games);
      for (const sql of lockSql(group.id, plan, '2026-11-11T15:00:00.000Z')) raw.exec(sql);
      const written = raw.prepare("SELECT session_id, detail FROM task_log WHERE task = 'price_lock' ORDER BY session_id").all();
      expect(written).toHaveLength(games.length);
      expect(raw.prepare(UNLOCKED_GAMES_SQL).all(group.id)).toHaveLength(0);
      // Twice = once.
      for (const sql of lockSql(group.id, plan, '2026-11-11T15:05:00.000Z')) raw.exec(sql);
      expect(count("SELECT COUNT(*) AS n FROM task_log WHERE task = 'price_lock'")).toBe(games.length);
      expect(count("SELECT COUNT(*) AS n FROM task_log WHERE task <> 'price_lock'")).toBe(others);
      expect(count('SELECT COUNT(*) AS n FROM credit_ledger')).toBe(ledger);
      // Every number is the same after the lock (the read-only check of the deploy, here on the fake world).
      expect(await moneyDump(w)).toEqual(before);
      // And the site's own lock (right before a switch flip) would have written exactly the same.
      raw.prepare("DELETE FROM task_log WHERE task = 'price_lock'").run();
      await w.organizer.call('PUT', '/api/admin/short-games-switch', { on: true });
      expect(raw.prepare("SELECT session_id, detail FROM task_log WHERE task = 'price_lock' ORDER BY session_id").all()).toEqual(written);
    });
  }
});
