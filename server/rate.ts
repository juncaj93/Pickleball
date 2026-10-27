import type { Ctx } from './context';
import { newId } from './crypto';

// Small per-phone rate limits (new names, group-word guesses). "Phone" here
// means the network address the request came from, which is what the
// server can see without tracking anyone.

function clientKey(ctx: Ctx): string {
  return ctx.req.headers.get('CF-Connecting-IP') ?? 'local';
}

/** How many `kind` events this phone had in the last `windowMs`. */
export async function recentCount(ctx: Ctx, kind: string, windowMs: number): Promise<number> {
  const since = new Date(ctx.nowMs - windowMs).toISOString();
  const row = await ctx.db
    .prepare('SELECT COUNT(*) AS n FROM rate_events WHERE kind = ? AND client_key = ? AND created_at > ?')
    .bind(kind, clientKey(ctx), since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordEvent(ctx: Ctx, kind: string): Promise<void> {
  await ctx.db
    .prepare('INSERT INTO rate_events (id, kind, client_key, created_at) VALUES (?, ?, ?, ?)')
    .bind(newId(), kind, clientKey(ctx), ctx.nowIso)
    .run();
  // Keep the table small: nothing older than a day matters.
  await ctx.db.prepare('DELETE FROM rate_events WHERE created_at < ?').bind(new Date(ctx.nowMs - 86_400_000).toISOString()).run();
}
