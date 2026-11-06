// The smart-alert clock: a tiny Cloudflare Worker with one cron trigger
// (every 5 minutes). It only knocks on the site's /api/cron/tick with a
// shared secret; the site works out what is due and sends it with its own
// Telegram secrets (server/tasks.ts). It has no public address, sends no
// messages and holds no Telegram token. If a knock fails, the next one, 5
// minutes later, catches up (alerts are sent up to an hour late, never twice).
// Once an hour it also looks whether the weekly backup copy is due (worker/backup.ts, Zip 8).

import type { D1Database } from '../server/db';
import { maybeWeeklyBackup } from './backup';

interface Env {
  /** Where the site lives, e.g. https://pickleball-club-9h0.pages.dev */
  SITE_URL: string;
  /** The same value as the site's CRON_SECRET. */
  CRON_SECRET: string;
  /** The live database, only READ, for the weekly backup copy (worker/backup.ts). Missing: no copies, the knock goes on as before. */
  DB?: D1Database;
  /** The private backup database `pickleball-backups` the weekly copy is saved in. */
  BACKUP?: D1Database;
}

interface ScheduledCtx {
  waitUntil(work: Promise<unknown>): void;
}

export async function knock(env: Env, doFetch: typeof fetch = fetch): Promise<number> {
  try {
    const res = await doFetch(`${env.SITE_URL.replace(/\/$/, '')}/api/cron/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': env.CRON_SECRET ?? '' },
      body: '{}',
      signal: AbortSignal.timeout(25_000),
    });
    // Shows in the Worker's logs on Cloudflare (a wrong secret reads 404).
    if (!res.ok) console.log(`tick answered ${res.status}`);
    return res.status;
  } catch (err) {
    console.log(`tick failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return 0;
  }
}

/** The weekly copy, on its own: it never delays or stops the knock, and a failure is only a log line (retried within the hour). */
export async function backupTick(env: Env, nowMs = Date.now()): Promise<void> {
  const r = await maybeWeeklyBackup(env.DB, env.BACKUP, nowMs);
  if (r.made) console.log(`weekly backup ${r.week}: ${r.bytes} bytes in ${r.parts} parts, ${r.kept} kept`);
  else if (r.reason.startsWith('failed')) console.log(`weekly backup ${r.reason}`);
}

export default {
  scheduled(_event: unknown, env: Env, ctx: ScheduledCtx) {
    ctx.waitUntil(knock(env));
    ctx.waitUntil(backupTick(env).catch(() => {}));
  },
};
