import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { ACTING_OTHERS, type ActingRow, actingOthersAllowed, cardRows, type From, judgeTaps, LOOKBACK_DAYS, type TaggedLine } from '../shared/actingForOthers';

// Zip 30: ACTING_FOR_OTHERS (shared/actingForOthers.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?actingothers=on
//    (it then sends X-Acting-Others: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game), the same way the other switches are stored.
// Organizer screens only, look only: no seat, price, credit, text or Telegram reads it. Off: the organizer answers are exactly main's
// and the phone-code read below never runs.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, ACTING_OTHERS.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const actingOthersForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setActingOthersForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ACTING_OTHERS.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ACTING_OTHERS.task, nowIso).run();
  }
}

/** The switch for this screen, and the Settings row: one read of the row for both. */
export async function actingOthersFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(ACTING_OTHERS.header) ?? '').toLowerCase() === 'on';
  // Preview only (ACTING_FOR_OTHERS_PREVIEW, never in production [vars]): the preview database is shared by every channel's preview and
  // another channel's re-seed drops this row, so this zip's own preview shows the feature whatever the row says. The Settings row is unchanged.
  const preview = (ctx.env.ACTING_FOR_OTHERS_PREVIEW ?? '').trim().toLowerCase() === 'on';
  return { on: actingOthersAllowed(ctx.env.ACTING_FOR_OTHERS) && (header || row || preview), forAll: row };
}

/**
 * Every History line with a phone code from the last 180 days, oldest first: ONE read, organizer screens only, and only while the switch
 * is on. The index from migration 0018 holds only the lines that have a code, so the read touches those lines and nothing else. A database
 * without the column (before 0018) reads nothing.
 */
export async function taggedLines(db: D1Database, groupId: string, nowMs: number): Promise<TaggedLine[]> {
  const since = new Date(nowMs - LOOKBACK_DAYS * 86_400_000).toISOString();
  const res = await db
    .prepare(
      `SELECT id, device_tag, actor_label, action, details_json, created_at FROM admin_audit_log
       WHERE group_id = ? AND device_tag IS NOT NULL AND created_at > ? ORDER BY created_at, rowid`,
    )
    .bind(groupId, since)
    .all<{ id: string; device_tag: string; actor_label: string; action: string; details_json: string; created_at: string }>()
    .catch(() => null);
  if (!res) return [];
  return res.results.map((r) => ({ id: r.id, tag: r.device_tag, name: r.actor_label, action: r.action, details: parse(r.details_json), createdAt: r.created_at }));
}

function parse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The organizer's own player is never "acting for others": a phone that name has used is Alex's. */
const exemptFor = (organizerNames: (string | null | undefined)[]) => {
  const names = new Set(organizerNames.filter((n): n is string => !!n).map((n) => n.trim().toLowerCase()));
  return (name: string) => names.has(name.trim().toLowerCase());
};

/** The judged taps (by History line id) and the Home card's rows. */
export async function actingOthersPicture(db: D1Database, groupId: string, nowMs: number, organizerNames: (string | null | undefined)[]): Promise<{ judged: Map<string, From>; rows: ActingRow[] }> {
  const lines = await taggedLines(db, groupId, nowMs);
  const judged = judgeTaps(lines, exemptFor(organizerNames));
  return { judged, rows: cardRows(lines, judged, nowMs) };
}
