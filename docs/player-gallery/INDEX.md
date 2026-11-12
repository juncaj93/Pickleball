# Player screen gallery (Zip 36)

Pictures of every PLAYER-side screen and state of the site as it is today, in light and dark, to design the Christmas skin on. Admin screens are not here.

- Phone: iPhone Air size, 420 x 912 CSS px, 3x (1260 x 2736 pixels), PNG. Real header, real fonts, real buttons.
- File names: `NN-name-light.png` / `NN-name-dark.png` is the whole screen. `NN-name-crop-light.png` (or another word after the name, like `-owe` or `-toast`) is a tight crop of just that card or sheet. `NN-name-full-light.png` is the whole scrolling page.
- Made by `node e2e/player-gallery.cjs` on a throwaway fake group on this computer. It never touches the live site or the shared preview database. Fake names only (docs/PREVIEW_FAKE_DB.md): Alex (organizer), Vic, Wren, Zoe, Quinn, Rowan, Parker, Reese, Sage and Christopher Vanderberg. The two screens that add a new name use the made-up name Tatum, in this picture world only.
- Every Settings switch that is ON on live is ON here (the same list the preview uses), plus Extended time. Calm mode is off, so every alert shows, as on live.
- Two clocks: "Thu Nov 12, 3:00 PM" for most pictures; a few move it (noted per picture). All times are Eastern, 12-hour.
- 90 screens, 394 picture files.

## 1. Identity (14)

### 01 who-are-you

"Who are you?": the first visit, no name picked yet, with the organizer sign-in link under the names.

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx NamePicker, SiteHome.tsx OrganizerLink
- Files: `01-who-are-you-{light,dark}.png`, `01-who-are-you-crop-{light,dark}.png`

### 02 not-you

"not you?" tapped: the same name list again, with Cancel to go back to your own screen.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx NamePicker (Cancel), Shell.tsx TopBar
- Files: `02-not-you-{light,dark}.png`

### 03 add-my-name

"Add my name": typing a name when you are not on the list.

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx AddMyName
- Files: `03-add-my-name-{light,dark}.png`, `03-add-my-name-crop-{light,dark}.png`

### 04 is-this-you

"Is this you?": the typed name looks like a name already on the list, so the list shows them with "No, I'm new".

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx AddMyName
- Files: `04-is-this-you-{light,dark}.png`, `04-is-this-you-crop-{light,dark}.png`

### 05 bad-link

A group link that is not valid ("This group link isn't valid").

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (404 branch), ui.tsx Notice
- Files: `05-bad-link-{light,dark}.png`, `05-bad-link-crop-{light,dark}.png`

### 06 offline-error

No signal: the error with Try again (the games could not load).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx ErrorState
- Files: `06-offline-error-{light,dark}.png`

### 07 empty-site

A site with no games at all: "No upcoming sessions yet."

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx Empty
- Files: `07-empty-site-{light,dark}.png`

### 08 loading

The loading skeleton, drawn while the games are still on their way.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx ScheduleSkeleton
- Files: `08-loading-{light,dark}.png`

### 09 saved-copy

Opening the site again: the copy of the last screen this phone kept is drawn at once with every button held, until the fresh games arrive.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: lastScreen.ts, PlayerHome.tsx SavedScreenView (held cards)
- Files: `09-saved-copy-{light,dark}.png`

### 81 add-name-days

Add my name, last step: "Any preferred days?" (Tuesday, Thursday, Both, Skip). The made-up name Tatum exists only in this local picture world.

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx AddMyName (days)
- Files: `81-add-name-days-{light,dark}.png`, `81-add-name-days-crop-{light,dark}.png`

### 83 link-only

The group is set to link-only: the plain address says "Open the link your organizer sent you."

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: SiteHome.tsx LinkOnly
- Files: `83-link-only-{light,dark}.png`

### 84 group-word

