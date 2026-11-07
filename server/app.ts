import * as admin from './admin';
import { monthlyMoney } from './money';
import { type Ctx, makeCtx } from './context';
import type { Env } from './db';
import { HttpError, json, readJson } from './http';
import * as player from './player';
import { refundCreditBalance, resolveRefundRequest } from './creditActions';
import { finalizeSession, reopenFinalize } from './finalize';
import { enterGroupWord, runSetup, setupStatus } from './setup';
import { actOnToken, lookupToken } from './tokens';
import { requireAdmin } from './auth';
import { PRETEND_HEADER, parsePretend, readOnly } from './pretend';
import * as alerts from './alerts';
import * as tasks from './tasks';
import { goText } from './go';
import { type FewerQueriesDb, withFewerQueries } from './speed';
import { isWrite, VIEW_ONLY_ALLOWED_WRITES, VIEW_ONLY_MESSAGE, viewOnlyCookie, viewOnlyDb } from './viewOnly';

type Handler = (ctx: Ctx, body: Record<string, unknown>) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

/** Every route the API answers (method and path pattern), for tests that must cover each one, including routes added later. */
export function routeList(): { method: string; path: string }[] {
  return routes.map((r) => ({
    method: r.method,
    path: r.pattern.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\(\[\^\/\]\+\)/g, ':param').replace(/\\\//g, '/'),
  }));
}

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
route('POST', '/api/access', enterGroupWord);

// Players (private group link)
route('GET', '/api/group', (ctx) => player.groupView(ctx));
route('GET', '/api/group/version', (ctx) => player.groupVersion(ctx));
route('POST', '/api/me', player.pickName);
route('DELETE', '/api/me', (ctx) => player.forgetName(ctx));
route('POST', '/api/players/self', player.addSelf);
route('PUT', '/api/me/days', player.setMyDays);
route('POST', '/api/sessions/:id/join', (ctx) => player.playerJoin(ctx));
route('POST', '/api/sessions/:id/withdraw', (ctx) => player.playerWithdraw(ctx));
route('POST', '/api/sessions/:id/confirm', (ctx) => player.playerConfirm(ctx));
route('POST', '/api/sessions/:id/still-in', player.playerStillIn);
route('POST', '/api/sessions/:id/paid', player.playerPaid);
route('POST', '/api/sessions/:id/use-credit', (ctx) => player.playerUseCredit(ctx));
route('POST', '/api/sessions/:id/undo-credit', (ctx) => player.playerUndoCredit(ctx));
route('POST', '/api/sessions/:id/use-cash-out', player.playerUseCashOut);
route('POST', '/api/sessions/:id/decline', (ctx) => player.playerDecline(ctx));
route('POST', '/api/me/refund-request', player.playerRequestRefund);
route('POST', '/api/me/refund-request/cancel', (ctx) => player.playerCancelRefundRequest(ctx));
route('GET', '/api/sessions/:id/calendar.ics', (ctx) => player.sessionCalendarFile(ctx));
// The old calendar subscription feed is gone: its links now get a plain "Not found".
route('GET', '/api/cal/:token', async () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }));

// Personal links from text messages. Tokens travel in the body, not the URL.
route('POST', '/api/link', lookupToken);
route('POST', '/api/link/act', actOnToken);

