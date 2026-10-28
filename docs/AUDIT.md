# Pre-launch audit (Oct 27, 2026, evening Eastern)

A fresh look at the whole site before it goes to the group, done by reading
the code, attacking a local copy with fake data, and doing read-only checks
on the live site (through the backup address pickleball-club-9h0.pages.dev,
since this audit's network could not reach pickleball.juncaj.net directly;
it is the same deployment).

Severity: CRITICAL (data leak, money wrong, site down), HIGH, MEDIUM, LOW.

**Totals: 0 critical, 3 high, 8 medium, 9 low. Fixed: 9 (2 high, 3 medium, 4 low).**

## Fixed in this audit (each has a test in tests/audit-fixes.test.ts or e2e)

| # | Sev | What was wrong | What I did |
|---|-----|----------------|------------|
| F1 | HIGH | **Money:** someone who used a $5 credit, paid $9, then dropped (or the game was canceled) lost the credit when you marked them Refunded. You'd give back $9 and the $5 would vanish. | Marking Refunded now gives the credit back to them. Unchecking Refunded takes the same credit again. |
| F2 | HIGH | **Money:** someone refunded who then tapped I'm in again showed as "Paid" and owed nothing, so they'd play free. | Rejoining after a refund now owes again like anyone new. A payment that was not refunded still carries over (unchanged). |
| F3 | MEDIUM | The "3 new names per hour" spam limit could be skipped by sending many at the same instant (8 of 8 got through in my test). | The limit is now counted before the name is saved, so a burst can't sneak past it. A name refused as a duplicate doesn't use up one of the 3. |
| F4 | MEDIUM | Names could contain invisible characters that flip text direction, so a name could display as another word or impersonate someone. | Those characters are refused. Emoji, accents and apostrophes still work. |
| F5 | MEDIUM | On a 320px phone (iPhone SE 1st gen) "Court not booked yet" ran into "Election Day" on player cards. On 320 to 390px, the organizer's "✓ You're in" sat on top of the dots when 6 were in. At 320px "Book a court" was cut off. | Below 360px the holiday goes under the court words, the two pills sit a little tighter, and "You're in / Out" drops to its own line. From 360 to 390px with 6 in, the names and "+4" tuck under the dots. Wider screens look the same as before. |
| F6 | LOW | A web address with a broken %-code crashed with a server error (500). | It now answers "Not found". |
| F7 | LOW | The setup page answered differently to a right vs wrong setup code even after setup, which let someone test guesses. `/api/status` also said setup was still on. | Once set up, setup always answers "already set up" and status says it's off. |
| F8 | LOW | No "always use HTTPS" header (HSTS). | Added `Strict-Transport-Security` for this site only (no subdomains). |
| F9 | LOW | The known browser-test "flake": two checks used the browser's clock while the test server's clock is pinned to 12:30 AM on Tue/Thu, so they failed on Tue/Thu evenings. | Both checks now use the server's time. All 205 browser checks pass. |

## Checked and fine

- **Player data:** raw `/api/group` on the live site has only names, ids, session times, counts and your Venmo link. No phone numbers, PIN or hash, court cost, membership, other people's balances, activity log or export. Tested in code for every player response too.
- **Organizer-only:** all 29 organizer endpoints reject requests with no sign-in, a forged cookie, or a player's cookie (tested). "View as" without your sign-in is refused.
- **PIN:** stored hashed (PBKDF2), never sent to the browser. 5 wrong tries per device and 20 total per 15 minutes, counted safely even for simultaneous guesses. Cookie is HttpOnly, Secure, SameSite=Strict, 30 days. Sign out deletes it on the server (an old cookie copy stops working). Changing the PIN signs out every device.
- **Injection:** names like `<img onerror=...>`, `'); DROP TABLE` and emoji are saved as plain text and shown as plain text. No script ran in the browser. All database queries use placeholders.
- **Forged requests:** a player can only act as the name picked on their phone (from a secret cookie, never from the request). Cross-site posts are blocked. Personal text links only work for their own person and session.
- **4 or 6:** 3 to 7 people tapping I'm in twice each at the same moment never ended at 5 or 7. The database itself refuses a 7th.
- **Money math:** $14 flat; with 6, the 5th and 6th owe $9 and the first four get $5 credits after the game; credits go whole to the next game; the monthly summary (collected $74, court $48, credits owed, left) matches the per-session lists in my tests.
- **Time:** all screens, texts, the .ics file and Activity use Eastern with AM/PM. Booking opens 12:00 AM Eastern 14 days before (live: Nov 3 opened Oct 20, 12:00 AM). The Nov 1 clock change is covered by tests (sessions stay 8 to 10 PM, booking window, pay card).
- **Texts:** nothing says "sent". Share the game and Spot open have no recipients. Last call ends "text me ASAP".
- **Security headers:** CSP, no framing, nosniff, no-referrer, noindex on every page and API answer. Old feed `/api/cal/...` returns "Not found" live. No secrets in the code, git history, or the live JavaScript.
- **Packages:** 0 vulnerabilities in what the site ships. The 3 flagged (vitest test tool) only run on a developer computer.
- **Layout:** no sideways scrolling at 320, 360, 375, 390, 430 and 768px, light and dark. No JavaScript errors. Text contrast passes WCAG AA everywhere I measured (lowest 5.07:1). Small buttons have invisible 44px tap areas.
- **Link preview:** title "Pickleball Bros", description and image tags are already there.
- **Cost:** $0. About 15 players opening the site ~6 times a day is roughly 200 to 400 requests and ~150,000 database rows read per day, under 1% and ~3% of the free limits (100,000 requests, 5 million rows). No polling. Page is ~105 KB compressed.

