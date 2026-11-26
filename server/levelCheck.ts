// Zip 95 (🎾95.level check): the organizer's Level check card after a tournament ends, and the player's RECOMMENDED level at the next sign-up.
// The rules are in shared/levelCheck.ts. No migration: each answer is one task_log row (kind 'mark', no game), task
// 'level_check:<tournament>:<player>', detail the level in hundredths or 'no'. The card's read rides the dashboard's shared trip (no new trip on
// admin Home or its 5 second check); the player's recommendation rides the sign-up's previous-level read (server/tournament.ts).
import type { Ctx } from './context';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit, type GroupRow, type ReadSpec } from './repo';
import { organizerOn } from './tournament';
import { isLevel, levelLabel } from '../shared/tournament';
import {
  type AdminLevelCheck,
  LEVEL_CHECK_DAYS,
  LEVEL_CHECK_NO,
  LEVEL_CHECK_TASK,
  type LevelCheckFacts,
  levelCheckLine,
  levelCheckTask,
  levelsAbove,
  qualifies,
  TOP_LEVEL,
} from '../shared/levelCheck';

const DAY_MS = 86_400_000;

/**
 * SQL: is the player (`player`, a column) on side `slot` of game `g`? Americano writes the two players into the slot ('id1+id2'); Locked doubles
 * writes the team's seat (`seat_a` once there is a result, else the slot 'T3' of a pool game) and the team row names its two players.
 */
const onSide = (slot: 'slot_a' | 'slot_b', seat: 'seat_a' | 'seat_b', player: string) =>
  `(instr('+' || g.${slot} || '+', '+' || ${player} || '+') > 0 OR EXISTS (SELECT 1 FROM tournament_teams tm WHERE tm.tournament_id = g.tournament_id
     AND tm.seat = COALESCE(g.${seat}, CASE WHEN g.${slot} GLOB 'T[0-9]*' THEN CAST(substr(g.${slot}, 2) AS INTEGER) END) AND ${player} IN (tm.player_a, tm.player_b)))`;

/**
 * SQL over a results row `r` of tournament `tid`: '<played>:<won>' over its REGULAR games only (stage 'pool': Locked doubles' round robin and
 * pools, an extra round, every Americano round). Semifinals, the Final, 3rd place and tie games ('semi', 'final', 'third', 'tie') never count,
 * nor a skipped game or one without a result.
 */
export const recordSql = (tid: string, player = 'r.player_id') => {
  const a = onSide('slot_a', 'seat_a', player);
  const b = onSide('slot_b', 'seat_b', player);
  return `(SELECT COUNT(*) || ':' || COALESCE(SUM(CASE WHEN (g.winner = 'a' AND ${a}) OR (g.winner = 'b' AND ${b}) THEN 1 ELSE 0 END), 0)
     FROM tournament_games g WHERE g.tournament_id = ${tid} AND g.stage = 'pool' AND g.skipped = 0 AND g.winner IS NOT NULL AND (${a} OR ${b}))`;
};

/** SQL: the saved answer (task_log detail) for tournament `tid` and player `player`, or NULL; on the task_log_once index like the other marks. */
export const answerSql = (tid: string, player: string) =>
  `(SELECT h.detail FROM task_log h WHERE h.session_id IS NULL AND h.task = '${LEVEL_CHECK_TASK}' || ${tid} || ':' || ${player} AND h.kind IN ('mark', 'sent') AND h.kind = 'mark' LIMIT 1)`;

/**
 * The card's one read (it rides the dashboard's shared trip while Tournaments is on): the newest Everyone tournament that ended in the last
 * LEVEL_CHECK_DAYS days, and each of its players NOT answered yet and below the top level, with their level, gold medal and regular record.
 * Nothing ended lately (the usual case): SQLite finds no tournament and reads nothing more.
 */
export const levelCheckRead = (groupId: string, nowMs: number): ReadSpec => ({
  sql: `SELECT t.id AS tid, t.name AS tname, t.ended_at, r.player_id, p.display_name, COALESCE(r.approved_level, r.picked_level) AS level, r.medal,
          ${recordSql('t.id')} AS record
        FROM (SELECT id, name, ended_at FROM tournaments WHERE group_id = ?1 AND status = 'ended' AND visibility = 'all' AND ended_at > ?2
              ORDER BY ended_at DESC, id LIMIT 1) t
        JOIN tournament_results r ON r.tournament_id = t.id JOIN players p ON p.id = r.player_id
        WHERE p.group_id = ?1 AND COALESCE(r.approved_level, r.picked_level) < ${TOP_LEVEL} AND ${answerSql('t.id', 'r.player_id')} IS NULL
        ORDER BY r.rowid`,
  values: [groupId, new Date(nowMs - LEVEL_CHECK_DAYS * DAY_MS).toISOString()],
});

interface LevelCheckDbRow {
  tid: string;
  tname: string;
  ended_at: string;
  player_id: string;
  display_name: string;
  level: number | null;
  medal: number;
  record: string | null;
}

