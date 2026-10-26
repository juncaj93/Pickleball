import type { D1Database, Env } from './db';
import { parseCookies, serializeCookie } from './http';

export interface Ctx {
  req: Request;
  env: Env;
  db: D1Database;
  url: URL;
  nowMs: number;
  nowIso: string;
  cookies: Record<string, string>;
  params: Record<string, string>;
  /** Set-Cookie headers to add to the response. */
  setCookies: string[];
}

export function makeCtx(req: Request, env: Env, nowMs: number): Ctx {
  return {
    req,
    env,
    db: env.DB,
    url: new URL(req.url),
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    cookies: parseCookies(req.headers.get('Cookie')),
    params: {},
    setCookies: [],
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
