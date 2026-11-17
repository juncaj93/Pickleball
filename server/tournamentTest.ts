import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { setTournamentsForAll, todayKey } from './tournament';
import { previewSiteFor } from './secondChance';
import { dayKey, dayParts, FORMATS, monthsBetween, monthStartPlus } from '../shared/tournament';

// Zip 55, PREVIEW ONLY: the "Tournament test" page's server half. POST /api/admin/tournament-test { stage } puts the fake tournament back to a
// stage, using only the preview's fixed fake names (docs/PREVIEW_FAKE_DB.md), and turns the Tournaments row on (a re-seed from another branch
// drops it). It answers Not found anywhere PREVIEW_CALM is not "on" (that var exists only in [env.preview.vars]; the live site has none, the
// same check the preview-only ?as=Name link uses), so on live this route does nothing at all. No new Cloudflare variable.
//   none         no tournament (to try Create from Settings > Schedule)
//   signup       "Winter Classic", Everyone, sign-up open, 6 on the list (Vic, Zoe, Reese and Alex are not)
//   date_picked  the same with 8 on the list, Sage's level set to 3.4, and the date most of them can make picked
// The page's own words and buttons live in src/pages/admin/TournamentTest.tsx, which only a preview build carries.

export const TEST_STAGES = ['none', 'signup', 'date_picked'] as const;

/** The fixed names and their picks (Kai is not one of the preview's names, so he is not here). Levels in hundredths. */
const CAST: { name: string; level: number; stage: 'signup' | 'date_picked'; every: number; offset: number }[] = [
  { name: 'Parker', level: 360, stage: 'signup', every: 2, offset: 0 },
  { name: 'Rowan', level: 350, stage: 'signup', every: 1, offset: 0 },
  { name: 'Sage', level: 300, stage: 'signup', every: 3, offset: 1 },
  { name: 'Christopher Vanderberg', level: 300, stage: 'signup', every: 2, offset: 1 },
  { name: 'Wren', level: 320, stage: 'signup', every: 3, offset: 2 },
  { name: 'Quinn', level: 250, stage: 'signup', every: 2, offset: 0 },
  { name: 'Zoe', level: 275, stage: 'date_picked', every: 3, offset: 0 },
  { name: 'Reese', level: 340, stage: 'date_picked', every: 2, offset: 1 },
];

/** Every Tuesday to Friday of next month and the first two weeks of the month after (no Christmas Eve, Christmas, New Year's Eve or Day). */
export function testDates(today: string): string[] {
  const from = monthStartPlus(today, 1);
  const to = monthStartPlus(today, 2);
  const skip = (d: string) => /-12-(24|25|31)$|-01-01$/.test(d);
  const out: string[] = [];
  for (const m of monthsBetween(from, to)) {
    for (const d of m.days) {
      const p = dayParts(d);
      if (p.weekday < 2 || p.weekday > 5 || skip(d)) continue;
      if (p.month === dayParts(to).month && p.day > 14) continue;
      out.push(d);
    }
  }
  return out;
}

export async function tournamentTestStage(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  if (!previewSiteFor(ctx)) throw new HttpError(404, 'not_found', 'Not found.');
  const stage = v.oneOf(body.stage, 'stage', TEST_STAGES);
  // Either format at each stage (left out: Doubles). Americano has its own name and the 2nd place credit.
  const format = body.format === undefined ? 'doubles' : v.oneOf(body.format, 'format', FORMATS);
  await setTournamentsForAll(ctx.db, group.id, true, ctx.nowIso);
  // The fake database only: every tournament of the (fake) group goes; its sign-ups and level history go with it (ON DELETE CASCADE).
  await ctx.db.prepare('DELETE FROM tournaments WHERE group_id = ?').bind(group.id).run();
  if (stage === 'none') return { ok: true, stage };

  const { results: players } = await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ? AND is_active = 1').bind(group.id).all<{ id: string; display_name: string }>();
  const idOf = new Map(players.map((p) => [p.display_name, p.id]));
  const dates = testDates(todayKey(ctx.nowMs, group.timezone));
  // The date everyone on the list can make: the third Thursday of next month (or the middle offered date).
  const thursdays = dates.filter((d) => dayParts(d).weekday === 4);
  const best = thursdays[2] ?? dates[Math.floor(dates.length / 2)];
  const id = newId();
  const t0 = Date.parse(ctx.nowIso) - 3 * 86_400_000;
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const statements = [
    ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, date_picked_at, shown_at, format, second_credit_cents)
         VALUES (?, ?, ?, 8, 2, 120, 1170, 1600, 1400, ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        group.id,
        format === 'americano' ? 'Winter Americano' : 'Winter Classic',
        JSON.stringify(dates),
        stage === 'date_picked' ? best : null,
        stage,
        at(0),
        ctx.nowIso,
        stage === 'date_picked' ? ctx.nowIso : null,
        at(1),
        format,
        format === 'americano' ? 700 : 0,
      ),
  ];
  let n = 0;
  for (const c of CAST) {
    if (c.stage === 'date_picked' && stage !== 'date_picked') continue;
    const pid = idOf.get(c.name);
    if (!pid) continue;
    n++;
    const picks = [...new Set([...dates.filter((_, i) => (i + c.offset) % c.every === 0), best])].sort();
    const approved = stage === 'date_picked' && c.name === 'Sage' ? 340 : null;
    statements.push(
      ctx.db
        .prepare(
          `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, pid, c.level, approved, JSON.stringify(picks), at(10 + n * 7), at(10 + n * 7), at(10 + n * 7)),
      ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'player', ?)").bind(newId(), id, pid, c.level, at(10 + n * 7)),
    );
    if (approved !== null) {
      statements.push(ctx.db.prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES (?, ?, ?, ?, 'organizer', ?)").bind(newId(), id, pid, approved, ctx.nowIso));
    }
  }
  await ctx.db.batch(statements);
  return { ok: true, stage, format, id, signedUp: n, date: stage === 'date_picked' ? best : null, firstDate: dates[0] ?? dayKey(2026, 1, 1) };
}
