// Scheduled Worker: calls the site's morning check with the shared secret.
// It sends nothing itself and holds no data; the site does the work and
// decides whether a nudge is due.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env));
  },
  // A GET with the right key does the same, for a manual test.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.CRON_SECRET || !env.CRON_SECRET) return new Response('Not found', { status: 404 });
    return new Response(JSON.stringify(await ping(env)), { headers: { 'Content-Type': 'application/json' } });
  },
};

async function ping(env) {
  if (!env.CRON_SECRET) return { ok: false, error: 'CRON_SECRET is not set on the Worker' };
  const res = await fetch(`${env.SITE_URL.replace(/\/$/, '')}/api/cron/finalize-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cron-Key': env.CRON_SECRET },
    body: '{}',
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}
