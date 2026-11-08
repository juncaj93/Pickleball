// The small preview world (Alex, Nov 8): only the fixed names, every scenario still there, the switch rows like live plus the zip being built.
import { describe, expect, it } from 'vitest';
import { buildSmallPreview, SMALL_NAMES, smallSwitchRows } from '../scripts/preview-world-small';
import { createNodeD1 } from '../dev/nodeD1';

const TIMES = ['2026-11-08T23:30:00.000Z', '2026-11-10T14:00:00.000Z', '2026-11-12T03:00:00.000Z', '2026-11-14T17:00:00.000Z'];

describe('the small preview world (npm run db:seed:preview)', () => {
  for (const iso of TIMES) {
    it(`builds at ${iso}: exactly the 10 fixed names; Vic, Wren and Zoe owe for 1, 2 and 3 past games`, async () => {
      const now = Date.parse(iso);
      const { sql, summary } = await buildSmallPreview(now);
      const db = createNodeD1(':memory:');
      db.raw.exec(sql);
      const names = (db.raw.prepare('SELECT display_name AS n FROM players ORDER BY n').all() as { n: string }[]).map((r) => r.n);
      expect(names).toEqual([...SMALL_NAMES].sort());
      expect(sql).toContain("'preview-unpaid_nudge_on'");
      expect(summary.join('\n')).toMatch(/Vic owes \$14 for 1 past game, Wren \$28 for 2, Zoe \$42 for 3/);
      // Past games each one is in, unpaid (nothing else in the world gives these three a past debt).
      for (const [name, count] of [['Vic', 1], ['Wren', 2], ['Zoe', 3]] as const) {
        const id = (db.raw.prepare('SELECT id FROM players WHERE display_name = ?').get(name) as { id: string }).id;
        const owed = db.raw
          .prepare(
            `SELECT COUNT(*) AS n FROM session_players sp JOIN sessions s ON s.id = sp.session_id
             WHERE sp.player_id = ? AND sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.status <> 'canceled' AND s.ends_at <= ?`,
          )
          .get(id, new Date(now).toISOString()) as { n: number };
        expect(owed.n, name).toBe(count);
      }
    }, 120_000);
  }
  it('switch rows: live rows plus Unpaid nudge; never a row twice', () => {
    const rows = smallSwitchRows(Date.parse(TIMES[0])).trim().split('\n');
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.some((r) => r.includes("'unpaid_nudge_on'"))).toBe(true);
  });
});
