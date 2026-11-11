// The direct text link in a night-before Telegram alert: /go/<token>. The
// page asks here for the words, then opens Messages with them and no
// recipients. The token is signed, single purpose (this one text for this
// one game), expires after a few hours (never after the game starts), and
// carries no phone number. It needs no admin sign-in, so all it can ever
// give out is the same words the group already gets (a game time and the
// site address), and all it can save is that the text was opened.
import { MIN_PLAYERS } from '../shared/spots';
import { needPlayersMessage, siteAddress } from '../shared/messages';
import { needPlayersTextR2 } from '../shared/textsR2';
import { textsR2For } from './textsR2';
import { needPlayersTextLastCall } from '../shared/lastCall';
import { lastCallFor } from './lastCall';
import { checkInBody } from '../shared/checkInPay';
import { checkInPayFlags, signedUpOweOnGame } from './checkInPay';
import { withShortGames } from './zip9';
import { playerLinkFor } from './admin';
import type { Ctx } from './context';
import { HttpError } from './http';
import { confirmedOf, getGroup, getSession, loadRoster, priceOf, settingsOf } from './repo';
import { writeMark } from './tasks';
import * as v from './validate';

/** A link works for this long after the alert (and never after the game starts). */
export const GO_LINK_HOURS = 6;
const PURPOSE = 'go-night-text-v1';

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

/** "<payload>.<signature>": the payload is the game id and when the link stops working. */
/** `test`: from the TEST smart alert; opening it never marks the real night-before text as done. */
export async function makeGoToken(secret: string, sessionId: string, startsAt: string, nowMs: number, test = false): Promise<string> {
  const expires = Math.min(Date.parse(startsAt), nowMs + GO_LINK_HOURS * 3600_000);
  const payload = b64url(enc.encode(JSON.stringify(test ? { s: sessionId, e: expires, t: 1 } : { s: sessionId, e: expires })));
  return `${payload}.${b64url(await sign(secret, payload))}`;
}

/** The game id, or why not. Equal-time signature check. */
export async function readGoToken(secret: string, token: string, nowMs: number): Promise<{ sessionId: string; test: boolean } | { error: 'invalid' | 'expired' }> {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || token.length > 300) return { error: 'invalid' };
  const got = fromB64url(sig);
  const want = await sign(secret, payload);
  if (!got || got.length !== want.length) return { error: 'invalid' };
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got[i] ^ want[i];
  if (diff !== 0) return { error: 'invalid' };
  let data: { s?: unknown; e?: unknown; t?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(fromB64url(payload) ?? new Uint8Array()));
  } catch {
    return { error: 'invalid' };
  }
  if (typeof data.s !== 'string' || typeof data.e !== 'number') return { error: 'invalid' };
  if (nowMs >= data.e) return { error: 'expired' };
  return { sessionId: data.s, test: data.t === 1 };
}

/** POST /api/go { token }: the night-before text for that game, written fresh (today's count). */
export async function goText(ctx: Ctx, body: Record<string, unknown>) {
  const secret = ctx.env.CRON_SECRET ?? '';
  const token = v.text(body.token, 'token', { max: 300 });
  if (!secret || ctx.env.GO_LINKS !== 'on') throw new HttpError(404, 'not_found', 'This link does not work.');
  const read = await readGoToken(secret, token, ctx.nowMs);
  if ('error' in read) {
    if (read.error === 'expired') throw new HttpError(410, 'link_expired', 'This link expired. Open the organizer page instead.');
    throw new HttpError(404, 'not_found', 'This link does not work.');
  }
  const group = await getGroup(ctx.db);
  const session = group ? await getSession(ctx.db, group.id, read.sessionId) : null;
  if (!group || !session) throw new HttpError(404, 'not_found', 'This link does not work.');
  if (session.status === 'canceled') throw new HttpError(410, 'session_canceled', 'This game was canceled. Open the organizer page instead.');
  if (ctx.nowMs >= Date.parse(session.starts_at)) throw new HttpError(410, 'link_expired', 'This link expired. Open the organizer page instead.');
  const n = confirmedOf(await loadRoster(ctx.db, session.id)).length;
  const link = siteAddress(playerLinkFor(ctx, group));
  const s = { startsAt: session.starts_at, endsAt: session.ends_at };
  // TEXTS_R2 on (everyone, or this phone's private link): the new wording with line breaks. Off: the old words.
  const r2 = await textsR2For(ctx, group.id);
  // "Last call texts" (Zip 8) on top of round 2: Alex's last call words. Off: exactly as before.
  const lastCall = r2 && (await lastCallFor(ctx, group.id));
  // Zip 34 "Check-in pay line" on top of round 2: only a Check-in (4 or more in) can carry it, and only while somebody signed up still owes.
  // Off: none of this runs, and the words are exactly what they were.
  let someoneOwes = false;
  let priceCents = 0;
  const payLine = r2 && n >= MIN_PLAYERS && (await checkInPayFlags(ctx, group.id)).on;
  if (payLine) {
    // The price the players see for this game: the same rules (Short games, Booking hours) as their own screen.
    await withShortGames(ctx, group);
    someoneOwes = await signedUpOweOnGame(ctx, group, session);
    priceCents = priceOf(session, settingsOf(group)).flatCents;
  }
  const text =
    n < MIN_PLAYERS
      ? lastCall
        ? needPlayersTextLastCall(s, group.timezone, ctx.nowMs, n, MIN_PLAYERS - n, link)
        : r2
        ? needPlayersTextR2(s, group.timezone, ctx.nowMs, n, MIN_PLAYERS - n, link)
        : needPlayersMessage(s, group.timezone, ctx.nowMs, MIN_PLAYERS - n, link)
      : checkInBody({ s, tz: group.timezone, nowMs: ctx.nowMs, signedUp: n, link, r2, lastCall, payLine, someoneOwes, priceCents });
  // Opening it counts as the organizer's tap on "Text the group" (not from Pretend or the demo).
  if (!ctx.env.SANDBOX && !read.test) {
    try {
      await writeMark(ctx.db, group.id, session.id, 'night_text', ctx.nowIso);
    } catch {
      // Never worth failing the page over.
    }
  }
  return { ok: true, kind: n < MIN_PLAYERS ? 'need' : 'checkin', body: text, test: read.test };
}
