// Calendar subscriptions: one private, hard-to-guess link per player that
// lists only the sessions they're in, and one for the organizer with every
// session. Phones re-download the feed on their own schedule, so new times
// and cancellations show up without anyone tapping anything.

import { calendarFeed } from '../shared/calendar';
import { DEFAULT_VENUE_NAME, SITE_NAME } from '../shared/settings';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { randomToken } from './crypto';
import { HttpError } from './http';
import { viewer } from './player';
import { audit, type GroupRow, type PlayerRow, type SessionRow, visibleFrom } from './repo';
import * as v from './validate';

const LOOKBACK_MS = 30 * 24 * 3600_000;

function links(ctx: Ctx, token: string) {
  const https = `${ctx.url.origin}/api/cal/${token}.ics`;
  return { url: https, webcal: https.replace(/^https?:/, 'webcal:') };
}

function location(group: GroupRow): string {
  const name = group.venue_name || DEFAULT_VENUE_NAME;
  return group.venue_address ? `${name}, ${group.venue_address}` : name;
}

/** GET /api/cal/:token.ics: the feed itself. Anyone with the link can read it, so it holds nothing private. */
export async function calendarFile(ctx: Ctx): Promise<Response> {
  const token = (ctx.params.token ?? '').replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) throw new HttpError(404, 'calendar_not_found', 'This calendar link is not valid.');
  const since = new Date(ctx.nowMs - LOOKBACK_MS).toISOString();
  let group: GroupRow | null;
  let sessions: SessionRow[];
  const player = await ctx.db.prepare('SELECT * FROM players WHERE calendar_token = ? AND calendar_off = 0 AND is_active = 1').bind(token).first<PlayerRow>();
  if (player) {
    group = await ctx.db.prepare('SELECT * FROM groups WHERE id = ?').bind(player.group_id).first<GroupRow>();
    const { results } = await ctx.db
      .prepare(
        `SELECT s.* FROM sessions s JOIN session_players sp ON sp.session_id = s.id
         WHERE sp.player_id = ? AND sp.status = 'confirmed' AND s.ends_at > ? ORDER BY s.starts_at`,
      )
      .bind(player.id, since)
      .all<SessionRow>();
    sessions = results;
  } else {
    group = await ctx.db.prepare('SELECT * FROM groups WHERE calendar_token = ?').bind(token).first<GroupRow>();
    if (!group) throw new HttpError(404, 'calendar_not_found', 'This calendar link is not valid.');
    const { results } = await ctx.db
      .prepare('SELECT * FROM sessions WHERE group_id = ? AND ends_at > ? AND (starts_at >= ? OR shown_early = 1) ORDER BY starts_at')
      .bind(group.id, since, visibleFrom(group))
      .all<SessionRow>();
    sessions = results;
  }
  if (!group) throw new HttpError(404, 'calendar_not_found', 'This calendar link is not valid.');
  const body = calendarFeed({
    name: SITE_NAME,
    timezone: group.timezone,
    location: location(group),
    nowIso: ctx.nowIso,
    events: sessions.map((s) => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, canceled: s.status === 'canceled', updatedAt: s.updated_at })),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="pickleball.ics"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** GET /api/me/calendar: this player's link, made on first use. */
export async function myCalendar(ctx: Ctx) {
  const who = await viewer(ctx);
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const p = await ctx.db.prepare('SELECT * FROM players WHERE id = ? AND group_id = ?').bind(who.playerId, who.group.id).first<PlayerRow>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  if (p.calendar_off) return { off: true };
  let token = p.calendar_token;
  if (!token) {
    token = randomToken(32);
    await ctx.db.prepare('UPDATE players SET calendar_token = ? WHERE id = ? AND calendar_token IS NULL').bind(token, p.id).run();
    const again = await ctx.db.prepare('SELECT calendar_token FROM players WHERE id = ?').bind(p.id).first<{ calendar_token: string }>();
    token = again?.calendar_token ?? token;
  }
  return { off: false, ...links(ctx, token) };
}

/** GET /api/admin/calendar: the organizer's link with every session. */
export async function organizerCalendar(ctx: Ctx) {
  const group = await requireAdmin(ctx);
  let token = group.calendar_token;
  if (!token) {
    token = randomToken(32);
    await ctx.db.prepare('UPDATE groups SET calendar_token = ? WHERE id = ?').bind(token, group.id).run();
  }
  return links(ctx, token);
}

/** PUT /api/admin/players/:id/calendar { on }: turning it off kills the old link for good. */
export async function setPlayerCalendar(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireAdmin(ctx);
  const id = v.id(ctx.params.id, 'player');
  const on = v.bool(body.on, 'on');
  const p = await ctx.db.prepare('SELECT * FROM players WHERE id = ? AND group_id = ?').bind(id, group.id).first<PlayerRow>();
  if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
  await ctx.db
    .prepare('UPDATE players SET calendar_off = ?, calendar_token = CASE WHEN ? = 1 THEN calendar_token ELSE NULL END WHERE id = ?')
    .bind(on ? 0 : 1, on ? 1 : 0, id)
    .run();
  await audit(ctx.db, group.id, null, on ? 'calendar_on' : 'calendar_off', { player: p.display_name }, ctx.nowIso);
  return { ok: true };
}
