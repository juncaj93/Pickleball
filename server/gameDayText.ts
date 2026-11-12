import { MIN_PLAYERS } from '../shared/spots';
import { dayLabelR2, shortTime } from '../shared/textsR2';
import { siteAddress } from '../shared/messages';
import { DEFAULT_VENUE_NAME } from '../shared/settings';
import { GAME_DAY_TEXT, GAME_TEXT_TASK, gameDayTextAllowed, gameDayTextBody, recipientNumbers, reminderDue } from '../shared/gameDayText';
import { playerLinkFor } from './admin';
import { type AlertRow, connected, deliver, PAUSED_PREFIX, prefsOf, TIMEOUT_ERROR } from './alerts';
import type { Ctx } from './context';
import { newId } from './crypto';
import type { D1Database } from './db';
import { HttpError } from './http';
import { isPretend } from './pretend';
import { signedUpOweOnGame } from './checkInPay';
import { confirmedOf, getGroup, getPlayers, getSession, type GroupRow, loadRoster, organizerIdOf, priceOf, type SessionRow, settingsOf, visibleFrom } from './repo';
import { withShortGames } from './zip9';
import * as v from './validate';

// Zip 37: GAME_DAY_TEXT (shared/gameDayText.ts). On when its wrangler.toml var is not "off" (the kill switch, needs a deploy) and the
// organizer switched it on in Settings > Feature switches (or this is a preview that has its own switch on). There is no private
// per-phone link: the message comes from the 5-minute clock, which has no phone. "On for everyone" is one row in task_log (kind
// 'mark', no game), the same way the other switches are stored. The only database writes are the Telegram's own claim row (as the
// clock's other alerts) and nothing at all when the page is opened.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, GAME_DAY_TEXT.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const gameDayTextForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setGameDayTextForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, GAME_DAY_TEXT.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, GAME_DAY_TEXT.task, nowIso).run();
  }
}

/** Preview only (GAME_DAY_TEXT_PREVIEW exists only in [env.preview.vars], never [vars]; a test checks). */
export function gameDayTextPreview(ctx: Ctx): boolean {
  return (ctx.env.GAME_DAY_TEXT_PREVIEW ?? '').trim().toLowerCase() === 'on';
}

/** "Game day text" is on: the kill switch allows it and the Settings row is on (or this preview has its own switch on). */
export async function gameDayTextOn(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!gameDayTextAllowed(ctx.env.GAME_DAY_TEXT)) return false;
  if (gameDayTextPreview(ctx)) return true;
  return forAll(ctx.db, groupId);
}

// ---------- The private link: /gt/<token> ----------
// Signed like the night-before link (server/go.ts) with its own purpose word, so one kind of token can never open the other. It names ONE
// game and when it stops working (the game's end). It holds no phone number, no name and no money. It needs no sign-in, so what it can give
// out is exactly what the organizer's Telegram link gives: the numbers of the people in that one game, until that game is over.