The organizer set a group word: asked once per phone ("What's the group word?").

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: SiteHome.tsx GroupWord
- Files: `84-group-word-{light,dark}.png`

### 85 name-removed

A name that was removed by the organizer: the phone falls back to "Who are you?" and the name is gone from the list.

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx NamePicker
- Files: `85-name-removed-{light,dark}.png`, `85-name-removed-crop-{light,dark}.png`

### 90 not-set-up

A site nobody has set up yet: "Nobody has set up this site yet" and Set up the group.

- Seen as: nobody picked yet. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: SiteHome.tsx NotSetUp
- Files: `90-not-set-up-{light,dark}.png`

## 2. Home layout (24)

### 10 home-vic

Home for a player who owes money: the owe card, THIS WEEK, then NEXT WEEK, ending with the "More sessions" button.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (PayCard, ScheduleRow), Shell.tsx TopBar
- Files: `10-home-vic-{light,dark}.png`, `10-home-vic-full-{light,dark}.png`

### 11 home-later-open

More sessions tapped: the LATER header and the flat later games, including canceled games and empty games.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (HOME_COLLAPSE button, ScheduleRow tier later)
- Files: `11-home-later-open-{light,dark}.png`, `11-home-later-open-full-{light,dark}.png`

### 12 home-my-games

"My games" tapped: only the games this player is in.

- Seen as: Sage. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx GameFilterToggle
- Files: `12-home-my-games-{light,dark}.png`, `12-home-my-games-full-{light,dark}.png`

### 13 home-alex-organizer

The organizer's own player page (Alex) as a plain player sees it, "Drop out" on the game he is in.

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx
- Files: `13-home-alex-organizer-{light,dark}.png`, `13-home-alex-organizer-full-{light,dark}.png`

### 14 card-not-in

A game I am not in: tile, balls, names, I'm in, and the gray "if 5 play" credit hint.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow
- Files: `14-card-not-in-{light,dark}.png`, `14-card-not-in-crop-{light,dark}.png`

### 15 card-booked-in

A booked game I am in: "You're in", tile check, Calendar and Directions buttons, balls, names, $14 due with Pay, I paid, Drop out.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow, RowPay, CardButtons.tsx
- Files: `15-card-booked-in-{light,dark}.png`, `15-card-booked-in-crop-{light,dark}.png`

### 16 card-paid

"Paid $14" (paid with cash and confirmed by the organizer): the green Paid pill and Drop out.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx RowPay
- Files: `16-card-paid-{light,dark}.png`, `16-card-paid-crop-{light,dark}.png`

### 17 card-self-paid

"Paid $14" that I marked myself, with the small "Didn't pay?" link.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx RowPay
- Files: `17-card-self-paid-{light,dark}.png`, `17-card-self-paid-crop-{light,dark}.png`

### 18 card-one-in

A game with one ball filled and three empty circles (1 in), me in it.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx SpotDots
- Files: `18-card-one-in-{light,dark}.png`, `18-card-one-in-crop-{light,dark}.png`

### 19 card-three-in

A game with 3 of 4 in (three balls, one empty circle).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx SpotDots
- Files: `19-card-three-in-{light,dark}.png`, `19-card-three-in-crop-{light,dark}.png`

### 20 card-eight-in

A game with 8 in: the balls keep coming on one row, the long names line.

- Seen as: Zoe. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx SpotDots, NamesLine
- Files: `20-card-eight-in-{light,dark}.png`, `20-card-eight-in-crop-{light,dark}.png`

### 21 card-short-game

A 1.5 hour game: the price changes to $11.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow (short game)
- Files: `21-card-short-game-{light,dark}.png`, `21-card-short-game-crop-{light,dark}.png`

### 22 card-court-waitlist

The venue has a waitlist for the court: players read "Court not booked" and are in as a normal game.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: courtDisplay.ts, PlayerHome.tsx ScheduleRow
- Files: `22-card-court-waitlist-{light,dark}.png`, `22-card-court-waitlist-crop-{light,dark}.png`