## Needs your decision (not changed)

| # | Sev | Finding | My recommendation |
|---|-----|---------|-------------------|
| D1 | HIGH | **"View as..." really acts for the player** (I'm in, I'm out, I paid all happen and are logged as you). SITE_RULES says it should be a no-write simulation. | Make it look-only: taps show "Preview only" and change nothing. Safer, matches your rules. |
| D2 | MEDIUM | **Late drop timing:** the code tags a late drop from 24 hours before (day-before check-in). SITE_RULES says after the cancellation deadline (12 hours, per booking). | Follow your rules (cancellation deadline). It's fairer and matches when the court money is at stake. |
| D3 | MEDIUM | **Backup** in Settings is a CSV report. It can't be restored and leaves out players, phone numbers, credits and settings. The real safety net is Cloudflare's own database history (Time Travel, last 7 days on the free plan). | Add a full "Backup file" download that can be restored, and keep the CSV as a report. Until then, see "Live backup" below. |
| D4 | MEDIUM | Unpaid amounts older than 90 days drop off every screen (player and organizer). | Keep unpaid amounts visible until paid, however old. |
| D5 | MEDIUM | Anyone with the address can pick any name and tap for that person (I'm out, I paid). That's how no-PIN works; the Activity log and "self-marked" tag show it. | Fine for friends. If it's ever abused, turn on the group word in Settings > Access. |
| D6 | MEDIUM | The `SETUP_TOKEN` secret is still set in Cloudflare. With F7 it can't be used or guessed while the group exists, but it's no longer needed. | Delete it (Cloudflare > Workers & Pages > pickleball-club > Settings > Variables and Secrets > SETUP_TOKEN > Delete). Safe. |
| D7 | LOW | A screen left open doesn't refresh when you come back to it later; it shows the last state until you reload or tap. | Reload quietly when the phone returns to the page. |
| D8 | LOW | Last call says "tonight". An extra game in the daytime would get a wrong-sounding text. | Say "today" when the game starts before 5 PM. |
| D9 | LOW | The "Pay $9" button is 34px tall (others reach 44px). | Make its tap area 44px without changing the look. |
| D10 | LOW | 20 wrong PIN guesses from anywhere lock everyone out for 15 minutes, including you. Low risk because you stay signed in for 30 days. | Leave as is. |
| D11 | LOW | The vitest test tool has known issues (developer computer only, not the site). Fixing needs a major upgrade. | Upgrade in a later round; zero effect on the live site. |

Also noted, no action needed: old organizer sign-ins (expired) stay in the database table (tiny); robots.txt blocks all crawlers, which some link-preview bots respect (iMessage ignores it, so the group text preview works).

## Forgot your PIN?

Today there's no reset button. The fix is a one-line database change in the Cloudflare dashboard (set a new PIN hash), which Claude can prepare for you.

## Live backup

I tried to export the live database before deploying, and this session's safety rules blocked it (it would copy real phone numbers out of Cloudflare). Nothing in this round changes the database layout, so no migration runs. Cloudflare keeps 7 days of database history (Time Travel), so any day in the past week can be restored. To make a copy yourself: `npx wrangler d1 export pickleball --remote --output pickleball-backup.sql`.

## Tests

- Unit and API tests: 238 passed (7 new in `tests/audit-fixes.test.ts`).
- Browser tests (`npm run test:e2e`): 205 passed, 0 failed.
- Typecheck: clean.
