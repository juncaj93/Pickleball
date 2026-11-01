// ONE-TIME repair (Nov 1, 2026), removed again right after it has run once.
//
// Until the "Waitlist court is just Not booked" rule, a game whose court was on Waitlist put every signer on
// standby. Those people never got a normal seat. This runs the site's own `settle` (the same step that moves the
// first waiting person in when a spot opens, with their credit going on in the same step) for any upcoming game that
// has people waiting while it still has room. Nothing is written except what `settle` itself writes, plus one
// audit line per game. `?dry=1` only reads and says what it would do.
//
// Only a caller that knows FIX_TOKEN (a one-off wrangler.toml var, never committed) gets anything but "Not found".
import { type Ctx } from './context';
import { HttpError } from './http';
import { audit, getGroup, loadRoster, settingsOf, type SessionRow, waitlistOf, confirmedOf } from './repo';
import { settle } from './roster';

function same(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function fixStandby(ctx: Ctx) {
  const token = ctx.env.FIX_TOKEN ?? '';
  if (!token || !same(ctx.req.headers.get('X-Fix-Token') ?? '', token)) throw new HttpError(404, 'not_found', 'Not found.');
  const dry = ctx.url.searchParams.get('dry') === '1';
  const group = await getGroup(ctx.db);
  if (!group) throw new HttpError(404, 'not_found', 'Not found.');
  const max = settingsOf(group).maxPlayers;
  const { results } = await ctx.db
    .prepare("SELECT * FROM sessions WHERE group_id = ? AND status <> 'canceled' AND ends_at > ? ORDER BY starts_at")
    .bind(group.id, ctx.nowIso)
    .all<SessionRow>();
  const names = new Map((await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ?').bind(group.id).all<{ id: string; display_name: string }>()).results.map((p) => [p.id, p.display_name]));
  const games: unknown[] = [];
  for (const s of results) {
    const roster = await loadRoster(ctx.db, s.id);
    const waiting = waitlistOf(roster);
    const confirmed = confirmedOf(roster).length;
    if (waiting.length === 0 || confirmed >= max) continue;
    const entry: Record<string, unknown> = { id: s.id, startsAt: s.starts_at, confirmedBefore: confirmed, waiting: waiting.map((w) => names.get(w.player_id) ?? w.player_id) };
    if (!dry) {
      const promoted = await settle(ctx.db, s, ctx.nowIso, max);
      entry.promoted = promoted.map((p) => ({ name: names.get(p.playerId) ?? p.playerId, creditCents: p.creditCents ?? 0, paidWithCredit: !!p.paidWithCredit }));
      await audit(ctx.db, group.id, s.id, 'standby_repaired', { promoted: promoted.length }, ctx.nowIso, 'system');
    }
    games.push(entry);
  }
  return { ok: true, dry, max, games };
}
