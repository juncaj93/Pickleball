# Live updates: how it works, what it costs (Fri Oct 30, 2026)

The player page keeps itself fresh without a reload. It must never cost money,
so it is built around one tiny question and a hard rhythm.

## How it works
- Every few seconds the open page asks `GET /api/group/version`. The answer is
  `{"v":"<16 characters>"}`: a fingerprint, nothing else. Only when the
  fingerprint differs from the one the screen was drawn from does the page load
  the full list (`GET /api/group`, the same call as always).
- The fingerprint (`server/stamp.ts`) is a hash of what this player can see:
  the games, who is in and in what order, the names list, the group settings,
  and only THEIR OWN payment state, credit entries and cash out requests. It is
  a hash, so it holds no names, money, phones or Venmo names. Another player's
  payment or credit changing does not move it. It also changes every 10
  minutes so clock-driven things (tonight, game day 8:00 AM, started) show up.
- No schema change. Read only (it never creates games). One batched round trip.
- The full data carries the same fingerprint (`version`), taken before the data
  is read, so a change in between shows up as a newer fingerprint next time.

## The rhythm (`src/livecore.ts`)
| Situation | What happens |
|---|---|
| Tap, scroll or key in the last 2 minutes | ask every 5 seconds |
| 2 to 10 minutes without one | ask every 15 seconds |
| 10 minutes without one | stop until the next touch (then ask at once) |
| Tab hidden or screen off | stop; one check the moment it is visible again |
| Offline, 429, 5xx | wait doubles (10, 20, 40, 60 s), silently; resets on success |
| Bad link (404, 403) | stop for good |

An update never lands while something is in progress (a sheet open, a button
saving, a finger down, typing in a box). It is applied right after (`src/busy.ts`).
Only one check is ever in flight.

## KILL SWITCH
`LIVE_UPDATES` at the top of `src/livecore.ts`:
- `on: false` turns live updates off everywhere (the page still refreshes after a tap and when you come back).
- raise `activeMs` / `idleMs` to slow it down.

Not used in the organizer's "View as..." / "Pretend" demo, and not on organizer screens (skipped on purpose: different data, more risk).

## The real free-plan limits (checked Oct 30, 2026 in Cloudflare's docs)
- Workers/Pages Functions: **100,000 requests per day** (resets 00:00 UTC; Pages Functions share it; static files are free and unlimited). CPU: 10 ms per request.
- D1: **5,000,000 rows read per day**, 100,000 rows written per day, 5 GB.
(developers.cloudflare.com/workers/platform/limits, /d1/platform/pricing, /pages/functions/pricing)

## Usage math: 10 people, 2 hours a day each
- WORST CASE (everyone keeps touching the screen at least every 2 minutes for the full 2 hours, so it never slows down):
  2 h x 3600 / 5 s = 1,440 checks per person = **14,400 requests a day** for 10 people (14% of 100,000).
  Add full reloads (each change reloads for everyone who is looking; say 100 changes x 10 = 1,000) and page opens: about 16,000, **16%**.
- Rows read: the whole live database is about 150 rows, a check reads a part of it (roughly 100 at most): 14,400 x 100 = **about 1.4 million, under 30%** of 5 million in the worst case.
- REALISTIC (people open the page a few times, look for a minute or two, lock the phone): a visit costs about 24 to 60 checks, 4 visits a day = under 250 per person, **about 2,500 requests a day (2.5%)** and about 250,000 rows (5%).
- Test: `tests/live-poller.test.ts` simulates an hour on a fake clock: one active phone <= 720 checks, an untouched phone <= 58, a hidden tab 0, ten phones in the worst case <= 14,500 a day, a failing server <= about one request a minute per phone after back-off.
- CPU: a check is a few small reads, one SHA-256 and a short JSON string, far below 10 ms (not measurable from here; watch the Cloudflare dashboard after deploy).
