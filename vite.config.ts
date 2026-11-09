import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * During `npm run dev`, answer /api/* with the real server code backed by a
 * local SQLite file (.data/dev.sqlite). Production uses Cloudflare Pages
 * Functions + D1 instead; the handler code is identical.
 */
function localApi(setupToken: string): Plugin {
  let db: unknown;
  // Browser tests only: shift the server clock (for example to 9:00 AM on game
  // day). Lives in the local dev server; the live site has no such thing.
  let clockOffsetMs = 0;
  return {
    name: 'local-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url === '/__dev/clock' && req.method === 'POST' && process.env.DEV_CLOCK === '1') {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const { atMs } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
          clockOffsetMs = typeof atMs === 'number' ? atMs - Date.now() : 0;
          res.statusCode = 204;
          return res.end();
        }
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const { handleApi } = await server.ssrLoadModule('/server/app.ts');
          if (!db) {
            const { createNodeD1 } = await server.ssrLoadModule('/dev/nodeD1.ts');
            mkdirSync('.data', { recursive: true });
            db = createNodeD1(process.env.DEV_DB ?? '.data/dev.sqlite');
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, val] of Object.entries(req.headers)) {
            if (typeof val === 'string') headers.set(k, val);
            else if (Array.isArray(val)) headers.set(k, val.join(', '));
          }
          const url = `http://${req.headers.host}${req.url}`;
          const request = new Request(url, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const response: Response = await handleApi(request, { DB: db, SETUP_TOKEN: setupToken, CRON_SECRET: process.env.CRON_SECRET, GO_LINKS: process.env.GO_LINKS, MOTION: process.env.MOTION, MOTION_ADMIN: process.env.MOTION_ADMIN, PAY_ALWAYS: process.env.PAY_ALWAYS, ADMIN_V2: process.env.ADMIN_V2, ADMIN_R2: process.env.ADMIN_R2, ADMIN_R3: process.env.ADMIN_R3, PLAYER_FIX1: process.env.PLAYER_FIX1, PAY_SHEET: process.env.PAY_SHEET, TEXTS_R2: process.env.TEXTS_R2, LATE_FEES: process.env.LATE_FEES, LATE_FEE_SPLIT: process.env.LATE_FEE_SPLIT, MONEY_REWORK: process.env.MONEY_REWORK, INSTANT_TAPS: process.env.INSTANT_TAPS, ADJUST_CREDIT: process.env.ADJUST_CREDIT, VENMO_REQUEST: process.env.VENMO_REQUEST, HOME_COLLAPSE: process.env.HOME_COLLAPSE, TONIGHT_GLOW: process.env.TONIGHT_GLOW, COLOR_CLEANUP: process.env.COLOR_CLEANUP, PLAYER_CARDS_SIMPLE: process.env.PLAYER_CARDS_SIMPLE, ORGANIZER_READONLY_PIN: process.env.ORGANIZER_READONLY_PIN, LAST_CALL_TEXTS: process.env.LAST_CALL_TEXTS, SHORT_GAMES: process.env.SHORT_GAMES, CARD_TIME_BUTTONS: process.env.CARD_TIME_BUTTONS, CARD_CLEANUP: process.env.CARD_CLEANUP, ALERT_CARDS: process.env.ALERT_CARDS, SEAT_DOTS: process.env.SEAT_DOTS, PLAYERS_REDO: process.env.PLAYERS_REDO, SWAP_BUTTON: process.env.SWAP_BUTTON, ADMIN_UNDO: process.env.ADMIN_UNDO, SPEED_FEWER_QUERIES: process.env.SPEED_FEWER_QUERIES, SPEED_DIRECT_LOAD: process.env.SPEED_DIRECT_LOAD, SPEED_LAST_SCREEN: process.env.SPEED_LAST_SCREEN, SPEED_LAST_SCREEN_ADMIN: process.env.SPEED_LAST_SCREEN_ADMIN, GAME_DAY_CARD: process.env.GAME_DAY_CARD, AFTER_GAME_CARD: process.env.AFTER_GAME_CARD, GAME_DAY_TEST: process.env.GAME_DAY_TEST, SECOND_CHANCE: process.env.SECOND_CHANCE, SECOND_CHANCE_TEST: process.env.SECOND_CHANCE_TEST, PREVIEW_CALM: process.env.PREVIEW_CALM , UNPAID_NUDGE: process.env.UNPAID_NUDGE, ERROR_ALERTS: process.env.ERROR_ALERTS }, Date.now() + clockOffsetMs);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
          });
          const cookies = response.headers.getSetCookie();
          if (cookies.length) res.setHeader('Set-Cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.end('dev api error');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), localApi(env.SETUP_TOKEN || 'local-dev-setup-token')],
    // Zip 12: the app version a saved copy of the player screen belongs to (src/lastScreen.ts throws away any other).
    define: { __APP_BUILD__: JSON.stringify(process.env.APP_BUILD || String(Date.now())) },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
      setupFiles: ['tests/setup-speed.ts'],
    },
  };
});
