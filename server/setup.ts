import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../shared/time';
import { ACCESS_COOKIE, accessToken, hashGroupWord, hasGroupAccess, startAdminSession } from './auth';
import { setCookie } from './context';
import { playerLinkFor } from './admin';
import { recentCount, recordEvent } from './rate';
import type { Ctx } from './context';
import { hashPin, newId, randomToken, timingSafeEqual } from './crypto';
import { HttpError } from './http';
import { ensureSessions, getGroup, type GroupRow } from './repo';
import * as v from './validate';

export async function setupStatus(ctx: Ctx) {
  const group = await getGroup(ctx.db);
  return {
    setupComplete: !!group,
    setupEnabled: !!ctx.env.SETUP_TOKEN && ctx.env.SETUP_TOKEN.length >= 16,
    // The plain site address works for players (no private link needed).
    openAccess: !!group?.open_access,
    // A group word is set and this phone hasn't entered it yet.
    wordRequired: !!group?.open_access && !(await hasGroupAccess(ctx, group)),
  };
}

const WORD_GUESSES_PER_15_MIN = 10;

/** A new phone types the group word once; the cookie remembers it for a year. */
export async function enterGroupWord(ctx: Ctx, body: Record<string, unknown>) {
  const group = await getGroup(ctx.db);
  if (!group || !group.open_access) throw new HttpError(404, 'group_not_found', 'Open the link your organizer sent you.');
  if (!group.group_word_hash) return { ok: true };
  if ((await recentCount(ctx, 'group_word_wrong', 15 * 60_000)) >= WORD_GUESSES_PER_15_MIN) {
    throw new HttpError(429, 'too_many_tries', 'Too many tries. Wait 15 minutes and try again.');
  }
  const word = typeof body.word === 'string' ? body.word.slice(0, 60) : '';
  if (!word.trim() || !timingSafeEqual(await hashGroupWord(word), group.group_word_hash)) {
    await recordEvent(ctx, 'group_word_wrong');
    throw new HttpError(401, 'wrong_group_word', "That's not the group word. Ask in the group chat.");
  }
  setCookie(ctx, ACCESS_COOKIE, await accessToken(group), 365 * 86_400, 'Lax');
  return { ok: true };
}

/**
 * First-time setup. Needs the SETUP_TOKEN secret (set in Cloudflare, never in
 * the code) so a stranger who finds the site first can't claim it. Works once.
 */
export async function runSetup(ctx: Ctx, body: Record<string, unknown>) {
  const expected = ctx.env.SETUP_TOKEN ?? '';
  if (expected.length < 16) {
    throw new HttpError(503, 'setup_disabled', 'Setup is turned off. Set the SETUP_TOKEN secret (16+ characters) first.');
  }
  if (typeof body.setupToken !== 'string' || !timingSafeEqual(body.setupToken, expected)) {
    throw new HttpError(401, 'wrong_setup_token', 'The setup code is not right.');
  }
  if (await getGroup(ctx.db)) throw new HttpError(409, 'already_set_up', 'The group is already set up.');

  const name = v.text(body.groupName, 'groupName', { max: 60 });
  const timezone = body.timezone === undefined ? DEFAULT_TIMEZONE : v.text(body.timezone, 'timezone', { max: 60 });
  if (!isValidTimezone(timezone)) throw new HttpError(400, 'invalid_timezone', 'Pick a US time zone.');
  const pin = v.pin(body.pin);
  const venmoUrl = v.optionalUrl(body.venmoUrl, 'venmoUrl');
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, horizonWeeks: body.horizonWeeks });
  if (!Array.isArray(body.players) || body.players.length < 1 || body.players.length > 20) {
    throw new HttpError(400, 'invalid_players', 'Add between 1 and 20 players.');
  }
  const players = body.players.map((p, i) => {
    const row = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    return { id: newId(), name: v.playerName(row.name), phone: v.optionalPhone(row.phone), sort: i };
  });
  const lower = new Set(players.map((p) => p.name.toLowerCase()));
  if (lower.size !== players.length) throw new HttpError(400, 'duplicate_names', 'Each player needs a different name.');

  const groupId = newId();
  const groupKey = randomToken(18);
  const pinHash = await hashPin(pin);
  // The NOT EXISTS guard makes two simultaneous setups impossible.
  const results = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO groups (id, name, timezone, group_key, admin_pin_hash, venmo_url, settings_json, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM groups)`,
      )
      .bind(groupId, name, timezone, groupKey, pinHash, venmoUrl, JSON.stringify(settings), ctx.nowIso),
    ...players.map((p) =>
      ctx.db
        .prepare(
          `INSERT INTO players (id, group_id, display_name, phone_number, sort_order, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?)`,
        )
        .bind(p.id, groupId, p.name, p.phone, p.sort, ctx.nowIso, groupId),
    ),
  ]);
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'already_set_up', 'The group is already set up.');

  const group = (await ctx.db.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<GroupRow>()) as GroupRow;
  await ensureSessions(ctx.db, group, ctx.nowMs);
  await startAdminSession(ctx, groupId);
  return { playerLink: playerLinkFor(ctx, group) };
}
