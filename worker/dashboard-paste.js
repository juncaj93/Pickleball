// The smart-alert clock, as plain JavaScript to paste into the Cloudflare
// dashboard (same as worker/cron.ts). Every 5 minutes it asks the site to send
// any smart alert that is due. It needs two settings on the Worker:
//   SITE_URL     (text)   https://pickleball-club-9h0.pages.dev
//   CRON_SECRET  (secret) the same value as the site's CRON_SECRET
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.SITE_URL.replace(/\/$/, '')}/api/cron/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': env.CRON_SECRET || '' },
        body: '{}',
        signal: AbortSignal.timeout(25000),
      })
        .then((res) => {
          if (!res.ok) console.log(`tick answered ${res.status}`);
        })
        .catch((err) => console.log(`tick failed: ${err && err.message}`)),
    );
  },
};
