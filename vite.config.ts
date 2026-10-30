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
          const response: Response = await handleApi(request, { DB: db, SETUP_TOKEN: setupToken, CRON_SECRET: process.env.CRON_SECRET, GO_LINKS: process.env.GO_LINKS }, Date.now() + clockOffsetMs);
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
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
