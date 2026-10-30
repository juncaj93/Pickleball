// The smart-alert clock: a tiny Cloudflare Worker with one cron trigger
// (every 5 minutes). It only knocks on the site's /api/cron/tick with a
// shared secret; the site works out what is due and sends it with its own
// Telegram secrets (server/tasks.ts). It has no public address, reads no
// data and holds no Telegram token. If a knock fails, the next one, 5
// minutes later, catches up (alerts are sent up to an hour late, never twice).

interface Env {
  /** Where the site lives, e.g. https://pickleball-club-9h0.pages.dev */
  SITE_URL: string;
  /** The same value as the site's CRON_SECRET. */
  CRON_SECRET: string;
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
    return res.status;
  } catch {
    return 0;
  }
}

export default {
  scheduled(_event: unknown, env: Env, ctx: ScheduledCtx) {
    ctx.waitUntil(knock(env));
  },
};
