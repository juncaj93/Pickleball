import type { D1Database, Env } from './db';
import { parseCookies, serializeCookie } from './http';

export interface Ctx {
  req: Request;
  env: Env;
  db: D1Database;
  url: URL;
  nowMs: number;
  nowIso: string;
  /** The real time. Same as nowIso unless the organizer is pretending it's another time. */
  realNowIso: string;
  cookies: Record<string, string>;
  params: Record<string, string>;
  /** Set-Cookie headers to add to the response. */
  setCookies: string[];
  /** Work that finishes after the response is sent (Telegram alerts). */
  waitUntil: (work: Promise<unknown>) => void;
}

/** Without Cloudflare's waitUntil (tests, local dev), background work just runs. */
const runLoose = (work: Promise<unknown>) => void work.catch(() => {});

export function makeCtx(req: Request, env: Env, nowMs: number, waitUntil: (work: Promise<unknown>) => void = runLoose): Ctx {
  return {
    req,
    env,
    db: env.DB,
    url: new URL(req.url),
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    realNowIso: new Date(nowMs).toISOString(),
    cookies: parseCookies(req.headers.get('Cookie')),
    params: {},
    setCookies: [],
    waitUntil,
  };
}

export const ADMIN_COOKIE = 'pb_admin';
export const PLAYER_COOKIE = 'pb_player';

export function setCookie(ctx: Ctx, name: string, value: string, maxAgeSeconds: number, sameSite: 'Strict' | 'Lax') {
  ctx.setCookies.push(serializeCookie(name, value, { maxAgeSeconds, sameSite, secure: ctx.url.protocol === 'https:' }));
}

export function clearCookie(ctx: Ctx, name: string) {
  setCookie(ctx, name, '', 0, 'Lax');
}

/** Address to put in links we hand out (confirm/claim links, player link). */
export function origin(ctx: Ctx): string {
  return ctx.url.origin;
}