const PURPOSE = 'gdt-text-v1';
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${PURPOSE}:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${PURPOSE}.${message}`)));
}

/** "<payload>.<signature>": the payload is the game id and when the link stops working (the game's end). */
export async function makeGdtToken(secret: string, sessionId: string, endsAt: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ s: sessionId, e: Date.parse(endsAt) })));
  return `${payload}.${b64url(await sign(secret, payload))}`;
}

/** The game id, or why not. Equal-time signature check. */
export async function readGdtToken(secret: string, token: string, nowMs: number): Promise<{ sessionId: string } | { error: 'invalid' | 'expired' }> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || token.length > 300) return { error: 'invalid' };
  const got = fromB64url(sig);
  const want = await sign(secret, payload);
  if (!got || got.length !== want.length) return { error: 'invalid' };
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
  if (diff !== 0) return { error: 'invalid' };
  let data: { s?: unknown; e?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(fromB64url(payload) ?? new Uint8Array()));
  } catch {
    return { error: 'invalid' };
  }
  if (typeof data.s !== 'string' || typeof data.e !== 'number' || !Number.isFinite(data.e)) return { error: 'invalid' };
  if (nowMs >= data.e) return { error: 'expired' };
  return { sessionId: data.s };
}

/** Who gets the text for this game: confirmed (so not waitlisted, not dropped out), never the organizer, only with a number saved. */
export async function recipientsOf(ctx: Ctx, group: GroupRow, session: SessionRow): Promise<{ numbers: string[]; inGame: number; withoutNumber: number }> {
  const organizerId = await organizerIdOf(ctx.db, group);
  const roster = confirmedOf(await loadRoster(ctx.db, session.id));
  // Never the organizer: by their player record, and also any number that is the organizer's own (a second record with the same number).
  const own = organizerId ? recipientNumbers([roster.find((r) => r.player_id === organizerId)?.phone_number ?? (await getPlayers(ctx.db, group.id)).find((p) => p.id === organizerId)?.phone_number]) : [];
  const players = roster.filter((r) => r.player_id !== organizerId && !recipientNumbers([r.phone_number]).some((n) => own.includes(n)));
  const numbers = recipientNumbers(players.map((r) => r.phone_number));
  return { numbers, inGame: players.length, withoutNumber: players.filter((r) => !recipientNumbers([r.phone_number]).length).length };
}

/** The words for this game right now: the court, the club, the direct Apple Maps link, and the pay line only while somebody signed up still owes. */
export async function textFor(ctx: Ctx, group: GroupRow, session: SessionRow): Promise<string> {
  // The price the players see for this game: the same rules (Short games, Booking hours) as their own screen and the Check-in text.
  await withShortGames(ctx, group);
  const owes = await signedUpOweOnGame(ctx, group, session);
  return gameDayTextBody({
    startsAt: session.starts_at,
    tz: group.timezone,
    nowMs: ctx.nowMs,
    court: typeof session.court === 'number' ? session.court : null,
    // The club's name and its address are one pair: the address is the one constant the Directions button on the game day card uses, so the
    // name is the club's default name too (not Settings > Venue name, which is the name written on a booking).
    clubName: DEFAULT_VENUE_NAME,
    oweCents: owes ? priceOf(session, settingsOf(group)).flatCents : null,
    siteName: siteAddress(playerLinkFor(ctx, group)),
  });
}

/**
 * POST /api/gdt { token }: the numbers and the words for that game, looked up now. The token is the only key. Anything wrong (the switch
 * is off, a bad token, a game that does not exist) answers the same "This link does not work."; a link past the game's end says it expired.
 * `token` "preview" (a preview with GAME_DAY_TEXT_PREVIEW only, never live) opens the next game, so the page can be tried with fake data.
 */
export async function gameDayTextPage(ctx: Ctx, body: Record<string, unknown>) {
  const token = v.text(body.token, 'token', { max: 300 });
  const bad = () => new HttpError(404, 'not_found', 'This link does not work.');
  const group = await getGroup(ctx.db);
  if (!group || !(await gameDayTextOn(ctx, group.id))) throw bad();
  let session: SessionRow | null = null;
  if (token === 'preview') {
    if (!gameDayTextPreview(ctx)) throw bad();
    session = await ctx.db
      .prepare("SELECT * FROM sessions WHERE group_id = ? AND status <> 'canceled' AND ends_at > ? ORDER BY starts_at LIMIT 1")
      .bind(group.id, ctx.nowIso)
      .first<SessionRow>();
  } else {
    const secret = ctx.env.CRON_SECRET ?? '';
    if (!secret) throw bad();
    const read = await readGdtToken(secret, token, ctx.nowMs);
    if ('error' in read) {
      if (read.error === 'expired') throw new HttpError(410, 'link_expired', 'This link expired. The game is over.');
      throw bad();
    }
    session = await getSession(ctx.db, group.id, read.sessionId);
  }
  if (!session) throw bad();
  if (session.status === 'canceled') throw new HttpError(410, 'session_canceled', 'This game was canceled.');
  const who = await recipientsOf(ctx, group, session);
  return {
    ok: true as const,
    numbers: who.numbers,
    withoutNumber: who.withoutNumber,
    body: await textFor(ctx, group, session),
    // Only the preview says it is a fake game.
    ...(token === 'preview' ? { preview: true as const } : {}),
  };
}

// ---------- The Telegram: about an hour before the game ----------

const RETRY_AFTER_MS = 5 * 60_000;
const MAX_TRIES = 3;

const siteUrl = (ctx: Ctx) => (ctx.env.SITE_URL || ctx.url.origin).replace(/\/$/, '');

/** The one-line Telegram: when, how many are in, and the one link. "Text the players" becomes the tappable words (server/telegram-links.ts). */
export function reminderMessage(startsAt: string, tz: string, nowMs: number, inCount: number, link: string): string {
  return `${dayLabelR2(startsAt, tz, nowMs)} ${shortTime(startsAt, tz)} game starts in about an hour, ${inCount} in. Text the players: ${link}`;
}

/**
 * Called by the 5-minute clock with the games it already read. Only when a booked game is 15 to 60 minutes from its start (the window) does it
 * look at its switch row, and only while "Game day text" is on does it go on: for each such game with 4 or more in and at least one player with
 * a number, claim the alert (once per game), then send it. Never breaks the tick. Never from the demo or Pretend.
 */
export async function tickGameText(ctx: Ctx, group: GroupRow, games: SessionRow[]): Promise<void> {
  try {
    if (!gameDayTextAllowed(ctx.env.GAME_DAY_TEXT) || ctx.env.SANDBOX || isPretend(ctx.db)) return;
    const results = games.filter((s) => s.status !== 'canceled' && s.booking_status === 'booked' && !s.finalized_at && reminderDue(Date.parse(s.starts_at), ctx.nowMs));
    if (results.length === 0) return;
    if (!(await forAll(ctx.db, group.id))) return;
    const secret = ctx.env.CRON_SECRET ?? '';
    if (!secret || !connected(ctx.env)) return;
    const prefs = prefsOf(await ctx.db.prepare('SELECT * FROM organizer_alerts WHERE group_id = ?').bind(group.id).first<AlertRow>());
    if (!prefs.enabled) return;
    const shownFrom = visibleFrom(group);
    for (const s of results) {
      if (s.starts_at < shownFrom && Number(s.shown_early) !== 1) continue;
      const { results: logs } = await ctx.db
        .prepare("SELECT kind, at FROM task_log WHERE session_id = ? AND task = ? AND kind IN ('sent', 'failed')")
        .bind(s.id, GAME_TEXT_TASK)
        .all<{ kind: string; at: string }>();
      if (logs.some((l) => l.kind === 'sent')) continue;
      const failed = logs.filter((l) => l.kind === 'failed');
      if (failed.length >= MAX_TRIES || failed.some((l) => ctx.nowMs - Date.parse(l.at) < RETRY_AFTER_MS)) continue;
      const roster = await loadRoster(ctx.db, s.id);
      const inCount = confirmedOf(roster).length;
      if (inCount < MIN_PLAYERS) continue;
      if ((await recipientsOf(ctx, group, s)).numbers.length === 0) continue;
      const text = reminderMessage(s.starts_at, group.timezone, ctx.nowMs, inCount, `${siteUrl(ctx)}/gt/${await makeGdtToken(secret, s.id, s.ends_at)}`);
      // Claimed before sending (the table's unique index): two ticks at once can never both send it. Only while the game is still on.
      const claimId = newId();
      const claim = await ctx.db
        .prepare(
          `INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, at)
           SELECT ?1, ?2, ?3, ?4, 'sent', ?5 WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?3 AND status <> 'canceled' AND finalized_at IS NULL)`,
        )
        .bind(claimId, group.id, s.id, GAME_TEXT_TASK, ctx.nowIso)
        .run();
      if (!claim.meta.changes) continue;
      const result = await deliver(ctx, group.id, text);
      if (result.ok) continue;
      // The same rules as the clock's own alerts: the hour's limit is not a try (the claim goes back); Telegram too slow to answer may have
      // delivered it, so the claim stays (a missed alert beats a double one); any other failure gives the claim back and counts as a try.
      if (result.error.startsWith(PAUSED_PREFIX)) {
        await ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId).run();
        return;
      }
      const logFailure = ctx.db
        .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) VALUES (?, ?, ?, ?, 'failed', ?, ?)")
        .bind(newId(), group.id, s.id, GAME_TEXT_TASK, result.error.slice(0, 200), ctx.nowIso);
      if (result.error === TIMEOUT_ERROR) await logFailure.run();
      else await ctx.db.batch([ctx.db.prepare('DELETE FROM task_log WHERE id = ?').bind(claimId), logFailure]);
      return;
    }
  } catch {
    // Never breaks the tick.
  }
}
