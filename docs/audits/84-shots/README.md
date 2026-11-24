# 🎾84 full site audit: the 10 worst finds

Local copy of main `79eda2d` (🎾83 live), the preview's fake worlds (calm and full), fixed clock Thu Nov 19, 2026. Fake names only. Nothing in
the app was changed. Pictures and the crawl: `node e2e/zip84-audit.cjs` (every screen at 320 and 390, light and dark, the Christmas skin on
for the player screens, then every button tapped once at 390 light); `SHOTS=1 node e2e/zip84-audit.cjs` retakes these pictures. Red outline =
the find.

No find is a MUST FIX before Dec 1: no money path is wrong, no button is dead, Back closes every sheet.

| # | Picture | What | Where | Why it matters | Severity |
| --- | --- | --- | --- | --- | --- |
| 1 | `01-ticket-style-line-cut-320.png` | The short ticket's style line "Locked doubles (same partner all night)" runs past its box and the card cuts "night)". 19 px too wide at 320, 11 px at 360. Light and dark. | `src/tournament/tournament.css:1615` (`.tc-short .tc-format`, `white-space: nowrap`, 11 px floor) | Every player sees this ticket on Home every day until Dec 1 (and The Cold Open is Locked doubles). "Never cut" is a site rule. | SHOULD fix before Dec 1 |
| 2 | `02-home-row-breaks-words-320.png` | Organizer Home, a folded game row at 320: "Booki / ng open / s Tue, Nov 24": words split in the middle, one letter column. | `src/styles.css:4620` (`.hv2-names`) with the row in `src/pages/admin/HomeV2.tsx:181` | Breaks the "words wrap only between words" rule from Zip 78. Organizer only, only at 320. | SHOULD |
| 3 | `03-player-more-sessions.png` | Players see "More sessions" at the bottom of Home. | `src/pages/PlayerHome.tsx:1006` and `:1011` | Players say "game" (Zip 76 words). Every player, every visit. | SHOULD (one word) |
| 4 | `04-prize-helper-each-americano.png` | Edit awards on an Americano night: "Suggested: full prizes (1st $14 · 2nd $7 each)". One player per place, so "each" is wrong; also "1st only ($14 each)". | `shared/tournamentMoney.ts:105`, `:106` | Left over from Locked doubles' 2nd place (Zip 82, undone in Zip 83). Alex reads it on game night. | SHOULD |
| 5 | `05-owe-line-2-games-42.png` | Owe banner "You owe $42 / $14 each: Nov 12 and Nov 19 (2 games)". It is 3 games (2 on Nov 19), but reads as 2 games for $42. It also wraps to 2 lines at 390 though the code says "Always one line". The money is right. | `shared/unpaidNudge.ts:99` | A player who owes for 2 games on one day sees numbers that look wrong. | SHOULD (words) |
| 6 | `06-history-tabs-sessions-320.png` | History tabs say "Sessions"; at 320 the tab strip opens scrolled so the first tab shows as a lone "y" (Activity). | `src/pages/admin/HistoryTab.tsx:27`, `:262` | Zip 76/78: "game" not "session" on organizer labels. The cut "y" looks broken. | AFTER |
| 7 | `07-two-im-in-looks.png` | Two "I’m in" buttons on one screen with two looks: 15 px / 800 on the "needs 1 more" card, 16 px / 750 on game cards. | `src/alert-cards.css:222` (`.ac-btn`) vs `.sched-btn` | Same job, two looks (audit rule: same job, same size and shape). Small. | AFTER |
| 8 | `08-records-two-ways.png` | Records: players' board "5 - 0" (spaced), organizer's End card "5-0", scores "11–8". The two boards in the picture come from two separate fake stages (random scores); only the format matters. | `src/tournament/Reveal.tsx:310`, `src/tournament/Results.tsx:32` vs `src/pages/admin/StandingsList.tsx:33` | One format site wide. | AFTER |
| 9 | `09-credit-history-by-organizer.png` | The player's own credit sheet: "Credit adjusted by organizer: +$5", while the same sheet says "Request cash out from Alex". | `shared/adjustCredit.ts:91`, `shared/credit.ts:279` | Players see the organizer's first name everywhere else (Zip 76). | AFTER |
| 10 | `10-activity-straight-quotes.png` | Activity: switch names in straight double quotes: Alex switched "Tournaments" on (96 lines of this kind). | `shared/activity.ts:193` and the other `switched "..."` lines | Curly quotes everywhere else. Organizer only. | AFTER |

## Not pictured (small, AFTER Dec 1)
- Cash out Venmo link note is "Pickleball credit refund" (`src/pages/admin/HomeCards.tsx:23`, `PlayersTab.tsx:27`): the word rule says "cash out".
- "cash-out" with a hyphen in two organizer strings: `shared/adjustCredit.ts:76` ("held for a cash-out request"), `shared/actingForOthers.ts:139`.
- A player's "Didn’t pay?" takes back their I paid at once (request 49 ms after the tap, no Undo); I paid itself is instant too, so it can be put back. Its tap area is 44 px (a stretched `::before`), fine.
- Player header at 320 with the CREDIT chip and the cup: the buttons go to a second row under the name (Zip 83 notes said they stay on the name's row). Nothing is cut.
- The Tournament test page (preview only, never on live) answered 500 once when re-staging "Play to 9" after taps; a retry worked.

## Checked and fine
- Fonts: one font on every screen (`-apple-system` body stack; `monospace` only on one Settings line (the browser default for a `<code>` or link field there)). No carets. Nothing wider than the screen at 320 or 390 (the winners ticker runs inside its own clipped strip). No text under 11 px.
- Colors: `tests/zip78-look.test.ts` passes (15 of 15); outside `src/styles.css` only see-through white and black. Lime only on tournament buttons (Lock in, Sign up, Standings); white Enter score on the green Up next card; the site green everywhere else.
- Words in code: 0 em dashes and 0 straight apostrophes in user-facing strings (all hits are comments); no "Back out", "withdraw" or chirpy words on any screen. "Waitlist" shows only on the organizer's court switch (by design).
- Money paths (local, the screens read back): tournament prize Vic $14 = credit chip $14 = credit history "$14 Tournament champion, The Cold Open" = Players sheet Credit $14; hand credit +$5 (Sage) lands once: chip, history, Players sheet, one Activity line; cash out Reese $14 Mark refunded: $14 to $0 once, a second tap refused.
- Venmo links: every Pay link carries the right amount and note (`amount=14&note=Pickleball Thu Nov 19 - Vic`, `amount=42&note=... (2 games) - Vic`, the ticket `The Cold Open ticket - Vic`); handles and numbers left out of this file.
- Dead ends: about 600 taps over 60 screens: every button did something (a sheet, a request, a page change or a download); the only "nothing" taps were the already selected segment of a switch or tab. Back closed every one of about 100 sheets. Backup file and CSV both download.
