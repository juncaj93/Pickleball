import type { Ctx } from './context';
import { requireAdmin } from './auth';

// Zip 18: "View as" shows what that player really sees.
//
// The organizer's demo (View as, Pretend it's...) is a throwaway copy of the data in the organizer's browser tab (src/demo), built from
// the backup file. The backup leaves out task_log, and every feature switch's "on for everyone" row lives in task_log (kind 'mark', no
// game). So the copy had no switch rows and every switch read OFF there: View as drew the old player look (the Want in card, "5 in",
// "Court booked", the $14 due pill) whatever Settings said. The copy also had none of the wrangler.toml switch values.
//
// GET /api/admin/demo-extras hands the copy the two missing parts, read only:
//  - taskLog: every task_log row of the group, as it is now (the switch rows, and the per-game marks the screens read too, like a game
//    hidden from players or a Second Chance game reopened). Any future switch stored the same way comes along with no edit here.
//  - env: every setting of this deployment whose value is exactly "on" or "off" (the kill switches, and the preview-only ones like
//    PREVIEW_CALM on a preview). Nothing else: secrets, the PIN and the Telegram token are never "on" or "off", and are never sent.
// Organizer only (the real PIN or the read-only PIN). It reads two things and writes nothing.

export interface DemoExtras {
  taskLog: { id: string; group_id: string; session_id: string | null; task: string; kind: string; detail: string | null; at: string }[];
  env: Record<string, string>;
}

const NAME = /^[A-Z][A-Z0-9_]*$/;
const SWITCH_VALUE = /^(on|off)$/i;

/** The deployment's on/off settings only (see the top of this file). */
export function switchEnvOf(env: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'SANDBOX' || !NAME.test(k) || typeof v !== 'string' || !SWITCH_VALUE.test(v.trim())) continue;
    out[k] = v.trim().toLowerCase();
  }
  return out;
}

export async function demoExtras(ctx: Ctx): Promise<DemoExtras> {
  const group = await requireAdmin(ctx);
  const { results } = await ctx.db
    .prepare('SELECT id, group_id, session_id, task, kind, detail, at FROM task_log WHERE group_id = ? ORDER BY at, id')
    .bind(group.id)
    .all<DemoExtras['taskLog'][number]>();
  return { taskLog: results, env: switchEnvOf(ctx.env) };
}