const factsOf = (r: LevelCheckDbRow): LevelCheckFacts => {
  const [played, won] = String(r.record ?? '0:0').split(':').map((x) => Number(x) || 0);
  return { played, won, champion: Number(r.medal) === 1, level: r.level === null ? null : Number(r.level) };
};

/** The card from the read's rows (null: nothing to ask). The organizer's own player is never on it. */
export function levelCheckFrom(rows: LevelCheckDbRow[], organizerId: string | null): AdminLevelCheck | null {
  const first = rows[0];
  if (!first) return null;
  const out = rows
    .filter((r) => r.player_id !== organizerId)
    .map((r) => ({ r, f: factsOf(r) }))
    .filter(({ f }) => qualifies(f))
    .map(({ r, f }) => ({ playerId: r.player_id, name: r.display_name, level: f.level!, line: levelCheckLine(f) }));
  if (!out.length) return null;
  return { tournamentId: first.tid, name: first.tname, until: new Date(Date.parse(first.ended_at) + LEVEL_CHECK_DAYS * DAY_MS).toISOString(), rows: out };
}

/** The dashboard's `levelCheck` (the read is answered from the shared trip; a failure just leaves the card out). */
export async function levelCheckAdmin(ctx: Ctx, group: GroupRow, organizerId: string | null): Promise<AdminLevelCheck | null> {
  const q = levelCheckRead(group.id, ctx.nowMs);
  const rows = await ctx.db
    .prepare(q.sql)
    .bind(...q.values)
    .all<LevelCheckDbRow>()
    .then((r) => r.results)
    .catch(() => [] as LevelCheckDbRow[]);
  return levelCheckFrom(rows, organizerId);
}

/**
 * POST /api/admin/level-check { tournamentId, playerId, level }: the card's Save (`level`, a level above theirs) or No (`level: null`). One
 * task_log row, written once (a second tap, or a second phone, gets 409 "already answered": the first answer stands). Refused once the card is gone (3 days)
 * or for someone the card never asks about.
 */
export async function saveLevelCheck(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const tournamentId = v.id(body.tournamentId, 'tournamentId');
  const playerId = v.id(body.playerId, 'playerId');
  // Only an explicit null is No (a request without `level` is refused, never stored as a No).
  if (!('level' in body)) throw new HttpError(400, 'invalid_level', 'Pick a level.');
  const level = body.level === null ? null : body.level;
  if (level !== null && !isLevel(level)) throw new HttpError(400, 'invalid_level', 'Pick a level.');
  const row = await ctx.db
    .prepare(
      `SELECT t.id AS tid, t.name AS tname, t.ended_at, r.player_id, p.display_name, COALESCE(r.approved_level, r.picked_level) AS level, r.medal,
         ${recordSql('t.id')} AS record, ${answerSql('t.id', 'r.player_id')} AS answer
       FROM tournaments t JOIN tournament_results r ON r.tournament_id = t.id JOIN players p ON p.id = r.player_id
       WHERE t.id = ? AND t.group_id = ? AND p.group_id = t.group_id AND t.status = 'ended' AND t.visibility = 'all' AND r.player_id = ?`,
    )
    .bind(tournamentId, group.id, playerId)
    .first<LevelCheckDbRow & { answer: string | null }>();
  if (!row || Date.parse(row.ended_at) + LEVEL_CHECK_DAYS * DAY_MS <= ctx.nowMs) throw new HttpError(409, 'level_check_gone', 'This just changed. Look again.');
  // Already answered (another phone, or a page left open): the first answer stands, and this tap is told so (never a false "saved").
  if (row.answer !== null) throw new HttpError(409, 'level_check_answered', `${row.display_name} was already answered. Look again.`);
  const f = factsOf(row);
  if (!qualifies(f)) throw new HttpError(409, 'level_check_gone', 'This just changed. Look again.');
  if (level !== null && !levelsAbove(f.level!).includes(level as number)) throw new HttpError(400, 'invalid_level', 'Pick a level above theirs.');
  const detail = level === null ? LEVEL_CHECK_NO : String(level);
  // Written once, whatever two taps or two phones send (the task_log_once index does not cover rows with no game).
  const res = await ctx.db
    .prepare(
      `INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at)
       SELECT ?, ?, NULL, ?, 'mark', ?, ? WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE session_id IS NULL AND task = ? AND kind = 'mark')`,
    )
    .bind(newId(), group.id, levelCheckTask(row.tid, playerId), detail, ctx.nowIso, levelCheckTask(row.tid, playerId))
    .run();
  if (!res.meta?.changes) throw new HttpError(409, 'level_check_answered', `${row.display_name} was already answered. Look again.`);
  await audit(ctx.db, group.id, null, 'tournament_level_check', { tournament: row.tname, player: row.display_name, playerId, ...(level === null ? {} : { level: levelLabel(level as number) }) }, ctx.nowIso);
  return { ok: true, changed: true };
}
