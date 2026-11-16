import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { HttpError } from './http';
import { priceLockCol, priceOf, settingsOf, type GroupRow, type SessionRow } from './repo';
import { SWITCH_READ } from './speed';
import { MONEY_NOTE, MONEY_NOTE_DAYS, moneyNoteText, noteFromLine, type MoneyNoteFacts, type MoneyNoteKind } from '../shared/moneyNote';

// Zip 51b: MONEY_NOTE ("Money change note", shared/moneyNote.ts). One Settings > Feature switches row (task_log, no schema change, no
// Cloudflare variable), ships OFF. Off: no read beyond the one switch question every switch asks (answered from the shared switch read), no
// write anywhere, and every answer is exactly main's.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Settings row. */
export async function moneyNoteForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, MONEY_NOTE.task).first().catch(() => null);
  return !!row;
}

/** When the row went on (the no-backfill start), or null while it is off. */
async function moneyNoteOnAt(db: D1Database, groupId: string): Promise<number | null> {
  if (!(await moneyNoteForAll(db, groupId))) return null;
  const row = await db
    .prepare("SELECT at FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, MONEY_NOTE.task)
    .first<{ at: string }>();
  const t = row ? Date.parse(row.at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Turns the row on or off. On while it is already on changes nothing: its time is the no-backfill start, so a second "on" must never move it
 * and hide a note that is still due. Off removes the row and the notes' own rows (Got it, back In): turning it on again starts fresh, from that
 * moment (no backfill), so nothing from before can show, and the shared switch read stays as small as before.
 */
export async function setMoneyNoteForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<boolean> {
  if (on && (await moneyNoteForAll(db, groupId))) return false;
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, MONEY_NOTE.task).run();
  if (!on) {
    await db
      .prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND (task = ? OR substr(task, 1, ?) = ?)")
      .bind(groupId, MONEY_NOTE.backInTask, MONEY_NOTE.seenPrefix.length, MONEY_NOTE.seenPrefix)
      .run();
  }
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, MONEY_NOTE.task, nowIso).run();
  }
  return true;
}

export interface MoneyNote {
  id: string;
  kind: MoneyNoteKind;
  text: string;
}

type Game = Pick<SessionRow, 'starts_at' | 'ends_at'> & { price_lock?: string | null };

/**
 * This player's notes still to show, oldest first. Empty while the row is off, for the organizer's own seat, and for anything before the row
 * went on. Read from: the History lines the site already writes for a sub and a moved game ("late_fee_cleared", that player's id only), and
 * the back-In rows written while the row is on. A note tapped "Got it" never shows again. `covered`: every History line that has a note,
 * tapped or not (the Good news line leaves those out, so the same clear is never told twice). `owedOn`: what this player still owes per game
 * right now (the same `owed` list their screen shows), for "$14 still owed" (left out when they owe nothing more there, e.g. they had paid).
 */
export async function moneyNotesFor(
  db: D1Database,
  group: GroupRow,
  playerId: string,
  nowMs: number,
  owedOn: ReadonlyMap<string, number> = new Map(),
): Promise<{ notes: MoneyNote[]; covered: string[] }> {
  const onAt = await moneyNoteOnAt(db, group.id);
  if (onAt === null) return { notes: [], covered: [] };
  const since = new Date(Math.max(onAt, nowMs - MONEY_NOTE_DAYS * DAY_MS)).toISOString();
  const settings = settingsOf(group);
  const [lines, backIns, seen] = await db.batch([
    db
      .prepare(
        `SELECT a.id, a.session_id, a.details_json, a.created_at, s.starts_at, s.ends_at, ${priceLockCol('s')} FROM admin_audit_log a JOIN sessions s ON s.id = a.session_id
         WHERE a.group_id = ? AND a.action = 'late_fee_cleared' AND a.created_at >= ? ORDER BY a.created_at, a.rowid`,
      )
      .bind(group.id, since),
    db
      .prepare("SELECT id, detail, at FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' AND at >= ? ORDER BY at, id")
      .bind(group.id, MONEY_NOTE.backInTask, since),
    // A Got it is always written after its note's own moment, so the same window holds every one that matters.
    db
      .prepare("SELECT task FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND substr(task, 1, ?) = ? AND at >= ?")
      .bind(group.id, MONEY_NOTE.seenPrefix.length, MONEY_NOTE.seenPrefix, since),
  ]);
  const seenIds = new Set((seen.results as { task: string }[]).map((r) => r.task.slice(MONEY_NOTE.seenPrefix.length)));
  const out: { at: string; note: MoneyNote }[] = [];
  const covered: string[] = [];
  const push = (id: string, at: string, f: MoneyNoteFacts) => {
    covered.push(id);
    if (!seenIds.has(id)) out.push({ at, note: { id, kind: f.kind, text: moneyNoteText(f) } });
  };
  for (const r of lines.results as ({ id: string; session_id: string; details_json: string; created_at: string } & Game)[]) {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(r.details_json) as Record<string, unknown>;
    } catch {
      continue; // an unreadable line shows nothing
    }
    if (d.playerId !== playerId) continue;
    const f = noteFromLine(d, priceOf(r, settings).flatCents, r.starts_at, group.timezone, owedOn.get(r.session_id) ?? 0);
    if (f) push(r.id, r.created_at, f);
  }
  for (const r of backIns.results as { id: string; detail: string | null; at: string }[]) {
    try {
      const d = JSON.parse(r.detail ?? '{}') as { playerId?: unknown };
      if (d.playerId === playerId) push(r.id, r.at, { kind: 'back_in' });
    } catch {
      /* an unreadable row shows nothing */
    }
  }
  return { notes: out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map((x) => x.note), covered };
}

/**
 * "Got it" (POST /api/money-note/seen { id }): only a note this player is being shown right now. Written once (a second tap, or two phones,
 * write nothing more). Nothing else changes: no money, no seat, no History line.
 */
export async function markMoneyNoteSeen(ctx: Ctx, group: GroupRow, playerId: string, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' && /^[0-9A-Za-z-]{1,64}$/.test(body.id) ? body.id : null;
  if (!id) throw new HttpError(400, 'invalid_id', 'That note is not something to close.');
  const { notes } = await moneyNotesFor(ctx.db, group, playerId, ctx.nowMs);
  if (!notes.some((n) => n.id === id)) {
    const done = await ctx.db
      .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
      .bind(group.id, MONEY_NOTE.seenPrefix + id)
      .first();
    if (done) return { ok: true, already: true };
    throw new HttpError(404, 'not_found', 'That note is gone.');
  }
  const res = await ctx.db
    .prepare(
      `INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at)
       SELECT ?1, ?2, NULL, ?3, 'mark', ?4, ?5
       WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE group_id = ?2 AND session_id IS NULL AND task = ?3 AND kind = 'mark')`,
    )
    .bind(newId(), group.id, MONEY_NOTE.seenPrefix + id, JSON.stringify({ playerId }), ctx.nowIso)
    .run();
  return { ok: true, already: res.meta.changes !== 1 };
}

/** The organizer put this player back In while their late drop still owed (Zip 51, F-15): the note's row, only while the switch is on. */
export async function recordBackIn(db: D1Database, groupId: string, sessionId: string, playerId: string, nowIso: string): Promise<void> {
  if (!(await moneyNoteForAll(db, groupId))) return;
  await db
    .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, NULL, ?, 'mark', ?, ?)")
    .bind(newId(), groupId, MONEY_NOTE.backInTask, JSON.stringify({ sessionId, playerId }), nowIso)
    .run();
}
