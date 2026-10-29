# The morning "Finalize" nudge

A separate, tiny Cloudflare Worker with a cron trigger (free). Every morning
it calls the site at `/api/cron/finalize-reminder` with a shared secret. The
site then sends ONE Telegram message per game that ended before today and is
still not finalized ("Finalize last night's game: Thu Oct 29, 6 in."), only
from 9:00 AM Eastern, and only if the "Finalize reminder" switch in
Settings > Alerts is on.

Two cron times (13:00 and 14:00 UTC) cover daylight saving: one of them is
9:00 AM Eastern, the other is 8:00 AM (the site answers "before 9:00 AM" and
does nothing) or 10:00 AM (already nudged at 9, nothing to do).

## Set up once

1. Make a long random secret, for example `openssl rand -hex 24`.
2. On the Pages project (the site): Cloudflare dashboard > Workers & Pages >
   pickleball-club > Settings > Variables and Secrets > add secret
   `CRON_SECRET` with that value. Or: `npx wrangler pages secret put CRON_SECRET --project-name pickleball-club`.
3. Deploy this Worker and give it the same secret:

   ```
   cd cron
   npx wrangler deploy
   npx wrangler secret put CRON_SECRET
   ```

4. Test it: open `https://pickleball-cron.<your-account>.workers.dev/?key=<the secret>`
   in a browser. It answers with what the site did (`{"sent":0,"skipped":"before 9:00 AM"}` for example).

Nothing here costs money: Cloudflare's free plan includes cron triggers and
far more requests than one a day.