### 23 card-moved

A moved game (7:00 became 7:30 PM): the tile shows the new time and the blue bar above asks "Still in" or "Can't make it".

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: timeShift.tsx TimeBars, PlayerHome.tsx ScheduleRow
- Files: `23-card-moved-{light,dark}.png`, `23-card-moved-bar-{light,dark}.png`, `23-card-moved-crop-{light,dark}.png`

### 24 card-extra-game

An extra game (added by hand): the EXTRA tag under the time and a note pill ("Late-fee test").

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow, PlayerTile
- Files: `24-card-extra-game-{light,dark}.png`, `24-card-extra-game-crop-{light,dark}.png`

### 25 card-canceled-fee-split

A game canceled late with the fee split: "Canceled late. You still owe $11."

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow (late fee)
- Files: `25-card-canceled-fee-split-{light,dark}.png`, `25-card-canceled-fee-split-crop-{light,dark}.png`

### 26 card-canceled-reason

A canceled game with the organizer's reason ("Canceled - Court closed"): "If you paid, it's now your credit."

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow (st-canceled)
- Files: `26-card-canceled-reason-{light,dark}.png`, `26-card-canceled-reason-crop-{light,dark}.png`

### 27 card-thanksgiving

The Thanksgiving week game: players see no holiday words at all (the holiday note is organizer-only).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (HolidayPill is organizer-only)
- Files: `27-card-thanksgiving-{light,dark}.png`, `27-card-thanksgiving-crop-{light,dark}.png`

### 28 card-later-open

A game further out, empty (0 in), booking not open yet: "Court not booked yet".

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow tier later, courtStatus
- Files: `28-card-later-open-{light,dark}.png`, `28-card-later-open-crop-{light,dark}.png`

### 70 card-dropped-out

A game I dropped out of: back to the plain I'm in button.

- Seen as: Quinn. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow
- Files: `70-card-dropped-out-{light,dark}.png`, `70-card-dropped-out-crop-{light,dark}.png`

### 72 card-court-booked

The same game, Court booked.

- Seen as: Wren. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow, courtStatus
- Files: `72-card-court-booked-{light,dark}.png`, `72-card-court-booked-crop-{light,dark}.png`

### 79 seat-dots-0-to-10

Seat dots in every look: games with 0, 1, 2 ... 10 in (empty dashed ring, filled ball, the ring on MY ball, balls past four on one row). Whole page.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx SpotDots, EmptySeat, Pickleball; seat-dots.css; zip10.css
- Files: `79-seat-dots-0-to-10-{light,dark}.png`, `79-seat-dots-0-to-10-full-{light,dark}.png`

### 80 seat-dots-rows

The same games, one close-up each: 0 to 10 in (even counts: I am not in; odd counts and 10: I am in, so my ball has the ring).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx SpotDots
- Files: `80-seat-dots-rows-{light,dark}.png`, `80-seat-dots-rows-n00-{light,dark}.png`, `80-seat-dots-rows-n01-{light,dark}.png`, `80-seat-dots-rows-n02-{light,dark}.png`, `80-seat-dots-rows-n03-{light,dark}.png`, `80-seat-dots-rows-n04-{light,dark}.png`, `80-seat-dots-rows-n05-{light,dark}.png`, `80-seat-dots-rows-n06-{light,dark}.png`, `80-seat-dots-rows-n07-{light,dark}.png`, `80-seat-dots-rows-n08-{light,dark}.png`, `80-seat-dots-rows-n09-{light,dark}.png`, `80-seat-dots-rows-n10-{light,dark}.png`

### 82 my-games-empty

"My games" for someone who is in no game yet: "You're not in any games yet" and See all games.

- Seen as: Tatum. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (empty-mine)
- Files: `82-my-games-empty-{light,dark}.png`, `82-my-games-empty-crop-{light,dark}.png`