// Organizer
route('POST', '/api/admin/login', admin.login);
route('POST', '/api/admin/logout', (ctx) => admin.logout(ctx));
route('GET', '/api/admin/dashboard', (ctx) => admin.dashboard(ctx));
route('GET', '/api/admin/activity', (ctx) => admin.activity(ctx));
route('POST', '/api/admin/sessions', admin.addGame);
route('POST', '/api/admin/sessions/:id/me', admin.organizerInOut);
route('PUT', '/api/admin/group', admin.updateGroup);
route('POST', '/api/admin/pin', admin.changePin);
route('POST', '/api/admin/rotate-link', (ctx) => admin.rotateLink(ctx));
route('POST', '/api/admin/players', admin.createPlayer);
route('PUT', '/api/admin/players/:id', admin.updatePlayer);
route('DELETE', '/api/admin/players/:id', (ctx) => admin.removePlayer(ctx));
route('POST', '/api/admin/sessions/generate', (ctx) => admin.generateSessions(ctx));
route('PUT', '/api/admin/sessions/:id/booking', admin.updateBooking);
route('PUT', '/api/admin/sessions/:id/time', admin.reschedule);
route('POST', '/api/admin/sessions/:id/decision', admin.decide);
route('POST', '/api/admin/sessions/:id/roster', admin.editRoster);
route('POST', '/api/admin/sessions/:id/payment', admin.setPayment);
route('POST', '/api/admin/sessions/:id/claim', admin.answerClaim);
route('POST', '/api/admin/sessions/:id/finalize', finalizeSession);
route('POST', '/api/admin/sessions/:id/reopen', (ctx) => reopenFinalize(ctx));
route('POST', '/api/admin/refund-requests/:id', resolveRefundRequest);
route('POST', '/api/admin/players/:id/credit-refund', refundCreditBalance);
route('GET', '/api/admin/money', (ctx) => monthlyMoney(ctx));
route('POST', '/api/admin/sessions/:id/late-drop-done', admin.lateDropDone);
route('POST', '/api/admin/sessions/:id/late-fee', admin.clearLateFee);
route('PUT', '/api/admin/late-fees', admin.setLateFees);
route('POST', '/api/admin/sessions/:id/booked', admin.markBooked);
route('POST', '/api/admin/sessions/:id/court-answer', admin.courtAnswer);
route('POST', '/api/admin/sessions/:id/court', admin.courtWaitlist);
route('POST', '/api/admin/sessions/:id/court-status', admin.setCourtStatus);
route('GET', '/api/admin/version', (ctx) => admin.adminVersion(ctx));
route('POST', '/api/admin/sessions/:id/show', admin.showSession);
route('PUT', '/api/admin/sessions/:id/note', admin.setSessionNote);
route('POST', '/api/admin/sessions/:id/hide', admin.hideFromPlayers);
route('POST', '/api/admin/sessions/:id/holiday-hours', admin.holidayHours);
route('POST', '/api/admin/sessions/:id/card-done', admin.cardDone);
route('POST', '/api/admin/sessions/:id/told', admin.markTold);
route('POST', '/api/admin/sessions/:id/links', admin.prepareLinks);
route('GET', '/api/admin/export', (ctx) => admin.exportData(ctx));
route('GET', '/api/admin/backup', (ctx) => admin.backupFile(ctx));
route('PUT', '/api/admin/alerts', alerts.updateAlerts);
route('PUT', '/api/admin/time-shift', admin.setTimeShift);
route('PUT', '/api/admin/pay-always', admin.setPayAlways);
route('PUT', '/api/admin/admin-v2', admin.setAdminV2);
route('PUT', '/api/admin/admin-r2', admin.setAdminR2);
route('PUT', '/api/admin/admin-r3', admin.setAdminR3);
route('POST', '/api/admin/players/:id/admin-hide', admin.hidePlayerFromAdmin);
route('PUT', '/api/admin/pay-note', admin.setPayNote);
route('PUT', '/api/admin/player-fix1', admin.setPlayerFix1);
route('PUT', '/api/admin/texts-r2', admin.setTextsR2);
route('PUT', '/api/admin/late-fee-split', admin.setLateFeeSplit);
route('PUT', '/api/admin/money-rework', admin.setMoneyRework);
route('PUT', '/api/admin/instant-taps', admin.setInstantTaps);
route('PUT', '/api/admin/adjust-credit-switch', admin.setAdjustCreditSwitch);
route('PUT', '/api/admin/venmo-request-switch', admin.setVenmoRequestSwitch);
route('PUT', '/api/admin/home-collapse-switch', admin.setHomeCollapseSwitch);
route('PUT', '/api/admin/last-call-switch', admin.setLastCallSwitch);
route('PUT', '/api/admin/short-games-switch', admin.setShortGamesSwitch);
route('PUT', '/api/admin/card-time-switch', admin.setCardTimeSwitch);
route('PUT', '/api/admin/card-cleanup-switch', admin.setCardCleanupSwitch);
route('PUT', '/api/admin/alert-cards-switch', admin.setAlertCardsSwitch);
route('PUT', '/api/admin/speed-fewer-queries-switch', admin.setSpeedFewerQueriesSwitch);
route('PUT', '/api/admin/speed-direct-load-switch', admin.setSpeedDirectLoadSwitch);
route('PUT', '/api/admin/speed-last-screen-switch', admin.setSpeedLastScreenSwitch);
route('PUT', '/api/admin/speed-last-screen-admin-switch', admin.setSpeedLastScreenAdminSwitch);
route('PUT', '/api/admin/tonight-glow-switch', admin.setTonightGlowSwitch);
route('PUT', '/api/admin/color-cleanup-switch', admin.setColorCleanupSwitch);
route('PUT', '/api/admin/player-cards-switch', admin.setPlayerCardsSwitch);
route('PUT', '/api/admin/motion-switch', admin.setMotionSwitch);
route('POST', '/api/admin/players/:id/credit-adjust', admin.adjustPlayerCredit);
route('POST', '/api/admin/sessions/:id/hide-from-list', admin.hideFromList);
route('GET', '/api/admin/month-games', admin.monthGames);
route('POST', '/api/admin/sessions/:id/charge', admin.setSessionCharge);
route('PUT', '/api/admin/pay-sheet', admin.setPaySheet);
route('POST', '/api/admin/alerts/test', (ctx) => alerts.testAlert(ctx));
route('POST', '/api/admin/alerts/smart-test', (ctx) => tasks.smartTestAlert(ctx));
route('POST', '/api/admin/sessions/:id/task-mark', tasks.taskMark);

