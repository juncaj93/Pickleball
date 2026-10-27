import * as admin from './admin';
import { type Ctx, makeCtx } from './context';
import type { Env } from './db';
import { HttpError, json, readJson } from './http';
import * as player from './player';
import { runSetup, setupStatus } from './setup';
import { actOnToken, lookupToken } from './tokens';

type Handler = (ctx: Ctx, body: Record<string, unknown>) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '$',
  );
  routes.push({ method, pattern, keys, handler });
}

// Setup
route('GET', '/api/status', (ctx) => setupStatus(ctx));
route('POST', '/api/setup', runSetup);

// Players (private group link)
route('GET', '/api/group', (ctx) => player.groupView(ctx));
route('POST', '/api/me', player.pickName);
route('DELETE', '/api/me', (ctx) => player.forgetName(ctx));
route('POST', '/api/sessions/:id/join', (ctx) => player.playerJoin(ctx));
route('POST', '/api/sessions/:id/withdraw', (ctx) => player.playerWithdraw(ctx));
route('POST', '/api/sessions/:id/confirm', (ctx) => player.playerConfirm(ctx));
route('POST', '/api/sessions/:id/decline', (ctx) => player.playerDecline(ctx));
route('GET', '/api/sessions/:id/calendar.ics', (ctx) => player.sessionCalendarFile(ctx));

// Personal links from text messages. Tokens travel in the body, not the URL.
route('POST', '/api/link', lookupToken);
route('POST', '/api/link/act', actOnToken);

// Organizer
route('POST', '/api/admin/login', admin.login);
route('POST', '/api/admin/logout', (ctx) => admin.logout(ctx));
route('GET', '/api/admin/dashboard', (ctx) => admin.dashboard(ctx));
route('PUT', '/api/admin/group', admin.updateGroup);
route('POST', '/api/admin/pin', admin.changePin);
route('POST', '/api/admin/rotate-link', (ctx) => admin.rotateLink(ctx));
route('POST', '/api/admin/players', admin.createPlayer);
route('PUT', '/api/admin/players/:id', admin.updatePlayer);
route('POST', '/api/admin/sessions/generate', (ctx) => admin.generateSessions(ctx));
route('PUT', '/api/admin/sessions/:id/booking', admin.updateBooking);
route('PUT', '/api/admin/sessions/:id/time', admin.reschedule);
route('POST', '/api/admin/sessions/:id/decision', admin.decide);
route('POST', '/api/admin/sessions/:id/roster', admin.editRoster);
route('POST', '/api/admin/sessions/:id/payment', admin.setPayment);
route('POST', '/api/admin/sessions/:id/refund', admin.setRefund);
route('POST', '/api/admin/sessions/:id/told', admin.markTold);
route('POST', '/api/admin/sessions/:id/links', admin.prepareLinks);
route('GET', '/api/admin/export', (ctx) => admin.exportData(ctx));

export async function handleApi(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const ctx = makeCtx(req, env, nowMs);
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Cross-site form posts can't reach state-changing routes.
      const reqOrigin = req.headers.get('Origin');
      if (reqOrigin && reqOrigin !== ctx.url.origin) throw new HttpError(403, 'bad_origin', 'Request blocked.');
    }
    const candidates = routes.filter((r) => r.pattern.test(ctx.url.pathname));
    if (candidates.length === 0) throw new HttpError(404, 'not_found', 'Not found.');
    const match = candidates.find((r) => r.method === req.method);
    if (!match) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    const m = match.pattern.exec(ctx.url.pathname) as RegExpExecArray;
    match.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
    const result = await match.handler(ctx, body);
    if (result instanceof Response) return result;
    return json(result, 200, ctx.setCookies.map((c) => ({ 'Set-Cookie': c })));
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.code, message: err.message }, err.status, ctx.setCookies.map((c) => ({ 'Set-Cookie': c })));
    }
    console.error('Unhandled API error', err);
    return json({ error: 'server_error', message: 'Something went wrong. Try again.' }, 500);
  }
}