## 3. Game day (6)

### 29 game-day-court3

The game day card on a game with a court: TONIGHT tile, "Court 3" and Directions buttons, balls, names.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: GameDay.tsx GameDayButtons, PlayerHome.tsx ScheduleRow
- Files: `29-game-day-court3-{light,dark}.png`, `29-game-day-court3-crop-{light,dark}.png`

### 30 game-day-court-map

Court 3 tapped: the court map with the game's court lit.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: GameDay.tsx CourtMap
- Files: `30-game-day-court-map-{light,dark}.png`, `30-game-day-court-map-crop-{light,dark}.png`

### 31 game-day-court-tbd

"Court TBD" tapped: the small pop-up "Alex will add it soon."

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: GameDay.tsx GameDayButtons (gd-pop)
- Files: `31-game-day-court-tbd-{light,dark}.png`, `31-game-day-court-tbd-crop-{light,dark}.png`

### 32 game-day-not-in

Game day card for a game I am not in (Court TBD, TONIGHT tile, I'm in).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: GameDay.tsx, PlayerHome.tsx ScheduleRow
- Files: `32-game-day-not-in-{light,dark}.png`, `32-game-day-not-in-crop-{light,dark}.png`

### 33 game-day-started

A game that started 5 minutes ago (5:05 PM): the card stays up with Court 3 for late arrivals.

- Seen as: Rowan. Clock: Thu, Nov 12, 5:05 PM ET.
- Drawn by: GameDay.tsx, PlayerHome.tsx ScheduleRow
- Files: `33-game-day-started-{light,dark}.png`, `33-game-day-started-crop-{light,dark}.png`, `33-game-day-started-full-{light,dark}.png`

### 34 game-day-finished

After the 5 PM game ended (7:30 PM): the finished game is gone from Home; what is left is tonight's other games.

- Seen as: Rowan. Clock: Thu, Nov 12, 7:30 PM ET.
- Drawn by: PlayerHome.tsx (ended games are left out by the server)
- Files: `34-game-day-finished-{light,dark}.png`, `34-game-day-finished-full-{light,dark}.png`

## 4. Money cards and alerts (21)

### 35 owe-two-games

"You owe $28": the owe card for two past unpaid games ("$14 each: Nov 5 and Nov 6"), Pay and I paid.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard, AlertCard.tsx
- Files: `35-owe-two-games-{light,dark}.png`, `35-owe-two-games-crop-{light,dark}.png`

### 36 owe-three-games

"You owe $42" for three games: at three, signing up is blocked (the I'm in buttons are dimmed).

- Seen as: Zoe. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard, unpaid-nudge.css
- Files: `36-owe-three-games-{light,dark}.png`, `36-owe-three-games-crop-{light,dark}.png`

### 37 owe-three-games-blocked-join

The dimmed I'm in on a game card while blocked.

- Seen as: Zoe. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow (nudge-dim)
- Files: `37-owe-three-games-blocked-join-{light,dark}.png`, `37-owe-three-games-blocked-join-crop-{light,dark}.png`

### 38 owe-more-after-redo

"You owe $3 more": a game that owed more after the organizer redid the final price ("final price $14, 4 played").

- Seen as: Quinn. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard (oweMoreText), shared/afterGame.ts
- Files: `38-owe-more-after-redo-{light,dark}.png`, `38-owe-more-after-redo-crop-{light,dark}.png`

### 39 owe-with-credit-and-after-game

Owe card with "Use credit" (a $8 credit), then the blue "$8 back to your credit" card and the green "Tonight has 4 in" Want in card.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard, AfterGameCard, SuggestionCard
- Files: `39-owe-with-credit-and-after-game-{light,dark}.png`, `39-owe-with-credit-and-after-game-owe-{light,dark}.png`, `39-owe-with-credit-and-after-game-after-game-{light,dark}.png`, `39-owe-with-credit-and-after-game-want-in-{light,dark}.png`

### 40 owe-credit-adjusted

Owe card carrying the organizer's "Credit adjusted: +$5 · Thanks for bringing balls" line.

- Seen as: Sage. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard (adjustNote)
- Files: `40-owe-credit-adjusted-{light,dark}.png`, `40-owe-credit-adjusted-crop-{light,dark}.png`

### 41 owe-late-fee-and-notice

Owe card for a late-cancel fee game plus the blue "You no longer owe $14 / Someone took your spot" notice with Dismiss; CASH OUT chip in the header.

- Seen as: Reese. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard, FeeNotices, CreditChip
- Files: `41-owe-late-fee-and-notice-{light,dark}.png`, `41-owe-late-fee-and-notice-owe-{light,dark}.png`, `41-owe-late-fee-and-notice-notice-{light,dark}.png`, `41-owe-late-fee-and-notice-chip-{light,dark}.png`

### 42 owe-long-name

The longest made-up name ("Christopher Vanderberg") in the header, a $67 owe card over three games and the CREDIT chip.

- Seen as: Christopher Vanderberg. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: Shell.tsx TopBar, PayCard, CreditChip
- Files: `42-owe-long-name-{light,dark}.png`, `42-owe-long-name-header-{light,dark}.png`, `42-owe-long-name-owe-{light,dark}.png`

### 43 after-game-credit-back

"$5 back to your credit": the after-game card ("Mon, Nov 9: final price $9, 6 played") with its X.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx AfterGameCard
- Files: `43-after-game-credit-back-{light,dark}.png`, `43-after-game-credit-back-crop-{light,dark}.png`

### 44 credit-chip

The CREDIT chip in the header (only shown when the balance is above zero).

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx CreditChip
- Files: `44-credit-chip-{light,dark}.png`, `44-credit-chip-crop-{light,dark}.png`

### 45 credit-chip-cash-out-pending

The chip turns into CASH OUT while a cash-out request is waiting.

- Seen as: Reese. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx CreditChip (pending)
- Files: `45-credit-chip-cash-out-pending-{light,dark}.png`, `45-credit-chip-cash-out-pending-crop-{light,dark}.png`

### 57 still-in-confirmed

"Still in" tapped on the moved-game bar: the button turns into "Confirmed" for a moment before the bar folds away.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: timeShift.tsx TimeBar (done)
- Files: `57-still-in-confirmed-{light,dark}.png`, `57-still-in-confirmed-crop-{light,dark}.png`

### 64 paid-with-credit

"Paid with credit": Use credit tapped with enough credit ($19 covers $14). The row shows Paid with credit and an Undo link; the pop-up says what happened.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx RowPay, useCredit, creditUsedMessage
- Files: `64-paid-with-credit-{light,dark}.png`, `64-paid-with-credit-toast-{light,dark}.png`, `64-paid-with-credit-crop-{light,dark}.png`

### 65 part-credit

Part credit: Use credit with only $8 of credit on a $14 game: "Credit $8 used" chip and "$6 due".

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx RowPay (chip-credit-used), PayCard
- Files: `65-part-credit-{light,dark}.png`, `65-part-credit-toast-{light,dark}.png`, `65-part-credit-owe-{light,dark}.png`

### 68 cash-out-prompt

"Use your $13 cash out for this game?": after I'm in, when a cash out is pending and no other credit covers the game (Use it / No, keep cash out).

- Seen as: Sage. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CashOutPrompt.tsx
- Files: `68-cash-out-prompt-{light,dark}.png`, `68-cash-out-prompt-crop-{light,dark}.png`

### 69 late-fee-owe-card

A late drop that left the game short: the owe card now reads "You owe $14" with "(late drop)" next to the game, and the game card is back to I'm in.

- Seen as: Quinn. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PayCard (lateFeeLabel), shared/lateFees.ts
- Files: `69-late-fee-owe-card-{light,dark}.png`, `69-late-fee-owe-card-owe-{light,dark}.png`, `69-late-fee-owe-card-row-{light,dark}.png`

### 73 extended-owe

Extended time: "You owe $3 for the extra 30 min" (amber) with the small "Pay now instead" link and the X.

- Seen as: Vic. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx ExtensionAlerts (owe)
- Files: `73-extended-owe-{light,dark}.png`, `73-extended-owe-crop-{light,dark}.png`

### 74 extended-owe-next-game

The same $3 rides on the next game: "$17 due" with "incl. $3 extension".

- Seen as: Vic. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx RowPay (inclNote)
- Files: `74-extended-owe-next-game-{light,dark}.png`, `74-extended-owe-next-game-crop-{light,dark}.png`, `74-extended-owe-next-game-full-{light,dark}.png`

### 76 extended-credit-used

Extended time: "Your $3 credit was used for ..." (blue, the credit color) for a player whose credit covered the share.

- Seen as: Christopher Vanderberg. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx ExtensionAlerts (credit)
- Files: `76-extended-credit-used-{light,dark}.png`, `76-extended-credit-used-crop-{light,dark}.png`

### 77 extended-part-credit

Extended time, part credit: only $2 of the $3 was covered and the rest is owed.

- Seen as: Parker. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx ExtensionAlerts (credit and owe)
- Files: `77-extended-part-credit-{light,dark}.png`, `77-extended-part-credit-crop-{light,dark}.png`

### 78 after-game-final-price

After the game: the Finalize credit-back card and the extension alerts together at the top of Home.

- Seen as: Parker. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx AfterGameCard, ExtensionAlerts
- Files: `78-after-game-final-price-{light,dark}.png`, `78-after-game-final-price-full-{light,dark}.png`

## 5. Sheets and pop-ups (21)

### 46 credit-sheet

The credit sheet: balance, "Request cash out from Alex" and the last 10 credit changes in plain words.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx CreditSheet, ui.tsx Sheet
- Files: `46-credit-sheet-{light,dark}.png`, `46-credit-sheet-crop-{light,dark}.png`

### 47 credit-sheet-cash-out-pending

The credit sheet while a cash out is pending: "Cash out requested: $14, pending" and Cancel request.

- Seen as: Reese. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx (credit-pending)
- Files: `47-credit-sheet-cash-out-pending-{light,dark}.png`, `47-credit-sheet-cash-out-pending-crop-{light,dark}.png`

### 48 credit-sheet-adjusted

The credit sheet with the organizer's hand adjustment line ("Credit adjusted: +$5").

- Seen as: Sage. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx (credit-adjusted)
- Files: `48-credit-sheet-adjusted-{light,dark}.png`, `48-credit-sheet-adjusted-crop-{light,dark}.png`

### 49 credit-sheet-ask

"Request cash out from Alex" tapped: the amount box with Request and Back.

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx (refund-ask)
- Files: `49-credit-sheet-ask-{light,dark}.png`, `49-credit-sheet-ask-crop-{light,dark}.png`

### 50 pay-sheet

The Pay sheet (Pay tapped): Venmo app link, Copy Venmo handle, the Apple Pay / Zelle / cash line and I paid.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PaySheet
- Files: `50-pay-sheet-{light,dark}.png`, `50-pay-sheet-crop-{light,dark}.png`

### 51 pay-sheet-row

The Pay sheet opened from a game card's own Pay button ($14).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PaySheet via RowPay
- Files: `51-pay-sheet-row-{light,dark}.png`, `51-pay-sheet-row-crop-{light,dark}.png`

### 52 drop-confirm

"Out for tonight?" confirmation (Drop out tapped): "Your spot opens up for someone else."

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow ConfirmDialog
- Files: `52-drop-confirm-{light,dark}.png`, `52-drop-confirm-crop-{light,dark}.png`

### 53 drop-confirm-late-fee

Drop out confirmation past the cancel-by time: the late-fee warning ("You owe $14 unless someone takes your spot").

- Seen as: Quinn. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx ScheduleRow ConfirmDialog, shared/lateFees.ts
- Files: `53-drop-confirm-late-fee-{light,dark}.png`, `53-drop-confirm-late-fee-crop-{light,dark}.png`

### 54 blocked-sheet

Blocked at three unpaid games: "You owe $42 / Pay $42 / Not now".

- Seen as: Zoe. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx BlockSheet
- Files: `54-blocked-sheet-{light,dark}.png`, `54-blocked-sheet-crop-{light,dark}.png`

### 55 calendar-directions

The Calendar | Directions buttons on a booked game card I am in (a tap opens the phone's own Calendar or Maps).

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CardButtons.tsx CalendarDirections
- Files: `55-calendar-directions-{light,dark}.png`, `55-calendar-directions-crop-{light,dark}.png`

### 56 cant-make-it-sheet

"Can't make it" on the moved-game bar: the same Drop out question, with the button reading "Can't make it".

- Seen as: Parker. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: timeShift.tsx TimeBar, PlayerHome.tsx ScheduleRow ConfirmDialog (fromNotice)
- Files: `56-cant-make-it-sheet-{light,dark}.png`, `56-cant-make-it-sheet-crop-{light,dark}.png`

### 58 toast-error

A red error pop-up: I'm in could not reach the site ("That did not work. Try again.").

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner (pop-error)
- Files: `58-toast-error-{light,dark}.png`, `58-toast-error-crop-{light,dark}.png`

### 59 toast-copied-venmo

Copy Venmo handle tapped in the Pay sheet: the "Copied @handle" pop-up appears over the sheet.

- Seen as: Vic. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx PaySheet, ui.tsx Banner
- Files: `59-toast-copied-venmo-{light,dark}.png`, `59-toast-copied-venmo-crop-{light,dark}.png`

### 60 toast-game-on

"Game on! 4 in": the pop-up when my tap made the 4th player (the pickleball badge).

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner (ball), PlayerHome.tsx joinToast
- Files: `60-toast-game-on-{light,dark}.png`, `60-toast-game-on-crop-{light,dark}.png`

### 61 toast-youre-in

"You're in" pop-up after tapping I'm in on a game that still needs players.

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner, PlayerHome.tsx joinToast
- Files: `61-toast-youre-in-{light,dark}.png`, `61-toast-youre-in-crop-{light,dark}.png`

### 62 toast-nudge-please-pay

I'm in while owing for 1 or 2 past games: the dark "Please pay" pop-up with a Pay button.

- Seen as: Wren. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner (nudge), PlayerHome.tsx joinToast, shared/unpaidNudge.ts
- Files: `62-toast-nudge-please-pay-{light,dark}.png`, `62-toast-nudge-please-pay-crop-{light,dark}.png`

### 63 toast-marked-paid

I paid tapped on the owe card: the "Marked paid" pop-up (the card turns into Paid on the game).

- Seen as: Zoe. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner, PlayerHome.tsx usePaid
- Files: `63-toast-marked-paid-{light,dark}.png`, `63-toast-marked-paid-crop-{light,dark}.png`

### 66 toast-drop-undo

Drop out confirmed: the pop-up says what happens to money and holds a 5 second Undo; the card already shows I'm in again.

- Seen as: Alex. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: ui.tsx Banner (Undo ring), undoHold.ts, PlayerHome.tsx dropOut
- Files: `66-toast-drop-undo-{light,dark}.png`, `66-toast-drop-undo-toast-{light,dark}.png`, `66-toast-drop-undo-crop-{light,dark}.png`

### 67 toast-cash-out-requested

Request tapped in the credit sheet: the "Cash out requested" pop-up (the header chip is now CASH OUT).

- Seen as: Sage. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: CreditSheet.tsx, ui.tsx Banner
- Files: `67-toast-cash-out-requested-{light,dark}.png`, `67-toast-cash-out-requested-toast-{light,dark}.png`, `67-toast-cash-out-requested-header-{light,dark}.png`

### 71 toast-cash-out-sent

The organizer sent the cash out: "Alex sent your $14" with an OK button, shown once when the page opens.

- Seen as: Reese. Clock: Thu, Nov 12, 3:00 PM ET.
- Drawn by: PlayerHome.tsx (planCashOut notice), celebrate.ts
- Files: `71-toast-cash-out-sent-{light,dark}.png`, `71-toast-cash-out-sent-crop-{light,dark}.png`

### 75 extended-pay-now

"Pay now instead" tapped: the Pay sheet for just the $3.

- Seen as: Vic. Clock: Thu, Nov 12, 10:30 PM ET.
- Drawn by: PlayerHome.tsx ExtensionAlerts, PaySheet
- Files: `75-extended-pay-now-{light,dark}.png`, `75-extended-pay-now-crop-{light,dark}.png`

## 6. Extra: large text (4)

### 86 large-text-125-home

Home at 125% text size (a large-text safety check for the skin), as a player with the owe card, credit and games.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET. Text size 125%.
- Drawn by: large-text.css and every Home card
- Files: `86-large-text-125-home-{light,dark}.png`, `86-large-text-125-home-full-{light,dark}.png`

### 87 large-text-125-money-card

The money card at 125% text size: owe card, Use credit, Pay.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET. Text size 125%.
- Drawn by: PlayerHome.tsx PayCard, alert-cards.css
- Files: `87-large-text-125-money-card-{light,dark}.png`, `87-large-text-125-money-card-owe-{light,dark}.png`, `87-large-text-125-money-card-after-game-{light,dark}.png`

### 88 large-text-150-home

Home at 150% text size (a large-text safety check for the skin), as a player with the owe card, credit and games.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET. Text size 150%.
- Drawn by: large-text.css and every Home card
- Files: `88-large-text-150-home-{light,dark}.png`, `88-large-text-150-home-full-{light,dark}.png`

### 89 large-text-150-money-card

The money card at 150% text size: owe card, Use credit, Pay.

- Seen as: Rowan. Clock: Thu, Nov 12, 3:00 PM ET. Text size 150%.
- Drawn by: PlayerHome.tsx PayCard, alert-cards.css
- Files: `89-large-text-150-money-card-{light,dark}.png`, `89-large-text-150-money-card-owe-{light,dark}.png`, `89-large-text-150-money-card-after-game-{light,dark}.png`

## States not reached, and why

- "Good news, a spot opened up" (the green note after a waitlist spot or an opened court): the site only sends it when a game has a waitlist, and "Card cleanup" (ON on live) removed waitlists, so a player can never see it on the current site. The look is in the code (goodNews.ts, AlertCard tone green, class ac-inline) but nothing can draw it today.
- Second Chance revived-game card: Second Chance is organizer-only (cards on admin Home). A player never gets a card of its own; a reopened game just reads as a normal game (and as the blue moved-game bar if its time changed, see the moved-game pictures).
- Thanksgiving / holiday hours: players see no holiday words at all (the holiday note is organizer-only), so the game on Thanksgiving week looks like any other game (picture "card-thanksgiving").
- Waitlist circles in the seat dots: with Card cleanup ON there is no waitlist, so the seat dots only have an empty ring, a ball and the ring on my own ball.
- A part-credit alert for Extended time with a share the credit covers exactly is shown by the credit-used picture; a "$17 due" game with part credit is the same card with the credit chip added (picture "part-credit").
- Add to calendar: it is the Calendar half of the Calendar | Directions button (a download the phone handles); there is no screen of ours behind it. Directions likewise opens Apple or Google Maps.
- The organizer-only screens (/admin, Setup, Go page, View as bars) are skipped on purpose: they never get the skin.