// The direct text link from a night-before Telegram alert (signed token, no sign-in).
route('POST', '/api/go', goText);

// The cron Worker's 5-minute tick (secret header; anyone else gets Not found).
route('POST', '/api/cron/tick', (ctx) => tasks.cronTick(ctx));

export async function handleApi(req: Request, env: Env, nowMs = Date.now(), waitUntil?: (work: Promise<unknown>) => void): Promise<Response> {
  let ctx = makeCtx(req, env, nowMs, waitUntil);
  // SPEED_FEWER_QUERIES (server/speed.ts): the request's database while it is on; stepped aside once the answer is ready.
  let fewer: FewerQueriesDb | null = null;
  try {
    // "Pretend it's...": only for the signed-in organizer, and look-only.
    const pretend = req.headers.get(PRETEND_HEADER);
    if (pretend) {
      await requireAdmin(ctx);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
      const at = parsePretend(pretend);
      if (at === null) throw new HttpError(400, 'invalid_pretend', 'Pick a date and time.');
      const db = readOnly(env.DB);
      ctx = { ...makeCtx(req, { ...env, DB: db }, at, waitUntil), realNowIso: ctx.realNowIso };
    }
    // The read-only organizer PIN (server/viewOnly.ts): a phone signed in with it never writes. Every POST, PUT, PATCH and
    // DELETE is refused here, before any route runs (sign in and sign out excepted), and its reads run on a database that
    // cannot be written to, so upkeep inside a read (adding next weeks' games, alerts) does nothing either.
    if (viewOnlyCookie(ctx)) {
      if (isWrite(req.method)) {
        if (!VIEW_ONLY_ALLOWED_WRITES.has(`${req.method} ${ctx.url.pathname}`)) throw new HttpError(403, 'view_only', VIEW_ONLY_MESSAGE);
      } else {
        const db = viewOnlyDb(ctx.db);
        ctx = { ...ctx, env: { ...ctx.env, DB: db }, db };
      }
    }
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
    try {
      match.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    } catch {
      // A broken %-escape in the address is just a bad address, not a server error.
      throw new HttpError(404, 'not_found', 'Not found.');
    }
    const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : {};
    const speed = withFewerQueries(ctx);
    ctx = speed.ctx;
    fewer = speed.db;
    const result = await match.handler(ctx, body);
    fewer?.finish();
    if (result instanceof Response) return result;
    return json(result, 200, ctx.setCookies.map((c) => ({ 'Set-Cookie': c })));
  } catch (err) {
    fewer?.finish();
    if (err instanceof HttpError) {
      return json({ error: err.code, message: err.message }, err.status, ctx.setCookies.map((c) => ({ 'Set-Cookie': c })));
    }
    console.error('Unhandled API error', err);
    return json({ error: 'server_error', message: 'Something went wrong. Try again.' }, 500);
  }
}
